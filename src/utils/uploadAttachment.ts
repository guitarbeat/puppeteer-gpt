import { Page } from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { uploadLogger } from './logger';
import { ScreenshotManager } from './screenshot';

/**
 * Uploads multiple files to the ChatGPT conversation at once.
 * This is more efficient than uploading files one by one.
 * @param page Puppeteer page instance
 * @param filePaths Array of paths to files to upload
 * @returns Promise<boolean> indicating if all files were uploaded successfully
 */
export async function uploadMultipleAttachments(page: Page, filePaths: string[]): Promise<boolean> {
  // Process all file paths to handle spaces and special characters
  const processedFilePaths = filePaths.map(filePath => {
    try {
      // Normalize path to handle spaces and special characters
      return decodeURIComponent(filePath.trim()).replace(/\\/g, '');
    } catch (e) {
      return filePath.trim();
    }
  });

  // Filter out any non-existent files
  const existingFiles = processedFilePaths.filter(filePath => {
    try {
      const exists = fs.existsSync(filePath);
      if (!exists) {
        uploadLogger.error(`File not found: ${filePath}`);
      }
      return exists;
    } catch (e) {
      uploadLogger.error(`Error checking file: ${filePath}`, e);
      return false;
    }
  });

  if (existingFiles.length === 0) {
    throw new Error('No valid files to upload');
  }

  uploadLogger.info(`Starting upload of ${existingFiles.length} files at once`);
  
  // 1. Click the "Upload files and more" button
  const uploadButtonSelector = 'button[aria-label="Upload files and more"]';
  try {
    // Take a screenshot of the initial state
    await ScreenshotManager.takeScreenshot(page, 'before-upload-button-click', false, false);
    
    // Wait for upload button with reduced timeout
    await page.waitForSelector(uploadButtonSelector, { timeout: 20000, visible: true });
    
    // Use more reliable click method
    try {
      // Ensure button is in viewport
      await page.evaluate((selector) => {
        const button = document.querySelector(selector);
        if (button) button.scrollIntoView({behavior: 'smooth', block: 'center'});
      }, uploadButtonSelector);
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Use a more reliable click method
      await page.evaluate((selector) => {
        const button = document.querySelector(selector);
        if (button && button instanceof HTMLElement) {
          button.click();
          return true;
        }
        return false;
      }, uploadButtonSelector);
      
      uploadLogger.debug('Clicked "Upload files and more" button using evaluate');
    } catch (evalError) {
      // Fall back to regular click if evaluate fails
      uploadLogger.debug('Fallback to regular click method');
      await page.click(uploadButtonSelector);
    }
    
    // Wait shorter for the menu to appear
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (error) {
    uploadLogger.error('Failed to click "Upload files and more" button', error);
    await ScreenshotManager.takeErrorScreenshot(page, 'upload-button-failure');
    throw new Error(`Upload button not found: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Take screenshot of menu
  await ScreenshotManager.takeScreenshot(page, 'upload-menu-opened', false, false);

  // 2. Wait for the "Upload from computer" option and click it
  uploadLogger.debug('Looking for "Upload from computer" option');

  // First, try optimized direct file input access - this may skip needing to click "Upload from computer"
  let fileInputFound = false;
  try {
    // Some chat interfaces expose the file input directly
    const fileInputSelector = 'input[type="file"]';
    const fileInput = await page.$(fileInputSelector);
    if (fileInput) {
      uploadLogger.debug('File input found directly without needing to click upload option');
      fileInputFound = true;
    }
  } catch (e) {
    // Continue to normal flow if direct access fails
  }

  if (!fileInputFound) {
    try {
      // Try different methods to find the upload option with increased timeouts
      let clicked = false;
      
      // Method 0: Try finding by selector that might contain the upload button text
      try {
        await page.waitForSelector('div[role="menuitem"]', { timeout: 3000 });
        const menuItems = await page.$$('div[role="menuitem"]');
        for (const item of menuItems) {
          const text = await item.evaluate(el => el.textContent || '');
          if (text.includes('Upload') && text.includes('computer')) {
            await item.click();
            clicked = true;
            uploadLogger.debug('Clicked "Upload from computer" via menu item selector');
            break;
          }
        }
      } catch (e) {
        uploadLogger.debug('Failed to find menu item by role selector');
      }
      
      // Method 1: Try finding by visible text content
      if (!clicked) {
        try {
          // Use evaluate to find the element by text
          const found = await page.evaluate(() => {
            const uploadText = 'Upload from computer';
            // Try various element types that might be used for menu items
            const elements = Array.from(document.querySelectorAll('div, span, button, a, li'));
            
            // Find elements containing the text
            const matches = elements.filter(el => {
              const text = el.textContent?.trim() || '';
              return text.includes('Upload') && text.includes('computer');
            });
            
            // Get the most likely menu item (smaller element that contains the text exactly)
            const exactMatches = matches.filter(el => el.textContent?.trim() === uploadText);
            
            // Click the exact match or the first containing match
            const bestMatch = exactMatches.length > 0 ? exactMatches[0] : matches[0];
            if (bestMatch) {
              // Navigate up a few levels to try to find the clickable parent
              let clickTarget = bestMatch;
              let levels = 0;
              // Try up to 3 parent levels to find a clickable element
              while (clickTarget && levels < 3) {
                // Use the HTMLElement click method (TypeScript safe)
                if (clickTarget instanceof HTMLElement) {
                  clickTarget.click();
                }
                // Check if we've clicked successfully (new elements should appear)
                if (document.querySelector('input[type="file"]')) {
                  return true;
                }
                
                // Move to parent, but only if it's an Element
                const parent = clickTarget.parentElement;
                if (!parent) break;
                
                clickTarget = parent;
                levels++;
              }
            }
            return false;
          });
          
          if (found) {
            clicked = true;
            uploadLogger.debug('Clicked "Upload from computer" via text content evaluation');
          }
        } catch (e) {
          uploadLogger.debug('Failed to click by text content evaluation');
        }
      }
      
      // Skip keyboard navigation and position clicking for speed - they're fallbacks that
      // often don't work as well and add delay
      
      if (!clicked) {
        uploadLogger.warn('Could not find or click "Upload from computer" option using standard methods');
      }
      
      // Wait shorter for the file input to appear
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      uploadLogger.error('Failed to select "Upload from computer"', error);
      await ScreenshotManager.takeErrorScreenshot(page, 'upload-menu-error');
      throw new Error(`Could not select "Upload from computer": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 3. Wait for the file input to appear and set multiple files at once
  uploadLogger.debug('Looking for file input');
  try {
    const fileInputSelector = 'input[type="file"]';
    // Reduced timeout
    await page.waitForSelector(fileInputSelector, { timeout: 10000 });
    
    // Take screenshot of file input
    await ScreenshotManager.takeScreenshot(page, 'file-input-found', false, false);
    
    const inputUploadHandle = await page.$(fileInputSelector);
    if (!inputUploadHandle) {
      throw new Error('File input not found');
    }
    
    // Resolve all file paths and make sure they're properly encoded/decoded
    const resolvedPaths = existingFiles.map(filePath => {
      const resolvedPath = path.resolve(filePath);
      uploadLogger.debug(`Resolved path: ${resolvedPath}`);
      return resolvedPath;
    });
    
    // Log the files being uploaded
    uploadLogger.info(`Uploading ${resolvedPaths.length} files at once:`);
    resolvedPaths.forEach((filePath, index) => {
      uploadLogger.debug(`  ${index+1}. ${filePath}`);
      
      // Double check file exists
      if (!fs.existsSync(filePath)) {
        uploadLogger.error(`File does not exist after path resolution: ${filePath}`);
      } else {
        const stats = fs.statSync(filePath);
        uploadLogger.debug(`  File size: ${stats.size} bytes`);
      }
    });
    
    // Upload all files at once
    uploadLogger.debug(`Using resolvedPaths: ${resolvedPaths.join(', ')}`);
    await inputUploadHandle.uploadFile(...resolvedPaths);
    uploadLogger.info('All files submitted to input');
    
    // Wait for upload to complete without noisy error logs
    uploadLogger.info('Waiting for uploads to complete...');
    
    // For multiple files, we need to wait longer but less than before
    const waitTimeMultiplier = Math.min(resolvedPaths.length, 2); // Cap at 2x for very large file counts
    await waitForMultipleFileUploadConfirmation(page, resolvedPaths.length, waitTimeMultiplier);
    
    // Take a verification screenshot
    await ScreenshotManager.takeScreenshot(
      page, 
      'upload-complete-multiple', 
      false,  // Not full page
      false   // Don't log to console
    );
    
    uploadLogger.success(`All ${resolvedPaths.length} files uploaded successfully`);
    return true;
  } catch (error) {
    uploadLogger.error('Failed during file upload', error);
    await ScreenshotManager.takeErrorScreenshot(page, 'upload-error-multiple');
    throw new Error(`File upload failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Wait for multiple file upload confirmation indicators
 * Scaled waiting times based on file count
 */
async function waitForMultipleFileUploadConfirmation(page: Page, fileCount: number, waitTimeMultiplier: number = 1): Promise<boolean> {
  // Check for specific loading indicators and wait for them to disappear
  const loadingIndicators = [
    '[role="progressbar"]',
    '.animate-spin',
    '[aria-busy="true"]',
    // Specific SVG circle loading animation in ChatGPT
    'circle[stroke-dashoffset][stroke-dasharray]',
    'circle.origin-\\[50\\%_50\\%\\].-rotate-90'
  ];
  
  try {
    // Check if any loading indicators are present
    const hasLoadingIndicator = await page.evaluate((selectors) => {
      return selectors.some(selector => document.querySelector(selector) !== null);
    }, loadingIndicators);
    
    // If we find loading indicators, wait for them to disappear
    if (hasLoadingIndicator) {
      uploadLogger.debug('Found loading indicators, waiting for them to disappear...');
      
      // Scale the timeout based on the number of files but with significantly reduced base time
      const loadingTimeout = 30000 * Math.min(waitTimeMultiplier, 2); 
      uploadLogger.debug(`Using ${loadingTimeout/1000}s timeout for loading indicators`);

      // Wait for specific loading animation to disappear
      await page.waitForFunction(
        (selectors) => {
          // Check if any of the loading indicators are present
          for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el) {
              // For the circle animation specifically, check if it's actively animating
              if (selector.includes('circle') && 
                  el instanceof SVGElement && 
                  el.getAttribute('stroke-dashoffset')) {
                return false;
              }
              
              // For other generic loading indicators
              return false;
            }
          }
          return true;
        },
        { timeout: loadingTimeout }, 
        loadingIndicators
      );
      
      uploadLogger.debug('All loading indicators have disappeared');
    }
  } catch (e) {
    // If waiting times out, log a warning but continue
    uploadLogger.debug('Loading indicators did not disappear within the timeout, continuing anyway');
  }
  
  // Now check for file indicators without throwing errors
  let uploadConfirmed = false;
  
  try {
    // Wait for thumbnails or file indicators to appear
    // Scale the timeout based on the number of files but with reduced base time
    const indicatorTimeout = 15000 * Math.min(waitTimeMultiplier, 2);
    uploadLogger.debug(`Using ${indicatorTimeout/1000}s timeout for file indicators`);
    
    await page.waitForFunction((expectedCount) => {
      // Check first if any loading indicators are still visible - if so, uploads not complete
      const loadingSpinner = document.querySelector('circle[stroke-dashoffset][stroke-dasharray]');
      if (loadingSpinner) {
        return false;
      }
      
      // Look for file thumbnails or file indicators (expanded selector list)
      const possibleElements = [
        // File thumbnails
        document.querySelectorAll('img[alt*="thumbnail"]'),
        // File names in the UI
        document.querySelectorAll('div[role="button"]'),
        // Additional possible indicators
        document.querySelectorAll('[data-testid*="attachment"]'),
        document.querySelectorAll('[data-testid*="file"]'),
        document.querySelectorAll('img[alt*="Image"]')
      ];
      
      // For multiple files, ideally we should see multiple indicators
      // But sometimes the UI collapses them, so we'll accept any visible indicator
      let foundSomeIndicators = possibleElements.some(collection => collection.length > 0);
      
      return foundSomeIndicators;
    }, { timeout: indicatorTimeout }, fileCount);
    
    uploadLogger.debug('File uploads confirmed - found file indicators in the UI');
    uploadConfirmed = true;
  } catch (e) {
    // Don't log the error, just note that we couldn't confirm
    uploadLogger.debug('Could not confirm all file uploads through UI indicators, continuing anyway');
  }
  
  // Only short additional wait needed
  const finalWaitTime = Math.min(3000 * waitTimeMultiplier, 8000);
  uploadLogger.debug(`Waiting additional ${finalWaitTime/1000}s to ensure all uploads are processed`);
  await new Promise(res => setTimeout(res, finalWaitTime));
  
  return uploadConfirmed;
}

/**
 * Uploads a file to the ChatGPT conversation.
 * @param page Puppeteer page instance
 * @param filePath Path to the file to upload
 */
export async function uploadAttachment(page: Page, filePath: string) {
  // Process the file path to handle spaces and special characters
  let processedPath;
  try {
    // Normalize path to handle spaces and special characters
    processedPath = decodeURIComponent(filePath.trim()).replace(/\\/g, '');
  } catch (e) {
    processedPath = filePath.trim();
  }
  
  // Check if file exists
  try {
    if (!fs.existsSync(processedPath)) {
      uploadLogger.error(`File not found: ${processedPath}`);
      throw new Error(`File not found: ${processedPath}`);
    }
  } catch (e) {
    throw new Error(`Error checking file: ${processedPath} - ${e instanceof Error ? e.message : String(e)}`);
  }
  
  // Get file stats
  const stats = fs.statSync(processedPath);
  uploadLogger.info(`Starting upload for: ${processedPath} (${stats.size} bytes)`);
  
  // Take a screenshot of the current state
  await ScreenshotManager.takeScreenshot(page, 'before-upload-start', false, false);
  
  // 1. Click the "Upload files and more" button
  const uploadButtonSelector = 'button[aria-label="Upload files and more"]';
  try {
    // Wait for upload button with reduced timeout
    await page.waitForSelector(uploadButtonSelector, { timeout: 20000, visible: true });
    
    // Use more reliable click method
    try {
      // Ensure button is in viewport
      await page.evaluate((selector) => {
        const button = document.querySelector(selector);
        if (button) button.scrollIntoView({behavior: 'smooth', block: 'center'});
      }, uploadButtonSelector);
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Use a more reliable click method
      await page.evaluate((selector) => {
        const button = document.querySelector(selector);
        if (button && button instanceof HTMLElement) {
          button.click();
          return true;
        }
        return false;
      }, uploadButtonSelector);
      
      uploadLogger.debug('Clicked "Upload files and more" button using evaluate');
    } catch (evalError) {
      // Fall back to regular click if evaluate fails
      uploadLogger.debug('Fallback to regular click method');
      await page.click(uploadButtonSelector);
    }
    
    // Wait shorter for the menu to appear
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (error) {
    uploadLogger.error('Failed to click "Upload files and more" button', error);
    await ScreenshotManager.takeErrorScreenshot(page, 'upload-button-failure');
    throw new Error(`Upload button not found: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 2. Wait for the "Upload from computer" option and click it
  uploadLogger.debug('Looking for "Upload from computer" option');
  
  // First, try optimized direct file input access - this may skip needing to click "Upload from computer"
  let fileInputFound = false;
  try {
    // Some chat interfaces expose the file input directly
    const fileInputSelector = 'input[type="file"]';
    const fileInput = await page.$(fileInputSelector);
    if (fileInput) {
      uploadLogger.debug('File input found directly without needing to click upload option');
      fileInputFound = true;
    }
  } catch (e) {
    // Continue to normal flow if direct access fails
  }

  if (!fileInputFound) {
    try {
      // Take a screenshot to help with debugging if needed
      await ScreenshotManager.takeScreenshot(page, 'upload-menu', false, false);
      
      // Try different methods to find the upload option with increased timeouts
      let clicked = false;
      
      // Method 0: Try finding by selector that might contain the upload button text
      try {
        await page.waitForSelector('div[role="menuitem"]', { timeout: 3000 });
        const menuItems = await page.$$('div[role="menuitem"]');
        for (const item of menuItems) {
          const text = await item.evaluate(el => el.textContent || '');
          if (text.includes('Upload') && text.includes('computer')) {
            await item.click();
            clicked = true;
            uploadLogger.debug('Clicked "Upload from computer" via menu item selector');
            break;
          }
        }
      } catch (e) {
        uploadLogger.debug('Failed to find menu item by role selector');
      }
      
      // Method 1: Try finding by visible text content
      if (!clicked) {
        try {
          // Use evaluate to find the element by text
          const found = await page.evaluate(() => {
            const uploadText = 'Upload from computer';
            // Try various element types that might be used for menu items
            const elements = Array.from(document.querySelectorAll('div, span, button, a, li'));
            
            // Find elements containing the text
            const matches = elements.filter(el => {
              const text = el.textContent?.trim() || '';
              return text.includes('Upload') && text.includes('computer');
            });
            
            // Get the most likely menu item (smaller element that contains the text exactly)
            const exactMatches = matches.filter(el => el.textContent?.trim() === uploadText);
            
            // Click the exact match or the first containing match
            const bestMatch = exactMatches.length > 0 ? exactMatches[0] : matches[0];
            if (bestMatch) {
              // Navigate up a few levels to try to find the clickable parent
              let clickTarget = bestMatch;
              let levels = 0;
              // Try up to 3 parent levels to find a clickable element
              while (clickTarget && levels < 3) {
                // Use the HTMLElement click method (TypeScript safe)
                if (clickTarget instanceof HTMLElement) {
                  clickTarget.click();
                }
                // Check if we've clicked successfully (new elements should appear)
                if (document.querySelector('input[type="file"]')) {
                  return true;
                }
                
                // Move to parent, but only if it's an Element
                const parent = clickTarget.parentElement;
                if (!parent) break;
                
                clickTarget = parent;
                levels++;
              }
            }
            return false;
          });
          
          if (found) {
            clicked = true;
            uploadLogger.debug('Clicked "Upload from computer" via text content evaluation');
          }
        } catch (e) {
          uploadLogger.debug('Failed to click by text content evaluation');
        }
      }
      
      // Skip keyboard navigation and position clicking for speed - they're fallbacks
      // that often don't work as well and add delay
      
      if (!clicked) {
        uploadLogger.warn('Could not find or click "Upload from computer" option using standard methods');
      }
      
      // Wait shorter for the file input to appear
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      uploadLogger.error('Failed to select "Upload from computer"', error);
      await ScreenshotManager.takeErrorScreenshot(page, 'upload-menu-error');
      throw new Error(`Could not select "Upload from computer": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 3. Wait for the file input to appear and set the file
  uploadLogger.debug('Looking for file input');
  try {
    const fileInputSelector = 'input[type="file"]';
    // Reduced timeout
    await page.waitForSelector(fileInputSelector, { timeout: 10000 });
    
    const inputUploadHandle = await page.$(fileInputSelector);
    if (!inputUploadHandle) {
      throw new Error('File input not found');
    }
    
    // Resolve the absolute file path
    const resolvedPath = path.resolve(processedPath);
    uploadLogger.info(`Uploading file: ${resolvedPath}`);
    
    // Double check file exists after path resolution
    if (!fs.existsSync(resolvedPath)) {
      uploadLogger.error(`File does not exist after path resolution: ${resolvedPath}`);
      throw new Error(`File not found after path resolution: ${resolvedPath}`);
    }
    
    // Using a raw file path for uploadFile which might work better with spaces
    uploadLogger.debug(`Using resolved path: ${resolvedPath}`);
    await inputUploadHandle.uploadFile(resolvedPath);
    uploadLogger.debug('File uploaded to input');
    
    // Wait for upload to complete without noisy error logs
    uploadLogger.info('Waiting for upload to complete...');
    
    // Wait for file upload indicators without using try/catch that logs errors
    await waitForFileUploadConfirmation(page);
    
    // Take a verification screenshot
    const screenshotPath = await ScreenshotManager.takeScreenshot(
      page, 
      'upload-complete', 
      false,  // Not full page
      false   // Don't log to console
    );
    uploadLogger.debug(`Upload verification screenshot saved`);
    
    uploadLogger.success('File upload complete');
    
  } catch (error) {
    uploadLogger.error('Failed during file upload', error);
    await ScreenshotManager.takeErrorScreenshot(page, 'upload-error');
    throw new Error(`File upload failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Wait for file upload confirmation indicators without throwing errors
 * This is a separate function to make the code cleaner and avoid noisy logs
 */
async function waitForFileUploadConfirmation(page: Page): Promise<boolean> {
  // First check for any loading indicators and wait for them to disappear
  const loadingIndicators = [
    '[role="progressbar"]',
    '.animate-spin',
    '[aria-busy="true"]',
    // Specific SVG circle loading animation in ChatGPT
    'circle[stroke-dashoffset][stroke-dasharray]',
    'circle.origin-\\[50\\%_50\\%\\].-rotate-90'
  ];
  
  try {
    // Check if any loading indicators are present
    const hasLoadingIndicator = await page.evaluate((selectors) => {
      return selectors.some(selector => document.querySelector(selector) !== null);
    }, loadingIndicators);
    
    // If we find loading indicators, wait for them to disappear
    if (hasLoadingIndicator) {
      uploadLogger.debug('Found loading indicator, waiting for it to disappear...');
      
      // Reduced timeout from 60s to 20s
      await page.waitForFunction(
        (selectors) => {
          // Check if any of the loading indicators are present
          for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el) {
              return false; // Still loading
            }
          }
          return true; // No loading indicators found
        },
        { timeout: 20000 }, 
        loadingIndicators
      );
      
      uploadLogger.debug('Loading indicator has disappeared');
    }
  } catch (e) {
    // If waiting times out, log a warning but continue
    uploadLogger.debug('Loading indicator did not disappear within the timeout, continuing anyway');
  }
  
  // Now check for file indicators without throwing errors
  let uploadConfirmed = false;
  
  try {
    // Reduced timeout from 30s to 10s
    await page.waitForFunction(() => {
      // Check first if any loading indicators are still visible
      const loadingSpinner = document.querySelector('circle[stroke-dashoffset][stroke-dasharray]');
      if (loadingSpinner) {
        return false; // Still loading
      }
      
      // Look for file thumbnails or file indicators (expanded selector list)
      const possibleElements = [
        // File thumbnails
        document.querySelectorAll('img[alt*="thumbnail"]'),
        // File names in the UI
        document.querySelectorAll('div[role="button"]'),
        // Additional possible indicators
        document.querySelectorAll('[data-testid*="attachment"]'),
        document.querySelectorAll('[data-testid*="file"]'),
        document.querySelectorAll('img')
      ];
      
      // Check if we have any of these elements
      return possibleElements.some(collection => collection.length > 0);
    }, { timeout: 10000 });
    
    uploadLogger.debug('File upload confirmed - found file indicator in the UI');
    uploadConfirmed = true;
  } catch (e) {
    // Don't log the error, just note that we couldn't confirm
    uploadLogger.debug('Could not confirm file upload through UI indicators, continuing anyway');
  }
  
  // Always wait 2 seconds (reduced from 5s) to be safe
  await new Promise(res => setTimeout(res, 2000));
  
  return uploadConfirmed;
} 
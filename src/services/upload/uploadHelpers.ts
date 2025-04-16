import { Page } from 'puppeteer';
import { uploadLogger } from '../../utils/logger';
import { ScreenshotManager } from '../../utils/screenshot';
import { SELECTORS } from '../../utils/types';
import { clickButton } from '../../utils/ui/uiHelpers';
import { waitForLoadingToComplete, waitForFileIndicators } from '../../utils/ui/waitHelpers';

/**
 * Opens the upload menu by clicking the upload button
 */
export async function openUploadMenu(page: Page, timeout: number = 20000): Promise<boolean> {
  try {
    // Take a screenshot of the initial state
    await ScreenshotManager.takeScreenshot(page, 'before-upload-button-click', false, false);
    
    // Wait for upload button
    await page.waitForSelector(SELECTORS.UPLOAD_BUTTON, { timeout, visible: true });
    
    // Ensure button is in viewport
    await page.evaluate((selector) => {
      const button = document.querySelector(selector);
      if (button) button.scrollIntoView({behavior: 'smooth', block: 'center'});
    }, SELECTORS.UPLOAD_BUTTON);
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Click the button
    const clicked = await clickButton(page, SELECTORS.UPLOAD_BUTTON, 2);
    if (!clicked) {
      throw new Error('Failed to click upload button');
    }
    
    // Wait for the menu to appear
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Take screenshot of menu
    await ScreenshotManager.takeScreenshot(page, 'upload-menu-opened', false, false);
    
    return true;
  } catch (error) {
    uploadLogger.error('Failed to click "Upload files and more" button', error);
    await ScreenshotManager.takeErrorScreenshot(page, 'upload-button-failure');
    throw new Error(`Upload button not found: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get file input element or click the upload from computer option
 */
export async function getFileInput(page: Page, timeout: number = 10000): Promise<any> {
  // Look for "Upload from computer" option
  uploadLogger.debug('Looking for "Upload from computer" option');
  
  // First, try direct file input access
  try {
    const fileInputSelector = SELECTORS.FILE_INPUT;
    const fileInput = await page.$(fileInputSelector);
    if (fileInput) {
      uploadLogger.debug('File input found directly without needing to click upload option');
      return fileInput;
    }
  } catch (e) {
    // Continue to normal flow if direct access fails
  }

  // Try clicking "Upload from computer" option
  try {
    await clickUploadFromComputerOption(page);
    
    // Wait for the file input to appear
    uploadLogger.debug('Looking for file input');
    const fileInputSelector = SELECTORS.FILE_INPUT;
    await page.waitForSelector(fileInputSelector, { timeout });
    
    const inputUploadHandle = await page.$(fileInputSelector);
    if (!inputUploadHandle) {
      throw new Error('File input not found');
    }
    
    return inputUploadHandle;
  } catch (error) {
    uploadLogger.error('Failed to get file input', error);
    await ScreenshotManager.takeErrorScreenshot(page, 'file-input-error');
    throw new Error(`File input not found: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Click the "Upload from computer" option in the menu
 */
export async function clickUploadFromComputerOption(page: Page): Promise<boolean> {
  let clicked = false;
  
  // Method 1: Try finding by menu item role
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
  
  // Method 2: Try finding by visible text content
  if (!clicked) {
    try {
      // Use evaluate to find the element by text
      const found = await page.evaluate(() => {
        const uploadText = 'Upload from computer';
        const elements = Array.from(document.querySelectorAll('div, span, button, a, li'));
        
        // Find elements containing the text
        const matches = elements.filter(el => {
          const text = el.textContent?.trim() || '';
          return text.includes('Upload') && text.includes('computer');
        });
        
        // Get the most likely menu item
        const exactMatches = matches.filter(el => el.textContent?.trim() === uploadText);
        
        // Click the exact match or the first containing match
        const bestMatch = exactMatches.length > 0 ? exactMatches[0] : matches[0];
        if (bestMatch) {
          // Navigate up a few levels to find the clickable parent
          let clickTarget = bestMatch;
          let levels = 0;
          while (clickTarget && levels < 3) {
            if (clickTarget instanceof HTMLElement) {
              clickTarget.click();
            }
            
            if (document.querySelector('input[type="file"]')) {
              return true;
            }
            
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
  
  if (!clicked) {
    uploadLogger.warn('Could not find or click "Upload from computer" option using standard methods');
  }
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  return clicked;
}

/**
 * Upload files to the input
 */
export async function uploadFiles(page: Page, fileInput: any, filePaths: string[]): Promise<void> {
  try {
    // Log the files being uploaded
    uploadLogger.info(`Uploading ${filePaths.length} files at once:`);
    filePaths.forEach((filePath, index) => {
      uploadLogger.debug(`  ${index+1}. ${filePath}`);
    });
    
    // Upload all files at once
    await fileInput.uploadFile(...filePaths);
    uploadLogger.info('All files submitted to input');
  } catch (error) {
    uploadLogger.error('Failed to upload files', error);
    throw new Error(`File upload failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Waits for file upload to complete
 */
export async function waitForUploadToComplete(
  page: Page, 
  fileCount: number = 1, 
  waitTimeMultiplier: number = 1
): Promise<boolean> {
  // First wait for loading indicators to disappear
  await waitForLoadingToComplete(
    page, 
    undefined, 
    30000 * Math.min(waitTimeMultiplier, 2)
  );
  
  // Then wait for file indicators to appear
  const uploadConfirmed = await waitForFileIndicators(
    page,
    15000 * Math.min(waitTimeMultiplier, 2),
    fileCount
  );
  
  // Final wait to ensure all processing is complete
  const finalWaitTime = Math.min(3000 * waitTimeMultiplier, 8000);
  uploadLogger.debug(`Waiting additional ${finalWaitTime/1000}s to ensure all uploads are processed`);
  await new Promise(res => setTimeout(res, finalWaitTime));
  
  return uploadConfirmed;
} 
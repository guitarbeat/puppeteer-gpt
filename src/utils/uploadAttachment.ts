import { Page } from 'puppeteer';
import path from 'path';
import fs from 'fs';

/**
 * Uploads a file to the ChatGPT conversation.
 * @param page Puppeteer page instance
 * @param filePath Path to the file to upload
 */
export async function uploadAttachment(page: Page, filePath: string) {
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  
  console.log(`Starting upload for: ${filePath}`);
  
  // 1. Click the "Upload files and more" button
  const uploadButtonSelector = 'button[aria-label="Upload files and more"]';
  try {
    await page.waitForSelector(uploadButtonSelector, { timeout: 10000 });
    await page.click(uploadButtonSelector);
    console.log('Clicked "Upload files and more" button');
    
    // Wait a bit for the menu to appear
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (error) {
    console.error('Failed to click "Upload files and more" button:', error);
    throw new Error(`Upload button not found: ${error}`);
  }

  // 2. Wait for the "Upload from computer" option and click it
  console.log('Looking for "Upload from computer" option');
  try {
    // Take a screenshot to see what's happening
    const menuScreenshotPath = `screenshots/upload-menu-${Date.now()}.png`;
    await page.screenshot({ path: menuScreenshotPath });
    console.log(`Menu screenshot saved to ${menuScreenshotPath}`);
    
    // Try different methods to find the upload option
    let clicked = false;
    
    // Method 1: Try finding by visible text content
    try {
      // Use JavaScript evaluation to find elements by text content
      const elementHandle = await page.evaluateHandle((text) => {
        // Find all elements that might be in a dropdown
        const elements = Array.from(document.querySelectorAll('div, span, button, a, li'));
        // Find the one with the exact text
        return elements.find(el => 
          el.textContent?.trim() === text || 
          el.textContent?.trim() === text
        );
      }, 'Upload from computer');
      
      // Check if element was found and is not undefined
      const isNullish = await page.evaluate(el => el === null || el === undefined, elementHandle);
      if (!isNullish) {
        console.log('Found "Upload from computer" element by text content');
        // Cast to ElementHandle<Element> since we know it's not null/undefined
        await (elementHandle as any).click();
        clicked = true;
        console.log('Clicked element');
        await elementHandle.dispose();
      }
    } catch (e) {
      console.log('Failed to click by text content:', e);
    }
    
    // Method 2: Try evaluating for elements by role
    if (!clicked) {
      try {
        // Look for any element with a role that contains the text
        const menuItems = await page.$$('div[role], button[role], li[role]');
        for (const item of menuItems) {
          const text = await item.evaluate(el => el.textContent || '');
          if (text.includes('Upload from computer')) {
            await item.click();
            clicked = true;
            console.log('Clicked menu item by role with upload text');
            break;
          }
        }
      } catch (e) {
        console.log('Failed to click by role selector:', e);
      }
    }
    
    // Method 3: Try direct click by position/coordinates as a last resort
    if (!clicked) {
      // Get the position of the upload button which we clicked earlier
      const uploadButton = await page.$(uploadButtonSelector);
      if (uploadButton) {
        const boundingBox = await uploadButton.boundingBox();
        if (boundingBox) {
          // Click slightly below the upload button (where the first menu item usually is)
          const x = boundingBox.x + boundingBox.width / 2;
          const y = boundingBox.y + boundingBox.height + 40; // Menu item is usually 30-50px below
          
          console.log(`Trying click at coordinates: (${x}, ${y})`);
          await page.mouse.click(x, y);
          clicked = true;
          console.log('Clicked at estimated menu position');
        }
      }
    }
    
    if (!clicked) {
      throw new Error('Could not find or click "Upload from computer" option');
    }
    
    // Wait for the file input to appear after successful click
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (error) {
    console.error('Failed to select "Upload from computer":', error);
    
    // Take a screenshot to debug
    const screenshotPath = `screenshots/upload-menu-error-${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath });
    console.log(`Screenshot saved to ${screenshotPath}`);
    
    throw new Error(`Could not select "Upload from computer": ${error}`);
  }

  // 3. Wait for the file input to appear and set the file
  console.log('Looking for file input');
  try {
    const fileInputSelector = 'input[type="file"]';
    await page.waitForSelector(fileInputSelector, { timeout: 10000 });
    
    const inputUploadHandle = await page.$(fileInputSelector);
    if (!inputUploadHandle) {
      throw new Error('File input not found');
    }
    
    const resolvedPath = path.resolve(filePath);
    console.log(`Uploading file: ${resolvedPath}`);
    await inputUploadHandle.uploadFile(resolvedPath);
    console.log('File uploaded to input');
    
    // Wait for upload to complete - look for a visual indicator that upload is done
    console.log('Waiting for upload to complete...');
    
    // Wait a bit longer to be sure
    await new Promise(res => setTimeout(res, 3000));
    
    // Take a verification screenshot
    const screenshotPath = `screenshots/upload-complete-${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath });
    console.log(`Upload verification screenshot saved to ${screenshotPath}`);
    
    console.log('File upload complete');
    
  } catch (error) {
    console.error('Failed during file upload:', error);
    throw new Error(`File upload failed: ${error}`);
  }
} 
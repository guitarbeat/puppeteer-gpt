import { Page } from 'puppeteer';
import path from 'path';

/**
 * Uploads a file to the ChatGPT conversation.
 * @param page Puppeteer page instance
 * @param filePath Path to the file to upload
 */
export async function uploadAttachment(page: Page, filePath: string) {
  // 1. Click the "Upload files and more" button
  const uploadButtonSelector = 'button[aria-label="Upload files and more"]';
  await page.waitForSelector(uploadButtonSelector, { timeout: 10000 });
  await page.click(uploadButtonSelector);

  // 2. Wait for the "Upload from computer" option and click it
  // This may be a menu item or a button with visible text
  // We'll try a text selector and a fallback
  const uploadFromComputerSelector = 'text/Upload from computer';
  try {
    await page.waitForSelector(uploadFromComputerSelector, { timeout: 5000 });
    await page.click(uploadFromComputerSelector);
  } catch {
    // Fallback: try to find a menu div with the text
    const menuItems = await page.$$('div[role="menuitem"], div');
    for (const item of menuItems) {
      const text = await item.evaluate(el => el.textContent || '');
      if (text.includes('Upload from computer')) {
        await item.click();
        break;
      }
    }
  }

  // 3. Wait for the file input to appear and set the file
  // The input may be inside a dialog or appended to the body
  const fileInputSelector = 'input[type="file"]';
  await page.waitForSelector(fileInputSelector, { timeout: 5000 });
  const inputUploadHandle = await page.$(fileInputSelector);
  if (!inputUploadHandle) throw new Error('File input not found');

  // Set the file to upload
  await inputUploadHandle.uploadFile(path.resolve(filePath));

  // Optionally, wait for the upload to complete (look for a progress bar or attachment preview)
  // For now, add a short delay
  await new Promise(res => setTimeout(res, 2000));
} 
import { Page } from 'puppeteer';
import { uploadAttachment, uploadMultipleAttachments } from './uploadAttachment';
import { uploadLogger } from './logger';
import { ScreenshotManager } from './screenshot';
import path from 'path';
import fs from 'fs';

// Project URL to return to after each conversation
const PROJECT_URL = 'https://chat.openai.com/g/g-p-67f02dae3f508191856fe6de977dadb4-bme-349-hw4/project';

/**
 * Sends a message to ChatGPT, optionally followed by attachments.
 * First enters the text, then uploads attachments if any, then sends the message.
 * @param page Puppeteer page instance
 * @param message The message to send
 * @param attachments Array of file paths to upload (optional)
 * @param useMultiUpload Whether to try uploading all files at once (true) or one by one (false)
 * @param returnToProjectPage Whether to navigate back to the project URL after getting a response
 * @returns The assistant's response text
 */
export async function sendMessageWithAttachments(
  page: Page,
  message: string,
  attachments: string[] = [],
  useMultiUpload: boolean = true,
  returnToProjectPage: boolean = true
): Promise<string> {
  // 1. Enter the message text (but don't send it yet)
  uploadLogger.info(`Preparing message: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);
  await enterTextMessage(page, message);
  
  // 2. Handle attachments if there are any
  if (attachments.length > 0) {
    uploadLogger.info(`Adding ${attachments.length} attachment(s) before sending`);
    await uploadAttachments(page, attachments, useMultiUpload);
  } else {
    uploadLogger.info("No attachments to upload");
  }
  
  // 3. Now send the message
  uploadLogger.info("Sending message with any attachments");
  await clickSendButton(page, '#prompt-textarea');
  
  // 4. Get the assistant's response
  return await waitForResponse(page, returnToProjectPage);
}

/**
 * Enters the text message in ChatGPT's textarea (without sending)
 */
async function enterTextMessage(page: Page, message: string): Promise<void> {
  const promptSelector = '#prompt-textarea';
  try {
    // Wait for the textarea to be available
    await page.waitForSelector(promptSelector, { timeout: 15000 });
    
    // Take a screenshot before input
    await ScreenshotManager.takeScreenshot(page, 'before-text-input', false, false);
    
    // Use a simple, reliable method: click, wait, then type
    await page.click(promptSelector);
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Clear existing text (if any)
    await page.evaluate((selector) => {
      const element = document.querySelector(selector) as HTMLTextAreaElement;
      if (element) {
        element.value = '';
      }
    }, promptSelector);
    
    // Type the message
    await page.type(promptSelector, message, { delay: 1 });
    
    // Take a screenshot to verify visually that text was entered
    await ScreenshotManager.takeScreenshot(page, 'after-text-input', false, false);
    
    // Verify text was entered correctly, but don't fail if empty (it might be visually there)
    try {
      const inputValue = await page.$eval(promptSelector, (el: any) => el.value);
      uploadLogger.debug(`Textarea value: "${inputValue?.substring(0, 30)}${inputValue?.length > 30 ? '...' : ''}" (${inputValue?.length || 0} chars)`);
      
      if (!inputValue || inputValue.trim() === '') {
        uploadLogger.warn('Warning: Textarea value appears empty in DOM, but text may still be visually entered');
      }
    } catch (valError) {
      uploadLogger.warn('Could not check textarea value', valError);
    }
    
    // Try a different approach to ensure text is entered if needed
    await page.evaluate((selector, text) => {
      // Set a data attribute to track that we tried to set the text
      const textarea = document.querySelector(selector) as HTMLTextAreaElement;
      if (textarea) {
        textarea.dataset.textSet = "true";
        
        // Also try dispatch events to ensure text input is recognized
        const inputEvent = new Event('input', { bubbles: true });
        textarea.dispatchEvent(inputEvent);
      }
    }, promptSelector, message);
    
    uploadLogger.success('Message text entered (not sent yet)');
  } catch (error) {
    uploadLogger.error('Failed to enter message text', error);
    throw new Error(`Could not enter message text: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Clicks the send button to send the message
 */
async function clickSendButton(page: Page, promptSelector: string): Promise<void> {
  const btnSend = "[data-testid='send-button']";
  
  // Make multiple attempts to find the send button
  let sendButtonFound = false;
  let attempts = 0;
  
  while (!sendButtonFound && attempts < 5) { // Increased from 3 to 5 attempts
    attempts++;
    try {
      await page.waitForSelector(btnSend, { timeout: 10000 });
      sendButtonFound = true;
      uploadLogger.debug(`Send button found on attempt ${attempts}`);
    } catch (e) {
      uploadLogger.warn(`Attempt ${attempts}: Send button not found. Waiting...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      // Take a screenshot each time to track what's happening
      await ScreenshotManager.takeScreenshot(page, `send-button-attempt-${attempts}`, false, false);
      
      // Check if the send button is visible but not matching our selector
      const altButtons = await page.$$eval('button', (buttons) => {
        return buttons
          .filter(btn => {
            const rect = btn.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && 
                   (btn.textContent?.includes('Send') || 
                    btn.innerHTML.includes('send') || 
                    btn.innerHTML.includes('arrow'));
          })
          .map(btn => ({
            id: btn.id,
            classList: Array.from(btn.classList),
            text: btn.textContent,
            hasArrowIcon: btn.innerHTML.includes('arrow')
          }));
      });
      
      if (altButtons.length > 0) {
        uploadLogger.info(`Found ${altButtons.length} potential send buttons with different selectors`);
        // Try clicking the most likely alternative button
        try {
          // Look for a button with an arrow icon first
          let buttonSelector = 'button';
          if (altButtons.some(b => b.hasArrowIcon)) {
            buttonSelector = 'button:has(svg)';
          } else if (altButtons.some(b => b.text?.includes('Send'))) {
            buttonSelector = 'button:contains("Send")';
          }
          
          await page.evaluate((selector) => {
            const buttons = Array.from(document.querySelectorAll(selector));
            const sendBtn = buttons.find(b => 
              b.innerHTML.includes('arrow') || 
              b.textContent?.includes('Send')
            );
            if (sendBtn && sendBtn instanceof HTMLElement) sendBtn.click();
          }, buttonSelector);
          
          uploadLogger.info('Clicked an alternative send button');
          sendButtonFound = true;
          break;
        } catch (clickErr) {
          uploadLogger.warn('Failed to click alternative button', clickErr);
        }
      }
    }
  }
  
  if (!sendButtonFound) {
    throw new Error('Send button not found after multiple attempts');
  }
  
  // Check if the textarea has visible content (without throwing error)
  try {
    const textareaContent = await page.$eval(promptSelector, (el: any) => el.value);
    if (!textareaContent || textareaContent.length === 0) {
      uploadLogger.warn('⚠️ Warning: Textarea value is empty in DOM, but may still have visual content');
      // Take a screenshot of the current state to verify visually
      await ScreenshotManager.takeScreenshot(page, 'textarea-empty-before-send', true, false);
    } else {
      uploadLogger.debug(`Verified text in textarea (${textareaContent.length} chars): "${textareaContent.substring(0, 30)}..."`);
    }
  } catch (e) {
    uploadLogger.warn('Error checking textarea content', e);
  }
  
  // Check if button is disabled or not present
  let isButtonEnabled = false;
  try {
    isButtonEnabled = await page.evaluate((selector) => {
      const btn = document.querySelector(selector) as HTMLButtonElement;
      return btn && !btn.hasAttribute('disabled') && !btn.disabled;
    }, btnSend);
    
    if (!isButtonEnabled) {
      uploadLogger.warn('Send button is disabled or not clickable');
      
      // Check if it's because the text wasn't recognized
      await page.evaluate((textareaSelector) => {
        // Try to trigger input events on the textarea to get send button to enable
        const textarea = document.querySelector(textareaSelector) as HTMLTextAreaElement;
        if (textarea) {
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, promptSelector);
      
      // Wait a bit for the button to enable
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check again if it's enabled
      isButtonEnabled = await page.evaluate((selector) => {
        const btn = document.querySelector(selector) as HTMLButtonElement;
        return btn && !btn.hasAttribute('disabled') && !btn.disabled;
      }, btnSend);
      
      if (isButtonEnabled) {
        uploadLogger.info('Send button is now enabled after triggering events');
      } else {
        uploadLogger.warn('Send button is still disabled, trying to click anyway');
      }
    }
  } catch (e) {
    uploadLogger.warn('Error checking if button is disabled, proceeding anyway', e);
  }
  
  // Finally click the send button
  try {
    await page.click(btnSend);
    uploadLogger.debug('Clicked send button');
  } catch (clickError) {
    uploadLogger.warn('Failed to click send button with selector, trying JavaScript click', clickError);
    
    // Try clicking with JavaScript as a fallback
    await page.evaluate((selector) => {
      const button = document.querySelector(selector);
      if (button && button instanceof HTMLElement) button.click();
    }, btnSend);
    
    uploadLogger.debug('Used JavaScript to click send button');
  }
  
  // Verify the message was actually sent by checking for input field changes
  try {
    // Wait to see if the send button becomes disabled (indicating sending)
    await page.waitForFunction(
      (selector) => {
        const btn = document.querySelector(selector) as HTMLButtonElement;
        return !btn || btn.disabled || btn.hasAttribute('disabled');
      },
      { timeout: 5000 },
      btnSend
    );
    uploadLogger.debug('Send button became disabled (message sending)');
  } catch (e) {
    uploadLogger.warn('Could not verify if message was sent', e);
    // Continue anyway - we'll check for a response later
  }
}

/**
 * Uploads attachments to the ongoing conversation
 * First tries to upload all at once, then falls back to one-by-one if needed
 */
async function uploadAttachments(page: Page, attachments: string[], useMultiUpload: boolean): Promise<void> {
  // First verify all attachments exist and normalize paths
  const validAttachments = attachments.filter(filePath => {
    try {
      const normalizedPath = decodeURIComponent(filePath.trim());
      const exists = fs.existsSync(normalizedPath);
      if (!exists) {
        uploadLogger.error(`File does not exist: ${normalizedPath}`);
      } else {
        // Log file information
        try {
          const stats = fs.statSync(normalizedPath);
          uploadLogger.debug(`File verified: ${normalizedPath} (${stats.size} bytes)`);
        } catch (err) {
          uploadLogger.warn(`Error checking file stats: ${normalizedPath}`, err);
        }
      }
      return exists;
    } catch (e) {
      uploadLogger.error(`Error processing file path: ${filePath}`, e);
      return false;
    }
  });
  
  if (validAttachments.length === 0) {
    uploadLogger.warn('No valid attachments found. All file paths are invalid or inaccessible.');
    return;
  }
  
  // Remove any duplicate paths
  const uniqueAttachments = [...new Set(validAttachments)];
  
  if (uniqueAttachments.length < validAttachments.length) {
    uploadLogger.info(`Removed ${validAttachments.length - uniqueAttachments.length} duplicate attachment paths`);
  }
  
  uploadLogger.info(`Uploading ${uniqueAttachments.length} attachment(s)...`);
  
  // Try multi-upload first if enabled and there are multiple files
  let multiUploadSuccess = false;
  
  if (useMultiUpload && uniqueAttachments.length > 1) {
    uploadLogger.info("Attempting to upload all files at once...");
    try {
      await uploadMultipleAttachments(page, uniqueAttachments);
      uploadLogger.success(`Successfully uploaded ${uniqueAttachments.length} files at once`);
      multiUploadSuccess = true;
    } catch (error) {
      uploadLogger.warn("Multi-upload failed, falling back to individual uploads", error);
    }
  }
  
  // If multi-upload failed or wasn't attempted, upload files individually
  if (!multiUploadSuccess) {
    uploadLogger.info("Uploading files individually...");
    const uploadedPaths = new Set<string>();
    
    for (const filePath of uniqueAttachments) {
      // Check for duplicates
      const resolvedPath = path.resolve(decodeURIComponent(filePath.trim()));
      if (uploadedPaths.has(resolvedPath)) {
        uploadLogger.warn(`Skipping duplicate file: ${resolvedPath}`);
        continue;
      }
      
      try {
        await uploadAttachment(page, filePath);
        uploadLogger.success(`Uploaded: ${filePath}`);
        uploadedPaths.add(resolvedPath);
        
        // Wait a moment between uploads to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (error) {
        uploadLogger.error(`Failed to upload ${filePath}`, error);
        // Continue with other attachments
      }
    }
  }
}

/**
 * Waits for the assistant's response and returns it
 */
async function waitForResponse(page: Page, returnToProjectPage: boolean): Promise<string> {
  uploadLogger.info('Waiting for response...');
  try {
    const btnSend = "[data-testid='send-button']";
    
    // First wait for the send button to hide (processing message)
    await page.waitForFunction(
      (btnSelector) => {
        const btn = document.querySelector(btnSelector);
        return !btn || btn.getAttribute('disabled') === 'disabled';
      },
      { timeout: 30000 },
      btnSend
    );
    
    // Then wait for the send button to appear again (response received)
    await page.waitForSelector(btnSend, { timeout: 60000 });
    
    const messageEl = "div[data-message-author-role='assistant']";
    await page.waitForSelector(messageEl, { timeout: 60000 });

    const answer = await page.$$eval(messageEl, (elements: Element[]) => {
      const latest = elements[elements.length - 1];
      return latest.textContent || '';
    });

    uploadLogger.success('Response received!');
    
    // Navigate back to project page if requested
    if (returnToProjectPage) {
      try {
        uploadLogger.info(`Returning to project page: ${PROJECT_URL}`);
        await page.goto(PROJECT_URL, { 
          waitUntil: 'networkidle0',
          timeout: 30000 
        });
        uploadLogger.success('Successfully navigated back to project page');
      } catch (navError) {
        uploadLogger.warn(`Could not navigate back to project page: ${navError instanceof Error ? navError.message : String(navError)}`);
        // Take a screenshot but don't throw an error - this is non-critical
        await ScreenshotManager.takeScreenshot(page, 'navigation-error', true, false);
      }
    }
    
    return answer;
  } catch (error) {
    uploadLogger.error('Failed to get response', error);
    // Take a screenshot only when response retrieval fails
    await ScreenshotManager.takeScreenshot(page, `response-error-${Date.now()}`);
    throw new Error(`Could not get response: ${error instanceof Error ? error.message : String(error)}`);
  }
} 
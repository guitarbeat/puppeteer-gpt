import { Page } from 'puppeteer';
import { uploadAttachment, uploadMultipleAttachments } from '../upload';
import { uploadLogger } from '../../utils/logger';
import { ScreenshotManager } from '../../utils/screenshot';
import * as path from 'path';
import { MessageOptions, DEFAULT_MESSAGE_OPTIONS, SELECTORS } from '../../utils/types';
import { filterExistingFiles, removeDuplicateFiles } from '../../utils/fileHelpers';
import { enterText, verifyTextEntry, clickButton, tryEnableButton } from '../../utils/ui/uiHelpers';
import { waitForAssistantResponse } from '../../utils/ui/waitHelpers';

/**
 * Sends a message to ChatGPT, optionally followed by attachments.
 * First enters the text, then uploads attachments if any, then sends the message.
 * @param page Puppeteer page instance
 * @param message The message to send
 * @param attachments Array of file paths to upload (optional)
 * @param options Message sending options
 * @returns The assistant's response text
 */
export async function sendMessageWithAttachments(
  page: Page,
  message: string,
  attachments: string[] = [],
  options: Partial<MessageOptions> = {}
): Promise<string> {
  const mergedOptions = { ...DEFAULT_MESSAGE_OPTIONS, ...options };
  
  try {
    // Set step context for screenshots
    ScreenshotManager.setStepContext('message_preparation');
    
    // Debug: Log the first line of the message to verify content
    const firstLine = message.split('\n')[0];
    const restLines = message.split('\n').length > 1 ? '+ additional content' : '';
    
    // 1. Enter the message text FIRST
    uploadLogger.info(`Preparing message for student: "${firstLine.substring(0, 30)}..."`);
    
    // Disable auto-submission behavior first
    try {
      await page.evaluate(() => {
        // Override the form submission globally while we enter text
        const originalSubmit = HTMLFormElement.prototype.submit;
        HTMLFormElement.prototype.submit = function() {
          console.log("Form submission prevented during text entry");
          return false;
        };
        
        // Restore after a delay
        setTimeout(() => {
          HTMLFormElement.prototype.submit = originalSubmit;
        }, 3000);
        
        // Also prevent Enter key from submitting
        const preventEnterSubmit = function(e: KeyboardEvent) {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.stopPropagation();
            e.preventDefault();
          }
        };
        
        // Add listener to capture Enter key
        document.addEventListener('keydown', preventEnterSubmit, true);
        
        // Remove after a delay
        setTimeout(() => {
          document.removeEventListener('keydown', preventEnterSubmit, true);
        }, 3000);
      });
    } catch (err) {
      uploadLogger.warn("Could not disable auto-submission, proceeding anyway:", err);
    }
    
    // Update step context for text entry
    ScreenshotManager.setStepContext('text_entry');
    
    // Wrap the text entry with specific error handling
    try {
      // Wait for the field to clear
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Modified approach: Fake typing to simulate human input
      uploadLogger.info('Typing text into ChatGPT...');
      
      try {
        // Focus on the textarea first
        await page.focus(SELECTORS.TEXTAREA);
        
        // Clear any existing content
        await page.evaluate((selector) => {
          const editor = document.querySelector(selector);
          if (editor) {
            editor.innerHTML = '';
            return true;
          }
          return false;
        }, SELECTORS.TEXTAREA);
        
        // Type the message character by character with natural delays
        await simulateHumanTyping(page, message);
        
        uploadLogger.success('Simulated typing completed');
      } catch (typingError) {
        uploadLogger.warn('Error during simulated typing:', typingError);
        uploadLogger.info('Falling back to direct text insertion...');
        
        // FALLBACK: If typing simulation fails, use the original direct DOM manipulation
        await page.evaluate((selector, textToEnter) => {
          // Find the contenteditable element
          const editor = document.querySelector(selector);
          if (!editor) return false;
          
          // Clear existing content first
          editor.innerHTML = '';
          
          // Create HTML with proper newlines
          // Convert newlines to <br> tags
          const html = textToEnter
            .split('\n')
            .map(line => `<p>${line || '<br>'}</p>`)
            .join('');
          
          // Set innerHTML
          editor.innerHTML = html;
          
          // Focus the element and dispatch input event to ensure React updates
          // Cast to HTMLElement to use focus method
          (editor as HTMLElement).focus();
          
          // Trigger input events for React to recognize the change
          const inputEvent = new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            composed: true
          });
          editor.dispatchEvent(inputEvent);
          
          return true;
        }, SELECTORS.TEXTAREA, message);
      }
      
      // Longer wait for the DOM update to propagate
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Verify the textarea contains our text by checking innerText
      const textareaContent = await page.$eval(SELECTORS.TEXTAREA, (el: any) => {
        // For contenteditable, get the text content 
        return el.innerText || '';
      });
      
      if (!textareaContent || textareaContent.length < message.length * 0.9) {
        uploadLogger.warn(`Text may not be fully entered: ${textareaContent.length} vs expected ${message.length} chars`);
        
        // Update step context for fallback text entry
        ScreenshotManager.setStepContext('text_entry_fallback');
        
        // FALLBACK: Try direct DOM value setting if paste didn't work
        uploadLogger.info("Text entry incomplete, trying direct DOM manipulation...");
        await page.evaluate((selector, text) => {
          const textarea = document.querySelector(selector);
          if (textarea) {
            // @ts-ignore
            textarea.value = text;
            
            // Trigger input/change events to ensure React updates
            const event = new Event('input', { bubbles: true });
            textarea.dispatchEvent(event);
            
            const changeEvent = new Event('change', { bubbles: true });
            textarea.dispatchEvent(changeEvent);
          }
        }, SELECTORS.TEXTAREA, message);
        
        // Add extra time after direct DOM manipulation
        await new Promise(resolve => setTimeout(resolve, 1500));
      } else {
        uploadLogger.success(`Text verified (${textareaContent.length} chars) before proceeding`);
      }
      
      // Take a screenshot after text entry to verify
      await ScreenshotManager.takeScreenshot(page, 'message-entered-debug', false, false);
      uploadLogger.success('Message text entered (not sent yet)');
      
      // Add a moment for React to process
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (textError) {
      // Update step context for error
      ScreenshotManager.setStepContext('text_entry_error');
      
      uploadLogger.error('Error entering text:', textError);
      // Take error screenshot
      await ScreenshotManager.takeErrorScreenshot(page, 'text-entry-error');
      throw new Error(`Failed to enter text: ${textError instanceof Error ? textError.message : String(textError)}`);
    }
    
    // 2. Handle attachments AFTER text entry if there are any
    if (attachments.length > 0) {
      // Update step context for attachments
      ScreenshotManager.setStepContext('attachment_upload');
      
      uploadLogger.info(`Adding ${attachments.length} attachment(s) after entering text`);
      await handleAttachments(page, attachments, mergedOptions.useMultiUpload ?? false);
      
      // IMPORTANT: Wait after attachments are uploaded before sending
      uploadLogger.info('Waiting for attachment processing to complete...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    } else {
      uploadLogger.info("No attachments to upload");
    }
    
    // Update step context for verification
    ScreenshotManager.setStepContext('pre_send_verification');
    
    // Final verification before sending
    uploadLogger.info('Verifying text before sending...');
    
    // For contenteditable divs, we need to check innerText, not value
    const finalTextContent = await page.evaluate((selector) => {
      const editor = document.querySelector(selector);
      if (!editor) return '';
      
      // Multiple ways to check for content in a contenteditable
      // Use type assertions to handle Element properties
      return (editor as HTMLElement).innerText || 
             editor.textContent || 
             editor.innerHTML.replace(/<[^>]*>/g, '').trim();
    }, SELECTORS.TEXTAREA);
    
    if (!finalTextContent || finalTextContent.trim() === '') {
      // Update step context for error
      ScreenshotManager.setStepContext('text_missing_error');
      
      uploadLogger.error('CRITICAL: Text disappeared from textarea before sending!');
      await ScreenshotManager.takeErrorScreenshot(page, 'text-missing-before-send');
      
      // Try to recover by re-entering the text one last time
      uploadLogger.info('Attempting to recover by re-entering text...');
      
      await page.evaluate((selector, textToEnter) => {
        const editor = document.querySelector(selector);
        if (!editor) return false;
        
        // Clear existing content first
        editor.innerHTML = '';
        
        // Create HTML with proper newlines
        const html = textToEnter
          .split('\n')
          .map(line => `<p>${line || '<br>'}</p>`)
          .join('');
        
        // Set innerHTML
        editor.innerHTML = html;
        
        // Focus and dispatch event
        (editor as HTMLElement).focus();
        editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
        
        return true;
      }, SELECTORS.TEXTAREA, message);
      
      // Wait for the text to be recognized
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check if recovery was successful
      const recoveredText = await page.evaluate((selector) => {
        const editor = document.querySelector(selector);
        return editor ? (editor as HTMLElement).innerText || '' : '';
      }, SELECTORS.TEXTAREA);
      
      if (!recoveredText || recoveredText.trim() === '') {
        throw new Error("Failed to recover text before sending message");
      }
      
      uploadLogger.success('Successfully recovered text before sending');
    } else {
      uploadLogger.success(`Verified text is still present (${finalTextContent.length} chars), proceeding to send`);
    }
    
    // 3. Send the message and wait for a response
    uploadLogger.info("Sending message...");
    
    // Update step context for sending
    ScreenshotManager.setStepContext('sending_message');
    
    // Send the message
    await sendMessage(page);
    
    // Wait for and get the AI's response
    const response = await waitForAssistantResponse(
      page, 
      SELECTORS.ASSISTANT_MESSAGE, 
      SELECTORS.SEND_BUTTON,
      mergedOptions.responseTimeout
    );
    
    uploadLogger.success('Response received!');
    
    return response;
  } catch (error) {
    // Update step context for error
    ScreenshotManager.setStepContext('message_error');
    
    uploadLogger.error('Failed to send message', error);
    
    // Take an error screenshot
    await ScreenshotManager.takeErrorScreenshot(page, 'message-error');
    
    throw error;
  }
}

/**
 * Handle sending the message
 */
async function sendMessage(page: Page): Promise<void> {
  try {
    // Simple approach to handle the send button
    const sendButtonSelector = SELECTORS.SEND_BUTTON;
    
    // Wait for the send button to be available
    await page.waitForSelector(sendButtonSelector, { timeout: 10000 });
    
    // Check if button is disabled
    const isDisabled = await page.$eval(
      sendButtonSelector, 
      (el) => el.hasAttribute('disabled') || el.getAttribute('disabled') === 'disabled'
    );
    
    if (isDisabled) {
      uploadLogger.warn('Send button is disabled - cannot send message');
      throw new Error('Send button is disabled');
    }
    
    uploadLogger.info('Sending message to ChatGPT...');
    
    // Try multiple approaches to ensure message is sent
    let success = false;
    
    // Approach 1: JavaScript click
    try {
      await page.evaluate((selector) => {
        const button = document.querySelector(selector);
        if (button) {
          // Force enable the button if somehow disabled
          if (button.hasAttribute('disabled')) {
            button.removeAttribute('disabled');
          }
          
          // Click with multiple methods
          (button as HTMLElement).click();
          
          // Also try mouse event simulation
          button.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window
          }));
          
          // Another click for good measure
          setTimeout(() => (button as HTMLElement).click(), 100);
          
          return true;
        }
        return false;
      }, sendButtonSelector);
      
      success = true;
    } catch (jsError) {
      uploadLogger.warn('JavaScript click failed, trying direct click');
    }
    
    // Approach 2: Direct puppeteer click if JavaScript click failed
    if (!success) {
      try {
        await page.click(sendButtonSelector, { delay: 100 });
        success = true;
      } catch (clickError) {
        uploadLogger.warn('Direct click failed, trying keyboard shortcuts');
      }
    }
    
    // Approach 3: Use keyboard shortcuts (Enter, Meta+Enter, Ctrl+Enter)
    if (!success) {
      try {
        // Focus the textarea first
        await page.focus(SELECTORS.TEXTAREA);
        
        // Try Meta+Enter (Command+Enter on Mac)
        await page.keyboard.down('Meta');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Meta');
        
        // Wait a moment
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Check if button is now disabled (which means message is being sent)
        const isNowDisabled = await page.$eval(
          sendButtonSelector, 
          (el) => el.hasAttribute('disabled') || el.getAttribute('disabled') === 'disabled'
        );
        
        if (!isNowDisabled) {
          // Try Ctrl+Enter
          await page.keyboard.down('Control');
          await page.keyboard.press('Enter');
          await page.keyboard.up('Control');
          
          // Wait a moment
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        success = true;
      } catch (keyboardError) {
        uploadLogger.warn('Keyboard shortcuts failed');
      }
    }
    
    if (!success) {
      uploadLogger.warn('Message may not have been sent - please check and click send manually if needed');
    }
    
    // Wait a moment to ensure click is processed
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Take a screenshot after sending
    await ScreenshotManager.takeScreenshot(page, 'after-send-attempt', false, false);
  } catch (error) {
    uploadLogger.error('Failed to send message', error);
    throw error;
  }
}

/**
 * Handle uploading attachments
 */
async function handleAttachments(page: Page, attachments: string[], useMultiUpload: boolean): Promise<void> {
  // Verify attachments exist
  const validAttachments = filterExistingFiles(attachments);
  
  if (validAttachments.length === 0) {
    uploadLogger.warn('No valid attachments found. All file paths are invalid or inaccessible.');
    return;
  }
  
  // Remove any duplicate paths
  const uniqueAttachments = removeDuplicateFiles(validAttachments);
  
  uploadLogger.info(`Uploading ${uniqueAttachments.length} attachment(s)...`);
  
  // Try multi-upload first if enabled and there are multiple files
  if (useMultiUpload && uniqueAttachments.length > 1) {
    uploadLogger.info("Attempting to upload all files at once...");
    try {
      await uploadMultipleAttachments(page, uniqueAttachments);
      uploadLogger.success(`Successfully uploaded ${uniqueAttachments.length} files at once`);
      return;
    } catch (error) {
      uploadLogger.warn("Multi-upload failed, falling back to individual uploads", error);
    }
  }
  
  // Upload files individually
  uploadLogger.info("Uploading files individually...");
  for (let i = 0; i < uniqueAttachments.length; i++) {
    try {
      await uploadAttachment(page, uniqueAttachments[i]);
      uploadLogger.success(`Uploaded file ${i+1}/${uniqueAttachments.length}`);
      
      // Wait between uploads to avoid rate limiting
      if (i < uniqueAttachments.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    } catch (error) {
      uploadLogger.error(`Failed to upload file ${i+1}/${uniqueAttachments.length}`, error);
      // Continue with other attachments
    }
  }
}

/**
 * Navigate back to the project page - disabled to maintain conversation context
 */
async function navigateToProjectPage(page: Page): Promise<void> {
  // This function is intentionally disabled to maintain conversation context
  uploadLogger.info('Navigation to project page disabled to maintain conversation context');
}

/**
 * Simulates human typing with natural delays between characters
 * @param page Puppeteer page instance
 * @param text Text to type
 */
async function simulateHumanTyping(page: Page, text: string): Promise<void> {
  // Base typing speed in milliseconds (average human typing)
  const baseDelay = 30;
  
  // Split text into paragraphs (for handling newlines)
  const paragraphs = text.split('\n');
  
  for (let p = 0; p < paragraphs.length; p++) {
    const paragraph = paragraphs[p];
    
    // Type each character with a random delay
    for (let i = 0; i < paragraph.length; i++) {
      const char = paragraph[i];
      
      // Type the character
      await page.keyboard.type(char);
      
      // Calculate delay based on character type
      let delay = baseDelay;
      
      // Add extra delay after punctuation
      if ('.!?,:;'.includes(char)) {
        delay = baseDelay * (2 + Math.random() * 2); // 2-4x longer pause after punctuation
      } else {
        // Random variation in typing speed
        delay = baseDelay * (0.7 + Math.random() * 0.6); // 0.7-1.3x normal speed
      }
      
      // Occasionally add a longer pause to simulate human thinking
      if (Math.random() < 0.05) {
        delay = baseDelay * (4 + Math.random() * 6); // 4-10x longer pause, but rarely
      }
      
      // Wait before typing the next character
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    // If not the last paragraph, add a newline and a longer pause
    if (p < paragraphs.length - 1) {
      await page.keyboard.press('Enter');
      // Longer pause after completing a paragraph
      await new Promise(resolve => setTimeout(resolve, baseDelay * 5));
    }
  }
} 
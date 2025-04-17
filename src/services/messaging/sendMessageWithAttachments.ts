import { Page } from 'puppeteer';
import { ScreenshotManager } from '../../utils/logging/screenshot';
import { MessageOptions, DEFAULT_MESSAGE_OPTIONS, SELECTORS } from '../../utils/types';
import { TextEntry, MessageSender, AttachmentHandler } from '../../utils/ui';
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
    ScreenshotManager.setStepContext('message_preparation');
    
    // Debug logging
    const firstLine = message.split('\n')[0];
    console.log(`Preparing message: "${firstLine.substring(0, 30)}..."`);
    
    // 1. Enter message text
    await safelyEnterText(page, message);
    
    // 2. Handle attachments if any
    if (attachments.length > 0) {
      ScreenshotManager.setStepContext('attachment_upload');
      await AttachmentHandler.handleAttachments(page, attachments, mergedOptions.useMultiUpload ?? false);
    }
    
    // 3. Verify text is still present before sending
    await verifyTextBeforeSending(page, message);
    
    // 4. Send the message
    ScreenshotManager.setStepContext('sending_message');
    console.log("Sending message...");
    await sendMessage(page);
    
    // Debug navigation tracking
    const chatUrlBeforeResponse = page.url();
    console.log(`DEBUG - Chat URL before waiting for response: ${chatUrlBeforeResponse}`);
    const navigationLog = MessageSender.setupNavigationTracking(page, chatUrlBeforeResponse);
    
    // 5. Wait for and get response
    console.log(`Waiting for ChatGPT response (timeout: ${(mergedOptions.responseTimeout ?? 180000)/1000}s)...`);
    let response;
    
    try {
      response = await waitForAssistantResponse(
        page, 
        SELECTORS.ASSISTANT_MESSAGE, 
        SELECTORS.SEND_BUTTON,
        mergedOptions.responseTimeout
      );
      
      MessageSender.logResponseDetails(response);
    } catch (responseError) {
      response = await MessageSender.handleResponseError(page, responseError, navigationLog);
    } finally {
      MessageSender.cleanupNavigationTracking(page, navigationLog);
    }
    
    return response;
  } catch (error) {
    ScreenshotManager.setStepContext('message_error');
    console.error('Failed to send message', error);
    await ScreenshotManager.error(page, 'message-error');
    throw error;
  }
}

/**
 * Safely enters text into the chat input with error handling and fallbacks
 */
async function safelyEnterText(page: Page, message: string): Promise<void> {
  try {
    await MessageSender.disableAutoSubmission(page);
  } catch (err) {
    console.warn("Could not disable auto-submission, proceeding anyway:", err);
  }
  
  ScreenshotManager.setStepContext('text_entry');
  
  try {
    // Wait briefly for field to be ready
    await TextEntry.pause(500);
    
    // Choose text entry method based on message length
    const SAFE_MESSAGE_LENGTH = 300;
    if (message.length > SAFE_MESSAGE_LENGTH) {
      console.log(`Message is ${message.length} chars - using direct insertion`);
      await TextEntry.insertTextDirectly(page, message);
    } else {
      await TextEntry.typeTextWithFallback(page, message);
    }
    
    // Verify text was entered correctly
    await TextEntry.verifyTextEntry(page, message);
    
    // Take verification screenshot
    await ScreenshotManager.debug(page, 'message-entered-debug');
    console.log('Message text entered successfully');
    await TextEntry.pause(500);
  } catch (textError) {
    ScreenshotManager.setStepContext('text_entry_error');
    console.error('Error entering text:', textError);
    await ScreenshotManager.error(page, 'text-entry-error');
    throw new Error(`Failed to enter text: ${textError instanceof Error ? textError.message : String(textError)}`);
  }
}

/**
 * Verifies text is still present before sending
 */
async function verifyTextBeforeSending(page: Page, message: string): Promise<void> {
  ScreenshotManager.setStepContext('pre_send_verification');
  console.log('Verifying text before sending...');
  
  const finalTextContent = await TextEntry.getTextAreaContent(page);
  
  if (!finalTextContent || finalTextContent.trim() === '') {
    ScreenshotManager.setStepContext('text_missing_error');
    console.error('CRITICAL: Text disappeared from textarea before sending!');
    await ScreenshotManager.error(page, 'text-missing-before-send');
    
    // Recovery attempt
    console.log('Attempting to recover by re-entering text...');
    await TextEntry.insertTextDirectly(page, message);
    await TextEntry.pause(2000);
    
    const recoveredText = await TextEntry.getTextAreaContent(page);
    if (!recoveredText || recoveredText.trim() === '') {
      throw new Error("Failed to recover text before sending message");
    }
    
    console.log('Successfully recovered text before sending');
  } else {
    console.log(`Verified text is still present (${finalTextContent.length} chars), proceeding to send`);
  }
}

/**
 * Sends the message using multiple approaches
 */
async function sendMessage(page: Page): Promise<void> {
  try {
    const sendButtonSelector = SELECTORS.SEND_BUTTON;
    
    console.log(`DEBUG - sendMessage: Current URL before sending: ${page.url()}`);
    await page.waitForSelector(sendButtonSelector, { timeout: 10000 });
    
    // Check if button is disabled
    const isDisabled = await page.$eval(
      sendButtonSelector, 
      (el) => el.hasAttribute('disabled') || el.getAttribute('disabled') === 'disabled'
    );
    
    if (isDisabled) {
      console.warn('Send button is disabled - cannot send message');
      throw new Error('Send button is disabled');
    }
    
    // Set up navigation tracking
    const initialUrl = page.url();
    console.log(`Sending message... (current URL: ${initialUrl})`);
    
    let hasNavigated = false;
    page.once('framenavigated', async (frame) => {
      if (frame === page.mainFrame() && page.url() !== initialUrl) {
        hasNavigated = true;
        console.warn(`Page navigation detected during send: ${initialUrl} -> ${page.url()}`);
      }
    });
    
    // Try multiple sending approaches
    let success = await MessageSender.trySendingWithMultipleApproaches(page, sendButtonSelector);
    
    // Check if we've navigated to a new URL
    if (hasNavigated) {
      const currentUrl = page.url();
      if (currentUrl.includes('/new') || currentUrl.includes('/c/new')) {
        console.error('Navigation to new chat detected - this is unexpected');
        throw new Error('Unexpected navigation to new chat after sending message');
      }
    }
    
    await TextEntry.pause(1000);
    await ScreenshotManager.debug(page, 'after-send-attempt');
  } catch (error) {
    console.error('Failed to send message', error);
    throw error;
  }
} 
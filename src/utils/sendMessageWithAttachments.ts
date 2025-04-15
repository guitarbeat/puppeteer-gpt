import { Page } from 'puppeteer';
import { uploadAttachment } from './uploadAttachment';

/**
 * Sends a message to ChatGPT, optionally uploading attachments first.
 * @param page Puppeteer page instance
 * @param message The message to send
 * @param attachments Array of file paths to upload (optional)
 * @returns The assistant's response text
 */
export async function sendMessageWithAttachments(
  page: Page,
  message: string,
  attachments: string[] = []
): Promise<string> {
  // 1. Upload attachments if any
  if (attachments.length > 0) {
    console.log(`Uploading ${attachments.length} attachment(s)...`);
    for (const filePath of attachments) {
      try {
        await uploadAttachment(page, filePath);
        console.log(`Uploaded: ${filePath}`);
      } catch (error) {
        console.error(`Failed to upload ${filePath}:`, error);
        throw new Error(`Attachment upload failed: ${error}`);
      }
      
      // Wait a moment after each upload
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // 2. Type the message
  console.log('Typing message...');
  const promptSelector = '#prompt-textarea';
  try {
    await page.waitForSelector(promptSelector, { timeout: 10000 });
    await page.type(promptSelector, message, { delay: Math.random() * 50 + 10 });
  } catch (error) {
    console.error('Failed to type message:', error);
    throw new Error(`Could not type message: ${error}`);
  }

  // 3. Click the send button
  console.log('Sending message...');
  const btnSend = "[data-testid='send-button']";
  try {
    // Make multiple attempts to find the send button
    let sendButtonFound = false;
    let attempts = 0;
    
    while (!sendButtonFound && attempts < 3) {
      attempts++;
      try {
        await page.waitForSelector(btnSend, { timeout: 10000 });
        sendButtonFound = true;
      } catch (e) {
        console.log(`Attempt ${attempts}: Send button not found. Waiting...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        // Take a screenshot to debug
        if (attempts === 2) {
          await page.screenshot({ path: `screenshots/send-button-error-${Date.now()}.png` });
        }
      }
    }
    
    if (!sendButtonFound) {
      throw new Error('Send button not found after multiple attempts');
    }
    
    // Check if button is disabled
    const isBtnDisabled = await page.$eval(btnSend, (el) => el.getAttribute('disabled'));
    if (isBtnDisabled) {
      console.log('Send button is disabled. Waiting for it to become enabled...');
      // Wait a bit more to see if it becomes enabled
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    // Try clicking it anyway
    await page.click(btnSend);
    console.log('Message sent!');
  } catch (error) {
    console.error('Failed to send message:', error);
    throw new Error(`Could not send message: ${error}`);
  }

  // 4. Wait for response
  console.log('Waiting for response...');
  try {
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

    console.log('Response received!');
    return answer;
  } catch (error) {
    console.error('Failed to get response:', error);
    throw new Error(`Could not get response: ${error}`);
  }
} 
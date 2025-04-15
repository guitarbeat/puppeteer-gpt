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
  for (const filePath of attachments) {
    await uploadAttachment(page, filePath);
  }

  // 2. Type the message
  const promptSelector = '#prompt-textarea';
  await page.waitForSelector(promptSelector, { timeout: 10000 });
  await page.type(promptSelector, message, { delay: Math.random() * 50 });

  // 3. Click the send button
  const btnSend = "[data-testid='send-button']";
  await page.waitForSelector(btnSend);
  const isBtnDisabled = await page.$eval(btnSend, (el) => el.getAttribute('disabled'));
  if (!isBtnDisabled) await page.click(btnSend);

  // 4. Wait for response
  await page.waitForSelector(btnSend, { hidden: true });
  await page.waitForSelector(btnSend);

  const messageEl = "div[data-message-author-role='assistant']";
  await page.waitForSelector(messageEl);

  const answer = await page.$$eval(messageEl, (elements: Element[]) => {
    const latest = elements[elements.length - 1];
    return latest.textContent || '';
  });

  return answer;
} 
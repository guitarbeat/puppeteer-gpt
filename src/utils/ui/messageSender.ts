import { Page } from 'puppeteer';
import { ScreenshotManager } from '../logging/screenshot';
import { SELECTORS } from '../types';
import { pause } from './textEntry';

/**
 * Module for handling message sending in ChatGPT
 */

/**
 * Disables auto-submission behavior
 */
export async function disableAutoSubmission(page: Page): Promise<void> {
  await page.waitForSelector(SELECTORS.TEXTAREA, { timeout: 5000 });
  
  await page.evaluate((sendButtonSelector) => {
    // Disable send button
    const sendButton = document.querySelector(sendButtonSelector);
    if (sendButton) {
      sendButton.setAttribute('disabled', 'disabled');
      sendButton.setAttribute('data-temp-disabled', 'true');
    }
    
    // Prevent Enter key
    const preventEnterKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    };
    
    document.addEventListener('keydown', preventEnterKey, true);
    
    // Restore after 10 seconds
    window.setTimeout(() => {
      const tempDisabled = document.querySelector('[data-temp-disabled="true"]');
      if (tempDisabled) {
        tempDisabled.removeAttribute('disabled');
        tempDisabled.removeAttribute('data-temp-disabled');
      }
      document.removeEventListener('keydown', preventEnterKey, true);
    }, 10000);
  }, SELECTORS.SEND_BUTTON);
  
  await pause(500);
}

/**
 * JavaScript-based click implementation
 */
export async function jsClick(page: Page, selector: string): Promise<void> {
  await page.evaluate((selector) => {
    const button = document.querySelector(selector);
    if (button) {
      if (button.hasAttribute('disabled')) {
        button.removeAttribute('disabled');
      }
      
      (button as HTMLElement).click();
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      setTimeout(() => (button as HTMLElement).click(), 100);
      return true;
    }
    return false;
  }, selector);
}

/**
 * Try keyboard shortcuts to send message
 */
export async function tryKeyboardShortcuts(page: Page): Promise<void> {
  await page.focus(SELECTORS.TEXTAREA);
  
  // Try Meta+Enter (Command+Enter on Mac)
  await page.keyboard.down('Meta');
  await page.keyboard.press('Enter');
  await page.keyboard.up('Meta');
  await pause(500);
  
  // Check if send button is now disabled
  const isNowDisabled = await page.$eval(
    SELECTORS.SEND_BUTTON, 
    (el) => el.hasAttribute('disabled') || el.getAttribute('disabled') === 'disabled'
  );
  
  // If not, try Ctrl+Enter
  if (!isNowDisabled) {
    await page.keyboard.down('Control');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Control');
    await pause(500);
  }
}

/**
 * Tries multiple approaches to send the message
 */
export async function trySendingWithMultipleApproaches(page: Page, sendButtonSelector: string): Promise<boolean> {
  const approaches = [
    async () => await jsClick(page, sendButtonSelector),
    async () => await page.click(sendButtonSelector, { delay: 100 }),
    async () => await tryKeyboardShortcuts(page)
  ];
  
  for (const approach of approaches) {
    try {
      await approach();
      
      // Verify button is now disabled, which indicates message is sending
      try {
        await page.waitForFunction(
          (sel) => {
            const btn = document.querySelector(sel);
            return btn && btn.hasAttribute('disabled');
          },
          { timeout: 5000 },
          sendButtonSelector
        );
        console.log('Send button is now disabled, message is being processed');
        return true;
      } catch (waitError) {
        console.log('Send button did not become disabled. Trying next approach...');
      }
    } catch (error) {
      // Continue to next approach
    }
  }
  
  console.log('All sending approaches failed - message may not have been sent');
  return false;
}

/**
 * Sets up navigation tracking during response wait
 */
export function setupNavigationTracking(page: Page, initialUrl: string): { log: string[], listener: any } {
  const navigationLog: string[] = [];
  const navigationListener = (frame: any) => {
    if (frame === page.mainFrame()) {
      const currentUrl = page.url();
      const navMessage = `DEBUG - Navigation detected: ${initialUrl} -> ${currentUrl}`;
      console.log(navMessage);
      navigationLog.push(navMessage);
    }
  };
  
  page.on('framenavigated', navigationListener);
  return { log: navigationLog, listener: navigationListener };
}

/**
 * Cleans up navigation tracking
 */
export function cleanupNavigationTracking(page: Page, tracking: { log: string[], listener: any }): void {
  page.off('framenavigated', tracking.listener);
  
  const chatUrlAfterResponse = page.url();
  console.log(`DEBUG - Chat URL after response handling: ${chatUrlAfterResponse}`);
  console.log(`DEBUG - Navigation events during response: ${tracking.log.length}`);
  if (tracking.log.length > 0) {
    console.log(`DEBUG - Navigation log: ${JSON.stringify(tracking.log)}`);
  }
}

/**
 * Logs details about the received response
 */
export function logResponseDetails(response: string): void {
  console.log(`Received response with ${response.length} characters`);
  
  if (response.length < 100) {
    console.log(`Potentially incomplete response (only ${response.length} chars)`);
  }
  
  console.log('Response received!');
}

/**
 * Handles response errors and attempts to get partial responses
 */
export async function handleResponseError(
  page: Page, 
  responseError: any, 
  tracking: { log: string[], listener: any }
): Promise<string> {
  console.log('Error getting response:', responseError);
  
  const chatUrlAfterError = page.url();
  console.log(`DEBUG - Chat URL after error: ${chatUrlAfterError}`);
  console.log(`DEBUG - Navigation log during error: ${JSON.stringify(tracking.log)}`);
  
  await ScreenshotManager.error(page, 'response-error');
  
  // Try to get a partial response
  try {
    const partialResponse = await page.$$eval(SELECTORS.ASSISTANT_MESSAGE, (elements) => {
      const latest = elements[elements.length - 1];
      return latest ? latest.textContent || '' : '';
    });
    
    if (partialResponse && partialResponse.length > 0) {
      console.log(`Returning partial response (${partialResponse.length} chars) after error`);
      return partialResponse;
    }
  } catch (fallbackError) {
    // Ignore fallback errors
  }
  
  throw responseError;
} 
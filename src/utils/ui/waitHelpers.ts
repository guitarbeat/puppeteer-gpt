import { Page } from 'puppeteer';
import { uploadLogger } from '../logger';
import { LOADING_INDICATORS, FILE_INDICATORS } from '../types';
import { ScreenshotManager } from '../screenshot';

/**
 * Wait for loading indicators to disappear
 */
export async function waitForLoadingToComplete(
  page: Page, 
  selectors: string[] = LOADING_INDICATORS, 
  timeout: number = 30000
): Promise<boolean> {
  try {
    // Check if any loading indicators are present
    const hasLoadingIndicator = await page.evaluate((indicators) => {
      return indicators.some(selector => document.querySelector(selector) !== null);
    }, selectors);
    
    // If no loading indicators found, return immediately
    if (!hasLoadingIndicator) {
      return true;
    }
    
    uploadLogger.debug('Found loading indicators, waiting for them to disappear...');
    
    // Wait for loading indicators to disappear
    await page.waitForFunction(
      (indicators) => {
        // Check if any of the loading indicators are present
        for (const selector of indicators) {
          const el = document.querySelector(selector);
          if (el) {
            // For circle animations, check if it's actively animating
            if (selector.includes('circle') && 
                el instanceof SVGElement && 
                el.getAttribute('stroke-dashoffset')) {
              return false;
            }
            
            // For other loading indicators
            return false;
          }
        }
        return true;
      },
      { timeout }, 
      selectors
    );
    
    uploadLogger.debug('All loading indicators have disappeared');
    return true;
  } catch (e) {
    uploadLogger.debug('Loading indicators did not disappear within the timeout, continuing anyway');
    return false;
  }
}

/**
 * Wait for file indicators to appear (showing files have been uploaded)
 */
export async function waitForFileIndicators(
  page: Page, 
  timeout: number = 15000, 
  expectedCount: number = 1
): Promise<boolean> {
  try {
    await page.waitForFunction((indicators, count) => {
      // Check if any loading indicators are still visible
      const loadingSpinner = document.querySelector('circle[stroke-dashoffset][stroke-dasharray]');
      if (loadingSpinner) {
        return false; // Still loading
      }
      
      // Look for file indicators
      const possibleElements = indicators.map(selector => 
        document.querySelectorAll(selector)
      );
      
      // For multiple files, accept any visible indicator
      return possibleElements.some(collection => collection.length > 0);
    }, { timeout }, FILE_INDICATORS, expectedCount);
    
    uploadLogger.debug('File indicators found - upload appears complete');
    return true;
  } catch (e) {
    uploadLogger.debug('Could not confirm file upload through UI indicators');
    return false;
  }
}

/**
 * Wait for a response from the assistant
 */
export async function waitForAssistantResponse(
  page: Page, 
  messageSelector: string,
  sendButtonSelector: string,
  timeout: number = 120000
): Promise<string> {
  // Set step context for screenshots
  ScreenshotManager.setStepContext('waiting_for_response');
  
  uploadLogger.info(`Waiting for ChatGPT to respond... (timeout: ${timeout/1000}s)`);
  
  try {
    // Take a screenshot at the start of waiting
    await ScreenshotManager.takeScreenshot(page, 'response-waiting-start', false, false);
    
    // First wait for the send button to become disabled (processing)
    await page.waitForFunction(
      (btnSelector) => {
        const btn = document.querySelector(btnSelector);
        return !btn || btn.getAttribute('disabled') === 'disabled';
      },
      { timeout: 30000 },
      sendButtonSelector
    );
    
    // Take a screenshot once the send button is disabled
    await ScreenshotManager.takeScreenshot(page, 'response-generation-started', false, false);
    
    // Track response progress
    let responseCheckInterval: NodeJS.Timeout | undefined;
    let progressCheckInterval: NodeJS.Timeout | undefined;
    let lastProgressUpdate = Date.now();
    let responseStartTime = Date.now();
    
    // This promise will resolve when a response is detected
    const responsePromise = new Promise<string>((resolve, reject) => {
      let lastLength = 0;
      let stableCount = 0;
      let checkCount = 0;
      let maxStableTime = 15000; // 15 seconds of no change by default
      let lastScreenshotTime = Date.now();
      
      // Function to check if the response is complete based on multiple signals
      const isResponseComplete = async (): Promise<boolean> => {
        try {
          // 1. Check if send button is enabled again (primary signal)
          const sendButtonEnabled = await page.evaluate((selector) => {
            const btn = document.querySelector(selector);
            return btn && !btn.hasAttribute('disabled');
          }, sendButtonSelector);
          
          if (sendButtonEnabled) {
            uploadLogger.info('Send button is enabled again, response is complete');
            // Take a screenshot when complete
            await ScreenshotManager.takeScreenshot(page, 'response-complete-button-enabled', false, false);
            return true;
          }
          
          // 2. Check for "regenerate" button (appears when response is complete)
          const hasRegenerateButton = await page.evaluate(() => {
            return Boolean(
              document.querySelector('button[aria-label="Regenerate"]') || 
              document.querySelector('button:has-text("Regenerate")')
            );
          });
          
          if (hasRegenerateButton) {
            uploadLogger.info('Regenerate button detected, response is complete');
            // Take a screenshot when regenerate button appears
            await ScreenshotManager.takeScreenshot(page, 'response-complete-regenerate', false, false);
            return true;
          }
          
          // 3. Check for "Continue generating" button (appears for partial responses)
          const hasContinueButton = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            return buttons.some(btn => 
              btn.textContent?.includes('Continue') || 
              btn.innerHTML.includes('continue'));
          });
          
          if (hasContinueButton) {
            uploadLogger.info('Continue button detected, response is partially complete');
            // Take a screenshot when continue button appears
            await ScreenshotManager.takeScreenshot(page, 'response-partial-continue', false, false);
            // We'll still wait for stability, but with shorter time
            maxStableTime = 5000; // 5 seconds
          }
          
          return false;
        } catch (err) {
          return false;
        }
      };
      
      // Main check interval (every 5 seconds)
      responseCheckInterval = setInterval(async () => {
        try {
          checkCount++;
          
          // Check if response already complete based on UI signals
          const responseComplete = await isResponseComplete();
          if (responseComplete) {
            const finalResponse = await getLatestResponse();
            if (finalResponse) {
              resolve(finalResponse);
              return;
            }
          }
          
          // Check if response exists
          const hasResponse = await page.evaluate((selector) => {
            const elements = document.querySelectorAll(selector);
            return elements.length > 0;
          }, messageSelector);
          
          if (hasResponse) {
            // Get current response text
            const responseText = await getLatestResponse();
            const currentLength = responseText.length;
            
            // Take periodic screenshots of the response (at most every 30 seconds)
            const currentTime = Date.now();
            if (currentTime - lastScreenshotTime > 30000) {
              await ScreenshotManager.takeScreenshot(page, `response-progress-${currentLength}chars`, false, false);
              lastScreenshotTime = currentTime;
            }
            
            // Log progress only for significant changes (25%+ increase) or every 4th check
            if (currentLength > lastLength * 1.25 || checkCount % 4 === 0) {
              uploadLogger.info(`Response in progress: ~${currentLength} chars`);
              lastProgressUpdate = Date.now();
            }
            
            // Check if response has stopped growing
            if (currentLength > 0 && currentLength === lastLength) {
              stableCount++;
              const stableTime = stableCount * 5000; // 5 seconds per check
              
              // If text hasn't changed for specified time, consider it complete
              if (stableTime >= maxStableTime) {
                uploadLogger.info(`Response stable for ${stableTime/1000}s and is ${currentLength} chars`);
                // Take a final screenshot when response is stable
                await ScreenshotManager.takeScreenshot(page, `response-complete-stable-${currentLength}chars`, false, false);
                resolve(responseText);
              }
            } else {
              // Reset stable count if text is still changing
              stableCount = 0;
              lastProgressUpdate = Date.now();
            }
            
            lastLength = currentLength;
          }
        } catch (err) {
          // Ignore errors during checks
        }
      }, 5000);
      
      // More frequent progress check for timeout prevention (every 1 second)
      progressCheckInterval = setInterval(async () => {
        const currentTime = Date.now();
        const totalElapsed = currentTime - responseStartTime;
        
        // If we've been waiting a while (>30s) with no progress updates in the last 15 seconds,
        // do a quick progress check to update lastProgressUpdate if needed
        if (totalElapsed > 30000 && (currentTime - lastProgressUpdate) > 15000) {
          try {
            const responseText = await getLatestResponse();
            if (responseText && responseText.length > lastLength) {
              uploadLogger.info(`Progress detected: ~${responseText.length} chars`);
              lastLength = responseText.length;
              lastProgressUpdate = currentTime;
            }
          } catch (err) {
            // Ignore errors
          }
        }
        
        // If no progress for 60s and we've waited at least half the timeout,
        // assume we're stuck and return what we have
        const noProgressTime = currentTime - lastProgressUpdate;
        if (totalElapsed > timeout/2 && noProgressTime > 60000 && lastLength > 0) {
          uploadLogger.warn(`No progress for ${noProgressTime/1000}s, returning current response`);
          // Take screenshot when timing out
          await ScreenshotManager.takeScreenshot(page, `response-timeout-no-progress-${lastLength}chars`, false, false);
          const finalResponse = await getLatestResponse();
          resolve(finalResponse || '');
        }
      }, 1000);
      
      // Helper function to get the latest response text
      async function getLatestResponse(): Promise<string> {
        return page.$$eval(messageSelector, (elements: Element[]) => {
          const latest = elements[elements.length - 1];
          return latest ? latest.textContent || '' : '';
        });
      }
    });
    
    // Create a timeout promise
    const timeoutPromise = new Promise<string>((_, reject) => {
      setTimeout(async () => {
        // Take a screenshot before timing out
        await ScreenshotManager.takeScreenshot(page, 'response-global-timeout', true, false);
        reject(new Error(`Waiting for assistant response timed out after ${timeout}ms`));
      }, timeout);
    });
    
    // Race the response detection against timeout
    try {
      const response = await Promise.race([responsePromise, timeoutPromise]);
      
      // Clean up intervals
      clearInterval(responseCheckInterval);
      clearInterval(progressCheckInterval);
      
      // Take final screenshot with response
      await ScreenshotManager.takeScreenshot(page, 'response-received-final', false, false);
      
      // Update step context
      ScreenshotManager.setStepContext('response_received');
      
      return response;
    } catch (error) {
      clearInterval(responseCheckInterval);
      clearInterval(progressCheckInterval);
      throw error;
    }
  } catch (error) {
    uploadLogger.error('Error waiting for assistant response:', error);
    
    // Take error screenshot
    await ScreenshotManager.takeErrorScreenshot(page, 'response-waiting-error', String(error));
    
    // Last attempt to get partial response
    try {
      const partialResponse = await page.$$eval(messageSelector, (elements: Element[]) => {
        const latest = elements[elements.length - 1];
        return latest ? latest.textContent || '' : '';
      });
      
      if (partialResponse) {
        uploadLogger.info(`Returning partial response (${partialResponse.length} chars) due to timeout`);
        return partialResponse;
      }
    } catch (e) {
      // Ignore errors in fallback
    }
    
    throw error;
  }
}

/**
 * Wait with exponential backoff until a condition is met
 */
export async function waitWithBackoff<T>(
  callback: () => Promise<T>,
  validator: (result: T) => boolean,
  maxAttempts: number = 5,
  initialDelay: number = 1000
): Promise<T | null> {
  let attempts = 0;
  let delay = initialDelay;
  
  while (attempts < maxAttempts) {
    const result = await callback();
    if (validator(result)) {
      return result;
    }
    
    attempts++;
    if (attempts >= maxAttempts) {
      break;
    }
    
    // Exponential backoff with jitter
    delay = delay * 1.5 * (0.9 + Math.random() * 0.2);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  return null;
}

/**
 * Wait for a specific element to appear in the DOM and be visible
 */
export async function waitForVisibleElement(
  page: Page,
  selector: string,
  timeout: number = 10000
): Promise<boolean> {
  try {
    await page.waitForFunction(
      (sel) => {
        const element = document.querySelector(sel);
        if (!element) return false;
        
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        
        return style.display !== 'none' && 
               style.visibility !== 'hidden' && 
               style.opacity !== '0' &&
               rect.width > 0 && 
               rect.height > 0;
      },
      { timeout },
      selector
    );
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Wait for chat interface element without resetting the page
 * This function no longer resets the page state, it just verifies the chat interface is available
 */
export async function resetPageState(
  page: Page,
  selector: string,
  stabilizationDelay: number = 1000,
  selectorTimeout: number = 10000
): Promise<boolean> {
  try {
    // Only wait for the interface element to be available
    await page.waitForSelector(selector, { timeout: selectorTimeout });
    return true;
  } catch (error) {
    return false;
  }
} 
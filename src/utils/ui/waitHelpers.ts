import { Page } from 'puppeteer';
import { LOADING_INDICATORS, FILE_INDICATORS } from '../types';
import { ScreenshotManager } from '../logging/screenshot';

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
    
    console.log('Found loading indicators, waiting for them to disappear...');
    
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
    
    console.log('All loading indicators have disappeared');
    return true;
  } catch (e) {
    console.log('Loading indicators did not disappear within the timeout, continuing anyway');
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
    
    console.log('File indicators found - upload appears complete');
    return true;
  } catch (e) {
    console.log('Could not confirm file upload through UI indicators');
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
  timeout: number = 180000  // Increased from 120000 to 180000 (3 minutes)
): Promise<string> {
  // Set step context for screenshots
  ScreenshotManager.setStepContext('waiting_for_response');
  
  // Store initial URL for navigation detection
  const initialUrl = page.url();
  console.log(`Waiting for ChatGPT to respond... (timeout: ${timeout/1000}s)`);
  
  // DEBUG: Log more details about the initial state
  console.log(`DEBUG - waitForAssistantResponse start URL: ${initialUrl}`);
  console.log(`DEBUG - Looking for message selector: ${messageSelector}`);
  console.log(`DEBUG - Waiting for button selector: ${sendButtonSelector}`);
  
  try {
    // Take a single screenshot at the start of waiting
    await ScreenshotManager.important(page, 'response-waiting-start');
    
    // Before waiting, check if we're still on the expected page
    const currentUrl = page.url();
    if (currentUrl !== initialUrl) {
      console.log(`DEBUG - WARNING! URL changed before response wait: ${initialUrl} -> ${currentUrl}`);
      
      // Check if we've navigated to a new chat
      if (currentUrl.includes('/new') || currentUrl.includes('/c/new')) {
        console.log(`DEBUG - CRITICAL! Navigation to new chat detected before waiting for response`);
        return 'ERROR: Navigation to new chat detected before receiving response';
      }
    }
    
    // First wait for the send button to become disabled (processing)
    await page.waitForFunction(
      (btnSelector) => {
        const btn = document.querySelector(btnSelector);
        return !btn || btn.getAttribute('disabled') === 'disabled';
      },
      { timeout: 60000 },  // Increased timeout from 30000 to 60000
      sendButtonSelector
    );
    
    // DEBUG: Check if we're still on the project page after button is disabled
    const currentUrlAfterButtonDisabled = page.url();
    console.log(`DEBUG - URL after send button disabled: ${currentUrlAfterButtonDisabled}`);
    
    // Check if we've been redirected to a different page
    if (currentUrlAfterButtonDisabled !== initialUrl) {
      console.log(`DEBUG - ALERT! URL changed after sending message: ${initialUrl} -> ${currentUrlAfterButtonDisabled}`);
      
      // Check if we're still on a chat page at all
      if (!currentUrlAfterButtonDisabled.includes('/g/')) {
        console.log(`DEBUG - CRITICAL! No longer on GPT page after sending message`);
      }
    }
    
    // Don't take a screenshot here - this happens immediately after sending
    
    // Track response progress
    let responseCheckInterval: NodeJS.Timeout | undefined;
    let progressCheckInterval: NodeJS.Timeout | undefined;
    let lastProgressUpdate = Date.now();
    let responseStartTime = Date.now();
    let lastScreenshotTime = Date.now();
    let firstResponseDetected = false;
    
    // This promise will resolve when a response is detected
    const responsePromise = new Promise<string>((resolve, reject) => {
      let lastLength = 0;
      let stableCount = 0;
      let checkCount = 0;
      let maxStableTime = 15000; // 15 seconds of no change by default
      
      // Function to check if the response is complete based on multiple signals
      const isResponseComplete = async (): Promise<boolean> => {
        try {
          // First check if we're still on the same URL/session
          // This would detect if we somehow navigated to a new chat
          const currentUrl = page.url();
          // If URL contains "/new" or "/c/new", we've navigated to a new chat
          if (currentUrl.includes('/new') || currentUrl.includes('/c/new')) {
            console.log(`DEBUG - WARNING! Detected navigation to a new chat session`);
            // We'll consider this complete to prevent further waiting
            return true;
          }
          
          // 1. Check if send button is enabled again (primary signal)
          const sendButtonEnabled = await page.evaluate((selector) => {
            const btn = document.querySelector(selector);
            return btn && !btn.hasAttribute('disabled');
          }, sendButtonSelector);
          
          if (sendButtonEnabled) {
            console.log(`DEBUG - INFO! Send button is enabled again, response is complete`);
            // Take a screenshot when complete (marked as important)
            await ScreenshotManager.important(page, 'response-complete-button-enabled');
            return true;
          }
          
          // 2. Check for "regenerate" button (appears when response is complete)
          const hasRegenerateButton = await page.evaluate(() => {
            return Boolean(
              document.querySelector('button[aria-label="Regenerate"]') || 
              Array.from(document.querySelectorAll('button')).some(btn => 
                btn.textContent && btn.textContent.includes('Regenerate')
              )
            );
          });
          
          if (hasRegenerateButton) {
            console.log(`DEBUG - INFO! Regenerate button detected, response is complete`);
            // No need for a separate screenshot here
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
            console.log(`DEBUG - INFO! Continue button detected, response is partially complete`);
            // No need for a screenshot here either
            maxStableTime = 5000; // 5 seconds
          }
          
          return false;
        } catch (err) {
          console.log(`DEBUG - WARNING! Error in response check, assuming not complete:`, err);
          return false;
        }
      };
      
      // Main check interval (every 5 seconds)
      responseCheckInterval = setInterval(async () => {
        try {
          checkCount++;
          
          // First check if the current URL is still what we expect
          const currentUrl = page.url();
          if (currentUrl !== initialUrl) {
            console.log(`DEBUG - WARNING! Page URL changed during response check: ${initialUrl} -> ${currentUrl}`);
            
            // If we've completely navigated away to a new chat
            if (currentUrl.includes('/new') || currentUrl.includes('/c/new')) {
              console.log(`DEBUG - CRITICAL! Detected navigation to a new chat during response check`);
              
              // Try to get whatever partial response we had
              let partialResponse = '';
              try {
                // Check if we're still on ChatGPT domain
                if (currentUrl.includes('chat.openai.com') || currentUrl.includes('chatgpt.com')) {
                  // Take a screenshot to see what happened
                  await ScreenshotManager.error(page, 'navigation-to-new-chat');
                  
                  // Get any partial response from before the navigation
                  partialResponse = await getLatestResponse();
                }
              } catch (err) {
                console.log(`DEBUG - ERROR! Error getting partial response after navigation:`, err);
              }
              
              resolve(partialResponse || 'ERROR: Navigation to new chat detected during response');
              return;
            }
          }
          
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
            
            // Take one progress screenshot only if:
            // 1. It's been more than 60 seconds since the last screenshot
            // 2. And we have substantial text (at least 100 chars)
            const currentTime = Date.now();
            if (currentLength > 100 && currentTime - lastScreenshotTime > 60000) {
              await ScreenshotManager.debug(page, 'response-progress');
              lastScreenshotTime = currentTime;
            }
            
            // Log progress only for significant changes (25%+ increase) or every 4th check
            if (currentLength > lastLength * 1.25 || checkCount % 4 === 0) {
              console.log(`DEBUG - INFO! Response in progress: ~${currentLength} chars`);
              lastProgressUpdate = Date.now();
            }
            
            // Check if response has stopped growing
            if (currentLength > 0 && currentLength === lastLength) {
              stableCount++;
              const stableTime = stableCount * 5000; // 5 seconds per check
              
              // If text hasn't changed for specified time, consider it complete
              if (stableTime >= maxStableTime) {
                console.log(`DEBUG - INFO! Response stable for ${stableTime/1000}s and is ${currentLength} chars`);
                // Take a final screenshot when response is stable (marked as important)
                await ScreenshotManager.important(page, 'response-complete-stable');
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
              console.log(`DEBUG - INFO! Progress detected: ~${responseText.length} chars`);
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
          console.log(`DEBUG - WARNING! No progress for ${noProgressTime/1000}s, returning current response`);
          // Take screenshot when timing out (marked as important since it's an error condition)
          await ScreenshotManager.important(page, 'response-timeout-no-progress');
          const finalResponse = await getLatestResponse();
          resolve(finalResponse || '');
        }
      }, 1000);
      
      // Helper function to get the latest response text
      async function getLatestResponse(): Promise<string> {
        try {
          // First try using the selector to get all messages
          const assistantMessages = await page.$$eval(messageSelector, (elements: Element[]) => {
            if (!elements || elements.length === 0) return '';
            
            // Get the latest message
            const latest = elements[elements.length - 1];
            return latest ? latest.textContent || '' : '';
          });
          
          if (assistantMessages && assistantMessages.trim() !== '') {
            return assistantMessages;
          }
          
          // If that fails, try a more general approach to find any assistant messages
          console.log(`DEBUG - INFO! Using backup method to find assistant messages`);
          return page.evaluate(() => {
            // Look for messages with specific author role
            const assistantElements = document.querySelectorAll('[data-message-author-role="assistant"]');
            if (assistantElements && assistantElements.length > 0) {
              return assistantElements[assistantElements.length - 1].textContent || '';
            }
            
            // Look for messages with specific styling or classes common to assistant messages
            const possibleAssistantMessages = document.querySelectorAll('.markdown, .ai-message, .assistant-message');
            if (possibleAssistantMessages && possibleAssistantMessages.length > 0) {
              return possibleAssistantMessages[possibleAssistantMessages.length - 1].textContent || '';
            }
            
            return '';
          });
        } catch (error) {
          console.log(`DEBUG - WARNING! Error getting response text:`, error);
          return '';
        }
      }
    });
    
    // Create a timeout promise
    const timeoutPromise = new Promise<string>((_, reject) => {
      setTimeout(async () => {
        // Take a screenshot before timing out (marked as important)
        await ScreenshotManager.important(page, 'response-global-timeout', true);
        reject(new Error(`Waiting for assistant response timed out after ${timeout}ms`));
      }, timeout);
    });
    
    // Set up a navigation listener to detect page changes
    let hasNavigated = false;
    page.once('framenavigated', async (frame) => {
      // Only care about main frame navigations
      if (frame === page.mainFrame()) {
        const newUrl = page.url();
        // If it's a navigation to a new chat, or any significant URL change
        if (newUrl !== initialUrl) {
          hasNavigated = true;
          console.log(`DEBUG - WARNING! Page navigation detected during response wait: ${initialUrl} -> ${newUrl}`);
          // Don't resolve/reject here - let the check interval handle it
        }
      }
    });
    
    // Race the response detection against timeout
    try {
      const response = await Promise.race([responsePromise, timeoutPromise]);
      
      // Clean up intervals
      clearInterval(responseCheckInterval);
      clearInterval(progressCheckInterval);
      
      // Check if we've navigated unintentionally
      if (hasNavigated) {
        console.log(`DEBUG - WARNING! Response completed after page navigation - please verify the response is complete`);
      }
      
      // Take one final screenshot with the full response (marked as important)
      await ScreenshotManager.important(page, 'response-received-final');
      
      // Update step context
      ScreenshotManager.setStepContext('response_received');
      
      return response;
    } catch (error) {
      clearInterval(responseCheckInterval);
      clearInterval(progressCheckInterval);
      throw error;
    }
  } catch (error) {
    console.log(`DEBUG - ERROR! Error waiting for assistant response:`, error);
    
    // Take error screenshot
    await ScreenshotManager.error(page, 'response-waiting-error', String(error));
    
    // Last attempt to get partial response
    try {
      const partialResponse = await page.$$eval(messageSelector, (elements: Element[]) => {
        const latest = elements[elements.length - 1];
        return latest ? latest.textContent || '' : '';
      });
      
      if (partialResponse) {
        console.log(`DEBUG - INFO! Returning partial response (${partialResponse.length} chars) due to timeout`);
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
 * Wait for chat interface element to be available
 * This function simply verifies the chat interface is available
 */
export async function verifyPageInterface(
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
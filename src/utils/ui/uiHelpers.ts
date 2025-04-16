import { Page } from 'puppeteer';
import { uploadLogger } from '../logger';
import { ScreenshotManager } from '../screenshot';
import { SELECTORS } from '../types';
import { ErrorContext } from '../errorContext';

// Create error context for this file
const errorContext = new ErrorContext(__filename, uploadLogger);

/**
 * Enters text into a textarea
 */
export async function enterText(page: Page, selector: string, text: string): Promise<void> {
  try {
    // Log the text length and sample for debugging
    const textPreview = text.length > 30 ? `${text.substring(0, 30)}...` : text;
    const lineCount = text.split('\n').length;
    uploadLogger.debug(`Entering text: ${textPreview} (${text.length} chars, ${lineCount} lines)`);
    
    // Wait for the element to be available
    await page.waitForSelector(selector, { timeout: 15000 });
    
    // Focus and clear the textarea
    await page.focus(selector);
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    
    // Ensure we wait long enough for the text field to clear
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Trying multiple approaches in sequence:
    
    // APPROACH 1: Direct DOM manipulation with React event simulation
    let success = await page.evaluate((sel, inputText) => {
      try {
        const textarea = document.querySelector(sel);
        if (!textarea) return false;
        
        // Disable any auto-submit behavior first
        const preventAutoSubmit = () => {
          const originalKeyDown = window.onkeydown;
          // Override default keydown behavior to prevent Enter from submitting
          window.onkeydown = function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.stopPropagation();
              return false;
            }
            return originalKeyDown ? originalKeyDown.call(window, e) : true;
          };
          
          // Restore after a short time
          setTimeout(() => {
            window.onkeydown = originalKeyDown;
          }, 1000);
        };
        
        // Apply the prevention
        preventAutoSubmit();
        
        // Set the value directly and focus
        // @ts-ignore
        textarea.value = inputText;
        // @ts-ignore
        textarea.focus();
        
        // Create proper synthetic events for React
        const createEvent = (type: string) => {
          const event = new Event(type, { bubbles: true });
          // Add properties that React uses to detect user input
          Object.defineProperty(event, 'target', { value: textarea });
          Object.defineProperty(event, 'currentTarget', { value: textarea });
          return event;
        };
        
        // Dispatch events in the proper sequence for React - avoid keypress events that might trigger submission
        ['focus', 'input', 'change'].forEach(eventType => {
          textarea.dispatchEvent(createEvent(eventType));
        });
        
        return true;
      } catch (err) {
        console.error('Failed to set text value:', err);
        return false;
      }
    }, selector, text);
    
    // Verify if this approach worked
    const valueAfterFirstApproach = await page.$eval(selector, (el: any) => el.value || '');
    if (valueAfterFirstApproach && valueAfterFirstApproach.trim() !== '') {
      uploadLogger.debug('Text entry succeeded using direct DOM manipulation');
      success = true;
    } else {
      uploadLogger.warn('Direct DOM manipulation failed, trying click and type approach');
      success = false;
    }
    
    if (!success) {
      // APPROACH 2: Click and type directly with keyboard events
      await page.click(selector);
      await page.keyboard.down('Control');
      await page.keyboard.press('a');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      
      // Wait to ensure field is cleared
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Type character by character with a slight delay
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '\n') {
          // Use Shift+Enter for newlines to prevent form submission
          await page.keyboard.down('Shift');
          await page.keyboard.press('Enter');
          await page.keyboard.up('Shift');
        } else {
          await page.keyboard.type(char, { delay: 5 });
        }
        
        if (i % 100 === 0 && i > 0) {
          // Take a small pause every 100 characters
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      
      // Press Tab then Shift+Tab to ensure text is committed
      await page.keyboard.press('Tab');
      await page.keyboard.down('Shift');
      await page.keyboard.press('Tab');
      await page.keyboard.up('Shift');
      
      // Allow react to process the input events
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Final verification after all attempts
    const inputValue = await page.$eval(selector, (el: any) => el.value || '');
    
    if (!inputValue || inputValue.trim() === '') {
      // Take screenshot to see the state
      await ScreenshotManager.debug(page, "text-entry-failure");
      uploadLogger.warn('Text entry verification failed - textarea value is empty or whitespace');
    } else if (inputValue.length < text.length * 0.9) { // Allow for some truncation/difference
      uploadLogger.warn(`Text entry truncated: ${inputValue.length} chars vs expected ${text.length}`);
    } else {
      uploadLogger.debug(`Text entry successful: ${inputValue.length} chars entered`);
    }
  } catch (error) {
    errorContext.logError(`Could not enter text in selector "${selector}"`, error, {
      selector,
      textLength: text?.length,
      action: 'enterText'
    });
    throw new Error(`Could not enter text: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Verify text was entered correctly
 */
export async function verifyTextEntry(page: Page, selector: string): Promise<boolean> {
  try {
    const inputValue = await page.$eval(selector, (el: any) => el.value);
    if (!inputValue || inputValue.trim() === '') {
      uploadLogger.warn('Warning: Element value appears empty, but text may still be visually entered');
      
      // Additional debug to check what's actually showing in the DOM
      const visualTextContent = await page.$eval(selector, (el: any) => {
        return {
          value: el.value, 
          innerText: el.innerText, 
          textContent: el.textContent,
          innerHTML: el.innerHTML,
          placeholder: el.getAttribute('placeholder'),
          isVisible: el.offsetParent !== null
        };
      });
      uploadLogger.debug(`Visual text check: ${JSON.stringify(visualTextContent)}`);
      
      // Take screenshot to see what's actually rendering
      await ScreenshotManager.debug(page, "text-verification-debug");
      
      return false;
    }
    uploadLogger.debug(`Text verified in textarea: ${inputValue.substring(0, 50)}${inputValue.length > 50 ? '...' : ''}`);
    return true;
  } catch (error) {
    errorContext.logError(`Could not verify text entry for selector "${selector}"`, error, {
      selector,
      action: 'verifyTextEntry'
    });
    // Take screenshot on verification error
    await ScreenshotManager.error(page, "text-verification-error");
    return false;
  }
}

/**
 * Clicks a button using multiple strategies if needed
 */
export async function clickButton(page: Page, selector: string, retries: number = 1): Promise<boolean> {
  let success = false;
  
  for (let attempt = 0; attempt < retries && !success; attempt++) {
    try {
      // Regular click
      await page.click(selector);
      success = true;
      uploadLogger.debug(`Clicked button ${selector} on attempt ${attempt + 1}`);
    } catch (clickError) {
      // Try JavaScript click as fallback
      try {
        await page.evaluate((sel) => {
          const button = document.querySelector(sel);
          if (button && button instanceof HTMLElement) {
            button.click();
            return true;
          }
          return false;
        }, selector);
        
        success = true;
        uploadLogger.debug(`Used JavaScript to click button ${selector} on attempt ${attempt + 1}`);
      } catch (jsError) {
        if (attempt === retries - 1) {
          uploadLogger.warn(`Failed to click button ${selector} after ${retries} attempts`);
        }
      }
    }
    
    if (!success && attempt < retries - 1) {
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return success;
}

/**
 * Find elements that match a text pattern
 */
export async function findElementsByText(page: Page, text: string, elementTypes: string[] = ['div', 'span', 'button', 'a', 'li']): Promise<any[]> {
  return page.evaluate((searchText, types) => {
    const elements = Array.from(document.querySelectorAll(types.join(', ')));
    return elements
      .filter(el => {
        const content = el.textContent?.trim() || '';
        return content.includes(searchText);
      })
      .map(el => {
        const rect = el.getBoundingClientRect();
        return {
          text: el.textContent,
          visible: rect.width > 0 && rect.height > 0,
          tagName: el.tagName.toLowerCase()
        };
      });
  }, text, elementTypes);
}

/**
 * Check if a button is enabled
 */
export async function isButtonEnabled(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const btn = document.querySelector(sel) as HTMLButtonElement;
    return btn && !btn.hasAttribute('disabled') && !btn.disabled;
  }, selector);
}

/**
 * Try to enable a disabled button by triggering events on a related input field
 */
export async function tryEnableButton(page: Page, buttonSelector: string, inputSelector: string): Promise<boolean> {
  // Trigger input events to enable the button
  await page.evaluate((inputSel) => {
    const input = document.querySelector(inputSel);
    if (input) {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, inputSelector);
  
  // Wait for the button to possibly enable
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Check if it's enabled now
  return isButtonEnabled(page, buttonSelector);
}

/**
 * Find a send button or alternative buttons that might function as send
 */
export async function findSendButton(page: Page): Promise<{ found: boolean, selector: string }> {
  try {
    // Try the standard selector first
    await page.waitForSelector(SELECTORS.SEND_BUTTON, { timeout: 5000 });
    return { found: true, selector: SELECTORS.SEND_BUTTON };
  } catch (e) {
    // Look for alternative buttons
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
          hasArrowIcon: btn.innerHTML.includes('arrow')
        }));
    });
    
    if (altButtons.length > 0) {
      // Prefer buttons with arrow icons as they're likely send buttons
      const selector = altButtons.some(b => b.hasArrowIcon) 
        ? 'button:has(svg)' 
        : 'button';
      
      return { found: true, selector };
    }
    
    return { found: false, selector: SELECTORS.SEND_BUTTON };
  }
}

/**
 * Wait for a button to change state (enabled/disabled)
 */
export async function waitForButtonState(
  page: Page, 
  selector: string, 
  targetState: 'enabled' | 'disabled',
  timeout: number = 10000
): Promise<boolean> {
  try {
    await page.waitForFunction(
      (sel, state) => {
        const btn = document.querySelector(sel) as HTMLButtonElement;
        if (!btn) return state === 'disabled'; // No button = effectively disabled
        
        const isDisabled = btn.disabled || btn.hasAttribute('disabled');
        return state === 'disabled' ? isDisabled : !isDisabled;
      },
      { timeout },
      selector,
      targetState
    );
    return true;
  } catch (e) {
    uploadLogger.warn(`Button did not reach ${targetState} state within timeout`);
    return false;
  }
} 
import { Page } from 'puppeteer';
import { ScreenshotManager } from '../logging/screenshot';
import { SELECTORS } from '../types';

/**
 * Core text entry module for handling ChatGPT interactions
 */

/**
 * Inserts text directly into DOM with proper formatting
 */
export async function insertTextDirectly(page: Page, text: string, selector: string = SELECTORS.TEXTAREA): Promise<void> {
  await page.evaluate((selector) => {
    const editor = document.querySelector(selector);
    if (editor) editor.innerHTML = '';
  }, selector);
  
  await pause(300);
  
  await page.evaluate((selector, textToEnter) => {
    const editor = document.querySelector(selector);
    if (!editor) return false;
    
    try {
      // Format with proper paragraph tags
      const html = textToEnter
        .split('\n')
        .map(line => `<p>${line || '<br>'}</p>`)
        .join('');
      
      editor.innerHTML = html;
      (editor as HTMLElement).focus();
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
      return true;
    } catch (error) {
      console.error("Error inserting text:", error);
      return false;
    }
  }, selector, text);
  
  console.log('Direct text insertion completed');
}

/**
 * Gets the current textarea content
 */
export async function getTextAreaContent(page: Page, selector: string = SELECTORS.TEXTAREA): Promise<string> {
  return await page.evaluate((selector) => {
    const editor = document.querySelector(selector);
    if (!editor) return '';
    
    return (editor as HTMLElement).innerText || 
           editor.textContent || 
           editor.innerHTML.replace(/<[^>]*>/g, '').trim();
  }, selector);
}

/**
 * Sets textarea value directly
 */
export async function directValueSetting(page: Page, text: string, selector: string = SELECTORS.TEXTAREA): Promise<void> {
  await page.evaluate((selector, text) => {
    const textarea = document.querySelector(selector);
    if (textarea) {
      // @ts-ignore
      textarea.value = text;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, selector, text);
}

/**
 * Clears the textarea content
 */
export async function clearTextArea(page: Page, selector: string = SELECTORS.TEXTAREA): Promise<void> {
  await page.evaluate((selector) => {
    const editor = document.querySelector(selector);
    if (editor) editor.innerHTML = '';
  }, selector);
}

/**
 * Simulates typing with natural-looking delays
 */
export async function simulateTyping(page: Page, text: string): Promise<void> {
  const baseDelay = 5; // milliseconds
  const paragraphs = text.split('\n');
  
  for (let p = 0; p < paragraphs.length; p++) {
    const paragraph = paragraphs[p];
    
    for (let i = 0; i < paragraph.length; i++) {
      const char = paragraph[i];
      await page.keyboard.type(char);
      
      // Calculate delay based on character type
      let delay = baseDelay;
      if ('.!?,:;'.includes(char)) {
        delay = baseDelay * (1.2 + Math.random() * 0.8);
      } else {
        delay = baseDelay * (0.5 + Math.random() * 0.5);
      }
      
      // Occasionally add a longer pause
      if (Math.random() < 0.01) {
        delay = baseDelay * (2 + Math.random() * 2);
      }
      
      await pause(delay);
    }
    
    // Add newline between paragraphs
    if (p < paragraphs.length - 1) {
      await page.keyboard.press('Enter');
      await pause(baseDelay * 2);
    }
  }
}

/**
 * Verifies text was entered correctly, with recovery attempts
 */
export async function verifyTextEntry(page: Page, message: string, selector: string = SELECTORS.TEXTAREA): Promise<void> {
  await pause(2000); // Wait for DOM updates
  
  const textareaContent = await getTextAreaContent(page, selector);
  
  if (!textareaContent || textareaContent.length < message.length * 0.9) {
    console.warn(`Text may not be fully entered: ${textareaContent.length} vs expected ${message.length} chars`);
    ScreenshotManager.setStepContext('text_entry_fallback');
    
    // Try a different approach
    console.info("Text entry incomplete, trying direct value setting...");
    await directValueSetting(page, message, selector);
    await pause(1500);
  } else {
    console.info(`Text verified (${textareaContent.length} chars) before proceeding`);
  }
}

/**
 * Types text with simulated typing and fallback to direct insertion
 */
export async function typeTextWithFallback(page: Page, text: string, selector: string = SELECTORS.TEXTAREA): Promise<void> {
  console.info('Typing text into ChatGPT...');
  
  try {
    // Try simulated typing first
    await page.focus(selector);
    await clearTextArea(page, selector);
    await simulateTyping(page, text);
    console.info('Simulated typing completed');
  } catch (typingError) {
    // Fall back to direct insertion
    console.warn('Error during simulated typing, falling back to direct insertion');
    await insertTextDirectly(page, text, selector);
  }
}

/**
 * Helper function for pausing execution
 */
export async function pause(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
} 
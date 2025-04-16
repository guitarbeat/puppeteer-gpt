import { Page } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Utility for managing screenshots
 */
export class ScreenshotManager {
  private static baseScreenshotsDir = 'screenshots';
  private static currentSessionDir: string | null = null;
  private static currentRowNumber: number | null = null;
  private static stepContext: string | null = null;
  
  /**
   * Initialize a new session directory with timestamp
   */
  static initializeSession(): string {
    // Create base screenshots directory if it doesn't exist
    if (!fs.existsSync(this.baseScreenshotsDir)) {
      fs.mkdirSync(this.baseScreenshotsDir, { recursive: true });
    }
    
    // Create a new session directory with timestamp
    const now = new Date();
    const formattedDate = now.toLocaleDateString('en-US', { 
      month: '2-digit', 
      day: '2-digit',
      year: '2-digit' 
    }).replace(/\//g, '-');
    
    const formattedTime = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).replace(/:/g, '-').replace(/\s/g, '').toLowerCase();
    
    this.currentSessionDir = `session_${formattedDate}_${formattedTime}`;
    const sessionPath = path.join(this.baseScreenshotsDir, this.currentSessionDir);
    
    if (!fs.existsSync(sessionPath)) {
      fs.mkdirSync(sessionPath, { recursive: true });
      console.log(`Created new screenshot session: ${this.currentSessionDir}`);
    }
    
    return sessionPath;
  }
  
  /**
   * Set the current row being processed for better screenshot naming
   */
  static setCurrentRow(rowNumber: number | null): void {
    this.currentRowNumber = rowNumber;
  }
  
  /**
   * Get the current row being processed
   */
  static getCurrentRow(): number | null {
    return this.currentRowNumber;
  }
  
  /**
   * Set the current step or context for better screenshot naming
   */
  static setStepContext(context: string | null): void {
    this.stepContext = context;
  }
  
  /**
   * Ensure the screenshots directory exists, including row subdirectory if applicable
   */
  static ensureScreenshotDirectory(): string {
    // If no session directory exists yet, create one
    if (!this.currentSessionDir) {
      return this.initializeSession();
    }
    
    // First ensure the session directory exists
    const sessionPath = path.join(this.baseScreenshotsDir, this.currentSessionDir);
    if (!fs.existsSync(sessionPath)) {
      fs.mkdirSync(sessionPath, { recursive: true });
    }
    
    // If we have a row number, create a subdirectory for this row
    if (this.currentRowNumber !== null) {
      const rowPath = path.join(sessionPath, `row${this.currentRowNumber}`);
      if (!fs.existsSync(rowPath)) {
        fs.mkdirSync(rowPath, { recursive: true });
      }
      return rowPath;
    }
    
    return sessionPath;
  }
  
  /**
   * Take a screenshot and save it
   * @param page Puppeteer page to screenshot
   * @param prefix Prefix to add to the filename
   * @param fullPage Whether to take a full page screenshot
   * @param logToConsole Whether to log the screenshot path to console
   * @returns Path to the saved screenshot
   */
  static async takeScreenshot(
    page: Page, 
    prefix: string, 
    fullPage = false,
    logToConsole = true
  ): Promise<string> {
    const screenshotDir = this.ensureScreenshotDirectory();
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(11, 19); // Just use time HH-MM-SS
    
    // Build a more descriptive filename, but without row number since it's in the directory structure
    let filename = '';
    
    // Add step context if available
    if (this.stepContext) {
      filename += `${this.stepContext}_`;
    }
    
    // Add the original prefix and timestamp
    filename += `${prefix}-${timestamp}.png`;
    
    const screenshotPath = path.join(screenshotDir, filename);
    
    await page.screenshot({ 
      path: screenshotPath, 
      fullPage 
    });
    
    if (logToConsole) {
      console.log(`Screenshot saved to ${screenshotPath}`);
    }
    
    return screenshotPath;
  }
  
  /**
   * Take an error screenshot with logging
   * @param page Puppeteer page to screenshot
   * @param errorType Type of error for the filename
   * @param details Error details to log
   * @param logToConsole Whether to log the error to console
   * @returns Path to the saved screenshot
   */
  static async takeErrorScreenshot(
    page: Page, 
    errorType: string, 
    details?: string,
    logToConsole = true
  ): Promise<string> {
    if (logToConsole && details) {
      console.error(`Error [${errorType}]: ${details}`);
    }
    
    const screenshotPath = await this.takeScreenshot(
      page, 
      `error-${errorType}`, 
      true,
      false // Don't log within takeScreenshot
    );
    
    if (logToConsole) {
      console.error(`Error screenshot saved to ${screenshotPath}`);
    }
    
    return screenshotPath;
  }
  
  /**
   * Take an error screenshot for a retry attempt
   * @param page Puppeteer page
   * @param rowNum Row number
   * @param retryCount Current retry count
   * @param logToConsole Whether to log to console
   * @returns Path to the saved screenshot
   */
  static async takeRetryErrorScreenshot(
    page: Page,
    rowNum: number,
    retryCount: number,
    logToConsole = true
  ): Promise<string> {
    return this.takeErrorScreenshot(
      page,
      `row${rowNum}-retry${retryCount}`,
      undefined,
      logToConsole
    );
  }
  
  /**
   * Get the current session directory
   * @returns The path to the current session directory or null if not initialized
   */
  static getCurrentSessionDir(): string | null {
    if (!this.currentSessionDir) {
      return null;
    }
    
    return path.join(this.baseScreenshotsDir, this.currentSessionDir);
  }
} 
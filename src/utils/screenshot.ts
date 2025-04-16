import { Page } from 'puppeteer';
import fs from 'fs';
import path from 'path';

/**
 * Utility for managing screenshots
 */
export class ScreenshotManager {
  private static screenshotsDir = 'screenshots';
  
  /**
   * Ensure the screenshots directory exists
   */
  static ensureScreenshotDirectory(): void {
    if (!fs.existsSync(this.screenshotsDir)) {
      fs.mkdirSync(this.screenshotsDir, { recursive: true });
      console.log(`Created ${this.screenshotsDir} directory`);
    }
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
    this.ensureScreenshotDirectory();
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${prefix}-${timestamp}.png`;
    const screenshotPath = path.join(this.screenshotsDir, filename);
    
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
} 
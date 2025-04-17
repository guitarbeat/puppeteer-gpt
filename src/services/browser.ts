import puppeteer, { Page, Browser, PuppeteerLaunchOptions } from 'puppeteer';
import { launchBrowser } from '../core/puppeteer';
import { AuthService } from './auth';
import { ScreenshotManager } from '../utils/logging/screenshot';
import * as fs from 'fs';
import * as path from 'path';
import { appConfig, authConfig } from '../config/appConfig';

/**
 * Get responsive dimensions based on screen size
 * @returns Appropriate width and height for the browser window
 */
function getResponsiveDimensions(): { width: number, height: number } {
  try {
    // Try to get screen dimensions from environment if available
    // This works in many environments but not all
    const { execSync } = require('child_process');
    
    if (process.platform === 'darwin') {
      // macOS
      const result = execSync('system_profiler SPDisplaysDataType | grep Resolution').toString();
      const match = result.match(/Resolution: (\d+) x (\d+)/);
      
      if (match && match[1] && match[2]) {
        const screenWidth = parseInt(match[1], 10);
        const screenHeight = parseInt(match[2], 10);
        
        // Use 80% of screen width and height
        return {
          width: Math.floor(screenWidth * 0.8),
          height: Math.floor(screenHeight * 0.8)
        };
      }
    } else if (process.platform === 'win32') {
      // Windows
      const result = execSync('wmic desktopmonitor get screenwidth, screenheight').toString();
      const dimensions = result.trim().split('\n')[1].trim().split(/\s+/);
      
      if (dimensions.length >= 2) {
        const screenWidth = parseInt(dimensions[0], 10);
        const screenHeight = parseInt(dimensions[1], 10);
        
        return {
          width: Math.floor(screenWidth * 0.8),
          height: Math.floor(screenHeight * 0.8)
        };
      }
    } else if (process.platform === 'linux') {
      // Linux
      const result = execSync('xrandr | grep "\\*" | cut -d" " -f4').toString();
      const dimensions = result.trim().split('x');
      
      if (dimensions.length >= 2) {
        const screenWidth = parseInt(dimensions[0], 10);
        const screenHeight = parseInt(dimensions[1], 10);
        
        return {
          width: Math.floor(screenWidth * 0.8),
          height: Math.floor(screenHeight * 0.8)
        };
      }
    }
    
    // Default to config if detection fails
    return {
      width: appConfig.browser.width,
      height: appConfig.browser.height
    };
  } catch (error) {
    console.warn('Could not detect screen size, using default dimensions', error);
    return {
      width: appConfig.browser.width,
      height: appConfig.browser.height
    };
  }
}

/**
 * Service that manages browser initialization and page setup
 */
export class BrowserService {
  private page: Page | null = null;
  private browser: any = null;

  /**
   * Initialize the browser and set up the page
   */
  async initialize(width?: number, height?: number): Promise<Page> {
    // Get dimensions - use explicitly provided values or default to config
    const dimensions = width && height 
      ? { width, height }
      : { width: appConfig.browser.width, height: appConfig.browser.height };
    
    console.info(`Initializing browser (${dimensions.width}x${dimensions.height})`);
    const { page, browser } = await launchBrowser({
      width: dimensions.width,
      height: dimensions.height,
      headless: appConfig.browser.headless,
      incognito: appConfig.browser.incognito,
    });

    page.setViewport({ width: dimensions.width, height: dimensions.height });
    this.page = page;
    this.browser = browser;
    
    console.debug('Browser initialized successfully');
    return page;
  }

  /**
   * Resize the browser window
   * @param width New width for the browser window
   * @param height New height for the browser window
   */
  async resizeBrowser(width: number, height: number): Promise<void> {
    if (!this.page) {
      console.warn('Cannot resize browser: No page initialized');
      return;
    }

    try {
      console.info(`Resizing browser to ${width}x${height}`);
      
      // Set the viewport size
      await this.page.setViewport({ width, height });
      
      // Determine if these are mobile dimensions
      const isMobile = width <= 480; // Common mobile breakpoint
      
      // Resize the actual window (if not in headless mode)
      const session = await this.page.target().createCDPSession();
      await session.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: isMobile
      });
      
      console.info(`Browser resized to ${width}x${height}${isMobile ? ' (mobile)' : ''}`);
    } catch (error) {
      console.error('Failed to resize browser', error);
    }
  }

  /**
   * Load cookies from the saved cookie file
   */
  async loadCookies(page: Page): Promise<void> {
    try {
      const cookiesPath = path.join(process.cwd(), authConfig.cookiePath);
      if (!fs.existsSync(cookiesPath)) {
        console.warn('No cookies file found, skipping cookie loading');
        return;
      }
      
      console.debug(`Loading cookies from ${cookiesPath}`);
      const cookiesString = fs.readFileSync(cookiesPath, 'utf8');
      const cookies = JSON.parse(cookiesString);
      await page.setCookie(...cookies);
      console.info('Cookies loaded successfully');
    } catch (error) {
      console.error('Error loading cookies', error);
      // Continue without cookies - authentication will handle this
    }
  }

  /**
   * Wait for the chat interface to load
   */
  async waitForChatInterface(page: Page): Promise<boolean> {
    // Check for subscription error - If this is found, we'll continue anyway
    try {
      const errorMsgSelector = "div.text-red-500, div[role='alert']";
      const errorElement = await page.$(errorMsgSelector);
      if (errorElement) {
        const errorText = await errorElement.evaluate(el => el.textContent);
        console.warn(`Detected warning message: ${errorText}`);
        console.info('Continuing despite subscription warning...');
      }
      
      // Wait for the chat interface elements
      console.info('Looking for chat interface elements...');
      const selectors = [
        "#prompt-textarea",
        "[data-testid='send-button']",
        "button[aria-label='Upload files and more']"
      ];
      
      // Wait for any of these selectors to appear
      const element = await Promise.any(
        selectors.map(selector => 
          page.waitForSelector(selector, { timeout: appConfig.timing.pageLoadTimeout })
            .then(el => ({ selector, element: el }))
            .catch(() => null)
        )
      ).catch(() => null);
      
      if (!element) {
        throw new Error("Could not find chat interface elements");
      }
      
      console.info(`Chat interface detected: ${element.selector}`);
      return true;
    } catch (error) {
      await this.saveErrorScreenshot("chat-interface-error", "Failed to detect chat interface");
      console.error('Failed to detect chat interface', error);
      throw new Error(`Failed to detect chat interface: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Navigate to the ChatGPT project URL
   */
  async navigateToChatGPT(page: Page, projectUrl: string): Promise<void> {
    console.info(`Navigating to URL: ${projectUrl}`);
    await page.goto(projectUrl, { 
      waitUntil: "networkidle0",
      timeout: appConfig.timing.pageLoadTimeout
    });

    // Add a small delay to ensure the page is fully loaded
    console.debug('Waiting for page to stabilize...');
    await new Promise(resolve => setTimeout(resolve, appConfig.timing.pageStabilizationDelay));
    console.debug('Navigation complete');
  }

  /**
   * Save screenshot for an error, with enhanced metadata 
   */
  async saveErrorScreenshot(errorType: string, details: string = ''): Promise<string | null> {
    try {
      if (!this.page) {
        return null;
      }
      
      // Use the new error screenshot method instead of the old one
      return await ScreenshotManager.error(this.page, errorType, details);
    } catch (err) {
      // Don't throw an error when trying to capture an error
      console.error('Error taking error screenshot:', err);
      return null;
    }
  }

  /**
   * Close the browser
   */
  async close(): Promise<void> {
    if (this.browser) {
      console.debug('Closing browser...');
      await this.browser.close();
      console.info('Browser closed');
    }
  }
} 
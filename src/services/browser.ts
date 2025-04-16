import { Page } from 'puppeteer';
import { launchBrowser } from '../core/puppeteer';
import { AuthService } from './auth';
import { browserLogger } from '../utils/logger';
import { ScreenshotManager } from '../utils/screenshot';
import fs from 'fs';
import path from 'path';

/**
 * Service that manages browser initialization and page setup
 */
export class BrowserService {
  private page: Page | null = null;
  private browser: any = null;

  /**
   * Initialize the browser and set up the page
   */
  async initialize(width = 480, height = 853): Promise<Page> {
    browserLogger.info(`Initializing browser (${width}x${height})`);
    const { page, browser } = await launchBrowser({
      width,
      height,
      headless: false,
      incognito: true,
    });

    page.setViewport({ width, height });
    this.page = page;
    this.browser = browser;
    
    browserLogger.debug('Browser initialized successfully');
    return page;
  }

  /**
   * Load cookies from the saved cookie file
   */
  async loadCookies(page: Page): Promise<void> {
    try {
      const cookiesPath = path.join(process.cwd(), 'cookies', 'chatgpt.com.cookies.json');
      if (!fs.existsSync(cookiesPath)) {
        browserLogger.warn('No cookies file found, skipping cookie loading');
        return;
      }
      
      browserLogger.debug(`Loading cookies from ${cookiesPath}`);
      const cookiesString = fs.readFileSync(cookiesPath, 'utf8');
      const cookies = JSON.parse(cookiesString);
      await page.setCookie(...cookies);
      browserLogger.success('Cookies loaded successfully');
    } catch (error) {
      browserLogger.error('Error loading cookies', error);
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
        browserLogger.warn(`Detected warning message: ${errorText}`);
        browserLogger.info('Continuing despite subscription warning...');
      }
      
      // Wait for the chat interface elements
      browserLogger.info('Looking for chat interface elements...');
      const selectors = [
        "#prompt-textarea",
        "[data-testid='send-button']",
        "button[aria-label='Upload files and more']"
      ];
      
      // Wait for any of these selectors to appear
      const element = await Promise.any(
        selectors.map(selector => 
          page.waitForSelector(selector, { timeout: 30000 })
            .then(el => ({ selector, element: el }))
            .catch(() => null)
        )
      ).catch(() => null);
      
      if (!element) {
        throw new Error("Could not find chat interface elements");
      }
      
      browserLogger.success(`Chat interface detected: ${element.selector}`);
      return true;
    } catch (error) {
      await this.saveErrorScreenshot(page, "chat-interface-error");
      browserLogger.error('Failed to detect chat interface', error);
      throw new Error(`Failed to detect chat interface: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Navigate to the ChatGPT project URL
   */
  async navigateToChatGPT(page: Page, projectUrl: string): Promise<void> {
    browserLogger.info(`Navigating to URL: ${projectUrl}`);
    await page.goto(projectUrl, { 
      waitUntil: "networkidle0",
      timeout: 60000
    });

    // Add a small delay to ensure the page is fully loaded
    browserLogger.debug('Waiting for page to stabilize...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    browserLogger.debug('Navigation complete');
  }

  /**
   * Save an error screenshot
   */
  async saveErrorScreenshot(page: Page, errorPrefix: string): Promise<string> {
    return await ScreenshotManager.takeErrorScreenshot(
      page,
      errorPrefix,
      undefined,
      false // Don't log from ScreenshotManager
    );
  }

  /**
   * Close the browser
   */
  async close(): Promise<void> {
    if (this.browser) {
      browserLogger.debug('Closing browser...');
      await this.browser.close();
      browserLogger.info('Browser closed');
    }
  }
} 
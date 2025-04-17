import * as fs from 'fs';
import * as path from 'path';
import { Page } from 'puppeteer';
import { waitForUserToContinue } from '../utils/userInput';
import { appConfig, authConfig, AuthConfig } from '../config/appConfig';
import { ErrorContext } from '../utils/logging/errorContext';

// Create error context for this file
const errorContext = new ErrorContext(__filename);

export { AuthConfig } from '../config/appConfig';

export class AuthService {
  private config: AuthConfig;

  constructor(config: AuthConfig = authConfig) {
    this.config = config;
  }

  /**
   * Load cookies from file if they exist
   */
  private async loadCookies(page: Page): Promise<boolean> {
    const { cookiePath } = this.config;
    
    if (fs.existsSync(cookiePath)) {
      try {
        const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
        await page.setCookie(...cookies);
        return true;
      } catch (error) {
        console.warn('Failed to load cookies:', error);
        return false;
      }
    }
    return false;
  }

  /**
   * Save cookies to file
   */
  private async saveCookies(page: Page): Promise<void> {
    const { cookiePath } = this.config;
    const cookies = await page.cookies();
    
    // Ensure directory exists
    const dir = path.dirname(cookiePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
  }

  /**
   * Check if user is already logged in
   */
  private async isLoggedIn(page: Page): Promise<boolean> {
    try {
      await page.waitForSelector(this.config.successSelector, { 
        timeout: 5000 // Keep short timeout for this check
      });
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Check if we're on the login page
   */
  private async isOnLoginPage(page: Page): Promise<boolean> {
    try {
      // Check for email input field and sign in text
      const signInSelectors = [
        'input[type="email"]', 
        'input[placeholder="Email or phone"]',
        'text/Sign in',
        'text/to continue to ChatGPT'
      ];
      
      for (const selector of signInSelectors) {
        if (await page.$(selector)) {
          return true;
        }
      }
      
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Authenticate the user
   * @returns true if authentication was successful
   */
  public async authenticate(page: Page): Promise<boolean> {
    const { loginUrl, successSelector, loginTimeout, screenshotDir } = this.config;

    // Load existing cookies
    const hasCookies = await this.loadCookies(page);
    
    // Navigate to login page
    await page.goto(loginUrl, { waitUntil: 'networkidle2' });

    // Check if already logged in
    if (await this.isLoggedIn(page)) {
      console.log('Successfully logged in using saved cookies');
      return true;
    }
    
    // Check if on login page
    if (await this.isOnLoginPage(page)) {
      console.log('=== LOGIN REQUIRED ===');
      console.log('Please login manually in the browser window');
      
      // Ensure screenshot directory exists
      if (screenshotDir && !fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }
      
      // Take a screenshot to help debug
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const screenshotPath = path.join(screenshotDir || 'screenshots', `login-page-${timestamp}.png`);
      await page.screenshot({ path: screenshotPath });
      console.log(`Login page screenshot saved to ${screenshotPath}`);
      
      // Wait for user to manually login
      console.log('');
      console.log('IMPORTANT: Please complete the login process in the browser window');
      console.log('After logging in successfully, return to this terminal');
      console.log('');
      
      // Wait for manual login with extended timeout
      try {
        console.log(`Waiting up to ${this.config.loginTimeout! / 1000} seconds for manual login...`);
        await page.waitForSelector(successSelector, { 
          timeout: loginTimeout 
        });
        
        // Login successful - save cookies and ask user to confirm
        await this.saveCookies(page);
        console.log('Login successful. Cookies saved.');
        
        // Ask user to confirm before continuing
        await waitForUserToContinue('Login detected. Press Enter to continue with the script...');
        
        return true;
      } catch (error) {
        // Enhanced error logging with context
        errorContext.logError('Login timeout or failed', error, {
          loginUrl: this.config.loginUrl,
          timeout: loginTimeout,
          action: 'authentication',
          successSelector
        });
        
        // Ask if user wants to try again or continue anyway
        console.log('');
        console.log('Login timeout occurred, but you may still be logged in.');
        await waitForUserToContinue('If you completed the login, press Enter to continue anyway...');
        
        // Save cookies regardless, in case login actually succeeded
        await this.saveCookies(page);
        
        // Check again if we're logged in
        if (await this.isLoggedIn(page)) {
          console.log('Login verification successful!');
          return true;
        }
        
        return false;
      }
    }
    
    // Not logged in but not on login page either - could be another error
    console.log('Not on login page but not logged in either. Taking screenshot...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotPath = path.join(screenshotDir || 'screenshots', `auth-error-${timestamp}.png`);
    await page.screenshot({ path: screenshotPath });
    console.log(`Authentication issue screenshot saved to ${screenshotPath}`);
    
    // Ask user what to do
    await waitForUserToContinue('Press Enter to continue anyway, or Ctrl+C to abort...');
    
    return false;
  }
} 
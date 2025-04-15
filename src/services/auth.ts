import fs from 'fs';
import path from 'path';
import { Page } from 'puppeteer';

export interface AuthConfig {
  cookiePath: string;
  loginUrl: string;
  successSelector: string;
  loginTimeout?: number;
}

export class AuthService {
  private config: AuthConfig;

  constructor(config: AuthConfig) {
    this.config = {
      loginTimeout: 30000,
      ...config
    };
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
        timeout: 5000 
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Authenticate the user
   * @returns true if authentication was successful
   */
  public async authenticate(page: Page): Promise<boolean> {
    const { loginUrl, successSelector, loginTimeout } = this.config;

    // Load existing cookies
    const hasCookies = await this.loadCookies(page);
    
    // Navigate to login page
    await page.goto(loginUrl, { waitUntil: 'networkidle2' });

    // Check if already logged in
    if (await this.isLoggedIn(page)) {
      console.log('Successfully logged in using saved cookies');
      return true;
    }

    // Wait for manual login
    console.log('Manual login required. Please log in manually...');
    try {
      await page.waitForSelector(successSelector, { 
        timeout: loginTimeout 
      });
      
      // Save new cookies after successful login
      await this.saveCookies(page);
      console.log('Login successful. Cookies saved.');
      return true;
    } catch (error) {
      console.error('Login timeout or failed:', error);
      return false;
    }
  }
} 
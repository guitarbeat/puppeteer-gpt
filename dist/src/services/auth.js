"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class AuthService {
    constructor(config) {
        this.config = {
            loginTimeout: 30000,
            ...config
        };
    }
    /**
     * Load cookies from file if they exist
     */
    async loadCookies(page) {
        const { cookiePath } = this.config;
        if (fs_1.default.existsSync(cookiePath)) {
            try {
                const cookies = JSON.parse(fs_1.default.readFileSync(cookiePath, 'utf8'));
                await page.setCookie(...cookies);
                return true;
            }
            catch (error) {
                console.warn('Failed to load cookies:', error);
                return false;
            }
        }
        return false;
    }
    /**
     * Save cookies to file
     */
    async saveCookies(page) {
        const { cookiePath } = this.config;
        const cookies = await page.cookies();
        // Ensure directory exists
        const dir = path_1.default.dirname(cookiePath);
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
        fs_1.default.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
    }
    /**
     * Check if user is already logged in
     */
    async isLoggedIn(page) {
        try {
            await page.waitForSelector(this.config.successSelector, {
                timeout: 5000
            });
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Authenticate the user
     * @returns true if authentication was successful
     */
    async authenticate(page) {
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
        }
        catch (error) {
            console.error('Login timeout or failed:', error);
            return false;
        }
    }
}
exports.AuthService = AuthService;

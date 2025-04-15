"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.launchBrowser = void 0;
const puppeteer_extra_1 = __importDefault(require("puppeteer-extra"));
const puppeteer_extra_plugin_stealth_1 = __importDefault(require("puppeteer-extra-plugin-stealth"));
// Add stealth plugin
puppeteer_extra_1.default.use((0, puppeteer_extra_plugin_stealth_1.default)());
/**
 * Launch a puppeteer browser instance with stealth mode
 *
 * @param width  The width of the browser window. Default is `640`
 * @param height  The height of the browser window. Default is `480`
 * @param headless  If `true`, the browser will be launched in headless mode. Default is `true`
 * @param incognito  If `true`, the browser will be launched in incognito mode. Default is `false`
 * @param lang  The language of the browser. Default is `en-US`
 * @param args  Additional arguments to pass to the browser instance
 * @param options  Additional options to pass to the browser instance
 *
 * @returns The browser instance and the first page
 */
const launchBrowser = async ({ width = 640, height = 480, headless = true, incognito = false, lang = "en-US", args = [], ...options }) => {
    const browser = await puppeteer_extra_1.default.launch({
        headless,
        ignoreHTTPSErrors: true,
        timeout: 0,
        protocolTimeout: 0,
        defaultViewport: null,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-infobars",
            "--ignore-certificate-errors",
            "--ignore-certifcate-errors-spki-list",
            `--window-size=${width},${height}`,
            "--window-position=0,0",
            "--mute-audio",
            incognito ? "--incognito" : "",
            lang ? `--lang=${lang}` : "",
            ...args,
        ],
        ...options,
    });
    const [page] = await browser.pages();
    // Set additional stealth configurations
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
    });
    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    page.setDefaultNavigationTimeout(0);
    return {
        browser,
        page,
    };
};
exports.launchBrowser = launchBrowser;

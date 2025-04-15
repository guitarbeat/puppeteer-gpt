"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const puppeteer_1 = require("./src/core/puppeteer");
const auth_1 = require("./src/services/auth");
const auth_2 = require("./src/config/auth");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const testFileUpload = async () => {
    console.log("Starting file upload test...");
    const width = 480;
    const height = 853;
    const { page, browser } = await (0, puppeteer_1.launchBrowser)({
        width,
        height,
        headless: false,
        incognito: true,
    });
    page.setViewport({ width, height });
    try {
        // Initialize auth service
        const authService = new auth_1.AuthService(auth_2.authConfig);
        // Authenticate
        const isAuthenticated = await authService.authenticate(page);
        if (!isAuthenticated) {
            throw new Error('Authentication failed');
        }
        // Load cookies before navigating
        const cookiesPath = path_1.default.join(__dirname, 'cookies', 'chatgpt.com.cookies.json');
        const cookiesString = fs_1.default.readFileSync(cookiesPath, 'utf8');
        const cookies = JSON.parse(cookiesString);
        await page.setCookie(...cookies);
        console.log("Navigating to ChatGPT project...");
        await page.goto("https://chat.openai.com/g/g-p-67f02dae3f508191856fe6de977dadb4-bme-349-hw4/project", {
            waitUntil: "networkidle0",
            timeout: 60000
        });
        // Add a small delay to ensure the page is fully loaded
        await new Promise(resolve => setTimeout(resolve, 2000));
        // Wait for the chat interface elements
        console.log("Looking for chat interface elements...");
        const selectors = [
            "#prompt-textarea",
            "[data-testid='send-button']",
            "button[aria-label='Upload files and more']"
        ];
        // Wait for any of these selectors to appear
        const element = await Promise.any(selectors.map(selector => page.waitForSelector(selector, { timeout: 30000 })
            .then(el => ({ selector, element: el }))
            .catch(() => null))).catch(() => null);
        if (!element) {
            throw new Error("Could not find chat interface elements");
        }
        console.log(`Found element: ${element.selector}`);
        // Test file upload
        const testFilePath = "screenshots/error-2025-04-15T20-12-47-654Z.png";
        console.log(`Testing file upload with: ${testFilePath}`);
        try {
            // Click the upload button
            console.log("Clicking upload button...");
            const uploadButton = await page.waitForSelector("button[aria-label='Upload files and more']");
            await uploadButton?.click();
            // Wait for the upload dialog
            console.log("Waiting for upload dialog...");
            await page.waitForSelector("text/Upload from computer", { timeout: 5000 });
            // Set up file chooser listener before clicking
            console.log("Setting up file chooser...");
            const fileChooserPromise = page.waitForFileChooser();
            await page.click("text/Upload from computer");
            console.log("Handling file chooser...");
            const fileChooser = await fileChooserPromise;
            await fileChooser.accept([testFilePath]);
            // Wait for upload to complete
            console.log("Waiting for upload to complete...");
            try {
                await page.waitForSelector("div[role='progressbar']", { hidden: true, timeout: 30000 });
                console.log("✅ File upload completed successfully");
            }
            catch (error) {
                console.log("⚠️ No progress bar found, but continuing...");
            }
            // Take a screenshot of the result
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const screenshotPath = `screenshots/upload-test-${timestamp}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`Screenshot saved to: ${screenshotPath}`);
        }
        catch (error) {
            console.error("❌ Error during file upload:", error);
            // Take a screenshot of the error state
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const screenshotPath = `screenshots/upload-error-${timestamp}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`Error screenshot saved to: ${screenshotPath}`);
        }
        // Keep the browser open for inspection
        console.log("Test completed. Browser will remain open for inspection...");
        console.log("Press Ctrl+C to close the browser and exit.");
    }
    catch (error) {
        console.error("Test failed:", error);
        await browser.close();
    }
};
// Run the test
testFileUpload();

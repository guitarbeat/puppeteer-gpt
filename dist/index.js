"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const readline_1 = __importDefault(require("readline"));
const puppeteer_1 = require("./src/core/puppeteer");
const auth_1 = require("./src/services/auth");
const auth_2 = require("./src/config/auth");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const readlineInterface = readline_1.default.createInterface({
    input: process.stdin,
    output: process.stdout,
});
/**
 *
 * @param question The question to ask
 * @param timeout  The time in milliseconds to wait for an answer. If no answer is given, it will reject the promise
 * @returns User's input
 */
const input = (question, timeout) => {
    let timer;
    return new Promise((resolve, reject) => {
        readlineInterface.question(question, (answer) => {
            clearTimeout(timer);
            readlineInterface.close();
            resolve(answer);
        });
        if (timeout) {
            timer = setTimeout(() => {
                reject(new Error("Question timeout"));
                readlineInterface.close();
            }, timeout);
        }
    });
};
/**
 * Open ChatGPT and ask questions
 * @param isChat  If true, it will keep asking for questions. If false, it will only ask once. Default is `false`
 * @returns The answer from ChatGPT
 */
const openChatGPT = async (isChat) => {
    console.log("Opening ChatGPT...");
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
        // Wait for the project page to load
        console.log("Waiting for project page to load...");
        try {
            // Check for subscription error - If this is found, we'll continue anyway
            const errorMsgSelector = "div.text-red-500, div[role='alert']";
            const errorElement = await page.$(errorMsgSelector);
            if (errorElement) {
                const errorText = await errorElement.evaluate(el => el.textContent);
                console.log("Warning: Detected error message:", errorText);
                console.log("Continuing despite subscription warning...");
            }
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
        }
        catch (error) {
            console.error("Detailed error:", error);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            // Make sure the screenshots directory exists
            if (!fs_1.default.existsSync('screenshots')) {
                fs_1.default.mkdirSync('screenshots', { recursive: true });
            }
            const screenshotPath = `screenshots/error-${timestamp}.png`;
            console.error(`Error: Could not initialize project chat. Saving screenshot to ${screenshotPath}`);
            await page.screenshot({ path: screenshotPath, fullPage: true });
            await browser.close();
            return Promise.reject(new Error(`Failed to initialize project chat. Screenshot saved to ${screenshotPath}`));
        }
        console.log("ChatGPT project chat is ready!");
        let answer = "";
        do {
            let question;
            try {
                question = await input("Question: ", 60 * 1000);
            }
            catch (error) {
                await browser.close();
                return Promise.reject(error);
            }
            console.log("Processing...");
            // Check if the question contains a file attachment request
            const fileMatch = question.match(/^attach\s+(.+)$/i);
            if (fileMatch) {
                const filePath = fileMatch[1].trim();
                console.log(`Attaching file: ${filePath}`);
                try {
                    // Click the upload button
                    const uploadButton = await page.waitForSelector("button[aria-label='Upload files and more']");
                    await uploadButton?.click();
                    // Wait for the upload dialog
                    await page.waitForSelector("text/Upload from computer", { timeout: 5000 });
                    // Set up file chooser listener before clicking
                    const fileChooserPromise = page.waitForFileChooser();
                    await page.click("text/Upload from computer");
                    const fileChooser = await fileChooserPromise;
                    await fileChooser.accept([filePath]);
                    // Wait for upload to complete
                    try {
                        await page.waitForSelector("div[role='progressbar']", { hidden: true, timeout: 30000 });
                        console.log("File upload completed");
                    }
                    catch (error) {
                        console.log("No progress bar found, but continuing...");
                    }
                    // Clear the question for the next iteration
                    question = "";
                }
                catch (error) {
                    console.error("Error during file upload:", error);
                    // Continue with the chat even if upload fails
                    question = "";
                }
            }
            // Type in the chat textarea if there's a question
            if (question) {
                await page.type("#prompt-textarea", question, {
                    delay: Math.random() * 50,
                });
                // Handle send button
                const btnSend = "[data-testid='send-button']";
                await page.waitForSelector(btnSend);
                const isBtnDisabled = await page.$eval(btnSend, (el) => el.getAttribute("disabled"));
                if (!isBtnDisabled)
                    await page.click(btnSend);
                // Wait for response
                await page.waitForSelector(btnSend, { hidden: true });
                await page.waitForSelector(btnSend);
                const messageEl = "div[data-message-author-role='assistant']";
                await page.waitForSelector(messageEl);
                answer = await page.$$eval(messageEl, (elements) => {
                    const latest = elements[elements.length - 1];
                    return latest.textContent || '';
                });
                console.log("ChatGPT:", answer);
            }
        } while (isChat);
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 100 + 200));
        await browser.close();
        return answer;
    }
    catch (error) {
        await browser.close();
        return Promise.reject(error);
    }
};
// Add `true` as an argument to keep asking questions
openChatGPT();

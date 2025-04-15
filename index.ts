import readline from "readline";
import { launchBrowser } from "./src/core/puppeteer";
import { AuthService } from "./src/services/auth";
import { authConfig } from "./src/config/auth";
import fs from 'fs';
import path from 'path';
import { sendMessageWithAttachments } from './src/utils/sendMessageWithAttachments';

const readlineInterface = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

/**
 *
 * @param question The question to ask
 * @param timeout  The time in milliseconds to wait for an answer. If no answer is given, it will reject the promise
 * @returns User's input
 */
const input = (question: string, timeout?: number) => {
  let timer: NodeJS.Timeout;

  return new Promise<string>((resolve, reject) => {
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
const openChatGPT = async (isChat?: boolean) => {
  console.log("Opening ChatGPT...");

  const width = 480;
  const height = 853;

  const { page, browser } = await launchBrowser({
    width,
    height,
    headless: false,
    incognito: true,
  });

  page.setViewport({ width, height });

  try {
    // Initialize auth service
    const authService = new AuthService(authConfig);
    
    // Authenticate
    const isAuthenticated = await authService.authenticate(page);
    if (!isAuthenticated) {
      throw new Error('Authentication failed');
    }

    // Load cookies before navigating
    const cookiesPath = path.join(__dirname, 'cookies', 'chatgpt.com.cookies.json');
    const cookiesString = fs.readFileSync(cookiesPath, 'utf8');
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
      
      console.log(`Found element: ${element.selector}`);
      
    } catch (error) {
      console.error("Detailed error:", error);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      // Make sure the screenshots directory exists
      if (!fs.existsSync('screenshots')) {
        fs.mkdirSync('screenshots', { recursive: true });
      }
      
      const screenshotPath = `screenshots/error-${timestamp}.png`;
      console.error(`Error: Could not initialize project chat. Saving screenshot to ${screenshotPath}`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      await browser.close();
      return Promise.reject(new Error(`Failed to initialize project chat. Screenshot saved to ${screenshotPath}`));
    }

    console.log("ChatGPT project chat is ready!");

    // Example: Send a message with an attachment
    try {
      const answer = await sendMessageWithAttachments(
        page,
        "Here is a screenshot for context.",
        ['screenshots/error-2025-04-15T20-12-47-654Z.png']
      );
      console.log("ChatGPT:", answer);
    } catch (err) {
      console.error('Failed to send message with attachment:', err);
    }

    let answer: string;

    do {
      let question: string;
      try {
        question = await input("Question: ", 60 * 1000);
      } catch (error) {
        await browser.close();
        return Promise.reject(error);
      }
      console.log("Processing...");

      // Type in the chat textarea
      await page.type("#prompt-textarea", question, {
        delay: Math.random() * 50,
      });

      // Handle send button
      const btnSend = "[data-testid='send-button']";
      await page.waitForSelector(btnSend);
      const isBtnDisabled = await page.$eval(btnSend, (el) =>
        el.getAttribute("disabled")
      );

      if (!isBtnDisabled) await page.click(btnSend);

      // Wait for response
      await page.waitForSelector(btnSend, { hidden: true });
      await page.waitForSelector(btnSend);

      const messageEl = "div[data-message-author-role='assistant']";
      await page.waitForSelector(messageEl);

      answer = await page.$$eval(messageEl, (elements: Element[]) => {
        const latest = elements[elements.length - 1];
        return latest.textContent || '';
      });

      console.log("ChatGPT:", answer);
    } while (isChat);

    await new Promise(
      (resolve) => setTimeout(resolve, Math.random() * 100 + 200)
    );

    await browser.close();

    return answer;
  } catch (error) {
    await browser.close();
    return Promise.reject(error);
  }
};

// Add `true` as an argument to keep asking questions
openChatGPT();


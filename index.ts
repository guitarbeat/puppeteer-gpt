import readline from "readline";
import { launchBrowser } from "./src/core/puppeteer";
import fs from 'fs';
import path from 'path';

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
    headless: true,
    incognito: true,
  });

  page.setViewport({ width, height });
  page.setUserAgent('Mozilla/5.0 (Windows NT 5.1; rv:5.0) Gecko/20100101 Firefox/5.0');

  try {
    // Load cookies before navigating
    const cookiesPath = path.join(__dirname, 'cookies', 'chatgpt.com.cookies.json');
    const cookiesString = fs.readFileSync(cookiesPath, 'utf8');
    const cookies = JSON.parse(cookiesString);
    await page.setCookie(...cookies);

    console.log("Navigating to ChatGPT...");
    await page.goto("https://chat.openai.com/", { waitUntil: "networkidle0" });

    const textArea = "textarea#prompt-textarea";
    console.log("Waiting for chat input to be ready...");
    try {
      await page.waitForSelector(textArea, { timeout: 30000 });
    } catch (error) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const screenshotPath = `screenshots/error-${timestamp}.png`;
      console.error(`Error: Could not find chat input. Saving screenshot to ${screenshotPath}`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      await browser.close();
      return Promise.reject(new Error(`Failed to load ChatGPT interface. Screenshot saved to ${screenshotPath}`));
    }

    console.log("ChatGPT is ready!");
    let answer: string;

    do {
      let question: string;
      try {
        question = await input("Question: ", 60 * 1000); // If no input in 60 seconds, it will timeout and return an error
      } catch (error) {
        await browser.close();
        return Promise.reject(error);
      }
      console.log("Processing...");

      await page.type(textArea, question, {
        delay: Math.random() * 50, // random delay between 0 and 50 ms
      });

      // check is the button is enabled by checking the attribute disabled
      const btnSend = "button[data-testid='send-button']";
      await page.waitForSelector(btnSend);
      const isBtnDisabled = await page.$eval(btnSend, (el: HTMLButtonElement) =>
        el.getAttribute("disabled")
      );

      if (!isBtnDisabled) await page.click(btnSend);

      // check if the button is hidden. Meaning ChatGPT is still answering the question
      await page.waitForSelector(btnSend, { hidden: true });

      // check if the button is visible again. Meaning ChatGPT has answered the question
      await page.waitForSelector(btnSend);

      const messageEl = "div[data-message-author-role='assistant']";
      await page.waitForSelector(messageEl);

      // get the latest message from ChatGPT
      answer = await page.$$eval(messageEl, (elements: Element[]) => {
        const latest = elements[elements.length - 1];
        return latest.textContent || '';
      });

      console.log("ChatGPT:", answer);
    } while (isChat);

    await new Promise(
      (resolve) => setTimeout(resolve, Math.random() * 100 + 200) // random delay between 200 and 300 ms
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

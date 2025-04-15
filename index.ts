import readline from "readline";
import { launchBrowser } from "./src/core/puppeteer";
import { AuthService } from "./src/services/auth";
import { authConfig } from "./src/config/auth";
import { sendMessageWithAttachments } from './src/utils/sendMessageWithAttachments';
import { readCsvPrompts, writeCsvPrompts, CsvPromptRow } from './src/utils/processCsvPrompts';
import fs from 'fs';
import path from 'path';

// Ensure screenshots directory exists
if (!fs.existsSync('screenshots')) {
  fs.mkdirSync('screenshots', { recursive: true });
  console.log('Created screenshots directory');
}

const readlineInterface = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

/**
 * Process a CSV file containing prompts and attachments
 * @param csvPath Path to the CSV file
 * @param page Puppeteer page
 */
async function processCsvWorkflow(csvPath: string, page: any) {
  console.log(`Processing CSV file: ${csvPath}`);
  const rows = await readCsvPrompts(csvPath);
  console.log(`Found ${rows.length} rows to process`);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.prompt) {
      console.log(`Row ${i+1}: Skipping - no prompt`);
      continue;
    }
    
    const attachments = row.attachment ? [row.attachment] : [];
    
    try {
      console.log(`Row ${i+1}: Processing "${row.prompt.substring(0, 40)}${row.prompt.length > 40 ? '...' : ''}"`);
      console.log(`Row ${i+1}: Using attachment: ${attachments.join(', ') || 'none'}`);
      
      const response = await sendMessageWithAttachments(page, row.prompt, attachments);
      row.response = response;
      
      // Save after each successful response in case of errors later
      writeCsvPrompts(csvPath, rows);
      
      console.log(`Row ${i+1}: Success! Response: "${response.substring(0, 60)}${response.length > 60 ? '...' : ''}"`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      row.response = `ERROR: ${errorMessage}`;
      console.error(`Row ${i+1}: Failed - ${errorMessage}`);
      
      // Save the error in the CSV
      writeCsvPrompts(csvPath, rows);
    }
    
    // Add a small delay between requests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`CSV processing complete. Results saved to ${csvPath}`);
}

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
 * Process a CSV file with ChatGPT
 * @param csvPath Path to the CSV file with prompts and attachments
 * @returns Nothing
 */
const processChatGPTWithCSV = async (csvPath?: string) => {
  if (!csvPath) {
    csvPath = "prompts.csv"; // Default path
  }
  
  if (!fs.existsSync(csvPath)) {
    console.error(`Error: CSV file not found at ${csvPath}`);
    return;
  }
  
  console.log(`Opening ChatGPT to process CSV: ${csvPath}`);

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

    // Process the CSV file
    await processCsvWorkflow(csvPath, page);

    await new Promise(
      (resolve) => setTimeout(resolve, Math.random() * 100 + 200)
    );

    await browser.close();
    console.log("Browser closed. CSV processing complete.");

  } catch (error) {
    await browser.close();
    return Promise.reject(error);
  }
};

// Check if a CSV path was provided as a command-line argument
const csvPath = process.argv[2];
processChatGPTWithCSV(csvPath);


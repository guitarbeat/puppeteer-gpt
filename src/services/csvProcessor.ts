import { Page } from 'puppeteer';
import { readCsvPrompts, writeCsvPrompts, CsvPromptRow } from '../utils/processCsvPrompts';
import { sendMessageWithAttachments } from '../utils/sendMessageWithAttachments';
import { csvLogger, logger } from '../utils/logger';
import { ScreenshotManager } from '../utils/screenshot';
import fs from 'fs';
import { appConfig } from '../config/appConfig';

/**
 * Service responsible for processing CSV files with ChatGPT
 */
export class CsvProcessor {
  private retryFailedRows: boolean;

  constructor(retryFailedRows = true) {
    this.retryFailedRows = retryFailedRows;
  }

  /**
   * Check if a CSV file exists
   */
  validateCsvFile(csvPath: string): boolean {
    if (!fs.existsSync(csvPath)) {
      csvLogger.error(`File not found: ${csvPath}`);
      return false;
    }
    return true;
  }

  /**
   * Process each row in the CSV file
   */
  async processRows(csvPath: string, page: Page): Promise<void> {
    csvLogger.info(`Processing CSV file: ${csvPath}`);
    const rows = await readCsvPrompts(csvPath);
    csvLogger.info(`Found ${rows.length} rows to process`);
    
    // Count rows without responses and rows with errors
    const pendingRows = rows.filter(row => !row.response).length;
    const errorRows = rows.filter(row => row.response?.includes(appConfig.errorHandling.errorIdentifier)).length;
    
    csvLogger.info(`Found ${pendingRows} rows without responses to process`);
    if (this.retryFailedRows && errorRows > 0) {
      csvLogger.info(`Found ${errorRows} rows with errors that will be retried`);
    }

    for (let i = 0; i < rows.length; i++) {
      await this.processRow(i, rows[i], rows, csvPath, page);
    }

    csvLogger.success(`CSV processing complete. Results saved to ${csvPath}`);
  }

  /**
   * Check if a row should be processed
   * @returns True if the row should be processed
   */
  private shouldProcessRow(row: CsvPromptRow): boolean {
    // Always process rows without any response
    if (!row.response) {
      return true;
    }
    
    // If retryFailedRows is enabled, also process rows with ERROR in the response
    if (this.retryFailedRows && row.response.includes(appConfig.errorHandling.errorIdentifier)) {
      return true;
    }
    
    // Skip all other rows that have responses
    return false;
  }

  /**
   * Process a single row with retry logic
   */
  private async processRow(
    index: number, 
    row: CsvPromptRow, 
    allRows: CsvPromptRow[], 
    csvPath: string, 
    page: Page
  ): Promise<void> {
    const rowNum = index + 1;
    
    // Check if we should process this row
    if (!this.shouldProcessRow(row)) {
      // If it has a response but not an error, or if retryFailedRows is false
      const hasError = row.response?.includes(appConfig.errorHandling.errorIdentifier);
      csvLogger.row(rowNum, 'Skipping', hasError ? 'has error but retry is disabled' : 'already has response');
      return;
    }
    
    if (!row.prompt) {
      csvLogger.row(rowNum, 'Skipping', 'no prompt');
      return;
    }

    // If this is a retry of a failed row, log it
    if (row.response?.includes(appConfig.errorHandling.errorIdentifier)) {
      csvLogger.row(rowNum, 'Retrying previously failed row');
    }
    
    const attachments = row.attachment ? row.attachment.split('|').map(path => path.trim()).filter(Boolean) : [];
    
    // Retry mechanism variables
    const maxRetries = appConfig.timing.maxRetries;
    let retryCount = 0;
    let success = false;
    
    while (!success && retryCount <= maxRetries) {
      try {
        if (retryCount > 0) {
          await this.handleRetry(index, retryCount, maxRetries, page);
        }
        
        const promptPreview = row.prompt.length > 40 
          ? `${row.prompt.substring(0, 40)}...` 
          : row.prompt;
          
        csvLogger.row(rowNum, 'Processing', promptPreview);
        
        if (attachments.length > 0) {
          csvLogger.row(rowNum, `Using ${attachments.length} attachment(s)`, 
            attachments.length <= 3 ? attachments.join(', ') : `${attachments.length} files`);
        }
        
        const response = await sendMessageWithAttachments(page, row.prompt, attachments);
        row.response = response;
        
        // Save after each successful response in case of errors later
        writeCsvPrompts(csvPath, allRows);
        
        const responsePreview = response.length > 60 
          ? `${response.substring(0, 60)}...` 
          : response;
          
        csvLogger.row(rowNum, 'Success!', responsePreview);
        success = true;
      } catch (err) {
        retryCount++;
        await this.handleRowError(index, retryCount, maxRetries, err, row, allRows, csvPath, page);
        
        if (retryCount > maxRetries) {
          break; // Exit the loop after logging the final error
        }
      }
    }
    
    // Add a delay between rows regardless of success/failure
    await this.waitBetweenRows();
  }

  /**
   * Handle retry logic for a row
   */
  private async handleRetry(index: number, retryCount: number, maxRetries: number, page: Page): Promise<void> {
    const rowNum = index + 1;
    csvLogger.row(rowNum, `Retry attempt ${retryCount}/${maxRetries}`);
    
    // On retry, refresh the page and wait for it to load
    csvLogger.info('Refreshing page to recover from error...');
    await page.reload({ waitUntil: 'networkidle0' });
    
    // Add progressive backoff delay (longer for each retry)
    const backoffDelay = appConfig.timing.betweenRowDelay * Math.pow(2, retryCount - 1);
    csvLogger.info(`Waiting ${backoffDelay/1000} seconds before continuing...`);
    await new Promise(resolve => setTimeout(resolve, backoffDelay));
    
    // Re-verify the chat interface is loaded
    const chatSelector = "#prompt-textarea";
    await page.waitForSelector(chatSelector, { timeout: 30000 });
    csvLogger.info('Chat interface reloaded successfully');
  }

  /**
   * Handle errors that occur during row processing
   */
  private async handleRowError(
    index: number,
    retryCount: number,
    maxRetries: number,
    err: unknown,
    row: CsvPromptRow,
    allRows: CsvPromptRow[],
    csvPath: string,
    page: Page
  ): Promise<void> {
    const rowNum = index + 1;
    const errorMessage = err instanceof Error ? err.message : String(err);
    
    // Take screenshot of the error state
    const screenshotPath = await ScreenshotManager.takeErrorScreenshot(
      page, 
      `row${rowNum}-retry${retryCount}`,
      undefined, // No error details in the filename
      false      // Don't log to console, we'll do it ourselves
    );
    
    csvLogger.error(`Row ${rowNum}: Attempt ${retryCount}/${maxRetries} failed`, err);
    csvLogger.info(`Error screenshot saved to ${screenshotPath}`);
    
    if (retryCount > maxRetries) {
      // After all retries are exhausted, save the error
      row.response = `${appConfig.errorHandling.errorIdentifier} (after ${maxRetries} retries): ${errorMessage}`;
      writeCsvPrompts(csvPath, allRows);
      csvLogger.error(`Row ${rowNum}: Failed after ${maxRetries} retries`);
    } else {
      // Log retry attempt
      csvLogger.row(rowNum, 'Will retry in a moment...');
    }
  }

  /**
   * Wait between processing rows to avoid rate limiting
   */
  private async waitBetweenRows(): Promise<void> {
    const betweenRowDelay = appConfig.timing.betweenRowDelay;
    csvLogger.info(`Waiting ${betweenRowDelay/1000} seconds before next row...`);
    await new Promise(resolve => setTimeout(resolve, betweenRowDelay));
  }
} 
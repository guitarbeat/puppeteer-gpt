import { Page } from 'puppeteer';
import { readCsvPrompts, writeCsvPrompts, CsvPromptRow } from '../utils/processCsvPrompts';
import { sendMessageWithAttachments } from './messaging';
import { csvLogger, logger, Logger } from '../utils/logger';
import { ScreenshotManager } from '../utils/screenshot';
import fs from 'fs';
import { appConfig } from '../config/appConfig';
import { truncateString } from '../utils/fileHelpers';

/**
 * Service responsible for processing CSV files with ChatGPT
 */
export class CsvProcessor {
  private retryFailedRows: boolean;
  private processInReverse: boolean;
  // Regex pattern to validate grading format responses - more forgiving version
  private gradeDataPattern = /<GRADE_DATA>[\s\S]*?<\/GRADE_DATA>/i;

  constructor(retryFailedRows = true, processInReverse = false) {
    this.retryFailedRows = retryFailedRows;
    this.processInReverse = processInReverse;
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
    // Reset screenshot context at the beginning
    ScreenshotManager.setCurrentRow(null);
    ScreenshotManager.setStepContext('init');
    
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
    
    // Log processing direction
    if (this.processInReverse) {
      csvLogger.info(`Processing rows in reverse order (from last to first)`);
    }

    // Initialize browser state
    await this.preparePageForProcessing(page);

    if (this.processInReverse) {
      // Process rows in reverse order (from the last row to the first)
      for (let i = rows.length - 1; i >= 0; i--) {
        await this.processRow(i, rows[i], rows, csvPath, page);
      }
    } else {
      // Process rows in normal order (from the first row to the last)
      for (let i = 0; i < rows.length; i++) {
        await this.processRow(i, rows[i], rows, csvPath, page);
      }
    }

    // Clear screenshot context at the end
    ScreenshotManager.setCurrentRow(null);
    ScreenshotManager.setStepContext('complete');
    
    csvLogger.success(`CSV processing complete. Results saved to ${csvPath}`);
  }

  /**
   * Prepare page for processing
   */
  private async preparePageForProcessing(page: Page): Promise<void> {
    try {
      csvLogger.info('Preparing page for CSV processing...');
      
      // Wait for initial page stabilization
      await new Promise(resolve => setTimeout(resolve, appConfig.timing.pageStabilizationDelay));
      
      // Wait for the chat interface to be ready
      await page.waitForSelector(appConfig.selectors.chatTextarea, { 
        timeout: appConfig.timing.pageLoadTimeout / 2 
      });
      
      csvLogger.success('Page is ready for CSV processing');
    } catch (error) {
      csvLogger.warn('Error preparing page, will attempt to continue anyway:', error);
    }
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
    // Initialize rowLogger with a default value to fix linter error
    const rowLogger = logger.rowLogger(rowNum);
    
    try {
      // Set row number and context for screenshots
      ScreenshotManager.setCurrentRow(rowNum);
      ScreenshotManager.setStepContext('start');
      
      // Check if we should process this row
      if (!this.shouldProcessRow(row)) {
        // If it has a response but not an error, or if retryFailedRows is false
        const hasError = row.response?.includes(appConfig.errorHandling.errorIdentifier);
        const skipReason = hasError ? 'has error but retry is disabled' : 'already has response';
        csvLogger.logMultiple(rowLogger, 'info', rowNum, 'Skipping', skipReason);
        return;
      }
      
      if (!row.prompt) {
        csvLogger.logMultiple(rowLogger, 'info', rowNum, 'Skipping', 'no prompt');
        return;
      }

      // If this is a retry of a failed row, log it
      if (row.response?.includes(appConfig.errorHandling.errorIdentifier)) {
        csvLogger.logMultiple(rowLogger, 'info', rowNum, 'Retrying previously failed row');
      }
      
      // Process and parse file attachments
      const attachments = this.parseAttachments(row, rowLogger);
      
      // Process the row with retries
      await this.processRowWithRetry(rowNum, row, allRows, csvPath, page, attachments, rowLogger);
      
      // After row is processed, add a delay before the next row
      await this.finishRowProcessing(page, rowLogger);
    } catch (error) {
      csvLogger.error(`Unexpected error processing row ${rowNum}:`, error);
    } finally {
      // Clear row-specific state even if there was an error
      ScreenshotManager.setStepContext('row_complete');
      
      // Consistent save point - always save CSV after each row is processed
      this.saveResults(csvPath, allRows, rowLogger);
      csvLogger.info(`Row ${rowNum}: CSV saved with latest results`);
    }
  }
  
  /**
   * Parse and validate file attachments
   */
  private parseAttachments(row: CsvPromptRow, rowLogger: Logger): string[] {
    const attachments = row.file_paths 
      ? row.file_paths.split('|').map(path => path.trim()).filter(Boolean) 
      : [];
      
    if (attachments.length > 0) {
      const attachmentInfo = attachments.length <= 3 
        ? attachments.map((path, i) => `(${i+1}/${attachments.length}) ${path}`).join(', ') 
        : `${attachments.length} files`;
        
      rowLogger.info(`Using ${attachments.length} attachment(s): ${attachmentInfo}`);
    }
    
    return attachments;
  }

  /**
   * Process a row with retry logic
   */
  private async processRowWithRetry(
    rowNum: number,
    row: CsvPromptRow,
    allRows: CsvPromptRow[],
    csvPath: string, 
    page: Page,
    attachments: string[],
    rowLogger: Logger
  ): Promise<void> {
    // Retry mechanism variables
    const maxRetries = appConfig.timing.maxRetries;
    let retryCount = 0;
    let success = false;
    
    while (!success && retryCount <= maxRetries) {
      try {
        if (retryCount > 0) {
          await this.handleRetry(rowNum, retryCount, maxRetries, page);
        }
        
        const promptPreview = truncateString(row.prompt, 40);
        csvLogger.logMultiple(rowLogger, 'info', rowNum, 'Processing', promptPreview);
        
        // Update step context before sending message
        ScreenshotManager.setStepContext('sending');
        
        // Send message and get response
        const response = await sendMessageWithAttachments(page, row.prompt, attachments);
        
        // Validate the response format
        const isValidFormat = this.validateResponseFormat(response);
        
        if (!isValidFormat && retryCount < maxRetries) {
          // If format validation fails, throw an error to trigger retry
          throw new Error("Response format validation failed - missing expected grading structure");
        }
        
        // Store the response
        row.response = response;
        
        // Log results and update state
        if (isValidFormat) {
          csvLogger.logMultiple(rowLogger, 'success', rowNum, 'Response format validation passed');
        } else {
          // Final attempt failed format validation but we'll still save it
          csvLogger.logMultiple(
            rowLogger, 
            'warn', 
            rowNum, 
            'Response format validation failed, but saving anyway', 
            `after ${retryCount} retries`
          );
        }
        
        // Update step context after receiving response
        ScreenshotManager.setStepContext('completed');
        
        // Save after each successful response in case of errors later
        this.saveResults(csvPath, allRows, rowLogger);
        
        // Log a preview of the response
        this.logResponsePreview(response, rowLogger, rowNum);
        
        success = true;
      } catch (err) {
        // Update step context for error
        ScreenshotManager.setStepContext('error');
        
        retryCount++;
        await this.handleRowError(rowNum, retryCount, maxRetries, err, row, allRows, csvPath, page);
        
        if (retryCount > maxRetries) {
          break; // Exit the loop after logging the final error
        }
      }
    }
  }
  
  /**
   * Log a preview of the response for monitoring
   */
  private logResponsePreview(response: string, rowLogger: Logger, rowNum: number): void {
    const responsePreview = truncateString(response, 60);
    csvLogger.logMultiple(rowLogger, 'success', rowNum, 'Success!', responsePreview);
  }
  
  /**
   * Save results to CSV file
   */
  private saveResults(csvPath: string, allRows: CsvPromptRow[], rowLogger: Logger): void {
    try {
      writeCsvPrompts(csvPath, allRows);
    } catch (error) {
      rowLogger.error('Error saving results to CSV:', error);
    }
  }
  
  /**
   * Cleanup after processing a row and prepare for the next
   */
  private async finishRowProcessing(page: Page, rowLogger: Logger): Promise<void> {
    // Wait between rows to avoid rate limiting
    await this.waitBetweenRows(page, rowLogger);
  }

  /**
   * Wait between processing rows to avoid rate limiting
   */
  private async waitBetweenRows(page: Page, rowLogger: Logger): Promise<void> {
    const betweenRowDelay = appConfig.timing.betweenRowDelay;
    rowLogger.info(`Waiting ${betweenRowDelay/1000} seconds before next row...`);
    
    // Take a screenshot of the final state
    try {
      await ScreenshotManager.takeScreenshot(page, 'after-row-complete', false, false);
    } catch (error) {
      // Ignore screenshot errors
    }
    
    await new Promise(resolve => setTimeout(resolve, betweenRowDelay));
  }

  /**
   * Handle a retry attempt
   */
  private async handleRetry(
    rowNum: number,
    retryCount: number,
    maxRetries: number,
    page: Page
  ): Promise<void> {
    const rowLogger = logger.rowLogger(rowNum);
    
    rowLogger.warn(`Retry attempt ${retryCount}/${maxRetries}`);
    csvLogger.row(rowNum, `Retry attempt ${retryCount}/${maxRetries}`);
    
    // Add a delay between retries that increases with each attempt
    const retryDelay = Math.min(
      appConfig.timing.initialRetryDelay * Math.pow(2, retryCount - 1),
      appConfig.timing.maxRetryDelay
    );
    
    csvLogger.info(`Waiting ${retryDelay/1000} seconds before continuing...`);
    await new Promise(resolve => setTimeout(resolve, retryDelay));
    
    try {
      // Wait for the chat interface to be ready
      await page.waitForSelector(appConfig.selectors.chatTextarea, { timeout: 10000 });
      csvLogger.info(`Chat interface is ready for retry`);
    } catch (error) {
      csvLogger.error(`Error verifying chat interface`, error);
      // We'll continue anyway and hope for the best
    }
  }

  /**
   * Handle errors that occur during row processing
   */
  private async handleRowError(
    rowNum: number,
    retryCount: number,
    maxRetries: number,
    err: unknown,
    row: CsvPromptRow,
    allRows: CsvPromptRow[],
    csvPath: string,
    page: Page
  ): Promise<void> {
    const rowLogger = logger.rowLogger(rowNum);
    const errorMessage = err instanceof Error ? err.message : String(err);
    
    // Take screenshot of the error state using the new helper
    const screenshotPath = await ScreenshotManager.takeRetryErrorScreenshot(
      page, 
      rowNum,
      retryCount,
      false
    );
    
    rowLogger.error(`Attempt ${retryCount}/${maxRetries} failed`, err);
    csvLogger.error(`Row ${rowNum}: Attempt ${retryCount}/${maxRetries} failed`, err);
    csvLogger.info(`Error screenshot saved to ${screenshotPath}`);
    
    if (retryCount > maxRetries) {
      // After all retries are exhausted, save the error
      row.response = `${appConfig.errorHandling.errorIdentifier} (after ${maxRetries} retries): ${errorMessage}`;
      writeCsvPrompts(csvPath, allRows);
      csvLogger.logMultiple(rowLogger, 'error', rowNum, `Failed after ${maxRetries} retries`);
    } else {
      // Log retry attempt
      csvLogger.logMultiple(rowLogger, 'info', rowNum, 'Will retry in a moment...');
    }
  }

  // Additional validation helper to check content quality
  private validateGradeContent(response: string): boolean {
    // Check for essential elements that should be present
    const hasStudentInfo = /<Student ID>.*?<\/Student ID>/i.test(response) || 
                          /Student ID:.*?\n/i.test(response);
    const hasName = /<Name>.*?<\/Name>/i.test(response) || 
                   /Name:.*?\n/i.test(response);
    const hasScore = /<.*?Score>.*?<\/.*?Score>/i.test(response) || 
                    /.*?score:.*?\n/i.test(response);
    const hasTotalScore = /<Total Score>.*?<\/Total Score>/i.test(response) || 
                         /total_score:.*?\n/i.test(response);

    if (!hasStudentInfo) {
      csvLogger.warn('Missing student ID information');
    }
    if (!hasName) {
      csvLogger.warn('Missing student name information');
    }
    if (!hasScore) {
      csvLogger.warn('Missing score information');
    }
    if (!hasTotalScore) {
      csvLogger.warn('Missing total score information');
    }

    // Consider it valid if it has at least student info and some kind of score
    return (hasStudentInfo || hasName) && (hasScore || hasTotalScore);
  }

  /**
   * Validates if the response matches the expected grading format
   * @param response The response text to validate
   * @returns True if the response matches the expected format
   */
  private validateResponseFormat(response: string): boolean {
    if (!response) return false;
    
    // First check if we have the basic GRADE_DATA structure
    const hasGradeData = this.gradeDataPattern.test(response);
    
    if (!hasGradeData) {
      csvLogger.warn('Response format validation failed. Expected <GRADE_DATA> structure not found.');
      return false;
    }

    // If we have GRADE_DATA tags, validate the content quality
    return this.validateGradeContent(response);
  }
} 
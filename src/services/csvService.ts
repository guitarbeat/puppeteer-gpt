import { Page } from 'puppeteer';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { sendMessageWithAttachments } from './messaging';
import { ScreenshotManager } from '../utils/logging/screenshot';
import { appConfig } from '../config/appConfig';
import { truncateString } from '../utils/fileHelpers';

/**
 * CSV row interface representing a single prompt/response pair
 */
export interface CsvPromptRow {
  student_name: string;
  student_id: string;
  file_paths: string;
  has_video: string;
  prompt: string;
  response: string;
}

/**
 * Service responsible for processing CSV files with ChatGPT
 * Handles CSV I/O operations and processing logic
 */
export class CsvService {
  private retryFailedRows: boolean;
  private processInReverse: boolean;

  constructor(retryFailedRows = true, processInReverse = false) {
    this.retryFailedRows = retryFailedRows;
    this.processInReverse = processInReverse;
  }

  /**
   * Check if a CSV file exists
   */
  validateCsvFile(csvPath: string): boolean {
    try {
      if (!fs.existsSync(csvPath)) {
        console.error(`CSV file not found: ${csvPath}`);
        return false;
      }
      return true;
    } catch (err) {
      console.error('Error validating CSV file', err);
      return false;
    }
  }

  /**
   * Read and parse a CSV file containing prompts
   * @param csvPath Path to the CSV file
   * @returns Array of CSV rows
   */
  async readCsvPrompts(csvPath: string): Promise<CsvPromptRow[]> {
    try {
      const fileContent = fs.readFileSync(csvPath, 'utf-8');
      const result = Papa.parse(fileContent, {
        header: true,
        skipEmptyLines: true,
      });
      
      // @ts-ignore - Papaparse types are incomplete
      const rows: CsvPromptRow[] = result.data;
      
      // Validate and normalize file paths
      return rows.map(this.validateFilePaths);
    } catch (error) {
      console.error(`Error reading CSV file: ${csvPath}`, error);
      throw error;
    }
  }

  /**
   * Validate and fix file paths in a CSV row
   * @param row CSV row to validate
   * @returns Updated row with validated/fixed paths
   */
  private validateFilePaths(row: CsvPromptRow): CsvPromptRow {
    if (!row.file_paths || row.file_paths.trim() === '') {
      return row;
    }
    
    // Process multiple file paths separated by pipe
    const filePaths = row.file_paths.split('|').map(filePath => filePath.trim());
    const validatedPaths: string[] = [];
    
    for (const filePath of filePaths) {
      try {
        // Decode URI components to handle URL-encoded characters
        const decodedPath = decodeURIComponent(filePath);
        
        // Try the path as is
        if (fs.existsSync(decodedPath)) {
          validatedPaths.push(decodedPath);
          continue;
        }
        
        // Try with spaces explicitly handled
        if (filePath.includes(' ')) {
          // Path with spaces can be problematic
          const altPath = filePath.replace(/\s+/g, '\\ ');
          if (fs.existsSync(altPath)) {
            validatedPaths.push(altPath);
            continue;
          }
        }
        
        // Log if file not found
        console.warn(`File not found: ${filePath} for student ${row.student_name} (${row.student_id})`);
      } catch (error) {
        console.warn(`Error validating file path: ${filePath}`, error);
      }
    }
    
    // If we have any valid paths, update the row
    if (validatedPaths.length > 0) {
      return {
        ...row,
        file_paths: validatedPaths.join('|')
      };
    }
    
    // If we couldn't validate any paths, return the original
    return row;
  }

  /**
   * Write data back to the CSV file
   * @param csvPath Path to the CSV file
   * @param rows Array of CSV rows
   */
  writeCsvPrompts(csvPath: string, rows: CsvPromptRow[]): void {
    try {
      const backupPath = `${csvPath}.bak`;
      
      // First create a backup of the existing file
      if (fs.existsSync(csvPath) && !fs.existsSync(backupPath)) {
        fs.copyFileSync(csvPath, backupPath);
        console.info(`Created backup of original CSV at ${backupPath}`);
      }
      
      // Write the updated data
      const csvContent = Papa.unparse(rows, {
        header: true,
        quotes: true
      });
      fs.writeFileSync(csvPath, csvContent, 'utf-8');
    } catch (error) {
      console.error(`Error writing to CSV file: ${csvPath}`, error);
      throw error;
    }
  }

  /**
   * Process each row in the CSV file
   */
  async processRows(csvPath: string, page: Page): Promise<void> {
    // Reset screenshot context at the beginning
    ScreenshotManager.setCurrentRow(null);
    ScreenshotManager.setStepContext('init');
    
    console.info(`Processing CSV file: ${csvPath}`);
    const rows = await this.readCsvPrompts(csvPath);
    console.info(`Found ${rows.length} rows to process`);
    
    // Count rows without responses and rows with errors
    const pendingRows = rows.filter(row => !row.response).length;
    const errorRows = rows.filter(row => row.response?.includes(appConfig.errorHandling.errorIdentifier)).length;
    
    console.info(`Found ${pendingRows} rows without responses to process`);
    if (this.retryFailedRows && errorRows > 0) {
      console.info(`Found ${errorRows} rows with errors that will be retried`);
    }
    
    // Log processing direction
    if (this.processInReverse) {
      console.info(`Processing rows in reverse order (from last to first)`);
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
    
    console.info(`CSV processing complete. Results saved to ${csvPath}`);
  }

  /**
   * Prepare page for processing
   */
  private async preparePageForProcessing(page: Page): Promise<void> {
    try {
      console.info('Preparing page for CSV processing...');
      
      // Wait for initial page stabilization
      await new Promise(resolve => setTimeout(resolve, appConfig.timing.pageStabilizationDelay));
      
      // Wait for the chat interface to be ready
      await page.waitForSelector(appConfig.selectors.chatTextarea, { 
        timeout: appConfig.timing.pageLoadTimeout / 2 
      });
      
      console.info('Page is ready for CSV processing');
    } catch (error) {
      console.warn('Error preparing page, will attempt to continue anyway:', error);
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
   * Process a single row
   */
  private async processRow(
    index: number, 
    row: CsvPromptRow, 
    allRows: CsvPromptRow[], 
    csvPath: string, 
    page: Page
  ): Promise<void> {
    const rowNum = index + 1;
    
    try {
      // Set up row-level screenshot context
      ScreenshotManager.setCurrentRow(rowNum);
      ScreenshotManager.setStepContext('start');
      
      console.info(`Row ${rowNum}: Starting processing`);
      
      // Skip rows that already have responses (unless retrying errors)
      if (row.response && (!this.retryFailedRows || !row.response.includes(appConfig.errorHandling.errorIdentifier))) {
        const hasError = row.response?.includes(appConfig.errorHandling.errorIdentifier);
        const skipReason = hasError ? 'has error but retry is disabled' : 'already has response';
        console.info(`Row ${rowNum}: Skipping - ${skipReason}`);
        return;
      }
      
      if (!row.prompt) {
        console.info(`Row ${rowNum}: Skipping - no prompt`);
        return;
      }

      // If this is a retry of a failed row, log it
      if (row.response?.includes(appConfig.errorHandling.errorIdentifier)) {
        console.info(`Row ${rowNum}: Retrying previously failed row`);
      }
      
      await this.processPrompt(page, row, rowNum, csvPath, allRows);
      await this.finishRowProcessing(page);
    } catch (error) {
      console.error(`Unexpected error processing row ${rowNum}:`, error);
    } finally {
      // Clear row-specific state even if there was an error
      ScreenshotManager.setCurrentRow(null);
      
      // Consistent save point - always save CSV after each row is processed
      this.saveResults(csvPath, allRows);
      console.info(`Row ${rowNum}: CSV saved with latest results`);
    }
  }
  
  /**
   * Process a single prompt
   */
  private async processPrompt(page: Page, row: CsvPromptRow, rowNum: number, csvPath: string, allRows: CsvPromptRow[]): Promise<void> {
    ScreenshotManager.setStepContext('processing');
    
    try {
      console.info(`Row ${rowNum}: Processing prompt (${row.prompt.length} chars)`);
      console.debug(`Row ${rowNum}: Prompt preview: ${row.prompt.substring(0, 50)}...`);
      
      // Save a backup first
      this.saveResults(csvPath, allRows);
      
      // Try processing with or without attachments
      let response;
      if (row.file_paths) {
        // Process file paths for attachments - now using '|' separator as in the validateFilePaths method
        const attachments = row.file_paths.split('|').map((a: string) => a.trim()).filter((a: string) => a);
        if (attachments.length > 0) {
          console.info(`Row ${rowNum}: Including ${attachments.length} attachments`);
          response = await sendMessageWithAttachments(page, row.prompt, attachments);
        } else {
          response = await sendMessageWithAttachments(page, row.prompt);
        }
      } else {
        response = await sendMessageWithAttachments(page, row.prompt);
      }
      
      console.info(`Row ${rowNum}: Response received (${response.length} chars)`);
      
      // Update the row with the response
      row.response = response;
      
      // Save immediately after receiving response
      this.saveResults(csvPath, allRows);
      
      // Set a screenshot step context for proper organization
      ScreenshotManager.setStepContext('response');
      
      // Take a confirmation screenshot
      await ScreenshotManager.takeScreenshot(page, 'response-received', true, false, true);
    } catch (error) {
      // Log the error but continue to next row
      console.error(`Row ${rowNum}: Error processing prompt`, error);
      
      // Mark as error in the CSV so we can retry
      row.response = `${appConfig.errorHandling.errorIdentifier} ${error instanceof Error ? error.message : String(error)}`;
      
      // Take error screenshot
      await ScreenshotManager.error(page, `row${rowNum}-error`, `Failed to process row ${rowNum}`);
    }
  }

  /**
   * Save the results back to the CSV file
   */
  private saveResults(csvPath: string, rows: CsvPromptRow[]): void {
    try {
      this.writeCsvPrompts(csvPath, rows);
    } catch (error) {
      console.error('Error saving CSV results', error);
    }
  }

  /**
   * Clean up after row processing
   */
  private async finishRowProcessing(page: Page): Promise<void> {
    try {
      ScreenshotManager.setStepContext('cleanup');
      // Allow page to settle before processing the next row
      await new Promise(resolve => setTimeout(resolve, appConfig.timing.betweenRowDelay));
    } catch (error) {
      console.error('Error in row cleanup', error);
    }
  }
} 
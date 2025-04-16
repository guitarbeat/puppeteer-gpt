import * as path from 'path';
import { Logger } from './logger';

/**
 * A utility to provide enhanced error context for better debugging
 */
export class ErrorContext {
  private readonly sourceFile: string;
  private readonly logger: Logger;

  /**
   * Creates a new ErrorContext instance for a specific file
   * 
   * @param filename The __filename of the current file
   * @param logger Optional logger instance to use
   */
  constructor(filename: string, logger?: Logger) {
    this.sourceFile = path.basename(filename);
    this.logger = logger || new Logger({ prefix: `[${this.sourceFile}]` });
  }

  /**
   * Enhanced try-catch wrapper that logs errors with file context
   * 
   * @param fn Function to execute within try-catch
   * @param errorMessage Custom error message prefix
   * @param contextData Additional context data to include in logs
   * @returns Result of fn or undefined if error
   */
  async tryCatch<T>(
    fn: () => Promise<T> | T,
    errorMessage: string = 'Operation failed',
    contextData: Record<string, unknown> = {}
  ): Promise<T | undefined> {
    try {
      return await fn();
    } catch (error) {
      this.logError(errorMessage, error, contextData);
      return undefined;
    }
  }

  /**
   * Log an error with enhanced context information
   * 
   * @param message Error message
   * @param error The caught error object
   * @param contextData Additional context data
   */
  logError(
    message: string,
    error?: unknown,
    contextData: Record<string, unknown> = {}
  ): void {
    // Format the error object
    const errorObj = error instanceof Error ? error : new Error(String(error));
    
    // Clean stack trace for better readability
    const cleanedStack = this.cleanStackTrace(errorObj.stack);
    
    // Format context data
    const context = {
      file: this.sourceFile,
      ...contextData,
      error: {
        name: errorObj.name,
        message: errorObj.message,
        stack: cleanedStack
      }
    };
    
    // Log using structured format with context
    this.logger.error(`${message} (in ${this.sourceFile})`, context);
    
    // Python-style error format for console
    console.error(`\nFile: ${this.sourceFile}`);
    console.error(`Error: ${errorObj.message}`);
    if (cleanedStack) {
      console.error(`Stack: ${cleanedStack.split('\n')[0]}`);
    }
    console.error(''); // Empty line for separation
  }

  /**
   * Clean stack trace by removing node_modules paths and limiting depth
   */
  private cleanStackTrace(stack?: string): string | undefined {
    if (!stack) return undefined;
    
    // Remove node_modules paths and keep project files
    return stack
      .split('\n')
      .filter(line => !line.includes('node_modules/'))
      .slice(0, 5) // Limit to first 5 lines
      .join('\n');
  }
}

/*
Example usage:

```typescript
// In yourFile.ts:
import { ErrorContext } from '../utils/errorContext';

// Initialize once at the top of the file
const errorContext = new ErrorContext(__filename);

// Example 1: Simple try-catch with context
try {
  await page.click('#non-existent-button');
} catch (error) {
  errorContext.logError('Failed to click button', error, {
    selector: '#non-existent-button',
    url: page.url(),
    visibleButtons: await page.$$eval('button', btns => btns.map(b => b.textContent))
  });
}

// Example 2: Using the tryCatch wrapper
const result = await errorContext.tryCatch(
  async () => {
    const data = await processCSVRow(row);
    return data.studentId;
  },
  'CSV row processing failed',
  { 
    rowNumber: currentRow,
    csvFile: filename
  }
);

// Example 3: With nested operations (using finally)
try {
  await page.goto(url);
  try {
    await page.waitForSelector('#login-form', { timeout: 5000 });
  } catch (innerError) {
    // Log with context about which specific operation failed
    errorContext.logError('Login form not found', innerError, {
      action: 'waitForSelector',
      url: page.url(),
      html: await page.content().substring(0, 500) // First 500 chars of HTML
    });
    // Throw to trigger outer catch
    throw innerError;
  }
} catch (error) {
  errorContext.logError('Navigation failed', error, { url });
} finally {
  // Cleanup operations
}
```
*/ 
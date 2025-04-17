import * as path from 'path';

/**
 * A utility to provide enhanced error context for better debugging
 */
export class ErrorContext {
  private readonly sourceFile: string;

  /**
   * Creates a new ErrorContext instance for a specific file
   * 
   * @param filename The __filename of the current file
   */
  constructor(filename: string) {
    this.sourceFile = path.basename(filename);
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
    
    // Log using console.error with context
    console.error(`${message} (in ${this.sourceFile})`, context);
    
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

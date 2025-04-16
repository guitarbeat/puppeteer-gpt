import chalk from 'chalk';

/**
 * Log levels for application
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  SUCCESS = 2,
  WARN = 3,
  ERROR = 4,
  NONE = 5 // Disables all logging
}

export interface LoggerOptions {
  level: LogLevel;
  showTimestamp: boolean;
  prefix?: string;
}

/**
 * Logger utility for the application
 */
export class Logger {
  private static defaultOptions: LoggerOptions = {
    level: LogLevel.INFO,
    showTimestamp: true
  };

  private options: LoggerOptions;
  
  /**
   * Create a new logger instance
   */
  constructor(options: Partial<LoggerOptions> = {}) {
    this.options = { ...Logger.defaultOptions, ...options };
  }

  /**
   * Set the log level
   */
  setLevel(level: LogLevel): void {
    this.options.level = level;
  }

  /**
   * Get a formatted timestamp
   */
  private getTimestamp(): string {
    if (!this.options.showTimestamp) return '';
    
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour12: false });
    return `[${timeStr}] `;
  }

  /**
   * Format a prefix for the log message
   */
  private formatPrefix(type: string): string {
    const timestamp = this.getTimestamp();
    const typeStr = this.options.prefix 
      ? `[${this.options.prefix}] [${type}]` 
      : `[${type}]`;
      
    return `${timestamp}${typeStr} `;
  }
  
  /**
   * Formats an error for logging, truncating stack traces
   */
  private formatError(error: unknown): string {
    if (error instanceof Error) {
      // Extract the first line of the stack trace (usually the error message)
      const errorLines = error.stack?.split('\n') || [error.message];
      const mainError = errorLines[0];
      
      // Include the first 2 lines of stack trace
      const stackInfo = errorLines.length > 1 
        ? '\n  ' + errorLines.slice(1, 3).join('\n  ') + (errorLines.length > 3 ? '\n  ...' : '')
        : '';
        
      return `${mainError}${stackInfo}`;
    }
    
    return String(error);
  }

  /**
   * Log a debug message
   */
  debug(message: string, ...args: any[]): void {
    if (this.options.level <= LogLevel.DEBUG) {
      console.log(chalk.gray(this.formatPrefix('DEBUG')), chalk.gray(message), ...args);
    }
  }

  /**
   * Log an info message
   */
  info(message: string, ...args: any[]): void {
    if (this.options.level <= LogLevel.INFO) {
      console.log(chalk.blue(this.formatPrefix('INFO')), message, ...args);
    }
  }

  /**
   * Log a success message
   */
  success(message: string, ...args: any[]): void {
    if (this.options.level <= LogLevel.SUCCESS) {
      console.log(chalk.green(this.formatPrefix('SUCCESS')), chalk.green(message), ...args);
    }
  }

  /**
   * Log a warning message
   */
  warn(message: string, ...args: any[]): void {
    if (this.options.level <= LogLevel.WARN) {
      console.log(chalk.yellow(this.formatPrefix('WARN')), chalk.yellow(message), ...args);
    }
  }

  /**
   * Log an error message
   */
  error(message: string, error?: unknown, ...args: any[]): void {
    if (this.options.level <= LogLevel.ERROR) {
      console.error(
        chalk.red(this.formatPrefix('ERROR')), 
        chalk.red(message),
        error ? '\n' + this.formatError(error) : '',
        ...args
      );
    }
  }

  /**
   * Log a row action (for CSV processing)
   */
  row(rowNumber: number, action: string, details?: string): void {
    if (this.options.level <= LogLevel.INFO) {
      const rowPrefix = chalk.cyan(`[Row ${rowNumber}]`);
      console.log(`${this.getTimestamp()}${rowPrefix} ${action}${details ? ': ' + details : ''}`);
    }
  }

  /**
   * Create a child logger with a specific prefix
   */
  child(prefix: string): Logger {
    return new Logger({
      ...this.options,
      prefix
    });
  }
}

/**
 * Default logger instance
 */
export const logger = new Logger();

/**
 * Create specialized loggers for different components
 */
export const csvLogger = logger.child('CSV');
export const browserLogger = logger.child('Browser');
export const uploadLogger = logger.child('Upload');
export const authLogger = logger.child('Auth'); 
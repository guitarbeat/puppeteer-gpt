// Replace chalk import with a custom color utility
// import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { ScreenshotManager } from './screenshot';

// Define the interface for the colors object
interface ColorCodes {
  reset: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  gray: string;
  bold: string;
  dim: string;
  underline: string;
  colorize: (color: keyof Omit<ColorCodes, 'colorize'>, text: string) => string;
}

// Simple ANSI color codes to replace chalk
const colors: ColorCodes = {
  reset: '\x1b[0m',
  // Basic colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  
  // Text modifiers
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  underline: '\x1b[4m',
  
  // Helpers to format text with colors
  colorize: (color: keyof Omit<ColorCodes, 'colorize'>, text: string): string => {
    return `${colors[color]}${text}${colors.reset}`;
  }
};

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
  writeToFile?: boolean;
  fileLogLevel?: LogLevel; // Separate log level for file logging
  useRowBasedLogs?: boolean; // Whether to create row-specific log files
  rowLogExclusive?: boolean; // When true, row-specific logs are only written to row log file
}

// Define types for console methods
type ConsoleLogMethod = typeof console.log;
type ConsoleErrorMethod = typeof console.error;
type ConsoleWarnMethod = typeof console.warn;
type ConsoleInfoMethod = typeof console.info;

/**
 * Logger utility for the application
 */
export class Logger {
  private static defaultOptions: LoggerOptions = {
    level: LogLevel.INFO,
    showTimestamp: true,
    writeToFile: true,
    fileLogLevel: LogLevel.DEBUG, // By default, log everything to file
    useRowBasedLogs: true, // Default to row-based log files
    rowLogExclusive: false // By default, write to both main and row logs
  };

  private options: LoggerOptions;
  private logFile: fs.WriteStream | null = null;
  private rowLogFiles: Map<number, fs.WriteStream> = new Map();
  private static console_log: ConsoleLogMethod = console.log;
  private static console_error: ConsoleErrorMethod = console.error;
  private static console_warn: ConsoleWarnMethod = console.warn;
  private static console_info: ConsoleInfoMethod = console.info;
  
  // We'll store a global instance for intercepting console methods
  private static globalInstance: Logger | null = null;
  
  /**
   * Create a new logger instance
   */
  constructor(options: Partial<LoggerOptions> = {}) {
    this.options = { ...Logger.defaultOptions, ...options };
    
    // Store the first created instance as global
    if (!Logger.globalInstance) {
      Logger.globalInstance = this;
      this.interceptConsoleMethods();
    }
  }

  /**
   * Intercept console methods to ensure they all go to the log file
   */
  private interceptConsoleMethods(): void {
    const self = this;
    
    // Replace console methods with wrappers
    console.log = function(...args: any[]) {
      Logger.console_log.apply(console, args);
      self.captureConsoleOutput('INFO', args);
    };
    
    console.error = function(...args: any[]) {
      Logger.console_error.apply(console, args);
      self.captureConsoleOutput('ERROR', args);
    };
    
    console.warn = function(...args: any[]) {
      Logger.console_warn.apply(console, args);
      self.captureConsoleOutput('WARN', args);
    };
    
    console.info = function(...args: any[]) {
      Logger.console_info.apply(console, args);
      self.captureConsoleOutput('INFO', args);
    };
  }
  
  /**
   * Restore original console methods
   */
  public static restoreConsoleMethods(): void {
    console.log = Logger.console_log;
    console.error = Logger.console_error;
    console.warn = Logger.console_warn;
    console.info = Logger.console_info;
  }
  
  /**
   * Capture any console output and write to log file
   */
  private captureConsoleOutput(level: string, args: any[]): void {
    if (!this.options.writeToFile) return;
    
    try {
      const formattedArgs = args.map(arg => {
        // Remove ANSI color codes
        if (typeof arg === 'string') {
          return arg.replace(/\x1B\[\d+m/g, '');
        }
        return this.formatArg(arg);
      }).join(' ');
      
      const timestamp = this.getTimestampString();
      const logEntry = `[${timestamp}] [CONSOLE:${level}] ${formattedArgs}\n`;
      
      this.writeToLogStreams(logEntry);
    } catch (error) {
      // Ignore errors in console capture to prevent recursion
    }
  }

  // Helper to write to all active log streams
  private writeToLogStreams(entry: string, rowPrefix = '[MAIN] ', isRowSpecific = false): void {
    // Always write to main log file
    if (this.logFile) {
      this.logFile.write(entry);
    }
    
    // Also write to row-specific log file if applicable
    const currentRow = ScreenshotManager['currentRowNumber'];
    if (currentRow !== null && this.rowLogFiles.has(currentRow)) {
      const rowLogFile = this.rowLogFiles.get(currentRow);
      if (rowLogFile) {
        const prefix = isRowSpecific ? '' : rowPrefix;
        rowLogFile.write(`${prefix}${entry}`);
      }
    }
  }

  /**
   * Check if a log message is row-specific by looking for "[Row X]" in the message
   */
  private isRowSpecificLog(message: string, rowNumber: number): boolean {
    return message.includes(`[Row ${rowNumber}]`);
  }

  /**
   * Set the log level
   */
  setLevel(level: LogLevel): void {
    this.options.level = level;
  }
  
  /**
   * Set the file log level
   */
  setFileLogLevel(level: LogLevel): void {
    this.options.fileLogLevel = level;
  }
  
  /**
   * Set whether row logs are exclusive (only written to row log file, not main log)
   */
  setRowLogExclusive(exclusive: boolean): void {
    this.options.rowLogExclusive = exclusive;
  }
  
  /**
   * Initialize the log file in the current screenshot session directory
   */
  initLogFile(): void {
    if (!this.options.writeToFile) return;
    
    try {
      // Get the current session directory from ScreenshotManager
      const sessionDir = ScreenshotManager.getCurrentSessionDir();
      if (!sessionDir) return;
      
      // Create log filename with timestamp
      const now = new Date();
      const timestamp = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit', 
        hour12: true
      }).replace(/:/g, '-').replace(/\s/g, '').toLowerCase();
      
      const logFilePath = path.join(sessionDir, `log_${timestamp}.txt`);
      
      // Create or truncate the log file with frequent syncing
      this.logFile = fs.createWriteStream(logFilePath, { 
        flags: 'a',
        autoClose: true,
        highWaterMark: 1024 // Small buffer to ensure more frequent writes
      });
      
      // Write a header to the log file
      const header = `=== Log started at ${now.toLocaleString()} ===\n\n`;
      this.logFile.write(header);
      
      console.log(colors.colorize('blue', `Log file created: ${logFilePath}`));
    } catch (error) {
      console.error(colors.colorize('red', 'Failed to create log file:'), error);
    }
  }
  
  /**
   * Initialize a row-specific log file
   * @param rowNumber The CSV row number
   */
  initRowLogFile(rowNumber: number): void {
    if (!this.options.writeToFile || !this.options.useRowBasedLogs) return;
    
    try {
      // Close any existing log file for this row
      this.closeRowLogFile(rowNumber);
      
      // Get the current session directory
      const sessionDir = ScreenshotManager.getCurrentSessionDir();
      if (!sessionDir) return;
      
      // Create the row directory path
      const rowDir = path.join(sessionDir, `row${rowNumber}`);
      if (!fs.existsSync(rowDir)) {
        fs.mkdirSync(rowDir, { recursive: true });
      }
      
      // Create log filename
      const logFilePath = path.join(rowDir, `row${rowNumber}_log.txt`);
      
      // Create or truncate the log file
      const rowLogFile = fs.createWriteStream(logFilePath, {
        flags: 'a',
        autoClose: true,
        highWaterMark: 1024
      });
      
      // Write a header to the log file
      const now = new Date();
      const header = `=== Row ${rowNumber} log started at ${now.toLocaleString()} ===\n\n`;
      rowLogFile.write(header);
      
      // Store the log file stream
      this.rowLogFiles.set(rowNumber, rowLogFile);
      
      console.log(colors.colorize('blue', `Row ${rowNumber} log file created: ${logFilePath}`));
    } catch (error) {
      console.error(colors.colorize('red', `Failed to create row ${rowNumber} log file:`), error);
    }
  }
  
  /**
   * Close a row-specific log file
   * @param rowNumber The CSV row number
   */
  closeRowLogFile(rowNumber: number): void {
    const rowLogFile = this.rowLogFiles.get(rowNumber);
    if (rowLogFile) {
      try {
        rowLogFile.write(`\n=== Row ${rowNumber} log closed ===\n`);
        rowLogFile.end();
        this.rowLogFiles.delete(rowNumber);
      } catch (error) {
        console.error(colors.colorize('red', `Error closing row ${rowNumber} log file:`), error);
      }
    }
  }
  
  /**
   * Format a single argument for logging
   */
  private formatArg(arg: any): string {
    if (arg === undefined) return 'undefined';
    if (arg === null) return 'null';
    
    if (arg instanceof Error) {
      return this.formatError(arg);
    }
    
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg, null, 2);
      } catch (e) {
        return String(arg);
      }
    }
    
    return String(arg);
  }
  
  /**
   * Format arguments for logging
   */
  private formatArgs(args: any[]): string {
    if (!args || args.length === 0) return '';
    return args.map(arg => this.formatArg(arg)).join(' ');
  }
  
  /**
   * Get formatted timestamp string for logs
   */
  private getTimestampString(): string {
    const now = new Date();
    return now.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      hour12: true 
    });
  }
  
  /**
   * Write a message to the log file
   */
  private writeToLogFile(level: LogLevel, message: string, args: any[] = [], isRowSpecific: boolean = false): void {
    if (!this.options.writeToFile) return;
    
    // Only log if the level is at or above the file log level
    if (level < (this.options.fileLogLevel || LogLevel.DEBUG)) return;
    
    try {
      // Remove ANSI color codes for file logging
      const plainMessage = message.replace(/\x1B\[\d+m/g, '');
      
      // Format arguments for log file
      const formattedArgs = this.formatArgs(args);
      const logEntry = `${plainMessage}${formattedArgs ? ' ' + formattedArgs : ''}\n`;
      
      const currentRow = ScreenshotManager['currentRowNumber'];
      const hasRowLogFile = currentRow !== null && this.rowLogFiles.has(currentRow);
      
      // If this is a row-specific log and we have a row log file and exclusive mode is on,
      // only write to the row log file
      if (isRowSpecific && hasRowLogFile && this.options.rowLogExclusive) {
        const rowLogFile = this.rowLogFiles.get(currentRow!);
        rowLogFile?.write(logEntry);
      } else {
        // Otherwise write to main log and possibly row log
        this.writeToLogStreams(logEntry, '[MAIN] ', isRowSpecific);
      }
    } catch (error) {
      // If we encounter an error writing to the log file, disable file logging
      console.error(colors.colorize('red', 'Error writing to log file:'), error);
      this.options.writeToFile = false;
      this.logFile = null;
    }
  }

  /**
   * Get a formatted timestamp
   */
  private getTimestamp(): string {
    if (!this.options.showTimestamp) return '';
    return `[${this.getTimestampString()}] `;
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
   * Internal log method to reduce duplication
   */
  private logMessage(
    level: LogLevel, 
    type: string, 
    textColor: keyof Omit<ColorCodes, 'colorize'>, 
    message: string, 
    error?: unknown, 
    ...args: any[]
  ): void {
    // Check if this is a row-specific log
    const isRowSpecific = ScreenshotManager['currentRowNumber'] !== null &&
      (message.includes(`[Row ${ScreenshotManager['currentRowNumber']}]`) || 
       this.options.prefix === `Row ${ScreenshotManager['currentRowNumber']}`);
    
    // Log to console if level permits
    if (this.options.level <= level) {
      const prefix = this.formatPrefix(type);
      const coloredPrefix = colors.colorize(textColor, prefix);
      const coloredMessage = level !== LogLevel.INFO ? colors.colorize(textColor, message) : message;
      const errorDetails = error ? '\n' + this.formatError(error) : '';
      
      const logFn = level === LogLevel.ERROR ? 'error' : 'log';
      console[logFn](`${coloredPrefix} ${coloredMessage}${errorDetails}`, ...args);
    }
    
    // Write to log file
    const errorDetails = error ? '\n' + this.formatError(error) : '';
    this.writeToLogFile(level, this.formatPrefix(type) + message + errorDetails, args, isRowSpecific);
  }

  /**
   * Log a debug message
   */
  debug(message: string, ...args: any[]): void {
    this.logMessage(LogLevel.DEBUG, 'DEBUG', 'gray', message, undefined, ...args);
  }

  /**
   * Log an info message
   */
  info(message: string, ...args: any[]): void {
    this.logMessage(LogLevel.INFO, 'INFO', 'blue', message, undefined, ...args);
  }

  /**
   * Log a success message
   */
  success(message: string, ...args: any[]): void {
    this.logMessage(LogLevel.SUCCESS, 'SUCCESS', 'green', message, undefined, ...args);
  }

  /**
   * Log a warning message
   */
  warn(message: string, ...args: any[]): void {
    this.logMessage(LogLevel.WARN, 'WARN', 'yellow', message, undefined, ...args);
  }

  /**
   * Log an error message
   */
  error(message: string, error?: unknown, ...args: any[]): void {
    this.logMessage(LogLevel.ERROR, 'ERROR', 'red', message, error, ...args);
  }

  /**
   * Log a row action (for CSV processing)
   */
  row(rowNumber: number, action: string, details?: string): void {
    // Set the current row in ScreenshotManager
    ScreenshotManager.setCurrentRow(rowNumber);
    
    // Initialize row-specific log file if needed
    if (this.options.useRowBasedLogs && !this.rowLogFiles.has(rowNumber)) {
      this.initRowLogFile(rowNumber);
    }
    
    if (this.options.level <= LogLevel.INFO) {
      const timestamp = this.getTimestamp();
      const rowPrefix = colors.colorize('cyan', `[Row ${rowNumber}]`);
      const actionText = colors.colorize('bold', action);
      const logMessage = `${timestamp}${rowPrefix} ${actionText}${details ? ': ' + details : ''}`;
      
      console.log(logMessage);
      
      // This is definitely a row-specific log
      this.writeToLogFile(
        LogLevel.INFO, 
        `${timestamp}[Row ${rowNumber}] ${action}${details ? ': ' + details : ''}`, 
        [],
        true // Mark as row-specific
      );
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
  
  /**
   * Create a row-specific logger
   */
  rowLogger(rowNumber: number): Logger {
    return new Logger({
      ...this.options,
      prefix: `Row ${rowNumber}`
    });
  }
  
  /**
   * Close the log file
   */
  closeLogFile(): void {
    if (this.logFile) {
      try {
        this.logFile.write('\n=== Log closed ===\n');
        this.logFile.end();
        this.logFile = null;
      } catch (error) {
        console.error(colors.colorize('red', 'Error closing log file:'), error);
      }
    }
    
    // Close all row log files
    for (const rowNumber of this.rowLogFiles.keys()) {
      this.closeRowLogFile(rowNumber);
    }
  }

  /**
   * Log to both row-specific and global loggers with the same message
   */
  logMultiple(
    rowLogger: Logger,
    level: 'info' | 'success' | 'error' | 'warn',
    rowNum: number,
    message: string,
    details?: string
  ): void {
    const combinedMessage = details ? `${message}: ${details}` : message;
    
    // Log to row-specific logger
    rowLogger[level](combinedMessage);
    
    // Log to global CSV logger with row prefix
    this.row(rowNum, message, details);
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
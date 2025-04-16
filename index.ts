import { BrowserService } from './src/services/browser';
import { AuthService } from './src/services/auth';
import { CsvProcessor } from './src/services/csvProcessor';
import { ScreenshotManager } from './src/utils/screenshot';
import { authConfig } from './src/config/auth';
import { appConfig, getCsvPath } from './src/config/appConfig';
import { CliUtils } from './src/utils/cli';
import { logger, LogLevel } from './src/utils/logger';

/**
 * Parse command line arguments
 * @returns Options parsed from command line
 */
function parseCommandLineArgs() {
  const args = process.argv.slice(2);
  
  // Default options
  const options = {
    csvPath: '',
    retryFailedRows: true, // Default to true - retry failed rows
    processInReverse: false, // Default to false - process in normal order
    showHelp: false,
    verbose: false,
    quiet: false,
    rowLogsExclusive: true,
  };
  
  // Parse args
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--no-retry' || arg === '-n') {
      options.retryFailedRows = false;
    } else if (arg === '--reverse' || arg === '-r') {
      options.processInReverse = true;
    } else if (arg === '--help' || arg === '-h') {
      options.showHelp = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--quiet' || arg === '-q') {
      options.quiet = true;
    } else if (arg === '--row-logs-exclusive' || arg === '-e') {
      options.rowLogsExclusive = true;
    } else if (!arg.startsWith('-') && !options.csvPath) {
      // First non-flag arg is treated as the CSV path
      options.csvPath = arg;
    }
  }
  
  // If no CSV path specified, use default
  if (!options.csvPath) {
    options.csvPath = appConfig.defaultCsvPath;
  }
  
  return options;
}

/**
 * Configure the logger based on command line options
 */
function configureLogger(options: {
  verbose: boolean;
  quiet: boolean;
  rowLogsExclusive: boolean;
}): void {
  if (options.verbose) {
    logger.setLevel(LogLevel.DEBUG);
  } else if (options.quiet) {
    logger.setLevel(LogLevel.ERROR);
  } else {
    logger.setLevel(LogLevel.INFO);
  }
  
  // Configure row log exclusivity (whether row logs only go to row-specific files)
  logger.setRowLogExclusive(options.rowLogsExclusive);
}

/**
 * Display help message
 */
function displayHelp() {
  console.log(`
ChatGPT CSV Processor

Usage: node index.js [csvPath] [options]

Arguments:
  csvPath             Path to the CSV file to process (default: ${appConfig.defaultCsvPath})

Options:
  -n, --no-retry      Don't retry rows that previously failed with errors
  -r, --reverse       Process rows in reverse order (from last to first)
  -v, --verbose       Show more detailed logs
  -q, --quiet         Show only errors
  -e, --row-logs-exclusive  Write row-specific logs only to row log files (not to main log)
  -h, --help          Display this help message

Examples:
  node index.js                      # Process default prompts.csv file
  node index.js my-prompts.csv       # Process specified CSV file
  node index.js --no-retry           # Process default file without retrying error rows
  node index.js my-file.csv -n       # Process specified file without retrying error rows
  node index.js --reverse            # Process default file in reverse order
  node index.js my-file.csv -r       # Process specified file in reverse order
  node index.js --row-logs-exclusive # Use exclusive row logging
  `);
}

/**
 * Main application entry point
 */
async function main() {
  try {
    // Parse command line arguments
    const options = parseCommandLineArgs();
    
    // Configure logger based on options
    configureLogger({
      verbose: options.verbose,
      quiet: options.quiet,
      rowLogsExclusive: options.rowLogsExclusive
    });
    
    // Show help if requested
    if (options.showHelp) {
      displayHelp();
      return;
    }
    
    // Initialize screenshot directory first
    ScreenshotManager.initializeSession();
    
    // Initialize log file in the same directory - this will also start console capture
    logger.initLogFile();
    
    // Add a small delay to ensure logging is initialized
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Log startup info
    logger.info('Starting ChatGPT CSV Processor');
    logger.info(`CSV Path: ${options.csvPath}`);
    logger.info(`Retry Failed Rows: ${options.retryFailedRows ? 'Yes' : 'No'}`);
    logger.info(`Process in Reverse: ${options.processInReverse ? 'Yes' : 'No'}`);
    logger.info(`Row Logs Exclusive: ${options.rowLogsExclusive ? 'Yes' : 'No'}`);
    
    console.log('This console.log message should appear in the log file too');
    
    // Create service instances
    const browserService = new BrowserService();
    const csvProcessor = new CsvProcessor(options.retryFailedRows, options.processInReverse);
    const authService = new AuthService(authConfig);
    
    // Validate that the CSV file exists
    if (!csvProcessor.validateCsvFile(options.csvPath)) {
      logger.closeLogFile();
      return;
    }
    
    logger.info(`Opening ChatGPT to process CSV: ${options.csvPath}`);

    // Initialize browser with responsive sizing
    const page = await browserService.initialize();
    
    try {
      // Authenticate
      const isAuthenticated = await authService.authenticate(page);
      if (!isAuthenticated) {
        throw new Error('Authentication failed');
      }
      
      // Load cookies for the session
      await browserService.loadCookies(page);
      
      // Navigate to ChatGPT project
      await browserService.navigateToChatGPT(page, appConfig.chatGptProjectUrl);
      
      // Wait for chat interface
      const interfaceReady = await browserService.waitForChatInterface(page);
      if (!interfaceReady) {
        throw new Error('Failed to initialize chat interface');
      }
      
      logger.success('ChatGPT project chat is ready!');
      
      // Process the CSV file
      await csvProcessor.processRows(options.csvPath, page);
      
      // Check if console logs still work
      console.log('CSV processing has completed - this should be in the log file too');
      
      // Clean up
      await new Promise(resolve => setTimeout(resolve, 500));
      await browserService.close();
      
      // Close the log file
      logger.closeLogFile();
      
      logger.success('Browser closed. CSV processing complete.');
      
    } catch (error) {
      // Handle any errors that occur during processing
      logger.error('Error during CSV processing', error);
      
      if (page) {
        await ScreenshotManager.takeErrorScreenshot(
          page, 
          'processing-failure', 
          error instanceof Error ? error.message : String(error)
        );
      }
      
      await browserService.close();
      
      // Close the log file even if there was an error
      logger.closeLogFile();
      
      throw error;
    } finally {
      CliUtils.closeReadline();
    }
  } catch (error) {
    logger.error('Application error', error);
    process.exit(1);
  }
}

// Run the application
main();


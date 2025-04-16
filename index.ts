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
    showHelp: false,
    verbose: false,
    quiet: false
  };
  
  // Parse args
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--no-retry' || arg === '-n') {
      options.retryFailedRows = false;
    } else if (arg === '--help' || arg === '-h') {
      options.showHelp = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--quiet' || arg === '-q') {
      options.quiet = true;
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
function configureLogger(verbose: boolean, quiet: boolean): void {
  if (verbose) {
    logger.setLevel(LogLevel.DEBUG);
  } else if (quiet) {
    logger.setLevel(LogLevel.ERROR);
  } else {
    logger.setLevel(LogLevel.INFO);
  }
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
  -v, --verbose       Show more detailed logs
  -q, --quiet         Show only errors
  -h, --help          Display this help message

Examples:
  node index.js                      # Process default prompts.csv file
  node index.js my-prompts.csv       # Process specified CSV file
  node index.js --no-retry           # Process default file without retrying error rows
  node index.js my-file.csv -n       # Process specified file without retrying error rows
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
    configureLogger(options.verbose, options.quiet);
    
    // Show help if requested
    if (options.showHelp) {
      displayHelp();
      return;
    }
    
    // Initialize screenshot directory
    ScreenshotManager.ensureScreenshotDirectory();
    
    // Create service instances
    const browserService = new BrowserService();
    const csvProcessor = new CsvProcessor(options.retryFailedRows);
    const authService = new AuthService(authConfig);
    
    // Log startup info
    logger.info('Starting ChatGPT CSV Processor');
    logger.info(`CSV Path: ${options.csvPath}`);
    logger.info(`Retry Failed Rows: ${options.retryFailedRows ? 'Yes' : 'No'}`);
    
    // Validate that the CSV file exists
    if (!csvProcessor.validateCsvFile(options.csvPath)) {
      return;
    }
    
    logger.info(`Opening ChatGPT to process CSV: ${options.csvPath}`);

    // Initialize browser
    const page = await browserService.initialize(
      appConfig.browser.width, 
      appConfig.browser.height
    );
    
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
      
      // Clean up
      await new Promise(resolve => setTimeout(resolve, 500));
      await browserService.close();
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


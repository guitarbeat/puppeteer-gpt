import { BrowserService } from './src/services/browser';
import { AuthService } from './src/services/auth';
import { CsvService } from './src/services/csvService';
import { ScreenshotManager } from './src/utils/logging/screenshot';
import { appConfig, authConfig, getCsvPath } from './src/config/appConfig';
import { CliUtils } from './src/utils/cli';

// Define LogLevel enum to be compatible with the removed logger
enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  SUCCESS = 2,
  WARN = 3,
  ERROR = 4,
  NONE = 5
}

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
    // Screenshot setting
    screenshotsDisabled: false, // By default, take regular screenshots
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
    } else if (arg === '--no-screenshots' || arg === '--disable-screenshots') {
      options.screenshotsDisabled = true;
    } else if (!arg.startsWith('-') && !options.csvPath) {
      // First non-flag arg is treated as the CSV path
      options.csvPath = arg;
    }
  }
  
  // If no CSV path specified, use default
  if (!options.csvPath) {
    options.csvPath = appConfig.paths.defaultCsvPath;
  }
  
  return options;
}

/**
 * Configure the logger based on command line options - now simply sets the log level for reference
 */
function configureLogger(options: {
  verbose: boolean;
  quiet: boolean;
  rowLogsExclusive: boolean;
}): void {
  // Just storing the level information for reference since we're using console directly
  const logLevel = options.verbose ? LogLevel.DEBUG : 
                  options.quiet ? LogLevel.ERROR : 
                  LogLevel.INFO;
  
  console.info(`Log level set to: ${LogLevel[logLevel]}`);
}

/**
 * Display help message
 */
function displayHelp() {
  console.log(`
ChatGPT CSV Processor

Usage: node index.js [csvPath] [options]

Arguments:
  csvPath             Path to the CSV file to process (default: ${appConfig.paths.defaultCsvPath})

Options:
  -n, --no-retry      Don't retry rows that previously failed with errors
  -r, --reverse       Process rows in reverse order (from last to first)
  -v, --verbose       Show more detailed logs
  -q, --quiet         Show only errors
  -e, --row-logs-exclusive  Write row-specific logs only to row log files (not to main log)
  --no-screenshots    Disable regular screenshots (error screenshots still taken)
  -h, --help          Display this help message

Examples:
  node index.js                      # Process default prompts.csv file
  node index.js my-prompts.csv       # Process specified CSV file
  node index.js --no-retry           # Process default file without retrying error rows
  node index.js my-file.csv -n       # Process specified file without retrying error rows
  node index.js --reverse            # Process default file in reverse order
  node index.js --no-screenshots     # Only take screenshots for errors
  `);
}

/**
 * Main application entry point
 */
async function main() {
  try {
    // Parse command line arguments
    const options = parseCommandLineArgs();
    
    // Show help if requested
    if (options.showHelp) {
      displayHelp();
      return;
    }
    
    // Initialize screenshot directory first
    ScreenshotManager.initializeSession();
    
    // Configure screenshot settings
    ScreenshotManager.setScreenshotsEnabled(!options.screenshotsDisabled);
    
    // Configure logger based on options
    configureLogger({
      verbose: options.verbose,
      quiet: options.quiet,
      rowLogsExclusive: options.rowLogsExclusive
    });
    
    // No need to initialize log file anymore
    
    // Log startup info
    console.info('Starting ChatGPT CSV Processor');
    console.info(`CSV Path: ${options.csvPath}`);
    console.info(`Retry Failed Rows: ${options.retryFailedRows ? 'Yes' : 'No'}`);
    console.info(`Process in Reverse: ${options.processInReverse ? 'Yes' : 'No'}`);
    console.info(`Row Logs Exclusive: ${options.rowLogsExclusive ? 'Yes' : 'No'}`);
    console.info(`Screenshots: ${options.screenshotsDisabled ? 'Errors only' : 'Enabled'}`);
    
    console.log('This console.log message should appear in the log file too');
    
    // Create service instances
    const browserService = new BrowserService();
    const csvProcessor = new CsvService(options.retryFailedRows, options.processInReverse);
    const authService = new AuthService(authConfig);
    
    // Validate that the CSV file exists
    if (!csvProcessor.validateCsvFile(options.csvPath)) {
      return;
    }
    
    console.info(`Opening ChatGPT to process CSV: ${options.csvPath}`);

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
      console.log(`Navigating to ChatGPT project URL: ${appConfig.urls.chatGptProjectUrl}`);
      await page.goto(appConfig.urls.chatGptProjectUrl, { 
        waitUntil: 'networkidle2',
        timeout: appConfig.timing.pageLoadTimeout
      });
      
      // Wait for chat interface
      const interfaceReady = await browserService.waitForChatInterface(page);
      if (!interfaceReady) {
        throw new Error('Failed to initialize chat interface');
      }
      
      console.info('ChatGPT project chat is ready!');
      
      // Process the CSV file
      await csvProcessor.processRows(options.csvPath, page);
      
      // Check if console logs still work
      console.log('CSV processing has completed - this should be in the log file too');
      
      // Clean up
      await new Promise(resolve => setTimeout(resolve, 500));
      await browserService.close();
      
      console.info('Browser closed. CSV processing complete.');
      
    } catch (error) {
      // Handle any errors that occur during processing
      console.error('Error during CSV processing', error);
      if (page) {
        await ScreenshotManager.error(
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
    console.error('Application error', error);
    process.exit(1);
  }
}

// Run the application
main();


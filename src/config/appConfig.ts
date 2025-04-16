/**
 * Application configuration settings
 */
export interface AppConfig {
  // Default CSV path to use if none is provided
  defaultCsvPath: string;
  
  // ChatGPT project URL
  chatGptProjectUrl: string;
  
  // Browser window dimensions
  browser: {
    width: number;
    height: number;
    headless: boolean;
    incognito: boolean;
  };
  
  // Timing configurations
  timing: {
    pageLoadTimeout: number;
    betweenRowDelay: number;
    maxRetries: number;
    pageStabilizationDelay: number;
    initialRetryDelay: number;
    maxRetryDelay: number;
  };
  
  // Error handling settings
  errorHandling: {
    // Whether to retry rows with errors by default (can be overridden by CLI)
    retryFailedRowsByDefault: boolean;
    
    // Text to look for in response to identify errors
    errorIdentifier: string;
  };
  
  // UI element selectors
  selectors: {
    chatTextarea: string;
    sendButton: string;
    uploadButton: string;
    fileInput: string;
    assistantMessage: string;
  };
}

/**
 * Default application configuration
 */
export const appConfig: AppConfig = {
  defaultCsvPath: "prompts.csv",
  chatGptProjectUrl: "https://chat.openai.com/g/g-p-67f02dae3f508191856fe6de977dadb4-bme-349-hw4/project",
  
  browser: {
    width: 375, // iPhone X width - mobile size
    height: 812, // iPhone X height - mobile size
    headless: true,
    incognito: true
  },
  
  timing: {
    pageLoadTimeout: 60000, // 60 seconds
    betweenRowDelay: 5000,  // 5 seconds
    maxRetries: 3,
    pageStabilizationDelay: 2000, // 2 seconds
    initialRetryDelay: 5000, // 5 seconds initial retry delay
    maxRetryDelay: 30000    // 30 seconds max retry delay
  },
  
  errorHandling: {
    retryFailedRowsByDefault: true,
    errorIdentifier: 'ERROR'
  },
  
  selectors: {
    chatTextarea: '#prompt-textarea',
    sendButton: '[data-testid="send-button"]',
    uploadButton: 'button[aria-label="Upload files and more"]',
    fileInput: 'input[type="file"]',
    assistantMessage: 'div[data-message-author-role="assistant"]'
  }
};

/**
 * Get the path to the CSV file from command line arguments or use default
 */
export function getCsvPath(): string {
  return process.argv[2] || appConfig.defaultCsvPath;
} 
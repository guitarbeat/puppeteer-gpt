/**
 * Application configuration settings
 */
export interface AppConfig {
  // File and directory paths
  paths: {
    defaultCsvPath: string;
    cookiePath: string;
    screenshotDir: string;
  };
  
  // URL configurations
  urls: {
    chatGptProjectUrl: string;
    loginUrl: string;
  };
  
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
    loginTimeout: number;
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
    loginSuccess: string;
  };
}

/**
 * Default application configuration
 */
export const appConfig: AppConfig = {
  paths: {
    defaultCsvPath: "prompts.csv",
    cookiePath: "cookies/chatgpt.com.cookies.json",
    screenshotDir: "screenshots"
  },
  
  urls: {
    chatGptProjectUrl: "https://chat.openai.com/g/g-p-67f02dae3f508191856fe6de977dadb4-bme-349-hw4/project",
    loginUrl: "https://chat.openai.com/auth/login"
  },
  
  browser: {
    width: 1200, // Increased from 375 to 1200 for easier debugging
    height: 800, // Increased from 812 to 800 for easier debugging
    headless: false, // Changed from true to false for debugging
    incognito: true
  },
  
  timing: {
    pageLoadTimeout: 90000,  // 90 seconds
    loginTimeout: 60000,      // 60 seconds to allow for manual login
    betweenRowDelay: 5000,   // 5 seconds
    maxRetries: 3,
    pageStabilizationDelay: 2000, // 2 seconds
    initialRetryDelay: 5000, // 5 seconds initial retry delay
    maxRetryDelay: 30000     // 30 seconds max retry delay
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
    assistantMessage: 'div[data-message-author-role="assistant"]',
    loginSuccess: '#prompt-textarea, [data-testid="send-button"], button[aria-label="Upload files and more"]'
  }
};

/**
 * Get the path to the CSV file from command line arguments or use default
 */
export function getCsvPath(): string {
  return process.argv[2] || appConfig.paths.defaultCsvPath;
}

/**
 * Auth configuration extracted for backward compatibility
 */
export interface AuthConfig {
  cookiePath: string;
  loginUrl: string;
  successSelector: string;
  loginTimeout?: number;
  screenshotDir?: string;
}

/**
 * Auth configuration for backward compatibility
 */
export const authConfig: AuthConfig = {
  cookiePath: appConfig.paths.cookiePath,
  loginUrl: appConfig.urls.loginUrl,
  successSelector: appConfig.selectors.loginSuccess,
  loginTimeout: appConfig.timing.loginTimeout,
  screenshotDir: appConfig.paths.screenshotDir
}; 
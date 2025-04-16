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
  };
  
  // Timing configurations
  timing: {
    pageLoadTimeout: number;
    betweenRowDelay: number;
    maxRetries: number;
  };
  
  // Error handling settings
  errorHandling: {
    // Whether to retry rows with errors by default (can be overridden by CLI)
    retryFailedRowsByDefault: boolean;
    
    // Text to look for in response to identify errors
    errorIdentifier: string;
  };
}

/**
 * Default application configuration
 */
export const appConfig: AppConfig = {
  defaultCsvPath: "prompts.csv",
  chatGptProjectUrl: "https://chat.openai.com/g/g-p-67f02dae3f508191856fe6de977dadb4-bme-349-hw4/project",
  
  browser: {
    width: 480,
    height: 853
  },
  
  timing: {
    pageLoadTimeout: 60000, // 60 seconds
    betweenRowDelay: 5000,  // 5 seconds
    maxRetries: 3
  },
  
  errorHandling: {
    retryFailedRowsByDefault: true,
    errorIdentifier: 'ERROR'
  }
};

/**
 * Get the path to the CSV file from command line arguments or use default
 */
export function getCsvPath(): string {
  return process.argv[2] || appConfig.defaultCsvPath;
} 
/**
 * Logger module for upload operations
 */

export interface Logger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  success(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

/**
 * Logger for upload operations
 */
export const uploadLogger: Logger = {
  debug(message: string, ...args: any[]) {
    console.debug(`[UPLOAD DEBUG] ${message}`, ...args);
  },

  info(message: string, ...args: any[]) {
    console.info(`[UPLOAD INFO] ${message}`, ...args);
  },

  success(message: string, ...args: any[]) {
    console.info(`[UPLOAD SUCCESS] ${message}`, ...args);
  },

  warn(message: string, ...args: any[]) {
    console.warn(`[UPLOAD WARNING] ${message}`, ...args);
  },

  error(message: string, ...args: any[]) {
    console.error(`[UPLOAD ERROR] ${message}`, ...args);
  }
};

/**
 * Logger factory for creating loggers for different modules
 */
export function createLogger(module: string): Logger {
  return {
    debug(message: string, ...args: any[]) {
      console.debug(`[${module.toUpperCase()} DEBUG] ${message}`, ...args);
    },
    
    info(message: string, ...args: any[]) {
      console.info(`[${module.toUpperCase()} INFO] ${message}`, ...args);
    },
    
    success(message: string, ...args: any[]) {
      console.info(`[${module.toUpperCase()} SUCCESS] ${message}`, ...args);
    },
    
    warn(message: string, ...args: any[]) {
      console.warn(`[${module.toUpperCase()} WARNING] ${message}`, ...args);
    },
    
    error(message: string, ...args: any[]) {
      console.error(`[${module.toUpperCase()} ERROR] ${message}`, ...args);
    }
  };
} 
import * as path from 'path';
import * as fs from 'fs';
import { uploadLogger } from './logger';

/**
 * Process file path to handle spaces and special characters
 */
export function processFilePath(filePath: string): string {
  try {
    return decodeURIComponent(filePath.trim()).replace(/\\/g, '');
  } catch (e) {
    return filePath.trim();
  }
}

/**
 * Verify if a file exists and return normalized path
 */
export function verifyFile(filePath: string): { exists: boolean, path: string } {
  try {
    const normalizedPath = processFilePath(filePath);
    const exists = fs.existsSync(normalizedPath);
    if (!exists) {
      uploadLogger.error(`File not found: ${normalizedPath}`);
    }
    return { exists, path: normalizedPath };
  } catch (e) {
    uploadLogger.error(`Error checking file: ${filePath}`, e);
    return { exists: false, path: filePath };
  }
}

/**
 * Filter out any non-existent files and return valid ones
 */
export function filterExistingFiles(filePaths: string[]): string[] {
  return filePaths
    .map(processFilePath)
    .filter(filePath => {
      try {
        const exists = fs.existsSync(filePath);
        if (!exists) {
          uploadLogger.error(`File not found: ${filePath}`);
        }
        return exists;
      } catch (e) {
        uploadLogger.error(`Error checking file: ${filePath}`, e);
        return false;
      }
    });
}

/**
 * Get file stats and log information
 */
export function getFileInfo(filePath: string): { size: number; exists: boolean } {
  try {
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
      uploadLogger.error(`File does not exist: ${resolvedPath}`);
      return { size: 0, exists: false };
    }
    
    const stats = fs.statSync(resolvedPath);
    uploadLogger.debug(`File verified: ${resolvedPath} (${stats.size} bytes)`);
    return { size: stats.size, exists: true };
  } catch (e) {
    uploadLogger.error(`Error checking file: ${filePath}`, e);
    return { size: 0, exists: false };
  }
}

/**
 * Resolve file paths to absolute paths with error checking
 */
export function resolveFilePaths(filePaths: string[]): string[] {
  return filePaths.map(filePath => {
    try {
      const resolvedPath = path.resolve(processFilePath(filePath));
      const exists = fs.existsSync(resolvedPath);
      
      if (!exists) {
        uploadLogger.error(`File does not exist after path resolution: ${resolvedPath}`);
        return '';
      }
      
      return resolvedPath;
    } catch (e) {
      uploadLogger.error(`Error resolving path: ${filePath}`, e);
      return '';
    }
  }).filter(path => path !== '');
}

/**
 * Verify no duplicate files in array
 */
export function removeDuplicateFiles(filePaths: string[]): string[] {
  // Create a map of resolved paths to original paths
  const pathMap = new Map<string, string>();
  
  filePaths.forEach(filePath => {
    try {
      const resolvedPath = path.resolve(processFilePath(filePath));
      // Only keep the first occurrence of each resolved path
      if (!pathMap.has(resolvedPath)) {
        pathMap.set(resolvedPath, filePath);
      }
    } catch (e) {
      // Keep the original path if resolution fails
      if (!pathMap.has(filePath)) {
        pathMap.set(filePath, filePath);
      }
    }
  });
  
  // Convert back to array
  return Array.from(pathMap.values());
}

/**
 * Truncate a string with ellipsis if it exceeds max length
 * @param text String to truncate
 * @param maxLength Maximum length before truncating
 * @returns Truncated string with ellipsis if needed
 */
export function truncateString(text: string, maxLength: number): string {
  if (!text) return '';
  return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
} 
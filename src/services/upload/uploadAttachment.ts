import { Page } from 'puppeteer';
import * as path from 'path';
import { ScreenshotManager } from '../../utils/logging/screenshot';
import { UploadOptions, DEFAULT_UPLOAD_OPTIONS } from '../../utils/types';
import { filterExistingFiles, processFilePath, resolveFilePaths, getFileInfo } from '../../utils/fileHelpers';
import { openUploadMenu, getFileInput, uploadFiles, waitForUploadToComplete } from './uploadHelpers';

/**
 * Uploads multiple files to the ChatGPT conversation at once.
 * This is more efficient than uploading files one by one.
 * @param page Puppeteer page instance
 * @param filePaths Array of paths to files to upload
 * @param options Upload options (optional)
 * @returns Promise<boolean> indicating if all files were uploaded successfully
 */
export async function uploadMultipleAttachments(
  page: Page, 
  filePaths: string[],
  options: Partial<UploadOptions> = {}
): Promise<boolean> {
  const mergedOptions = { ...DEFAULT_UPLOAD_OPTIONS, ...options };
  
  // Process all file paths and filter non-existent files
  const processedFilePaths = filePaths.map(filePath => processFilePath(filePath));
  const existingFiles = filterExistingFiles(processedFilePaths);

  if (existingFiles.length === 0) {
    throw new Error('No valid files to upload');
  }

  console.info(`Starting upload of ${existingFiles.length} files at once`);
  
  try {
    // Open the upload menu
    await openUploadMenu(page, mergedOptions.timeout);

    // Get the file input
    const fileInput = await getFileInput(page, mergedOptions.timeout);
    
    // Resolve all file paths to absolute paths
    const resolvedPaths = resolveFilePaths(existingFiles);
    
    // Upload all files at once
    await uploadFiles(page, fileInput, resolvedPaths);
    
    // Wait for upload to complete
    const waitTimeMultiplier = Math.min(existingFiles.length, 2);
    await waitForUploadToComplete(page, existingFiles.length, waitTimeMultiplier);
    
    // Take a verification screenshot
    await ScreenshotManager.takeScreenshot(page, 'upload-complete-multiple', false, false);
    
    console.info(`All ${existingFiles.length} files uploaded successfully`);
    return true;
  } catch (error) {
    console.error('Failed during file upload', error);
    await ScreenshotManager.takeErrorScreenshot(page, 'upload-error-multiple');
    throw new Error(`File upload failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Uploads a file to the ChatGPT conversation.
 * @param page Puppeteer page instance
 * @param filePath Path to the file to upload
 * @param options Upload options (optional)
 */
export async function uploadAttachment(
  page: Page, 
  filePath: string,
  options: Partial<UploadOptions> = {}
): Promise<void> {
  const mergedOptions = { ...DEFAULT_UPLOAD_OPTIONS, ...options };
  
  // Process the file path
  const processedPath = processFilePath(filePath);
  
  // Check if file exists and get stats
  const fileInfo = getFileInfo(processedPath);
  if (!fileInfo.exists) {
    throw new Error(`File not found: ${processedPath}`);
  }
  
  console.info(`Starting upload for: ${processedPath} (${fileInfo.size} bytes)`);
  
  try {
    // Take a screenshot of the current state
    await ScreenshotManager.takeScreenshot(page, 'before-upload-start', false, false);
    
    // Open the upload menu
    await openUploadMenu(page, mergedOptions.timeout);

    // Get the file input
    const fileInput = await getFileInput(page, mergedOptions.timeout);
    
    // Resolve the path and upload
    const resolvedPath = path.resolve(processedPath);
    await uploadFiles(page, fileInput, [resolvedPath]);
    
    // Wait for upload to complete
    await waitForUploadToComplete(page, 1);
    
    // Take a verification screenshot
    await ScreenshotManager.takeScreenshot(page, 'upload-complete', false, false);
    
    console.info('File upload complete');
  } catch (error) {
    console.error('Failed during file upload', error);
    await ScreenshotManager.takeErrorScreenshot(page, 'upload-error');
    throw new Error(`File upload failed: ${error instanceof Error ? error.message : String(error)}`);
  }
} 
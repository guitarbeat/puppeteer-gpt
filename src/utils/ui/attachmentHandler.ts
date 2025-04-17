import { Page } from 'puppeteer';
import { uploadLogger } from '../logger';
import { filterExistingFiles, removeDuplicateFiles } from '../fileHelpers';
import { uploadAttachment, uploadMultipleAttachments } from '../../services/upload';
import { pause } from './textEntry';

/**
 * Module for handling file attachments in ChatGPT
 */

/**
 * Handles attachment uploads
 */
export async function handleAttachments(page: Page, attachments: string[], useMultiUpload: boolean): Promise<void> {
  const validAttachments = filterExistingFiles(attachments);
  
  if (validAttachments.length === 0) {
    uploadLogger.warn('No valid attachments found. All file paths are invalid or inaccessible.');
    return;
  }
  
  const uniqueAttachments = removeDuplicateFiles(validAttachments);
  uploadLogger.info(`Uploading ${uniqueAttachments.length} attachment(s)...`);
  
  // Try multi-upload if enabled
  if (useMultiUpload && uniqueAttachments.length > 1) {
    try {
      await uploadMultipleAttachments(page, uniqueAttachments);
      uploadLogger.success(`Successfully uploaded ${uniqueAttachments.length} files at once`);
      await pause(2000);
      return;
    } catch (error) {
      uploadLogger.warn("Multi-upload failed, falling back to individual uploads", error);
    }
  }
  
  // Upload files individually
  for (let i = 0; i < uniqueAttachments.length; i++) {
    try {
      await uploadAttachment(page, uniqueAttachments[i]);
      uploadLogger.success(`Uploaded file ${i+1}/${uniqueAttachments.length}`);
      
      if (i < uniqueAttachments.length - 1) {
        await pause(3000);
      }
    } catch (error) {
      uploadLogger.error(`Failed to upload file ${i+1}/${uniqueAttachments.length}`, error);
    }
  }
  
  await pause(2000);
} 
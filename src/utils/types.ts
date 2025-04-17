import { Page } from 'puppeteer';

/**
 * Common interface for upload options
 */
export interface UploadOptions {
  timeout?: number;
  screenshotPrefix?: string;
  waitTimeMultiplier?: number;
}

/**
 * Default upload options
 */
export const DEFAULT_UPLOAD_OPTIONS: UploadOptions = {
  timeout: 20000,
  screenshotPrefix: 'upload',
  waitTimeMultiplier: 1
};

/**
 * Configuration options for message sending
 */
export interface MessageOptions {
  useMultiUpload?: boolean;
  responseTimeout?: number;
  screenshotPrefix?: string;
}

/**
 * Default message options
 */
export const DEFAULT_MESSAGE_OPTIONS: MessageOptions = {
  useMultiUpload: true,
  responseTimeout: 180000,
  screenshotPrefix: 'message'
};

/**
 * UI Element selectors used throughout the application
 */
export const SELECTORS = {
  TEXTAREA: '#prompt-textarea',
  SEND_BUTTON: "[data-testid='send-button']",
  UPLOAD_BUTTON: 'button[aria-label="Upload files and more"]',
  FILE_INPUT: 'input[type="file"]',
  ASSISTANT_MESSAGE: "div[data-message-author-role='assistant']"
};

/**
 * Loading indicator selectors
 */
export const LOADING_INDICATORS = [
  '[role="progressbar"]',
  '.animate-spin',
  '[aria-busy="true"]',
  // Specific SVG circle loading animation in ChatGPT
  'circle[stroke-dashoffset][stroke-dasharray]',
  'circle.origin-\\[50\\%_50\\%\\].-rotate-90'
];

/**
 * File indicator selectors used to verify uploads
 */
export const FILE_INDICATORS = [
  // File thumbnails
  'img[alt*="thumbnail"]',
  // File names in the UI
  'div[role="button"]',
  // Additional possible indicators
  '[data-testid*="attachment"]',
  '[data-testid*="file"]',
  'img[alt*="Image"]'
]; 
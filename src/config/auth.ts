import { AuthConfig } from '../services/auth';

export const authConfig: AuthConfig = {
  cookiePath: 'cookies/chatgpt.com.cookies.json',
  loginUrl: 'https://chat.openai.com/auth/login',
  successSelector: '#prompt-textarea, [data-testid="send-button"], button[aria-label="Upload files and more"]',
  loginTimeout: 60000, // 60 seconds to allow for manual login
  screenshotDir: 'screenshots'
}; 
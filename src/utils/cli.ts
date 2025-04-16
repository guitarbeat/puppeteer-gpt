import readline from 'readline';

/**
 * Utilities for command-line interface interactions
 */
export class CliUtils {
  private static readlineInterface: readline.Interface | null = null;
  
  /**
   * Initialize the readline interface
   */
  static initializeReadline(): readline.Interface {
    if (!this.readlineInterface) {
      this.readlineInterface = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
    }
    return this.readlineInterface;
  }
  
  /**
   * Ask a question and get a response with optional timeout
   * @param question The question to ask
   * @param timeout Optional timeout in milliseconds
   * @returns User's input
   */
  static async promptUser(question: string, timeout?: number): Promise<string> {
    const rl = this.initializeReadline();
    let timer: NodeJS.Timeout | undefined;

    return new Promise<string>((resolve, reject) => {
      rl.question(question, (answer) => {
        if (timer) {
          clearTimeout(timer);
        }
        resolve(answer);
      });

      if (timeout) {
        timer = setTimeout(() => {
          reject(new Error("Question timeout"));
          this.closeReadline();
        }, timeout);
      }
    });
  }
  
  /**
   * Wait for user to continue by pressing Enter
   * @param message The message to display
   */
  static async waitForContinue(message: string = 'Press Enter to continue...'): Promise<void> {
    await this.promptUser(message);
  }
  
  /**
   * Close the readline interface
   */
  static closeReadline(): void {
    if (this.readlineInterface) {
      this.readlineInterface.close();
      this.readlineInterface = null;
    }
  }
} 
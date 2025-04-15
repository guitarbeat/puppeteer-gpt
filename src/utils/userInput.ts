import readline from 'readline';

/**
 * Ask the user a question and wait for input
 * @param question The question to ask
 * @returns User's input as a string
 */
export async function askUserInput(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Wait for the user to press Enter to continue
 * @param message Optional message to display
 */
export async function waitForUserToContinue(message = 'Press Enter to continue...'): Promise<void> {
  const input = await askUserInput(message);
  return;
} 
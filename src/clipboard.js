import { execSync } from 'child_process';

/**
 * Copy the given text to the system clipboard using clip.exe.
 * Uses stdin piping which works reliably even from windowless processes.
 * @param {string} text - The text to copy.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function copyToClipboard(text) {
  try {
    execSync('clip', {
      input: String(text),
      stdio: ['pipe', 'ignore', 'ignore'],
      timeout: 5000,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

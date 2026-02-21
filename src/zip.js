import archiver from 'archiver';
import { createWriteStream } from 'fs';
import { access, constants } from 'fs/promises';
import { tmpdir } from 'os';
import { join, basename } from 'path';
import { randomBytes } from 'crypto';

/**
 * Compress multiple files into a single ZIP archive.
 * @param {string[]} filePaths - Array of absolute file paths to include.
 * @param {string} [outputPath] - Absolute path for the resulting ZIP file.
 *   If omitted, a temporary file in os.tmpdir() is used.
 * @returns {Promise<string>} The absolute path of the created ZIP file.
 */
export async function zipFiles(filePaths, outputPath) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    throw new Error('filePaths must be a non-empty array of file paths');
  }

  // Verify every input file exists and is readable before we start archiving.
  for (const fp of filePaths) {
    try {
      await access(fp, constants.R_OK);
    } catch {
      throw new Error(`File not found or not readable: ${fp}`);
    }
  }

  // Determine the output location.
  if (!outputPath) {
    const id = randomBytes(8).toString('hex');
    outputPath = join(tmpdir(), `archive-${id}.zip`);
  }

  return new Promise((resolve, reject) => {
    const output = createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(outputPath));

    output.on('error', (err) => {
      reject(new Error(`Write error: ${err.message}`));
    });

    archive.on('error', (err) => {
      reject(new Error(`Archive error: ${err.message}`));
    });

    archive.on('warning', (err) => {
      if (err.code !== 'ENOENT') {
        reject(new Error(`Archive warning: ${err.message}`));
      }
    });

    archive.pipe(output);

    for (const fp of filePaths) {
      archive.file(fp, { name: basename(fp) });
    }

    archive.finalize();
  });
}

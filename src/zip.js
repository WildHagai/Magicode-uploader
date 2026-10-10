import archiver from 'archiver';
import { createWriteStream } from 'fs';
import { mkdtemp, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join, basename } from 'path';

/**
 * Compress files and/or directories into a single ZIP archive.
 * Directories are added recursively under their own name.
 *
 * @param {string[]} paths - Absolute paths of the files/directories to include.
 * @param {string} zipName - File name of the archive (e.g. "Photos.zip").
 *   It is created in a fresh temporary directory so the name never collides.
 * @returns {Promise<string>} The absolute path of the created ZIP file.
 */
export async function zipFiles(paths, zipName) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('paths must be a non-empty array');
  }

  const entries = [];
  for (const p of paths) {
    let s;
    try {
      s = await stat(p);
    } catch {
      throw new Error(`File not found or not readable: ${p}`);
    }
    entries.push({ path: p, isDir: s.isDirectory() });
  }

  const outputPath = join(await mkdtemp(join(tmpdir(), 'magicode-')), zipName);

  return new Promise((resolve, reject) => {
    const output = createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => resolve(outputPath));
    output.on('error', (err) => reject(new Error(`Write error: ${err.message}`)));
    archive.on('error', (err) => reject(new Error(`Archive error: ${err.message}`)));
    archive.on('warning', (err) => reject(new Error(`Archive warning: ${err.message}`)));

    archive.pipe(output);

    for (const e of entries) {
      if (e.isDir) {
        archive.directory(e.path, basename(e.path));
      } else {
        archive.file(e.path, { name: basename(e.path) });
      }
    }

    archive.finalize();
  });
}

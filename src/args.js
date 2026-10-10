import fs from 'node:fs';
import path from 'node:path';

/**
 * Paths come either directly on the command line, or (from the Explorer
 * context menu) as `--list <file>`: a UTF-8 file with one path per line,
 * which avoids the command-line length limit on large selections. The list
 * file is deleted after reading.
 */
export function readArgs(argv) {
  if (argv[0] === '--list' && argv[1]) {
    const listFile = argv[1];
    const text = fs.readFileSync(listFile, 'utf-8').replace(/^﻿/, '');
    try { fs.unlinkSync(listFile); } catch {}
    return text.split(/\r?\n/).filter(Boolean);
  }
  return argv;
}

/** Name for the archive when more than one item, or a folder, is uploaded. */
export function zipNameFor(paths) {
  const nameOf = (p) => path.basename(p) || p.replace(/[:\\/]/g, '') || 'files';
  const base = paths.length === 1 ? nameOf(paths[0]) : nameOf(path.dirname(paths[0]));
  return `${base}.zip`;
}

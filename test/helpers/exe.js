// The uploader under test: MAGICODE_EXE, or the Release build (`npm run build`).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const EXE = process.env.MAGICODE_EXE
  || fileURLToPath(new URL('../../src/MagicodeUploader/bin/Release/net48/MagicodeUploader.exe', import.meta.url));

if (!fs.existsSync(EXE)) {
  throw new Error(`${EXE} not found - run \`npm run build\` first`);
}

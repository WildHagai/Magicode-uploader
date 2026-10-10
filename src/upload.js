import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

// MAGICODE_BASE_URL lets tests point the uploader at a local mock server.
const BASE_URL = new URL(process.env.MAGICODE_BASE_URL || 'https://send.magicode.me');
const transport = BASE_URL.protocol === 'http:' ? http : https;

// Same chunk size the send.magicode.me web client uses.
export const CHUNK_SIZE = 2 * 1024 * 1024;
export const CHUNK_ATTEMPTS = 5;
const RETRY_DELAY_MS = Number(process.env.MAGICODE_RETRY_DELAY_MS) || 1000;
const REQUEST_TIMEOUT_MS = 120000;

const agent = new transport.Agent({ keepAlive: true, maxSockets: 1 });

/**
 * Make an HTTPS request and return the status code and parsed JSON body.
 * @param {object} options - Node http(s).request options.
 * @param {Buffer|null} body - Request body to write (or null for no body).
 * @returns {Promise<{statusCode: number, data: object}>}
 */
function jsonRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = transport.request({
      agent,
      hostname: BASE_URL.hostname,
      port: BASE_URL.port || (BASE_URL.protocol === 'http:' ? 80 : 443),
      ...options,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(raw) });
        } catch {
          reject(new Error(`invalid JSON response (HTTP ${res.statusCode}): ${raw.slice(0, 200)}`));
        }
      });
      res.on('error', reject);
    });
    req.on('error', (err) => reject(new Error(`HTTPS request failed: ${err.message}`)));
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds`));
    });
    req.end(body ?? undefined);
  });
}

/**
 * Step 1 -- Prepare the upload.
 * POST /send-file/prep-upload with filename and size.
 * @param {string} filename - The basename of the file.
 * @param {number} size - File size in bytes.
 * @returns {Promise<{keyUpload: string, keyFile: string}>}
 */
export async function prepUpload(filename, size) {
  const payload = Buffer.from(JSON.stringify({ filename, size }), 'utf-8');

  const { statusCode, data } = await jsonRequest({
    path: '/send-file/prep-upload',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': payload.length,
    },
  }, payload);

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`prep-upload failed with HTTP ${statusCode}: ${JSON.stringify(data)}`);
  }
  if (!data.keyUpload || !data.keyFile) {
    throw new Error(`prep-upload returned unexpected payload: ${JSON.stringify(data)}`);
  }

  return { keyUpload: data.keyUpload, keyFile: data.keyFile };
}

/**
 * Send one chunk of the file as multipart/form-data.
 * @returns {Promise<object>} Parsed JSON response ({ ok, end }).
 */
async function sendChunk(chunk, position, keyUpload, keyFile) {
  const boundary = '----MagicodeUploader' + Math.random().toString(16).slice(2);
  const head = Buffer.from(
    `--${boundary}\r\n` +
    'Content-Disposition: form-data; name="file"; filename="blob"\r\n' +
    'Content-Type: application/octet-stream\r\n\r\n',
    'utf-8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
  const body = Buffer.concat([head, chunk, tail]);

  const { statusCode, data } = await jsonRequest({
    path:
      `/send-file/data-upload?position=${position}&length=${chunk.length}` +
      `&keyUpload=${encodeURIComponent(keyUpload)}` +
      `&keyFile=${encodeURIComponent(keyFile)}`,
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
    },
  }, body);

  if (statusCode < 200 || statusCode >= 300 || !data.ok) {
    throw new Error(`data-upload at byte ${position} failed (HTTP ${statusCode}): ${JSON.stringify(data)}`);
  }
  return data;
}

/**
 * Step 2 -- Upload the file in chunks, retrying each chunk a few times
 * before giving up. Only one chunk is held in memory at a time.
 *
 * @param {string} filePath - Absolute path to the file.
 * @param {number} fileSize - File size in bytes.
 * @param {string} keyUpload - Upload key from prep-upload.
 * @param {string} keyFile - File key from prep-upload.
 * @param {function} [onProgress] - Optional callback: { uploaded, total, percent }.
 */
export async function dataUpload(filePath, fileSize, keyUpload, keyFile, onProgress) {
  const fd = await fs.promises.open(filePath, 'r');
  try {
    let position = 0;
    do {
      const length = Math.min(CHUNK_SIZE, fileSize - position);
      const chunk = Buffer.alloc(length);
      const { bytesRead } = await fd.read(chunk, 0, length, position);
      if (bytesRead !== length) {
        throw new Error(`file changed while uploading (read ${bytesRead} of ${length} bytes at ${position})`);
      }

      let result;
      for (let attempt = 1; ; attempt++) {
        try {
          result = await sendChunk(chunk, position, keyUpload, keyFile);
          break;
        } catch (err) {
          if (attempt >= CHUNK_ATTEMPTS) throw err;
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
        }
      }

      position += length;
      if (typeof onProgress === 'function') {
        onProgress({
          uploaded: position,
          total: fileSize,
          percent: fileSize ? Math.round((position / fileSize) * 100) : 100,
        });
      }

      if (result.end) return result;
    } while (position < fileSize);

    throw new Error('server never acknowledged the end of the upload');
  } finally {
    await fd.close();
  }
}

/**
 * Upload a file to send.magicode.me and return the download URL.
 *
 * @param {string} filePath - Absolute path of the file to upload.
 * @param {function} [onProgress] - Optional callback: { uploaded, total, percent }.
 * @returns {Promise<{success: boolean, downloadUrl?: string, error?: string}>}
 */
export async function uploadFile(filePath, onProgress) {
  try {
    const resolved = path.resolve(filePath);
    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch {
      return { success: false, error: `File not found: ${resolved}` };
    }

    if (!stat.isFile()) {
      return { success: false, error: `Path is not a file: ${resolved}` };
    }

    if (stat.size === 0) {
      return { success: false, error: `${path.basename(resolved)} is empty (send.magicode.me rejects empty files)` };
    }

    const { keyUpload, keyFile } = await prepUpload(path.basename(resolved), stat.size);
    await dataUpload(resolved, stat.size, keyUpload, keyFile, onProgress);

    return { success: true, downloadUrl: new URL(`/send-file/file/${keyFile}/view`, BASE_URL).href };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    agent.destroy();
  }
}

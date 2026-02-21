import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = 'send.magicode.me';

/**
 * Make an HTTPS request and return parsed JSON.
 * @param {object} options - Node https.request options.
 * @param {Buffer|null} body - Request body to write (or null for no body).
 * @returns {Promise<object>} Parsed JSON response.
 */
function jsonRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(raw) });
        } catch {
          reject(new Error(`jsonRequest received invalid JSON response (HTTP ${res.statusCode}): ${raw}`));
        }
      });
    });
    req.on('error', (err) => {
      reject(new Error(`jsonRequest failed during HTTPS request: ${err.message}`));
    });
    req.setTimeout(60000, () => {
      req.destroy(new Error('jsonRequest timed out after 60 seconds'));
    });
    req.on('socket', (socket) => {
      socket.setTimeout(60000);
      socket.on('timeout', () => {
        req.destroy(new Error('Socket timed out'));
      });
    });
    if (body) {
      req.write(body);
    }
    req.end();
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
  const payload = Buffer.from(
    JSON.stringify({ filename, size }),
    'utf-8',
  );

  const options = {
    hostname: BASE_URL,
    port: 443,
    path: '/send-file/prep-upload',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': payload.length,
    },
  };

  const { statusCode, data } = await jsonRequest(options, payload);

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`prep-upload failed with HTTP ${statusCode}: ${JSON.stringify(data)}`);
  }

  if (!data.keyUpload || !data.keyFile) {
    throw new Error(`prep-upload returned unexpected payload: ${JSON.stringify(data)}`);
  }

  return { keyUpload: data.keyUpload, keyFile: data.keyFile };
}

/**
 * Step 2 -- Stream the file data to the server as multipart/form-data.
 * The multipart body is constructed manually with a fixed boundary.
 *
 * @param {string} filePath - Absolute path to the file.
 * @param {number} fileSize - File size in bytes.
 * @param {string} keyUpload - Upload key from prep-upload.
 * @param {string} keyFile - File key from prep-upload.
 * @param {function} [onProgress] - Optional callback: { uploaded, total, percent }.
 * @returns {Promise<object>} Parsed JSON response from the server.
 */
export async function dataUpload(filePath, fileSize, keyUpload, keyFile, onProgress) {
  const boundary = '----1234';
  const header = `------1234\r\nContent-Disposition: form-data; name="file"; filename="blob"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const footer = `\r\n------1234--\r\n`;

  const headerBuf = Buffer.from(header, 'utf-8');
  const footerBuf = Buffer.from(footer, 'utf-8');
  const totalLength = headerBuf.length + fileSize + footerBuf.length;

  const queryPath =
    `/send-file/data-upload?position=0&length=${fileSize}` +
    `&keyUpload=${encodeURIComponent(keyUpload)}` +
    `&keyFile=${encodeURIComponent(keyFile)}`;

  const options = {
    hostname: BASE_URL,
    port: 443,
    path: queryPath,
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': totalLength,
      Connection: 'keep-alive',
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        try {
          const data = JSON.parse(raw);
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(
              new Error(`data-upload failed with HTTP ${res.statusCode}: ${raw}`),
            );
          }
          resolve(data);
        } catch {
          reject(new Error(`dataUpload received invalid JSON response (HTTP ${res.statusCode}): ${raw}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`dataUpload failed during HTTPS request: ${err.message}`));
    });
    req.setTimeout(1800000, () => {
      req.destroy(new Error('dataUpload timed out after 30 minutes'));
    });
    req.on('socket', (socket) => {
      socket.setTimeout(60000);
      socket.on('timeout', () => {
        req.destroy(new Error('Socket timed out - no data received for 60 seconds'));
      });
    });

    // Write the multipart header.
    req.write(headerBuf);

    // Stream the file content without loading it fully into memory.
    const readStream = fs.createReadStream(filePath);
    let uploaded = 0;

    readStream.on('data', (chunk) => {
      req.write(chunk);
      uploaded += chunk.length;
      req.socket?.setTimeout(60000);
      if (typeof onProgress === 'function') {
        onProgress({
          uploaded,
          total: fileSize,
          percent: Math.round((uploaded / fileSize) * 100),
        });
      }
    });

    readStream.on('error', (err) => {
      req.destroy(err);
      reject(new Error(`dataUpload failed to read file stream at ${uploaded}/${fileSize} bytes: ${err.message}`));
    });

    readStream.on('end', () => {
      // Write the multipart footer and finish the request.
      req.write(footerBuf);
      req.end();
    });
  });
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
    // Resolve and validate the file path.
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

    const fileSize = stat.size;
    const filename = path.basename(resolved);

    // Step 1: Prepare the upload.
    const { keyUpload, keyFile } = await prepUpload(filename, fileSize);

    // Step 2: Stream the file data.
    const result = await dataUpload(resolved, fileSize, keyUpload, keyFile, onProgress);

    if (!result.ok) {
      return {
        success: false,
        error: `Upload completed but server responded with ok=false: ${JSON.stringify(result)}`,
      };
    }

    const downloadUrl = `https://send.magicode.me/send-file/file/${keyFile}/view`;

    return { success: true, downloadUrl };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

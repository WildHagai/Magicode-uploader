// A local stand-in for send.magicode.me that speaks the same chunked protocol:
//   POST /send-file/prep-upload {filename, size}  -> {keyUpload, keyFile}
//   POST /send-file/data-upload?position&length&keyUpload&keyFile (multipart) -> {ok, end}
// It reassembles the uploaded bytes so tests can compare them with the source.
import http from 'node:http';
import crypto from 'node:crypto';

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Extracts the single file part from a multipart/form-data body.
function multipartFile(body, contentType) {
  const boundary = /boundary=(.+)$/.exec(contentType)?.[1];
  if (!boundary) throw new Error('no multipart boundary');
  const start = body.indexOf('\r\n\r\n') + 4;
  const end = body.lastIndexOf(Buffer.from(`\r\n--${boundary}--`));
  if (start < 4 || end < start) throw new Error('malformed multipart body');
  return body.subarray(start, end);
}

export async function startMockServer() {
  const uploads = new Map(); // keyFile -> { filename, size, data: Buffer[], received, chunks, keyUpload }
  // failDataUploads: answer that many data-uploads with failStatus; maxSize: the server's size limit.
  const state = { failDataUploads: 0, failStatus: 500, okFalse: false, maxSize: Infinity, requests: [] };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const body = await readBody(req);
    state.requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams) });
    const json = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };

    if (req.method === 'POST' && url.pathname === '/send-file/prep-upload') {
      const { filename, size } = JSON.parse(body.toString('utf-8'));
      if (!size) {
        // The real server answers a 0-byte prep-upload with an HTML 404.
        res.writeHead(404, { 'Content-Type': 'text/html' });
        return res.end('<pre>Cannot POST /send-file/prep-upload</pre>');
      }
      // The real server accepts up to 10 GiB and answers bigger files like this.
      if (size > state.maxSize) return json(200, { error: 'limit-size' });
      const keyFile = crypto.randomBytes(20).toString('hex');
      const keyUpload = crypto.randomBytes(8).toString('hex');
      uploads.set(keyFile, { filename, size, keyUpload, data: [], received: 0, chunks: [] });
      return json(200, { keyUpload, keyFile });
    }

    if (req.method === 'POST' && url.pathname === '/send-file/data-upload') {
      if (state.failDataUploads > 0) {
        state.failDataUploads--;
        return json(state.failStatus, { ok: false, error: 'injected failure' });
      }
      if (state.okFalse) return json(200, { ok: false });
      const u = uploads.get(url.searchParams.get('keyFile'));
      if (!u || u.keyUpload !== url.searchParams.get('keyUpload')) return json(403, { ok: false });
      const position = Number(url.searchParams.get('position'));
      const length = Number(url.searchParams.get('length'));
      const part = multipartFile(body, req.headers['content-type']);
      if (position !== u.received || length !== part.length) {
        return json(400, { ok: false, error: `bad chunk at ${position} (have ${u.received}, length ${length}/${part.length})` });
      }
      u.data.push(part);
      u.received += part.length;
      u.chunks.push({ position, length });
      return json(200, { ok: true, end: u.received >= u.size });
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    state,
    /** Completed upload for a download URL (or keyFile). */
    upload(urlOrKey) {
      const key = /file\/([0-9a-f]+)\/view/.exec(urlOrKey)?.[1] ?? urlOrKey;
      const u = uploads.get(key);
      return u && { ...u, bytes: Buffer.concat(u.data) };
    },
    get uploads() { return uploads; },
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}

using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace MagicodeUploader
{
    /// <summary>
    /// Uploads a file with send.magicode.me's chunked protocol:
    ///   POST /send-file/prep-upload {filename, size}  -> {keyUpload, keyFile}
    ///   POST /send-file/data-upload?position&amp;length&amp;keyUpload&amp;keyFile (multipart) -> {ok, end}
    /// The file is then at /send-file/file/&lt;keyFile&gt;/view.
    /// </summary>
    internal sealed class Uploader : IDisposable
    {
        // Same chunk size the send.magicode.me web client uses.
        public const int ChunkSize = 2 * 1024 * 1024;
        public const int ChunkAttempts = 5;

        private readonly Uri _baseUrl;
        private readonly int _retryDelayMs;
        private readonly HttpClient _http;
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer();

        public Uploader(Uri baseUrl, int retryDelayMs = 1000)
        {
            _baseUrl = baseUrl;
            _retryDelayMs = retryDelayMs;
            _http = new HttpClient { Timeout = TimeSpan.FromMinutes(2) };
            // .NET Framework sends "Expect: 100-continue" by default, which costs a round trip per chunk.
            _http.DefaultRequestHeaders.ExpectContinue = false;
        }

        public void Dispose() => _http.Dispose();

        /// <summary>Uploads the file and returns its view URL. Throws with a readable message on failure.</summary>
        public async Task<string> UploadAsync(string filePath, Action<long, long> onProgress = null)
        {
            string path = Path.GetFullPath(filePath);
            if (Directory.Exists(path)) throw new UploadException($"Path is not a file: {path}");
            if (!File.Exists(path)) throw new UploadException($"File not found: {path}");

            using (var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                long size = file.Length;
                if (size == 0)
                    throw new UploadException($"{Path.GetFileName(path)} is empty (send.magicode.me rejects empty files)");

                var (keyUpload, keyFile) = await PrepUploadAsync(Path.GetFileName(path), size).ConfigureAwait(false);
                await DataUploadAsync(file, size, keyUpload, keyFile, onProgress).ConfigureAwait(false);
                return new Uri(_baseUrl, $"/send-file/file/{keyFile}/view").AbsoluteUri;
            }
        }

        private async Task<(string keyUpload, string keyFile)> PrepUploadAsync(string filename, long size)
        {
            string payload = _json.Serialize(new Dictionary<string, object> { ["filename"] = filename, ["size"] = size });
            var content = new StringContent(payload, new UTF8Encoding(false), "application/json");

            var (status, data) = await PostJsonAsync("/send-file/prep-upload", content).ConfigureAwait(false);
            if (status < 200 || status >= 300)
                throw new UploadException($"prep-upload failed with HTTP {status}: {_json.Serialize(data)}");
            if (!(data.TryGetValue("keyUpload", out var ku) && ku is string keyUpload && keyUpload.Length > 0 &&
                  data.TryGetValue("keyFile", out var kf) && kf is string keyFile && keyFile.Length > 0))
                throw new UploadException($"prep-upload returned unexpected payload: {_json.Serialize(data)}");
            return (keyUpload, keyFile);
        }

        // Sends the file one chunk at a time (only one chunk is held in memory),
        // retrying each chunk a few times before giving up.
        private async Task DataUploadAsync(FileStream file, long size, string keyUpload, string keyFile, Action<long, long> onProgress)
        {
            var buffer = new byte[ChunkSize];
            long position = 0;
            do
            {
                int length = (int)Math.Min(ChunkSize, size - position);
                file.Position = position;
                int read = 0;
                while (read < length)
                {
                    int n = await file.ReadAsync(buffer, read, length - read).ConfigureAwait(false);
                    if (n == 0) throw new UploadException($"file changed while uploading (read {read} of {length} bytes at {position})");
                    read += n;
                }

                bool end;
                for (int attempt = 1; ; attempt++)
                {
                    try
                    {
                        end = await SendChunkAsync(buffer, length, position, keyUpload, keyFile).ConfigureAwait(false);
                        break;
                    }
                    catch (Exception) when (attempt < ChunkAttempts)
                    {
                        await Task.Delay(_retryDelayMs * attempt).ConfigureAwait(false);
                    }
                }

                position += length;
                onProgress?.Invoke(position, size);
                if (end) return;
            } while (position < size);

            throw new UploadException("server never acknowledged the end of the upload");
        }

        /// <summary>Sends one chunk as multipart/form-data; returns the server's "end" flag.</summary>
        private async Task<bool> SendChunkAsync(byte[] buffer, int length, long position, string keyUpload, string keyFile)
        {
            string boundary = "----MagicodeUploader" + Guid.NewGuid().ToString("N");
            var body = new MemoryStream(length + 300);
            WriteAscii(body, $"--{boundary}\r\n" +
                "Content-Disposition: form-data; name=\"file\"; filename=\"blob\"\r\n" +
                "Content-Type: application/octet-stream\r\n\r\n");
            body.Write(buffer, 0, length);
            WriteAscii(body, $"\r\n--{boundary}--\r\n");

            var content = new ByteArrayContent(body.GetBuffer(), 0, (int)body.Length);
            content.Headers.ContentType = MediaTypeHeaderValue.Parse($"multipart/form-data; boundary={boundary}");

            string query = $"/send-file/data-upload?position={position}&length={length}" +
                $"&keyUpload={Uri.EscapeDataString(keyUpload)}&keyFile={Uri.EscapeDataString(keyFile)}";
            var (status, data) = await PostJsonAsync(query, content).ConfigureAwait(false);

            if (status < 200 || status >= 300 || !(data.TryGetValue("ok", out var ok) && ok is bool okFlag && okFlag))
                throw new UploadException($"data-upload at byte {position} failed (HTTP {status}): {_json.Serialize(data)}");
            return data.TryGetValue("end", out var end) && end is bool endFlag && endFlag;
        }

        private async Task<(int status, Dictionary<string, object> data)> PostJsonAsync(string pathAndQuery, HttpContent content)
        {
            HttpResponseMessage res;
            try
            {
                res = await _http.PostAsync(new Uri(_baseUrl, pathAndQuery), content).ConfigureAwait(false);
            }
            catch (TaskCanceledException)
            {
                throw new UploadException($"request timed out after {_http.Timeout.TotalSeconds:0} seconds");
            }
            catch (HttpRequestException e)
            {
                throw new UploadException($"HTTPS request failed: {Innermost(e).Message}");
            }

            using (res)
            {
                int status = (int)res.StatusCode;
                string raw = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
                try
                {
                    var data = _json.Deserialize<Dictionary<string, object>>(raw);
                    if (data == null) throw new ArgumentException("not a JSON object");
                    return (status, data);
                }
                catch (Exception)
                {
                    throw new UploadException($"invalid JSON response (HTTP {status}): {(raw.Length > 200 ? raw.Substring(0, 200) : raw)}");
                }
            }
        }

        private static void WriteAscii(Stream s, string text)
        {
            byte[] bytes = Encoding.ASCII.GetBytes(text);
            s.Write(bytes, 0, bytes.Length);
        }

        private static Exception Innermost(Exception e)
        {
            while (e.InnerException != null) e = e.InnerException;
            return e;
        }
    }

    internal sealed class UploadException : Exception
    {
        public UploadException(string message) : base(message) { }
    }
}

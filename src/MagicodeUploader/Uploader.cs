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
    ///   POST /send-file/prep-upload {filename, size}  -> {keyUpload, keyFile} (or {error: "limit-size"})
    ///   POST /send-file/data-upload?position&amp;length&amp;keyUpload&amp;keyFile (multipart) -> {ok, end}
    /// The file is then at /send-file/file/&lt;keyFile&gt;/view.
    /// </summary>
    internal sealed class Uploader : IDisposable
    {
        // Same chunk size the send.magicode.me web client uses.
        public const int ChunkSize = 2 * 1024 * 1024;
        // send.magicode.me rejects anything larger (measured: 10 GiB is accepted, one byte more is not).
        public const long MaxFileSize = 10L * 1024 * 1024 * 1024;
        // Transient failures (no network, timeouts, server errors) are retried with backoff
        // 1, 2, 4, 8, 16, 30, 30... seconds: about 3 minutes in all, enough to ride out a
        // Wi-Fi drop or a router restart. The upload resumes at the chunk that failed.
        public const int Attempts = 10;
        private const int MaxBackoffSteps = 30;

        private readonly Uri _baseUrl;
        private readonly int _retryDelayMs;
        private readonly long _maxFileSize;
        private readonly HttpClient _http;
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer();

        public Uploader(Uri baseUrl, int retryDelayMs = 1000, long maxFileSize = MaxFileSize)
        {
            _baseUrl = baseUrl;
            _retryDelayMs = retryDelayMs;
            _maxFileSize = maxFileSize;
            _http = new HttpClient { Timeout = TimeSpan.FromMinutes(2) };
            // .NET Framework sends "Expect: 100-continue" by default, which costs a round trip per chunk.
            _http.DefaultRequestHeaders.ExpectContinue = false;
        }

        public void Dispose() => _http.Dispose();

        /// <summary>Uploads the file and returns its view URL. Throws <see cref="UploadException"/> on failure.</summary>
        public async Task<string> UploadAsync(string filePath, Action<long, long> onProgress = null)
        {
            string path = Path.GetFullPath(filePath);
            string name = Path.GetFileName(path);
            if (Directory.Exists(path)) throw new UploadException(Text.NotAFile(path));
            if (!File.Exists(path)) throw new UploadException(Text.NotFound(path));

            FileStream file;
            try
            {
                file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            }
            catch (Exception e) when (e is IOException || e is UnauthorizedAccessException)
            {
                throw new UploadException(Text.CannotRead(path, e.Message));
            }

            using (file)
            {
                long size = file.Length;
                if (size == 0) throw new UploadException(Text.Empty(name));
                if (size > _maxFileSize) throw new UploadException(Text.TooLarge(name, size));

                var (keyUpload, keyFile) = await WithRetries(() => PrepUploadAsync(name, size)).ConfigureAwait(false);
                await DataUploadAsync(file, name, size, keyUpload, keyFile, onProgress).ConfigureAwait(false);
                return new Uri(_baseUrl, $"/send-file/file/{keyFile}/view").AbsoluteUri;
            }
        }

        private async Task<(string keyUpload, string keyFile)> PrepUploadAsync(string filename, long size)
        {
            string payload = _json.Serialize(new Dictionary<string, object> { ["filename"] = filename, ["size"] = size });
            var content = new StringContent(payload, new UTF8Encoding(false), "application/json");

            var data = await PostJsonAsync("/send-file/prep-upload", content, "prep-upload").ConfigureAwait(false);
            if (data.TryGetValue("error", out var error))
            {
                if (error as string == "limit-size") throw new UploadException(Text.TooLarge(filename, size));
                throw new UploadException(Text.Unexpected, $"prep-upload returned an error: {_json.Serialize(data)}");
            }
            if (!(data.TryGetValue("keyUpload", out var ku) && ku is string keyUpload && keyUpload.Length > 0 &&
                  data.TryGetValue("keyFile", out var kf) && kf is string keyFile && keyFile.Length > 0))
                throw new UploadException(Text.Unexpected, $"prep-upload returned an unexpected payload: {_json.Serialize(data)}");
            return (keyUpload, keyFile);
        }

        // Sends the file one chunk at a time (only one chunk is held in memory).
        private async Task DataUploadAsync(FileStream file, string name, long size, string keyUpload, string keyFile, Action<long, long> onProgress)
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
                    if (n == 0) throw new UploadException(Text.FileChanged(name), $"read {read} of {length} bytes at {position}");
                    read += n;
                }

                long at = position;
                bool end = await WithRetries(() => SendChunkAsync(buffer, length, at, keyUpload, keyFile)).ConfigureAwait(false);

                position += length;
                onProgress?.Invoke(position, size);
                if (end) return;
            } while (position < size);

            throw new UploadException(Text.Unexpected, "the server never acknowledged the end of the upload");
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
            string step = $"data-upload at byte {position}";
            var data = await PostJsonAsync(query, content, step).ConfigureAwait(false);

            if (!(data.TryGetValue("ok", out var ok) && ok is bool okFlag && okFlag))
                throw new UploadException(Text.ServerTrouble(null), $"{step} failed: {_json.Serialize(data)}", transient: true);
            return data.TryGetValue("end", out var end) && end is bool endFlag && endFlag;
        }

        /// <summary>
        /// POSTs and parses the JSON answer. Network failures, timeouts, 5xx/429 and
        /// non-JSON answers are transient; other HTTP errors are not.
        /// </summary>
        private async Task<Dictionary<string, object>> PostJsonAsync(string pathAndQuery, HttpContent content, string step)
        {
            HttpResponseMessage res;
            try
            {
                res = await _http.PostAsync(new Uri(_baseUrl, pathAndQuery), content).ConfigureAwait(false);
            }
            catch (TaskCanceledException)
            {
                throw new UploadException(Text.TimedOut, $"{step} timed out after {_http.Timeout.TotalSeconds:0} seconds", transient: true);
            }
            catch (HttpRequestException e)
            {
                throw new UploadException(Text.NoConnection, $"{step} failed: {Innermost(e).Message}", transient: true);
            }

            using (res)
            {
                int status = (int)res.StatusCode;
                string raw = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
                string detail = $"{step} failed (HTTP {status}): {(raw.Length > 200 ? raw.Substring(0, 200) : raw)}";
                if (status >= 500 || status == 429) throw new UploadException(Text.ServerTrouble(status), detail, transient: true);
                if (status < 200 || status >= 300) throw new UploadException(Text.Refused(status), detail);
                try
                {
                    var data = _json.Deserialize<Dictionary<string, object>>(raw);
                    if (data != null) return data;
                }
                catch (Exception) { }
                // e.g. a captive portal or proxy page instead of the API's answer
                throw new UploadException(Text.Unexpected, detail, transient: true);
            }
        }

        private async Task<T> WithRetries<T>(Func<Task<T>> action)
        {
            for (int attempt = 1; ; attempt++)
            {
                try
                {
                    return await action().ConfigureAwait(false);
                }
                catch (UploadException e) when (e.Transient && attempt < Attempts)
                {
                    int steps = Math.Min(1 << Math.Min(attempt - 1, 10), MaxBackoffSteps);
                    await Task.Delay(_retryDelayMs * steps).ConfigureAwait(false);
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

    /// <summary>A failure with a message for the user and, optionally, technical detail for the log.</summary>
    internal sealed class UploadException : Exception
    {
        public string Detail { get; }
        public bool Transient { get; }

        public UploadException(string message, string detail = null, bool transient = false) : base(message)
        {
            Detail = detail;
            Transient = transient;
        }
    }
}

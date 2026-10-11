using System;
using System.IO;
using System.Threading.Tasks;
using Xunit;

namespace MagicodeUploader.Tests
{
    public class UploaderTests
    {
        [Theory]
        [InlineData(0L, "0 bytes")]
        [InlineData(1000L, "1000 bytes")]
        [InlineData(3 * 1024L, "3 KB")]
        [InlineData(1536L, "1.5 KB")]
        [InlineData(850L * 1024 * 1024, "850 MB")]
        [InlineData(10L * 1024 * 1024 * 1024, "10 GB")]
        [InlineData(12_884_901_888L, "12 GB")]
        [InlineData(13_207_024_435L, "12.3 GB")]
        public void Sizes_read_like_Explorer(long bytes, string expected)
        {
            Assert.Equal(expected, Text.Size(bytes));
        }

        [Fact]
        public void The_limit_is_10_GiB()
        {
            Assert.Equal(10_737_418_240L, Uploader.MaxFileSize);
        }

        [Fact]
        public async Task A_file_over_the_limit_fails_before_any_request()
        {
            string file = Path.GetTempFileName();
            try
            {
                File.WriteAllBytes(file, new byte[200]);
                // Port 9 (discard) is closed: any request would fail with a connection error instead.
                using (var uploader = new Uploader(new Uri("http://127.0.0.1:9"), retryDelayMs: 1, maxFileSize: 100))
                {
                    var e = await Assert.ThrowsAsync<UploadException>(() => uploader.UploadAsync(file));
                    Assert.Contains("accepts files up to", e.Message);
                    Assert.False(e.Transient);
                }
            }
            finally
            {
                File.Delete(file);
            }
        }

        [Fact]
        public async Task An_empty_file_fails_before_any_request()
        {
            string file = Path.GetTempFileName();
            try
            {
                using (var uploader = new Uploader(new Uri("http://127.0.0.1:9"), retryDelayMs: 1))
                {
                    var e = await Assert.ThrowsAsync<UploadException>(() => uploader.UploadAsync(file));
                    Assert.Contains("is empty", e.Message);
                }
            }
            finally
            {
                File.Delete(file);
            }
        }
    }
}

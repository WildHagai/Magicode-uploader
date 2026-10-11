using System.IO;
using System.Text;
using Xunit;

namespace MagicodeUploader.Tests
{
    public class ArgsTests
    {
        [Fact]
        public void Plain_arguments_pass_through()
        {
            Assert.Equal(new[] { "a.txt", "b c.txt" }, Args.Read(new[] { "a.txt", "b c.txt" }));
            Assert.Empty(Args.Read(new string[0]));
        }

        [Fact]
        public void List_file_is_read_as_UTF8_with_BOM_CRLF_and_blank_lines_then_deleted()
        {
            string list = Path.GetTempFileName();
            File.WriteAllText(list, "C:\\a\\קובץ.txt\r\nC:\\b\\two words.pdf\r\n\r\n", new UTF8Encoding(true));

            Assert.Equal(new[] { "C:\\a\\קובץ.txt", "C:\\b\\two words.pdf" }, Args.Read(new[] { "--list", list }));
            Assert.False(File.Exists(list), "the list file should be deleted after reading");
        }

        [Fact]
        public void List_file_written_by_the_context_menu_LF_without_BOM()
        {
            string list = Path.GetTempFileName();
            File.WriteAllText(list, "C:\\x\\one.txt\nC:\\x\\שתיים.txt\n", new UTF8Encoding(false));
            Assert.Equal(new[] { "C:\\x\\one.txt", "C:\\x\\שתיים.txt" }, Args.Read(new[] { "--list", list }));
        }

        [Fact]
        public void A_bare_list_flag_is_treated_as_a_file_name()
        {
            Assert.Equal(new[] { "--list" }, Args.Read(new[] { "--list" }));
        }

        [Theory]
        [InlineData("C:\\photos\\תיקייה", "תיקייה.zip")]
        [InlineData("C:\\photos\\Holiday\\", "Holiday.zip")]
        [InlineData("D:\\", "D.zip")]
        [InlineData("\\\\server\\share", "share.zip")]
        public void Single_item_zip_is_named_after_the_item(string path, string expected)
        {
            Assert.Equal(expected, Args.ZipNameFor(new[] { path }));
        }

        [Fact]
        public void Several_items_zip_is_named_after_their_parent_folder()
        {
            Assert.Equal("Invoices.zip", Args.ZipNameFor(new[] { "C:\\work\\Invoices\\a.pdf", "C:\\work\\Invoices\\b.pdf" }));
            Assert.Equal("D.zip", Args.ZipNameFor(new[] { "D:\\a.txt", "D:\\b.txt" }));
        }
    }
}

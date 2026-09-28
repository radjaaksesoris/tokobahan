using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

if (!OperatingSystem.IsWindows())
{
    throw new PlatformNotSupportedException("RAJA Local Printer hanya berjalan di Windows.");
}

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://127.0.0.1:17854");
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 65_536);
var app = builder.Build();

var allowedOrigins = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
{
    "https://radjaaksesoris.github.io",
};

app.Use(async (context, next) =>
{
    var origin = context.Request.Headers["Origin"].ToString();
    if (!allowedOrigins.Contains(origin))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return;
    }

    context.Response.Headers["Access-Control-Allow-Origin"] = origin;
    context.Response.Headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    context.Response.Headers["Access-Control-Allow-Headers"] = "Content-Type";
    context.Response.Headers["Access-Control-Max-Age"] = "600";
    context.Response.Headers["Vary"] = "Origin";

    if (context.Request.Headers.TryGetValue("Access-Control-Request-Private-Network", out var privateNetwork)
        && privateNetwork == "true")
    {
        context.Response.Headers.Append("Access-Control-Allow-Private-Network", "true");
    }

    if (HttpMethods.IsOptions(context.Request.Method))
    {
        context.Response.StatusCode = StatusCodes.Status204NoContent;
        return;
    }

    await next();
});

app.MapPost("/print", async (HttpContext context) =>
{
    if (context.Request.ContentLength is > 65_536)
    {
        return Results.BadRequest(new { error = "Data struk melebihi batas." });
    }

    ReceiptRequest? receipt;
    try
    {
        receipt = await JsonSerializer.DeserializeAsync<ReceiptRequest>(
            context.Request.Body,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true },
            context.RequestAborted);
    }
    catch (JsonException)
    {
        return Results.BadRequest(new { error = "Format data struk tidak valid." });
    }

    var validationError = ReceiptFormatter.Validate(receipt);
    if (validationError is not null)
    {
        return Results.BadRequest(new { error = validationError });
    }

    try
    {
        WindowsRawPrinter.Print(ReceiptFormatter.Format(receipt!));
        return Results.Ok(new { printed = true });
    }
    catch (Exception error) when (error is InvalidOperationException or
                                  System.ComponentModel.Win32Exception or
                                  IOException)
    {
        app.Logger.LogError(error, "Failed to print receipt {InvoiceNo}", receipt!.InvoiceNo);
        return Results.Json(
            new { error = "Struk gagal dikirim. Periksa printer default Windows, driver POS58, dan koneksi USB." },
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
});

app.Logger.LogInformation("RAJA Local Printer aktif di http://127.0.0.1:17854");
await app.RunAsync();

internal sealed record ReceiptRequest(
    string? Title,
    string? InvoiceNo,
    string? CreatedAt,
    string? CustomerName,
    List<ReceiptItem>? Items,
    decimal Total,
    List<ReceiptSummary>? Summaries);

internal sealed record ReceiptItem(
    string? Name,
    string? Unit,
    decimal Quantity,
    decimal UnitPrice,
    decimal LineTotal);

internal sealed record ReceiptSummary(string? Label, string? Value);

internal static class ReceiptFormatter
{
    private const int Columns = 32;
    private static readonly CultureInfo IndonesianCulture = CultureInfo.GetCultureInfo("id-ID");

    public static string? Validate(ReceiptRequest? receipt)
    {
        if (receipt is null ||
            string.IsNullOrWhiteSpace(receipt.Title) ||
            string.IsNullOrWhiteSpace(receipt.InvoiceNo) ||
            string.IsNullOrWhiteSpace(receipt.CreatedAt) ||
            receipt.Items is null ||
            receipt.Items.Count is < 1 or > 100 ||
            receipt.Summaries is null ||
            receipt.Summaries.Count > 10)
        {
            return "Data struk tidak lengkap.";
        }

        if (receipt.Title.Length > 64 ||
            receipt.InvoiceNo.Length > 64 ||
            receipt.Items.Any(item =>
                string.IsNullOrWhiteSpace(item.Name) ||
                item.Name.Length > 200 ||
                item.Unit is null ||
                item.Unit.Length > 32 ||
                item.Quantity <= 0 ||
                item.UnitPrice < 0 ||
                item.LineTotal < 0) ||
            receipt.Summaries.Any(summary =>
                string.IsNullOrWhiteSpace(summary.Label) ||
                summary.Label.Length > 64 ||
                summary.Value is null ||
                summary.Value.Length > 128))
        {
            return "Ada bagian data struk yang tidak valid.";
        }

        if (receipt.CustomerName is { Length: > 200 } || receipt.Total < 0)
        {
            return "Nama pelanggan atau total transaksi tidak valid.";
        }

        return null;
    }

    public static byte[] Format(ReceiptRequest receipt)
    {
        var lines = new List<(string Text, bool Center, bool Bold)>
        {
            ("RAJA AKSESORIS", true, true),
            ("Konveksi", true, false),
            ("", false, false),
            (receipt.Title!, true, true),
            (new string('-', Columns), false, false),
            ($"No. {receipt.InvoiceNo}", false, false),
            (FormatDate(receipt.CreatedAt!), false, false),
        };

        if (!string.IsNullOrWhiteSpace(receipt.CustomerName))
        {
            lines.AddRange(Wrap($"Pelanggan: {receipt.CustomerName}", Columns)
                .Select(line => (line, false, false)));
        }

        lines.Add((new string('-', Columns), false, false));
        foreach (var item in receipt.Items!)
        {
            lines.AddRange(Wrap(item.Name!, Columns).Select(line => (line, false, false)));
            var details = $"{FormatQuantity(item.Quantity)} {item.Unit} x {FormatCurrency(item.UnitPrice)}";
            lines.AddRange(AlignRight(details, FormatCurrency(item.LineTotal), Columns)
                .Select(line => (line, false, false)));
        }

        lines.Add((new string('-', Columns), false, false));
        lines.Add(("TOTAL", false, true));
        lines.AddRange(AlignRight(" ", FormatCurrency(receipt.Total), Columns)
            .Select(line => (line, false, true)));
        lines.Add((new string('-', Columns), false, false));

        foreach (var summary in receipt.Summaries!)
        {
            lines.AddRange(AlignRight(summary.Label!, summary.Value!, Columns)
                .Select(line => (line, false, false)));
        }

        lines.Add((new string('-', Columns), false, false));
        lines.Add(("Terima kasih", true, true));
        lines.Add(("", false, false));
        lines.Add(("", false, false));

        using var stream = new MemoryStream();
        stream.Write([0x1B, 0x40]);
        foreach (var (text, center, bold) in lines)
        {
            stream.Write([0x1B, 0x61, center ? (byte)1 : (byte)0]);
            stream.Write([0x1B, 0x45, bold ? (byte)1 : (byte)0]);
            var lineBytes = Encoding.ASCII.GetBytes(ToPrinterText(text));
            stream.Write(lineBytes);
            stream.WriteByte(0x0A);
        }

        stream.Write([0x1B, 0x45, 0, 0x1B, 0x61, 0]);
        return stream.ToArray();
    }

    private static string FormatDate(string value) =>
        DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var date)
            ? date.ToLocalTime().ToString("dd/MM/yyyy, HH.mm.ss", IndonesianCulture)
            : value;

    private static string FormatQuantity(decimal value) =>
        value.ToString("0.###", IndonesianCulture);

    private static string FormatCurrency(decimal value) =>
        $"Rp {value.ToString("#,0", IndonesianCulture)}";

    private static IEnumerable<string> AlignRight(string left, string right, int width)
    {
        left = ToPrinterText(left);
        right = ToPrinterText(right);
        var available = Math.Max(1, width - right.Length - 1);

        if (left.Length <= available)
        {
            yield return left.PadRight(width - right.Length) + right;
            yield break;
        }

        foreach (var part in Wrap(left, available))
        {
            yield return part;
        }

        yield return right.PadLeft(width);
    }

    private static IEnumerable<string> Wrap(string value, int width)
    {
        var words = ToPrinterText(value).Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var line = new StringBuilder();
        foreach (var word in words)
        {
            var remaining = word;
            while (remaining.Length > width)
            {
                if (line.Length > 0)
                {
                    yield return line.ToString();
                    line.Clear();
                }

                yield return remaining[..width];
                remaining = remaining[width..];
            }

            if (line.Length > 0 && line.Length + remaining.Length + 1 > width)
            {
                yield return line.ToString();
                line.Clear();
            }

            if (line.Length > 0)
            {
                line.Append(' ');
            }

            line.Append(remaining);
        }

        if (line.Length > 0)
        {
            yield return line.ToString();
        }
    }

    private static string ToPrinterText(string value)
    {
        var normalized = value.Normalize(NormalizationForm.FormKD);
        var builder = new StringBuilder(normalized.Length);
        foreach (var character in normalized)
        {
            if (char.IsControl(character) || CharUnicodeInfo.GetUnicodeCategory(character) == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            builder.Append(character switch
            {
                '×' => 'x',
                '–' or '—' => '-',
                '\u00A0' => ' ',
                _ when character is >= ' ' and <= '~' => character,
                _ => '?',
            });
        }

        return builder.ToString();
    }
}

internal static class WindowsRawPrinter
{
    public static void Print(byte[] data)
    {
        var printerName = GetDefaultPrinterName();
        if (!OpenPrinter(printerName, out var printer, IntPtr.Zero))
        {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }

        try
        {
            var document = new DocInfo
            {
                DocumentName = "RAJA Aksesoris Receipt",
                DataType = "RAW",
            };
            var job = StartDocPrinter(printer, 1, document);
            if (job == 0)
            {
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            }

            try
            {
                if (!StartPagePrinter(printer))
                {
                    throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                }

                try
                {
                    if (!WritePrinter(printer, data, data.Length, out var written) || written != data.Length)
                    {
                        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                    }
                }
                finally
                {
                    EndPagePrinter(printer);
                }
            }
            finally
            {
                EndDocPrinter(printer);
            }
        }
        finally
        {
            ClosePrinter(printer);
        }
    }

    private static string GetDefaultPrinterName()
    {
        GetDefaultPrinter(null, out var size);
        if (size == 0)
        {
            throw new InvalidOperationException("Belum ada printer default di Windows.");
        }

        var buffer = new StringBuilder(size);
        if (!GetDefaultPrinter(buffer, out _))
        {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }

        return buffer.ToString();
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private sealed class DocInfo
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string DocumentName = string.Empty;
        [MarshalAs(UnmanagedType.LPWStr)] public string? OutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string DataType = "RAW";
    }

    [DllImport("winspool.drv", EntryPoint = "GetDefaultPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetDefaultPrinter(StringBuilder? buffer, out int size);

    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenPrinter(string printerName, out IntPtr printer, IntPtr defaults);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool ClosePrinter(IntPtr printer);

    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern int StartDocPrinter(IntPtr printer, int level, [In] DocInfo documentInfo);

    [DllImport("winspool.drv", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EndDocPrinter(IntPtr printer);

    [DllImport("winspool.drv", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool StartPagePrinter(IntPtr printer);

    [DllImport("winspool.drv", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EndPagePrinter(IntPtr printer);

    [DllImport("winspool.drv", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WritePrinter(IntPtr printer, byte[] data, int count, out int written);
}

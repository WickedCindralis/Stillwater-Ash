using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Net;
using System.Net.Http.Headers;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;

namespace Stillwater.Companion;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new CompanionForm());
    }
}

internal sealed class CompanionForm : Form
{
    private const int PollSeconds = 5;
    private readonly TextBox serverUrlBox = new();
    private readonly TextBox tokenBox = new();
    private readonly TextBox chatTokenBox = new();
    private readonly Button saveButton = new();
    private readonly Button startButton = new();
    private readonly Button stopButton = new();
    private readonly Button hangoutButton = new();
    private readonly Button forgetButton = new();
    private readonly Label statusLabel = new();
    private readonly Label detailLabel = new();
    private readonly CancellationTokenSource closeCancellation = new();
    private CancellationTokenSource? runCancellation;
    private Task? runTask;
    private HangoutForm? hangoutForm;
    private bool closeRequested;

    public CompanionForm()
    {
        Text = "Stillwater Desktop Companion";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(690, 620);
        Size = new Size(740, 650);
        BackColor = Color.FromArgb(18, 20, 25);
        ForeColor = Color.White;
        Font = new Font("Segoe UI", 10F);
        FormClosing += OnFormClosing;

        tokenBox.UseSystemPasswordChar = true;
        chatTokenBox.UseSystemPasswordChar = true;
        serverUrlBox.PlaceholderText = "https://your-stillwater-host";
        tokenBox.PlaceholderText = "Paste the one-time token from Stillwater";
        chatTokenBox.PlaceholderText = "Separate token for Hangout chat";

        BuildLayout();
        LoadSavedSettings();
        SetStoppedStatus("Ready — enter your Stillwater details, then click Start.");
    }

    private void BuildLayout()
    {
        var outer = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(28),
            ColumnCount = 1,
            RowCount = 8,
            BackColor = BackColor,
        };
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 52));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 50));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 76));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 76));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 82));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 76));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 58));
        outer.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        Controls.Add(outer);

        var heading = new Label
        {
            Text = "Stillwater desktop companion",
            Dock = DockStyle.Fill,
            Font = new Font("Segoe UI Semibold", 20F),
            ForeColor = Color.FromArgb(234, 193, 92),
            TextAlign = ContentAlignment.MiddleLeft,
        };
        outer.Controls.Add(heading, 0, 0);

        var intro = new Label
        {
            Text = "This app quietly waits for approved capture requests and combines both monitors into one fresh image.",
            Dock = DockStyle.Fill,
            ForeColor = Color.FromArgb(190, 195, 205),
            AutoEllipsis = true,
        };
        outer.Controls.Add(intro, 0, 1);

        outer.Controls.Add(CreateField("Stillwater URL", serverUrlBox), 0, 2);
        outer.Controls.Add(CreateField("Pairing token", tokenBox), 0, 3);
        outer.Controls.Add(CreateField("Hangout chat token (separate from pairing token)", chatTokenBox), 0, 4);

        var securityNote = new Label
        {
            Text = "Tokens are encrypted for this Windows user. The Hangout token is never used for capture. " +
                   "Screenshots are never saved to this computer. " +
                   "Use the Screenshots ON/OFF switch in Stillwater to control capture.",
            Dock = DockStyle.Fill,
            ForeColor = Color.FromArgb(150, 158, 170),
            Padding = new Padding(0, 8, 0, 0),
        };
        outer.Controls.Add(securityNote, 0, 5);

        var actions = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = false,
            Padding = new Padding(0, 4, 0, 0),
        };
        saveButton.Text = "Save details";
        saveButton.Width = 116;
        saveButton.Click += (_, _) => SaveSettings(showMessage: true);
        startButton.Text = "Start";
        startButton.Width = 90;
        startButton.Click += (_, _) => StartCompanion();
        stopButton.Text = "Stop";
        stopButton.Width = 90;
        stopButton.Enabled = false;
        stopButton.Click += (_, _) => StopCompanion();
        hangoutButton.Text = "Open Hangout";
        hangoutButton.Width = 116;
        hangoutButton.Click += (_, _) => OpenHangout();
        forgetButton.Text = "Forget saved details";
        forgetButton.Width = 154;
        forgetButton.Click += (_, _) => ForgetSettings();
        actions.Controls.AddRange([saveButton, startButton, stopButton, hangoutButton, forgetButton]);
        outer.Controls.Add(actions, 0, 6);

        var statusPanel = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(29, 32, 40),
            Padding = new Padding(16),
        };
        statusLabel.Text = "Ready";
        statusLabel.Dock = DockStyle.Top;
        statusLabel.Height = 30;
        statusLabel.Font = new Font("Segoe UI Semibold", 11F);
        statusLabel.ForeColor = Color.FromArgb(234, 193, 92);
        detailLabel.Dock = DockStyle.Fill;
        detailLabel.ForeColor = Color.FromArgb(190, 195, 205);
        detailLabel.AutoEllipsis = true;
        statusPanel.Controls.Add(detailLabel);
        statusPanel.Controls.Add(statusLabel);
        outer.Controls.Add(statusPanel, 0, 7);
    }

    private static Control CreateField(string caption, TextBox input)
    {
        var panel = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 2,
            Padding = new Padding(0, 4, 0, 4),
        };
        panel.RowStyles.Add(new RowStyle(SizeType.Absolute, 22));
        panel.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        var label = new Label
        {
            Text = caption,
            Dock = DockStyle.Fill,
            ForeColor = Color.FromArgb(234, 193, 92),
        };
        input.Dock = DockStyle.Fill;
        input.BackColor = Color.FromArgb(33, 36, 44);
        input.ForeColor = Color.White;
        input.BorderStyle = BorderStyle.FixedSingle;
        panel.Controls.Add(label, 0, 0);
        panel.Controls.Add(input, 0, 1);
        return panel;
    }

    private void LoadSavedSettings()
    {
        try
        {
            var settings = SecureSettings.Load();
            if (settings is null) return;
            serverUrlBox.Text = settings.ServerUrl;
            tokenBox.Text = settings.Token;
            chatTokenBox.Text = settings.ChatToken ?? "";
            SetStoppedStatus("Saved details loaded. Click Start when you are ready.");
        }
        catch
        {
            SetStoppedStatus("Saved details could not be read. Enter them again and click Save details.");
        }
    }

    private void SaveSettings(bool showMessage)
    {
        if (!TryReadSettings(out var settings, out var error))
        {
            SetError(error);
            return;
        }

        try
        {
            SecureSettings.Save(settings);
            if (showMessage) SetStoppedStatus("Saved securely for this Windows user.");
        }
        catch
        {
            SetError("Could not save the details. Check that you can write to your user profile.");
        }
    }

    private void ForgetSettings()
    {
        if (runTask is not null)
        {
            SetError("Stop the companion before forgetting saved details.");
            return;
        }

        hangoutForm?.CloseFromOwner();
        hangoutForm = null;
        SecureSettings.Delete();
        serverUrlBox.Clear();
        tokenBox.Clear();
        chatTokenBox.Clear();
        SetStoppedStatus("Saved details forgotten.");
    }

    private void StartCompanion()
    {
        if (runTask is not null) return;
        if (!TryReadSettings(out var settings, out var error))
        {
            SetError(error);
            return;
        }

        try
        {
            SecureSettings.Save(settings);
        }
        catch
        {
            SetError("The details could not be saved securely, so the companion was not started.");
            return;
        }

        runCancellation = CancellationTokenSource.CreateLinkedTokenSource(closeCancellation.Token);
        var currentRunCancellation = runCancellation;
        startButton.Enabled = false;
        saveButton.Enabled = false;
        forgetButton.Enabled = false;
        stopButton.Enabled = true;
        serverUrlBox.Enabled = false;
        tokenBox.Enabled = false;
        chatTokenBox.Enabled = false;
        SetRunningStatus("Starting…", "Connecting to Stillwater.");
        StartHangoutMonitoring(settings);
        // Keep network polling, image encoding, and large JSON uploads off the
        // WinForms message pump so the window remains responsive during capture.
        runTask = Task.Run(() => RunCompanionAsync(settings, currentRunCancellation.Token), currentRunCancellation.Token);
        _ = runTask.ContinueWith(_ =>
        {
            if (!IsDisposed && !closeRequested)
            {
                BeginInvoke(() =>
                {
                    var wasStopped = currentRunCancellation.IsCancellationRequested;
                    runTask = null;
                    currentRunCancellation.Dispose();
                    runCancellation = null;
                    startButton.Enabled = true;
                    saveButton.Enabled = true;
                    forgetButton.Enabled = true;
                    stopButton.Enabled = false;
                    serverUrlBox.Enabled = true;
                    tokenBox.Enabled = true;
                    chatTokenBox.Enabled = true;
                    if (wasStopped)
                    {
                        SetStoppedStatus("Stopped", "No screenshots are being captured by this app.");
                    }
                });
            }
        }, TaskScheduler.Default);
    }

    private void StopCompanion()
    {
        runCancellation?.Cancel();
        SetStoppedStatus("Stopping…", "The companion will stop after its current request finishes.");
        stopButton.Enabled = false;
    }

    private void OpenHangout()
    {
        if (!TryReadSettings(out var settings, out var error))
        {
            SetError(error);
            return;
        }
        if (string.IsNullOrWhiteSpace(settings.ChatToken))
        {
            SetError("A separate Hangout chat token is required.", "Enter the Hangout chat token and save your details.");
            return;
        }

        try
        {
            SecureSettings.Save(settings);
        }
        catch
        {
            SetError("The details could not be saved securely.", "Check that you can write to your user profile.");
            return;
        }
        StartHangoutMonitoring(settings);
        hangoutForm?.ShowHangout();
    }

    private void StartHangoutMonitoring(CompanionSettings settings)
    {
        if (string.IsNullOrWhiteSpace(settings.ChatToken))
        {
            hangoutForm?.CloseFromOwner();
            hangoutForm = null;
            return;
        }
        if (hangoutForm is not null && !hangoutForm.IsDisposed &&
            !hangoutForm.UsesSettings(settings.ServerUrl, settings.ChatToken))
        {
            hangoutForm.CloseFromOwner();
            hangoutForm = null;
        }
        if (hangoutForm is null || hangoutForm.IsDisposed)
        {
            hangoutForm = new HangoutForm(settings.ServerUrl, settings.ChatToken);
            hangoutForm.ShowInTaskbar = false;
            hangoutForm.StartMonitoring();
        }
    }

    private async Task RunCompanionAsync(CompanionSettings settings, CancellationToken cancellationToken)
    {
        using var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
        };
        using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(25) };
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", settings.Token);
        var baseUrl = settings.ServerUrl.TrimEnd('/');

        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                SetRunningStatus("Connected — waiting", "Screenshots ON in Stillwater is required before a capture request can arrive.");
                using var response = await client.GetAsync(
                    $"{baseUrl}/api/screen-capture/request",
                    cancellationToken);

                if (response.StatusCode == HttpStatusCode.Unauthorized)
                {
                    SetError("Pairing expired or was revoked.", "Pair the Windows companion again in Stillwater.");
                    return;
                }

                response.EnsureSuccessStatusCode();
                await using var responseStream = await response.Content.ReadAsStreamAsync(cancellationToken);
                using var requestDocument = await JsonDocument.ParseAsync(responseStream, cancellationToken: cancellationToken);
                var requestId = requestDocument.RootElement.TryGetProperty("requestId", out var idProperty)
                    ? idProperty.GetString()
                    : null;

                if (!string.IsNullOrWhiteSpace(requestId))
                {
                    SetRunningStatus("Capturing both monitors…", "Stillwater requested a fresh desktop image.");
                    var imageDataUrl = VirtualDesktopCapture.CaptureJpegDataUrl();
                    using var body = new StringContent(
                        JsonSerializer.Serialize(new { imageDataUrl }),
                        Encoding.UTF8,
                        "application/json");
                    using var uploadResponse = await client.PostAsync(
                        $"{baseUrl}/api/screen-capture/request/{Uri.EscapeDataString(requestId)}",
                        body,
                        cancellationToken);

                    if (uploadResponse.StatusCode == HttpStatusCode.Unauthorized)
                    {
                        SetError("Pairing expired or was revoked.", "Pair the Windows companion again in Stillwater.");
                        return;
                    }

                    uploadResponse.EnsureSuccessStatusCode();
                    SetRunningStatus("Connected — waiting", "The fresh image was sent and was not saved locally.");
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception error)
            {
                SetError("Connection problem — retrying.", error.Message);
            }

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(PollSeconds), cancellationToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    private bool TryReadSettings(out CompanionSettings settings, out string error)
    {
        var serverUrl = serverUrlBox.Text.Trim().TrimEnd('/');
        var token = tokenBox.Text.Trim();
        if (!Uri.TryCreate(serverUrl, UriKind.Absolute, out var uri) || string.IsNullOrWhiteSpace(uri.Host))
        {
            settings = default!;
            error = "Enter the full Stillwater URL, including https://.";
            return false;
        }

        var loopbackHttp = uri.Scheme.Equals("http", StringComparison.OrdinalIgnoreCase) && uri.IsLoopback;
        if (!uri.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase) && !loopbackHttp)
        {
            settings = default!;
            error = "Use an HTTPS Stillwater URL. HTTP is allowed only for localhost development.";
            return false;
        }

        if (string.IsNullOrWhiteSpace(token))
        {
            settings = default!;
            error = "Paste the one-time pairing token from Ash → Settings.";
            return false;
        }

        settings = new CompanionSettings(serverUrl, token, chatTokenBox.Text.Trim());
        error = "";
        return true;
    }

    private void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
        closeRequested = true;
        closeCancellation.Cancel();
        runCancellation?.Cancel();
        hangoutForm?.CloseFromOwner();
    }

    private void SetRunningStatus(string status, string detail)
    {
        if (IsDisposed) return;
        BeginInvoke(() =>
        {
            statusLabel.Text = status;
            detailLabel.Text = detail;
            statusLabel.ForeColor = Color.FromArgb(234, 193, 92);
        });
    }

    private void SetStoppedStatus(string status, string? detail = null)
    {
        statusLabel.Text = status;
        detailLabel.Text = detail ?? "The companion is stopped. No screenshots are being captured.";
        statusLabel.ForeColor = Color.FromArgb(190, 195, 205);
    }

    private void SetError(string status, string? detail = null)
    {
        if (IsDisposed) return;
        BeginInvoke(() =>
        {
            statusLabel.Text = status;
            detailLabel.Text = detail ?? "Check the URL, pairing, and that Stillwater is reachable.";
            statusLabel.ForeColor = Color.FromArgb(255, 132, 132);
        });
    }
}

internal sealed record CompanionSettings(string ServerUrl, string Token, string? ChatToken = null);

internal static class SecureSettings
{
    private static readonly string SettingsPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Stillwater",
        "companion.dat");

    public static void Save(CompanionSettings settings)
    {
        var directory = Path.GetDirectoryName(SettingsPath)!;
        Directory.CreateDirectory(directory);
        var plaintext = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(settings));
        var encrypted = WindowsDataProtection.Protect(plaintext);
        CryptographicOperations.ZeroMemory(plaintext);
        File.WriteAllBytes(SettingsPath, encrypted);
    }

    public static CompanionSettings? Load()
    {
        if (!File.Exists(SettingsPath)) return null;
        var encrypted = File.ReadAllBytes(SettingsPath);
        var plaintext = WindowsDataProtection.Unprotect(encrypted);
        try
        {
            return JsonSerializer.Deserialize<CompanionSettings>(plaintext);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plaintext);
        }
    }

    public static void Delete()
    {
        if (File.Exists(SettingsPath)) File.Delete(SettingsPath);
    }
}

internal static class WindowsDataProtection
{
    [StructLayout(LayoutKind.Sequential)]
    private struct DataBlob
    {
        public int Size;
        public IntPtr Data;
    }

    [DllImport("crypt32.dll", SetLastError = true)]
    private static extern bool CryptProtectData(
        ref DataBlob dataIn,
        string? description,
        IntPtr optionalEntropy,
        IntPtr reserved,
        IntPtr promptStruct,
        int flags,
        out DataBlob dataOut);

    [DllImport("crypt32.dll", SetLastError = true)]
    private static extern bool CryptUnprotectData(
        ref DataBlob dataIn,
        out IntPtr description,
        IntPtr optionalEntropy,
        IntPtr reserved,
        IntPtr promptStruct,
        int flags,
        out DataBlob dataOut);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);

    public static byte[] Protect(byte[] plaintext)
    {
        return Transform(plaintext, CryptProtectData);
    }

    public static byte[] Unprotect(byte[] encrypted)
    {
        return Transform(encrypted, CryptUnprotectData);
    }

    private static byte[] Transform(byte[] input, ProtectDelegate transform)
    {
        var inputMemory = Marshal.AllocHGlobal(input.Length);
        try
        {
            Marshal.Copy(input, 0, inputMemory, input.Length);
            var inputBlob = new DataBlob { Size = input.Length, Data = inputMemory };
            if (!transform(ref inputBlob, out var outputBlob))
            {
                throw new CryptographicException($"Windows data protection failed: {Marshal.GetLastWin32Error()}");
            }

            try
            {
                var output = new byte[outputBlob.Size];
                Marshal.Copy(outputBlob.Data, output, 0, output.Length);
                return output;
            }
            finally
            {
                LocalFree(outputBlob.Data);
            }
        }
        finally
        {
            Marshal.FreeHGlobal(inputMemory);
        }
    }

    private delegate bool ProtectDelegate(ref DataBlob input, out DataBlob output);

    private static bool CryptProtectData(ref DataBlob input, out DataBlob output) =>
        CryptProtectData(ref input, "Stillwater companion settings", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0, out output);

    private static bool CryptUnprotectData(ref DataBlob input, out DataBlob output)
    {
        var result = CryptUnprotectData(ref input, out var description, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0, out output);
        if (description != IntPtr.Zero) LocalFree(description);
        return result;
    }
}

internal static class VirtualDesktopCapture
{
    private const int MaxJpegBytes = 11 * 1024 * 1024;

    public static string CaptureJpegDataUrl()
    {
        var bounds = SystemInformation.VirtualScreen;
        using var bitmap = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb);
        using var graphics = Graphics.FromImage(bitmap);
        graphics.CompositingMode = CompositingMode.SourceCopy;
        graphics.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bitmap.Size, CopyPixelOperation.SourceCopy);

        var codec = ImageCodecInfo.GetImageEncoders()
            .FirstOrDefault(encoder => string.Equals(encoder?.MimeType, "image/jpeg", StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException("Windows JPEG support is unavailable.");

        foreach (var scale in new[] { 1.0, 0.85, 0.70, 0.55, 0.40, 0.30, 0.22 })
        {
            if (scale == 1.0)
            {
                var encoded = EncodeWithinLimit(bitmap, codec);
                if (encoded is not null)
                {
                    return $"data:image/jpeg;base64,{Convert.ToBase64String(encoded)}";
                }
                continue;
            }

            var width = Math.Max(1, (int)Math.Round(bitmap.Width * scale));
            var height = Math.Max(1, (int)Math.Round(bitmap.Height * scale));
            using var resized = new Bitmap(width, height, PixelFormat.Format24bppRgb);
            using (var resizeGraphics = Graphics.FromImage(resized))
            {
                resizeGraphics.CompositingMode = CompositingMode.SourceCopy;
                resizeGraphics.CompositingQuality = CompositingQuality.HighQuality;
                resizeGraphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                resizeGraphics.SmoothingMode = SmoothingMode.HighQuality;
                resizeGraphics.DrawImage(bitmap, new Rectangle(0, 0, width, height));
            }

            var resizedEncoded = EncodeWithinLimit(resized, codec);
            if (resizedEncoded is not null)
            {
                return $"data:image/jpeg;base64,{Convert.ToBase64String(resizedEncoded)}";
            }
        }

        throw new InvalidOperationException(
            "The combined monitor image is too large to send safely. Reduce the display resolution and try again.");
    }

    private static byte[]? EncodeWithinLimit(Image image, ImageCodecInfo codec)
    {
        foreach (var quality in new long[] { 75, 60, 45, 30 })
        {
            using var stream = new MemoryStream();
            using var parameters = new EncoderParameters(1);
            parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
            image.Save(stream, codec, parameters);
            if (stream.Length <= MaxJpegBytes)
            {
                return stream.ToArray();
            }
        }

        return null;
    }
}
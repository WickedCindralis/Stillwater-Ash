using System.Drawing;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;

namespace Stillwater.Companion;

internal sealed class HangoutForm : Form
{
    private readonly string serverUrl;
    private readonly string chatToken;
    private readonly Label statusLabel = new();
    private readonly FlowLayoutPanel messagesPanel = new();
    private readonly TextBox inputBox = new();
    private readonly TextBox minutesBox = new();
    private readonly Button minutesSaveButton = new();
    private readonly Button sendButton = new();
    private readonly Button stopButton = new();
    private readonly CancellationTokenSource monitorCancellation = new();
    private readonly CancellationTokenSource screenshotCancellation = new();
    private readonly HashSet<long> displayedMessageIds = [];
    private readonly Dictionary<long, HangoutMessage> canonicalMessages = [];
    private readonly object messageLock = new();
    private readonly SemaphoreSlim screenshotSlots = new(2, 2);
    private Task? monitorTask;
    private long lastMessageId;
    private long lastSyncedMessageId;
    private long uncertainSendAfterId;
    private volatile string? uncertainSendContent;
    private volatile string? currentSessionId;
    private volatile string? stoppedSessionId;
    private bool sendInProgress;
    private volatile bool sessionStopped;
    private volatile bool sessionAvailable;
    private volatile bool stoppingSession;
    private volatile bool revoked;
    private bool windowStarted;
    private bool minutesDirty;
    private bool minutesSaving;
    private bool updatingMinutesFromServer;

    public HangoutForm(string serverUrl, string chatToken)
    {
        this.serverUrl = serverUrl.TrimEnd('/');
        this.chatToken = chatToken;
        Text = "Stillwater Hangout";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(560, 520);
        Size = new Size(820, 760);
        BackColor = Color.FromArgb(18, 20, 25);
        ForeColor = Color.White;
        Font = new Font("Segoe UI", 10F);
        TopMost = true;
        FormClosing += OnFormClosing;
        BuildLayout();
        _ = Handle;
    }

    // Auto-opening on an invitation should not take keyboard focus from a game.
    protected override bool ShowWithoutActivation => true;

    public void StartMonitoring()
    {
        monitorTask ??= MonitorAsync(monitorCancellation.Token);
    }

    public bool UsesSettings(string url, string token) =>
        serverUrl.Equals(url.TrimEnd('/'), StringComparison.OrdinalIgnoreCase) &&
        chatToken.Equals(token, StringComparison.Ordinal);

    public void ShowHangout(bool focus = false)
    {
        if (IsDisposed || Disposing) return;
        if (InvokeRequired)
        {
            BeginInvoke((Action)(() => ShowHangout(focus)));
            return;
        }

        if (!Visible) Show();
        if (focus)
        {
            WindowState = FormWindowState.Normal;
            BringToFront();
            Activate();
        }
    }

    public void CloseFromOwner()
    {
        monitorCancellation.Cancel();
        screenshotCancellation.Cancel();
        if (!IsDisposed) Close();
    }

    private void BuildLayout()
    {
        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(18),
            ColumnCount = 1,
            RowCount = 4,
            BackColor = BackColor,
        };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 46));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 112));
        Controls.Add(layout);

        var header = new Panel { Dock = DockStyle.Fill };
        statusLabel.Dock = DockStyle.Fill;
        statusLabel.AutoEllipsis = true;
        statusLabel.Text = "Connecting to Hangout…";
        statusLabel.ForeColor = Color.FromArgb(234, 193, 92);
        statusLabel.Font = new Font("Segoe UI Semibold", 11F);
        header.Controls.Add(statusLabel);
        layout.Controls.Add(header, 0, 0);

        var intervalBar = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = false,
            Padding = new Padding(0, 3, 0, 0),
        };
        intervalBar.Controls.Add(new Label
        {
            Text = "MINUTES:",
            AutoSize = true,
            ForeColor = Color.FromArgb(230, 232, 237),
            Margin = new Padding(0, 7, 9, 0),
        });
        minutesBox.Text = "15";
        minutesBox.Width = 65;
        minutesBox.MaxLength = 4;
        minutesBox.Enabled = false;
        minutesBox.AccessibleName = "Minutes between idle Hangout screenshots";
        minutesBox.TextChanged += (_, _) =>
        {
            if (updatingMinutesFromServer) return;
            minutesDirty = true;
            UpdateChatControls();
        };
        minutesBox.KeyDown += (_, e) =>
        {
            if (e.KeyCode != Keys.Enter) return;
            e.SuppressKeyPress = true;
            _ = SaveMinutesAsync();
        };
        intervalBar.Controls.Add(minutesBox);
        minutesSaveButton.Text = "Apply";
        minutesSaveButton.Width = 72;
        minutesSaveButton.Enabled = false;
        minutesSaveButton.Margin = new Padding(8, 0, 0, 0);
        minutesSaveButton.Click += async (_, _) => await SaveMinutesAsync();
        intervalBar.Controls.Add(minutesSaveButton);
        layout.Controls.Add(intervalBar, 0, 1);

        messagesPanel.Dock = DockStyle.Fill;
        messagesPanel.AutoScroll = true;
        messagesPanel.FlowDirection = FlowDirection.TopDown;
        messagesPanel.WrapContents = false;
        messagesPanel.BackColor = Color.FromArgb(24, 27, 34);
        messagesPanel.Padding = new Padding(12);
        messagesPanel.SizeChanged += (_, _) => ResizeMessageCards();
        layout.Controls.Add(messagesPanel, 0, 2);

        var composer = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 2,
            RowCount = 2,
            Padding = new Padding(0, 12, 0, 0),
        };
        composer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        composer.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 104));
        composer.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        composer.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));

        inputBox.Dock = DockStyle.Fill;
        inputBox.Multiline = true;
        inputBox.AcceptsReturn = true;
        inputBox.ScrollBars = ScrollBars.Vertical;
        inputBox.BackColor = Color.FromArgb(33, 36, 44);
        inputBox.ForeColor = Color.White;
        inputBox.BorderStyle = BorderStyle.FixedSingle;
        inputBox.PlaceholderText = "Write a message…";
        inputBox.Enabled = false;
        inputBox.KeyDown += OnInputKeyDown;
        composer.Controls.Add(inputBox, 0, 0);
        composer.SetRowSpan(inputBox, 2);

        sendButton.Text = "Send";
        sendButton.Dock = DockStyle.Fill;
        sendButton.Margin = new Padding(8, 0, 0, 6);
        sendButton.BackColor = Color.FromArgb(124, 58, 237);
        sendButton.ForeColor = Color.White;
        sendButton.FlatStyle = FlatStyle.Flat;
        sendButton.Click += async (_, _) => await SendMessageAsync();
        composer.Controls.Add(sendButton, 1, 0);

        stopButton.Text = "Stop Hangout";
        stopButton.Dock = DockStyle.Fill;
        stopButton.Margin = new Padding(8, 0, 0, 0);
        stopButton.BackColor = Color.FromArgb(48, 51, 60);
        stopButton.ForeColor = Color.White;
        stopButton.FlatStyle = FlatStyle.Flat;
        stopButton.Enabled = false;
        stopButton.Click += async (_, _) => await StopHangoutAsync();
        composer.Controls.Add(stopButton, 1, 1);
        layout.Controls.Add(composer, 0, 3);
    }

    private async Task MonitorAsync(CancellationToken cancellationToken)
    {
        using var handler = new SocketsHttpHandler { AllowAutoRedirect = false };
        using var client = CreateClient(handler);

        while (!cancellationToken.IsCancellationRequested && !revoked)
        {
            try
            {
                // Monitoring starts before the pop-out opens. Hidden polls
                // maintain the heartbeat but must not accumulate old cards.
                var visibleAtRequest = Visible;
                var startingWindow = visibleAtRequest && !windowStarted;
                await SyncAsync(client, Interlocked.Read(ref lastSyncedMessageId), cancellationToken,
                    windowStart: !visibleAtRequest || startingWindow, startVisibleWindow: startingWindow);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch (UnauthorizedChatException error)
            {
                MarkChatRevoked(error.Message);
                return;
            }
            catch (Exception error)
            {
                SetStatus("Hangout disconnected — reconnecting…", error.Message, isError: true);
            }

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(4), cancellationToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    private HttpClient CreateClient(HttpMessageHandler handler, TimeSpan? timeout = null)
    {
        var client = new HttpClient(handler) { Timeout = timeout ?? TimeSpan.FromSeconds(25) };
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", chatToken);
        return client;
    }

    private async Task SyncAsync(HttpClient client, long after, CancellationToken cancellationToken,
        bool windowStart = false, bool startVisibleWindow = false)
    {
        using var response = await client.GetAsync(
            $"{serverUrl}/api/hangout/companion/sync?after={after}" +
                (windowStart ? "&windowStart=1" : ""),
            cancellationToken);
        await EnsureChatSuccessAsync(response, cancellationToken);

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
        var root = document.RootElement;
        var status = ReadString(root, "status") ?? "unknown";
        var sessionId = ReadString(root, "sessionId");
        var lastError = ReadString(root, "lastError");
        if (!minutesDirty && !minutesSaving &&
            root.TryGetProperty("idleIntervalMinutes", out var savedMinutes) &&
            savedMinutes.TryGetInt32(out var interval) && interval is >= 1 and <= 1440)
        {
            updatingMinutesFromServer = true;
            try { minutesBox.Text = interval.ToString(); }
            finally { updatingMinutesFromServer = false; }
        }
        var hangoutStatus = status.ToLowerInvariant() switch
        {
            "active" => "Hangout Active",
            "inviting" => "Hangout Inviting",
            "idle" => "Hangout Idle",
            _ => "Hangout Unavailable",
        };
        var detail = string.IsNullOrWhiteSpace(lastError) ? null : lastError;
        if (uncertainSendContent is not null)
        {
            detail = "A timed-out send may still complete; checking history. Do not resend this message." +
                (detail is null ? "" : $"  ·  {detail}");
        }
        SetStatus(
            hangoutStatus,
            detail,
            !string.IsNullOrWhiteSpace(lastError) || uncertainSendContent is not null);
        currentSessionId = sessionId;
        sessionAvailable = status.Equals("active", StringComparison.OrdinalIgnoreCase) ||
            status.Equals("inviting", StringComparison.OrdinalIgnoreCase);
        if (sessionAvailable &&
            (!sessionStopped || !string.Equals(sessionId, stoppedSessionId, StringComparison.Ordinal)))
        {
            sessionStopped = false;
            stoppedSessionId = null;
        }
        if (startVisibleWindow)
        {
            if (!root.TryGetProperty("windowCursor", out var cursor) ||
                !cursor.TryGetInt64(out var cursorId))
                throw new InvalidDataException("The server did not provide a new-window cursor.");
            Interlocked.Exchange(ref lastSyncedMessageId, cursorId);
            windowStarted = true;
        }
        stopButton.Enabled = !revoked && windowStarted && !sessionStopped && sessionAvailable;
        UpdateChatControls();

        if (windowStarted && !windowStart &&
            root.TryGetProperty("messages", out var messages) && messages.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in messages.EnumerateArray().OrderBy(ReadId))
            {
                var message = ParseMessage(item);
                AddMessage(message);
                AdvanceMessageId(ref lastSyncedMessageId, message.Id);
            }
        }

        if (!Visible && (status.Equals("active", StringComparison.OrdinalIgnoreCase) ||
            status.Equals("inviting", StringComparison.OrdinalIgnoreCase)))
        {
            ShowHangout();
        }
    }

    private async Task SaveMinutesAsync()
    {
        if (revoked || minutesSaving || !windowStarted || !minutesDirty) return;
        if (!int.TryParse(minutesBox.Text.Trim(), out var minutes) || minutes is < 1 or > 1440)
        {
            SetStatus("Enter a whole number of minutes from 1 to 1440.", null, isError: true);
            return;
        }

        minutesSaving = true;
        UpdateChatControls();
        try
        {
            using var handler = new SocketsHttpHandler { AllowAutoRedirect = false };
            using var client = CreateClient(handler);
            using var body = new StringContent(JsonSerializer.Serialize(new { minutes }), Encoding.UTF8, "application/json");
            using var response = await client.PostAsync(
                $"{serverUrl}/api/hangout/companion/interval", body, monitorCancellation.Token);
            await EnsureChatSuccessAsync(response, monitorCancellation.Token);
            minutesDirty = false;
            SetStatus($"Idle screenshot interval set to {minutes} minute{(minutes == 1 ? "" : "s")}.", null);
        }
        catch (UnauthorizedChatException error)
        {
            MarkChatRevoked(error.Message);
        }
        catch (OperationCanceledException) when (monitorCancellation.IsCancellationRequested)
        {
            // Window closed while saving.
        }
        catch (Exception error)
        {
            SetStatus("Could not save screenshot interval.", error.Message, isError: true);
        }
        finally
        {
            minutesSaving = false;
            UpdateChatControls();
        }
    }

    private async Task SendMessageAsync()
    {
        if (sendInProgress || revoked) return;
        if (sessionStopped || uncertainSendContent is not null) return;
        var content = inputBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(content)) return;

        sendInProgress = true;
        UpdateChatControls();
        var sendStartMessageId = Interlocked.Read(ref lastMessageId);
        try
        {
            using var handler = new SocketsHttpHandler { AllowAutoRedirect = false };
            using var client = CreateClient(handler, TimeSpan.FromMinutes(5));
            using var body = new StringContent(
                JsonSerializer.Serialize(new { content }),
                Encoding.UTF8,
                "application/json");
            using var response = await client.PostAsync(
                $"{serverUrl}/api/hangout/companion/send",
                body,
                monitorCancellation.Token);
            await EnsureChatSuccessAsync(response, monitorCancellation.Token);

            await using var stream = await response.Content.ReadAsStreamAsync(monitorCancellation.Token);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: monitorCancellation.Token);
            var root = document.RootElement;
            var received = false;
            if (!sessionStopped)
            {
                inputBox.Clear();
                try
                {
                    if (root.TryGetProperty("wickedMessage", out var wicked))
                    {
                        AddMessage(ParseMessage(wicked));
                        received = true;
                    }
                    if (root.TryGetProperty("ashMessage", out var ash))
                    {
                        AddMessage(ParseMessage(ash));
                        received = true;
                    }
                    SetStatus("Message sent.", null);
                }
                catch (Exception displayError)
                {
                    // The server already accepted the send. Never tell the user
                    // to resend it; the independent sync cursor will retry it.
                    SetStatus("Message sent, but the reply could not be displayed yet. Retrying sync.",
                        displayError.Message, isError: true);
                }
            }

            if (!received && monitorTask is not null)
            {
                using var syncHandler = new SocketsHttpHandler { AllowAutoRedirect = false };
                using var syncClient = CreateClient(syncHandler);
                await SyncAsync(syncClient, Interlocked.Read(ref lastSyncedMessageId), monitorCancellation.Token);
            }
        }
        catch (UnauthorizedChatException error)
        {
            MarkChatRevoked(error.Message);
        }
        catch (OperationCanceledException error) when (!monitorCancellation.IsCancellationRequested)
        {
            var alreadyConfirmed = false;
            lock (messageLock)
            {
                uncertainSendContent = content;
                uncertainSendAfterId = sendStartMessageId;
                alreadyConfirmed = canonicalMessages.Values.Any(message =>
                    message.Id > uncertainSendAfterId &&
                    string.Equals(message.Content, content, StringComparison.Ordinal));
                if (alreadyConfirmed) uncertainSendContent = null;
            }
            sendInProgress = false;
            UpdateChatControls();
            if (alreadyConfirmed)
            {
                inputBox.Clear();
                SetStatus("The timed-out send was confirmed in Hangout history.", null);
            }
            else
            {
                SetStatus(
                    "Send timed out; it may still complete. Checking Hangout history — do not resend this message.",
                    error.Message,
                    isError: true);
            }
            using var syncHandler = new SocketsHttpHandler { AllowAutoRedirect = false };
            using var syncClient = CreateClient(syncHandler);
            try
            {
                await SyncAsync(syncClient, Interlocked.Read(ref lastSyncedMessageId), monitorCancellation.Token);
            }
            catch (UnauthorizedChatException syncError)
            {
                MarkChatRevoked(syncError.Message);
            }
            catch (Exception syncError)
            {
                SetStatus(
                    "Send may still complete; Hangout history is being checked. Do not resend this message.",
                    syncError.Message,
                    isError: true);
            }
        }
        catch (OperationCanceledException) when (monitorCancellation.IsCancellationRequested)
        {
            SetStatus("Hangout closed.", null);
        }
        catch (Exception error)
        {
            SetStatus("Message was not sent.", error.Message, isError: true);
        }
        finally
        {
            sendInProgress = false;
            UpdateChatControls();
        }
    }

    private async Task StopHangoutAsync()
    {
        stopButton.Enabled = false;
        stoppingSession = true;
        UpdateChatControls();
        try
        {
            using var handler = new SocketsHttpHandler { AllowAutoRedirect = false };
            using var client = CreateClient(handler);
            using var response = await client.PostAsync(
                $"{serverUrl}/api/hangout/companion/stop",
                content: null,
                monitorCancellation.Token);
            await EnsureChatSuccessAsync(response, monitorCancellation.Token);

            await using var stream = await response.Content.ReadAsStreamAsync(monitorCancellation.Token);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: monitorCancellation.Token);
            stoppedSessionId = ReadString(document.RootElement, "sessionId") ?? currentSessionId;
            sessionStopped = true;
            sessionAvailable = false;
            stoppingSession = false;
            SetStatus("Hangout Stopped", "The Hangout session was stopped.");
            UpdateChatControls();
            using var syncHandler = new SocketsHttpHandler { AllowAutoRedirect = false };
            using var syncClient = CreateClient(syncHandler);
            await SyncAsync(syncClient, Interlocked.Read(ref lastSyncedMessageId), monitorCancellation.Token);
        }
        catch (UnauthorizedChatException error)
        {
            MarkChatRevoked(error.Message);
        }
        catch (Exception error)
        {
            stoppingSession = false;
            UpdateChatControls();
            SetStatus("Could not stop Hangout.", error.Message, isError: true);
        }
        finally
        {
            if (!IsDisposed) stopButton.Enabled = !revoked && !sessionStopped && sessionAvailable;
        }
    }

    private async Task AddScreenshotAsync(long activityId, PictureBox picture, Label placeholder)
    {
        var slotAcquired = false;
        try
        {
            using var linkedCancellation = CancellationTokenSource.CreateLinkedTokenSource(
                monitorCancellation.Token,
                screenshotCancellation.Token);
            await screenshotSlots.WaitAsync(linkedCancellation.Token);
            slotAcquired = true;
            using var handler = new SocketsHttpHandler { AllowAutoRedirect = false };
            using var client = CreateClient(handler);
            using var response = await client.GetAsync(
                $"{serverUrl}/api/hangout/companion/screenshot/{activityId}",
                linkedCancellation.Token);
            await EnsureChatSuccessAsync(response, linkedCancellation.Token);
            var bytes = await response.Content.ReadAsByteArrayAsync(linkedCancellation.Token);
            using var stream = new MemoryStream(bytes);
            using var decoded = Image.FromStream(stream);
            var image = new Bitmap(decoded);
            if (picture.IsDisposed || IsDisposed || revoked)
            {
                image.Dispose();
                return;
            }
            if (picture.InvokeRequired)
            {
                picture.BeginInvoke((Action)(() => SetScreenshotImage(picture, placeholder, image)));
            }
            else
            {
                SetScreenshotImage(picture, placeholder, image);
            }
        }
        catch (Exception error)
        {
            if (error is UnauthorizedChatException)
            {
                MarkChatRevoked(error.Message);
            }
            else if (!IsDisposed && !monitorCancellation.IsCancellationRequested)
            {
                SetStatus("Could not load Hangout screenshot.", error.Message, isError: true);
            }
        }
        finally
        {
            if (slotAcquired) screenshotSlots.Release();
        }
    }

    private void SetScreenshotImage(PictureBox picture, Label placeholder, Image image)
    {
        if (picture.IsDisposed || IsDisposed || revoked)
        {
            image.Dispose();
            if (!placeholder.IsDisposed && revoked)
                placeholder.Text = "Screenshot unavailable — chat token revoked.";
            return;
        }
        picture.Image?.Dispose();
        picture.Image = image;
        placeholder.Visible = false;
    }

    private void AddMessage(HangoutMessage message)
    {
        if (message.Id <= 0) return;
        if (IsDisposed) throw new ObjectDisposedException(nameof(HangoutForm));
        if (InvokeRequired)
        {
            // Do not acknowledge a message until its card is actually visible.
            Invoke((Action)(() => AddMessage(message)));
            return;
        }
        lock (messageLock)
        {
            if (displayedMessageIds.Contains(message.Id)) return;
            AddMessageCard(message);
            displayedMessageIds.Add(message.Id);
            canonicalMessages[message.Id] = message;
        }
        AdvanceMessageId(ref lastMessageId, message.Id);

        var confirmedTimedOutSend = false;
        lock (messageLock)
        {
            if (uncertainSendContent is not null &&
                message.Id > uncertainSendAfterId &&
                string.Equals(message.Content, uncertainSendContent, StringComparison.Ordinal))
            {
                uncertainSendContent = null;
                confirmedTimedOutSend = true;
            }
        }
        if (confirmedTimedOutSend)
        {
            if (!IsDisposed)
            {
                BeginInvoke((Action)(() =>
                {
                    inputBox.Clear();
                    SetStatus("The timed-out send was confirmed in Hangout history.", null);
                    UpdateChatControls();
                }));
            }
        }

    }

    private static void AdvanceMessageId(ref long cursor, long id)
    {
        long observed;
        do
        {
            observed = Interlocked.Read(ref cursor);
            if (id <= observed) return;
        } while (Interlocked.CompareExchange(ref cursor, id, observed) != observed);
    }

    private void AddMessageCard(HangoutMessage message)
    {
        if (IsDisposed) return;
        var card = new Panel
        {
            Width = Math.Max(320, messagesPanel.ClientSize.Width - 34),
            Tag = message.Id,
            BackColor = Color.FromArgb(34, 37, 45),
            Padding = new Padding(12),
            Margin = new Padding(0, 0, 0, 10),
        };
        var cardLayout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = message.ScreenshotActivityId is null ? 2 : 3,
        };
        cardLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        cardLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
        cardLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));

        var time = DateTimeOffset.TryParse(message.CreatedAt, out var parsed)
            ? parsed.ToLocalTime().ToString("g")
            : message.CreatedAt;
        var heading = new Label
        {
            AutoSize = true,
            Dock = DockStyle.Fill,
            ForeColor = Color.FromArgb(234, 193, 92),
            Font = new Font("Segoe UI Semibold", 9.5F),
            Text = $"{message.Role}  ·  {time}",
            Margin = new Padding(0, 0, 0, 6),
        };
        var content = new RichTextBox
        {
            Dock = DockStyle.Fill,
            ReadOnly = true,
            WordWrap = true,
            ScrollBars = RichTextBoxScrollBars.Vertical,
            BorderStyle = BorderStyle.None,
            BackColor = card.BackColor,
            ForeColor = Color.FromArgb(230, 232, 237),
            Text = message.Content,
            Margin = new Padding(0, 0, 0, 2),
            DetectUrls = false,
            TabStop = false,
            AccessibleName = $"Message from {message.Role}",
        };
        cardLayout.Controls.Add(heading, 0, 0);
        cardLayout.Controls.Add(content, 0, 1);
        SizeMessageCard(card, cardLayout, content);

        if (message.ScreenshotActivityId is long activityId)
        {
            var screenshotPanel = new Panel
            {
                Dock = DockStyle.Top,
                Height = 230,
                Margin = new Padding(0, 8, 0, 0),
            };
            var placeholder = new Label
            {
                Text = "Loading screenshot…",
                Dock = DockStyle.Fill,
                ForeColor = Color.FromArgb(160, 168, 181),
                TextAlign = ContentAlignment.MiddleCenter,
            };
            var picture = new PictureBox
            {
                Dock = DockStyle.Fill,
                SizeMode = PictureBoxSizeMode.Zoom,
                BackColor = Color.FromArgb(24, 27, 34),
            };
            screenshotPanel.Controls.Add(picture);
            screenshotPanel.Controls.Add(placeholder);
            cardLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 238));
            cardLayout.Controls.Add(screenshotPanel, 0, 2);
            _ = AddScreenshotAsync(activityId, picture, placeholder);
            SizeMessageCard(card, cardLayout, content);
        }

        card.Controls.Add(cardLayout);
        var isNewestMessage = message.Id >= Interlocked.Read(ref lastMessageId);
        var insertionIndex = messagesPanel.Controls
            .Cast<Control>()
            .TakeWhile(existing => existing.Tag is long existingId && existingId < message.Id)
            .Count();
        messagesPanel.Controls.Add(card);
        try
        {
            messagesPanel.Controls.SetChildIndex(card, insertionIndex);
            if (isNewestMessage)
            {
                messagesPanel.PerformLayout();
                card.PerformLayout();
                cardLayout.PerformLayout();
                // Show the end of long replies without putting a screenshot
                // below the text ahead of the reply in the outer viewport.
                content.SelectionStart = content.TextLength;
                content.SelectionLength = 0;
                content.ScrollToCaret();
                messagesPanel.ScrollControlIntoView(content);
            }
        }
        catch
        {
            messagesPanel.Controls.Remove(card);
            card.Dispose();
            throw;
        }
    }

    private static void SizeMessageCard(Panel card, TableLayoutPanel layout, RichTextBox content)
    {
        var textWidth = Math.Max(280, card.Width - 48);
        var measured = TextRenderer.MeasureText(content.Text, content.Font,
            new Size(textWidth, int.MaxValue),
            TextFormatFlags.WordBreak | TextFormatFlags.TextBoxControl);
        // A long reply stays scrollable inside its card; estimating a Label's
        // full height could clip its ending on some Windows DPI settings.
        var bodyHeight = Math.Clamp(measured.Height + 18, 44, 420);
        layout.RowStyles[1].Height = bodyHeight;
        card.Height = card.Padding.Vertical + 28 + bodyHeight +
            (layout.RowCount == 3 ? 238 : 0);
    }

    private void ResizeMessageCards()
    {
        foreach (Control control in messagesPanel.Controls)
        {
            control.Width = Math.Max(320, messagesPanel.ClientSize.Width - 34);
            if (control is Panel card &&
                card.Controls.OfType<TableLayoutPanel>().FirstOrDefault() is { } cardLayout &&
                cardLayout.Controls.Count > 1 &&
                cardLayout.Controls[1] is RichTextBox content)
            {
                SizeMessageCard(card, cardLayout, content);
            }
        }
    }

    private async Task EnsureChatSuccessAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.StatusCode == HttpStatusCode.Unauthorized)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            var error = FormatHttpError(response.StatusCode, body);
            MarkChatRevoked(error);
            throw new UnauthorizedChatException(error);
        }

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new HttpRequestException(FormatHttpError(response.StatusCode, body));
        }
    }

    private static string FormatHttpError(HttpStatusCode statusCode, string body)
    {
        var detail = string.IsNullOrWhiteSpace(body) ? "" : $" — {body.Trim()}";
        return $"HTTP {(int)statusCode} {statusCode}{detail}";
    }

    private void SetStatus(string status, string? detail, bool isError = false)
    {
        if (IsDisposed) return;
        void Update()
        {
            if (IsDisposed) return;
            statusLabel.Text = string.IsNullOrWhiteSpace(detail) ? status : $"{status}  ·  {detail}";
            statusLabel.ForeColor = isError ? Color.FromArgb(255, 132, 132) : Color.FromArgb(234, 193, 92);
        }

        if (InvokeRequired) BeginInvoke((Action)Update);
        else Update();
    }

    private void MarkChatRevoked(string detail)
    {
        if (revoked) return;
        revoked = true;
        screenshotCancellation.Cancel();
        void Update()
        {
            if (IsDisposed) return;
            foreach (var label in messagesPanel.Controls
                         .OfType<Panel>()
                         .SelectMany(panel => panel.Controls.OfType<TableLayoutPanel>())
                         .SelectMany(layout => layout.Controls.OfType<Panel>())
                         .SelectMany(panel => panel.Controls.OfType<Label>()))
            {
                if (label.Text.StartsWith("Loading screenshot", StringComparison.Ordinal))
                    label.Text = "Screenshot unavailable — chat token revoked.";
            }
            sendButton.Enabled = false;
            stopButton.Enabled = false;
            inputBox.Enabled = false;
            minutesBox.Enabled = false;
            minutesSaveButton.Enabled = false;
            SetStatus("Chat token revoked or expired.", detail, isError: true);
        }

        if (InvokeRequired) BeginInvoke((Action)Update);
        else Update();
    }

    private void UpdateChatControls()
    {
        if (IsDisposed) return;
        void Update()
        {
            if (IsDisposed) return;
            var canSend = windowStarted && !revoked && sessionAvailable && !sessionStopped && !stoppingSession &&
                uncertainSendContent is null && !sendInProgress;
            inputBox.Enabled = canSend;
            sendButton.Enabled = canSend;
            sendButton.Text = sendInProgress ? "Sending…" : uncertainSendContent is not null ? "Checking…" : "Send";
            minutesBox.Enabled = windowStarted && !revoked && !minutesSaving;
            minutesSaveButton.Enabled = minutesBox.Enabled && minutesDirty;
            minutesSaveButton.Text = minutesSaving ? "Saving…" : "Apply";
        }

        if (InvokeRequired) BeginInvoke((Action)Update);
        else Update();
    }

    private void OnInputKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.KeyCode == Keys.Enter && !e.Shift)
        {
            e.SuppressKeyPress = true;
            _ = SendMessageAsync();
        }
    }

    private void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
        monitorCancellation.Cancel();
        screenshotCancellation.Cancel();
    }

    private static HangoutMessage ParseMessage(JsonElement element)
    {
        var id = ReadId(element);
        var role = ReadString(element, "role") ?? "Unknown";
        var content = ReadString(element, "content") ?? "";
        var createdAt = ReadString(element, "createdAt") ?? "";
        long? screenshotActivityId = null;
        if (element.TryGetProperty("screenshotActivityId", out var screenshot) &&
            screenshot.ValueKind == JsonValueKind.Number &&
            screenshot.TryGetInt64(out var activityId))
        {
            screenshotActivityId = activityId;
        }
        return new HangoutMessage(id, role, content, createdAt, screenshotActivityId);
    }

    private static long ReadId(JsonElement element) =>
        element.TryGetProperty("id", out var id) && id.TryGetInt64(out var value) ? value : 0;

    private static string? ReadString(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private sealed record HangoutMessage(
        long Id,
        string Role,
        string Content,
        string CreatedAt,
        long? ScreenshotActivityId);

    private sealed class UnauthorizedChatException(string message) : Exception(message) { }
}
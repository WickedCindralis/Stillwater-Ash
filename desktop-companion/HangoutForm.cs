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
    private readonly Button settingsButton = new();
    private readonly Button collapseButton = new();
    private readonly Button closeButton = new();
    private readonly CheckBox alwaysOnTopCheck = new();
    private readonly Panel statusDot = new();
    private readonly Panel settingsPanel = new();
    private readonly RoundedPanel inputFrame = new();
    private readonly ToolTip uiToolTip = new();
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
    private bool collapsed;
    private bool dismissedByUser;
    private bool closingFromOwner;
    private bool headerPressActive;
    private bool headerWasDragged;
    private Point headerPressScreenPoint;
    private Point headerPressFormLocation;
    private int transcriptGeneration;
    private TableLayoutPanel? outerLayout;
    private TableLayoutPanel? bodyLayout;

    public HangoutForm(string serverUrl, string chatToken)
    {
        this.serverUrl = serverUrl.TrimEnd('/');
        this.chatToken = chatToken;
        Text = "Stillwater Hangout";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        ShowInTaskbar = false;
        Padding = new Padding(1);
        MinimumSize = new Size(340, 52);
        Size = new Size(340, 480);
        BackColor = Color.FromArgb(74, 61, 91);
        ForeColor = Color.White;
        Font = new Font("Segoe UI", 10F);
        TopMost = true;
        var workArea = Screen.FromPoint(Cursor.Position).WorkingArea;
        Location = new Point(workArea.Right - Width - 16, workArea.Bottom - Height - 16);
        FormClosing += OnFormClosing;
        BuildLayout();
        SizeChanged += (_, _) => SetRoundedRegion(this, 12);
        SetRoundedRegion(this, 12);
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

        if (dismissedByUser && !Visible) BeginNewVisiblePeriod();
        dismissedByUser = false;
        if (!Visible) Show();
        if (focus)
        {
            if (collapsed) ToggleCollapsed();
            WindowState = FormWindowState.Normal;
            BringToFront();
            Activate();
        }
    }

    public void CloseFromOwner()
    {
        closingFromOwner = true;
        monitorCancellation.Cancel();
        screenshotCancellation.Cancel();
        if (!IsDisposed) Close();
    }

    private void BuildLayout()
    {
        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 2,
            BackColor = Color.FromArgb(18, 20, 25),
            Margin = Padding.Empty,
        };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 52));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        Controls.Add(layout);
        outerLayout = layout;

        var header = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(22, 24, 31),
            Padding = new Padding(11, 6, 7, 6),
            Margin = Padding.Empty,
        };
        statusLabel.Location = new Point(13, 19);
        statusLabel.Size = new Size(132, 18);
        statusLabel.AutoEllipsis = true;
        statusLabel.Text = "Connecting to Hangout…";
        statusLabel.ForeColor = Color.FromArgb(177, 182, 194);
        statusLabel.Font = new Font("Segoe UI", 8.25F);
        statusDot.Size = new Size(8, 8);
        statusDot.BackColor = Color.FromArgb(234, 193, 92);
        SetCircularRegion(statusDot);
        var avatar = new Panel
        {
            Size = new Size(34, 34),
            Location = new Point(11, 10),
            BackColor = Color.FromArgb(112, 65, 190),
        };
        SetCircularRegion(avatar);
        var avatarInitial = new Label
        {
            Dock = DockStyle.Fill,
            Text = "A",
            ForeColor = Color.White,
            Font = new Font("Segoe UI Semibold", 13F),
            TextAlign = ContentAlignment.MiddleCenter,
            BackColor = Color.Transparent,
        };
        avatar.Controls.Add(avatarInitial);
        var identity = new Panel
        {
            Location = new Point(53, 6),
            Size = new Size(146, 40),
            BackColor = Color.Transparent,
        };
        var nameLabel = new Label
        {
            Text = "Ash",
            Location = new Point(0, 0),
            Size = new Size(132, 19),
            ForeColor = Color.White,
            Font = new Font("Segoe UI Semibold", 10.5F),
            AutoEllipsis = true,
        };
        statusDot.Location = new Point(1, 25);
        identity.Controls.Add(nameLabel);
        identity.Controls.Add(statusDot);
        identity.Controls.Add(statusLabel);

        var headerButtons = new FlowLayoutPanel
        {
            Dock = DockStyle.Right,
            Width = 105,
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = false,
            BackColor = Color.Transparent,
            Padding = new Padding(0, 1, 0, 0),
            Margin = Padding.Empty,
        };
        ConfigureHeaderButton(settingsButton, "⚙", "Hangout settings");
        ConfigureHeaderButton(collapseButton, "−", "Minimize to header");
        ConfigureHeaderButton(closeButton, "×", "Close Hangout window");
        settingsButton.Click += (_, _) => ToggleSettings();
        collapseButton.Click += (_, _) => ToggleCollapsed();
        closeButton.Click += (_, _) => DismissWindow();
        headerButtons.Controls.AddRange([settingsButton, collapseButton, closeButton]);
        header.Controls.Add(headerButtons);
        header.Controls.Add(identity);
        header.Controls.Add(avatar);
        layout.Controls.Add(header, 0, 0);
        AttachHeaderSurface(header);
        AttachHeaderSurface(identity);
        AttachHeaderSurface(nameLabel);
        AttachHeaderSurface(statusLabel);
        AttachHeaderSurface(statusDot);
        AttachHeaderSurface(avatar);
        AttachHeaderSurface(avatarInitial);

        var body = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 2,
            BackColor = Color.FromArgb(18, 20, 25),
            Padding = new Padding(0),
            Margin = Padding.Empty,
        };
        body.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        body.RowStyles.Add(new RowStyle(SizeType.Absolute, 62));
        bodyLayout = body;
        layout.Controls.Add(body, 0, 1);

        messagesPanel.Dock = DockStyle.Fill;
        messagesPanel.AutoScroll = true;
        messagesPanel.FlowDirection = FlowDirection.TopDown;
        messagesPanel.WrapContents = false;
        messagesPanel.BackColor = Color.FromArgb(18, 20, 25);
        messagesPanel.Padding = new Padding(8, 8, 8, 12);
        messagesPanel.Margin = Padding.Empty;
        messagesPanel.SizeChanged += (_, _) => ResizeMessageCards();
        body.Controls.Add(messagesPanel, 0, 0);

        var composer = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(18, 20, 25),
            Padding = new Padding(10, 7, 10, 8),
            Margin = Padding.Empty,
        };
        composer.Resize += (_, _) => LayoutComposer(composer);
        body.Controls.Add(composer, 0, 1);

        inputFrame.CornerRadius = 16;
        inputFrame.BackColor = Color.FromArgb(34, 36, 45);
        inputFrame.Padding = Padding.Empty;
        inputFrame.Size = new Size(268, 40);
        composer.Controls.Add(inputFrame);
        inputBox.Multiline = true;
        inputBox.AcceptsReturn = true;
        inputBox.WordWrap = true;
        inputBox.ScrollBars = ScrollBars.None;
        inputBox.BorderStyle = BorderStyle.None;
        inputBox.BackColor = inputFrame.BackColor;
        inputBox.ForeColor = Color.White;
        inputBox.Font = new Font("Segoe UI", 9.5F);
        inputBox.PlaceholderText = "Write a message…";
        inputBox.Enabled = false;
        inputBox.Height = 24;
        inputBox.TextChanged += (_, _) => ResizeComposer(composer);
        inputBox.KeyDown += OnInputKeyDown;
        inputFrame.Controls.Add(inputBox);

        sendButton.Text = "↑";
        sendButton.AccessibleName = "Send message";
        sendButton.Size = new Size(36, 36);
        sendButton.BackColor = Color.FromArgb(124, 58, 237);
        sendButton.ForeColor = Color.White;
        sendButton.FlatStyle = FlatStyle.Flat;
        sendButton.FlatAppearance.BorderSize = 0;
        sendButton.Font = new Font("Segoe UI Semibold", 15F);
        SetCircularRegion(sendButton);
        sendButton.Click += async (_, _) => await SendMessageAsync();
        uiToolTip.SetToolTip(sendButton, "Send message");
        composer.Controls.Add(sendButton);
        LayoutComposer(composer);

        BuildSettingsPanel();
    }

    private void BuildSettingsPanel()
    {
        settingsPanel.Size = new Size(224, 166);
        settingsPanel.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        settingsPanel.BackColor = Color.FromArgb(31, 33, 42);
        settingsPanel.BorderStyle = BorderStyle.FixedSingle;
        settingsPanel.Padding = Padding.Empty;
        settingsPanel.Visible = false;
        settingsPanel.Location = new Point(ClientSize.Width - settingsPanel.Width - 8, 51);

        var title = new Label
        {
            Text = "Hangout settings",
            Location = new Point(10, 8),
            Size = new Size(194, 20),
            ForeColor = Color.White,
            Font = new Font("Segoe UI Semibold", 9.5F),
        };
        alwaysOnTopCheck.Text = "Keep on top";
        alwaysOnTopCheck.Checked = true;
        alwaysOnTopCheck.Location = new Point(9, 31);
        alwaysOnTopCheck.Size = new Size(194, 23);
        alwaysOnTopCheck.ForeColor = Color.FromArgb(220, 222, 230);
        alwaysOnTopCheck.BackColor = Color.Transparent;
        alwaysOnTopCheck.CheckedChanged += (_, _) => TopMost = alwaysOnTopCheck.Checked;
        var minutesLabel = new Label
        {
            Text = "Screenshot interval (minutes)",
            Location = new Point(10, 57),
            Size = new Size(194, 19),
            ForeColor = Color.FromArgb(177, 182, 194),
            Font = new Font("Segoe UI", 8.5F),
        };
        minutesBox.Text = "15";
        minutesBox.Location = new Point(10, 79);
        minutesBox.Size = new Size(116, 25);
        minutesBox.MaxLength = 4;
        minutesBox.Enabled = false;
        minutesBox.AccessibleName = "Minutes between idle Hangout screenshots";
        minutesBox.BackColor = Color.FromArgb(23, 25, 32);
        minutesBox.ForeColor = Color.White;
        minutesBox.BorderStyle = BorderStyle.FixedSingle;
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
        minutesSaveButton.Text = "Apply";
        minutesSaveButton.Location = new Point(133, 78);
        minutesSaveButton.Size = new Size(72, 27);
        minutesSaveButton.BackColor = Color.FromArgb(60, 48, 85);
        minutesSaveButton.ForeColor = Color.White;
        minutesSaveButton.FlatStyle = FlatStyle.Flat;
        minutesSaveButton.FlatAppearance.BorderSize = 0;
        minutesSaveButton.Enabled = false;
        minutesSaveButton.Click += async (_, _) => await SaveMinutesAsync();
        stopButton.Text = "Stop Hangout";
        stopButton.Location = new Point(10, 116);
        stopButton.Size = new Size(195, 32);
        stopButton.BackColor = Color.FromArgb(67, 38, 47);
        stopButton.ForeColor = Color.FromArgb(255, 190, 197);
        stopButton.FlatStyle = FlatStyle.Flat;
        stopButton.FlatAppearance.BorderSize = 0;
        stopButton.Enabled = false;
        stopButton.Click += async (_, _) => await StopHangoutAsync();
        settingsPanel.Controls.AddRange([title, alwaysOnTopCheck, minutesLabel, minutesBox, minutesSaveButton, stopButton]);
        Controls.Add(settingsPanel);
        settingsPanel.BringToFront();
        uiToolTip.SetToolTip(settingsButton, "Hangout settings");
        uiToolTip.SetToolTip(alwaysOnTopCheck, "Keep the Hangout window above other windows");
        uiToolTip.SetToolTip(collapseButton, "Minimize to header");
        uiToolTip.SetToolTip(closeButton, "Hide the Hangout window");
    }

    private static void ConfigureHeaderButton(Button button, string text, string accessibleName)
    {
        button.Text = text;
        button.AccessibleName = accessibleName;
        button.Size = new Size(28, 34);
        button.Margin = new Padding(1, 0, 1, 0);
        button.BackColor = Color.FromArgb(35, 37, 46);
        button.ForeColor = Color.FromArgb(224, 226, 233);
        button.FlatStyle = FlatStyle.Flat;
        button.FlatAppearance.BorderSize = 0;
        button.Font = new Font("Segoe UI", 12F);
        button.Cursor = Cursors.Hand;
        SetRoundedRegion(button, 7);
    }

    private void LayoutComposer(Panel composer)
    {
        var availableWidth = Math.Max(160, composer.ClientSize.Width - composer.Padding.Horizontal);
        inputFrame.Location = new Point(composer.Padding.Left, Math.Max(4, (composer.ClientSize.Height - inputFrame.Height) / 2));
        inputFrame.Width = Math.Max(80, availableWidth - sendButton.Width - 8);
        sendButton.Location = new Point(inputFrame.Right + 8,
            Math.Max(4, (composer.ClientSize.Height - sendButton.Height) / 2));
        inputBox.Location = new Point(10, 7);
        inputBox.Width = Math.Max(50, inputFrame.ClientSize.Width - 20);
    }

    private void ResizeComposer(Panel composer)
    {
        if (bodyLayout is null || composer.IsDisposed) return;
        var usableWidth = Math.Max(120, composer.ClientSize.Width - 82);
        var measured = TextRenderer.MeasureText(
            string.IsNullOrEmpty(inputBox.Text) ? " " : inputBox.Text,
            inputBox.Font,
            new Size(usableWidth, int.MaxValue),
            TextFormatFlags.WordBreak | TextFormatFlags.TextBoxControl | TextFormatFlags.NoPadding);
        var desiredTextHeight = Math.Clamp(measured.Height, inputBox.Font.Height, inputBox.Font.Height * 3);
        var targetHeight = Math.Clamp(desiredTextHeight + 14, 38, 70);
        inputBox.Height = Math.Max(inputBox.Font.Height, targetHeight - 14);
        inputBox.ScrollBars = measured.Height > inputBox.Font.Height * 3
            ? ScrollBars.Vertical
            : ScrollBars.None;
        inputFrame.Height = targetHeight;
        bodyLayout.RowStyles[1].Height = targetHeight + 20;
        LayoutComposer(composer);
    }

    private void AttachHeaderSurface(Control control)
    {
        control.MouseDown += OnHeaderMouseDown;
        control.MouseMove += OnHeaderMouseMove;
        control.MouseUp += OnHeaderMouseUp;
    }

    private void OnHeaderMouseDown(object? sender, MouseEventArgs e)
    {
        if (e.Button != MouseButtons.Left) return;
        headerPressActive = true;
        headerWasDragged = false;
        headerPressScreenPoint = Cursor.Position;
        headerPressFormLocation = Location;
    }

    private void OnHeaderMouseMove(object? sender, MouseEventArgs e)
    {
        if (!headerPressActive || (Control.MouseButtons & MouseButtons.Left) == 0) return;
        var current = Cursor.Position;
        var dx = current.X - headerPressScreenPoint.X;
        var dy = current.Y - headerPressScreenPoint.Y;
        if (!headerWasDragged && Math.Abs(dx) + Math.Abs(dy) < 6) return;
        headerWasDragged = true;
        Location = new Point(headerPressFormLocation.X + dx, headerPressFormLocation.Y + dy);
    }

    private void OnHeaderMouseUp(object? sender, MouseEventArgs e)
    {
        if (!headerPressActive || e.Button != MouseButtons.Left) return;
        var shouldToggle = !headerWasDragged;
        headerPressActive = false;
        headerWasDragged = false;
        if (shouldToggle) ToggleCollapsed();
    }

    private void ToggleCollapsed()
    {
        if (outerLayout is null) return;
        var bottom = Bottom;
        collapsed = !collapsed;
        outerLayout.RowStyles[1].Height = collapsed ? 0 : 1;
        outerLayout.RowStyles[1].SizeType = collapsed ? SizeType.Absolute : SizeType.Percent;
        Size = new Size(340, collapsed ? 54 : 480);
        Top = bottom - Height;
        collapseButton.Text = collapsed ? "□" : "−";
        collapseButton.AccessibleName = collapsed ? "Expand Hangout" : "Minimize to header";
        uiToolTip.SetToolTip(collapseButton, collapseButton.AccessibleName);
        if (collapsed) settingsPanel.Visible = false;
    }

    private void ToggleSettings()
    {
        if (collapsed) ToggleCollapsed();
        settingsPanel.Visible = !settingsPanel.Visible;
        if (settingsPanel.Visible)
        {
            settingsPanel.Location = new Point(ClientSize.Width - settingsPanel.Width - 8, 51);
            settingsPanel.BringToFront();
        }
    }

    private void DismissWindow()
    {
        dismissedByUser = true;
        settingsPanel.Visible = false;
        Hide();
    }

    private void BeginNewVisiblePeriod()
    {
        Interlocked.Increment(ref transcriptGeneration);
        windowStarted = false;
        messagesPanel.SuspendLayout();
        try
        {
            foreach (Control row in messagesPanel.Controls.Cast<Control>().ToArray())
            {
                if (row.Tag is MessageRowState state && state.Picture?.Image is Image image)
                {
                    state.Picture.Image = null;
                    image.Dispose();
                }
                messagesPanel.Controls.Remove(row);
                row.Dispose();
            }
            lock (messageLock)
            {
                displayedMessageIds.Clear();
                if (!sendInProgress && uncertainSendContent is null) canonicalMessages.Clear();
            }
            messagesPanel.AutoScrollPosition = Point.Empty;
        }
        finally
        {
            messagesPanel.ResumeLayout();
        }
    }

    private static void SetCircularRegion(Control control)
    {
        using var path = new System.Drawing.Drawing2D.GraphicsPath();
        path.AddEllipse(0, 0, control.Width, control.Height);
        var previous = control.Region;
        control.Region = new Region(path);
        previous?.Dispose();
    }

    private static void SetRoundedRegion(Control control, int radius)
    {
        if (control.Width <= 0 || control.Height <= 0) return;
        var diameter = Math.Min(radius * 2, Math.Min(control.Width, control.Height));
        using var path = new System.Drawing.Drawing2D.GraphicsPath();
        path.AddArc(0, 0, diameter, diameter, 180, 90);
        path.AddArc(control.Width - diameter, 0, diameter, diameter, 270, 90);
        path.AddArc(control.Width - diameter, control.Height - diameter, diameter, diameter, 0, 90);
        path.AddArc(0, control.Height - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        var previous = control.Region;
        control.Region = new Region(path);
        previous?.Dispose();
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
                    windowStart: !visibleAtRequest || startingWindow, startVisibleWindow: startingWindow,
                    windowGeneration: Volatile.Read(ref transcriptGeneration));
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
        bool windowStart = false, bool startVisibleWindow = false, int? windowGeneration = null)
    {
        using var response = await client.GetAsync(
            $"{serverUrl}/api/hangout/companion/sync?after={after}" +
                (windowStart ? "&windowStart=1" : ""),
            cancellationToken);
        await EnsureChatSuccessAsync(response, cancellationToken);

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
        if (windowGeneration.HasValue &&
            windowGeneration.Value != Volatile.Read(ref transcriptGeneration)) return;
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

        if (!Visible && !dismissedByUser && (status.Equals("active", StringComparison.OrdinalIgnoreCase) ||
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
            {
                placeholder.Text = "Unavailable";
                uiToolTip.SetToolTip(placeholder, "Screenshot unavailable — chat token revoked.");
            }
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
        var fromWicked = message.Role.Equals("wicked", StringComparison.OrdinalIgnoreCase) ||
            message.Role.Equals("user", StringComparison.OrdinalIgnoreCase);
        var bubble = new RoundedPanel
        {
            CornerRadius = 16,
            BackColor = fromWicked
                ? Color.FromArgb(91, 50, 151)
                : Color.FromArgb(39, 42, 51),
        };
        var content = new Label
        {
            AutoSize = false,
            UseMnemonic = false,
            AutoEllipsis = false,
            Text = message.Content,
            ForeColor = Color.FromArgb(241, 241, 246),
            BackColor = Color.Transparent,
            Font = new Font("Segoe UI", 9.5F),
            TextAlign = ContentAlignment.TopLeft,
        };
        var hasTimestamp = DateTimeOffset.TryParse(message.CreatedAt, out var parsed);
        var timestampText = hasTimestamp ? parsed.ToLocalTime().ToString("t") : message.CreatedAt;
        var timestampFull = hasTimestamp ? parsed.ToLocalTime().ToString("f") : message.CreatedAt;
        var timestamp = new Label
        {
            AutoSize = false,
            Text = timestampText,
            ForeColor = Color.FromArgb(133, 139, 153),
            Font = new Font("Segoe UI", 7.5F),
            TextAlign = fromWicked ? ContentAlignment.MiddleRight : ContentAlignment.MiddleLeft,
            AutoEllipsis = true,
        };
        uiToolTip.SetToolTip(timestamp, timestampFull);

        PictureBox? picture = null;
        Label? screenshotPlaceholder = null;
        if (message.ScreenshotActivityId is not null)
        {
            picture = new PictureBox
            {
                Size = new Size(96, 62),
                SizeMode = PictureBoxSizeMode.Zoom,
                BackColor = Color.FromArgb(23, 25, 32),
                Cursor = Cursors.Hand,
                AccessibleName = "Screenshot thumbnail. Click to view full size.",
                BorderStyle = BorderStyle.FixedSingle,
            };
            screenshotPlaceholder = new Label
            {
                Text = "Loading",
                Size = picture.Size,
                ForeColor = Color.FromArgb(160, 168, 181),
                TextAlign = ContentAlignment.MiddleCenter,
                BackColor = picture.BackColor,
            };
            picture.Click += (_, _) => OpenScreenshot(picture);
            screenshotPlaceholder.Click += (_, _) => OpenScreenshot(picture);
            bubble.Controls.Add(picture);
            bubble.Controls.Add(screenshotPlaceholder);
        }

        bubble.Controls.Add(content);
        var card = new Panel
        {
            Margin = new Padding(0, 0, 0, 8),
            BackColor = messagesPanel.BackColor,
        };
        var state = new MessageRowState(message.Id, fromWicked, bubble, content, timestamp, picture, screenshotPlaceholder);
        card.Tag = state;
        card.Controls.Add(bubble);
        card.Controls.Add(timestamp);
        LayoutMessageRow(card, state);

        var isNewestMessage = message.Id >= Interlocked.Read(ref lastMessageId);
        var insertionIndex = messagesPanel.Controls
            .Cast<Control>()
            .TakeWhile(existing => existing.Tag is MessageRowState existingState && existingState.Id < message.Id)
            .Count();
        messagesPanel.Controls.Add(card);
        try
        {
            messagesPanel.Controls.SetChildIndex(card, insertionIndex);
            if (isNewestMessage)
            {
                messagesPanel.PerformLayout();
                card.PerformLayout();
                messagesPanel.ScrollControlIntoView(card);
                // A long message fills its bubble; scroll the conversation
                // to the newest text rather than adding a scrollbar to it.
                messagesPanel.AutoScrollPosition = new Point(0, messagesPanel.DisplayRectangle.Height);
            }
            if (message.ScreenshotActivityId is long activityId &&
                picture is not null && screenshotPlaceholder is not null)
                _ = AddScreenshotAsync(activityId, picture, screenshotPlaceholder);
        }
        catch
        {
            messagesPanel.Controls.Remove(card);
            card.Dispose();
            throw;
        }
    }

    private void LayoutMessageRow(Panel row, MessageRowState state)
    {
        var rowWidth = Math.Max(200, messagesPanel.ClientSize.Width - messagesPanel.Padding.Horizontal - 4);
        var maxBubbleWidth = Math.Max(120, Math.Min(252, (int)(rowWidth * 0.84)));
        const TextFormatFlags measureFlags = TextFormatFlags.WordBreak |
            TextFormatFlags.TextBoxControl | TextFormatFlags.NoPadding;
        var text = string.IsNullOrEmpty(state.Content.Text) ? " " : state.Content.Text;
        var naturalSize = TextRenderer.MeasureText(text, state.Content.Font,
            new Size(maxBubbleWidth - 24, int.MaxValue), measureFlags);
        var bubbleWidth = Math.Clamp(naturalSize.Width + 24, Math.Min(112, maxBubbleWidth), maxBubbleWidth);
        var contentWidth = Math.Max(48, bubbleWidth - 24);
        var contentSize = TextRenderer.MeasureText(text, state.Content.Font,
            new Size(contentWidth, int.MaxValue), measureFlags);
        // Label painting may need a few extra pixels at non-default display scales.
        // Do not cap the height: the conversation scrolls, never the bubble.
        var contentHeight = Math.Max(state.Content.Font.Height, contentSize.Height) +
            state.Content.Font.Height / 2 + 4;
        var bubble = state.Bubble;
        bubble.Width = bubbleWidth;
        state.Content.Location = new Point(12, 10);
        state.Content.Size = new Size(contentWidth, contentHeight);

        var contentBottom = state.Content.Bottom;
        if (state.Picture is not null)
        {
            state.Picture.Location = new Point(12, contentBottom + 8);
            if (state.ScreenshotPlaceholder is not null)
                state.ScreenshotPlaceholder.Location = state.Picture.Location;
            bubble.Height = state.Picture.Bottom + 10;
        }
        else
        {
            bubble.Height = contentBottom + 10;
        }

        var x = state.FromWicked ? rowWidth - bubbleWidth - 4 : 4;
        bubble.Location = new Point(Math.Max(0, x), 0);
        state.Timestamp.Location = new Point(bubble.Left, bubble.Bottom + 2);
        state.Timestamp.Size = new Size(bubble.Width, 14);
        row.Size = new Size(rowWidth, state.Timestamp.Bottom + 2);
    }

    private void ResizeMessageCards()
    {
        foreach (Control control in messagesPanel.Controls)
        {
            if (control is Panel row && row.Tag is MessageRowState state)
                LayoutMessageRow(row, state);
        }
    }

    private void OpenScreenshot(PictureBox picture)
    {
        if (picture.Image is null || picture.IsDisposed) return;
        var fullImage = new Bitmap(picture.Image);
        var preview = new Form
        {
            Text = "Hangout screenshot",
            StartPosition = FormStartPosition.CenterParent,
            FormBorderStyle = FormBorderStyle.SizableToolWindow,
            BackColor = Color.FromArgb(18, 20, 25),
            Size = new Size(960, 680),
            MinimumSize = new Size(420, 320),
        };
        var fullSizePicture = new PictureBox
        {
            Dock = DockStyle.Fill,
            SizeMode = PictureBoxSizeMode.Zoom,
            BackColor = preview.BackColor,
            Image = fullImage,
            Padding = new Padding(12),
        };
        preview.Controls.Add(fullSizePicture);
        preview.FormClosed += (_, _) => fullImage.Dispose();
        preview.Show(this);
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
            statusLabel.Text = status switch
            {
                "Hangout Active" => "Hangout active",
                "Hangout Inviting" => "Waiting for Ash",
                "Hangout Idle" => "Hangout idle",
                "Hangout Unavailable" => "Connecting…",
                _ => status,
            };
            statusLabel.ForeColor = isError ? Color.FromArgb(255, 150, 155) : Color.FromArgb(177, 182, 194);
            statusDot.BackColor = isError ? Color.FromArgb(255, 118, 133)
                : status == "Hangout Active" ? Color.FromArgb(97, 211, 153)
                : Color.FromArgb(234, 193, 92);
            var fullStatus = string.IsNullOrWhiteSpace(detail) ? status : $"{status}  ·  {detail}";
            uiToolTip.SetToolTip(statusLabel, fullStatus);
            uiToolTip.SetToolTip(statusDot, fullStatus);
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
                         .Select(panel => (panel.Tag as MessageRowState)?.ScreenshotPlaceholder)
                         .OfType<Label>())
            {
                if (label.Text.StartsWith("Loading", StringComparison.Ordinal))
                {
                    label.Text = "Unavailable";
                    uiToolTip.SetToolTip(label, "Screenshot unavailable — chat token revoked.");
                }
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
            sendButton.Text = sendInProgress || uncertainSendContent is not null ? "…" : "↑";
            sendButton.AccessibleName = sendInProgress ? "Sending message"
                : uncertainSendContent is not null ? "Checking whether message was sent" : "Send message";
            uiToolTip.SetToolTip(sendButton, sendButton.AccessibleName);
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
        if (!closingFromOwner && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            DismissWindow();
            return;
        }
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

    private sealed record MessageRowState(
        long Id,
        bool FromWicked,
        RoundedPanel Bubble,
        Label Content,
        Label Timestamp,
        PictureBox? Picture,
        Label? ScreenshotPlaceholder);

    private sealed class RoundedPanel : Panel
    {
        private int cornerRadius = 16;

        public int CornerRadius
        {
            get => cornerRadius;
            set
            {
                cornerRadius = value;
                UpdateRoundedRegion();
            }
        }

        protected override void OnSizeChanged(EventArgs e)
        {
            base.OnSizeChanged(e);
            UpdateRoundedRegion();
        }

        private void UpdateRoundedRegion()
        {
            if (Width <= 0 || Height <= 0) return;
            var diameter = Math.Min(cornerRadius * 2, Math.Min(Width, Height));
            using var path = new System.Drawing.Drawing2D.GraphicsPath();
            path.AddArc(0, 0, diameter, diameter, 180, 90);
            path.AddArc(Width - diameter, 0, diameter, diameter, 270, 90);
            path.AddArc(Width - diameter, Height - diameter, diameter, diameter, 0, 90);
            path.AddArc(0, Height - diameter, diameter, diameter, 90, 90);
            path.CloseFigure();
            var previous = Region;
            Region = new Region(path);
            previous?.Dispose();
        }
    }

    private sealed class UnauthorizedChatException(string message) : Exception(message) { }
}
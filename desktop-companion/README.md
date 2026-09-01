# Stillwater Windows desktop companion

This companion is a small PowerShell process for Windows 10/11. It captures the
combined virtual desktop across all connected monitors and uploads a fresh JPEG
only when Stillwater has an eligible proactive ping waiting.

## One-time setup

1. In Stillwater, open Ash → Settings and select **Pair Windows companion**.
2. Copy the one-time token shown in the dashboard.
3. Open PowerShell on the Windows machine connected to the monitors.
4. Run:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
.\stillwater-screen-capture.ps1 -ServerUrl "https://your-stillwater-host" -Token "PASTE_TOKEN_HERE"
```

The companion rejects plaintext HTTP URLs. HTTP is accepted only for loopback
development (`localhost` or `127.0.0.1`); remote Stillwater hosts must use HTTPS.

The script stays running and checks for capture requests. There is no approval
prompt for individual screenshots. In Stillwater, **Screenshots ON** is the
runtime switch; turn it OFF before bed to stop new captures. Re-pairing replaces
the previous token. Use **Revoke pairing** to disable the companion completely.

The token authorizes this companion to upload screenshots to this Stillwater
instance. Treat it like a password: do not commit it, paste it into chat, or
share it with anyone.

## Notes

- The image is captured from the Windows virtual screen, so monitors arranged
  left/right or above/below are included in one combined image.
- Stillwater validates the image, waits only briefly for each request, and does
  not save the screenshot to chat history or the local database.
- If the companion is stopped, disconnected, or the toggle is OFF, Ash receives
  no stale or fabricated desktop image.
param(
    [Parameter(Mandatory = $true)]
    [string]$ServerUrl,

    [Parameter(Mandatory = $true)]
    [string]$Token,

    [int]$PollSeconds = 5
)

$ErrorActionPreference = "Stop"
$ServerUrl = $ServerUrl.TrimEnd("/")
$ParsedServerUrl = [System.Uri]::new($ServerUrl)
if ($ParsedServerUrl.Scheme -ne "https" -and -not ($ParsedServerUrl.Scheme -eq "http" -and $ParsedServerUrl.IsLoopback)) {
    throw "ServerUrl must use HTTPS. Plain HTTP is allowed only for loopback development."
}
$Headers = @{ Authorization = "Bearer $Token" }

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

function Get-DesktopJpegDataUrl {
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
    $graphics = $null
    $stream = $null
    $encoderParameters = $null
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)

        $stream = [System.IO.MemoryStream]::new()
        $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
            Where-Object { $_.MimeType -eq "image/jpeg" } |
            Select-Object -First 1
        $encoderParameters = [System.Drawing.Imaging.EncoderParameters]::new(1)
        $encoderParameters.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new(
            [System.Drawing.Imaging.Encoder]::Quality,
            [long]75
        )
        $bitmap.Save($stream, $codec, $encoderParameters)
        $base64 = [Convert]::ToBase64String($stream.ToArray())
        return "data:image/jpeg;base64,$base64"
    }
    finally {
        if ($encoderParameters) { $encoderParameters.Dispose() }
        if ($stream) { $stream.Dispose() }
        if ($graphics) { $graphics.Dispose() }
        if ($bitmap) { $bitmap.Dispose() }
    }
}

Write-Host "Stillwater desktop companion running. Screenshots are controlled by the dashboard toggle."
Write-Host "Press Ctrl+C to stop."

while ($true) {
    try {
        $request = Invoke-RestMethod `
            -Method Get `
            -Uri "$ServerUrl/api/screen-capture/request" `
            -Headers $Headers `
            -TimeoutSec 20

        if ($request.requestId) {
            Write-Host "Capture requested ($($request.requestId)); capturing virtual desktop..."
            $imageDataUrl = Get-DesktopJpegDataUrl
            $body = @{ imageDataUrl = $imageDataUrl } | ConvertTo-Json -Compress
            Invoke-RestMethod `
                -Method Post `
                -Uri "$ServerUrl/api/screen-capture/request/$($request.requestId)" `
                -Headers $Headers `
                -ContentType "application/json" `
                -Body $body `
                -TimeoutSec 20 | Out-Null
            Write-Host "Capture uploaded."
        }
    }
    catch {
        Write-Warning ("Stillwater companion: " + $_.Exception.Message)
    }
    Start-Sleep -Seconds ([Math]::Max(1, $PollSeconds))
}
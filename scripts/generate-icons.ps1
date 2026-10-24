Add-Type -AssemblyName System.Drawing

$srcPath = Join-Path $PSScriptRoot "..\frontend\src\assets\logo.png"
$publicDir = Join-Path $PSScriptRoot "..\frontend\public"

if (-not (Test-Path $publicDir)) {
    New-Item -ItemType Directory -Force -Path $publicDir | Out-Null
}

$srcBmp = [System.Drawing.Bitmap]::FromFile((Resolve-Path $srcPath))
Write-Host "Source image loaded: $($srcBmp.Width) x $($srcBmp.Height)"

$corner = $srcBmp.GetPixel(0, 0)
Write-Host "Corner color: R=$($corner.R), G=$($corner.G), B=$($corner.B), A=$($corner.A)"

function Resize-Image($sourceBmp, $destPath, $targetWidth, $targetHeight, $paddingPercent = 0, $bgColor = $null) {
    $destBmp = New-Object System.Drawing.Bitmap $targetWidth, $targetHeight
    $graphics = [System.Drawing.Graphics]::FromImage($destBmp)
    
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    if ($bgColor -ne $null) {
        $brush = New-Object System.Drawing.SolidBrush $bgColor
        $graphics.FillRectangle($brush, 0, 0, $targetWidth, $targetHeight)
        $brush.Dispose()
    } else {
        $graphics.Clear([System.Drawing.Color]::Transparent)
    }

    $pad = [int]($targetWidth * $paddingPercent)
    $drawW = $targetWidth - (2 * $pad)
    $drawH = $targetHeight - (2 * $pad)
    $drawX = $pad
    $drawY = $pad

    $graphics.DrawImage($sourceBmp, $drawX, $drawY, $drawW, $drawH)
    $graphics.Dispose()

    $destBmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $destBmp.Dispose()
    Write-Host "Generated: $destPath ($targetWidth x $targetHeight)"
}

# 1. Standard PWA Icons (192x192, 512x512)
Resize-Image $srcBmp (Join-Path $publicDir "pwa-192x192.png") 192 192 0
Resize-Image $srcBmp (Join-Path $publicDir "pwa-512x512.png") 512 512 0

# 2. Maskable Icon (safe zone padding 10% on each side)
# If corner is colored, use that color as background, else transparent or #0f172a / #2563eb
$maskableBg = if ($corner.A -gt 200) { $corner } else { [System.Drawing.Color]::FromArgb(255, 37, 99, 235) }
Resize-Image $srcBmp (Join-Path $publicDir "pwa-maskable-512x512.png") 512 512 0.1 $maskableBg

# 3. Apple Touch Icon for iOS Safari (180x180)
Resize-Image $srcBmp (Join-Path $publicDir "apple-touch-icon.png") 180 180 0

# 4. Favicons
Resize-Image $srcBmp (Join-Path $publicDir "favicon-32x32.png") 32 32 0
Resize-Image $srcBmp (Join-Path $publicDir "favicon-16x16.png") 16 16 0

$srcBmp.Dispose()
Write-Host "All icons generated successfully!"

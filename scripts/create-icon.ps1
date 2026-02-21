# Create a simple .ico file for the installer
param([string]$OutPath = "$PSScriptRoot\..\Assets\app.ico")

Add-Type -AssemblyName System.Drawing

$sizes = @(16, 32, 48, 256)
$images = @()

foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.Clear([System.Drawing.Color]::FromArgb(0x33, 0x99, 0xFF))

    $font = New-Object System.Drawing.Font("Arial", [Math]::Max(8, $size / 3), [System.Drawing.FontStyle]::Bold)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $g.DrawString("M", $font, [System.Drawing.Brushes]::White, $rect, $sf)
    $g.Dispose()
    $images += $bmp
}

# Build ICO file manually (ICO format: header + entries + image data)
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)

# ICO header
$bw.Write([UInt16]0)       # reserved
$bw.Write([UInt16]1)       # type (1 = ICO)
$bw.Write([UInt16]$sizes.Count)

$headerSize = 6 + ($sizes.Count * 16)
$offset = $headerSize
$pngData = @()

foreach ($i in 0..($sizes.Count - 1)) {
    $pngMs = New-Object System.IO.MemoryStream
    $images[$i].Save($pngMs, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $pngMs.ToArray()
    $pngData += ,($bytes)
    $pngMs.Dispose()

    $w = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
    $h = $w
    $bw.Write([byte]$w)
    $bw.Write([byte]$h)
    $bw.Write([byte]0)     # color palette
    $bw.Write([byte]0)     # reserved
    $bw.Write([UInt16]1)   # color planes
    $bw.Write([UInt16]32)  # bits per pixel
    $bw.Write([UInt32]$bytes.Length)
    $bw.Write([UInt32]$offset)
    $offset += $bytes.Length
}

foreach ($d in $pngData) {
    $bw.Write($d)
}

[System.IO.File]::WriteAllBytes($OutPath, $ms.ToArray())

$bw.Dispose()
$ms.Dispose()
foreach ($img in $images) { $img.Dispose() }

Write-Host "Created: $OutPath"

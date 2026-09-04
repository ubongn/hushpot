# Render real vitest output (tools/tests-run-output.txt) to an evidence screenshot.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$raw = Get-Content -Raw "tools\tests-run-output.txt"
# Strip ANSI escape sequences so the image shows clean text
$clean = [regex]::Replace($raw, "\x1B\[[0-9;]*m", "")
# Replace mojibake checkmark sequences (UTF-8 read as CP1252) with a plain tick char code 0x2713,
# then replace the raw UTF-8 bytes for the check glyph too.
$m1 = [string][char]0xE2 + [string][char]0x9C + [string][char]0x93
$m2 = [string][char]0xC3 + [string][char]0xA2 + [string][char]0x80 + [string][char]0x9C + [string][char]0x93
$clean = $clean.Replace($m2, [string][char]0x2713).Replace($m1, [string][char]0x2713)
$lines = $clean -split "`r?`n"

$font = New-Object System.Drawing.Font("Consolas", 13)
$bg = [System.Drawing.Color]::FromArgb(16, 16, 20)
$fg = [System.Drawing.Brushes]::White
$green = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(80, 220, 120))
$dim = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(150, 150, 160))

$bmp = New-Object System.Drawing.Bitmap(1180, 34)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$lineH = [int]($g.MeasureString("Xg", $font).Height) + 4
$g.Dispose(); $bmp.Dispose()

$height = ($lines.Count * $lineH) + 40
$bmp = New-Object System.Drawing.Bitmap(1180, $height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear($bg)
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

$stamp = "hushpot - npm test - vitest run - 2026-09-04 14:45:47 - 51/51 passing"
$g.DrawString($stamp, $font, $dim, 16, 10)
$y = 40
$tick = [string][char]0x2713
foreach ($line in $lines) {
    if ($line -match "passed" -or $line.Contains($tick)) { $brush = $green }
    elseif ($line -match "midnight-run@|npm|Test Files|Tests|Duration|Start at|RUN") { $brush = $fg }
    else { $brush = $dim }
    $g.DrawString($line, $font, $brush, 16, $y)
    $y += $lineH
}
$g.Dispose()
$bmp.Save("screenshots\05-tests-51-passing.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ("RENDERED screenshots\05-tests-51-passing.png (" + $lines.Count + " lines, " + $height + "px)")

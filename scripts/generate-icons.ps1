param(
  [string]$OutputDir = "assets"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$outDir = Join-Path $root $OutputDir
$pngDir = Join-Path $outDir "icons"
New-Item -ItemType Directory -Force -Path $pngDir | Out-Null

function New-RoundedRectPath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $d = $Radius * 2
  $path.AddArc($X, $Y, $d, $d, 180, 90)
  $path.AddArc($X + $Width - $d, $Y, $d, $d, 270, 90)
  $path.AddArc($X + $Width - $d, $Y + $Height - $d, $d, $d, 0, 90)
  $path.AddArc($X, $Y + $Height - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-PointF {
  param([float]$X, [float]$Y)
  return [System.Drawing.PointF]::new($X, $Y)
}

function Draw-Logo {
  param(
    [int]$Size,
    [string]$Path
  )

  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $s = [float]$Size
  $bgPath = New-RoundedRectPath 0 0 $s $s ($s * 0.215)
  $bgBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    (New-PointF ($s * 0.16) ($s * 0.12)),
    (New-PointF ($s * 0.84) ($s * 0.88)),
    [System.Drawing.ColorTranslator]::FromHtml("#17345d"),
    [System.Drawing.ColorTranslator]::FromHtml("#2c8f8a")
  )
  $graphics.FillPath($bgBrush, $bgPath)

  $shadowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(88, 8, 24, 42))
  $graphics.FillPolygon($shadowBrush, [System.Drawing.PointF[]]@(
    (New-PointF ($s * 0.19) ($s * 0.73)),
    (New-PointF ($s * 0.50) ($s * 0.84)),
    (New-PointF ($s * 0.81) ($s * 0.73)),
    (New-PointF ($s * 0.81) ($s * 0.37)),
    (New-PointF ($s * 0.50) ($s * 0.47)),
    (New-PointF ($s * 0.19) ($s * 0.37))
  ))

  $leftPage = [System.Drawing.PointF[]]@(
    (New-PointF ($s * 0.205) ($s * 0.30)),
    (New-PointF ($s * 0.50) ($s * 0.405)),
    (New-PointF ($s * 0.50) ($s * 0.785)),
    (New-PointF ($s * 0.205) ($s * 0.685))
  )
  $rightPage = [System.Drawing.PointF[]]@(
    (New-PointF ($s * 0.50) ($s * 0.405)),
    (New-PointF ($s * 0.795) ($s * 0.30)),
    (New-PointF ($s * 0.795) ($s * 0.685)),
    (New-PointF ($s * 0.50) ($s * 0.785))
  )

  $leftBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#fff5d6"))
  $rightBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#eef8ff"))
  $graphics.FillPolygon($leftBrush, $leftPage)
  $graphics.FillPolygon($rightBrush, $rightPage)

  $spineBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#d2ddeb"))
  $graphics.FillPolygon($spineBrush, [System.Drawing.PointF[]]@(
    (New-PointF ($s * 0.48) ($s * 0.41)),
    (New-PointF ($s * 0.52) ($s * 0.41)),
    (New-PointF ($s * 0.52) ($s * 0.80)),
    (New-PointF ($s * 0.50) ($s * 0.835)),
    (New-PointF ($s * 0.48) ($s * 0.80))
  ))

  $lineWidth = [Math]::Max(1.4, $s * 0.024)
  $linePenLeft = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(132, 107, 132, 154), $lineWidth)
  $linePenLeft.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $linePenLeft.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $linePenRight = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(118, 98, 144, 178), $lineWidth)
  $linePenRight.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $linePenRight.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

  foreach ($y in @(0.43, 0.51, 0.59)) {
    $graphics.DrawLine($linePenLeft, ($s * 0.25), ($s * $y), ($s * 0.44), ($s * ($y + 0.045)))
  }
  foreach ($y in @(0.46, 0.545)) {
    $graphics.DrawLine($linePenRight, ($s * 0.57), ($s * ($y + 0.035)), ($s * 0.75), ($s * $y))
  }

  $cyan = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#8ff3ff"))
  $gold = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#f8d86a"))
  $cyanPen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml("#8ff3ff"), [Math]::Max(2, $s * 0.018))
  $cyanPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $cyanPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

  $graphics.DrawLine($cyanPen, ($s * 0.61), ($s * 0.34), ($s * 0.77), ($s * 0.50))
  $graphics.FillEllipse($cyan, ($s * 0.57), ($s * 0.30), ($s * 0.07), ($s * 0.07))
  $graphics.FillEllipse($gold, ($s * 0.75), ($s * 0.48), ($s * 0.065), ($s * 0.065))

  $star = [System.Drawing.PointF[]]@(
    (New-PointF ($s * 0.70) ($s * 0.21)),
    (New-PointF ($s * 0.725) ($s * 0.275)),
    (New-PointF ($s * 0.79) ($s * 0.285)),
    (New-PointF ($s * 0.745) ($s * 0.33)),
    (New-PointF ($s * 0.755) ($s * 0.395)),
    (New-PointF ($s * 0.70) ($s * 0.365)),
    (New-PointF ($s * 0.645) ($s * 0.395)),
    (New-PointF ($s * 0.655) ($s * 0.33)),
    (New-PointF ($s * 0.61) ($s * 0.285)),
    (New-PointF ($s * 0.675) ($s * 0.275))
  )
  $graphics.FillPolygon($cyan, $star)

  $bookmarkBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#f8d86a"))
  $graphics.FillPolygon($bookmarkBrush, [System.Drawing.PointF[]]@(
    (New-PointF ($s * 0.655) ($s * 0.48)),
    (New-PointF ($s * 0.725) ($s * 0.455)),
    (New-PointF ($s * 0.785) ($s * 0.475)),
    (New-PointF ($s * 0.785) ($s * 0.67)),
    (New-PointF ($s * 0.72) ($s * 0.65)),
    (New-PointF ($s * 0.655) ($s * 0.67))
  ))

  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)

  $graphics.Dispose()
  $bitmap.Dispose()
  $bgBrush.Dispose()
}

function Write-Ico {
  param(
    [int[]]$Sizes,
    [string]$OutPath
  )

  $images = @()
  foreach ($size in $Sizes) {
    $pngPath = Join-Path $pngDir "icon-$size.png"
    Draw-Logo -Size $size -Path $pngPath
    $images += [pscustomobject]@{
      Size = $size
      Bytes = [System.IO.File]::ReadAllBytes($pngPath)
    }
  }

  $stream = [System.IO.File]::Create($OutPath)
  $writer = [System.IO.BinaryWriter]::new($stream)
  try {
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$images.Count)

    $offset = 6 + (16 * $images.Count)
    foreach ($image in $images) {
      $sizeByte = if ($image.Size -ge 256) { 0 } else { $image.Size }
      $writer.Write([byte]$sizeByte)
      $writer.Write([byte]$sizeByte)
      $writer.Write([byte]0)
      $writer.Write([byte]0)
      $writer.Write([UInt16]1)
      $writer.Write([UInt16]32)
      $writer.Write([UInt32]$image.Bytes.Length)
      $writer.Write([UInt32]$offset)
      $offset += $image.Bytes.Length
    }

    foreach ($image in $images) {
      $writer.Write($image.Bytes)
    }
  } finally {
    $writer.Dispose()
    $stream.Dispose()
  }
}

Draw-Logo -Size 1024 -Path (Join-Path $outDir "icon.png")
Write-Ico -Sizes @(16, 24, 32, 48, 64, 128, 256) -OutPath (Join-Path $outDir "icon.ico")

Write-Host "Generated icon assets in $outDir"

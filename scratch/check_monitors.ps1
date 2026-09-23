Add-Type -AssemblyName System.Drawing
$names = @('monitor_front', 'monitor_back', 'monitor_left', 'monitor_right')
foreach ($name in $names) {
    $path = "c:\Proyectos\Juegos\doors\src\assets\$name.png"
    $bmp = [System.Drawing.Bitmap]::FromFile($path)
    $minX = 9999; $maxX = -1; $minY = 9999; $maxY = -1
    $footMinX = 9999; $footMaxX = -1
    for ($y = 0; $y -lt $bmp.Height; $y++) {
        for ($x = 0; $x -lt $bmp.Width; $x++) {
            $c = $bmp.GetPixel($x, $y)
            if ($c.A -gt 25) {
                if ($x -lt $minX) { $minX = $x }
                if ($x -gt $maxX) { $maxX = $x }
                if ($y -lt $minY) { $minY = $y }
                if ($y -gt $maxY) { $maxY = $y }
                if ($y -gt ($bmp.Height * 0.85)) {
                    if ($x -lt $footMinX) { $footMinX = $x }
                    if ($x -gt $footMaxX) { $footMaxX = $x }
                }
            }
        }
    }
    $footCenter = ($footMinX + $footMaxX) / 2
    $imgCenter = $bmp.Width / 2
    Write-Output "$name : W=$($bmp.Width), H=$($bmp.Height), X=[$minX, $maxX], Y=[$minY, $maxY], FootX=[$footMinX, $footMaxX], FootCenter=$footCenter, ImgCenter=$imgCenter, bottomPadding=$($bmp.Height - 1 - $maxY)"
    $bmp.Dispose()
}

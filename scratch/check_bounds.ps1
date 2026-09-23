Add-Type -AssemblyName System.Drawing

$names = @('char_front', 'char_back', 'char_left', 'char_right')
foreach ($name in $names) {
    $path = "c:\Proyectos\Juegos\doors\src\assets\$name.png"
    $bmp = [System.Drawing.Bitmap]::FromFile($path)
    $minX = 9999; $maxX = -1; $minY = 9999; $maxY = -1
    for ($y = 0; $y -lt $bmp.Height; $y++) {
        for ($x = 0; $x -lt $bmp.Width; $x++) {
            $c = $bmp.GetPixel($x, $y)
            if ($c.A -gt 15) {
                if ($x -lt $minX) { $minX = $x }
                if ($x -gt $maxX) { $maxX = $x }
                if ($y -lt $minY) { $minY = $y }
                if ($y -gt $maxY) { $maxY = $y }
            }
        }
    }
    Write-Output "$name : W=$($bmp.Width), H=$($bmp.Height), X=[$minX, $maxX], Y=[$minY, $maxY], bottomPadding=$($bmp.Height - 1 - $maxY)"
    $bmp.Dispose()
}

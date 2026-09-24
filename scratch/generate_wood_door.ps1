Add-Type -AssemblyName System.Drawing

function Create-WoodDoor {
    param([string]$path)
    $w = 64
    $h = 128
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor

    # 4 Vertical wood planks
    $plankColors = @(
        [System.Drawing.Color]::FromArgb(255, 115, 73, 41),   # #734929
        [System.Drawing.Color]::FromArgb(255, 126, 81, 46),   # #7e512e
        [System.Drawing.Color]::FromArgb(255, 107, 67, 37),   # #6b4325
        [System.Drawing.Color]::FromArgb(255, 119, 76, 43)    # #774c2b
    )

    for ($i = 0; $i -lt 4; $i++) {
        $px = $i * 16
        $brush = New-Object System.Drawing.SolidBrush($plankColors[$i])
        $g.FillRectangle($brush, $px, 0, 16, $h)
        $brush.Dispose()
    }

    # Wood grain streaks (deterministic pseudo-random)
    $rnd = New-Object System.Random(1337)
    for ($x = 0; $x -lt $w; $x++) {
        $pIndex = [Math]::Floor($x / 16)
        $base = $plankColors[$pIndex]
        for ($y = 0; $y -lt $h; $y++) {
            $grain = ($rnd.Next(-14, 15)) + ([Math]::Sin($y * 0.15 + $x * 0.4) * 8)
            $r = [Math]::Max(40, [Math]::Min(165, $base.R + [int]$grain))
            $gCol = [Math]::Max(25, [Math]::Min(115, $base.G + [int]($grain * 0.75)))
            $b = [Math]::Max(12, [Math]::Min(75, $base.B + [int]($grain * 0.55)))
            $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(255, $r, $gCol, $b))
        }
    }

    # Plank separator grooves (at x=15, 31, 47)
    $darkGroove = [System.Drawing.Color]::FromArgb(255, 36, 20, 10)
    $lightGroove = [System.Drawing.Color]::FromArgb(255, 145, 96, 56)
    foreach ($gx in @(15, 31, 47)) {
        for ($y = 0; $y -lt $h; $y++) {
            $bmp.SetPixel($gx, $y, $darkGroove)
            if ($gx + 1 -lt $w) {
                # subtle edge highlight on adjacent plank
                $old = $bmp.GetPixel($gx + 1, $y)
                $nr = [Math]::Min(255, $old.R + 25)
                $ng = [Math]::Min(255, $old.G + 18)
                $nb = [Math]::Min(255, $old.B + 12)
                $bmp.SetPixel($gx + 1, $y, [System.Drawing.Color]::FromArgb(255, $nr, $ng, $nb))
            }
        }
    }

    # Outer perimeter shadow
    for ($x = 0; $x -lt $w; $x++) {
        $bmp.SetPixel($x, 0, $darkGroove)
        $bmp.SetPixel($x, 1, [System.Drawing.Color]::FromArgb(255, 45, 26, 14))
        $bmp.SetPixel($x, $h - 1, $darkGroove)
        $bmp.SetPixel($x, $h - 2, [System.Drawing.Color]::FromArgb(255, 45, 26, 14))
    }
    for ($y = 0; $y -lt $h; $y++) {
        $bmp.SetPixel(0, $y, $darkGroove)
        $bmp.SetPixel(1, $y, [System.Drawing.Color]::FromArgb(255, 45, 26, 14))
        $bmp.SetPixel($w - 1, $y, $darkGroove)
        $bmp.SetPixel($w - 2, $y, [System.Drawing.Color]::FromArgb(255, 45, 26, 14))
    }

    # Forged iron straps (herrajes de forja oscura)
    # Upper strap: y=18..26, Lower strap: y=98..106
    $ironBody = [System.Drawing.Color]::FromArgb(255, 36, 40, 46)
    $ironLight = [System.Drawing.Color]::FromArgb(255, 75, 83, 96)
    $ironDark = [System.Drawing.Color]::FromArgb(255, 16, 18, 22)
    $ironRivet = [System.Drawing.Color]::FromArgb(255, 140, 150, 170)
    $ironRivetDark = [System.Drawing.Color]::FromArgb(255, 10, 11, 14)

    foreach ($strapY in @(18, 98)) {
        # Shadow underneath strap
        for ($x = 2; $x -lt $w - 2; $x++) {
            $bmp.SetPixel($x, $strapY + 8, [System.Drawing.Color]::FromArgb(255, 25, 15, 8))
        }
        # Strap body
        for ($sy = 0; $sy -lt 8; $sy++) {
            $y = $strapY + $sy
            for ($x = 2; $x -lt $w - 2; $x++) {
                if ($sy -eq 0) {
                    $bmp.SetPixel($x, $y, $ironLight)
                } elseif ($sy -eq 7) {
                    $bmp.SetPixel($x, $y, $ironDark)
                } else {
                    $bmp.SetPixel($x, $y, $ironBody)
                }
            }
        }
        # Strap tips (arrow/tapered points at sides)
        $bmp.SetPixel(1, $strapY + 3, $ironBody)
        $bmp.SetPixel(1, $strapY + 4, $ironBody)
        $bmp.SetPixel($w - 2, $strapY + 3, $ironBody)
        $bmp.SetPixel($w - 2, $strapY + 4, $ironBody)

        # Rivets on each plank center (x = 8, 24, 40, 56)
        foreach ($rx in @(8, 24, 40, 56)) {
            $bmp.SetPixel($rx, $strapY + 2, $ironRivet)
            $bmp.SetPixel($rx + 1, $strapY + 2, $ironRivet)
            $bmp.SetPixel($rx, $strapY + 3, $ironBody)
            $bmp.SetPixel($rx + 1, $strapY + 3, $ironRivetDark)
            $bmp.SetPixel($rx, $strapY + 4, $ironRivetDark)
            $bmp.SetPixel($rx + 1, $strapY + 4, $ironRivetDark)
        }
    }

    # Medieval Ornate Brass Handle & Escutcheon Plate (Tirador dorado / picaporte)
    # Plate: x=46..54, y=56..76
    $brassLight = [System.Drawing.Color]::FromArgb(255, 235, 195, 75)
    $brassMid = [System.Drawing.Color]::FromArgb(255, 195, 150, 40)
    $brassDark = [System.Drawing.Color]::FromArgb(255, 120, 90, 20)
    $keyhole = [System.Drawing.Color]::FromArgb(255, 15, 10, 5)

    # Plate shadow
    for ($py = 56; $py -le 77; $py++) {
        $bmp.SetPixel(55, $py, [System.Drawing.Color]::FromArgb(255, 25, 15, 8))
    }
    for ($px = 46; $px -le 55; $px++) {
        $bmp.SetPixel($px, 77, [System.Drawing.Color]::FromArgb(255, 25, 15, 8))
    }

    for ($py = 56; $py -le 76; $py++) {
        for ($px = 46; $px -le 54; $px++) {
            # Beveled edges
            if ($px -eq 46 -or $py -eq 56) {
                $bmp.SetPixel($px, $py, $brassLight)
            } elseif ($px -eq 54 -or $py -eq 76) {
                $bmp.SetPixel($px, $py, $brassDark)
            } else {
                $bmp.SetPixel($px, $py, $brassMid)
            }
        }
    }
    # Escutcheon screws top/bottom
    $bmp.SetPixel(50, 58, $brassDark)
    $bmp.SetPixel(50, 74, $brassDark)

    # Keyhole
    $bmp.SetPixel(50, 68, $keyhole)
    $bmp.SetPixel(50, 69, $keyhole)
    $bmp.SetPixel(50, 70, $keyhole)
    $bmp.SetPixel(49, 70, $keyhole)
    $bmp.SetPixel(51, 70, $keyhole)

    # Door Handle lever (Manilla / tirador)
    # Base spindle at x=50, y=62
    $handleHigh = [System.Drawing.Color]::FromArgb(255, 255, 230, 130)
    $handleMid = [System.Drawing.Color]::FromArgb(255, 215, 170, 50)
    $handleShadow = [System.Drawing.Color]::FromArgb(255, 30, 20, 8)

    # Lever extending left from spindle (x = 38 to 50, y = 62..64)
    for ($hx = 38; $hx -le 50; $hx++) {
        $bmp.SetPixel($hx, 62, $handleHigh)
        $bmp.SetPixel($hx, 63, $handleMid)
        $bmp.SetPixel($hx, 64, $brassDark)
        $bmp.SetPixel($hx, 65, $handleShadow)
    }
    # Handle end knob
    $bmp.SetPixel(37, 62, $handleMid)
    $bmp.SetPixel(37, 63, $handleHigh)
    $bmp.SetPixel(37, 64, $handleMid)

    $g.Dispose()
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

Create-WoodDoor "c:\Proyectos\Juegos\doors\src\engine\textures\doors\castillo.png"
Write-Host "Generated castillo.png successfully"

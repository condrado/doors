Add-Type -AssemblyName System.Drawing

function Generate-AllDoorTextures {
    $doorsDir = "c:\Proyectos\Juegos\doors\src\engine\textures\doors"
    if (-not (Test-Path $doorsDir)) {
        New-Item -ItemType Directory -Path $doorsDir -Force | Out-Null
    }

    # =========================================================================
    # 1. CASTILLO: Rústica de madera maciza con herrajes de forja y picaporte
    # =========================================================================
    $w = 64
    $h = 128
    $bmpCastillo = New-Object System.Drawing.Bitmap($w, $h)
    $gCastillo = [System.Drawing.Graphics]::FromImage($bmpCastillo)
    $gCastillo.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None

    $plankColors = @(
        [System.Drawing.Color]::FromArgb(255, 115, 73, 41),   # #734929
        [System.Drawing.Color]::FromArgb(255, 126, 81, 46),   # #7e512e
        [System.Drawing.Color]::FromArgb(255, 107, 67, 37),   # #6b4325
        [System.Drawing.Color]::FromArgb(255, 119, 76, 43)    # #774c2b
    )

    $rnd = New-Object System.Random(1337)
    for ($x = 0; $x -lt $w; $x++) {
        $pIndex = [Math]::Floor($x / 16)
        $base = $plankColors[$pIndex]
        for ($y = 0; $y -lt $h; $y++) {
            $grain = ($rnd.Next(-14, 15)) + ([Math]::Sin($y * 0.15 + $x * 0.4) * 7)
            $r = [Math]::Max(35, [Math]::Min(165, $base.R + [int]$grain))
            $gCol = [Math]::Max(22, [Math]::Min(115, $base.G + [int]($grain * 0.72)))
            $b = [Math]::Max(10, [Math]::Min(75, $base.B + [int]($grain * 0.52)))
            $bmpCastillo.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(255, $r, $gCol, $b))
        }
    }

    $darkGroove = [System.Drawing.Color]::FromArgb(255, 32, 18, 9)
    foreach ($gx in @(15, 31, 47)) {
        for ($y = 0; $y -lt $h; $y++) {
            $bmpCastillo.SetPixel($gx, $y, $darkGroove)
            if ($gx + 1 -lt $w) {
                $old = $bmpCastillo.GetPixel($gx + 1, $y)
                $nr = [Math]::Min(255, $old.R + 25)
                $ng = [Math]::Min(255, $old.G + 18)
                $nb = [Math]::Min(255, $old.B + 12)
                $bmpCastillo.SetPixel($gx + 1, $y, [System.Drawing.Color]::FromArgb(255, $nr, $ng, $nb))
            }
        }
    }

    # Outer perimeter shadow
    for ($x = 0; $x -lt $w; $x++) {
        $bmpCastillo.SetPixel($x, 0, $darkGroove)
        $bmpCastillo.SetPixel($x, 1, [System.Drawing.Color]::FromArgb(255, 45, 25, 12))
        $bmpCastillo.SetPixel($x, $h - 1, $darkGroove)
        $bmpCastillo.SetPixel($x, $h - 2, [System.Drawing.Color]::FromArgb(255, 45, 25, 12))
    }
    for ($y = 0; $y -lt $h; $y++) {
        $bmpCastillo.SetPixel(0, $y, $darkGroove)
        $bmpCastillo.SetPixel(1, $y, [System.Drawing.Color]::FromArgb(255, 45, 25, 12))
        $bmpCastillo.SetPixel($w - 1, $y, $darkGroove)
        $bmpCastillo.SetPixel($w - 2, $y, [System.Drawing.Color]::FromArgb(255, 45, 25, 12))
    }

    # Forged iron straps
    $ironBody = [System.Drawing.Color]::FromArgb(255, 36, 40, 46)
    $ironLight = [System.Drawing.Color]::FromArgb(255, 75, 83, 96)
    $ironDark = [System.Drawing.Color]::FromArgb(255, 16, 18, 22)
    $ironRivet = [System.Drawing.Color]::FromArgb(255, 140, 150, 170)
    $ironRivetDark = [System.Drawing.Color]::FromArgb(255, 10, 11, 14)

    foreach ($strapY in @(18, 98)) {
        for ($x = 2; $x -lt $w - 2; $x++) {
            $bmpCastillo.SetPixel($x, $strapY + 8, [System.Drawing.Color]::FromArgb(255, 25, 15, 8))
        }
        for ($sy = 0; $sy -lt 8; $sy++) {
            $y = $strapY + $sy
            for ($x = 2; $x -lt $w - 2; $x++) {
                if ($sy -eq 0) {
                    $bmpCastillo.SetPixel($x, $y, $ironLight)
                } elseif ($sy -eq 7) {
                    $bmpCastillo.SetPixel($x, $y, $ironDark)
                } else {
                    $bmpCastillo.SetPixel($x, $y, $ironBody)
                }
            }
        }
        $bmpCastillo.SetPixel(1, $strapY + 3, $ironBody)
        $bmpCastillo.SetPixel(1, $strapY + 4, $ironBody)
        $bmpCastillo.SetPixel($w - 2, $strapY + 3, $ironBody)
        $bmpCastillo.SetPixel($w - 2, $strapY + 4, $ironBody)

        foreach ($rx in @(8, 24, 40, 56)) {
            $bmpCastillo.SetPixel($rx, $strapY + 2, $ironRivet)
            $bmpCastillo.SetPixel($rx + 1, $strapY + 2, $ironRivet)
            $bmpCastillo.SetPixel($rx, $strapY + 3, $ironBody)
            $bmpCastillo.SetPixel($rx + 1, $strapY + 3, $ironRivetDark)
            $bmpCastillo.SetPixel($rx, $strapY + 4, $ironRivetDark)
            $bmpCastillo.SetPixel($rx + 1, $strapY + 4, $ironRivetDark)
        }
    }

    # Medieval Ornate Brass Handle & Escutcheon Plate
    $brassLight = [System.Drawing.Color]::FromArgb(255, 235, 195, 75)
    $brassMid = [System.Drawing.Color]::FromArgb(255, 195, 150, 40)
    $brassDark = [System.Drawing.Color]::FromArgb(255, 120, 90, 20)
    $keyhole = [System.Drawing.Color]::FromArgb(255, 15, 10, 5)

    for ($py = 56; $py -le 77; $py++) {
        $bmpCastillo.SetPixel(55, $py, [System.Drawing.Color]::FromArgb(255, 25, 15, 8))
    }
    for ($px = 46; $px -le 55; $px++) {
        $bmpCastillo.SetPixel($px, 77, [System.Drawing.Color]::FromArgb(255, 25, 15, 8))
    }

    for ($py = 56; $py -le 76; $py++) {
        for ($px = 46; $px -le 54; $px++) {
            if ($px -eq 46 -or $py -eq 56) {
                $bmpCastillo.SetPixel($px, $py, $brassLight)
            } elseif ($px -eq 54 -or $py -eq 76) {
                $bmpCastillo.SetPixel($px, $py, $brassDark)
            } else {
                $bmpCastillo.SetPixel($px, $py, $brassMid)
            }
        }
    }
    $bmpCastillo.SetPixel(50, 58, $brassDark)
    $bmpCastillo.SetPixel(50, 74, $brassDark)
    $bmpCastillo.SetPixel(50, 68, $keyhole)
    $bmpCastillo.SetPixel(50, 69, $keyhole)
    $bmpCastillo.SetPixel(50, 70, $keyhole)
    $bmpCastillo.SetPixel(49, 70, $keyhole)
    $bmpCastillo.SetPixel(51, 70, $keyhole)

    $handleHigh = [System.Drawing.Color]::FromArgb(255, 255, 230, 130)
    $handleMid = [System.Drawing.Color]::FromArgb(255, 215, 170, 50)
    $handleShadow = [System.Drawing.Color]::FromArgb(255, 30, 20, 8)

    for ($hx = 38; $hx -le 50; $hx++) {
        $bmpCastillo.SetPixel($hx, 62, $handleHigh)
        $bmpCastillo.SetPixel($hx, 63, $handleMid)
        $bmpCastillo.SetPixel($hx, 64, $brassDark)
        $bmpCastillo.SetPixel($hx, 65, $handleShadow)
    }
    $bmpCastillo.SetPixel(37, 62, $handleMid)
    $bmpCastillo.SetPixel(37, 63, $handleHigh)
    $bmpCastillo.SetPixel(37, 64, $handleMid)

    $gCastillo.Dispose()
    $bmpCastillo.Save("$doorsDir\castillo.png", [System.Drawing.Imaging.ImageFormat]::Png)
    $bmpCastillo.Dispose()
    Write-Host "Generated $doorsDir\castillo.png"


    # =========================================================================
    # 2. BLANCA: Oficina moderna con relieve 3D (cuarterones biselados)
    # =========================================================================
    $bmpBlanca = New-Object System.Drawing.Bitmap($w, $h)
    $gBlanca = [System.Drawing.Graphics]::FromImage($bmpBlanca)

    # Base subtle vertical gradient (off-white)
    for ($y = 0; $y -lt $h; $y++) {
        $ratio = $y / ($h - 1)
        $val = [int](245 - ($ratio * 14)) # 245 -> 231
        $rowColor = [System.Drawing.Color]::FromArgb(255, $val, $val + 1, $val + 3)
        for ($x = 0; $x -lt $w; $x++) {
            # subtle noise
            $n = $rnd.Next(-2, 3)
            $r = [Math]::Max(0, [Math]::Min(255, $rowColor.R + $n))
            $gCol = [Math]::Max(0, [Math]::Min(255, $rowColor.G + $n))
            $b = [Math]::Max(0, [Math]::Min(255, $rowColor.B + $n))
            $bmpBlanca.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(255, $r, $gCol, $b))
        }
    }

    # Outer border shadow
    $whiteEdgeShadow = [System.Drawing.Color]::FromArgb(255, 175, 180, 190)
    for ($x = 0; $x -lt $w; $x++) {
        $bmpBlanca.SetPixel($x, 0, $whiteEdgeShadow)
        $bmpBlanca.SetPixel($x, $h - 1, $whiteEdgeShadow)
    }
    for ($y = 0; $y -lt $h; $y++) {
        $bmpBlanca.SetPixel(0, $y, $whiteEdgeShadow)
        $bmpBlanca.SetPixel($w - 1, $y, $whiteEdgeShadow)
    }

    # Helper function to draw molded panels with 3D beveled frame
    $panelShadowOuter = [System.Drawing.Color]::FromArgb(255, 150, 156, 168)
    $panelShadowInner = [System.Drawing.Color]::FromArgb(255, 185, 190, 200)
    $panelHighlightOuter = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)
    $panelHighlightInner = [System.Drawing.Color]::FromArgb(255, 250, 252, 255)
    $panelCenterBase = [System.Drawing.Color]::FromArgb(255, 228, 232, 238)

    $panels = @(
        @{ X = 8; Y = 10; W = 48; H = 45 },
        @{ X = 8; Y = 68; W = 48; H = 50 }
    )

    foreach ($p in $panels) {
        $px0 = $p.X; $px1 = $p.X + $p.W - 1
        $py0 = $p.Y; $py1 = $p.Y + $p.H - 1

        # Step 1: Outer recess groove (depth shadow top/left, highlight bottom/right)
        for ($x = $px0; $x -le $px1; $x++) {
            $bmpBlanca.SetPixel($x, $py0, $panelShadowOuter)
            $bmpBlanca.SetPixel($x, $py0 + 1, $panelShadowInner)
            $bmpBlanca.SetPixel($x, $py1 - 1, $panelHighlightInner)
            $bmpBlanca.SetPixel($x, $py1, $panelHighlightOuter)
        }
        for ($y = $py0; $y -le $py1; $y++) {
            $bmpBlanca.SetPixel($px0, $y, $panelShadowOuter)
            $bmpBlanca.SetPixel($px0 + 1, $y, $panelShadowInner)
            $bmpBlanca.SetPixel($px1 - 1, $y, $panelHighlightInner)
            $bmpBlanca.SetPixel($px1, $y, $panelHighlightOuter)
        }

        # Step 2: Inner molded field (inset by 4)
        $ix0 = $px0 + 4; $ix1 = $px1 - 4
        $iy0 = $py0 + 4; $iy1 = $py1 - 4

        for ($y = $iy0; $y -le $iy1; $y++) {
            for ($x = $ix0; $x -le $ix1; $x++) {
                if ($x -eq $ix0 -or $y -eq $iy0) {
                    $bmpBlanca.SetPixel($x, $y, $panelHighlightOuter)
                } elseif ($x -eq $ix1 -or $y -eq $iy1) {
                    $bmpBlanca.SetPixel($x, $y, $panelShadowInner)
                } else {
                    $n = $rnd.Next(-1, 2)
                    $bmpBlanca.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(255, $panelCenterBase.R + $n, $panelCenterBase.G + $n, $panelCenterBase.B + $n))
                }
            }
        }
    }

    # Modern Brushed Stainless Steel Lever Handle
    # Rosette / base plate at x=48..53, y=58..66
    $steelDark = [System.Drawing.Color]::FromArgb(255, 90, 95, 105)
    $steelMid = [System.Drawing.Color]::FromArgb(255, 170, 176, 186)
    $steelLight = [System.Drawing.Color]::FromArgb(255, 235, 240, 248)
    $steelHigh = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)

    for ($ry = 58; $ry -le 66; $ry++) {
        for ($rx = 48; $rx -le 53; $rx++) {
            if ($rx -eq 48 -or $ry -eq 58) {
                $bmpBlanca.SetPixel($rx, $ry, $steelHigh)
            } elseif ($rx -eq 53 -or $ry -eq 66) {
                $bmpBlanca.SetPixel($rx, $ry, $steelDark)
            } else {
                $bmpBlanca.SetPixel($rx, $ry, $steelMid)
            }
        }
    }

    # Horizontal lever handle extending to the left: x = 38 to 50, y = 61..63
    for ($hx = 38; $hx -le 50; $hx++) {
        $bmpBlanca.SetPixel($hx, 61, $steelHigh)
        $bmpBlanca.SetPixel($hx, 62, $steelLight)
        $bmpBlanca.SetPixel($hx, 63, $steelDark)
        $bmpBlanca.SetPixel($hx, 64, [System.Drawing.Color]::FromArgb(255, 140, 145, 155))
    }
    # Handle rounded end
    $bmpBlanca.SetPixel(37, 61, $steelLight)
    $bmpBlanca.SetPixel(37, 62, $steelHigh)
    $bmpBlanca.SetPixel(37, 63, $steelDark)

    $gBlanca.Dispose()
    $bmpBlanca.Save("$doorsDir\blanca.png", [System.Drawing.Imaging.ImageFormat]::Png)
    $bmpBlanca.Dispose()
    Write-Host "Generated $doorsDir\blanca.png"


    # =========================================================================
    # 3. NEGRA: Ejecutiva de grafito mate con incrustaciones metálicas horizontales
    # =========================================================================
    $bmpNegra = New-Object System.Drawing.Bitmap($w, $h)
    $gNegra = [System.Drawing.Graphics]::FromImage($bmpNegra)

    # Base dark graphite vertical gradient
    for ($y = 0; $y -lt $h; $y++) {
        $ratio = $y / ($h - 1)
        $val = [int](26 - ($ratio * 12)) # 26 -> 14
        for ($x = 0; $x -lt $w; $x++) {
            $n = $rnd.Next(-2, 3)
            $r = [Math]::Max(8, [Math]::Min(50, $val + $n))
            $gCol = [Math]::Max(9, [Math]::Min(52, $val + 1 + $n))
            $b = [Math]::Max(12, [Math]::Min(58, $val + 3 + $n))
            $bmpNegra.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(255, $r, $gCol, $b))
        }
    }

    # Outer perimeter bevel
    $blackEdgeDark = [System.Drawing.Color]::FromArgb(255, 8, 9, 12)
    $blackEdgeLight = [System.Drawing.Color]::FromArgb(255, 45, 48, 56)
    for ($x = 0; $x -lt $w; $x++) {
        $bmpNegra.SetPixel($x, 0, $blackEdgeLight)
        $bmpNegra.SetPixel($x, $h - 1, $blackEdgeDark)
    }
    for ($y = 0; $y -lt $h; $y++) {
        $bmpNegra.SetPixel(0, $y, $blackEdgeLight)
        $bmpNegra.SetPixel($w - 1, $y, $blackEdgeDark)
    }

    # 4 Sleek horizontal brushed metallic inlays (aluminio cepillado)
    $metalHigh = [System.Drawing.Color]::FromArgb(255, 230, 235, 245)
    $metalMid = [System.Drawing.Color]::FromArgb(255, 160, 168, 180)
    $metalShadow = [System.Drawing.Color]::FromArgb(255, 50, 54, 62)
    $stripYCoords = @(22, 46, 82, 106)

    foreach ($sy in $stripYCoords) {
        # Metal strip 2px high from x=4 to w-5
        for ($x = 4; $x -lt $w - 4; $x++) {
            $bmpNegra.SetPixel($x, $sy - 1, [System.Drawing.Color]::FromArgb(255, 10, 11, 14)) # groove shadow top
            $bmpNegra.SetPixel($x, $sy, $metalHigh)                                           # bright reflection
            $bmpNegra.SetPixel($x, $sy + 1, $metalMid)                                        # metallic body
            $bmpNegra.SetPixel($x, $sy + 2, $metalShadow)                                     # bottom shadow
        }
    }

    # Luxury Brushed Chrome / Steel Lever Handle
    # Contemporary rectangular rosette at x=48..53, y=58..66
    for ($ry = 58; $ry -le 66; $ry++) {
        for ($rx = 48; $rx -le 53; $rx++) {
            if ($rx -eq 48 -or $ry -eq 58) {
                $bmpNegra.SetPixel($rx, $ry, $metalHigh)
            } elseif ($rx -eq 53 -or $ry -eq 66) {
                $bmpNegra.SetPixel($rx, $ry, [System.Drawing.Color]::FromArgb(255, 20, 22, 26))
            } else {
                $bmpNegra.SetPixel($rx, $ry, $metalMid)
            }
        }
    }

    # Horizontal handle extending left: x=38..50, y=61..63
    for ($hx = 38; $hx -le 50; $hx++) {
        $bmpNegra.SetPixel($hx, 61, $metalHigh)
        $bmpNegra.SetPixel($hx, 62, [System.Drawing.Color]::FromArgb(255, 200, 208, 220))
        $bmpNegra.SetPixel($hx, 63, $metalShadow)
        $bmpNegra.SetPixel($hx, 64, [System.Drawing.Color]::FromArgb(255, 12, 13, 16))
    }
    $bmpNegra.SetPixel(37, 61, $metalMid)
    $bmpNegra.SetPixel(37, 62, $metalHigh)
    $bmpNegra.SetPixel(37, 63, $metalShadow)

    $gNegra.Dispose()
    $bmpNegra.Save("$doorsDir\negra.png", [System.Drawing.Imaging.ImageFormat]::Png)
    $bmpNegra.Dispose()
    Write-Host "Generated $doorsDir\negra.png"
}

Generate-AllDoorTextures

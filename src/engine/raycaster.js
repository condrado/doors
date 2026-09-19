/**
 * Motor Raycaster 2.5D Clásico (Estilo Wolfenstein 3D / Doom)
 * Desarrollado con Canvas 2D y algoritmos DDA puros.
 */

class RaycasterEngine {
  constructor(canvas, minimapCanvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.minimapCanvas = minimapCanvas;
    this.minimapCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;

    // Configuración de renderizado
    this.width = canvas.width;
    this.height = canvas.height;
    this.halfHeight = Math.floor(this.height / 2);
    this.textureSize = 64; // 64x64 px por textura
    this.textureMode = 'classic'; // 'classic' o 'flat'

    // Mapa de la sala: 7x7 celdas
    // 0: Vacío / Suelo
    // 1: Muro de piedra
    // 2: Puerta Norte (N)
    // 3: Puerta Este (E)
    // 4: Puerta Sur (S)
    // 5: Puerta Oeste (O)
    this.map = [
      [1, 1, 1, 2, 1, 1, 1],
      [1, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 1],
      [5, 0, 0, 0, 0, 0, 3],
      [1, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 1],
      [1, 1, 1, 4, 1, 1, 1]
    ];
    this.mapWidth = this.map[0].length;
    this.mapHeight = this.map.length;

    // Definición de las puertas
    this.doorInfo = {
      2: { name: 'Puerta Norte [N]', color: '#e74c3c', rune: 'N' },
      3: { name: 'Puerta Este [E]',  color: '#2ecc71', rune: 'E' },
      4: { name: 'Puerta Sur [S]',   color: '#3498db', rune: 'S' },
      5: { name: 'Puerta Oeste [O]', color: '#f39c12', rune: 'O' }
    };

    // Buffer de imagen para renderizado rápido por píxel
    this.imgData = this.ctx.createImageData(this.width, this.height);
    this.pixels = new Uint32Array(this.imgData.data.buffer);

    // Generar texturas procedurales (sin depender de imágenes externas)
    this.textures = {};
    this.generateProceduralTextures();

    // Objeto frente al jugador (actualizado en cada frame)
    this.facingTarget = { name: 'Pared de piedra', type: 'wall', distance: 0 };
  }

  /**
   * Obtiene la lista de segmentos de tabique fino (5x1) y puertas en una celda
   * Posiciones: 'N' (Norte), 'S' (Sur), 'E' (Este), 'W' (Oeste), 'CH' (Centro Horiz), 'CV' (Centro Vert)
   */
  getCellCodes(mapX, mapY) {
    if (mapY < 0 || mapY >= this.mapHeight || mapX < 0 || mapX >= this.mapWidth) return [];
    const cell = this.map[mapY][mapX];
    if (!cell || cell === 0) return [];
    if (Array.isArray(cell)) return cell;
    if (cell === 1) return ['N', 'S', 'E', 'W'];
    if (cell >= 2 && cell <= 5) {
      return [(cell === 2) ? 'DN' : (cell === 3) ? 'DE' : (cell === 4) ? 'DS' : 'DW'];
    }
    return [];
  }

  /**
   * Obtiene la lista de caras 3D de volumen sólido (espesor 5x1 = 0.20) y puertas en una celda
   */
  getCellSegments(mapX, mapY) {
    const codes = this.getCellCodes(mapX, mapY);
    return this.generateCellFaces(codes, mapX, mapY);
  }

  /**
   * Genera las caras 3D de volumen sólido (con grosor 5x1 = 0.20 de profundidad)
   * para tabiques, esquinas, rincones en L y puertas.
   */
  generateCellFaces(codes, mapX, mapY) {
    if (!codes || codes.length === 0) return [];

    const faces = [];
    const x0 = mapX;
    const x1 = mapX + 1.0;
    const y0 = mapY;
    const y1 = mapY + 1.0;

    const cxA = mapX + 0.40;
    const cxB = mapX + 0.60;
    const cyA = mapY + 0.40;
    const cyB = mapY + 0.60;

    const nyA = mapY;
    const nyB = mapY + 0.20;
    const syA = mapY + 0.80;
    const syB = mapY + 1.0;
    const wxA = mapX;
    const wxB = mapX + 0.20;
    const exA = mapX + 0.80;
    const exB = mapX + 1.0;

    const has = (c) => codes.includes(c);

    // 1. RINCONES EN EL CENTRO (EN FORMA DE L CON GROSOR 0.20)
    // -------------------------------------------------------------
    if (has('CN') && has('CW')) { // Rincón Centro Noroeste ┌
      faces.push(
        { axis: 'x', pos: cxB, minY: y0, maxY: cyB, type: 1, name: 'Rincón (Exterior Este)' },
        { axis: 'y', pos: cyB, minX: x0, maxX: cxB, type: 1, name: 'Rincón (Exterior Sur)' },
        { axis: 'x', pos: cxA, minY: y0, maxY: cyA, type: 1, name: 'Rincón (Interior Oeste)' },
        { axis: 'y', pos: cyA, minX: x0, maxX: cxA, type: 1, name: 'Rincón (Interior Norte)' },
        { axis: 'y', pos: y0, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Norte' },
        { axis: 'x', pos: x0, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Oeste' }
      );
      return faces;
    }

    if (has('CN') && has('CE')) { // Rincón Centro Noreste ┐
      faces.push(
        { axis: 'x', pos: cxA, minY: y0, maxY: cyB, type: 1, name: 'Rincón (Exterior Oeste)' },
        { axis: 'y', pos: cyB, minX: cxA, maxX: x1, type: 1, name: 'Rincón (Exterior Sur)' },
        { axis: 'x', pos: cxB, minY: y0, maxY: cyA, type: 1, name: 'Rincón (Interior Este)' },
        { axis: 'y', pos: cyA, minX: cxB, maxX: x1, type: 1, name: 'Rincón (Interior Norte)' },
        { axis: 'y', pos: y0, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Norte' },
        { axis: 'x', pos: x1, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Este' }
      );
      return faces;
    }

    if (has('CS') && has('CW')) { // Rincón Centro Suroeste └
      faces.push(
        { axis: 'x', pos: cxB, minY: cyA, maxY: y1, type: 1, name: 'Rincón (Exterior Este)' },
        { axis: 'y', pos: cyA, minX: x0, maxX: cxB, type: 1, name: 'Rincón (Exterior Norte)' },
        { axis: 'x', pos: cxA, minY: cyB, maxY: y1, type: 1, name: 'Rincón (Interior Oeste)' },
        { axis: 'y', pos: cyB, minX: x0, maxX: cxA, type: 1, name: 'Rincón (Interior Sur)' },
        { axis: 'y', pos: y1, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Sur' },
        { axis: 'x', pos: x0, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Oeste' }
      );
      return faces;
    }

    if (has('CS') && has('CE')) { // Rincón Centro Sureste ┘
      faces.push(
        { axis: 'x', pos: cxA, minY: cyA, maxY: y1, type: 1, name: 'Rincón (Exterior Oeste)' },
        { axis: 'y', pos: cyA, minX: cxA, maxX: x1, type: 1, name: 'Rincón (Exterior Norte)' },
        { axis: 'x', pos: cxB, minY: cyB, maxY: y1, type: 1, name: 'Rincón (Interior Este)' },
        { axis: 'y', pos: cyB, minX: cxB, maxX: x1, type: 1, name: 'Rincón (Interior Sur)' },
        { axis: 'y', pos: y1, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Sur' },
        { axis: 'x', pos: x1, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Este' }
      );
      return faces;
    }

    // 2. CRUCE CENTRAL (H + V)
    // -------------------------------------------------------------
    if (has('CH') && has('CV')) {
      faces.push(
        { axis: 'x', pos: cxA, minY: y0, maxY: cyA, type: 1, name: 'Cruce (NO-V)' },
        { axis: 'y', pos: cyA, minX: x0, maxX: cxA, type: 1, name: 'Cruce (NO-H)' },
        { axis: 'x', pos: cxB, minY: y0, maxY: cyA, type: 1, name: 'Cruce (NE-V)' },
        { axis: 'y', pos: cyA, minX: cxB, maxX: x1, type: 1, name: 'Cruce (NE-H)' },
        { axis: 'x', pos: cxA, minY: cyB, maxY: y1, type: 1, name: 'Cruce (SO-V)' },
        { axis: 'y', pos: cyB, minX: x0, maxX: cxA, type: 1, name: 'Cruce (SO-H)' },
        { axis: 'x', pos: cxB, minY: cyB, maxY: y1, type: 1, name: 'Cruce (SE-V)' },
        { axis: 'y', pos: cyB, minX: cxB, maxX: x1, type: 1, name: 'Cruce (SE-H)' }
      );
      return faces;
    }

    // 3. TABIQUES O PUERTAS COMPLETAS
    // -------------------------------------------------------------
    if (has('CH') || has('DCH')) {
      const isDoor = has('DCH');
      faces.push(
        { axis: 'y', pos: cyA, minX: x0, maxX: x1, type: isDoor ? 2 : 1, name: isDoor ? 'Puerta Central' : 'Tabique Central (N)' },
        { axis: 'y', pos: cyB, minX: x0, maxX: x1, type: isDoor ? 2 : 1, name: isDoor ? 'Puerta Central' : 'Tabique Central (S)' },
        { axis: 'x', pos: x0, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Oeste' },
        { axis: 'x', pos: x1, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Este' }
      );
    }

    if (has('CV') || has('DCV')) {
      const isDoor = has('DCV');
      faces.push(
        { axis: 'x', pos: cxA, minY: y0, maxY: y1, type: isDoor ? 3 : 1, name: isDoor ? 'Puerta Central' : 'Tabique Central (O)' },
        { axis: 'x', pos: cxB, minY: y0, maxY: y1, type: isDoor ? 3 : 1, name: isDoor ? 'Puerta Central' : 'Tabique Central (E)' },
        { axis: 'y', pos: y0, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Norte' },
        { axis: 'y', pos: y1, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Sur' }
      );
    }

    // Semiramas aisladas
    if (has('CN') && !has('CW') && !has('CE')) {
      faces.push(
        { axis: 'x', pos: cxA, minY: y0, maxY: cyB, type: 1, name: 'Muro CN (O)' },
        { axis: 'x', pos: cxB, minY: y0, maxY: cyB, type: 1, name: 'Muro CN (E)' },
        { axis: 'y', pos: cyB, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Sur' },
        { axis: 'y', pos: y0, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Norte' }
      );
    }
    if (has('CS') && !has('CW') && !has('CE')) {
      faces.push(
        { axis: 'x', pos: cxA, minY: cyA, maxY: y1, type: 1, name: 'Muro CS (O)' },
        { axis: 'x', pos: cxB, minY: cyA, maxY: y1, type: 1, name: 'Muro CS (E)' },
        { axis: 'y', pos: cyA, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Norte' },
        { axis: 'y', pos: y1, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Sur' }
      );
    }
    if (has('CW') && !has('CN') && !has('CS')) {
      faces.push(
        { axis: 'y', pos: cyA, minX: x0, maxX: cxB, type: 1, name: 'Muro CW (N)' },
        { axis: 'y', pos: cyB, minX: x0, maxX: cxB, type: 1, name: 'Muro CW (S)' },
        { axis: 'x', pos: cxB, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Este' },
        { axis: 'x', pos: x0, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Oeste' }
      );
    }
    if (has('CE') && !has('CN') && !has('CS')) {
      faces.push(
        { axis: 'y', pos: cyA, minX: cxA, maxX: x1, type: 1, name: 'Muro CE (N)' },
        { axis: 'y', pos: cyB, minX: cxA, maxX: x1, type: 1, name: 'Muro CE (S)' },
        { axis: 'x', pos: cxA, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Oeste' },
        { axis: 'x', pos: x1, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Este' }
      );
    }

    // 4. ESQUINAS EN BORDES (NW, NE, SW, SE)
    // -------------------------------------------------------------
    if (has('N') && has('W')) {
      faces.push(
        { axis: 'y', pos: nyB, minX: wxB, maxX: x1, type: 1, name: 'Esquina NO (S)' },
        { axis: 'x', pos: wxB, minY: nyB, maxY: y1, type: 1, name: 'Esquina NO (E)' }
      );
      return faces;
    }
    if (has('N') && has('E')) {
      faces.push(
        { axis: 'y', pos: nyB, minX: x0, maxX: exA, type: 1, name: 'Esquina NE (S)' },
        { axis: 'x', pos: exA, minY: nyB, maxY: y1, type: 1, name: 'Esquina NE (O)' }
      );
      return faces;
    }
    if (has('S') && has('W')) {
      faces.push(
        { axis: 'y', pos: syA, minX: wxB, maxX: x1, type: 1, name: 'Esquina SO (N)' },
        { axis: 'x', pos: wxB, minY: y0, maxY: syA, type: 1, name: 'Esquina SO (E)' }
      );
      return faces;
    }
    if (has('S') && has('E')) {
      faces.push(
        { axis: 'y', pos: syA, minX: x0, maxX: exA, type: 1, name: 'Esquina SE (N)' },
        { axis: 'x', pos: exA, minY: y0, maxY: syA, type: 1, name: 'Esquina SE (O)' }
      );
      return faces;
    }

    // 5. MUROS Y PUERTAS EN BORDES SUELTOS
    // -------------------------------------------------------------
    if (has('N') || has('DN')) {
      const isDoor = has('DN');
      faces.push(
        { axis: 'y', pos: nyB, minX: x0, maxX: x1, type: isDoor ? 2 : 1, name: isDoor ? 'Puerta Norte [N]' : 'Pared Norte' },
        { axis: 'y', pos: nyA, minX: x0, maxX: x1, type: isDoor ? 2 : 1, name: isDoor ? 'Puerta Norte [N]' : 'Pared Norte' }
      );
    }

    if (has('S') || has('DS')) {
      const isDoor = has('DS');
      faces.push(
        { axis: 'y', pos: syA, minX: x0, maxX: x1, type: isDoor ? 4 : 1, name: isDoor ? 'Puerta Sur [S]' : 'Pared Sur' },
        { axis: 'y', pos: syB, minX: x0, maxX: x1, type: isDoor ? 4 : 1, name: isDoor ? 'Puerta Sur [S]' : 'Pared Sur' }
      );
    }

    if (has('W') || has('DW')) {
      const isDoor = has('DW');
      faces.push(
        { axis: 'x', pos: wxB, minY: y0, maxY: y1, type: isDoor ? 5 : 1, name: isDoor ? 'Puerta Oeste [O]' : 'Pared Oeste' },
        { axis: 'x', pos: wxA, minY: y0, maxY: y1, type: isDoor ? 5 : 1, name: isDoor ? 'Puerta Oeste [O]' : 'Pared Oeste' }
      );
    }

    if (has('E') || has('DE')) {
      const isDoor = has('DE');
      faces.push(
        { axis: 'x', pos: exA, minY: y0, maxY: y1, type: isDoor ? 3 : 1, name: isDoor ? 'Puerta Este [E]' : 'Pared Este' },
        { axis: 'x', pos: exB, minY: y0, maxY: y1, type: isDoor ? 3 : 1, name: isDoor ? 'Puerta Este [E]' : 'Pared Este' }
      );
    }

    return faces;
  }

  /**
   * Genera texturas retro de 64x64 píxeles en memoria
   */
  generateProceduralTextures() {
    // Textura 1: Muro de piedra/ladrillo dungeon
    this.textures[1] = this.createStoneTexture();

    // Texturas 2, 3, 4, 5: Puertas de madera reforzadas con gemas/emblemas de colores
    this.textures[2] = this.createDoorTexture(this.doorInfo[2]);
    this.textures[3] = this.createDoorTexture(this.doorInfo[3]);
    this.textures[4] = this.createDoorTexture(this.doorInfo[4]);
    this.textures[5] = this.createDoorTexture(this.doorInfo[5]);

    // Textura 10: Marco / Jamba de puerta metálica y piedra (profundidad fina 0.2)
    this.textures[10] = this.createDoorFrameTexture();
  }

  createDoorFrameTexture() {
    const size = this.textureSize;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Hierro forjado oscuro
    ctx.fillStyle = '#1c1f26';
    ctx.fillRect(0, 0, size, size);

    // Bisel metálico vertical
    ctx.fillStyle = '#2f3542';
    ctx.fillRect(4, 0, 10, size);
    ctx.fillRect(size - 14, 0, 10, size);

    // Placas de anclaje y remaches
    for (let y = 8; y < size; y += 16) {
      ctx.fillStyle = '#4b5366';
      ctx.fillRect(2, y, size - 4, 3);
      ctx.fillStyle = '#8395a7';
      ctx.fillRect(6, y - 1, 3, 3);
      ctx.fillRect(size - 9, y - 1, 3, 3);
    }

    return new Uint32Array(ctx.getImageData(0, 0, size, size).data.buffer);
  }

  createStoneTexture() {
    const size = this.textureSize;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Fondo grisáceo
    ctx.fillStyle = '#484b54';
    ctx.fillRect(0, 0, size, size);

    // Líneas de mortero / ladrillos
    const brickH = 16;
    const brickW = 32;

    for (let y = 0; y < size; y += brickH) {
      const row = Math.floor(y / brickH);
      const offsetX = (row % 2 === 0) ? 0 : brickW / 2;

      for (let x = -brickW; x < size + brickW; x += brickW) {
        const actualX = x + offsetX;
        // Color aleatorio sutil para cada ladrillo
        const shade = 65 + Math.floor(Math.random() * 20);
        ctx.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade + 8})`;
        ctx.fillRect(actualX + 1, y + 1, brickW - 2, brickH - 2);

        // Bisel superior/izquierdo claro
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.fillRect(actualX + 1, y + 1, brickW - 2, 2);
        ctx.fillRect(actualX + 1, y + 1, 2, brickH - 2);

        // Bisel inferior oscuro
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(actualX + 1, y + brickH - 2, brickW - 2, 2);
        ctx.fillRect(actualX + brickW - 2, y + 1, 2, brickH - 2);
      }

      // Línea horizontal de mortero
      ctx.fillStyle = '#26282e';
      ctx.fillRect(0, y, size, 2);
    }

    // Ruido granulado retro
    const img = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 18;
      img.data[i] = Math.min(255, Math.max(0, img.data[i] + noise));
      img.data[i+1] = Math.min(255, Math.max(0, img.data[i+1] + noise));
      img.data[i+2] = Math.min(255, Math.max(0, img.data[i+2] + noise));
    }
    ctx.putImageData(img, 0, 0);

    return new Uint32Array(ctx.getImageData(0, 0, size, size).data.buffer);
  }

  createDoorTexture(doorConfig) {
    const size = this.textureSize;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Marco exterior de hierro oscuro
    ctx.fillStyle = '#20242a';
    ctx.fillRect(0, 0, size, size);

    // Marco interior biselado
    ctx.fillStyle = '#14171c';
    ctx.fillRect(4, 4, size - 8, size - 8);

    // Tablones verticales de madera noble
    const woodColors = ['#6d3e18', '#78461c', '#633714', '#71401a'];
    const plankWidth = 14;
    for (let x = 6; x < size - 6; x += plankWidth) {
      ctx.fillStyle = woodColors[Math.floor(x / plankWidth) % woodColors.length];
      ctx.fillRect(x, 6, Math.min(plankWidth - 2, size - 6 - x), size - 12);
      
      // Separación oscura de tablones
      ctx.fillStyle = '#2a1608';
      ctx.fillRect(x + plankWidth - 2, 6, 2, size - 12);
    }

    // Bisagras y refuerzos de hierro horizontales
    ctx.fillStyle = '#2d3436';
    ctx.fillRect(4, 14, size - 8, 6);
    ctx.fillRect(4, size - 20, size - 8, 6);

    // Remaches metálicos
    ctx.fillStyle = '#7f8c8d';
    [10, 24, 40, 54].forEach(px => {
      ctx.fillRect(px, 16, 3, 3);
      ctx.fillRect(px, size - 18, 3, 3);
    });

    // Pomo / Cerradura dorada
    ctx.fillStyle = '#d4af37';
    ctx.beginPath();
    ctx.arc(size - 14, size / 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.fillRect(size - 15, size / 2 + 1, 2, 4);

    // Emblema / Runa central con el color distintivo de la puerta
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = doorConfig.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 10, 0, Math.PI * 2);
    ctx.stroke();

    // Letra de la runa (N, S, E, O)
    ctx.fillStyle = doorConfig.color;
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(doorConfig.rune, size / 2, size / 2);

    return new Uint32Array(ctx.getImageData(0, 0, size, size).data.buffer);
  }

  /**
   * Renderiza un frame completo del mundo 3D
   */
  render(player) {
    const { posX, posY, dirX, dirY, planeX, planeY } = player;
    const w = this.width;
    const h = this.height;
    const halfH = this.halfHeight;
    const pixels = this.pixels;

    // 1. Dibujar Techo y Suelo con degradado de iluminación ambiental
    // Formato de píxel en Little Endian Uint32: 0xAABBGGRR
    for (let y = 0; y < halfH; y++) {
      // Techo: de azul noche a oscuridad en el horizonte
      const ceilRatio = y / halfH;
      const cR = Math.floor(10 + ceilRatio * 8);
      const cG = Math.floor(12 + ceilRatio * 10);
      const cB = Math.floor(22 + ceilRatio * 16);
      const ceilColor = (255 << 24) | (cB << 16) | (cG << 8) | cR;

      // Suelo: de oscuridad en el horizonte a piedra oscura cerca de los pies
      const floorY = h - 1 - y;
      const floorRatio = 1 - (y / halfH);
      const fR = Math.floor(18 + floorRatio * 20);
      const fG = Math.floor(20 + floorRatio * 22);
      const fB = Math.floor(24 + floorRatio * 26);
      const floorColor = (255 << 24) | (fB << 16) | (fG << 8) | fR;

      const ceilOffset = y * w;
      const floorOffset = floorY * w;

      for (let x = 0; x < w; x++) {
        pixels[ceilOffset + x] = ceilColor;
        pixels[floorOffset + x] = floorColor;
      }
    }

    // Rayo central para registrar qué está mirando directamente el jugador
    const centerRayX = Math.floor(w / 2);

    // 2. Proyección de Rayos (DDA Algorithm)
    for (let x = 0; x < w; x++) {
      // Coordenada x en el espacio de cámara (-1 a +1)
      const cameraX = (2 * x) / w - 1;
      const rayDirX = dirX + planeX * cameraX;
      const rayDirY = dirY + planeY * cameraX;

      // Celda del mapa en la que está el rayo
      let mapX = Math.floor(posX);
      let mapY = Math.floor(posY);

      // Longitud del rayo desde la posición actual al siguiente lado X o Y
      let sideDistX;
      let sideDistY;

      // Longitud del rayo de un lado x o y al siguiente lado x o y
      const deltaDistX = Math.abs(1 / rayDirX);
      const deltaDistY = Math.abs(1 / rayDirY);
      let perpWallDist;

      // Dirección en la que avanzar en x o y (+1 o -1)
      let stepX;
      let stepY;

      let hit = 0; // ¿Ha golpeado un muro?
      let side = 0; // 0 = pared norte/sur (lado X), 1 = este/oeste (lado Y)

      // Calcular step y sideDist inicial
      if (rayDirX < 0) {
        stepX = -1;
        sideDistX = (posX - mapX) * deltaDistX;
      } else {
        stepX = 1;
        sideDistX = (mapX + 1.0 - posX) * deltaDistX;
      }
      if (rayDirY < 0) {
        stepY = -1;
        sideDistY = (posY - mapY) * deltaDistY;
      } else {
        stepY = 1;
        sideDistY = (mapY + 1.0 - posY) * deltaDistY;
      }

      let hitSide = 0;
      let wallHitCoord = 0;
      let hitTargetName = 'Pared de piedra';

      // Comprobar primero si hay un tabique frente al jugador en su propia celda de inicio
      const startCellSegs = this.getCellSegments(mapX, mapY);
      if (startCellSegs.length > 0) {
        let closestDist = Infinity;
        let bestSeg = null;
        let bestWallX = 0;
        let bestSide = 0;

        for (let s = 0; s < startCellSegs.length; s++) {
          const seg = startCellSegs[s];
          if (seg.axis === 'y' && Math.abs(rayDirY) > 1e-6) {
            const dist = (seg.pos - posY) / rayDirY;
            if (dist > 0.05 && dist < closestDist) {
              const hitX = posX + dist * rayDirX;
              const minX = seg.minX !== undefined ? seg.minX : (mapX - 0.02);
              const maxX = seg.maxX !== undefined ? seg.maxX : (mapX + 1.02);
              if (hitX >= minX && hitX <= maxX) {
                closestDist = dist;
                bestSeg = seg;
                if (seg.isCap) {
                  const span = Math.max(0.001, maxX - minX);
                  bestWallX = Math.max(0, Math.min(0.999, (hitX - minX) / span));
                } else {
                  bestWallX = hitX - Math.floor(hitX);
                }
                bestSide = 1;
              }
            }
          } else if (seg.axis === 'x' && Math.abs(rayDirX) > 1e-6) {
            const dist = (seg.pos - posX) / rayDirX;
            if (dist > 0.05 && dist < closestDist) {
              const hitY = posY + dist * rayDirY;
              const minY = seg.minY !== undefined ? seg.minY : (mapY - 0.02);
              const maxY = seg.maxY !== undefined ? seg.maxY : (mapY + 1.02);
              if (hitY >= minY && hitY <= maxY) {
                closestDist = dist;
                bestSeg = seg;
                if (seg.isCap) {
                  const span = Math.max(0.001, maxY - minY);
                  bestWallX = Math.max(0, Math.min(0.999, (hitY - minY) / span));
                } else {
                  bestWallX = hitY - Math.floor(hitY);
                }
                bestSide = 0;
              }
            }
          }
        }

        if (bestSeg) {
          hit = bestSeg.type;
          perpWallDist = closestDist;
          wallHitCoord = bestWallX;
          hitSide = bestSide;
          hitTargetName = bestSeg.name;
        }
      }

      // Ejecutar DDA si no golpeó un tabique inmediato en su celda
      while (hit === 0) {
        if (sideDistX < sideDistY) {
          sideDistX += deltaDistX;
          mapX += stepX;
          side = 0;
        } else {
          sideDistY += deltaDistY;
          mapY += stepY;
          side = 1;
        }

        // Comprobar si golpeó una pared o puerta dentro del mapa
        if (mapX >= 0 && mapX < this.mapWidth && mapY >= 0 && mapY < this.mapHeight) {
          const segments = this.getCellSegments(mapX, mapY);
          if (segments.length > 0) {
            let closestDist = Infinity;
            let bestSeg = null;
            let bestWallX = 0;
            let bestSide = 0;

            for (let s = 0; s < segments.length; s++) {
              const seg = segments[s];
              if (seg.axis === 'y') {
                // Segmento horizontal a Y = seg.pos
                if (Math.abs(rayDirY) > 1e-6) {
                  const dist = (seg.pos - posY) / rayDirY;
                  if (dist > 0.001 && dist < closestDist) {
                    const hitX = posX + dist * rayDirX;
                    const minX = seg.minX !== undefined ? seg.minX : (mapX - 0.02);
                    const maxX = seg.maxX !== undefined ? seg.maxX : (mapX + 1.02);
                    // Tolerancia de 0.02 para sellar esquinas y rincones en 90° sin fisuras
                    if (hitX >= minX && hitX <= maxX) {
                      closestDist = dist;
                      bestSeg = seg;
                      if (seg.isCap) {
                        const span = Math.max(0.001, maxX - minX);
                        bestWallX = Math.max(0, Math.min(0.999, (hitX - minX) / span));
                      } else {
                        bestWallX = hitX - Math.floor(hitX);
                      }
                      bestSide = 1;
                    }
                  }
                }
              } else {
                // Segmento vertical a X = seg.pos
                if (Math.abs(rayDirX) > 1e-6) {
                  const dist = (seg.pos - posX) / rayDirX;
                  if (dist > 0.001 && dist < closestDist) {
                    const hitY = posY + dist * rayDirY;
                    const minY = seg.minY !== undefined ? seg.minY : (mapY - 0.02);
                    const maxY = seg.maxY !== undefined ? seg.maxY : (mapY + 1.02);
                    // Tolerancia de 0.02 para sellar esquinas y rincones en 90° sin fisuras
                    if (hitY >= minY && hitY <= maxY) {
                      closestDist = dist;
                      bestSeg = seg;
                      if (seg.isCap) {
                        const span = Math.max(0.001, maxY - minY);
                        bestWallX = Math.max(0, Math.min(0.999, (hitY - minY) / span));
                      } else {
                        bestWallX = hitY - Math.floor(hitY);
                      }
                      bestSide = 0;
                    }
                  }
                }
              }
            }

            if (bestSeg) {
              hit = bestSeg.type;
              perpWallDist = closestDist;
              wallHitCoord = bestWallX;
              hitSide = bestSide;
              hitTargetName = bestSeg.name;
              break;
            }
          }
        } else {
          // Muro perimetral exterior de seguridad
          hit = 1;
          hitSide = side;
          if (side === 0) {
            perpWallDist = (mapX - posX + (1 - stepX) / 2) / rayDirX;
            wallHitCoord = posY + perpWallDist * rayDirY;
          } else {
            perpWallDist = (mapY - posY + (1 - stepY) / 2) / rayDirY;
            wallHitCoord = posX + perpWallDist * rayDirX;
          }
          wallHitCoord -= Math.floor(wallHitCoord);
          hitTargetName = 'Pared perimetral';
          break;
        }
      }

      // Guardar información del objeto en el centro de la pantalla
      if (x === centerRayX) {
        this.facingTarget = {
          name: hitTargetName,
          type: (hit >= 2) ? 'door' : 'wall',
          distance: perpWallDist.toFixed(1)
        };
      }

      // Altura de la línea proyectada en pantalla
      const lineHeight = Math.floor(h / Math.max(perpWallDist, 0.0001));

      // Píxeles de inicio y fin para dibujar la tira vertical
      let drawStart = -lineHeight / 2 + halfH;
      let drawEnd = lineHeight / 2 + halfH;

      const clipStart = Math.max(0, Math.floor(drawStart));
      const clipEnd = Math.min(h - 1, Math.floor(drawEnd));

      // Cálculo de textura
      const tex = this.textures[hit] || this.textures[1];
      const texSize = this.textureSize;

      // Coordenada X de la textura (0..1)
      let wallX = Math.max(0, Math.min(0.999, wallHitCoord));
      let texX = Math.floor(wallX * texSize);
      if (hitSide === 0 && rayDirX > 0) texX = texSize - texX - 1;
      if (hitSide === 1 && rayDirY < 0) texX = texSize - texX - 1;

      // Factor de sombra por distancia y orientación (eje Y más sombreado para profundidad)
      let shadeFactor = 1 / (1 + perpWallDist * 0.22);
      if (hitSide === 1) shadeFactor *= 0.72; // Sombreado clásico Wolfenstein 3D

      const step = texSize / lineHeight;
      let texPos = (clipStart - halfH + lineHeight / 2) * step;

      // Modo textura completa
      if (this.textureMode === 'classic') {
        for (let y = clipStart; y <= clipEnd; y++) {
          const texY = Math.min(texSize - 1, Math.max(0, Math.floor(texPos)));
          texPos += step;

          const color = tex[texY * texSize + texX];

          // Aplicar sombreado rápido sobre los componentes R, G, B
          const r = Math.floor((color & 0xFF) * shadeFactor);
          const g = Math.floor(((color >> 8) & 0xFF) * shadeFactor);
          const b = Math.floor(((color >> 16) & 0xFF) * shadeFactor);

          pixels[y * w + x] = (255 << 24) | (b << 16) | (g << 8) | r;
        }
      } else {
        // Modo plano / líneas simples
        const baseColor = hit >= 2 ? 0x00a5ff : 0x888888;
        const r = Math.floor((baseColor & 0xFF) * shadeFactor);
        const g = Math.floor(((baseColor >> 8) & 0xFF) * shadeFactor);
        const b = Math.floor(((baseColor >> 16) & 0xFF) * shadeFactor);
        const shaded = (255 << 24) | (b << 16) | (g << 8) | r;

        for (let y = clipStart; y <= clipEnd; y++) {
          pixels[y * w + x] = shaded;
        }
      }
    }

    // Volcar el buffer al canvas
    this.ctx.putImageData(this.imgData, 0, 0);

    // 3. Renderizar Minimapa
    if (this.minimapCtx) {
      this.renderMinimap(player);
    }
  }

  /**
   * Dibuja el radar / minimapa 2D con la posición y ángulo del jugador
   */
  renderMinimap(player) {
    const ctx = this.minimapCtx;
    const cw = this.minimapCanvas.width;
    const ch = this.minimapCanvas.height;
    const cellSize = cw / this.mapWidth;

    ctx.clearRect(0, 0, cw, ch);

    // Dibujar celdas
    for (let y = 0; y < this.mapHeight; y++) {
      for (let x = 0; x < this.mapWidth; x++) {
        const val = this.map[y][x];
        const px = x * cellSize;
        const py = y * cellSize;

        // Suelo base de la celda
        ctx.fillStyle = '#11141c';
        ctx.fillRect(px, py, cellSize - 1, cellSize - 1);

        const codes = this.getCellCodes(x, y);
        const th = Math.max(2, Math.floor(cellSize * 0.2));

        for (let s = 0; s < codes.length; s++) {
          const code = codes[s];
          const isDoor = code.startsWith('D');
          let doorType = 2;
          if (code === 'DN') doorType = 2;
          else if (code === 'DE') doorType = 3;
          else if (code === 'DS') doorType = 4;
          else if (code === 'DW') doorType = 5;
          else if (code === 'DCH') doorType = 2;
          else if (code === 'DCV') doorType = 3;

          const doorColor = this.doorInfo[doorType]?.color || '#e5a93b';
          ctx.fillStyle = isDoor ? doorColor : '#636e72';

          switch (code) {
            case 'N':
            case 'DN':
              ctx.fillRect(px, py, cellSize, th);
              break;
            case 'S':
            case 'DS':
              ctx.fillRect(px, py + cellSize - th, cellSize, th);
              break;
            case 'W':
            case 'DW':
              ctx.fillRect(px, py, th, cellSize);
              break;
            case 'E':
            case 'DE':
              ctx.fillRect(px + cellSize - th, py, th, cellSize);
              break;
            case 'CH':
            case 'DCH': {
              const cy0 = py + Math.floor((cellSize - th) / 2);
              ctx.fillRect(px, cy0, cellSize, th);
              break;
            }
            case 'CV':
            case 'DCV': {
              const cx0 = px + Math.floor((cellSize - th) / 2);
              ctx.fillRect(cx0, py, th, cellSize);
              break;
            }
            case 'CN': {
              const cx0 = px + Math.floor((cellSize - th) / 2);
              const cy1 = py + Math.floor((cellSize - th) / 2) + th;
              ctx.fillRect(cx0, py, th, cy1 - py);
              break;
            }
            case 'CS': {
              const cx0 = px + Math.floor((cellSize - th) / 2);
              const cy0 = py + Math.floor((cellSize - th) / 2);
              ctx.fillRect(cx0, cy0, th, (py + cellSize) - cy0);
              break;
            }
            case 'CW': {
              const cx1 = px + Math.floor((cellSize - th) / 2) + th;
              const cy0 = py + Math.floor((cellSize - th) / 2);
              ctx.fillRect(px, cy0, cx1 - px, th);
              break;
            }
            case 'CE': {
              const cx0 = px + Math.floor((cellSize - th) / 2);
              const cy0 = py + Math.floor((cellSize - th) / 2);
              ctx.fillRect(cx0, cy0, (px + cellSize) - cx0, th);
              break;
            }
          }
        }
      }
    }

    // Dibujar jugador
    const playerPx = player.posX * cellSize;
    const playerPy = player.posY * cellSize;

    // Cono de visión (FOV)
    const fovLen = cellSize * 2.2;
    ctx.beginPath();
    ctx.moveTo(playerPx, playerPy);
    ctx.lineTo(
      playerPx + (player.dirX + player.planeX) * fovLen,
      playerPy + (player.dirY + player.planeY) * fovLen
    );
    ctx.lineTo(
      playerPx + (player.dirX - player.planeX) * fovLen,
      playerPy + (player.dirY - player.planeY) * fovLen
    );
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 210, 211, 0.25)';
    ctx.fill();

    // Línea de visión
    ctx.beginPath();
    ctx.moveTo(playerPx, playerPy);
    ctx.lineTo(
      playerPx + player.dirX * (cellSize * 1.8),
      playerPy + player.dirY * (cellSize * 1.8)
    );
    ctx.strokeStyle = '#00d2d3';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Punto del jugador
    ctx.beginPath();
    ctx.arc(playerPx, playerPy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#00d2d3';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

// Exportación para compatibilidad con módulos o entornos globales
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RaycasterEngine };
}

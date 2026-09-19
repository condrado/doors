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

    // Estilo por segmento, tal como lo pintó el Editor: { "x,y": { N: 'blanca', DW: 'negra', ... } }
    // Cada pared/puerta conserva su propio estilo; no hay un único "estilo del mapa".
    this.wallStyleMap = {};

    // Generar TODAS las variantes de textura de una vez (sin depender de imágenes externas),
    // para poder mezclar estilos distintos en el mismo mapa sin recalcular nada en caliente.
    this.textures = {};
    this.generateProceduralTextures();

    // Intentar sustituir por imágenes de proyecto en src/engine/textures/ si existen (no bloqueante)
    this.textureOverridesReady = this.loadDefaultTextureOverrides();

    // Objeto frente al jugador (actualizado en cada frame)
    this.facingTarget = { name: 'Pared de piedra', type: 'wall', distance: 0 };

    // Caché de segmentos/caras 3D por celda para máximo rendimiento
    this._cellSegmentsCache = null;
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
   * Invalida la caché de caras/segmentos 3D generados por celda
   */
  clearSegmentsCache() {
    this._cellSegmentsCache = null;
  }

  /**
   * Abre la puerta en (mapX, mapY) dejándola visible en posición abatida (OD*)
   * y transitable para el jugador.
   */
  openDoor(mapX, mapY) {
    if (mapY < 0 || mapY >= this.mapHeight || mapX < 0 || mapX >= this.mapWidth) return null;
    const cell = this.map[mapY][mapX];
    if (cell === undefined || cell === null || cell === 0) return null;

    if (!this.openedDoorsOriginalType) {
      this.openedDoorsOriginalType = new Map();
    }

    let doorOpened = false;
    let doorName = 'Puerta';
    const key = `${mapX},${mapY}`;

    if (typeof cell === 'number') {
      if (cell >= 2 && cell <= 5) {
        const typeLetter = (cell === 2) ? 'N' : (cell === 3) ? 'E' : (cell === 4) ? 'S' : 'W';
        doorName = this.doorInfo[cell]?.name || 'Puerta';
        this.openedDoorsOriginalType.set(key, cell);
        this.map[mapY][mapX] = ['OD' + typeLetter];
        doorOpened = true;
      }
    } else if (Array.isArray(cell)) {
      const doorCodes = ['DN', 'DE', 'DS', 'DW', 'DCH', 'DCV'];
      const foundDoor = cell.find(code => doorCodes.includes(code));
      if (foundDoor) {
        doorOpened = true;
        const typeLetter = foundDoor.replace('D', '');
        const doorNum = (typeLetter === 'N' ? 2 : typeLetter === 'E' ? 3 : typeLetter === 'S' ? 4 : typeLetter === 'W' ? 5 : 2);
        doorName = this.doorInfo[doorNum]?.name || 'Puerta';
        this.openedDoorsOriginalType.set(key, JSON.parse(JSON.stringify(cell)));
        this.map[mapY][mapX] = cell.map(c => c === foundDoor ? ('OD' + typeLetter) : c);
      }
    }

    if (doorOpened) {
      this.clearSegmentsCache();
      return { success: true, action: 'open', name: doorName, mapX, mapY };
    }
    return null;
  }

  /**
   * Cierra una puerta abierta devolviéndola al estado sólido original.
   */
  closeDoor(mapX, mapY, player) {
    if (mapY < 0 || mapY >= this.mapHeight || mapX < 0 || mapX >= this.mapWidth) return null;
    const cell = this.map[mapY][mapX];
    if (!cell) return null;

    const key = `${mapX},${mapY}`;
    let openCode = null;
    if (Array.isArray(cell)) {
      openCode = cell.find(c => typeof c === 'string' && c.startsWith('OD'));
    }
    if (!openCode) return null;

    // Verificar si el jugador está obstruyendo el vano
    if (player && this.isPlayerBlockingDoor(mapX, mapY, player, openCode)) {
      return { blocked: true, message: '¡Despeja el vano para poder cerrar la puerta!' };
    }

    let doorName = 'Puerta';
    if (this.openedDoorsOriginalType && this.openedDoorsOriginalType.has(key)) {
      const original = this.openedDoorsOriginalType.get(key);
      this.map[mapY][mapX] = original;
      this.openedDoorsOriginalType.delete(key);
      if (typeof original === 'number') {
        doorName = this.doorInfo[original]?.name || 'Puerta';
      } else if (Array.isArray(original)) {
        const dCode = original.find(c => ['DN', 'DE', 'DS', 'DW', 'DCH', 'DCV'].includes(c));
        const num = dCode === 'DN' ? 2 : dCode === 'DE' ? 3 : dCode === 'DS' ? 4 : dCode === 'DW' ? 5 : 2;
        doorName = this.doorInfo[num]?.name || 'Puerta';
      }
    } else {
      const closedCode = openCode.replace('OD', 'D');
      this.map[mapY][mapX] = cell.map(c => c === openCode ? closedCode : c);
      doorName = 'Puerta';
    }

    this.clearSegmentsCache();
    return { success: true, action: 'close', name: doorName, mapX, mapY };
  }

  /**
   * Comprueba si el jugador se encuentra dentro del vano cerrado de la puerta
   */
  isPlayerBlockingDoor(mapX, mapY, player, openCode) {
    const px = player.posX;
    const py = player.posY;
    const pRad = 0.22;
    const x0 = mapX, x1 = mapX + 1.0;
    const y0 = mapY, y1 = mapY + 1.0;

    switch (openCode) {
      case 'ODN':
        return (py + pRad >= y0 && py - pRad <= y0 + 0.25 && px >= x0 - 0.1 && px <= x1 + 0.1);
      case 'ODS':
        return (py + pRad >= y1 - 0.25 && py - pRad <= y1 && px >= x0 - 0.1 && px <= x1 + 0.1);
      case 'ODW':
        return (px + pRad >= x0 && px - pRad <= x0 + 0.25 && py >= y0 - 0.1 && py <= y1 + 0.1);
      case 'ODE':
        return (px + pRad >= x1 - 0.25 && px - pRad <= x1 && py >= y0 - 0.1 && py <= y1 + 0.1);
      case 'ODCH':
        return (py + pRad >= y0 + 0.35 && py - pRad <= y0 + 0.65 && px >= x0 - 0.1 && px <= x1 + 0.1);
      case 'ODCV':
        return (px + pRad >= x0 + 0.35 && px - pRad <= x0 + 0.65 && py >= y0 - 0.1 && py <= y1 + 0.1);
      default:
        return false;
    }
  }

  /**
   * Alterna (abre o cierra) una puerta en el rango de interacción (≤ maxDist).
   * Prioriza el objetivo enfocado en la mirilla central y luego las celdas frontales inmediatas.
   */
  interactDoor(player, maxDistance = 2.8) {
    // 1. Probar primero si el rayo central apunta a una puerta (cerrada o abierta)
    if (this.facingTarget && (this.facingTarget.type === 'door' || this.facingTarget.type === 'door-open')) {
      const dist = (this.facingTarget.rawDist !== undefined)
        ? this.facingTarget.rawDist
        : parseFloat(this.facingTarget.distance);
      if (dist <= maxDistance && this.facingTarget.mapX !== undefined && this.facingTarget.mapY !== undefined) {
        const mX = this.facingTarget.mapX;
        const mY = this.facingTarget.mapY;
        const cell = this.map[mY][mX];
        const isAlreadyOpen = Array.isArray(cell) && cell.some(c => typeof c === 'string' && c.startsWith('OD'));
        if (isAlreadyOpen) {
          return this.closeDoor(mX, mY, player);
        } else {
          return this.openDoor(mX, mY);
        }
      }
    }

    // 2. Probar celdas directamente en frente de la mirada del jugador (por cercanía o ángulo)
    const checkDists = [0.6, 1.1, 1.6, 2.2, maxDistance];
    for (let i = 0; i < checkDists.length; i++) {
      const d = checkDists[i];
      const frontX = Math.floor(player.posX + player.dirX * d);
      const frontY = Math.floor(player.posY + player.dirY * d);
      if (frontX >= 0 && frontX < this.mapWidth && frontY >= 0 && frontY < this.mapHeight) {
        const cell = this.map[frontY][frontX];
        const isNumDoor = typeof cell === 'number' && cell >= 2 && cell <= 5;
        const isArrClosed = Array.isArray(cell) && cell.some(c => ['DN', 'DE', 'DS', 'DW', 'DCH', 'DCV'].includes(c));
        const isArrOpen = Array.isArray(cell) && cell.some(c => typeof c === 'string' && c.startsWith('OD'));

        if (isArrOpen) {
          return this.closeDoor(frontX, frontY, player);
        } else if (isNumDoor || isArrClosed) {
          return this.openDoor(frontX, frontY);
        }
      }
    }

    // 3. Probar la celda actual donde se encuentra el jugador (por si acaba de cruzar y se gira)
    const curX = Math.floor(player.posX);
    const curY = Math.floor(player.posY);
    if (curX >= 0 && curX < this.mapWidth && curY >= 0 && curY < this.mapHeight) {
      const curCell = this.map[curY][curX];
      if (Array.isArray(curCell) && curCell.some(c => typeof c === 'string' && c.startsWith('OD'))) {
        return this.closeDoor(curX, curY, player);
      }
    }

    return null;
  }

  /**
   * Obtiene la lista de caras 3D de volumen sólido y puertas en una celda
   * con caché acelerada para no recalcular en cada rayo de cada fotograma.
   */
  getCellSegments(mapX, mapY) {
    if (mapY < 0 || mapY >= this.mapHeight || mapX < 0 || mapX >= this.mapWidth) return [];
    if (!this._cellSegmentsCache || this._cellSegmentsCache.length !== this.mapHeight) {
      this._cellSegmentsCache = Array.from({ length: this.mapHeight }, () => new Array(this.mapWidth).fill(null));
    }
    const cached = this._cellSegmentsCache[mapY][mapX];
    if (cached !== null && cached !== undefined) return cached;

    const codes = this.getCellCodes(mapX, mapY);
    const segments = this.generateCellFaces(codes, mapX, mapY);
    this._cellSegmentsCache[mapY][mapX] = segments;
    return segments;
  }

  /**
   * Genera las caras 3D de volumen sólido (espesor 0.20) para tabiques, esquinas y puertas.
   * Los cantos se generan siempre en ambos extremos de cada tramo, estén o no conectados
   * a otra pared: el coste extra es insignificante frente al beneficio de una lógica única
   * sin casos especiales por conexión. El canto de pared usa textures[10] (estilo de PARED)
   * y el canto de puerta usa textures[11] (estilo de PUERTA), para que cada uno coincida
   * visualmente con el material seleccionado (Castillo/Blanca/Negra/Cristal).
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

    // Estilo con el que se colocó CADA código de ESTA celda (ver setSegmentStyle en
    // el Editor). A diferencia de antes, aquí NO se combina en un único estilo para
    // toda la figura: cuando dos paredes comparten celda y forman una esquina/cruce,
    // cada tramo de la figura conserva la textura de SU propio código (p. ej. en una
    // esquina NO, la cara que pertenece a "N" usa el estilo de N y la que pertenece
    // a "W" usa el estilo de W), tal y como si fuesen dos paredes independientes que
    // simplemente encajan entre sí — porque eso es exactamente lo que son.
    const cellStyleEntry = this.wallStyleMap[`${mapX},${mapY}`];
    const styleOf = (code) => (cellStyleEntry && cellStyleEntry[code]) || 'castillo';

    // 0. BLOQUE SÓLIDO COMPLETO 1x1 (celda numérica 1 o ['N', 'S', 'E', 'W'])
    if (has('N') && has('S') && has('E') && has('W')) {
      faces.push(
        { axis: 'y', pos: y0, minX: x0, maxX: x1, type: 1, name: 'Pared Bloque (N)', style: styleOf('N') },
        { axis: 'y', pos: y1, minX: x0, maxX: x1, type: 1, name: 'Pared Bloque (S)', style: styleOf('S') },
        { axis: 'x', pos: x0, minY: y0, maxY: y1, type: 1, name: 'Pared Bloque (O)', style: styleOf('W') },
        { axis: 'x', pos: x1, minY: y0, maxY: y1, type: 1, name: 'Pared Bloque (E)', style: styleOf('E') }
      );
      return faces;
    }

    // 1. RINCONES EN EL CENTRO (EN FORMA DE L CON GROSOR 0.20)
    // -------------------------------------------------------------
    if (has('CN') && has('CW')) { // Rincón Centro Noroeste ┌
      const styleCN = styleOf('CN');
      const styleCW = styleOf('CW');
      faces.push(
        { axis: 'x', pos: cxB, minY: y0, maxY: cyB, type: 1, name: 'Rincón (Exterior Este)', style: styleCN },
        { axis: 'y', pos: cyB, minX: x0, maxX: cxB, type: 1, name: 'Rincón (Exterior Sur)', style: styleCW },
        { axis: 'x', pos: cxA, minY: y0, maxY: cyA, type: 1, name: 'Rincón (Interior Oeste)', style: styleCN },
        { axis: 'y', pos: cyA, minX: x0, maxX: cxA, type: 1, name: 'Rincón (Interior Norte)', style: styleCW },
        { axis: 'y', pos: y0, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Norte', style: styleCN },
        { axis: 'x', pos: x0, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Oeste', style: styleCW }
      );
      return faces;
    }

    if (has('CN') && has('CE')) { // Rincón Centro Noreste ┐
      const styleCN = styleOf('CN');
      const styleCE = styleOf('CE');
      faces.push(
        { axis: 'x', pos: cxA, minY: y0, maxY: cyB, type: 1, name: 'Rincón (Exterior Oeste)', style: styleCN },
        { axis: 'y', pos: cyB, minX: cxA, maxX: x1, type: 1, name: 'Rincón (Exterior Sur)', style: styleCE },
        { axis: 'x', pos: cxB, minY: y0, maxY: cyA, type: 1, name: 'Rincón (Interior Este)', style: styleCN },
        { axis: 'y', pos: cyA, minX: cxB, maxX: x1, type: 1, name: 'Rincón (Interior Norte)', style: styleCE },
        { axis: 'y', pos: y0, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Norte', style: styleCN },
        { axis: 'x', pos: x1, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Este', style: styleCE }
      );
      return faces;
    }

    if (has('CS') && has('CW')) { // Rincón Centro Suroeste └
      const styleCS = styleOf('CS');
      const styleCW = styleOf('CW');
      faces.push(
        { axis: 'x', pos: cxB, minY: cyA, maxY: y1, type: 1, name: 'Rincón (Exterior Este)', style: styleCS },
        { axis: 'y', pos: cyA, minX: x0, maxX: cxB, type: 1, name: 'Rincón (Exterior Norte)', style: styleCW },
        { axis: 'x', pos: cxA, minY: cyB, maxY: y1, type: 1, name: 'Rincón (Interior Oeste)', style: styleCS },
        { axis: 'y', pos: cyB, minX: x0, maxX: cxA, type: 1, name: 'Rincón (Interior Sur)', style: styleCW },
        { axis: 'y', pos: y1, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Sur', style: styleCS },
        { axis: 'x', pos: x0, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Oeste', style: styleCW }
      );
      return faces;
    }

    if (has('CS') && has('CE')) { // Rincón Centro Sureste ┘
      const styleCS = styleOf('CS');
      const styleCE = styleOf('CE');
      faces.push(
        { axis: 'x', pos: cxA, minY: cyA, maxY: y1, type: 1, name: 'Rincón (Exterior Oeste)', style: styleCS },
        { axis: 'y', pos: cyA, minX: cxA, maxX: x1, type: 1, name: 'Rincón (Exterior Norte)', style: styleCE },
        { axis: 'x', pos: cxB, minY: cyB, maxY: y1, type: 1, name: 'Rincón (Interior Este)', style: styleCS },
        { axis: 'y', pos: cyB, minX: cxB, maxX: x1, type: 1, name: 'Rincón (Interior Sur)', style: styleCE },
        { axis: 'y', pos: y1, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Sur', style: styleCS },
        { axis: 'x', pos: x1, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Este', style: styleCE }
      );
      return faces;
    }

    // 2. CRUCE CENTRAL (H + V)
    // -------------------------------------------------------------
    if (has('CH') && has('CV')) {
      const styleCH = styleOf('CH');
      const styleCV = styleOf('CV');
      faces.push(
        { axis: 'x', pos: cxA, minY: y0, maxY: cyA, type: 1, name: 'Cruce (NO-V)', style: styleCV },
        { axis: 'y', pos: cyA, minX: x0, maxX: cxA, type: 1, name: 'Cruce (NO-H)', style: styleCH },
        { axis: 'x', pos: cxB, minY: y0, maxY: cyA, type: 1, name: 'Cruce (NE-V)', style: styleCV },
        { axis: 'y', pos: cyA, minX: cxB, maxX: x1, type: 1, name: 'Cruce (NE-H)', style: styleCH },
        { axis: 'x', pos: cxA, minY: cyB, maxY: y1, type: 1, name: 'Cruce (SO-V)', style: styleCV },
        { axis: 'y', pos: cyB, minX: x0, maxX: cxA, type: 1, name: 'Cruce (SO-H)', style: styleCH },
        { axis: 'x', pos: cxB, minY: cyB, maxY: y1, type: 1, name: 'Cruce (SE-V)', style: styleCV },
        { axis: 'y', pos: cyB, minX: cxB, maxX: x1, type: 1, name: 'Cruce (SE-H)', style: styleCH },
        { axis: 'y', pos: y0, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Norte', style: styleCV },
        { axis: 'y', pos: y1, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Sur', style: styleCV },
        { axis: 'x', pos: x0, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Oeste', style: styleCH },
        { axis: 'x', pos: x1, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Este', style: styleCH }
      );
      return faces;
    }

    // 3. TABIQUES, PUERTAS O VENTANAS COMPLETAS
    // -------------------------------------------------------------
    if (has('CH') || has('DCH') || has('WCH')) {
      const isDoor = has('DCH');
      const isWin = has('WCH');
      const type = isDoor ? 2 : isWin ? 6 : 1;
      const name = isDoor ? 'Puerta Central' : isWin ? 'Ventana Central' : 'Pared Central (N)';
      const style = styleOf(isDoor ? 'DCH' : isWin ? 'WCH' : 'CH');
      faces.push(
        { axis: 'y', pos: cyA, minX: x0, maxX: x1, type, name, style },
        { axis: 'y', pos: cyB, minX: x0, maxX: x1, type, name, style },
        { axis: 'x', pos: x0, minY: cyA, maxY: cyB, type: isDoor ? 11 : 10, isCap: true, name: 'Canto Oeste', style },
        { axis: 'x', pos: x1, minY: cyA, maxY: cyB, type: isDoor ? 11 : 10, isCap: true, name: 'Canto Este', style }
      );
    }

    if (has('CV') || has('DCV') || has('WCV')) {
      const isDoor = has('DCV');
      const isWin = has('WCV');
      const type = isDoor ? 3 : isWin ? 6 : 1;
      const name = isDoor ? 'Puerta Central' : isWin ? 'Ventana Central' : 'Pared Central (O)';
      const style = styleOf(isDoor ? 'DCV' : isWin ? 'WCV' : 'CV');
      faces.push(
        { axis: 'x', pos: cxA, minY: y0, maxY: y1, type, name, style },
        { axis: 'x', pos: cxB, minY: y0, maxY: y1, type, name, style },
        { axis: 'y', pos: y0, minX: cxA, maxX: cxB, type: isDoor ? 11 : 10, isCap: true, name: 'Canto Norte', style },
        { axis: 'y', pos: y1, minX: cxA, maxX: cxB, type: isDoor ? 11 : 10, isCap: true, name: 'Canto Sur', style }
      );
    }

    // Semiramas aisladas o conectadas en T
    if (has('CN') && !has('CW') && !has('CE')) {
      const endY = has('CH') ? cyA : cyB;
      const style = styleOf('CN');
      faces.push(
        { axis: 'x', pos: cxA, minY: y0, maxY: endY, type: 1, name: 'Muro CN (O)', style },
        { axis: 'x', pos: cxB, minY: y0, maxY: endY, type: 1, name: 'Muro CN (E)', style },
        { axis: 'y', pos: y0, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Norte', style },
        { axis: 'y', pos: cyB, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Sur', style }
      );
    }
    if (has('CS') && !has('CW') && !has('CE')) {
      const startY = has('CH') ? cyB : cyA;
      const style = styleOf('CS');
      faces.push(
        { axis: 'x', pos: cxA, minY: startY, maxY: y1, type: 1, name: 'Muro CS (O)', style },
        { axis: 'x', pos: cxB, minY: startY, maxY: y1, type: 1, name: 'Muro CS (E)', style },
        { axis: 'y', pos: y1, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Sur', style },
        { axis: 'y', pos: cyA, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Norte', style }
      );
    }
    if (has('CW') && !has('CN') && !has('CS')) {
      const endX = has('CV') ? cxA : cxB;
      const style = styleOf('CW');
      faces.push(
        { axis: 'y', pos: cyA, minX: x0, maxX: endX, type: 1, name: 'Muro CW (N)', style },
        { axis: 'y', pos: cyB, minX: x0, maxX: endX, type: 1, name: 'Muro CW (S)', style },
        { axis: 'x', pos: x0, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Oeste', style },
        { axis: 'x', pos: cxB, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Este', style }
      );
    }
    if (has('CE') && !has('CN') && !has('CS')) {
      const startX = has('CV') ? cxB : cxA;
      const style = styleOf('CE');
      faces.push(
        { axis: 'y', pos: cyA, minX: startX, maxX: x1, type: 1, name: 'Muro CE (N)', style },
        { axis: 'y', pos: cyB, minX: startX, maxX: x1, type: 1, name: 'Muro CE (S)', style },
        { axis: 'x', pos: x1, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Este', style },
        { axis: 'x', pos: cxA, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Oeste', style }
      );
    }

    // 4. ESQUINAS EN BORDES (NW, NE, SW, SE)
    // -------------------------------------------------------------
    if (has('N') && has('W') && !has('S') && !has('E')) {
      const styleN = styleOf('N');
      const styleW = styleOf('W');
      faces.push(
        { axis: 'y', pos: nyA, minX: x0, maxX: x1, type: 1, name: 'Esquina NO (N)', style: styleN },
        { axis: 'x', pos: wxA, minY: y0, maxY: y1, type: 1, name: 'Esquina NO (O)', style: styleW },
        { axis: 'y', pos: nyB, minX: wxB, maxX: x1, type: 1, name: 'Esquina NO (S)', style: styleN },
        { axis: 'x', pos: wxB, minY: nyB, maxY: y1, type: 1, name: 'Esquina NO (E)', style: styleW },
        { axis: 'x', pos: x1, minY: nyA, maxY: nyB, type: 10, isCap: true, name: 'Canto Este', style: styleN },
        { axis: 'y', pos: y1, minX: wxA, maxX: wxB, type: 10, isCap: true, name: 'Canto Sur', style: styleW }
      );
      return faces;
    }
    if (has('N') && has('E') && !has('S') && !has('W')) {
      const styleN = styleOf('N');
      const styleE = styleOf('E');
      faces.push(
        { axis: 'y', pos: nyA, minX: x0, maxX: x1, type: 1, name: 'Esquina NE (N)', style: styleN },
        { axis: 'x', pos: exB, minY: y0, maxY: y1, type: 1, name: 'Esquina NE (E)', style: styleE },
        { axis: 'y', pos: nyB, minX: x0, maxX: exA, type: 1, name: 'Esquina NE (S)', style: styleN },
        { axis: 'x', pos: exA, minY: nyB, maxY: y1, type: 1, name: 'Esquina NE (O)', style: styleE },
        { axis: 'x', pos: x0, minY: nyA, maxY: nyB, type: 10, isCap: true, name: 'Canto Oeste', style: styleN },
        { axis: 'y', pos: y1, minX: exA, maxX: exB, type: 10, isCap: true, name: 'Canto Sur', style: styleE }
      );
      return faces;
    }
    if (has('S') && has('W') && !has('N') && !has('E')) {
      const styleS = styleOf('S');
      const styleW = styleOf('W');
      faces.push(
        { axis: 'y', pos: syB, minX: x0, maxX: x1, type: 1, name: 'Esquina SO (S)', style: styleS },
        { axis: 'x', pos: wxA, minY: y0, maxY: y1, type: 1, name: 'Esquina SO (O)', style: styleW },
        { axis: 'y', pos: syA, minX: wxB, maxX: x1, type: 1, name: 'Esquina SO (N)', style: styleS },
        { axis: 'x', pos: wxB, minY: y0, maxY: syA, type: 1, name: 'Esquina SO (E)', style: styleW },
        { axis: 'x', pos: x1, minY: syA, maxY: syB, type: 10, isCap: true, name: 'Canto Este', style: styleS },
        { axis: 'y', pos: y0, minX: wxA, maxX: wxB, type: 10, isCap: true, name: 'Canto Norte', style: styleW }
      );
      return faces;
    }
    if (has('S') && has('E') && !has('N') && !has('W')) {
      const styleS = styleOf('S');
      const styleE = styleOf('E');
      faces.push(
        { axis: 'y', pos: syB, minX: x0, maxX: x1, type: 1, name: 'Esquina SE (S)', style: styleS },
        { axis: 'x', pos: exB, minY: y0, maxY: y1, type: 1, name: 'Esquina SE (E)', style: styleE },
        { axis: 'y', pos: syA, minX: x0, maxX: exA, type: 1, name: 'Esquina SE (N)', style: styleS },
        { axis: 'x', pos: exA, minY: y0, maxY: syA, type: 1, name: 'Esquina SE (O)', style: styleE },
        { axis: 'x', pos: x0, minY: syA, maxY: syB, type: 10, isCap: true, name: 'Canto Oeste', style: styleS },
        { axis: 'y', pos: y0, minX: exA, maxX: exB, type: 10, isCap: true, name: 'Canto Norte', style: styleE }
      );
      return faces;
    }

    // 5. MUROS, PUERTAS Y VENTANAS EN BORDES SUELTOS O COMBINADOS
    // -------------------------------------------------------------
    if (has('N') || has('DN') || has('WN')) {
      const isDoor = has('DN');
      const isWin = has('WN');
      const type = isDoor ? 2 : isWin ? 6 : 1;
      const name = isDoor ? 'Puerta Norte' : isWin ? 'Ventana Norte' : 'Pared Norte';
      const style = styleOf(isDoor ? 'DN' : isWin ? 'WN' : 'N');
      faces.push(
        { axis: 'y', pos: nyB, minX: x0, maxX: x1, type, name, style },
        { axis: 'y', pos: nyA, minX: x0, maxX: x1, type, name, style },
        { axis: 'x', pos: x0, minY: nyA, maxY: nyB, type: isDoor ? 11 : 10, isCap: true, name: 'Canto Oeste', style },
        { axis: 'x', pos: x1, minY: nyA, maxY: nyB, type: isDoor ? 11 : 10, isCap: true, name: 'Canto Este', style }
      );
    }

    if (has('S') || has('DS') || has('WS')) {
      const isDoor = has('DS');
      const isWin = has('WS');
      const type = isDoor ? 4 : isWin ? 6 : 1;
      const name = isDoor ? 'Puerta Sur' : isWin ? 'Ventana Sur' : 'Pared Sur';
      const style = styleOf(isDoor ? 'DS' : isWin ? 'WS' : 'S');
      faces.push(
        { axis: 'y', pos: syA, minX: x0, maxX: x1, type, name, style },
        { axis: 'y', pos: syB, minX: x0, maxX: x1, type, name, style },
        { axis: 'x', pos: x0, minY: syA, maxY: syB, type: isDoor ? 11 : 10, isCap: true, name: 'Canto Oeste', style },
        { axis: 'x', pos: x1, minY: syA, maxY: syB, type: isDoor ? 11 : 10, isCap: true, name: 'Canto Este', style }
      );
    }

    if (has('W') || has('DW') || has('WW')) {
      const isDoor = has('DW');
      const isWin = has('WW');
      const type = isDoor ? 5 : isWin ? 6 : 1;
      const name = isDoor ? 'Puerta Oeste' : isWin ? 'Ventana Oeste' : 'Pared Oeste';
      const style = styleOf(isDoor ? 'DW' : isWin ? 'WW' : 'W');
      faces.push(
        { axis: 'x', pos: wxB, minY: y0, maxY: y1, type, name, style },
        { axis: 'x', pos: wxA, minY: y0, maxY: y1, type, name, style },
        { axis: 'y', pos: y0, minX: wxA, maxX: wxB, type: isDoor ? 11 : 10, isCap: true, name: 'Canto Norte', style },
        { axis: 'y', pos: y1, minX: wxA, maxX: wxB, type: isDoor ? 11 : 10, isCap: true, name: 'Canto Sur', style }
      );
    }

    if (has('E') || has('DE') || has('WE')) {
      const isDoor = has('DE');
      const isWin = has('WE');
      const type = isDoor ? 3 : isWin ? 6 : 1;
      const name = isDoor ? 'Puerta Este' : isWin ? 'Ventana Este' : 'Pared Este';
      const style = styleOf(isDoor ? 'DE' : isWin ? 'WE' : 'E');
      faces.push(
        { axis: 'x', pos: exA, minY: y0, maxY: y1, type, name, style },
        { axis: 'x', pos: exB, minY: y0, maxY: y1, type, name, style },
        { axis: 'y', pos: y0, minX: exA, maxX: exB, type: isDoor ? 11 : 10, isCap: true, name: 'Canto Norte', style },
        { axis: 'y', pos: y1, minX: exA, maxX: exB, type: isDoor ? 11 : 10, isCap: true, name: 'Canto Sur', style }
      );
    }

    // 6. PUERTAS ABIERTAS (HOJA ABATIDA A 90° CON DIMENSIONES IDÉNTICAS A CERRADA: 1.0x0.20)
    // El estilo se toma del código de la puerta CERRADA correspondiente (DN, DS...),
    // que es donde el Editor guardó con qué pincel se colocó esa puerta.
    // --------------------------------------------------------------------------------------
    if (has('ODN')) {
      const type = 2;
      const name = 'Puerta Norte [N] (Abierta)';
      const style = styleOf('DN');
      faces.push(
        { axis: 'x', pos: wxB, minY: y0, maxY: y1, type, name, style },
        { axis: 'x', pos: wxA, minY: y0, maxY: y1, type, name, style },
        { axis: 'y', pos: y1, minX: wxA, maxX: wxB, type: 11, isCap: true, name: 'Canto Puerta', style },
        { axis: 'y', pos: y0, minX: wxA, maxX: wxB, type: 11, isCap: true, name: 'Canto Puerta', style }
      );
    }

    if (has('ODS')) {
      const type = 4;
      const name = 'Puerta Sur [S] (Abierta)';
      const style = styleOf('DS');
      faces.push(
        { axis: 'x', pos: wxB, minY: y0, maxY: y1, type, name, style },
        { axis: 'x', pos: wxA, minY: y0, maxY: y1, type, name, style },
        { axis: 'y', pos: y0, minX: wxA, maxX: wxB, type: 11, isCap: true, name: 'Canto Puerta', style },
        { axis: 'y', pos: y1, minX: wxA, maxX: wxB, type: 11, isCap: true, name: 'Canto Puerta', style }
      );
    }

    if (has('ODW')) {
      const type = 5;
      const name = 'Puerta Oeste [O] (Abierta)';
      const style = styleOf('DW');
      faces.push(
        { axis: 'y', pos: nyB, minX: x0, maxX: x1, type, name, style },
        { axis: 'y', pos: nyA, minX: x0, maxX: x1, type, name, style },
        { axis: 'x', pos: x1, minY: nyA, maxY: nyB, type: 11, isCap: true, name: 'Canto Puerta', style },
        { axis: 'x', pos: x0, minY: nyA, maxY: nyB, type: 11, isCap: true, name: 'Canto Puerta', style }
      );
    }

    if (has('ODE')) {
      const type = 3;
      const name = 'Puerta Este [E] (Abierta)';
      const style = styleOf('DE');
      faces.push(
        { axis: 'y', pos: nyB, minX: x0, maxX: x1, type, name, style },
        { axis: 'y', pos: nyA, minX: x0, maxX: x1, type, name, style },
        { axis: 'x', pos: x0, minY: nyA, maxY: nyB, type: 11, isCap: true, name: 'Canto Puerta', style },
        { axis: 'x', pos: x1, minY: nyA, maxY: nyB, type: 11, isCap: true, name: 'Canto Puerta', style }
      );
    }

    if (has('ODCH')) {
      const type = 2;
      const name = 'Puerta Central (Abierta)';
      const style = styleOf('DCH');
      faces.push(
        { axis: 'x', pos: wxB, minY: y0, maxY: y1, type, name, style },
        { axis: 'x', pos: wxA, minY: y0, maxY: y1, type, name, style },
        { axis: 'y', pos: y0, minX: wxA, maxX: wxB, type: 11, isCap: true, name: 'Canto Puerta', style },
        { axis: 'y', pos: y1, minX: wxA, maxX: wxB, type: 11, isCap: true, name: 'Canto Puerta', style }
      );
    }

    if (has('ODCV')) {
      const type = 3;
      const name = 'Puerta Central (Abierta)';
      const style = styleOf('DCV');
      faces.push(
        { axis: 'y', pos: nyB, minX: x0, maxX: x1, type, name, style },
        { axis: 'y', pos: nyA, minX: x0, maxX: x1, type, name, style },
        { axis: 'x', pos: x0, minY: nyA, maxY: nyB, type: 11, isCap: true, name: 'Canto Puerta', style },
        { axis: 'x', pos: x1, minY: nyA, maxY: nyB, type: 11, isCap: true, name: 'Canto Puerta', style }
      );
    }

    return faces;
  }

  /**
   * Genera TODAS las variantes de textura de pared/canto y puerta/canto (una por
   * cada estilo disponible en WALL_STYLES/DOOR_STYLES), más la ventana (sin
   * variantes). Cada tipo de textura (1, 2-5, 10, 11) queda como un diccionario
   * { [estilo]: pixeles }, para que cada segmento del mapa pueda usar el suyo
   * propio (ver getSegmentStyle() y su uso en generateCellFaces()).
   */
  generateProceduralTextures() {
    this.textures[1] = {};
    this.textures[10] = {};
    Object.keys(WALL_STYLES).forEach(style => {
      this.textures[1][style] = WALL_STYLES[style].wall(this.textureSize);
      this.textures[10][style] = WALL_STYLES[style].cap(this.textureSize);
    });

    this.textures[2] = {};
    this.textures[3] = {};
    this.textures[4] = {};
    this.textures[5] = {};
    this.textures[11] = {};
    Object.keys(DOOR_STYLES).forEach(style => {
      [2, 3, 4, 5].forEach(type => {
        this.textures[type][style] = DOOR_STYLES[style].door(this.textureSize, this.doorInfo[type]);
      });
      this.textures[11][style] = DOOR_STYLES[style].cap(this.textureSize);
    });

    // Textura 6: Ventana medieval gótica de cristal biselado con cruceta de hierro (sin variantes)
    this.textures[6] = createWindowPixels(this.textureSize);
  }

  /**
   * Estilo con el que se colocó un segmento concreto (pared o puerta) de una celda.
   * 'castillo' por defecto si no hay dato guardado (mapas antiguos o celdas sin estilo).
   */
  getSegmentStyle(mapX, mapY, edgeCode) {
    const cell = this.wallStyleMap[`${mapX},${mapY}`];
    return (cell && cell[edgeCode]) || 'castillo';
  }

  /**
   * Carga una imagen (ruta de archivo o Data URL) y la reescala a textureSize x textureSize
   * para sustituir la textura procedural del tipo indicado. Si la imagen no existe o falla
   * al cargar, se ignora silenciosamente y se conserva la textura anterior (procedural).
   */
  loadTextureImage(type, url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const size = this.textureSize;
        const off = document.createElement('canvas');
        off.width = size;
        off.height = size;
        const octx = off.getContext('2d');
        octx.drawImage(img, 0, 0, size, size);
        this.textures[type] = new Uint32Array(octx.getImageData(0, 0, size, size).data.buffer);
        resolve(true);
      };
      img.onerror = () => resolve(false);
      img.src = url;
    });
  }

  /**
   * Intenta cargar overrides de textura por defecto del proyecto desde src/engine/textures/
   * (wall.png, door_n.png, door_e.png, door_s.png, door_w.png, window.png, cap.png, door_cap.png).
   * Los archivos que no existan se ignoran y se mantiene la textura procedural/de estilo activa.
   */
  loadDefaultTextureOverrides() {
    const base = '/src/engine/textures/';
    const files = {
      1: 'wall.png',
      2: 'door_n.png',
      3: 'door_e.png',
      4: 'door_s.png',
      5: 'door_w.png',
      6: 'window.png',
      10: 'cap.png',
      11: 'door_cap.png'
    };
    return Promise.all(
      Object.entries(files).map(([type, file]) => this.loadTextureImage(Number(type), base + file))
    );
  }

  /**
   * Aplica texturas personalizadas de un mapa concreto (Data URLs guardadas desde el Editor),
   * sustituyendo tanto la textura procedural como cualquier override de proyecto ya cargado.
   */
  applyCustomTextures(customTextures) {
    if (!customTextures) return Promise.resolve();
    return this.textureOverridesReady.then(() =>
      Promise.all(
        Object.entries(customTextures)
          .filter(([, url]) => !!url)
          .map(([type, url]) => this.loadTextureImage(Number(type), url))
      )
    );
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
      let hitStyle = 'castillo';

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
          hitStyle = bestSeg.style || 'castillo';
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
              hitStyle = bestSeg.style || 'castillo';
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
        const isDoor = (hit >= 2 && hit <= 5);
        const isOpenDoor = hitTargetName && hitTargetName.includes('(Abierta)');
        this.facingTarget = {
          name: hitTargetName,
          type: isDoor ? (isOpenDoor ? 'door-open' : 'door') : (hit === 6 ? 'window' : 'wall'),
          distance: perpWallDist.toFixed(1),
          rawDist: perpWallDist,
          hit,
          mapX,
          mapY
        };
      }

      // Altura de la línea proyectada en pantalla
      const lineHeight = Math.floor(h / Math.max(perpWallDist, 0.0001));

      // Píxeles de inicio y fin para dibujar la tira vertical
      let drawStart = -lineHeight / 2 + halfH;
      let drawEnd = lineHeight / 2 + halfH;

      const clipStart = Math.max(0, Math.floor(drawStart));
      const clipEnd = Math.min(h - 1, Math.floor(drawEnd));

      // Cálculo de textura: this.textures[hit] es normalmente un diccionario { estilo: pixeles }
      // (para poder mezclar estilos por segmento); si es un Uint32Array plano es una textura
      // subida/override (imagen personalizada o de proyecto) que sustituye a todos los estilos.
      const rawTex = this.textures[hit] || this.textures[1];
      const tex = (rawTex instanceof Uint32Array) ? rawTex : (rawTex[hitStyle] || rawTex.castillo);
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
          const isWin = code.startsWith('W');
          let doorType = 2;
          if (code === 'DN') doorType = 2;
          else if (code === 'DE') doorType = 3;
          else if (code === 'DS') doorType = 4;
          else if (code === 'DW') doorType = 5;
          else if (code === 'DCH') doorType = 2;
          else if (code === 'DCV') doorType = 3;

          const doorColor = this.doorInfo[doorType]?.color || '#e5a93b';
          if (isDoor) ctx.fillStyle = doorColor;
          else if (isWin) ctx.fillStyle = '#54a0ff';
          else ctx.fillStyle = '#636e72';

          switch (code) {
            case 'N':
            case 'DN':
            case 'WN':
              ctx.fillRect(px, py, cellSize, th);
              break;
            case 'S':
            case 'DS':
            case 'WS':
              ctx.fillRect(px, py + cellSize - th, cellSize, th);
              break;
            case 'W':
            case 'DW':
            case 'WW':
              ctx.fillRect(px, py, th, cellSize);
              break;
            case 'E':
            case 'DE':
            case 'WE':
              ctx.fillRect(px + cellSize - th, py, th, cellSize);
              break;
            case 'CH':
            case 'DCH':
            case 'WCH': {
              const cy0 = py + Math.floor((cellSize - th) / 2);
              ctx.fillRect(px, cy0, cellSize, th);
              break;
            }
            case 'CV':
            case 'DCV':
            case 'WCV': {
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
            // Puertas Abiertas en Minimapa (Abatidas 90° con dimensiones idénticas a cerrada)
            case 'ODN': {
              ctx.fillStyle = this.doorInfo[2]?.color || '#e74c3c';
              ctx.fillRect(px, py, th, cellSize);
              break;
            }
            case 'ODS': {
              ctx.fillStyle = this.doorInfo[4]?.color || '#3498db';
              ctx.fillRect(px, py, th, cellSize);
              break;
            }
            case 'ODW': {
              ctx.fillStyle = this.doorInfo[5]?.color || '#f39c12';
              ctx.fillRect(px, py, cellSize, th);
              break;
            }
            case 'ODE': {
              ctx.fillStyle = this.doorInfo[3]?.color || '#2ecc71';
              ctx.fillRect(px, py, cellSize, th);
              break;
            }
            case 'ODCH': {
              ctx.fillStyle = this.doorInfo[2]?.color || '#e74c3c';
              ctx.fillRect(px, py, th, cellSize);
              break;
            }
            case 'ODCV': {
              ctx.fillStyle = this.doorInfo[3]?.color || '#2ecc71';
              ctx.fillRect(px, py, cellSize, th);
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

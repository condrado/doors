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
    this.wallTexWidth = 64; // Paredes 5x15 nativas: ancho 64px
    this.doorTexWidth = 64; // Puertas 5x10 nativas: ancho 64px
    this.doorTexHeight = 128; // Altura 128px (sin estirar)
    this.doorTexSize = 64; // Retrocompatibilidad
    this.textureSize = 64; // Retrocompatibilidad
    this.textureMode = 'classic'; // 'classic' o 'flat'
    // Proporción alto/ancho: 1.0 = celda cúbica (1.0m x 1.0m = 5x5 submódulos).
    // Paredes completas: 5x15 submódulos = 3.0m de altura (192px).
    // Puertas y vanos: 5x10 submódulos = 2.0m de altura (128px).
    // Dintel superior: 5x5 submódulos = 1.0m de altura (64px, de 2.0m a 3.0m).
    // Coincidencia exacta: 64px (dintel) + 128px (puerta) = 192px (pared).
    this.wallHeightScale = 3.0;
    this.doorHeightScale = 2.0;

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
    if (Array.isArray(cell)) {
      // Migración al vuelo de códigos centrales obsoletos si vinieran de mapas antiguos
      return cell.map(c => (c === 'DCH' || c === 'ODCH') ? 'CH' : (c === 'DCV' || c === 'ODCV') ? 'CV' : c);
    }
    if (cell === 1) return ['N', 'S', 'E', 'W'];
    if (cell >= 2 && cell <= 5) {
      return [(cell === 2) ? 'DN' : (cell === 3) ? 'DE' : (cell === 4) ? 'DS' : 'DW'];
    }
    return [];
  }

  /**
   * Comprueba si una celda vecina continúa la pared en la misma línea perimetral.
   * Retorna: 'wall' (muro/ventana continua), 'door' (puerta cerrada), 'open' (puerta abierta), o null.
   */
  getWallConnection(mapX, mapY, edge) {
    if (mapY < 0 || mapY >= this.mapHeight || mapX < 0 || mapX >= this.mapWidth) return null;
    const codes = this.getCellCodes(mapX, mapY);
    if (!codes || codes.length === 0) return null;

    if (edge === 'N') {
      if (codes.some(c => c === 'N' || c === 'WN')) return 'wall';
      if (codes.includes('DN')) return 'door';
      if (codes.includes('ODN')) return 'open';
    } else if (edge === 'S') {
      if (codes.some(c => c === 'S' || c === 'WS')) return 'wall';
      if (codes.includes('DS')) return 'door';
      if (codes.includes('ODS')) return 'open';
    } else if (edge === 'W') {
      if (codes.some(c => c === 'W' || c === 'WW')) return 'wall';
      if (codes.includes('DW')) return 'door';
      if (codes.includes('ODW')) return 'open';
    } else if (edge === 'E') {
      if (codes.some(c => c === 'E' || c === 'WE')) return 'wall';
      if (codes.includes('DE')) return 'door';
      if (codes.includes('ODE')) return 'open';
    }
    return null;
  }

  /**
   * Invalida la caché de caras/segmentos 3D generados por celda
   */
  clearSegmentsCache() {
    this._cellSegmentsCache = null;
  }

  /**
   * Abre la puerta en (mapX, mapY) dejándola visible en posición abatida (OD*)
   * y transitable para el jugador. Solo aplicable a puertas perimetrales (N, E, S, W).
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
      const doorCodes = ['DN', 'DE', 'DS', 'DW'];
      const foundDoor = cell.find(code => doorCodes.includes(code));
      if (foundDoor) {
        doorOpened = true;
        const typeLetter = foundDoor.replace('D', '');
        const doorNum = (typeLetter === 'N' ? 2 : typeLetter === 'E' ? 3 : typeLetter === 'S' ? 4 : 5);
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
        const dCode = original.find(c => ['DN', 'DE', 'DS', 'DW'].includes(c));
        const num = dCode === 'DN' ? 2 : dCode === 'DE' ? 3 : dCode === 'DS' ? 4 : 5;
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
        return (py + pRad >= y0 && py - pRad <= y0 + 0.20 && px >= x0 - 0.1 && px <= x1 + 0.1);
      case 'ODS':
        return (py + pRad >= y1 - 0.20 && py - pRad <= y1 && px >= x0 - 0.1 && px <= x1 + 0.1);
      case 'ODW':
        return (px + pRad >= x0 && px - pRad <= x0 + 0.20 && py >= y0 - 0.1 && py <= y1 + 0.1);
      case 'ODE':
        return (px + pRad >= x1 - 0.20 && px - pRad <= x1 && py >= y0 - 0.1 && py <= y1 + 0.1);
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
        const isArrClosed = Array.isArray(cell) && cell.some(c => ['DN', 'DE', 'DS', 'DW'].includes(c));
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


    // Grosor de pared, dintel y puerta: 0.10 m (proporción 1/10 de la celda)
    const nyA = mapY;
    const nyB = mapY + 0.10;
    const syA = mapY + 0.90;
    const syB = mapY + 1.0;
    const wxA = mapX;
    const wxB = mapX + 0.10;
    const exA = mapX + 0.90;
    const exB = mapX + 1.0;

    // Centros (0.45..0.55 = grosor 0.10 m centrado exactamente en el eje 0.50)
    const cxA = mapX + 0.45;
    const cxB = mapX + 0.55;
    const cyA = mapY + 0.45;
    const cyB = mapY + 0.55;

    const odwxA = wxA;
    const odwxB = wxB;
    const odnyA = nyA;
    const odnyB = nyB;

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

    // 1. PUERTAS CERRADAS (DN, DS, DW, DE) CON GROSOR DE 1/10 DE CELDA (0.10m)
    if (has('DN')) {
      const type = 2;
      const name = 'Puerta Norte';
      const style = styleOf('DN');
      const lintelStyle = styleOf('DN_lintel');
      const westConn = this.getWallConnection(mapX - 1, mapY, 'N');
      const eastConn = this.getWallConnection(mapX + 1, mapY, 'N');

      // Hoja de la puerta (0.10m de grosor = 1/10 de celda)
      faces.push(
        { axis: 'y', pos: nyB, minX: x0, maxX: x1, type, name, style, lintelStyle },
        { axis: 'y', pos: nyA, minX: x0, maxX: x1, type, name, style, lintelStyle }
      );
      if (!westConn) {
        faces.push({ axis: 'x', pos: x0, minY: nyA, maxY: nyB, type: 11, isCap: true, name: 'Canto Oeste', style, lintelStyle });
      } else if (westConn === 'open') {
        faces.push({ axis: 'x', pos: x0, minY: nyA, maxY: nyB, type: 10, isCap: true, isJamb: true, name: 'Jamba Oeste', style, lintelStyle });
      }
      if (!eastConn) {
        faces.push({ axis: 'x', pos: x1, minY: nyA, maxY: nyB, type: 11, isCap: true, name: 'Canto Este', style, lintelStyle });
      } else if (eastConn === 'open') {
        faces.push({ axis: 'x', pos: x1, minY: nyA, maxY: nyB, type: 10, isCap: true, isJamb: true, name: 'Jamba Este', style, lintelStyle });
      }
      // Dintel superior (0.10m de grosor enrasado con las paredes)
      faces.push(
        { axis: 'y', pos: nyB, minX: x0, maxX: x1, type: 1, isLintelOnly: true, name: 'Dintel Puerta Norte', style: lintelStyle },
        { axis: 'y', pos: nyA, minX: x0, maxX: x1, type: 1, isLintelOnly: true, name: 'Dintel Puerta Norte', style: lintelStyle }
      );
      if (!westConn) {
        faces.push({ axis: 'x', pos: x0, minY: nyA, maxY: nyB, type: 10, isCap: true, isLintelOnly: true, name: 'Canto Dintel Oeste', style: lintelStyle });
      }
      if (!eastConn) {
        faces.push({ axis: 'x', pos: x1, minY: nyA, maxY: nyB, type: 10, isCap: true, isLintelOnly: true, name: 'Canto Dintel Este', style: lintelStyle });
      }
    }

    if (has('DS')) {
      const type = 4;
      const name = 'Puerta Sur';
      const style = styleOf('DS');
      const lintelStyle = styleOf('DS_lintel');
      const westConn = this.getWallConnection(mapX - 1, mapY, 'S');
      const eastConn = this.getWallConnection(mapX + 1, mapY, 'S');

      // Hoja de la puerta (0.10m de grosor = 1/10 de celda)
      faces.push(
        { axis: 'y', pos: syA, minX: x0, maxX: x1, type, name, style, lintelStyle },
        { axis: 'y', pos: syB, minX: x0, maxX: x1, type, name, style, lintelStyle }
      );
      if (!westConn) {
        faces.push({ axis: 'x', pos: x0, minY: syA, maxY: syB, type: 11, isCap: true, name: 'Canto Oeste', style, lintelStyle });
      } else if (westConn === 'open') {
        faces.push({ axis: 'x', pos: x0, minY: syA, maxY: syB, type: 10, isCap: true, isJamb: true, name: 'Jamba Oeste', style, lintelStyle });
      }
      if (!eastConn) {
        faces.push({ axis: 'x', pos: x1, minY: syA, maxY: syB, type: 11, isCap: true, name: 'Canto Este', style, lintelStyle });
      } else if (eastConn === 'open') {
        faces.push({ axis: 'x', pos: x1, minY: syA, maxY: syB, type: 10, isCap: true, isJamb: true, name: 'Jamba Este', style, lintelStyle });
      }
      // Dintel superior
      faces.push(
        { axis: 'y', pos: syA, minX: x0, maxX: x1, type: 1, isLintelOnly: true, name: 'Dintel Puerta Sur', style: lintelStyle },
        { axis: 'y', pos: syB, minX: x0, maxX: x1, type: 1, isLintelOnly: true, name: 'Dintel Puerta Sur', style: lintelStyle }
      );
      if (!westConn) {
        faces.push({ axis: 'x', pos: x0, minY: syA, maxY: syB, type: 10, isCap: true, isLintelOnly: true, name: 'Canto Dintel Oeste', style: lintelStyle });
      }
      if (!eastConn) {
        faces.push({ axis: 'x', pos: x1, minY: syA, maxY: syB, type: 10, isCap: true, isLintelOnly: true, name: 'Canto Dintel Este', style: lintelStyle });
      }
    }

    if (has('DW')) {
      const type = 5;
      const name = 'Puerta Oeste';
      const style = styleOf('DW');
      const lintelStyle = styleOf('DW_lintel');
      const northConn = this.getWallConnection(mapX, mapY - 1, 'W');
      const southConn = this.getWallConnection(mapX, mapY + 1, 'W');

      // Hoja de la puerta (0.10m de grosor = 1/10 de celda)
      faces.push(
        { axis: 'x', pos: wxB, minY: y0, maxY: y1, type, name, style, lintelStyle },
        { axis: 'x', pos: wxA, minY: y0, maxY: y1, type, name, style, lintelStyle }
      );
      if (!northConn) {
        faces.push({ axis: 'y', pos: y0, minX: wxA, maxX: wxB, type: 11, isCap: true, name: 'Canto Norte', style, lintelStyle });
      } else if (northConn === 'open') {
        faces.push({ axis: 'y', pos: y0, minX: wxA, maxX: wxB, type: 10, isCap: true, isJamb: true, name: 'Jamba Norte', style, lintelStyle });
      }
      if (!southConn) {
        faces.push({ axis: 'y', pos: y1, minX: wxA, maxX: wxB, type: 11, isCap: true, name: 'Canto Sur', style, lintelStyle });
      } else if (southConn === 'open') {
        faces.push({ axis: 'y', pos: y1, minX: wxA, maxX: wxB, type: 10, isCap: true, isJamb: true, name: 'Jamba Sur', style, lintelStyle });
      }
      // Dintel superior
      faces.push(
        { axis: 'x', pos: wxB, minY: y0, maxY: y1, type: 1, isLintelOnly: true, name: 'Dintel Puerta Oeste', style: lintelStyle },
        { axis: 'x', pos: wxA, minY: y0, maxY: y1, type: 1, isLintelOnly: true, name: 'Dintel Puerta Oeste', style: lintelStyle }
      );
      if (!northConn) {
        faces.push({ axis: 'y', pos: y0, minX: wxA, maxX: wxB, type: 10, isCap: true, isLintelOnly: true, name: 'Canto Dintel Norte', style: lintelStyle });
      }
      if (!southConn) {
        faces.push({ axis: 'y', pos: y1, minX: wxA, maxX: wxB, type: 10, isCap: true, isLintelOnly: true, name: 'Canto Dintel Sur', style: lintelStyle });
      }
    }

    if (has('DE')) {
      const type = 3;
      const name = 'Puerta Este';
      const style = styleOf('DE');
      const lintelStyle = styleOf('DE_lintel');
      const northConn = this.getWallConnection(mapX, mapY - 1, 'E');
      const southConn = this.getWallConnection(mapX, mapY + 1, 'E');

      // Hoja de la puerta (0.10m de grosor = 1/10 de celda)
      faces.push(
        { axis: 'x', pos: exA, minY: y0, maxY: y1, type, name, style, lintelStyle },
        { axis: 'x', pos: exB, minY: y0, maxY: y1, type, name, style, lintelStyle }
      );
      if (!northConn) {
        faces.push({ axis: 'y', pos: y0, minX: exA, maxX: exB, type: 11, isCap: true, name: 'Canto Norte', style, lintelStyle });
      } else if (northConn === 'open') {
        faces.push({ axis: 'y', pos: y0, minX: exA, maxX: exB, type: 10, isCap: true, isJamb: true, name: 'Jamba Norte', style, lintelStyle });
      }
      if (!southConn) {
        faces.push({ axis: 'y', pos: y1, minX: exA, maxX: exB, type: 11, isCap: true, name: 'Canto Sur', style, lintelStyle });
      } else if (southConn === 'open') {
        faces.push({ axis: 'y', pos: y1, minX: exA, maxX: exB, type: 10, isCap: true, isJamb: true, name: 'Jamba Sur', style, lintelStyle });
      }
      // Dintel superior
      faces.push(
        { axis: 'x', pos: exA, minY: y0, maxY: y1, type: 1, isLintelOnly: true, name: 'Dintel Puerta Este', style: lintelStyle },
        { axis: 'x', pos: exB, minY: y0, maxY: y1, type: 1, isLintelOnly: true, name: 'Dintel Puerta Este', style: lintelStyle }
      );
      if (!northConn) {
        faces.push({ axis: 'y', pos: y0, minX: exA, maxX: exB, type: 10, isCap: true, isLintelOnly: true, name: 'Canto Dintel Norte', style: lintelStyle });
      }
      if (!southConn) {
        faces.push({ axis: 'y', pos: y1, minX: exA, maxX: exB, type: 10, isCap: true, isLintelOnly: true, name: 'Canto Dintel Sur', style: lintelStyle });
      }
    }

    // 2. MODELO DE SUBGRIS 5x5 PARA TODAS LAS PAREDES (ORDEN DE COLOCACIÓN ESTRICTO)
    // Coordenadas submétricas de los 5 intervalos (grosor 0.10 m = 1/10 de celda)
    // Intervalo 0: 0.00 a 0.10 (Pared Oeste / Norte)
    // Intervalo 1: 0.10 a 0.45 (Hueco)
    // Intervalo 2: 0.45 a 0.55 (Eje Central CH / CV, centrado exactamente en 0.50)
    // Intervalo 3: 0.55 a 0.90 (Hueco)
    // Intervalo 4: 0.90 a 1.00 (Pared Este / Sur)
    const xCoords = [x0, x0 + 0.10, x0 + 0.45, x0 + 0.55, x0 + 0.90, x1];
    const yCoords = [y0, y0 + 0.10, y0 + 0.45, y0 + 0.55, y0 + 0.90, y1];

    const WALL_FOOTPRINTS = {
      'N':   { r0: 0, r1: 0, c0: 0, c1: 4, axis: 'H', edge: 'N' },
      'S':   { r0: 4, r1: 4, c0: 0, c1: 4, axis: 'H', edge: 'S' },
      'W':   { r0: 0, r1: 4, c0: 0, c1: 0, axis: 'V', edge: 'W' },
      'E':   { r0: 0, r1: 4, c0: 4, c1: 4, axis: 'V', edge: 'E' },
      'CH':  { r0: 2, r1: 2, c0: 0, c1: 4, axis: 'H' },
      'CV':  { r0: 0, r1: 4, c0: 2, c1: 2, axis: 'V' },
      'CN':  { r0: 0, r1: 2, c0: 2, c1: 2, axis: 'V' },
      'CS':  { r0: 2, r1: 4, c0: 2, c1: 2, axis: 'V' },
      'CW':  { r0: 2, r1: 2, c0: 0, c1: 2, axis: 'H' },
      'CE':  { r0: 2, r1: 2, c0: 2, c1: 4, axis: 'H' },
      'RNW': { r0: 0, r1: 0, c0: 0, c1: 0, isCorner1x1: true },
      'RNE': { r0: 0, r1: 0, c0: 4, c1: 4, isCorner1x1: true },
      'RSW': { r0: 4, r1: 4, c0: 0, c1: 0, isCorner1x1: true },
      'RSE': { r0: 4, r1: 4, c0: 4, c1: 4, isCorner1x1: true },
      'WN':  { r0: 0, r1: 0, c0: 0, c1: 4, axis: 'H', isWin: true, edge: 'N' },
      'WS':  { r0: 4, r1: 4, c0: 0, c1: 4, axis: 'H', isWin: true, edge: 'S' },
      'WW':  { r0: 0, r1: 4, c0: 0, c1: 0, axis: 'V', isWin: true, edge: 'W' },
      'WE':  { r0: 0, r1: 4, c0: 4, c1: 4, axis: 'V', isWin: true, edge: 'E' },
      'WCH': { r0: 2, r1: 2, c0: 0, c1: 4, axis: 'H', isWin: true },
      'WCV': { r0: 0, r1: 4, c0: 2, c1: 2, axis: 'V', isWin: true },
    };

    const expandedCodes = [];
    const cornerMap = {
      'corner_FULL_BOX': ['N', 'S', 'E', 'W'],
      'corner_NW': ['N', 'W'],
      'corner_NE': ['N', 'E'],
      'corner_SW': ['S', 'W'],
      'corner_SE': ['S', 'E'],
      'corner_CH_W': ['CH', 'W'],
      'corner_CH_E': ['CH', 'E'],
      'corner_CV_N': ['CV', 'N'],
      'corner_CV_S': ['CV', 'S'],
      'corner_CH_W_full': ['CH', 'W'],
      'corner_CH_E_full': ['CH', 'E'],
      'corner_CENTER_CROSS': ['CH', 'CV'],
      'corner_CENTER_NW': ['CN', 'CW'],
      'corner_CENTER_NE': ['CN', 'CE'],
      'corner_CENTER_SW': ['CS', 'CW'],
      'corner_CENTER_SE': ['CS', 'CE'],
      'corner_T_INT_N': ['CH', 'CN'],
      'corner_T_INT_S': ['CH', 'CS'],
      'corner_T_INT_W': ['CV', 'CW'],
      'corner_T_INT_E': ['CV', 'CE']
    };
    for (const c of codes) {
      if (cornerMap[c]) {
        expandedCodes.push(...cornerMap[c]);
      } else {
        expandedCodes.push(c);
      }
    }

    const subgrid = Array.from({ length: 5 }, () => new Array(5).fill(null));

    // Si hay puertas cerradas o abiertas, marcar su huella para que los muros se conecten a ella
    if (has('DN') || has('ODN')) {
      for (let c = 0; c < 5; c++) subgrid[0][c] = { isDoor: true, axis: 'H' };
    }
    if (has('DS') || has('ODS')) {
      for (let c = 0; c < 5; c++) subgrid[4][c] = { isDoor: true, axis: 'H' };
    }
    if (has('DW') || has('ODW')) {
      for (let r = 0; r < 5; r++) subgrid[r][0] = { isDoor: true, axis: 'V' };
    }
    if (has('DE') || has('ODE')) {
      for (let r = 0; r < 5; r++) subgrid[r][4] = { isDoor: true, axis: 'V' };
    }

    // Pintar cada pieza en el orden de colocación (la última pisa a las anteriores)
    for (const code of expandedCodes) {
      const fp = WALL_FOOTPRINTS[code];
      if (!fp) continue;
      const style = styleOf(code);
      for (let r = fp.r0; r <= fp.r1; r++) {
        for (let c = fp.c0; c <= fp.c1; c++) {
          subgrid[r][c] = {
            code,
            style,
            isWin: !!fp.isWin,
            axis: fp.axis,
            isCorner1x1: !!fp.isCorner1x1,
            edge: fp.edge
          };
        }
      }
    }

    // Generar caras horizontales (eje 'y' en k = 0..5)
    for (let k = 0; k <= 5; k++) {
      let currentSeg = null;

      for (let c = 0; c < 5; c++) {
        const above = (k > 0) ? subgrid[k - 1][c] : null;
        const below = (k < 5) ? subgrid[k][c] : null;

        // Si ambos están ocupados (muro continuo) o ambos vacíos: no hay cara
        if ((above !== null && below !== null) || (above === null && below === null)) {
          if (currentSeg) {
            faces.push(currentSeg);
            currentSeg = null;
          }
          continue;
        }

        const owner = above || below;
        if (owner.isDoor) {
          if (currentSeg) {
            faces.push(currentSeg);
            currentSeg = null;
          }
          continue;
        }

        let isCap = false;
        let type = owner.isWin ? 6 : 1;

        if (k === 0 && owner.axis === 'V') {
          isCap = true;
          type = 10;
        } else if (k === 5 && owner.axis === 'V') {
          isCap = true;
          type = 10;
        }

        // Si es canto en el borde exterior y hay pared vecina continuando, no generar canto ciego
        if (isCap) {
          if (k === 0 && c === 0) {
            const conn = this.getWallConnection(mapX, mapY - 1, 'W');
            if (conn === 'wall') continue;
          } else if (k === 0 && c === 4) {
            const conn = this.getWallConnection(mapX, mapY - 1, 'E');
            if (conn === 'wall') continue;
          } else if (k === 5 && c === 0) {
            const conn = this.getWallConnection(mapX, mapY + 1, 'W');
            if (conn === 'wall') continue;
          } else if (k === 5 && c === 4) {
            const conn = this.getWallConnection(mapX, mapY + 1, 'E');
            if (conn === 'wall') continue;
          }
        }

        const segMinX = xCoords[c];
        const segMaxX = xCoords[c + 1];

        if (
          currentSeg &&
          currentSeg.pos === yCoords[k] &&
          currentSeg.type === type &&
          currentSeg.style === owner.style &&
          currentSeg.isCap === isCap &&
          Math.abs(currentSeg.maxX - segMinX) < 1e-5
        ) {
          currentSeg.maxX = segMaxX;
        } else {
          if (currentSeg) faces.push(currentSeg);
          currentSeg = {
            axis: 'y',
            pos: yCoords[k],
            minX: segMinX,
            maxX: segMaxX,
            type,
            style: owner.style,
            isCap,
            name: isCap ? (k === 0 ? 'Canto Norte' : 'Canto Sur') : 'Pared (H)'
          };
        }
      }

      if (currentSeg) {
        faces.push(currentSeg);
      }
    }

    // Generar caras verticales (eje 'x' en k = 0..5)
    for (let k = 0; k <= 5; k++) {
      let currentSeg = null;

      for (let r = 0; r < 5; r++) {
        const left = (k > 0) ? subgrid[r][k - 1] : null;
        const right = (k < 5) ? subgrid[r][k] : null;

        if ((left !== null && right !== null) || (left === null && right === null)) {
          if (currentSeg) {
            faces.push(currentSeg);
            currentSeg = null;
          }
          continue;
        }

        const owner = left || right;
        if (owner.isDoor) {
          if (currentSeg) {
            faces.push(currentSeg);
            currentSeg = null;
          }
          continue;
        }

        let isCap = false;
        let type = owner.isWin ? 6 : 1;

        if (k === 0 && owner.axis === 'H') {
          isCap = true;
          type = 10;
        } else if (k === 5 && owner.axis === 'H') {
          isCap = true;
          type = 10;
        }

        // Si es canto en el borde exterior y hay pared vecina continuando, no generar canto ciego
        if (isCap) {
          if (k === 0 && r === 0) {
            const conn = this.getWallConnection(mapX - 1, mapY, 'N');
            if (conn === 'wall') continue;
          } else if (k === 0 && r === 4) {
            const conn = this.getWallConnection(mapX - 1, mapY, 'S');
            if (conn === 'wall') continue;
          } else if (k === 5 && r === 0) {
            const conn = this.getWallConnection(mapX + 1, mapY, 'N');
            if (conn === 'wall') continue;
          } else if (k === 5 && r === 4) {
            const conn = this.getWallConnection(mapX + 1, mapY, 'S');
            if (conn === 'wall') continue;
          }
        }

        const segMinY = yCoords[r];
        const segMaxY = yCoords[r + 1];

        if (
          currentSeg &&
          currentSeg.pos === xCoords[k] &&
          currentSeg.type === type &&
          currentSeg.style === owner.style &&
          currentSeg.isCap === isCap &&
          Math.abs(currentSeg.maxY - segMinY) < 1e-5
        ) {
          currentSeg.maxY = segMaxY;
        } else {
          if (currentSeg) faces.push(currentSeg);
          currentSeg = {
            axis: 'x',
            pos: xCoords[k],
            minY: segMinY,
            maxY: segMaxY,
            type,
            style: owner.style,
            isCap,
            name: isCap ? (k === 0 ? 'Canto Oeste' : 'Canto Este') : 'Pared (V)'
          };
        }
      }

      if (currentSeg) {
        faces.push(currentSeg);
      }
    }

    // 6. PUERTAS ABIERTAS (HOJA ABATIDA A 90° CON GROSOR DE 1/10 DE CELDA: 1.0x0.10)
    // El estilo (y el estilo de dintel) se toma del código de la puerta CERRADA
    // --------------------------------------------------------------------------------------
    if (has('ODN')) {
      const type = 2;
      const name = 'Puerta Norte [N] (Abierta)';
      const style = styleOf('DN');
      const lintelStyleN = styleOf('DN_lintel');
      const westConn = this.getWallConnection(mapX - 1, mapY, 'N');
      const eastConn = this.getWallConnection(mapX + 1, mapY, 'N');

      // Hoja abatida (0.10m de grosor plegada contra el muro oeste)
      faces.push(
        { axis: 'x', pos: odwxB, minY: y0, maxY: y1, type, name, style, isOpenDoor: true, lintelStyle: lintelStyleN },
        { axis: 'x', pos: odwxA, minY: y0, maxY: y1, type, name, style, isOpenDoor: true, lintelStyle: lintelStyleN },
        { axis: 'y', pos: y1, minX: odwxA, maxX: odwxB, type: 11, isCap: true, name: 'Canto Puerta (Abierta)', isOpenDoor: true, style, lintelStyle: lintelStyleN },
        { axis: 'y', pos: y0, minX: odwxA, maxX: odwxB, type: 11, isCap: true, name: 'Canto Puerta (Abierta)', isOpenDoor: true, style, lintelStyle: lintelStyleN }
      );
      // Dintel en el vano original que queda despejado para el paso del jugador
      faces.push(
        { axis: 'y', pos: nyB, minX: x0, maxX: x1, type: 1, isLintelOnly: true, name: 'Dintel Puerta Norte', style: lintelStyleN },
        { axis: 'y', pos: nyA, minX: x0, maxX: x1, type: 1, isLintelOnly: true, name: 'Dintel Puerta Norte', style: lintelStyleN }
      );
      if (!westConn) {
        faces.push({ axis: 'x', pos: x0, minY: nyA, maxY: nyB, type: 10, isCap: true, isLintelOnly: true, name: 'Canto Dintel Oeste', style: lintelStyleN });
        faces.push({ axis: 'x', pos: x0, minY: nyA, maxY: nyB, type: 10, isCap: true, isJamb: true, name: 'Jamba Oeste', style: lintelStyleN });
      }
      if (!eastConn) {
        faces.push({ axis: 'x', pos: x1, minY: nyA, maxY: nyB, type: 10, isCap: true, isLintelOnly: true, name: 'Canto Dintel Este', style: lintelStyleN });
        faces.push({ axis: 'x', pos: x1, minY: nyA, maxY: nyB, type: 10, isCap: true, isJamb: true, name: 'Jamba Este', style: lintelStyleN });
      }
    }

    if (has('ODS')) {
      const type = 4;
      const name = 'Puerta Sur [S] (Abierta)';
      const style = styleOf('DS');
      const lintelStyleS = styleOf('DS_lintel');
      const westConn = this.getWallConnection(mapX - 1, mapY, 'S');
      const eastConn = this.getWallConnection(mapX + 1, mapY, 'S');

      // Hoja abatida (0.10m de grosor plegada contra el muro oeste)
      faces.push(
        { axis: 'x', pos: odwxB, minY: y0, maxY: y1, type, name, style, isOpenDoor: true, lintelStyle: lintelStyleS },
        { axis: 'x', pos: odwxA, minY: y0, maxY: y1, type, name, style, isOpenDoor: true, lintelStyle: lintelStyleS },
        { axis: 'y', pos: y0, minX: odwxA, maxX: odwxB, type: 11, isCap: true, name: 'Canto Puerta (Abierta)', isOpenDoor: true, style, lintelStyle: lintelStyleS },
        { axis: 'y', pos: y1, minX: odwxA, maxX: odwxB, type: 11, isCap: true, name: 'Canto Puerta (Abierta)', isOpenDoor: true, style, lintelStyle: lintelStyleS }
      );
      faces.push(
        { axis: 'y', pos: syA, minX: x0, maxX: x1, type: 1, isLintelOnly: true, name: 'Dintel Puerta Sur', style: lintelStyleS },
        { axis: 'y', pos: syB, minX: x0, maxX: x1, type: 1, isLintelOnly: true, name: 'Dintel Puerta Sur', style: lintelStyleS }
      );
      if (!westConn) {
        faces.push({ axis: 'x', pos: x0, minY: syA, maxY: syB, type: 10, isCap: true, isLintelOnly: true, name: 'Canto Dintel Oeste', style: lintelStyleS });
        faces.push({ axis: 'x', pos: x0, minY: syA, maxY: syB, type: 10, isCap: true, isJamb: true, name: 'Jamba Oeste', style: lintelStyleS });
      }
      if (!eastConn) {
        faces.push({ axis: 'x', pos: x1, minY: syA, maxY: syB, type: 10, isCap: true, isLintelOnly: true, name: 'Canto Dintel Este', style: lintelStyleS });
        faces.push({ axis: 'x', pos: x1, minY: syA, maxY: syB, type: 10, isCap: true, isJamb: true, name: 'Jamba Este', style: lintelStyleS });
      }
    }

    if (has('ODW')) {
      const type = 5;
      const name = 'Puerta Oeste [O] (Abierta)';
      const style = styleOf('DW');
      const lintelStyleW = styleOf('DW_lintel');
      const northConn = this.getWallConnection(mapX, mapY - 1, 'W');
      const southConn = this.getWallConnection(mapX, mapY + 1, 'W');

      // Hoja abatida (0.10m de grosor plegada contra el muro norte)
      faces.push(
        { axis: 'y', pos: odnyB, minX: x0, maxX: x1, type, name, style, isOpenDoor: true, lintelStyle: lintelStyleW },
        { axis: 'y', pos: odnyA, minX: x0, maxX: x1, type, name, style, isOpenDoor: true, lintelStyle: lintelStyleW },
        { axis: 'x', pos: x1, minY: odnyA, maxY: odnyB, type: 11, isCap: true, name: 'Canto Puerta (Abierta)', isOpenDoor: true, style, lintelStyle: lintelStyleW },
        { axis: 'x', pos: x0, minY: odnyA, maxY: odnyB, type: 11, isCap: true, name: 'Canto Puerta (Abierta)', isOpenDoor: true, style, lintelStyle: lintelStyleW }
      );
      faces.push(
        { axis: 'x', pos: wxB, minY: y0, maxY: y1, type: 1, isLintelOnly: true, name: 'Dintel Puerta Oeste', style: lintelStyleW },
        { axis: 'x', pos: wxA, minY: y0, maxY: y1, type: 1, isLintelOnly: true, name: 'Dintel Puerta Oeste', style: lintelStyleW }
      );
      if (!northConn) {
        faces.push({ axis: 'y', pos: y0, minX: wxA, maxX: wxB, type: 10, isCap: true, isLintelOnly: true, name: 'Canto Dintel Norte', style: lintelStyleW });
        faces.push({ axis: 'y', pos: y0, minX: wxA, maxX: wxB, type: 10, isCap: true, isJamb: true, name: 'Jamba Norte', style: lintelStyleW });
      }
      if (!southConn) {
        faces.push({ axis: 'y', pos: y1, minX: wxA, maxX: wxB, type: 10, isCap: true, isLintelOnly: true, name: 'Canto Dintel Sur', style: lintelStyleW });
        faces.push({ axis: 'y', pos: y1, minX: wxA, maxX: wxB, type: 10, isCap: true, isJamb: true, name: 'Jamba Sur', style: lintelStyleW });
      }
    }

    if (has('ODE')) {
      const type = 3;
      const name = 'Puerta Este [E] (Abierta)';
      const style = styleOf('DE');
      const lintelStyleE = styleOf('DE_lintel');
      const northConn = this.getWallConnection(mapX, mapY - 1, 'E');
      const southConn = this.getWallConnection(mapX, mapY + 1, 'E');

      // Hoja abatida (0.10m de grosor plegada contra el muro norte)
      faces.push(
        { axis: 'y', pos: odnyB, minX: x0, maxX: x1, type, name, style, isOpenDoor: true, lintelStyle: lintelStyleE },
        { axis: 'y', pos: odnyA, minX: x0, maxX: x1, type, name, style, isOpenDoor: true, lintelStyle: lintelStyleE },
        { axis: 'x', pos: x0, minY: odnyA, maxY: odnyB, type: 11, isCap: true, name: 'Canto Puerta (Abierta)', isOpenDoor: true, style, lintelStyle: lintelStyleE },
        { axis: 'x', pos: x1, minY: odnyA, maxY: odnyB, type: 11, isCap: true, name: 'Canto Puerta (Abierta)', isOpenDoor: true, style, lintelStyle: lintelStyleE }
      );
      faces.push(
        { axis: 'x', pos: exA, minY: y0, maxY: y1, type: 1, isLintelOnly: true, name: 'Dintel Puerta Este', style: lintelStyleE },
        { axis: 'x', pos: exB, minY: y0, maxY: y1, type: 1, isLintelOnly: true, name: 'Dintel Puerta Este', style: lintelStyleE }
      );
      if (!northConn) {
        faces.push({ axis: 'y', pos: y0, minX: exA, maxX: exB, type: 10, isCap: true, isLintelOnly: true, name: 'Canto Dintel Norte', style: lintelStyleE });
        faces.push({ axis: 'y', pos: y0, minX: exA, maxX: exB, type: 10, isCap: true, isJamb: true, name: 'Jamba Norte', style: lintelStyleE });
      }
      if (!southConn) {
        faces.push({ axis: 'y', pos: y1, minX: exA, maxX: exB, type: 10, isCap: true, isLintelOnly: true, name: 'Canto Dintel Sur', style: lintelStyleE });
        faces.push({ axis: 'y', pos: y1, minX: exA, maxX: exB, type: 10, isCap: true, isJamb: true, name: 'Jamba Sur', style: lintelStyleE });
      }
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
      this.textures[1][style] = WALL_STYLES[style].wall(64, 192);
      this.textures[10][style] = WALL_STYLES[style].cap(64, 192);
    });

    this.textures[2] = {};
    this.textures[3] = {};
    this.textures[4] = {};
    this.textures[5] = {};
    this.textures[11] = {};
    Object.keys(DOOR_STYLES).forEach(style => {
      [2, 3, 4, 5].forEach(type => {
        this.textures[type][style] = DOOR_STYLES[style].door(64, 128);
      });
      this.textures[11][style] = DOOR_STYLES[style].cap(64, 192);
    });

    // Textura 6: Ventana medieval de 64x192 (dintel + hueco + antepecho, sin variantes)
    this.textures[6] = createWindowPixels(64, 192);
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
   * Carga una imagen (ruta de archivo o Data URL) y la reescala a su tamaño correspondiente
   * (64x192 para pared/canto/ventana, 64x128 para puerta) para sustituir la textura procedural.
   */
  loadTextureImage(type, url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const isDoor = (type >= 2 && type <= 5);
        const w = 64;
        const h = isDoor ? 128 : 192;
        const off = document.createElement('canvas');
        off.width = w;
        off.height = h;
        const octx = off.getContext('2d');
        octx.drawImage(img, 0, 0, w, h);
        const arr = new Uint32Array(octx.getImageData(0, 0, w, h).data.buffer);
        arr.width = w;
        arr.height = h;
        this.textures[type] = arr;
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
   * Intersecta un rayo con los segmentos de una celda.
   * Separa el impacto inferior (suelo a 2.2m o 3.0m: puertas/paredes)
   * del impacto en dintel (2.2m a 3.0m: isLintelOnly).
   */
  _intersectCellSegments(segments, posX, posY, rayDirX, rayDirY, mapX, mapY, minDist = 0.001) {
    let bestBottom = null;
    let bestLintel = null;

    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s];
      let dist, hitCoord, minB, maxB, side;

      if (seg.axis === 'y') {
        if (Math.abs(rayDirY) <= 1e-6) continue;
        dist = (seg.pos - posY) / rayDirY;
        if (dist <= minDist) continue;
        hitCoord = posX + dist * rayDirX;
        minB = seg.minX !== undefined ? seg.minX : (mapX - 0.02);
        maxB = seg.maxX !== undefined ? seg.maxX : (mapX + 1.02);
        side = 1;
      } else {
        if (Math.abs(rayDirX) <= 1e-6) continue;
        dist = (seg.pos - posX) / rayDirX;
        if (dist <= minDist) continue;
        hitCoord = posY + dist * rayDirY;
        minB = seg.minY !== undefined ? seg.minY : (mapY - 0.02);
        maxB = seg.maxY !== undefined ? seg.maxY : (mapY + 1.02);
        side = 0;
      }
      if (hitCoord < minB || hitCoord > maxB) continue;

      let wallX;
      if (seg.isCap) {
        const span = Math.max(0.001, maxB - minB);
        wallX = Math.max(0, Math.min(0.999, (hitCoord - minB) / span));
      } else {
        wallX = hitCoord - Math.floor(hitCoord);
      }

      const isLintel = !!seg.isLintelOnly;
      const isOpenDoor = !!seg.isOpenDoor;
      const isDoor = ((seg.type >= 2 && seg.type <= 5) || seg.type === 11 || seg.isJamb) && !isLintel;
      const isTransparent = (seg.style === 'cristal');
      const hitData = { seg, dist, wallX, side, isDoor, isLintel, isOpenDoor, isTransparent, mapX, mapY };

      if (isLintel) {
        if (!bestLintel || dist < bestLintel.dist) {
          bestLintel = hitData;
        }
      } else {
        if (!bestBottom || dist < bestBottom.dist) {
          bestBottom = hitData;
        }
      }
    }

    return { bestBottom, bestLintel };
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

      let hitBottom = null;
      let hitOpenDoor = null;
      const hitLintels = [];
      const hitTransparents = [];

      const recordCellIntersects = (res) => {
        if (res.bestLintel) {
          if (!hitLintels.some(l => Math.abs(l.dist - res.bestLintel.dist) < 0.01)) {
            hitLintels.push(res.bestLintel);
          }
        }
        if (res.bestBottom) {
          if (res.bestBottom.isOpenDoor) {
            if (!hitOpenDoor || res.bestBottom.dist < hitOpenDoor.dist) {
              hitOpenDoor = res.bestBottom;
            }
            // La hoja abatida de una puerta abierta sólo cubre de 0 a 2.2m.
            // Arriba (2.2 a 3.0m) la vista continúa libre hacia la pared del fondo,
            // por lo que NO detenemos el rayo DDA.
            return false;
          } else if (res.bestBottom.isTransparent) {
            // Superficie translúcida (pared o puerta de cristal):
            // Acumulamos el impacto para renderizarlo con alpha blending
            // y dejamos que el rayo DDA continúe avanzando para ver qué hay detrás
            if (!hitTransparents.some(t => Math.abs(t.dist - res.bestBottom.dist) < 0.01)) {
              hitTransparents.push(res.bestBottom);
            }
            return false;
          } else {
            hitBottom = res.bestBottom;
            return true;
          }
        }
        return false;
      };

      // Comprobar primero si hay un tabique frente al jugador en su propia celda de inicio
      const startCellSegs = this.getCellSegments(mapX, mapY);
      if (startCellSegs.length > 0) {
        const res = this._intersectCellSegments(startCellSegs, posX, posY, rayDirX, rayDirY, mapX, mapY, 0.05);
        recordCellIntersects(res);
      }

      // Ejecutar DDA avanzando celdas hasta encontrar un obstáculo en el suelo (hitBottom)
      let ddaSteps = 0;
      const maxSteps = (this.mapWidth + this.mapHeight) * 2;
      while (!hitBottom && ddaSteps++ < maxSteps) {
        if (sideDistX < sideDistY) {
          sideDistX += deltaDistX;
          mapX += stepX;
          side = 0;
        } else {
          sideDistY += deltaDistY;
          mapY += stepY;
          side = 1;
        }

        // Comprobar si golpeó una pared, puerta o dintel dentro del mapa
        if (mapX >= 0 && mapX < this.mapWidth && mapY >= 0 && mapY < this.mapHeight) {
          const segments = this.getCellSegments(mapX, mapY);
          if (segments.length > 0) {
            const res = this._intersectCellSegments(segments, posX, posY, rayDirX, rayDirY, mapX, mapY, 0.001);
            recordCellIntersects(res);
          }
        } else {
          // Muro perimetral exterior de seguridad
          let perpWallDist, wallHitCoord;
          if (side === 0) {
            perpWallDist = (mapX - posX + (1 - stepX) / 2) / rayDirX;
            wallHitCoord = posY + perpWallDist * rayDirY;
          } else {
            perpWallDist = (mapY - posY + (1 - stepY) / 2) / rayDirY;
            wallHitCoord = posX + perpWallDist * rayDirX;
          }
          wallHitCoord -= Math.floor(wallHitCoord);

          hitBottom = {
            seg: { type: 1, name: 'Pared perimetral', style: 'castillo' },
            dist: perpWallDist,
            wallX: wallHitCoord,
            side,
            isDoor: false,
            isLintel: false,
            isOpenDoor: false,
            mapX,
            mapY
          };
          break;
        }
      }

      // Guardar información del objeto en el centro de la pantalla
      if (x === centerRayX) {
        // 1. Si hay una superficie transparente (pared o puerta de cristal) frente al jugador
        const nearestTrans = hitTransparents.slice().sort((a, b) => a.dist - b.dist)[0];
        if (nearestTrans && (!hitBottom || nearestTrans.dist < hitBottom.dist) && nearestTrans.dist <= 2.8) {
          const seg = nearestTrans.seg;
          const isDoor = nearestTrans.isDoor;
          this.facingTarget = {
            name: seg.name,
            type: isDoor ? 'door' : 'wall',
            distance: nearestTrans.dist.toFixed(1),
            rawDist: nearestTrans.dist,
            hit: seg.type,
            mapX: nearestTrans.mapX !== undefined ? nearestTrans.mapX : mapX,
            mapY: nearestTrans.mapY !== undefined ? nearestTrans.mapY : mapY
          };
        } else if (hitOpenDoor && hitOpenDoor.dist <= 2.8) {
          const seg = hitOpenDoor.seg;
          this.facingTarget = {
            name: seg.name,
            type: 'door-open',
            distance: hitOpenDoor.dist.toFixed(1),
            rawDist: hitOpenDoor.dist,
            hit: seg.type,
            mapX: hitOpenDoor.mapX !== undefined ? hitOpenDoor.mapX : mapX,
            mapY: hitOpenDoor.mapY !== undefined ? hitOpenDoor.mapY : mapY
          };
        } else {
          const nearbyLintel = hitLintels.find(l => l.dist <= 2.8 && l.seg.name && l.seg.name.includes('Dintel'));
          if (nearbyLintel && (!hitBottom.isDoor || hitBottom.dist > 2.8)) {
            this.facingTarget = {
              name: nearbyLintel.seg.name.replace('Dintel ', '') + ' (Abierta)',
              type: 'door-open',
              distance: nearbyLintel.dist.toFixed(1),
              rawDist: nearbyLintel.dist,
              hit: nearbyLintel.seg.type,
              mapX: nearbyLintel.mapX,
              mapY: nearbyLintel.mapY
            };
          } else if (hitBottom.seg.isJamb && hitBottom.dist <= 2.8) {
            this.facingTarget = {
              name: 'Puerta (Abierta)',
              type: 'door-open',
              distance: hitBottom.dist.toFixed(1),
              rawDist: hitBottom.dist,
              hit: hitBottom.seg.type,
              mapX: hitBottom.mapX !== undefined ? hitBottom.mapX : mapX,
              mapY: hitBottom.mapY !== undefined ? hitBottom.mapY : mapY
            };
          } else {
            const seg = hitBottom.seg;
            const isDoor = hitBottom.isDoor;
            this.facingTarget = {
              name: seg.name,
              type: isDoor ? 'door' : (seg.type === 6 ? 'window' : 'wall'),
              distance: hitBottom.dist.toFixed(1),
              rawDist: hitBottom.dist,
              hit: seg.type,
              mapX: hitBottom.mapX !== undefined ? hitBottom.mapX : mapX,
              mapY: hitBottom.mapY !== undefined ? hitBottom.mapY : mapY
            };
          }
        }
      }

      const eyeHeight = this.wallHeightScale / 2; // 1.5

      // 1. Proyección de la pared/puerta de fondo (hitBottom)
      const projBottom = h / Math.max(hitBottom.dist, 0.0001);
      const bottomY = halfH + eyeHeight * projBottom; // suelo común
      const doorTopYBottom = halfH - (this.doorHeightScale - eyeHeight) * projBottom;
      const wallTopYBottom = halfH - (this.wallHeightScale - eyeHeight) * projBottom;

      // Factor de sombra por distancia y orientación (eje Y más sombreado para profundidad)
      const shadeOf = (dist, side) => {
        let s = 1 / (1 + dist * 0.22);
        if (side === 1) s *= 0.72; // Sombreado clásico Wolfenstein 3D
        return s;
      };
      const texXOf = (coord, side, texW = 64) => {
        let tx = Math.floor(Math.max(0, Math.min(0.999, coord)) * texW);
        if (side === 0 && rayDirX > 0) tx = texW - tx - 1;
        if (side === 1 && rayDirY < 0) tx = texW - tx - 1;
        return tx;
      };

      // Dibuja una franja vertical con una textura anclada a su geometría real en el mundo (0 a 3.0m para pared, 0 a 2.2m para puerta).
      // Soporta Alpha Blending cuando los píxeles de la textura contienen canal alfa < 255 (cristal translúcido).
      const blitTexBand = (topPx, bottomPx, texArray, texXParam, shadeParam, clampMinY = -Infinity, clampMaxY = Infinity) => {
        const clipStart = Math.max(0, Math.floor(topPx), Math.floor(clampMinY));
        const clipEnd = Math.min(h - 1, Math.floor(bottomPx), Math.floor(clampMaxY));
        if (clipEnd < clipStart) return;

        const texW = texArray.width || 64;
        const texH = texArray.height || (texArray.length === 64 * 192 ? 192 : 64);

        const totalHeight = Math.max(0.0001, bottomPx - topPx);
        const step = texH / totalHeight;
        let texPos = (clipStart - topPx) * step;

        for (let y = clipStart; y <= clipEnd; y++) {
          const texY = Math.min(texH - 1, Math.max(0, Math.floor(texPos)));
          texPos += step;
          const color = texArray[texY * texW + texXParam];
          const a = (color >> 24) & 0xFF;
          if (a === 0) continue; // Píxel totalmente transparente

          const r = Math.floor((color & 0xFF) * shadeParam);
          const g = Math.floor(((color >> 8) & 0xFF) * shadeParam);
          const b = Math.floor(((color >> 16) & 0xFF) * shadeParam);

          if (a >= 254) {
            // Opaco: asignación directa
            pixels[y * w + x] = (255 << 24) | (b << 16) | (g << 8) | r;
          } else {
            // Translúcido: mezcla alfa sobre el buffer existente
            const prev = pixels[y * w + x];
            const prevR = prev & 0xFF;
            const prevG = (prev >> 8) & 0xFF;
            const prevB = (prev >> 16) & 0xFF;
            const alphaRatio = a / 255;
            const invAlpha = 1 - alphaRatio;

            const finalR = Math.min(255, Math.floor(r * alphaRatio + prevR * invAlpha));
            const finalG = Math.min(255, Math.floor(g * alphaRatio + prevG * invAlpha));
            const finalB = Math.min(255, Math.floor(b * alphaRatio + prevB * invAlpha));

            pixels[y * w + x] = (255 << 24) | (finalB << 16) | (finalG << 8) | finalR;
          }
        }
      };

      const blitFlatBand = (topPx, bottomPx, color, shadeParam, clampMinY = -Infinity, clampMaxY = Infinity) => {
        const clipStart = Math.max(0, Math.floor(topPx), Math.floor(clampMinY));
        const clipEnd = Math.min(h - 1, Math.floor(bottomPx), Math.floor(clampMaxY));
        if (clipEnd < clipStart) return;
        const r = Math.floor((color & 0xFF) * shadeParam);
        const g = Math.floor(((color >> 8) & 0xFF) * shadeParam);
        const b = Math.floor(((color >> 16) & 0xFF) * shadeParam);
        const shaded = (255 << 24) | (b << 16) | (g << 8) | r;
        for (let y = clipStart; y <= clipEnd; y++) pixels[y * w + x] = shaded;
      };

      const resolveTex = (type, style) => {
        const raw = this.textures[type] || this.textures[1];
        return (raw instanceof Uint32Array) ? raw : (raw[style] || raw.castillo);
      };

      // Unir todas las capas intermedias que están por delante del fondo opaco
      const layers = [];

      if (hitOpenDoor && hitOpenDoor.dist < hitBottom.dist) {
        layers.push({ kind: 'openDoor', hit: hitOpenDoor, dist: hitOpenDoor.dist });
      }

      for (let i = 0; i < hitLintels.length; i++) {
        const lHit = hitLintels[i];
        if (lHit.dist < hitBottom.dist - 0.05) {
          layers.push({ kind: 'lintel', hit: lHit, dist: lHit.dist });
        }
      }

      for (let i = 0; i < hitTransparents.length; i++) {
        const tHit = hitTransparents[i];
        if (tHit.dist < hitBottom.dist - 0.05) {
          layers.push({ kind: 'transparent', hit: tHit, dist: tHit.dist });
        }
      }

      // Algoritmo del pintor: de más lejano a más cercano
      layers.sort((a, b) => b.dist - a.dist);

      if (this.textureMode === 'classic') {
        // 1. Dibujar el fondo opaco (hitBottom: pared completa, jamba o puerta cerrada)
        const bTex = resolveTex(hitBottom.seg.type, hitBottom.seg.style || 'castillo');
        const bTexX = texXOf(hitBottom.wallX, hitBottom.side, bTex.width || 64);
        const bShade = shadeOf(hitBottom.dist, hitBottom.side);

        if (hitBottom.seg.isJamb) {
          // Jamba lateral de vano de puerta (0 a 2.2m), continúa la textura de canto de 3m hacia abajo
          blitTexBand(wallTopYBottom, bottomY, bTex, bTexX, bShade, doorTopYBottom, bottomY);
        } else if (hitBottom.isDoor) {
          // Puerta cerrada (0 a 2.2m)
          blitTexBand(doorTopYBottom, bottomY, bTex, bTexX, bShade, doorTopYBottom, bottomY);
          // Dintel propio sobre la puerta cerrada en el mismo vano (2.2 a 3.0m)
          const dLintelStyle = hitBottom.seg.lintelStyle || hitBottom.seg.style || 'castillo';
          const dLintelTex = resolveTex(1, dLintelStyle);
          const dLintelX = texXOf(hitBottom.wallX, hitBottom.side, dLintelTex.width || 64);
          blitTexBand(wallTopYBottom, bottomY, dLintelTex, dLintelX, bShade, wallTopYBottom, doorTopYBottom + 1);
        } else {
          // Pared completa o ventana de 3.0m
          blitTexBand(wallTopYBottom, bottomY, bTex, bTexX, bShade, wallTopYBottom, bottomY);
        }

        // 2. Dibujar cada capa intermedia de más lejana a más cercana
        for (let i = 0; i < layers.length; i++) {
          const layer = layers[i];
          if (layer.kind === 'openDoor') {
            const od = layer.hit;
            const projDoor = h / Math.max(od.dist, 0.0001);
            const bottomYDoor = halfH + eyeHeight * projDoor;
            const doorTopYDoor = halfH - (this.doorHeightScale - eyeHeight) * projDoor;
            const odTex = resolveTex(od.seg.type, od.seg.style || 'castillo');
            const odTexX = texXOf(od.wallX, od.side, odTex.width || 64);
            const odShade = shadeOf(od.dist, od.side);
            blitTexBand(doorTopYDoor, bottomYDoor, odTex, odTexX, odShade, doorTopYDoor, bottomYDoor);
          } else if (layer.kind === 'lintel') {
            const lHit = layer.hit;
            const projL = h / Math.max(lHit.dist, 0.0001);
            const wallTopYL = halfH - (this.wallHeightScale - eyeHeight) * projL;
            const doorTopYL = halfH - (this.doorHeightScale - eyeHeight) * projL;
            const bottomYL = halfH + eyeHeight * projL;

            const lTex = resolveTex(lHit.seg.type, lHit.seg.style || 'castillo');
            const lTexX = texXOf(lHit.wallX, lHit.side, lTex.width || 64);
            const lShade = shadeOf(lHit.dist, lHit.side);
            blitTexBand(wallTopYL, bottomYL, lTex, lTexX, lShade, wallTopYL, doorTopYL + 1);
          } else if (layer.kind === 'transparent') {
            const tHit = layer.hit;
            const projT = h / Math.max(tHit.dist, 0.0001);
            const wallTopYT = halfH - (this.wallHeightScale - eyeHeight) * projT;
            const doorTopYT = halfH - (this.doorHeightScale - eyeHeight) * projT;
            const bottomYT = halfH + eyeHeight * projT;

            const tTex = resolveTex(tHit.seg.type, tHit.seg.style || 'cristal');
            const tTexX = texXOf(tHit.wallX, tHit.side, tTex.width || 64);
            const tShade = shadeOf(tHit.dist, tHit.side);

            if (tHit.seg.isJamb) {
              blitTexBand(wallTopYT, bottomYT, tTex, tTexX, tShade, doorTopYT, bottomYT);
            } else if (tHit.isDoor) {
              // Puerta de cristal cerrada (0 a 2.2m)
              blitTexBand(doorTopYT, bottomYT, tTex, tTexX, tShade, doorTopYT, bottomYT);
              // Dintel propio sobre la puerta de cristal (2.2 a 3.0m)
              const dLintelStyle = tHit.seg.lintelStyle || tHit.seg.style || 'cristal';
              const dLintelTex = resolveTex(1, dLintelStyle);
              const dLintelX = texXOf(tHit.wallX, tHit.side, dLintelTex.width || 64);
              blitTexBand(wallTopYT, bottomYT, dLintelTex, dLintelX, tShade, wallTopYT, doorTopYT + 1);
            } else {
              // Pared de cristal completa (0 a 3.0m)
              blitTexBand(wallTopYT, bottomYT, tTex, tTexX, tShade, wallTopYT, bottomYT);
            }
          }
        }
      } else {
        // Modo plano
        if (hitBottom.seg.isJamb) {
          blitFlatBand(wallTopYBottom, bottomY, 0x555555, shadeOf(hitBottom.dist, hitBottom.side), doorTopYBottom, bottomY);
        } else if (hitBottom.isDoor) {
          blitFlatBand(doorTopYBottom, bottomY, 0x00a5ff, shadeOf(hitBottom.dist, hitBottom.side), doorTopYBottom, bottomY);
          blitFlatBand(wallTopYBottom, bottomY, 0x888888, shadeOf(hitBottom.dist, hitBottom.side), wallTopYBottom, doorTopYBottom + 1);
        } else {
          blitFlatBand(wallTopYBottom, bottomY, 0x888888, shadeOf(hitBottom.dist, hitBottom.side), wallTopYBottom, bottomY);
        }

        for (let i = 0; i < layers.length; i++) {
          const layer = layers[i];
          if (layer.kind === 'openDoor') {
            const od = layer.hit;
            const projDoor = h / Math.max(od.dist, 0.0001);
            const bottomYDoor = halfH + eyeHeight * projDoor;
            const doorTopYDoor = halfH - (this.doorHeightScale - eyeHeight) * projDoor;
            blitFlatBand(doorTopYDoor, bottomYDoor, 0x00a5ff, shadeOf(od.dist, od.side), doorTopYDoor, bottomYDoor);
          } else if (layer.kind === 'lintel') {
            const lHit = layer.hit;
            const projL = h / Math.max(lHit.dist, 0.0001);
            const wallTopYL = halfH - (this.wallHeightScale - eyeHeight) * projL;
            const doorTopYL = halfH - (this.doorHeightScale - eyeHeight) * projL;
            const bottomYL = halfH + eyeHeight * projL;
            blitFlatBand(wallTopYL, bottomYL, 0x888888, shadeOf(lHit.dist, lHit.side), wallTopYL, doorTopYL + 1);
          } else if (layer.kind === 'transparent') {
            const tHit = layer.hit;
            const projT = h / Math.max(tHit.dist, 0.0001);
            const wallTopYT = halfH - (this.wallHeightScale - eyeHeight) * projT;
            const doorTopYT = halfH - (this.doorHeightScale - eyeHeight) * projT;
            const bottomYT = halfH + eyeHeight * projT;
            const tShade = shadeOf(tHit.dist, tHit.side);
            if (tHit.isDoor) {
              blitFlatBand(doorTopYT, bottomYT, 0x2288bb, tShade, doorTopYT, bottomYT);
            } else {
              blitFlatBand(wallTopYT, bottomYT, 0x2288bb, tShade, wallTopYT, bottomYT);
            }
          }
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
        const th = Math.max(1, Math.floor(cellSize * 0.10));
        const thDoor = th;
        const dOffset = 0;

        for (let s = 0; s < codes.length; s++) {
          const code = codes[s];
          const isDoor = code.startsWith('D');
          const isWin = code.startsWith('W');
          let doorType = 2;
          if (code === 'DN') doorType = 2;
          else if (code === 'DE') doorType = 3;
          else if (code === 'DS') doorType = 4;
          else if (code === 'DW') doorType = 5;

          const doorColor = this.doorInfo[doorType]?.color || '#e5a93b';
          if (isDoor) ctx.fillStyle = doorColor;
          else if (isWin) ctx.fillStyle = '#54a0ff';
          else ctx.fillStyle = '#636e72';

          switch (code) {
            case 'N':
            case 'WN':
              ctx.fillRect(px, py, cellSize, th);
              break;
            case 'DN':
              ctx.fillRect(px, py + dOffset, cellSize, thDoor);
              break;
            case 'S':
            case 'WS':
              ctx.fillRect(px, py + cellSize - th, cellSize, th);
              break;
            case 'DS':
              ctx.fillRect(px, py + cellSize - th + dOffset, cellSize, thDoor);
              break;
            case 'W':
            case 'WW':
              ctx.fillRect(px, py, th, cellSize);
              break;
            case 'DW':
              ctx.fillRect(px + dOffset, py, thDoor, cellSize);
              break;
            case 'E':
            case 'WE':
              ctx.fillRect(px + cellSize - th, py, th, cellSize);
              break;
            case 'DE':
              ctx.fillRect(px + cellSize - th + dOffset, py, thDoor, cellSize);
              break;
            case 'CH':
            case 'WCH': {
              const cy0 = py + Math.floor((cellSize - th) / 2);
              ctx.fillRect(px, cy0, cellSize, th);
              break;
            }
            case 'CV':
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
            // Puertas Abiertas en Minimapa (Abatidas 90° con grosor de 1/10)
            case 'ODN': {
              ctx.fillStyle = this.doorInfo[2]?.color || '#e74c3c';
              ctx.fillRect(px, py, thDoor, cellSize);
              break;
            }
            case 'ODS': {
              ctx.fillStyle = this.doorInfo[4]?.color || '#3498db';
              ctx.fillRect(px, py, thDoor, cellSize);
              break;
            }
            case 'ODW': {
              ctx.fillStyle = this.doorInfo[5]?.color || '#f39c12';
              ctx.fillRect(px, py, cellSize, thDoor);
              break;
            }
            case 'ODE': {
              ctx.fillStyle = this.doorInfo[3]?.color || '#2ecc71';
              ctx.fillRect(px, py, cellSize, thDoor);
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

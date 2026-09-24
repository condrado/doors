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
    this.tableHeightScale = 0.995;
    // Elevación visual del personaje: -0.18m (asienta perfectamente al personaje de 2.0m en la celda)
    this.characterElevation = -0.18;

    if (typeof window !== 'undefined') {
      window.activeRaycasterEngine = this;
    }

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
      [1, 0, ['MON'], 0, 0, 0, 1],
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

    // Z-buffer: distancia perpendicular al hitBottom por columna, para oclusión en floor casting
    this.zBuffer = new Float32Array(this.width);
    // Z-buffer 2D por píxel para oclusión exacta entre sprites, paredes y mesas (patas y tablero)
    this.pixelDepthBuffer = new Float32Array(this.width * this.height);

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

    // Configuración de zoom para minimapa / radar centrado
    // Nivel por defecto: 0 (intermedio / 14px)
    // Con + amplías a nivel -1 (cercano / 20px)
    // Con - te alejas a nivel +1 (panorámico / 10px)
    this.minimapZoomLevel = 0;
    this.minimapZoomCellSizes = {
      '-1': 20,
      '0': 14,
      '1': 10
    };
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
    if (cell === 9 || (cell >= 15 && cell <= 21)) return ['T' + cell];  // Mesa (todas las variantes)
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
    if (!codes || !Array.isArray(codes) || codes.length === 0) return null;

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
   * Detecta si hay una puerta interactuable al alcance sin modificar el mapa.
   * Retorna { action: 'open'|'close', mapX, mapY, name } o null.
   */
  getDoorInReach(player, maxDistance = 2.8) {
    if (this.facingTarget && (this.facingTarget.type === 'door' || this.facingTarget.type === 'door-open')) {
      const dist = (this.facingTarget.rawDist !== undefined)
        ? this.facingTarget.rawDist
        : parseFloat(this.facingTarget.distance);
      if (dist <= maxDistance && this.facingTarget.mapX !== undefined && this.facingTarget.mapY !== undefined) {
        const mX = this.facingTarget.mapX;
        const mY = this.facingTarget.mapY;
        const cell = this.map[mY][mX];
        const isAlreadyOpen = Array.isArray(cell) && cell.some(c => typeof c === 'string' && c.startsWith('OD'));
        return {
          action: isAlreadyOpen ? 'close' : 'open',
          mapX: mX,
          mapY: mY,
          name: this.facingTarget.name || 'Puerta'
        };
      }
    }

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
          return { action: 'close', mapX: frontX, mapY: frontY, name: 'Puerta' };
        } else if (isNumDoor || isArrClosed) {
          return { action: 'open', mapX: frontX, mapY: frontY, name: 'Puerta' };
        }
      }
    }

    const curX = Math.floor(player.posX);
    const curY = Math.floor(player.posY);
    if (curX >= 0 && curX < this.mapWidth && curY >= 0 && curY < this.mapHeight) {
      const curCell = this.map[curY][curX];
      if (Array.isArray(curCell) && curCell.some(c => typeof c === 'string' && c.startsWith('OD'))) {
        return { action: 'close', mapX: curX, mapY: curY, name: 'Puerta' };
      }
    }

    return null;
  }

  /**
   * Detecta si hay una puerta al alcance del jugador para interactuar,
   * sin modificar el estado del mapa (usado para anticipar animaciones de brazo).
   */
  getDoorInReach(player, maxDistance = 2.8) {
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
        return { mapX: mX, mapY: mY, action: isAlreadyOpen ? 'close' : 'open', distance: dist };
      }
    }

    // 2. Probar celdas directamente en frente de la mirada del jugador (filtradas por maxDistance)
    const checkDists = [0.25, 0.5, 0.75, 1.0, maxDistance].filter(d => d <= maxDistance);
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
          return { mapX: frontX, mapY: frontY, action: 'close', distance: d };
        } else if (isNumDoor || isArrClosed) {
          return { mapX: frontX, mapY: frontY, action: 'open', distance: d };
        }
      }
    }

    // 3. Probar la celda actual donde se encuentra el jugador (solo si está dentro del rango)
    const curX = Math.floor(player.posX);
    const curY = Math.floor(player.posY);
    if (curX >= 0 && curX < this.mapWidth && curY >= 0 && curY < this.mapHeight) {
      const curCell = this.map[curY][curX];
      if (Array.isArray(curCell) && curCell.some(c => typeof c === 'string' && c.startsWith('OD'))) {
        return { mapX: curX, mapY: curY, action: 'close', distance: 0 };
      }
    }

    return null;
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
    if (!codes || (Array.isArray(codes) && codes.length === 0)) return [];

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

    const has = (c) => Array.isArray(codes) && codes.includes(c);

    // Estilo con el que se colocó CADA código de ESTA celda (ver setSegmentStyle en
    // el Editor). A diferencia de antes, aquí NO se combina en un único estilo para
    // toda la figura: cuando dos paredes comparten celda y forman una esquina/cruce,
    // cada tramo de la figura conserva la textura de SU propio código (p. ej. en una
    // esquina NO, la cara que pertenece a "N" usa el estilo de N y la que pertenece
    // a "W" usa el estilo de W), tal y como si fuesen dos paredes independientes que
    // simplemente encajan entre sí — porque eso es exactamente lo que son.
    const cellStyleEntry = this.wallStyleMap[`${mapX},${mapY}`];
    const styleOf = (code) => (cellStyleEntry && cellStyleEntry[code]) || 'castillo';

    // MESAS: bloques bajos con distintas configuraciones de patas
    // Tipos de textura lateral: 9=2patas, 15=0patas, 22=pata-izq, 23=pata-der
    // La cara N vista desde fuera (norte) usa lógica espejada → izq/der invertidos respecto a S/W/E
    const MESA_FACES = {
       9: { N:  9, S:  9, W:  9, E:  9 }, // 4 patas
      15: { N: 15, S: 15, W: 15, E: 15 }, // sin patas
      16: { N: 23, S: 22, W:  9, E: 15 }, // ext izq (2 patas lado oeste)
      17: { N: 22, S: 23, W: 15, E:  9 }, // ext der (2 patas lado este)
      18: { N: 23, S: 15, W: 22, E: 15 }, // esq TL (1 pata NW)
      19: { N: 22, S: 15, W: 15, E: 23 }, // esq TR (1 pata NE)
      20: { N: 15, S: 22, W: 23, E: 15 }, // esq BL (1 pata SW)
      21: { N: 15, S: 23, W: 15, E: 22 }, // esq BR (1 pata SE)
    };
    let mesaCode = null;
    if (typeof codes === 'number') {
      mesaCode = codes;
    } else if (Array.isArray(codes)) {
      for (let i = 0; i < codes.length; i++) {
        const c = codes[i];
        if (typeof c === 'string' && c.startsWith('T')) {
          mesaCode = parseInt(c.slice(1), 10);
        } else if (typeof c === 'number' && (c === 9 || (c >= 15 && c <= 21))) {
          mesaCode = c;
        }
      }
    }

    if (mesaCode && MESA_FACES[mesaCode]) {
      const f = MESA_FACES[mesaCode];
      faces.push(
        { axis: 'y', pos: y0, minX: x0, maxX: x1, type: f.N, name: 'Mesa (N)', style: 'mesa', isTable: true },
        { axis: 'y', pos: y1, minX: x0, maxX: x1, type: f.S, name: 'Mesa (S)', style: 'mesa', isTable: true },
        { axis: 'x', pos: x0, minY: y0, maxY: y1, type: f.W, name: 'Mesa (O)', style: 'mesa', isTable: true },
        { axis: 'x', pos: x1, minY: y0, maxY: y1, type: f.E, name: 'Mesa (E)', style: 'mesa', isTable: true }
      );
      // Si la celda es SOLO una mesa sin paredes, retornar ya
      const hasWalls = Array.isArray(codes) && codes.some(c => typeof c === 'string' && !c.startsWith('T'));
      if (!hasWalls) {
        return faces;
      }
    }

    if (!Array.isArray(codes)) return faces;

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

    // 1. PUERTAS CERRADAS (DN, DS, DW, DE) CON HOJA REHUNDIDA (SIN MARCO)
    // - Grosor de la hoja: 0.045m (inferior a los 0.10m de la pared)
    // - Rehundido de la hoja centrado: 0.0275m
    // - Sin jamba: la puerta abarca el ancho completo del vano
    const doorInset = 0.0275;
    const doorThick = 0.045;

    if (has('DN')) {
      const type = 2;
      const name = 'Puerta Norte';
      const style = styleOf('DN');
      const lintelStyle = styleOf('DN_lintel');
      const westConn = this.getWallConnection(mapX - 1, mapY, 'N');
      const eastConn = this.getWallConnection(mapX + 1, mapY, 'N');

      const doorA = nyA + doorInset;
      const doorB = nyB - doorInset;

      // Hoja de la puerta (rehundida, ancho completo del vano)
      faces.push(
        { axis: 'y', pos: doorB, minX: x0, maxX: x1, type, isCap: true, isDoorLeaf: true, name: 'Hoja Puerta Norte (Frontal)', style, lintelStyle },
        { axis: 'y', pos: doorA, minX: x0, maxX: x1, type, isCap: true, isDoorLeaf: true, name: 'Hoja Puerta Norte (Trasera)', style, lintelStyle }
      );

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

      const doorA = syA + doorInset;
      const doorB = syB - doorInset;

      // Hoja de la puerta (rehundida, ancho completo del vano)
      faces.push(
        { axis: 'y', pos: doorA, minX: x0, maxX: x1, type, isCap: true, isDoorLeaf: true, name: 'Hoja Puerta Sur (Frontal)', style, lintelStyle },
        { axis: 'y', pos: doorB, minX: x0, maxX: x1, type, isCap: true, isDoorLeaf: true, name: 'Hoja Puerta Sur (Trasera)', style, lintelStyle }
      );

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

      const doorA = wxA + doorInset;
      const doorB = wxB - doorInset;

      // Hoja de la puerta (rehundida, alto completo del vano)
      faces.push(
        { axis: 'x', pos: doorB, minY: y0, maxY: y1, type, isCap: true, isDoorLeaf: true, name: 'Hoja Puerta Oeste (Frontal)', style, lintelStyle },
        { axis: 'x', pos: doorA, minY: y0, maxY: y1, type, isCap: true, isDoorLeaf: true, name: 'Hoja Puerta Oeste (Trasera)', style, lintelStyle }
      );

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

      const doorA = exA + doorInset;
      const doorB = exB - doorInset;

      // Hoja de la puerta (rehundida, alto completo del vano)
      faces.push(
        { axis: 'x', pos: doorA, minY: y0, maxY: y1, type, isCap: true, isDoorLeaf: true, name: 'Hoja Puerta Este (Frontal)', style, lintelStyle },
        { axis: 'x', pos: doorB, minY: y0, maxY: y1, type, isCap: true, isDoorLeaf: true, name: 'Hoja Puerta Este (Trasera)', style, lintelStyle }
      );

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

    // 6. PUERTAS ABIERTAS (HOJA ABATIDA A 90° CON GROSOR DE 0.045M, SIN MARCO)
    // El estilo (y el estilo de dintel) se toma del código de la puerta CERRADA
    // --------------------------------------------------------------------------------------
    if (has('ODN')) {
      const type = 2;
      const name = 'Puerta Norte [N] (Abierta)';
      const style = styleOf('DN');
      const lintelStyleN = styleOf('DN_lintel');
      const westConn = this.getWallConnection(mapX - 1, mapY, 'N');
      const eastConn = this.getWallConnection(mapX + 1, mapY, 'N');

      // Hoja abatida a 90° (0.045m de grosor, plegada junto al borde oeste)
      const odLeafX0 = x0;
      const odLeafX1 = x0 + doorThick;
      faces.push(
        { axis: 'x', pos: odLeafX1, minY: y0, maxY: y1, type, name, style, isOpenDoor: true, isCap: true, lintelStyle: lintelStyleN },
        { axis: 'x', pos: odLeafX0, minY: y0, maxY: y1, type, name, style, isOpenDoor: true, isCap: true, lintelStyle: lintelStyleN },
        { axis: 'y', pos: y1, minX: odLeafX0, maxX: odLeafX1, type: 11, isCap: true, name: 'Canto Puerta (Abierta)', isOpenDoor: true, style, lintelStyle: lintelStyleN },
        { axis: 'y', pos: y0, minX: odLeafX0, maxX: odLeafX1, type: 11, isCap: true, name: 'Canto Puerta (Abierta)', isOpenDoor: true, style, lintelStyle: lintelStyleN }
      );

      // Dintel en el vano original que queda despejado para el paso del jugador
      faces.push(
        { axis: 'y', pos: nyB, minX: x0, maxX: x1, type: 1, isLintelOnly: true, name: 'Dintel Puerta Norte', style: lintelStyleN },
        { axis: 'y', pos: nyA, minX: x0, maxX: x1, type: 1, isLintelOnly: true, name: 'Dintel Puerta Norte', style: lintelStyleN }
      );
      if (!westConn) {
        faces.push({ axis: 'x', pos: x0, minY: nyA, maxY: nyB, type: 10, isCap: true, isLintelOnly: true, name: 'Canto Dintel Oeste', style: lintelStyleN });
      }
      if (!eastConn) {
        faces.push({ axis: 'x', pos: x1, minY: nyA, maxY: nyB, type: 10, isCap: true, isLintelOnly: true, name: 'Canto Dintel Este', style: lintelStyleN });
      }
    }

    if (has('ODS')) {
      const type = 4;
      const name = 'Puerta Sur [S] (Abierta)';
      const style = styleOf('DS');
      const lintelStyleS = styleOf('DS_lintel');
      const westConn = this.getWallConnection(mapX - 1, mapY, 'S');
      const eastConn = this.getWallConnection(mapX + 1, mapY, 'S');

      // Hoja abatida a 90° (0.045m de grosor, plegada junto al borde oeste)
      const odLeafX0 = x0;
      const odLeafX1 = x0 + doorThick;
      faces.push(
        { axis: 'x', pos: odLeafX1, minY: y0, maxY: y1, type, name, style, isOpenDoor: true, isCap: true, lintelStyle: lintelStyleS },
        { axis: 'x', pos: odLeafX0, minY: y0, maxY: y1, type, name, style, isOpenDoor: true, isCap: true, lintelStyle: lintelStyleS },
        { axis: 'y', pos: y0, minX: odLeafX0, maxX: odLeafX1, type: 11, isCap: true, name: 'Canto Puerta (Abierta)', isOpenDoor: true, style, lintelStyle: lintelStyleS },
        { axis: 'y', pos: y1, minX: odLeafX0, maxX: odLeafX1, type: 11, isCap: true, name: 'Canto Puerta (Abierta)', isOpenDoor: true, style, lintelStyle: lintelStyleS }
      );

      // Dintel en el vano despejado
      faces.push(
        { axis: 'y', pos: syA, minX: x0, maxX: x1, type: 1, isLintelOnly: true, name: 'Dintel Puerta Sur', style: lintelStyleS },
        { axis: 'y', pos: syB, minX: x0, maxX: x1, type: 1, isLintelOnly: true, name: 'Dintel Puerta Sur', style: lintelStyleS }
      );
      if (!westConn) {
        faces.push({ axis: 'x', pos: x0, minY: syA, maxY: syB, type: 10, isCap: true, isLintelOnly: true, name: 'Canto Dintel Oeste', style: lintelStyleS });
      }
      if (!eastConn) {
        faces.push({ axis: 'x', pos: x1, minY: syA, maxY: syB, type: 10, isCap: true, isLintelOnly: true, name: 'Canto Dintel Este', style: lintelStyleS });
      }
    }

    if (has('ODW')) {
      const type = 5;
      const name = 'Puerta Oeste [O] (Abierta)';
      const style = styleOf('DW');
      const lintelStyleW = styleOf('DW_lintel');
      const northConn = this.getWallConnection(mapX, mapY - 1, 'W');
      const southConn = this.getWallConnection(mapX, mapY + 1, 'W');

      // Hoja abatida a 90° (0.045m de grosor, plegada junto al borde norte)
      const odLeafY0 = y0;
      const odLeafY1 = y0 + doorThick;
      faces.push(
        { axis: 'y', pos: odLeafY1, minX: x0, maxX: x1, type, name, style, isOpenDoor: true, isCap: true, lintelStyle: lintelStyleW },
        { axis: 'y', pos: odLeafY0, minX: x0, maxX: x1, type, name, style, isOpenDoor: true, isCap: true, lintelStyle: lintelStyleW },
        { axis: 'x', pos: x1, minY: odLeafY0, maxY: odLeafY1, type: 11, isCap: true, name: 'Canto Puerta (Abierta)', isOpenDoor: true, style, lintelStyle: lintelStyleW },
        { axis: 'x', pos: x0, minY: odLeafY0, maxY: odLeafY1, type: 11, isCap: true, name: 'Canto Puerta (Abierta)', isOpenDoor: true, style, lintelStyle: lintelStyleW }
      );

      // Dintel en el vano despejado
      faces.push(
        { axis: 'x', pos: wxB, minY: y0, maxY: y1, type: 1, isLintelOnly: true, name: 'Dintel Puerta Oeste', style: lintelStyleW },
        { axis: 'x', pos: wxA, minY: y0, maxY: y1, type: 1, isLintelOnly: true, name: 'Dintel Puerta Oeste', style: lintelStyleW }
      );
      if (!northConn) {
        faces.push({ axis: 'y', pos: y0, minX: wxA, maxX: wxB, type: 10, isCap: true, isLintelOnly: true, name: 'Canto Dintel Norte', style: lintelStyleW });
      }
      if (!southConn) {
        faces.push({ axis: 'y', pos: y1, minX: wxA, maxX: wxB, type: 10, isCap: true, isLintelOnly: true, name: 'Canto Dintel Sur', style: lintelStyleW });
      }
    }

    if (has('ODE')) {
      const type = 3;
      const name = 'Puerta Este [E] (Abierta)';
      const style = styleOf('DE');
      const lintelStyleE = styleOf('DE_lintel');
      const northConn = this.getWallConnection(mapX, mapY - 1, 'E');
      const southConn = this.getWallConnection(mapX, mapY + 1, 'E');

      // Hoja abatida a 90° (0.045m de grosor, plegada junto al borde norte)
      const odLeafY0 = y0;
      const odLeafY1 = y0 + doorThick;
      faces.push(
        { axis: 'y', pos: odLeafY1, minX: x0, maxX: x1, type, name, style, isOpenDoor: true, isCap: true, lintelStyle: lintelStyleE },
        { axis: 'y', pos: odLeafY0, minX: x0, maxX: x1, type, name, style, isOpenDoor: true, isCap: true, lintelStyle: lintelStyleE },
        { axis: 'x', pos: x0, minY: odLeafY0, maxY: odLeafY1, type: 11, isCap: true, name: 'Canto Puerta (Abierta)', isOpenDoor: true, style, lintelStyle: lintelStyleE },
        { axis: 'x', pos: x1, minY: odLeafY0, maxY: odLeafY1, type: 11, isCap: true, name: 'Canto Puerta (Abierta)', isOpenDoor: true, style, lintelStyle: lintelStyleE }
      );

      // Dintel en el vano despejado
      faces.push(
        { axis: 'x', pos: exA, minY: y0, maxY: y1, type: 1, isLintelOnly: true, name: 'Dintel Puerta Este', style: lintelStyleE },
        { axis: 'x', pos: exB, minY: y0, maxY: y1, type: 1, isLintelOnly: true, name: 'Dintel Puerta Este', style: lintelStyleE }
      );
      if (!northConn) {
        faces.push({ axis: 'y', pos: y0, minX: exA, maxX: exB, type: 10, isCap: true, isLintelOnly: true, name: 'Canto Dintel Norte', style: lintelStyleE });
      }
      if (!southConn) {
        faces.push({ axis: 'y', pos: y1, minX: exA, maxX: exB, type: 10, isCap: true, isLintelOnly: true, name: 'Canto Dintel Sur', style: lintelStyleE });
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
      const def = WALL_STYLES[style];
      this.textures[1][style] = def.wall(64, 192);
      this.textures[10][style] = def.cap(64, 192);

      // Si el estilo tiene imagen física (pngUrl), cargarla asíncronamente para sustitución limpia
      if (def.pngUrl && typeof Image !== 'undefined') {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const off = document.createElement('canvas');
          off.width = 64;
          off.height = 192;
          const octx = off.getContext('2d', { willReadFrequently: true });
          octx.drawImage(img, 0, 0, 64, 192);
          const arr = new Uint32Array(octx.getImageData(0, 0, 64, 192).data.buffer);
          arr.width = 64;
          arr.height = 192;
          let hasTrans = false;
          for (let i = 0; i < arr.length; i++) {
            if (((arr[i] >> 24) & 0xFF) < 250) {
              hasTrans = true;
              break;
            }
          }
          arr.hasTransparency = hasTrans;
          if (def) def.hasTransparency = hasTrans;
          this.textures[1][style] = arr;
        };
        img.src = def.pngUrl;
      }

      // Cargar también imagen física del canto/jamba (capPngUrl o /src/engine/textures/caps/${style}.png)
      const capUrl = def.capPngUrl || (def.capFile ? ('/src/engine/textures/' + def.capFile) : ('/src/engine/textures/caps/' + style + '.png'));
      if (capUrl && typeof Image !== 'undefined') {
        const cImg = new Image();
        cImg.crossOrigin = 'anonymous';
        cImg.onload = () => {
          const off = document.createElement('canvas');
          off.width = 64;
          off.height = 192;
          const octx = off.getContext('2d', { willReadFrequently: true });
          octx.drawImage(cImg, 0, 0, 64, 192);
          const arr = new Uint32Array(octx.getImageData(0, 0, 64, 192).data.buffer);
          arr.width = 64;
          arr.height = 192;
          let hasTrans = false;
          for (let i = 0; i < arr.length; i++) {
            if (((arr[i] >> 24) & 0xFF) < 250) {
              hasTrans = true;
              break;
            }
          }
          arr.hasTransparency = hasTrans;
          this.textures[10][style] = arr;
        };
        cImg.src = capUrl;
      }
    });

    this.textures[2] = {};
    this.textures[3] = {};
    this.textures[4] = {};
    this.textures[5] = {};
    this.textures[11] = {};
    Object.keys(DOOR_STYLES).forEach(style => {
      const def = DOOR_STYLES[style];
      [2, 3, 4, 5].forEach(type => {
        this.textures[type][style] = def.door(64, 128);
      });
      this.textures[11][style] = def.cap(64, 192);

      if (def.pngUrl && typeof Image !== 'undefined') {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const off = document.createElement('canvas');
          off.width = 64;
          off.height = 128;
          const octx = off.getContext('2d', { willReadFrequently: true });
          octx.drawImage(img, 0, 0, 64, 128);
          const arr = new Uint32Array(octx.getImageData(0, 0, 64, 128).data.buffer);
          arr.width = 64;
          arr.height = 128;
          let hasTrans = false;
          for (let i = 0; i < arr.length; i++) {
            if (((arr[i] >> 24) & 0xFF) < 250) {
              hasTrans = true;
              break;
            }
          }
          arr.hasTransparency = hasTrans;
          if (def) def.hasTransparency = hasTrans;
          [2, 3, 4, 5].forEach(type => {
            this.textures[type][style] = arr;
          });
        };
        img.src = def.pngUrl;
      }

      const doorCapUrl = def.capPngUrl || (def.capFile ? ('/src/engine/textures/' + def.capFile) : ('/src/engine/textures/caps/' + style + '.png'));
      if (doorCapUrl && typeof Image !== 'undefined') {
        const cImg = new Image();
        cImg.crossOrigin = 'anonymous';
        cImg.onload = () => {
          const off = document.createElement('canvas');
          off.width = 64;
          off.height = 192;
          const octx = off.getContext('2d', { willReadFrequently: true });
          octx.drawImage(cImg, 0, 0, 64, 192);
          const arr = new Uint32Array(octx.getImageData(0, 0, 64, 192).data.buffer);
          arr.width = 64;
          arr.height = 192;
          let hasTrans = false;
          for (let i = 0; i < arr.length; i++) {
            if (((arr[i] >> 24) & 0xFF) < 250) {
              hasTrans = true;
              break;
            }
          }
          arr.hasTransparency = hasTrans;
          this.textures[11][style] = arr;
        };
        cImg.src = doorCapUrl;
      }
    });

    // Textura 6: Ventana medieval de 64x192 (dintel + hueco + antepecho, sin variantes)
    this.textures[6] = createWindowPixels(64, 192);

    // Tipos de mesa:
    // 9  = laterales 2 patas (mesa-l.png)
    // 14 = superficie superior (mesa-t.png)
    // 15 = laterales sin patas (mesa-l-0.png)
    // 22 = laterales 1 pata izquierda (mesa-l-i.png)
    // 23 = laterales 1 pata derecha  (mesa-l-d.png)
    this.textures[9]  = {};
    this.textures[14] = {};
    this.textures[15] = {};
    this.textures[22] = {};
    this.textures[23] = {};

    const makeMesaPixels = (width, height, drawLegs) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#6b4423';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = '#4a2e17';
      ctx.lineWidth = 2;
      for (let y = 0; y < height; y += 16) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }
      if (drawLegs === 'both' || drawLegs === 'left') {
        ctx.fillStyle = '#3a2010';
        ctx.fillRect(0, 0, 8, height);
      }
      if (drawLegs === 'both' || drawLegs === 'right') {
        ctx.fillStyle = '#3a2010';
        ctx.fillRect(width - 8, 0, 8, height);
      }
      const arr = new Uint32Array(ctx.getImageData(0, 0, width, height).data.buffer);
      arr.width = width; arr.height = height;
      return arr;
    };

    const makeMesaTopPixels = (width, height) => {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#a0693a';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = '#8b5a2b'; ctx.lineWidth = 1;
      for (let y = 0; y < height; y += 8)
        for (let x = 0; x < width; x += 8)
          ctx.strokeRect(x, y, 8, 8);
      const arr = new Uint32Array(ctx.getImageData(0, 0, width, height).data.buffer);
      arr.width = width; arr.height = height;
      return arr;
    };

    this.textures[9]['mesa']    = makeMesaPixels(64, 64, 'both');
    this.textures[9]['castillo']= this.textures[1]['castillo'] || makeMesaPixels(64, 64, 'both');
    this.textures[14]['mesa']   = makeMesaTopPixels(64, 64);
    this.textures[14]['castillo']= this.textures[14]['mesa'];
    this.textures[15]['mesa']   = makeMesaPixels(64, 64, 'none');
    this.textures[15]['castillo']= this.textures[15]['mesa'];
    this.textures[22]['mesa']   = makeMesaPixels(64, 64, 'left');
    this.textures[22]['castillo']= this.textures[22]['mesa'];
    this.textures[23]['mesa']   = makeMesaPixels(64, 64, 'right');
    this.textures[23]['castillo']= this.textures[23]['mesa'];

    if (typeof Image !== 'undefined') {
      // Carga mesa-t.png (tapa superior, squash a 64×64)
      const loadMesaTop = (src) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const off = document.createElement('canvas');
          off.width = 64; off.height = 64;
          const octx = off.getContext('2d', { willReadFrequently: true });
          octx.drawImage(img, 0, 0, 64, 64);
          const arr = new Uint32Array(octx.getImageData(0, 0, 64, 64).data.buffer);
          arr.width = 64; arr.height = 64;
          this.textures[14]['mesa'] = arr;
          this.textures[14]['castillo'] = arr;
        };
        img.src = src + '?t=' + Date.now();
      };

      // Carga mesa-l.png (cuerpo completo con 2 patas) y genera variantes
      // recortando las columnas de pata izq (x=0-7) y/o der (x=56-63)
      // en el tercio inferior (y >= H*2/3), donde aparecen las patas.
      const loadMesaLateral = (src) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const H = img.naturalHeight || 192;
          const off = document.createElement('canvas');
          off.width = 64; off.height = H;
          const octx = off.getContext('2d', { willReadFrequently: true });
          octx.drawImage(img, 0, 0, 64, H);
          const base = new Uint32Array(octx.getImageData(0, 0, 64, H).data.buffer);
          base.width = 64; base.height = H;

          // Tipo 9: cuerpo completo con las dos patas (sin modificar)
          this.textures[9]['mesa'] = base;
          this.textures[9]['castillo'] = base;

          const yLeg = Math.floor(H * 2 / 3); // = 128 for 192px

          const makeVariant = (keepLeft, keepRight) => {
            const arr = new Uint32Array(base.buffer.slice(0));
            arr.width = 64; arr.height = H;
            for (let y = yLeg; y < H; y++) {
              for (let x = 0; x < 64; x++) {
                const isLeft  = x < 8;
                const isRight = x >= 56;
                if ((isLeft && !keepLeft) || (isRight && !keepRight)) {
                  arr[y * 64 + x] = 0; // transparente
                }
              }
            }
            return arr;
          };

          const noLegs    = makeVariant(false, false); // tipo 15: sin patas
          const leftOnly  = makeVariant(true,  false); // tipo 22: pata izquierda
          const rightOnly = makeVariant(false, true);  // tipo 23: pata derecha

          [this.textures[15], this.textures[22], this.textures[23]].forEach((t, i) => {
            const arr = [noLegs, leftOnly, rightOnly][i];
            t['mesa'] = arr; t['castillo'] = arr;
          });
        };
        img.src = src + '?t=' + Date.now();
      };

      loadMesaLateral('/src/engine/textures/custom/mesa-l.png');
      loadMesaTop('/src/engine/textures/custom/mesa-t.png');
    }
  }

  /**
   * Comprueba dinámicamente si un estilo o textura contiene píxeles transparentes/translúcidos (alfa < 250).
   * Si es transparente, el rayo DDA no se detiene en ella, acumulándola en hitTransparents
   * para dibujarla con mezcla alfa (visión a través de cristal/rejilla).
   */
  isStyleTransparent(style, type = 1) {
    if (!style) return false;
    if (typeof style === 'string' && /^(cristal|glass|trans|reja|enrejado)/i.test(style)) {
      return true;
    }
    if (typeof WALL_STYLES !== 'undefined' && WALL_STYLES[style] && WALL_STYLES[style].hasTransparency !== undefined) {
      if (WALL_STYLES[style].hasTransparency) return true;
    }
    if (typeof DOOR_STYLES !== 'undefined' && DOOR_STYLES[style] && DOOR_STYLES[style].hasTransparency !== undefined) {
      if (DOOR_STYLES[style].hasTransparency) return true;
    }
    const texObj = this.textures[type] || this.textures[1];
    if (texObj) {
      const pixels = (texObj instanceof Uint32Array) ? texObj : texObj[style];
      if (pixels && pixels.length) {
        if (pixels.hasTransparency !== undefined) {
          return pixels.hasTransparency;
        }
        let hasTrans = false;
        for (let i = 0; i < pixels.length; i++) {
          if (((pixels[i] >> 24) & 0xFF) < 250) {
            hasTrans = true;
            break;
          }
        }
        pixels.hasTransparency = hasTrans;
        return hasTrans;
      }
    }
    return false;
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
        const octx = off.getContext('2d', { willReadFrequently: true });
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
   * si window.ENABLE_STATIC_TEXTURE_FILES está habilitado.
   * Por defecto, las texturas procedurales están completamente listas y no se realizan peticiones innecesarias.
   */
  loadDefaultTextureOverrides() {
    if (typeof window === 'undefined' || !window.ENABLE_STATIC_TEXTURE_FILES) {
      return Promise.resolve();
    }
    const base = '/src/engine/textures/';
    const files = {
      1: 'walls/castillo.png',
      2: 'doors/castillo.png',
      3: 'doors/castillo.png',
      4: 'doors/castillo.png',
      5: 'doors/castillo.png',
      6: 'windows/ventana.png',
      10: 'caps/castillo.png',
      11: 'caps/castillo.png'
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
   * Separa el impacto inferior opaco (paredes/puertas que detienen el rayo DDA)
   * de los impactos translúcidos (superficies transparentes que se acumulan para renderizado multicapa)
   * y del impacto en dintel (2.2m a 3.0m: isLintelOnly).
   */
  _intersectCellSegments(segments, posX, posY, rayDirX, rayDirY, mapX, mapY, minDist = 0.001) {
    let bestOpaqueWall = null;
    let bestTable = null;
    let bestLintel = null;
    const transparentHits = [];
    const openDoorHits = [];

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
      const isDoor = ((seg.type >= 2 && seg.type <= 5) || seg.type === 11 || seg.isJamb || seg.isFrame) && !isLintel;
      const isTransparent = !isLintel && !isOpenDoor && this.isStyleTransparent(seg.style, seg.type);
      const hitData = { seg, dist, wallX, side, isDoor, isLintel, isOpenDoor, isTransparent, mapX, mapY };

      if (isLintel) {
        if (!bestLintel || dist < bestLintel.dist) {
          bestLintel = hitData;
        }
      } else if (isOpenDoor) {
        openDoorHits.push(hitData);
      } else if (isTransparent) {
        transparentHits.push(hitData);
      } else if (seg.isTable) {
        if (!bestTable || dist < bestTable.dist) {
          bestTable = hitData;
        }
      } else {
        if (!bestOpaqueWall || dist < bestOpaqueWall.dist) {
          bestOpaqueWall = hitData;
        }
      }
    }

    return { bestOpaqueBottom: bestOpaqueWall, bestTable, bestLintel, transparentHits, openDoorHits };
  }

  /**
   * Renderiza un frame completo del mundo 3D
   */
  render(player) {
    const { posX, posY, dirX, dirY, planeX, planeY } = player;
    const w = this.width;
    const h = this.height;
    const halfH = this.halfHeight;
    // Pitch: desplazamiento vertical del horizonte en píxeles (positivo = mirar abajo)
    const pitchOffset = Math.round(player.pitchOffset || 0);
    const horizon = halfH + pitchOffset;
    const pixels = this.pixels;
    if (!this.pixelDepthBuffer || this.pixelDepthBuffer.length !== w * h) {
      this.pixelDepthBuffer = new Float32Array(w * h);
    }
    this.pixelDepthBuffer.fill(Infinity);

    // 1. Dibujar Techo con degradado de iluminación ambiental
    // Formato de píxel en Little Endian Uint32: 0xAABBGGRR
    for (let y = 0; y < Math.max(0, Math.min(h, horizon)); y++) {
      // Techo: de azul noche a oscuridad en el horizonte
      const ceilRatio = y / halfH;
      const cR = Math.floor(10 + ceilRatio * 8);
      const cG = Math.floor(12 + ceilRatio * 10);
      const cB = Math.floor(22 + ceilRatio * 16);
      const ceilColor = (255 << 24) | (cB << 16) | (cG << 8) | cR;

      const ceilOffset = y * w;
      for (let x = 0; x < w; x++) {
        pixels[ceilOffset + x] = ceilColor;
      }
    }

    // 1.1. Dibujar Suelo con perspectiva 3D tipo Tablero de Ajedrez (1 casilla = 1 celda del editor de 1.0m x 1.0m)
    // Permite visualizar con total claridad la posición exacta de cada elemento y del personaje sentado
    const eyeHeight = this.wallHeightScale / 2; // 1.5m
    const rayDirX0 = dirX - planeX;
    const rayDirY0 = dirY - planeY;
    const rayDirX1 = dirX + planeX;
    const rayDirY1 = dirY + planeY;

    for (let y = Math.max(0, horizon); y < h; y++) {
      const rowOffset = y - horizon;
      const rowPixelBase = y * w;

      if (rowOffset === 0) {
        const horizColor = (255 << 24) | (24 << 16) | (20 << 8) | 18;
        for (let x = 0; x < w; x++) {
          pixels[rowPixelBase + x] = horizColor;
        }
        continue;
      }

      const rowDist = (eyeHeight * h) / rowOffset;
      const floorStepX = rowDist * (rayDirX1 - rayDirX0) / w;
      const floorStepY = rowDist * (rayDirY1 - rayDirY0) / w;

      let floorX = posX + rowDist * rayDirX0;
      let floorY_w = posY + rowDist * rayDirY0;

      // Iluminación por distancia y atenuación atmosférica suave hacia el horizonte
      const shade = Math.min(1, 1 / (1 + rowDist * 0.16));
      const fogRatio = Math.min(1, Math.max(0, (rowDist - 1.2) / 18.0));
      const invFog = 1 - fogRatio;

      for (let x = 0; x < w; x++, floorX += floorStepX, floorY_w += floorStepY) {
        const cellX = Math.floor(floorX);
        const cellY = Math.floor(floorY_w);
        const tx = floorX - cellX;
        const ty = floorY_w - cellY;

        // Alternancia de casillas clara/oscura de 1m x 1m exacta con la cuadrícula del editor
        const isDark = ((cellX + cellY) & 1) !== 0;

        let tileR, tileG, tileB;

        // Borde / junta perimetral de cada casilla (2.5 cm en cada extremo)
        const isGrout = (tx < 0.025 || tx > 0.975 || ty < 0.025 || ty > 0.975);
        // Marca central (+0.5, +0.5) para ubicar el centro donde se colocan el personaje y objetos
        const isCenterMark = ((Math.abs(tx - 0.5) < 0.05 && Math.abs(ty - 0.5) < 0.015) ||
                              (Math.abs(ty - 0.5) < 0.05 && Math.abs(tx - 0.5) < 0.015));

        if (isGrout) {
          tileR = 25;
          tileG = 27;
          tileB = 32;
        } else if (isCenterMark) {
          tileR = isDark ? 85 : 145;
          tileG = isDark ? 88 : 148;
          tileB = isDark ? 98 : 158;
        } else if (isDark) {
          // Baldosa oscura: grafito / pizarra profunda
          tileR = 48;
          tileG = 52;
          tileB = 60;
        } else {
          // Baldosa clara: mármol blanco / gris claro luminoso
          tileR = 196;
          tileG = 198;
          tileB = 205;
        }

        const litR = tileR * shade;
        const litG = tileG * shade;
        const litB = tileB * shade;

        const finalR = Math.floor(litR * invFog + 18 * fogRatio);
        const finalG = Math.floor(litG * invFog + 20 * fogRatio);
        const finalB = Math.floor(litB * invFog + 24 * fogRatio);

        pixels[rowPixelBase + x] = (255 << 24) | (finalB << 16) | (finalG << 8) | finalR;
      }
    }

    // Rayo central para registrar qué está mirando directamente el jugador
    const centerRayX = Math.floor(w / 2);

    // Cola de renderizado para el pase diferido de transparencias (cristales, ventanas, puertas de cristal)
    // Se procesa después de las mesas y sprites para que la tapa de la mesa y los personajes se vean a través del cristal
    const transparentPassQueue = [];

    // Dibuja una franja vertical translúcida en el pase diferido (después de mesas y sprites)
    const blitTransparentBand = (colX, topPx, bottomPx, texArray, texXParam, shadeParam, clampMinY = -Infinity, clampMaxY = Infinity, distParam = Infinity) => {
      const clipStart = Math.max(0, Math.floor(topPx), Math.floor(clampMinY));
      const clipEnd = Math.min(h - 1, Math.floor(bottomPx), Math.floor(clampMaxY));
      if (clipEnd < clipStart) return;

      const texW = texArray.width || 64;
      const texH = texArray.height || (texArray.length === 64 * 192 ? 192 : 64);
      const totalHeight = Math.max(0.0001, bottomPx - topPx);
      const step = texH / totalHeight;
      let texPos = (clipStart - topPx) * step;

      for (let y = clipStart; y <= clipEnd; y++) {
        const pIdx = y * w + colX;
        // Si hay un objeto opaco DELANTE del cristal (ej. una mesa colocada entre el jugador y el cristal), no dibujar el cristal encima
        if (this.pixelDepthBuffer && distParam >= this.pixelDepthBuffer[pIdx]) {
          texPos += step;
          continue;
        }

        const texY = Math.min(texH - 1, Math.max(0, Math.floor(texPos)));
        texPos += step;
        const color = texArray[texY * texW + texXParam];
        const a = (color >> 24) & 0xFF;
        if (a === 0) continue;

        const r = Math.floor((color & 0xFF) * shadeParam);
        const g = Math.floor(((color >> 8) & 0xFF) * shadeParam);
        const b = Math.floor(((color >> 16) & 0xFF) * shadeParam);

        if (a >= 254) {
          pixels[pIdx] = (255 << 24) | (b << 16) | (g << 8) | r;
          this.pixelDepthBuffer[pIdx] = distParam;
        } else {
          const prev = pixels[pIdx];
          const prevR = prev & 0xFF;
          const prevG = (prev >> 8) & 0xFF;
          const prevB = (prev >> 16) & 0xFF;
          const alphaRatio = a / 255;
          const invAlpha = 1 - alphaRatio;

          const finalR = Math.min(255, Math.floor(r * alphaRatio + prevR * invAlpha));
          const finalG = Math.min(255, Math.floor(g * alphaRatio + prevG * invAlpha));
          const finalB = Math.min(255, Math.floor(b * alphaRatio + prevB * invAlpha));

          pixels[pIdx] = (255 << 24) | (finalB << 16) | (finalG << 8) | finalR;
        }
      }
    };

    const blitFlatTransparentBand = (colX, topPx, bottomPx, color, shadeParam, clampMinY = -Infinity, clampMaxY = Infinity, distParam = Infinity) => {
      const clipStart = Math.max(0, Math.floor(topPx), Math.floor(clampMinY));
      const clipEnd = Math.min(h - 1, Math.floor(bottomPx), Math.floor(clampMaxY));
      if (clipEnd < clipStart) return;
      const r = Math.floor((color & 0xFF) * shadeParam);
      const g = Math.floor(((color >> 8) & 0xFF) * shadeParam);
      const b = Math.floor(((color >> 16) & 0xFF) * shadeParam);
      for (let y = clipStart; y <= clipEnd; y++) {
        const pIdx = y * w + colX;
        if (this.pixelDepthBuffer && distParam >= this.pixelDepthBuffer[pIdx]) continue;
        const prev = pixels[pIdx];
        const prevR = prev & 0xFF;
        const prevG = (prev >> 8) & 0xFF;
        const prevB = (prev >> 16) & 0xFF;
        const fR = Math.min(255, Math.floor(r * 0.4 + prevR * 0.6));
        const fG = Math.min(255, Math.floor(g * 0.4 + prevG * 0.6));
        const fB = Math.min(255, Math.floor(b * 0.4 + prevB * 0.6));
        pixels[pIdx] = (255 << 24) | (fB << 16) | (fG << 8) | fR;
      }
    };

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
      let hitTable = null;
      const hitLintels = [];
      const hitTransparents = [];

      const recordCellIntersects = (res) => {
        if (res.bestLintel) {
          if (!hitLintels.some(l => Math.abs(l.dist - res.bestLintel.dist) < 0.01)) {
            hitLintels.push(res.bestLintel);
          }
        }
        if (res.openDoorHits && res.openDoorHits.length > 0) {
          for (let i = 0; i < res.openDoorHits.length; i++) {
            const od = res.openDoorHits[i];
            if (!hitOpenDoor || od.dist < hitOpenDoor.dist) {
              hitOpenDoor = od;
            }
          }
        }
        if (res.transparentHits && res.transparentHits.length > 0) {
          for (let i = 0; i < res.transparentHits.length; i++) {
            const th = res.transparentHits[i];
            if (!hitTransparents.some(t => Math.abs(t.dist - th.dist) < 0.01)) {
              hitTransparents.push(th);
            }
          }
        }
        if (res.bestTable && !hitTable) {
          hitTable = res.bestTable;
        }
        if (res.bestOpaqueBottom) {
          hitBottom = res.bestOpaqueBottom;
          return true;
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
          // El rayo salió del mapa: no hay pared por defecto
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
          if (nearbyLintel && (!hitBottom || !hitBottom.isDoor || hitBottom.dist > 2.8)) {
            this.facingTarget = {
              name: nearbyLintel.seg.name.replace('Dintel ', '') + ' (Abierta)',
              type: 'door-open',
              distance: nearbyLintel.dist.toFixed(1),
              rawDist: nearbyLintel.dist,
              hit: nearbyLintel.seg.type,
              mapX: nearbyLintel.mapX,
              mapY: nearbyLintel.mapY
            };
          } else if (hitBottom && (hitBottom.seg.isJamb || hitBottom.seg.isFrame) && hitBottom.dist <= 2.8) {
            const mX = hitBottom.mapX !== undefined ? hitBottom.mapX : mapX;
            const mY = hitBottom.mapY !== undefined ? hitBottom.mapY : mapY;
            const cell = this.map[mY] && this.map[mY][mX];
            const isOpen = Array.isArray(cell) && cell.some(c => typeof c === 'string' && c.startsWith('OD'));
            this.facingTarget = {
              name: isOpen ? 'Puerta (Abierta)' : 'Puerta',
              type: isOpen ? 'door-open' : 'door',
              distance: hitBottom.dist.toFixed(1),
              rawDist: hitBottom.dist,
              hit: hitBottom.seg.type,
              mapX: mX,
              mapY: mY
            };
          } else if (hitBottom) {
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
          } else {
            this.facingTarget = {
              name: 'Espacio abierto',
              type: 'empty',
              distance: '—',
              rawDist: Infinity
            };
          }
        }
      }

      const eyeHeight = this.wallHeightScale / 2; // 1.5

      // Si solo hay mesa y no hay otro opaco, usar mesa como hitBottom
      if (!hitBottom && hitTable) {
        hitBottom = hitTable;
      }

      // Factor de sombra por distancia y orientación (eje Y más sombreado para profundidad)
      const shadeOf = (dist, side) => {
        let s = 1 / (1 + dist * 0.22);
        if (side === 1) s *= 0.72; // Sombreado clásico Wolfenstein 3D
        return s;
      };
      // Coordenada horizontal de la textura (corregida para evitar inversión/espejado)
      const texXOf = (coord, side, texW = 64) => {
        let tx = Math.floor(Math.max(0, Math.min(0.999, coord)) * texW);
        if (side === 0 && rayDirX < 0) tx = texW - tx - 1;
        if (side === 1 && rayDirY > 0) tx = texW - tx - 1;
        return tx;
      };

      // Dibuja una franja vertical con una textura anclada a su geometría real en el mundo (0 a 3.0m para pared, 0 a 2.2m para puerta).
      // Soporta Alpha Blending cuando los píxeles de la textura contienen canal alfa < 255 (cristal translúcido).
      const blitTexBand = (topPx, bottomPx, texArray, texXParam, shadeParam, clampMinY = -Infinity, clampMaxY = Infinity, distParam = Infinity) => {
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

          const pIdx = y * w + x;
          if (a >= 254) {
            // Opaco: asignación directa y registro exacto en el Z-buffer 2D
            pixels[pIdx] = (255 << 24) | (b << 16) | (g << 8) | r;
            this.pixelDepthBuffer[pIdx] = distParam;
          } else {
            // Translúcido: mezcla alfa sobre el buffer existente
            const prev = pixels[pIdx];
            const prevR = prev & 0xFF;
            const prevG = (prev >> 8) & 0xFF;
            const prevB = (prev >> 16) & 0xFF;
            const alphaRatio = a / 255;
            const invAlpha = 1 - alphaRatio;

            const finalR = Math.min(255, Math.floor(r * alphaRatio + prevR * invAlpha));
            const finalG = Math.min(255, Math.floor(g * alphaRatio + prevG * invAlpha));
            const finalB = Math.min(255, Math.floor(b * alphaRatio + prevB * invAlpha));

            pixels[pIdx] = (255 << 24) | (finalB << 16) | (finalG << 8) | finalR;
            // No escribir en el Z-buffer opaco para píxeles translúcidos
          }
        }
      };

      const blitFlatBand = (topPx, bottomPx, color, shadeParam, clampMinY = -Infinity, clampMaxY = Infinity, distParam = Infinity) => {
        const clipStart = Math.max(0, Math.floor(topPx), Math.floor(clampMinY));
        const clipEnd = Math.min(h - 1, Math.floor(bottomPx), Math.floor(clampMaxY));
        if (clipEnd < clipStart) return;
        const r = Math.floor((color & 0xFF) * shadeParam);
        const g = Math.floor(((color >> 8) & 0xFF) * shadeParam);
        const b = Math.floor(((color >> 16) & 0xFF) * shadeParam);
        const shaded = (255 << 24) | (b << 16) | (g << 8) | r;
        for (let y = clipStart; y <= clipEnd; y++) {
          const pIdx = y * w + x;
          pixels[pIdx] = shaded;
          this.pixelDepthBuffer[pIdx] = distParam;
        }
      };

      const resolveTex = (type, style) => {
        const raw = this.textures[type] || this.textures[1];
        return (raw instanceof Uint32Array) ? raw : (raw[style] || raw.castillo);
      };

      // Unir todas las capas intermedias que están por delante del fondo opaco
      const layers = [];
      const maxDist = hitBottom ? hitBottom.dist : Infinity;

      // Las mesas se renderizan encima del fondo opaco (o como fondo si no hay otro opaco)
      if (hitTable && (!hitBottom || hitTable.dist < hitBottom.dist)) {
        layers.push({ kind: 'table', hit: hitTable, dist: hitTable.dist });
      }

      if (hitOpenDoor && hitOpenDoor.dist < maxDist) {
        layers.push({ kind: 'openDoor', hit: hitOpenDoor, dist: hitOpenDoor.dist });
      }

      for (let i = 0; i < hitLintels.length; i++) {
        const lHit = hitLintels[i];
        if (lHit.dist < maxDist - 0.05) {
          layers.push({ kind: 'lintel', hit: lHit, dist: lHit.dist });
        }
      }

      for (let i = 0; i < hitTransparents.length; i++) {
        const tHit = hitTransparents[i];
        if (tHit.dist < maxDist - 0.05) {
          const projT = h / Math.max(tHit.dist, 0.0001);
          const wallTopYT = horizon - (this.wallHeightScale - eyeHeight) * projT;
          const doorTopYT = horizon - (this.doorHeightScale - eyeHeight) * projT;
          const bottomYT = horizon + eyeHeight * projT;

          const tTex = resolveTex(tHit.seg.type, tHit.seg.style || 'cristal');
          const tTexX = texXOf(tHit.wallX, tHit.side, tTex.width || 64);
          const tShade = shadeOf(tHit.dist, tHit.side);

          let dLintelTex = null;
          let dLintelX = 0;
          if (tHit.isDoor) {
            const dLintelStyle = tHit.seg.lintelStyle || tHit.seg.style || 'cristal';
            dLintelTex = resolveTex(1, dLintelStyle);
            dLintelX = texXOf(tHit.wallX, tHit.side, dLintelTex.width || 64);
          }

          transparentPassQueue.push({
            x,
            dist: tHit.dist,
            tHit,
            wallTopYT,
            doorTopYT,
            bottomYT,
            tTex,
            tTexX,
            tShade,
            dLintelTex,
            dLintelX
          });
        }
      }

      // Si no hay fondo opaco y tampoco hay capas intermedias en este rayo, se ve el espacio abierto infinito (suelo y cielo)
      if (!hitBottom && layers.length === 0) {
        this.zBuffer[x] = Infinity;
        continue;
      }

      // Guardar distancia en z-buffer para oclusión de floor casting
      // Solo consideramos capas OPAVAS (hitBottom o mesas/dinteles opacos), NUNCA cristal
      this.zBuffer[x] = hitBottom ? hitBottom.dist : (layers[0] ? layers[0].dist : Infinity);

      // Algoritmo del pintor: de más lejano a más cercano
      layers.sort((a, b) => b.dist - a.dist);

      // 1. Proyección de la pared/puerta de fondo (hitBottom si existe)
      let projBottom = 0;
      let bottomY = 0;
      let doorTopYBottom = 0;
      let wallTopYBottom = 0;

      if (hitBottom) {
        projBottom = h / Math.max(hitBottom.dist, 0.0001);
        bottomY = horizon + eyeHeight * projBottom; // suelo común
        doorTopYBottom = horizon - (this.doorHeightScale - eyeHeight) * projBottom;

        // Si es una mesa, usar tableHeightScale; si no, usar wallHeightScale
        const heightScale = hitBottom.seg && hitBottom.seg.isTable ? this.tableHeightScale : this.wallHeightScale;
        wallTopYBottom = horizon - (heightScale - eyeHeight) * projBottom;
      }

      if (this.textureMode === 'classic') {
        // 1. Dibujar el fondo opaco (hitBottom: pared completa, jamba o puerta cerrada)
        if (hitBottom) {
          const bTex = resolveTex(hitBottom.seg.type, hitBottom.seg.style || 'castillo');
          const bTexX = texXOf(hitBottom.wallX, hitBottom.side, bTex.width || 64);
          const bShade = shadeOf(hitBottom.dist, hitBottom.side);

          if (hitBottom.seg.isJamb || hitBottom.seg.isFrame) {
            // Marco o jamba lateral (0 a 2.2m), continúa la textura de canto hacia abajo
            blitTexBand(wallTopYBottom, bottomY, bTex, bTexX, bShade, doorTopYBottom, bottomY, hitBottom.dist);
            // Dintel / muro superior sobre el marco (2.2 a 3.0m)
            const dLintelStyle = hitBottom.seg.lintelStyle || hitBottom.seg.style || 'castillo';
            const dLintelTex = resolveTex(1, dLintelStyle);
            const dLintelX = texXOf(hitBottom.wallX, hitBottom.side, dLintelTex.width || 64);
            blitTexBand(wallTopYBottom, bottomY, dLintelTex, dLintelX, bShade, wallTopYBottom, doorTopYBottom + 1, hitBottom.dist);
          } else if (hitBottom.isDoor) {
            // Puerta cerrada (0 a 2.2m)
            blitTexBand(doorTopYBottom, bottomY, bTex, bTexX, bShade, doorTopYBottom, bottomY, hitBottom.dist);
            // Dintel propio sobre la puerta cerrada en el mismo vano (2.2 a 3.0m)
            const dLintelStyle = hitBottom.seg.lintelStyle || hitBottom.seg.style || 'castillo';
            const dLintelTex = resolveTex(1, dLintelStyle);
            const dLintelX = texXOf(hitBottom.wallX, hitBottom.side, dLintelTex.width || 64);
            blitTexBand(wallTopYBottom, bottomY, dLintelTex, dLintelX, bShade, wallTopYBottom, doorTopYBottom + 1, hitBottom.dist);
          } else {
            // Pared completa o ventana de 3.0m
            blitTexBand(wallTopYBottom, bottomY, bTex, bTexX, bShade, wallTopYBottom, bottomY, hitBottom.dist);
          }
        }

        // 2. Dibujar cada capa intermedia de más lejana a más cercana
        for (let i = 0; i < layers.length; i++) {
          const layer = layers[i];
          if (layer.kind === 'table') {
            const tblHit = layer.hit;
            const projTbl = h / Math.max(tblHit.dist, 0.0001);
            const bottomYTbl = horizon + eyeHeight * projTbl;
            const tableTopYTbl = horizon - (this.tableHeightScale - eyeHeight) * projTbl;
            const tblTex = resolveTex(tblHit.seg.type, tblHit.seg.style || 'castillo');
            const tblTexX = texXOf(tblHit.wallX, tblHit.side, tblTex.width || 64);
            const tblShade = shadeOf(tblHit.dist, tblHit.side);
            blitFlatBand(tableTopYTbl, bottomYTbl, 0x3a69a0, tblShade, tableTopYTbl, bottomYTbl, tblHit.dist);
            blitTexBand(tableTopYTbl, bottomYTbl, tblTex, tblTexX, tblShade, tableTopYTbl, bottomYTbl, tblHit.dist);
          } else if (layer.kind === 'openDoor') {
            const od = layer.hit;
            const projDoor = h / Math.max(od.dist, 0.0001);
            const bottomYDoor = horizon + eyeHeight * projDoor;
            const doorTopYDoor = horizon - (this.doorHeightScale - eyeHeight) * projDoor;
            const odTex = resolveTex(od.seg.type, od.seg.style || 'castillo');
            const odTexX = texXOf(od.wallX, od.side, odTex.width || 64);
            const odShade = shadeOf(od.dist, od.side);
            blitTexBand(doorTopYDoor, bottomYDoor, odTex, odTexX, odShade, doorTopYDoor, bottomYDoor, od.dist);
          } else if (layer.kind === 'lintel') {
            const lHit = layer.hit;
            const projL = h / Math.max(lHit.dist, 0.0001);
            const wallTopYL = horizon - (this.wallHeightScale - eyeHeight) * projL;
            const doorTopYL = horizon - (this.doorHeightScale - eyeHeight) * projL;
            const bottomYL = horizon + eyeHeight * projL;

            const lTex = resolveTex(lHit.seg.type, lHit.seg.style || 'castillo');
            const lTexX = texXOf(lHit.wallX, lHit.side, lTex.width || 64);
            const lShade = shadeOf(lHit.dist, lHit.side);
            blitTexBand(wallTopYL, bottomYL, lTex, lTexX, lShade, wallTopYL, doorTopYL + 1, lHit.dist);
          }
        }
      } else {
        // Modo plano
        if (hitBottom && hitBottom.seg.isTable) {
          // Renderizar mesa con altura correcta
          const projTbl = h / Math.max(hitBottom.dist, 0.0001);
          const bottomYTbl = horizon + eyeHeight * projTbl;
          const tableTopYTbl = horizon - (this.tableHeightScale - eyeHeight) * projTbl;
          blitFlatBand(tableTopYTbl, bottomYTbl, 0x3a69a0, shadeOf(hitBottom.dist, hitBottom.side), tableTopYTbl, bottomYTbl, hitBottom.dist);
        } else if (hitBottom && (hitBottom.seg.isJamb || hitBottom.seg.isFrame)) {
          blitFlatBand(wallTopYBottom, bottomY, 0x555555, shadeOf(hitBottom.dist, hitBottom.side), doorTopYBottom, bottomY, hitBottom.dist);
          blitFlatBand(wallTopYBottom, bottomY, 0x888888, shadeOf(hitBottom.dist, hitBottom.side), wallTopYBottom, doorTopYBottom + 1, hitBottom.dist);
        } else if (hitBottom && hitBottom.isDoor) {
          blitFlatBand(doorTopYBottom, bottomY, 0x00a5ff, shadeOf(hitBottom.dist, hitBottom.side), doorTopYBottom, bottomY, hitBottom.dist);
          blitFlatBand(wallTopYBottom, bottomY, 0x888888, shadeOf(hitBottom.dist, hitBottom.side), wallTopYBottom, doorTopYBottom + 1, hitBottom.dist);
        } else if (hitBottom) {
          blitFlatBand(wallTopYBottom, bottomY, 0x888888, shadeOf(hitBottom.dist, hitBottom.side), wallTopYBottom, bottomY, hitBottom.dist);
        }

        for (let i = 0; i < layers.length; i++) {
          const layer = layers[i];
          if (layer.kind === 'table') {
            const tblHit = layer.hit;
            const projTbl = h / Math.max(tblHit.dist, 0.0001);
            const bottomYTbl = halfH + eyeHeight * projTbl;
            const tableTopYTbl = halfH - (this.tableHeightScale - eyeHeight) * projTbl;
            blitFlatBand(tableTopYTbl, bottomYTbl, 0x3a69a0, shadeOf(tblHit.dist, tblHit.side), tableTopYTbl, bottomYTbl, tblHit.dist);
          } else if (layer.kind === 'openDoor') {
            const od = layer.hit;
            const projDoor = h / Math.max(od.dist, 0.0001);
            const bottomYDoor = halfH + eyeHeight * projDoor;
            const doorTopYDoor = halfH - (this.doorHeightScale - eyeHeight) * projDoor;
            blitFlatBand(doorTopYDoor, bottomYDoor, 0x00a5ff, shadeOf(od.dist, od.side), doorTopYDoor, bottomYDoor, od.dist);
          } else if (layer.kind === 'lintel') {
            const lHit = layer.hit;
            const projL = h / Math.max(lHit.dist, 0.0001);
            const wallTopYL = halfH - (this.wallHeightScale - eyeHeight) * projL;
            const doorTopYL = halfH - (this.doorHeightScale - eyeHeight) * projL;
            const bottomYL = halfH + eyeHeight * projL;
            blitFlatBand(wallTopYL, bottomYL, 0x888888, shadeOf(lHit.dist, lHit.side), wallTopYL, doorTopYL + 1, lHit.dist);
          }
        }
      }
    }

    // 3. Floor casting: tapas de mesas (superficie horizontal a altura tableHeightScale)
    const tableTopTex = (() => {
      const t = this.textures[14];
      if (!t) return null;
      return (t instanceof Uint32Array) ? t : (t['mesa'] || t['castillo'] || null);
    })();

    if (tableTopTex) {
      const eyeHeight = this.wallHeightScale / 2;
      const surfaceH = this.tableHeightScale; // 0.33
      const eyeAbove = eyeHeight - surfaceH;  // 1.17

      for (let y = Math.ceil(halfH) + 1; y < h; y++) {
        const rowOffset = y - halfH;
        if (rowOffset <= 0) continue;
        const rowDist = eyeAbove * h / rowOffset;

        // Calcular el paso de avance en mundo por píxel horizontal
        // (equivale a recalcular los dos rayos extremos del frustum para esta fila)
        const rayDirX0 = dirX - planeX;
        const rayDirY0 = dirY - planeY;
        const rayDirX1 = dirX + planeX;
        const rayDirY1 = dirY + planeY;

        const floorStepX = rowDist * (rayDirX1 - rayDirX0) / w;
        const floorStepY = rowDist * (rayDirY1 - rayDirY0) / w;

        let floorX = posX + rowDist * rayDirX0;
        let floorY_w = posY + rowDist * rayDirY0;

        const rowPixelBase = y * w;

        for (let x = 0; x < w; x++, floorX += floorStepX, floorY_w += floorStepY) {
          // Oclusión: el punto está detrás de la pared de esta columna
          if (rowDist >= this.zBuffer[x]) { continue; }

          const cellX = Math.floor(floorX);
          const cellY = Math.floor(floorY_w);

          if (cellX < 0 || cellX >= this.mapWidth || cellY < 0 || cellY >= this.mapHeight) continue;

          // Comprobar si la celda es una mesa (cualquier variante)
          const cellCode = this.map[cellY] ? this.map[cellY][cellX] : undefined;
          let isMesaCell = false;
          if (typeof cellCode === 'number') {
            isMesaCell = cellCode === 9 || (cellCode >= 15 && cellCode <= 21);
          } else if (Array.isArray(cellCode)) {
            isMesaCell = cellCode.some(c => (typeof c === 'string' && c.startsWith('T')) || (typeof c === 'number' && (c === 9 || (c >= 15 && c <= 21))));
          }
          if (!isMesaCell) continue;

          const tx = Math.floor((floorX - cellX) * 64) & 63;
          const ty = Math.floor((floorY_w - cellY) * 64) & 63;

          const shade = Math.min(1, 1 / (1 + rowDist * 0.22));
          const raw = tableTopTex[ty * 64 + tx];
          const r = Math.floor((raw & 0xFF) * shade);
          const g = Math.floor(((raw >> 8) & 0xFF) * shade);
          const b = Math.floor(((raw >> 16) & 0xFF) * shade);
          pixels[rowPixelBase + x] = (255 << 24) | (b << 16) | (g << 8) | r;
          this.pixelDepthBuffer[rowPixelBase + x] = rowDist;
        }
      }
    }

    // 2.5. Renderizar Sprites Billboards (Monitores, etc.) que siempre miran al jugador
    this.renderSprites(player);

    // 2.6. Pase diferido de transparencias (Cristales, ventanas y puertas de cristal)
    // Se dibujan ordenadas de más lejanas a más cercanas, DESPUÉS de las mesas y los personajes,
    // garantizando que la tapa de la mesa y los personajes se vean a través del cristal con su reflejo por encima
    if (transparentPassQueue.length > 0) {
      transparentPassQueue.sort((a, b) => b.dist - a.dist);
      for (let i = 0; i < transparentPassQueue.length; i++) {
        const item = transparentPassQueue[i];
        const { x, dist, tHit, wallTopYT, doorTopYT, bottomYT, tTex, tTexX, tShade, dLintelTex, dLintelX } = item;

        if (this.textureMode === 'classic') {
          if (tHit.seg.isJamb || tHit.seg.isFrame) {
            blitTransparentBand(x, wallTopYT, bottomYT, tTex, tTexX, tShade, doorTopYT, bottomYT, dist);
            if (dLintelTex) {
              blitTransparentBand(x, wallTopYT, bottomYT, dLintelTex, dLintelX, tShade, wallTopYT, doorTopYT + 1, dist);
            }
          } else if (tHit.isDoor) {
            blitTransparentBand(x, doorTopYT, bottomYT, tTex, tTexX, tShade, doorTopYT, bottomYT, dist);
            if (dLintelTex) {
              blitTransparentBand(x, wallTopYT, bottomYT, dLintelTex, dLintelX, tShade, wallTopYT, doorTopYT + 1, dist);
            }
          } else {
            blitTransparentBand(x, wallTopYT, bottomYT, tTex, tTexX, tShade, wallTopYT, bottomYT, dist);
          }
        } else {
          blitFlatTransparentBand(x, wallTopYT, bottomYT, 0x2288bb, tShade, wallTopYT, bottomYT, dist);
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
   * Recolecta todos los sprites / objetos billboard del mapa (monitores, etc.)
   */
  collectSprites() {
    const sprites = [];
    if (!this.map || !Array.isArray(this.map)) return sprites;
    for (let y = 0; y < this.mapHeight; y++) {
      const row = this.map[y];
      if (!Array.isArray(row)) continue;
      for (let x = 0; x < this.mapWidth; x++) {
        const cell = row[x];
        let monCode = null;
        let charCode = null;
        if (Array.isArray(cell)) {
          monCode = cell.find(c => typeof c === 'string' && (c === 'MON' || c.startsWith('MON_')));
          charCode = cell.find(c => typeof c === 'string' && (c === 'CHAR' || c.startsWith('CHAR_')));
        } else if (typeof cell === 'string') {
          if (cell === 'MON' || cell.startsWith('MON_')) monCode = cell;
          if (cell === 'CHAR' || cell.startsWith('CHAR_')) charCode = cell;
        }

        if (monCode) {
          // Orientación del monitor en el mundo:
          // MON_L: mira hacia la Izquierda (Norte, -Math.PI / 2)
          // MON_R: mira hacia la Derecha (Sur, Math.PI / 2)
          // MON / MON_F: mira hacia el Frente (Este, 0)
          // MON_B: mira hacia Detrás (Oeste, Math.PI)
          let facingAngle = 0; // Frente (Este)
          if (monCode === 'MON_R') facingAngle = Math.PI / 2; // Derecha (Sur)
          else if (monCode === 'MON_L') facingAngle = -Math.PI / 2; // Izquierda (Norte)
          else if (monCode === 'MON_B') facingAngle = Math.PI; // Detrás (Oeste)

          sprites.push({
            x: x + 0.5,
            y: y + 0.5,
            mapX: x,
            mapY: y,
            type: 'monitor',
            facingAngle: facingAngle,
            z: this.tableHeightScale - 0.04 // Bajado a 0.955m
          });
        }

        if (charCode) {
          // Orientación del personaje en el mundo:
          let facingAngle = 0; // Frente (Este)
          if (charCode === 'CHAR_R') facingAngle = Math.PI / 2; // Derecha (Sur)
          else if (charCode === 'CHAR_L') facingAngle = -Math.PI / 2; // Izquierda (Norte)
          else if (charCode === 'CHAR_B') facingAngle = Math.PI; // Detrás (Oeste)

          sprites.push({
            x: x + 0.5,
            y: y + 0.5,
            mapX: x,
            mapY: y,
            type: 'character',
            facingAngle: facingAngle,
            z: this.characterElevation ?? -0.18 // Asentado y centrado en la celda
          });
        }
      }
    }
    return sprites;
  }

  /**
   * Renderiza sprites billboard en primera persona que siempre miran al jugador
   */
  renderSprites(player) {
    const sprites = this.collectSprites();
    if (!sprites || sprites.length === 0) return;

    const { posX, posY, dirX, dirY, planeX, planeY } = player;
    const w = this.width;
    const h = this.height;
    const halfH = this.halfHeight;
    const pixels = this.pixels;

    // Calcular distancia al cuadrado para ordenación
    for (let i = 0; i < sprites.length; i++) {
      const s = sprites[i];
      s.distSq = (posX - s.x) * (posX - s.x) + (posY - s.y) * (posY - s.y);
    }
    // Ordenar de más lejos a más cerca
    sprites.sort((a, b) => b.distSq - a.distSq);

    const invDet = 1.0 / (planeX * dirY - dirX * planeY);
    const eyeHeight = this.wallHeightScale / 2; // 1.5
    const centerRayX = Math.floor(w / 2);

    for (let i = 0; i < sprites.length; i++) {
      const sprite = sprites[i];

      // Determinar la variante según el ángulo relativo desde el que el jugador observa el sprite
      let activeVariant = 'front';
      if (typeof sprite.facingAngle === 'number') {
        const dx = posX - sprite.x;
        const dy = posY - sprite.y;
        const angleToPlayer = Math.atan2(dy, dx);
        let diff = angleToPlayer - sprite.facingAngle;
        diff = (diff + 3 * Math.PI) % (2 * Math.PI) - Math.PI;

        const octant = Math.PI / 4; // 45°
        if (Math.abs(diff) < octant) {
          activeVariant = 'front';
        } else if (Math.abs(diff) > 3 * octant) {
          activeVariant = 'back';
        } else if (diff < 0) {
          activeVariant = 'left';
        } else {
          activeVariant = 'right';
        }
      }

      const isChar = sprite.type === 'character';
      const monTex = isChar
        ? ((typeof getCharacterPixels === 'function') ? getCharacterPixels(activeVariant) : (this.textures?.character || null))
        : ((typeof getMonitorPixels === 'function') ? getMonitorPixels(activeVariant) : (this.textures?.monitor || null));

      if (!monTex) continue;
      const texW = monTex.width || 256;
      const texH = monTex.height || 256;

      const spriteX = sprite.x - posX;
      const spriteY = sprite.y - posY;

      const transformX = invDet * (dirY * spriteX - dirX * spriteY);
      const transformY = invDet * (-planeY * spriteX + planeX * spriteY);

      if (transformY <= 0.15) continue; // Detrás o muy cerca de la cámara

      const proj = h / transformY;
      const spriteScreenX = Math.floor((w / 2) * (1 + transformX / transformY));

      // Escala del objeto en el mundo:
      // Para el personaje sentado: altura 2.0m (exactamente 2/3 de una pared de 3.0m, es decir 128px de 192px)
      // Para el monitor encima de la mesa: ~0.72m de ancho y alto
      const spriteWorldW = isChar ? 2.0 : 0.72;
      const spriteWorldH = isChar ? 2.0 : 0.72;
      const spriteScreenWidth = Math.abs(Math.floor(spriteWorldW * proj));
      const spriteScreenHeight = Math.abs(Math.floor(spriteWorldH * proj));

      // Elevación: personaje en suelo (z = -0.18m centrado en celda), monitor elevado en mesa (z = tableHeightScale - 0.04)
      const baseElevation = (typeof sprite.z === 'number') ? sprite.z : (isChar ? (this.characterElevation ?? -0.18) : (this.tableHeightScale - 0.04));
      const bottomY = halfH + (eyeHeight - baseElevation) * proj;
      const topY = bottomY - spriteScreenHeight;

      const drawStartY = Math.max(0, Math.floor(topY));
      const drawEndY = Math.min(h - 1, Math.floor(bottomY));

      // Ajuste de eje para monitores:
      // En vista lateral, el soporte ya está en el fondo de la mesa (+52.5px en textura de 256px = +20.5% del ancho del sprite).
      // Para vistas frontal y trasera, desplazamos la posición horizontal para que el soporte se coloque en el punto rojo (alineado con la línea).
      let effScreenX = spriteScreenX;
      if (!isChar && (activeVariant === 'front' || activeVariant === 'back')) {
        effScreenX += Math.round(spriteScreenWidth * (52.5 / 256));
      }

      const drawStartX = Math.max(0, Math.floor(effScreenX - spriteScreenWidth / 2));
      const drawEndX = Math.min(w - 1, Math.floor(effScreenX + spriteScreenWidth / 2));

      if (drawStartX > w - 1 || drawEndX < 0 || drawStartY > h - 1 || drawEndY < 0) continue;

      // Detección cuando el jugador mira directamente al sprite
      if (centerRayX >= drawStartX && centerRayX <= drawEndX && transformY <= 3.2) {
        if (!this.facingTarget || this.facingTarget.rawDist > transformY) {
          const variantNames = isChar ? {
            front: 'Personaje (Frente)',
            right: 'Personaje (Perfil Derecho)',
            left: 'Personaje (Perfil Izquierdo)',
            back: 'Personaje (Espaldas)'
          } : {
            front: 'Monitor PC (Frente)',
            right: 'Monitor PC (Perfil Derecho)',
            left: 'Monitor PC (Perfil Izquierdo)',
            back: 'Monitor PC (Parte Trasera)'
          };
          this.facingTarget = {
            name: variantNames[activeVariant] || (isChar ? 'Personaje' : 'Monitor PC'),
            type: isChar ? 'character' : 'monitor',
            distance: transformY.toFixed(1),
            rawDist: transformY,
            mapX: sprite.mapX,
            mapY: sprite.mapY
          };
        }
      }

      const shade = Math.min(1, 1 / (1 + transformY * 0.22));

      for (let stripe = drawStartX; stripe <= drawEndX; stripe++) {
        // Comprobar oclusión contra el Z-Buffer general de muros
        if (transformY >= this.zBuffer[stripe]) continue;

        const texX = Math.floor((stripe - (effScreenX - spriteScreenWidth / 2)) * texW / spriteScreenWidth);
        if (texX < 0 || texX >= texW) continue;

        const totalH = Math.max(0.0001, bottomY - topY);
        const step = texH / totalH;
        let texPos = (drawStartY - topY) * step;

        for (let y = drawStartY; y <= drawEndY; y++) {
          const pIdx = y * w + stripe;
          // Oclusión exacta por píxel: para personajes (sentados tras la mesa), la tapa de la mesa debe taparle las piernas/cuerpo.
          // Para monitores y accesorios sobre la mesa, deben permanecer SIEMPRE visibles sobre la tapa de la mesa y no cortarse.
          if (isChar && this.pixelDepthBuffer && transformY >= this.pixelDepthBuffer[pIdx]) {
            texPos += step;
            continue;
          }

          const texY = Math.min(texH - 1, Math.max(0, Math.floor(texPos)));
          texPos += step;

          const color = monTex[texY * texW + texX];
          const a = (color >> 24) & 0xFF;
          if (a < 15) continue; // Píxel transparente del sprite

          const r = Math.floor((color & 0xFF) * shade);
          const g = Math.floor(((color >> 8) & 0xFF) * shade);
          const b = Math.floor(((color >> 16) & 0xFF) * shade);

          if (a >= 250) {
            pixels[pIdx] = (255 << 24) | (b << 16) | (g << 8) | r;
            if (this.pixelDepthBuffer) {
              this.pixelDepthBuffer[pIdx] = transformY;
            }
          } else {
            const prev = pixels[pIdx];
            const prevR = prev & 0xFF;
            const prevG = (prev >> 8) & 0xFF;
            const prevB = (prev >> 16) & 0xFF;
            const alphaRatio = a / 255;
            const invAlpha = 1 - alphaRatio;
            const fR = Math.min(255, Math.floor(r * alphaRatio + prevR * invAlpha));
            const fG = Math.min(255, Math.floor(g * alphaRatio + prevG * invAlpha));
            const fB = Math.min(255, Math.floor(b * alphaRatio + prevB * invAlpha));
            pixels[pIdx] = (255 << 24) | (fB << 16) | (fG << 8) | fR;
            if (this.pixelDepthBuffer && transformY < this.pixelDepthBuffer[pIdx]) {
              this.pixelDepthBuffer[pIdx] = transformY;
            }
          }
        }
      }
    }
  }

  /**
   * Dibuja el radar / minimapa 2D con la posición y ángulo del jugador
   */
  renderMinimap(player) {
    const ctx = this.minimapCtx;
    const cw = this.minimapCanvas.width;
    const ch = this.minimapCanvas.height;
    const centerX = cw / 2;
    const centerY = ch / 2;
    const zoomLevel = this.minimapZoomLevel ?? -1;
    const cellSize = this.minimapZoomCellSizes[zoomLevel] || 20;

    ctx.clearRect(0, 0, cw, ch);
    ctx.save();

    // Fondo del radar (vacío fuera del mapa)
    ctx.fillStyle = '#080a0f';
    ctx.fillRect(0, 0, cw, ch);

    // Dibujar celdas relativas a la posición del jugador
    for (let y = 0; y < this.mapHeight; y++) {
      for (let x = 0; x < this.mapWidth; x++) {
        const px = Math.round(centerX + (x - player.posX) * cellSize);
        const py = Math.round(centerY + (y - player.posY) * cellSize);

        // Omitir celdas fuera del campo de visión del minimapa
        if (px + cellSize < -2 || px > cw + 2 || py + cellSize < -2 || py > ch + 2) {
          continue;
        }

        // Suelo base de la celda
        ctx.fillStyle = '#141824';
        ctx.fillRect(px, py, cellSize, cellSize);

        // Cuadrícula sutil
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px, py, cellSize, cellSize);

        const codes = this.getCellCodes(x, y);
        const th = Math.max(2, Math.round(cellSize * 0.12));
        const thDoor = Math.max(2, Math.round(cellSize * 0.14));
        const dOffset = 0;

        let hasMesa = false;
        if (typeof codes === 'number' && (codes === 9 || (codes >= 15 && codes <= 21))) {
          hasMesa = true;
        } else if (Array.isArray(codes)) {
          hasMesa = codes.some(c => (typeof c === 'string' && c.startsWith('T')) || (typeof c === 'number' && (c === 9 || (c >= 15 && c <= 21))));
        }

        // Mesa en el minimapa (al fondo de la celda)
        if (hasMesa) {
          ctx.fillStyle = '#8b5a2b';
          const pad = Math.max(1, Math.round(cellSize * 0.15));
          ctx.fillRect(px + pad, py + pad, cellSize - pad * 2, cellSize - pad * 2);
        }

        // Monitor en el minimapa (icono cian brillante de pantalla)
        let hasMon = false;
        if (typeof codes === 'string' && (codes === 'MON' || codes.startsWith('MON_'))) hasMon = true;
        else if (Array.isArray(codes)) hasMon = codes.some(c => typeof c === 'string' && (c === 'MON' || c.startsWith('MON_')));
        if (hasMon) {
          ctx.fillStyle = '#00f0ff';
          const monSize = Math.max(4, Math.round(cellSize * 0.35));
          const offset = Math.round((cellSize - monSize) / 2);
          ctx.fillRect(px + offset, py + offset, monSize, monSize);
        }

        // Personaje en el minimapa (icono amarillo cálido)
        let hasChar = false;
        if (typeof codes === 'string' && (codes === 'CHAR' || codes.startsWith('CHAR_'))) hasChar = true;
        else if (Array.isArray(codes)) hasChar = codes.some(c => typeof c === 'string' && (c === 'CHAR' || c.startsWith('CHAR_')));
        if (hasChar) {
          const charSize = Math.max(5, Math.round(cellSize * 0.45));
          const offset = Math.round((cellSize - charSize) / 2);
          ctx.fillStyle = '#fceaa6';
          ctx.beginPath();
          ctx.arc(px + offset + charSize / 2, py + offset + charSize / 2, charSize / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#222';
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Paredes y puertas por encima de la mesa
        if (Array.isArray(codes)) {
          for (let s = 0; s < codes.length; s++) {
            const code = codes[s];
            if (typeof code === 'string' && code.startsWith('T')) continue;
            const isDoor = typeof code === 'string' && code.startsWith('D');
            const isWin = typeof code === 'string' && code.startsWith('W');
          let doorType = 2;
          if (code === 'DN') doorType = 2;
          else if (code === 'DE') doorType = 3;
          else if (code === 'DS') doorType = 4;
          else if (code === 'DW') doorType = 5;

          const doorColor = this.doorInfo[doorType]?.color || '#e5a93b';
          if (isDoor) ctx.fillStyle = doorColor;
          else if (isWin) ctx.fillStyle = '#54a0ff';
          else ctx.fillStyle = '#7a828e';

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
            // Puertas Abiertas en Minimapa (Abatidas 90° con grosor)
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
  }

    // Anillos sutiles de distancia de radar
    ctx.strokeStyle = 'rgba(79, 163, 227, 0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.arc(centerX, centerY, cellSize * 1.5, 0, Math.PI * 2);
    ctx.arc(centerX, centerY, cellSize * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Dibujar jugador en el centro del radar
    const playerPx = centerX;
    const playerPy = centerY;

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
    ctx.fillStyle = 'rgba(0, 210, 211, 0.28)';
    ctx.fill();

    // Línea de dirección de la mirada
    ctx.beginPath();
    ctx.moveTo(playerPx, playerPy);
    ctx.lineTo(
      playerPx + player.dirX * (cellSize * 1.8),
      playerPy + player.dirY * (cellSize * 1.8)
    );
    ctx.strokeStyle = '#00d2d3';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Halo y punto del jugador
    ctx.beginPath();
    ctx.arc(playerPx, playerPy, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#00d2d3';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(playerPx, playerPy, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.restore();
  }

  /**
   * Cambia el nivel de zoom del minimapa (-1, 0, 1)
   */
  setMinimapZoom(level) {
    if (level === -1 || level === 0 || level === 1) {
      this.minimapZoomLevel = level;
    }
    return this.minimapZoomLevel;
  }

  /**
   * Alterna de forma circular entre los 3 niveles de zoom: 0 -> -1 -> +1 -> 0
   */
  cycleMinimapZoom() {
    if (this.minimapZoomLevel === 0) {
      this.minimapZoomLevel = -1;
    } else if (this.minimapZoomLevel === -1) {
      this.minimapZoomLevel = 1;
    } else {
      this.minimapZoomLevel = 0;
    }
    return this.minimapZoomLevel;
  }

  /**
   * Redimensiona el buffer y resolución interna del motor para mantener máxima nitidez
   */
  resize(width, height) {
    width = Math.max(320, Math.floor(width));
    height = Math.max(200, Math.floor(height));
    if (this.width === width && this.height === height && this.canvas.width === width && this.canvas.height === height) {
      return;
    }
    this.width = width;
    this.height = height;
    this.halfHeight = Math.floor(height / 2);
    this.canvas.width = width;
    this.canvas.height = height;
    this.imgData = this.ctx.createImageData(width, height);
    this.pixels = new Uint32Array(this.imgData.data.buffer);
    this.zBuffer = new Float32Array(width);
  }
}

// Exportación para compatibilidad con módulos o entornos globales
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RaycasterEngine };
}

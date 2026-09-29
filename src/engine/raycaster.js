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
   * Detecta si el cursor central está apuntando directamente a una puerta interactuable
   * (abierta o cerrada) dentro de la distancia máxima de interacción (maxDistance).
   * Si el jugador no apunta a la puerta (o está de espaldas), devuelve null.
   * Retorna { action: 'open'|'close', mapX, mapY, name, distance } o null.
   */
  getDoorInReach(player, maxDistance = 1.5) {
    if (!this.facingTarget) return null;
    const isDoor = (this.facingTarget.type === 'door' || this.facingTarget.type === 'door-open');
    if (!isDoor) return null;

    const dist = (this.facingTarget.rawDist !== undefined)
      ? this.facingTarget.rawDist
      : parseFloat(this.facingTarget.distance);

    if (isNaN(dist) || dist > maxDistance) return null;
    if (this.facingTarget.mapX === undefined || this.facingTarget.mapY === undefined) return null;

    const mX = this.facingTarget.mapX;
    const mY = this.facingTarget.mapY;
    if (mY < 0 || mY >= this.mapHeight || mX < 0 || mX >= this.mapWidth) return null;

    const cell = this.map[mY] && this.map[mY][mX];
    const isAlreadyOpen = (this.facingTarget.type === 'door-open') ||
      (Array.isArray(cell) && cell.some(c => typeof c === 'string' && c.startsWith('OD')));

    return {
      action: isAlreadyOpen ? 'close' : 'open',
      mapX: mX,
      mapY: mY,
      name: this.facingTarget.name || 'Puerta',
      distance: dist
    };
  }

  /**
   * Alterna (abre o cierra) la puerta a la que apunta el cursor central dentro del rango.
   */
  interactDoor(player, maxDistance = 1.5) {
    const found = this.getDoorInReach(player, maxDistance);
    if (!found) return null;
    if (found.action === 'close') {
      return this.closeDoor(found.mapX, found.mapY, player);
    } else {
      return this.openDoor(found.mapX, found.mapY);
    }
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
    const doorInset = 0;
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
        { axis: 'x', pos: odLeafX1, minY: y0, maxY: y1, type, name, style, isOpenDoor: true, isCap: true, flipTex: true, lintelStyle: lintelStyleS },
        { axis: 'x', pos: odLeafX0, minY: y0, maxY: y1, type, name, style, isOpenDoor: true, isCap: true, flipTex: true, lintelStyle: lintelStyleS },
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
        { axis: 'y', pos: odLeafY1, minX: x0, maxX: x1, type, name, style, isOpenDoor: true, isCap: true, flipTex: true, lintelStyle: lintelStyleE },
        { axis: 'y', pos: odLeafY0, minX: x0, maxX: x1, type, name, style, isOpenDoor: true, isCap: true, flipTex: true, lintelStyle: lintelStyleE },
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

      // Cargar también imagen física del canto/jamba
      const isStandalone = typeof window !== 'undefined' && !!window.STANDALONE_PROJECT;
      const baseTexDir = isStandalone ? 'assets/textures/' : '/src/assets/textures/';
      let capUrl = def.capPngUrl || (def.capFile ? (baseTexDir + def.capFile) : (baseTexDir + 'caps/' + style + '.png'));
      if (capUrl && (capUrl.includes('/src/engine/textures/') || capUrl.includes('/src/assets/texturas/'))) {
        capUrl = capUrl.replace('/src/engine/textures/', baseTexDir).replace('/src/assets/texturas/', baseTexDir);
      }
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

      let doorCapUrl = def.capPngUrl || (def.capFile ? (baseTexDir + def.capFile) : (baseTexDir + 'caps/' + style + '.png'));
      if (doorCapUrl && (doorCapUrl.includes('/src/engine/textures/') || doorCapUrl.includes('/src/assets/texturas/'))) {
        doorCapUrl = doorCapUrl.replace('/src/engine/textures/', baseTexDir).replace('/src/assets/texturas/', baseTexDir);
      }
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
          if (typeof ctx.strokeRect === 'function') ctx.strokeRect(x, y, 8, 8);
      const arr = new Uint32Array(ctx.getImageData(0, 0, width, height).data.buffer);
      arr.width = width; arr.height = height;
      return arr;
    };

    this.textures[9]['mesa']    = makeMesaPixels(64, 64, 'both');
    this.textures[9]['castle']  = this.textures[1]['castle'] || this.textures[1]['castillo'] || makeMesaPixels(64, 64, 'both');
    this.textures[9]['castillo']= this.textures[9]['castle'];
    this.textures[14]['mesa']   = makeMesaTopPixels(64, 64);
    this.textures[14]['castle'] = this.textures[14]['mesa'];
    this.textures[14]['castillo']= this.textures[14]['mesa'];
    this.textures[15]['mesa']   = makeMesaPixels(64, 64, 'none');
    this.textures[15]['castle'] = this.textures[15]['mesa'];
    this.textures[15]['castillo']= this.textures[15]['mesa'];
    this.textures[22]['mesa']   = makeMesaPixels(64, 64, 'left');
    this.textures[22]['castle'] = this.textures[22]['mesa'];
    this.textures[22]['castillo']= this.textures[22]['mesa'];
    this.textures[23]['mesa']   = makeMesaPixels(64, 64, 'right');
    this.textures[23]['castle'] = this.textures[23]['mesa'];
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

      const mesaBase = (typeof window !== 'undefined' && window.STANDALONE_PROJECT) ? 'assets/textures/custom/' : '/src/assets/textures/custom/';
      loadMesaLateral(mesaBase + 'mesa-l.png');
      loadMesaTop(mesaBase + 'mesa-t.png');
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
    const base = (typeof window !== 'undefined' && window.STANDALONE_PROJECT) ? 'assets/textures/' : '/src/assets/textures/';
    const files = {
      1: 'walls/castle.png',
      2: 'doors/castle.png',
      3: 'doors/castle.png',
      4: 'doors/castle.png',
      5: 'doors/castle.png',
      6: 'windows/window.png',
      10: 'caps/castle.png',
      11: 'caps/castle.png'
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

  _ensureCeilingGrid() {
    if (this._ceilingGrid && this._ceilingGridMapRef === this.ceilingsMap && this._ceilingGridW === this.mapWidth && this._ceilingGridH === this.mapHeight) {
      return this._ceilingGrid;
    }
    const mw = this.mapWidth;
    const mh = this.mapHeight;
    const grid = Array.from({ length: mh }, () => new Array(mw).fill(null));
    if (this.ceilingsMap && this.ceilingsMap.size > 0) {
      for (const [key, style] of this.ceilingsMap.entries()) {
        const comma = key.indexOf(',');
        if (comma !== -1) {
          const cx = parseInt(key.slice(0, comma), 10);
          const cy = parseInt(key.slice(comma + 1), 10);
          if (cy >= 0 && cy < mh && cx >= 0 && cx < mw) {
            grid[cy][cx] = style;
          }
        }
      }
    }
    this._ceilingGrid = grid;
    this._ceilingGridMapRef = this.ceilingsMap;
    this._ceilingGridW = mw;
    this._ceilingGridH = mh;
    return grid;
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

    // 1. Dibujar Techo (degradado de fondo + textura por celda donde haya techo definido)
    // Formato de píxel en Little Endian Uint32: 0xAABBGGRR
    const eyeHeight = this.wallHeightScale / 2 + (player.elevation || 0); // 1.5m (+ elevación de escalera) — compartido con suelo
    const rayDirX0 = dirX - planeX;
    const rayDirY0 = dirY - planeY;
    const rayDirX1 = dirX + planeX;
    const rayDirY1 = dirY + planeY;

    // Mapa de techo: acceso O(1) vía matriz 2D sin crear strings en bucle interno
    const ceilingsMap = this.ceilingsMap;
    const hasCeilings = ceilingsMap && ceilingsMap.size > 0;
    const ceilGrid = hasCeilings ? this._ensureCeilingGrid() : null;
    const mapW = this.mapWidth;
    const mapH = this.mapHeight;

    // Cache de texturas por styleKey para no buscar en cada píxel
    const ceilTexCache = {};
    const getCeilTex = (styleKey) => {
      if (ceilTexCache[styleKey] !== undefined) return ceilTexCache[styleKey];
      const t = (typeof CEILING_STYLES !== 'undefined') ? (CEILING_STYLES[styleKey] || CEILING_STYLES['blanca'] || null) : null;
      ceilTexCache[styleKey] = t ? t.pixels : null;
      return ceilTexCache[styleKey];
    };

    for (let y = 0; y < Math.max(0, Math.min(h, horizon)); y++) {
      const rowAbove = horizon - y; // distancia vertical al horizonte (simétrico al suelo)
      const ceilOffset = y * w;

      if (rowAbove === 0) {
        // Línea de horizonte: color neutro
        const horizColor = (255 << 24) | (24 << 16) | (20 << 8) | 18;
        for (let x = 0; x < w; x++) pixels[ceilOffset + x] = horizColor;
        continue;
      }

      // Degradado de fondo (azul noche)
      const ceilRatio = y / halfH;
      const cR0 = Math.floor(10 + ceilRatio * 8);
      const cG0 = Math.floor(12 + ceilRatio * 10);
      const cB0 = Math.floor(22 + ceilRatio * 16);
      const bgCeilColor = (255 << 24) | (cB0 << 16) | (cG0 << 8) | cR0;

      if (!hasCeilings || !ceilGrid) {
        // Sin techos definidos: solo degradado
        for (let x = 0; x < w; x++) pixels[ceilOffset + x] = bgCeilColor;
        continue;
      }

      // Floor-cast espejado para el techo
      const rowDist = (eyeHeight * h) / rowAbove;
      const ceilStepX = rowDist * (rayDirX1 - rayDirX0) / w;
      const ceilStepY = rowDist * (rayDirY1 - rayDirY0) / w;
      let ceilFloorX = posX + rowDist * rayDirX0;
      let ceilFloorY = posY + rowDist * rayDirY0;

      const shade = Math.min(1, 1 / (1 + rowDist * 0.18));
      const fogRatio = Math.min(1, Math.max(0, (rowDist - 1.2) / 18.0));
      const invFog = 1 - fogRatio;

      for (let x = 0; x < w; x++, ceilFloorX += ceilStepX, ceilFloorY += ceilStepY) {
        const cellX = Math.floor(ceilFloorX);
        const cellY = Math.floor(ceilFloorY);
        let styleKey = null;
        if (cellY >= 0 && cellY < mapH && cellX >= 0 && cellX < mapW) {
          styleKey = ceilGrid[cellY][cellX];
        }

        if (styleKey) {
          const ceilTexPx = getCeilTex(styleKey);
          if (!ceilTexPx) { pixels[ceilOffset + x] = bgCeilColor; continue; }
          const ceilTexW = ceilTexPx.width || 64;
          const ceilTexH = ceilTexPx.height || 64;
          const ftx = Math.floor((ceilFloorX - cellX) * ceilTexW) & (ceilTexW - 1);
          const fty = Math.floor((ceilFloorY - cellY) * ceilTexH) & (ceilTexH - 1);
          const raw = ceilTexPx[fty * ceilTexW + ftx];
          const r = Math.min(255, Math.floor(((raw) & 0xFF) * shade * invFog + 10 * fogRatio));
          const g = Math.min(255, Math.floor(((raw >> 8) & 0xFF) * shade * invFog + 12 * fogRatio));
          const b = Math.min(255, Math.floor(((raw >> 16) & 0xFF) * shade * invFog + 22 * fogRatio));
          pixels[ceilOffset + x] = (255 << 24) | (b << 16) | (g << 8) | r;
          this.pixelDepthBuffer[ceilOffset + x] = rowDist;
        } else {
          pixels[ceilOffset + x] = bgCeilColor;
          this.pixelDepthBuffer[ceilOffset + x] = Infinity;
        }
      }
    }

    // 1.1. Dibujar Suelo con perspectiva 3D tipo Tablero de Ajedrez (1 casilla = 1 celda del editor de 1.0m x 1.0m)
    // Permite visualizar con total claridad la posición exacta de cada elemento y del personaje sentado

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

        // Omitir suelo plano a nivel 0 si la celda es una escalera que baja hacia el sótano (para ver el hueco en 3D)
        const cellVal = (this.map && this.map[cellY]) ? this.map[cellY][cellX] : null;
        let isDownStair = false;
        if (typeof cellVal === 'string' && cellVal.startsWith('STAIRS_DOWN')) isDownStair = true;
        else if (Array.isArray(cellVal)) isDownStair = cellVal.some(c => typeof c === 'string' && c.startsWith('STAIRS_DOWN'));
        if (isDownStair) {
          // El suelo a cota 0 desaparece completamente dejando el foso abierto al sótano
          // Fondo del sótano limpio y arquitectónico (no negro abisal)
          const pitShade = Math.min(1, 1 / (1 + rowDist * 0.16));
          const pitR = Math.floor(185 * pitShade);
          const pitG = Math.floor(190 * pitShade);
          const pitB = Math.floor(200 * pitShade);
          pixels[rowPixelBase + x] = (255 << 24) | (pitB << 16) | (pitG << 8) | pitR;
          this.pixelDepthBuffer[rowPixelBase + x] = Infinity;
          continue;
        }

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
        this.pixelDepthBuffer[rowPixelBase + x] = rowDist;
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

      const eyeHeight = this.wallHeightScale / 2 + (player.elevation || 0); // 1.5 (+ elevación escalera)

      // Si solo hay mesa y no hay otro opaco, usar mesa como hitBottom
      if (!hitBottom && hitTable) {
        hitBottom = hitTable;
      }

      // Factor de sombra por distancia y orientación (eje Y más sombreado para profundidad)
      const shadeOf = (dist, side) => {
        let s = 1 / (1 + dist * 0.22);
        if (side === 1) s *= 0.72;
        return s;
      };
      // Coordenada horizontal de la textura para PAREDES (flip según dirección del rayo)
      const texXOf = (coord, side, texW = 64) => {
        let tx = Math.floor(Math.max(0, Math.min(0.999, coord)) * texW);
        if (side === 0 && rayDirX < 0) tx = texW - tx - 1;
        if (side === 1 && rayDirY > 0) tx = texW - tx - 1;
        return tx;
      };
      // Coordenada horizontal para PUERTAS:
      // El picaporte está en el lado DERECHO de la textura (tx≈47 en 64px).
      // wallX=0 → lado bisagra (inicio hoja), wallX=1 → lado picaporte.
      // flipTex=true cuando la rotación de apertura invierte el mapeo (ODS, ODE).
      const doorTexXOf = (coord, side, mX, mY, segPos, texW = 64, flipTex = false) => {
        let tx = Math.floor(Math.max(0, Math.min(0.999, coord)) * texW);
        if (flipTex) tx = texW - tx - 1;
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
          const tTexX = tHit.isDoor
            ? doorTexXOf(tHit.wallX, tHit.side, tHit.mapX, tHit.mapY, tHit.seg.pos, tTex.width || 64, !!tHit.seg.flipTex)
            : texXOf(tHit.wallX, tHit.side, tTex.width || 64);
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
          const bTexX = hitBottom.isDoor
            ? doorTexXOf(hitBottom.wallX, hitBottom.side, hitBottom.mapX, hitBottom.mapY, hitBottom.seg.pos, bTex.width || 64, !!hitBottom.seg.flipTex)
            : texXOf(hitBottom.wallX, hitBottom.side, bTex.width || 64);
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
            const odTexX = doorTexXOf(od.wallX, od.side, od.mapX, od.mapY, od.seg.pos, odTex.width || 64, !!od.seg.flipTex);
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
            const bottomYTbl = horizon + eyeHeight * projTbl;
            const tableTopYTbl = horizon - (this.tableHeightScale - eyeHeight) * projTbl;
            blitFlatBand(tableTopYTbl, bottomYTbl, 0x3a69a0, shadeOf(tblHit.dist, tblHit.side), tableTopYTbl, bottomYTbl, tblHit.dist);
          } else if (layer.kind === 'openDoor') {
            const od = layer.hit;
            const projDoor = h / Math.max(od.dist, 0.0001);
            const bottomYDoor = horizon + eyeHeight * projDoor;
            const doorTopYDoor = horizon - (this.doorHeightScale - eyeHeight) * projDoor;
            blitFlatBand(doorTopYDoor, bottomYDoor, 0x00a5ff, shadeOf(od.dist, od.side), doorTopYDoor, bottomYDoor, od.dist);
          } else if (layer.kind === 'lintel') {
            const lHit = layer.hit;
            const projL = h / Math.max(lHit.dist, 0.0001);
            const wallTopYL = horizon - (this.wallHeightScale - eyeHeight) * projL;
            const doorTopYL = horizon - (this.doorHeightScale - eyeHeight) * projL;
            const bottomYL = horizon + eyeHeight * projL;
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
      const eyeHeight = this.wallHeightScale / 2 + (player.elevation || 0);
      const surfaceH = this.tableHeightScale;
      const eyeAbove = eyeHeight - surfaceH;

      for (let y = Math.ceil(horizon) + 1; y < h; y++) {
        const rowOffset = y - horizon;
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

    // 2.4. Renderizar Escaleras 3D (peldaños, caras verticales y huellas)
    this.renderStairs(player);

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

    // Debug: guías de centrado (activar con 'G')
    if (this.debugGuide) {
      this._drawDebugGuide(this.ctx, w, h, player);
    }

    // 3. Renderizar Minimapa
    if (this.minimapCtx) {
      this.renderMinimap(player);
    }
  }

  _drawDebugGuide(ctx, w, h, player) {
    const { posX, posY, dirX, dirY, planeX, planeY } = player;
    const horizon = h / 2 + Math.round(player.pitchOffset || 0);

    const project = (wx, wy, wz) => {
      const dx = wx - posX, dy = wy - posY;
      const invDet = 1.0 / (planeX * dirY - dirX * planeY);
      const tX = invDet * (dirY * dx - dirX * dy);
      const tY = invDet * (-planeY * dx + planeX * dy);
      if (tY <= 0.01) return null;
      const sx = (w / 2) * (1 + tX / tY);
      const sy = horizon + (0.5 - wz) * h / tY;
      return [sx, sy];
    };

    ctx.save();

    // Línea vertical amarilla en el centro de la pantalla
    ctx.strokeStyle = 'rgba(255, 220, 0, 0.75)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();

    // Guías sobre la mesa que el jugador mira
    const t = this.facingTarget;
    if (t && t.type === 'monitor' && t.mapX != null) {
      const mx = t.mapX, my = t.mapY;
      const th = this.tableHeightScale ?? 0.42;

      const ctr  = project(mx + 0.5, my + 0.5, th);
      const lft  = project(mx + 0.5, my,        th);
      const rgt  = project(mx + 0.5, my + 1,    th);

      // Líneas amarillas del centro a cada lateral de la mesa
      ctx.setLineDash([]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255, 220, 0, 0.9)';
      if (ctr && lft) {
        ctx.beginPath(); ctx.moveTo(ctr[0], ctr[1]); ctx.lineTo(lft[0], lft[1]); ctx.stroke();
      }
      if (ctr && rgt) {
        ctx.beginPath(); ctx.moveTo(ctr[0], ctr[1]); ctx.lineTo(rgt[0], rgt[1]); ctx.stroke();
      }

      // Línea vertical roja en el centro proyectado de la celda
      if (ctr) {
        ctx.strokeStyle = 'rgba(255, 60, 0, 0.85)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(ctr[0], 0); ctx.lineTo(ctr[0], h); ctx.stroke();
      }
    }

    ctx.restore();
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
          // Formato: MON_<Dir><Pos>
          // Dir: F=Este(frente), B=Oeste(detrás), L=Norte(izq), R=Sur(der)
          // Pos: b=fondo(0.25), c=centro(0.5), t=tope/frente(0.75) — relativo a la dirección de la pantalla
          // Ej: MON_Fb = frontal en el fondo de la mesa, MON_Rt = derecha al borde cercano
          const suffix = monCode.startsWith('MON_') ? monCode.slice(4) : '';
          const dir = (['F','B','L','R'].includes(suffix[0]?.toUpperCase()) ? suffix[0].toUpperCase() : 'F');
          const posStr = suffix.slice(1); // todo lo que viene después de la letra de dirección
          // Soporta letras b/c/t O un decimal directo ("0.85", "0.3", etc.)
          // Offsets calibrados por orientación.
          const posOffsets  = { b: 0.25, c: 0.50, t: 0.75 }; // F/B (por defecto)
          const posOffsetsL = { b: 0.35, c: 0.45, t: 0.65 };
          const posOffsetsR = { b: 0.35, c: 0.45, t: 0.65 };
          const _offsets = dir === 'L' ? posOffsetsL : dir === 'R' ? posOffsetsR : posOffsets;
          const _rawPo = posStr === '' ? 0.5
            : (posStr[0] >= '0' && posStr[0] <= '9') ? (parseFloat(posStr) || 0.5)
            : (_offsets[posStr[0]?.toLowerCase()] ?? 0.5);
          // Clamp: evitar que el sprite clippe en la pared (nunca en el borde exacto)
          const po = Math.max(0.001, Math.min(0.999, _rawPo));

          let facingAngle = 0;
          if (dir === 'R') facingAngle = Math.PI / 2;
          else if (dir === 'L') facingAngle = -Math.PI / 2;
          else if (dir === 'B') facingAngle = Math.PI;

          // Offset de profundidad en el eje correcto según orientación.
          // 't' = hacia el lado de la pantalla (cerca del espectador frontal).
          // 'b' = hacia el lado trasero (lejos del espectador frontal).
          let sx = x + 0.5, sy = y + 0.5;
          if (dir === 'F') sx = x + po;
          else if (dir === 'B') sx = x + (1 - po);
          else if (dir === 'L') sy = y + (1 - po);
          else if (dir === 'R') sy = y + po;

          const posKey = posStr[0]?.toLowerCase() || 'c';

          sprites.push({
            x: sx,
            y: sy,
            mapX: x,
            mapY: y,
            type: 'monitor',
            facingAngle,
            monitorDir: dir,
            monitorPos: posKey,
            z: this.tableHeightScale - 0.04
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
   * Renderiza las escaleras en 3D en el mundo (peldaños, caras verticales y huellas horizontales)
   */
  renderStairs(player) {
    if (!this.map || !Array.isArray(this.map)) return;
    const { posX, posY, dirX, dirY, planeX, planeY } = player;
    const w = this.width;
    const h = this.height;
    const halfH = this.halfHeight;
    const pitchOffset = Math.round(player.pitchOffset || 0);
    const horizon = halfH + pitchOffset;
    const eyeHeight = this.wallHeightScale / 2 + (player.elevation || 0);

    // 1. Recolectar celdas con escalera
    const stairsList = [];
    for (let my = 0; my < this.mapHeight; my++) {
      const row = this.map[my];
      if (!Array.isArray(row)) continue;
      for (let mx = 0; mx < this.mapWidth; mx++) {
        const cell = row[mx];
        let stairToken = null;
        if (typeof cell === 'string' && cell.startsWith('STAIRS_')) stairToken = cell;
        else if (Array.isArray(cell)) stairToken = cell.find(c => typeof c === 'string' && c.startsWith('STAIRS_'));
        if (stairToken) {
          const parts = stairToken.split('_');
          const dir = parts[1] || 'UP';
          const orient = parts[2] || 'N';
          const level = parseInt(parts[3], 10) || 1;
          const distSq = (posX - (mx + 0.5)) ** 2 + (posY - (my + 0.5)) ** 2;
          stairsList.push({ mx, my, dir, orient, level, distSq });
        }
      }
    }

    if (stairsList.length === 0) return;

    // Ordenar de más lejos a más cerca
    stairsList.sort((a, b) => b.distSq - a.distSq);

    for (let st = 0; st < stairsList.length; st++) {
      const stair = stairsList[st];
      const { mx, my, dir, orient, level } = stair;

      // Frustum culling: descartar escaleras que queden a la espalda o completamente fuera de pantalla
      const invDetCell = 1.0 / (planeX * dirY - dirX * planeY);
      const corners = [ [mx, my], [mx + 1, my], [mx + 1, my + 1], [mx, my + 1] ];
      let anyInFront = false;
      let minCol = w;
      let maxCol = -1;
      for (let c = 0; c < 4; c++) {
        const cdx = corners[c][0] - posX;
        const cdy = corners[c][1] - posY;
        const camY = invDetCell * (-planeY * cdx + planeX * cdy);
        if (camY > 0.05) {
          anyInFront = true;
          const camX = invDetCell * (dirY * cdx - dirX * cdy);
          const sx = Math.floor((w / 2) * (1 + camX / camY));
          if (sx < minCol) minCol = sx;
          if (sx > maxCol) maxCol = sx;
        }
      }
      if (!anyInFront) continue;
      if (maxCol < 0 || minCol >= w) continue;

      const isUp = (dir === 'UP');

      // Comprobar si hay celdas vecinas con escalera del mismo sentido y nivel
      // para no levantar paredes divisorias entre columnas dobles o tramos continuos
      const hasStairNeighbor = (nmx, nmy, checkLevel = true) => {
        if (nmy < 0 || nmy >= this.mapHeight || nmx < 0 || nmx >= this.mapWidth) return false;
        const nRow = this.map[nmy];
        if (!nRow) return false;
        const nCell = nRow[nmx];
        let nToken = null;
        if (typeof nCell === 'string' && nCell.startsWith('STAIRS_')) nToken = nCell;
        else if (Array.isArray(nCell)) nToken = nCell.find(c => typeof c === 'string' && c.startsWith('STAIRS_'));
        if (!nToken) return false;
        const np = nToken.split('_');
        const nDir = np[1] || 'UP';
        const nOrient = np[2] || 'N';
        const nLvl = parseInt(np[3], 10) || 1;
        if (checkLevel) {
          return (nDir === dir && nOrient === orient && nLvl === level);
        } else {
          return (nDir === dir && nOrient === orient);
        }
      };

      const hasWestStair = hasStairNeighbor(mx - 1, my, true);
      const hasEastStair = hasStairNeighbor(mx + 1, my, true);
      const hasNorthStair = hasStairNeighbor(mx, my - 1, false);
      const hasSouthStair = hasStairNeighbor(mx, my + 1, false);

      const steps = [];

      if (isUp) {
        // SUBIR: De 0m a +3m (N1: 0 a 1m, N2: 1 a 2m, N3: 2 a 3m)
        const baseH = (level - 1) * 1.0;
        if (baseH > 0) {
          steps.push({
            minX: mx, maxX: mx + 1.0,
            minY: my, maxY: my + 1.0,
            minZ: 0, maxZ: baseH,
            isBase: true
          });
        }

        const numSteps = 3;
        for (let i = 0; i < numSteps; i++) {
          const stepH = baseH + ((i + 1) / numSteps) * 1.0;
          let sMinX = mx, sMaxX = mx + 1.0;
          let sMinY = my, sMaxY = my + 1.0;

          if (orient === 'N') {
            sMinY = my + ((numSteps - 1 - i) / numSteps);
            sMaxY = sMinY + (1.0 / numSteps);
          } else if (orient === 'S') {
            sMinY = my + (i / numSteps);
            sMaxY = sMinY + (1.0 / numSteps);
          } else if (orient === 'E') {
            sMinX = mx + (i / numSteps);
            sMaxX = sMinX + (1.0 / numSteps);
          } else {
            sMinX = mx + ((numSteps - 1 - i) / numSteps);
            sMaxX = sMinX + (1.0 / numSteps);
          }

          steps.push({
            minX: sMinX, maxX: sMaxX,
            minY: sMinY, maxY: sMaxY,
            minZ: 0, maxZ: stepH,
            stepIdx: i
          });
        }
      } else {
        // BAJAR: Escaleras bajo el suelo (de 0m a -3m)
        // Nivel 3: 0m a -1m (Entrada al ras de suelo)
        // Nivel 2: -1m a -2m (Tramo intermedio)
        // Nivel 1: -2m a -3m (Llegada a cota de sótano -3m)
        const startZ = - (3 - level) * 1.0;
        const numSteps = 3;

        for (let i = 0; i < numSteps; i++) {
          const stepH = startZ - ((i + 1) / numSteps) * 1.0;
          const topRiserZ = startZ - (i / numSteps) * 1.0;
          let sMinX = mx, sMaxX = mx + 1.0;
          let sMinY = my, sMaxY = my + 1.0;

          if (orient === 'N') {
            sMinY = my + ((numSteps - 1 - i) / numSteps);
            sMaxY = sMinY + (1.0 / numSteps);
          } else if (orient === 'S') {
            sMinY = my + (i / numSteps);
            sMaxY = sMinY + (1.0 / numSteps);
          } else if (orient === 'E') {
            sMinX = mx + (i / numSteps);
            sMaxX = sMinX + (1.0 / numSteps);
          } else {
            sMinX = mx + ((numSteps - 1 - i) / numSteps);
            sMaxX = sMinX + (1.0 / numSteps);
          }

          steps.push({
            minX: sMinX, maxX: sMaxX,
            minY: sMinY, maxY: sMaxY,
            minZ: stepH, maxZ: stepH,
            topRiserZ,
            isDown: true,
            stepIdx: i
          });
        }
      }

      // Detección de paredes finas en la propia celda para alinear la pared del pozo exactamente con la pared superior
      const cellCodes = this.getCellCodes(mx, my) || [];
      const hasWestWall = Array.isArray(cellCodes) && (cellCodes.includes('W') || cellCodes.includes('WN') || cellCodes.includes('WS') || cellCodes.includes('WW') || cellCodes.includes('DW'));
      const hasEastWall = Array.isArray(cellCodes) && (cellCodes.includes('E') || cellCodes.includes('EN') || cellCodes.includes('ES') || cellCodes.includes('WE') || cellCodes.includes('DE'));
      const hasNorthWall = Array.isArray(cellCodes) && (cellCodes.includes('N') || cellCodes.includes('WN') || cellCodes.includes('EN') || cellCodes.includes('DN'));
      const hasSouthWall = Array.isArray(cellCodes) && (cellCodes.includes('S') || cellCodes.includes('WS') || cellCodes.includes('ES') || cellCodes.includes('DS'));

      const wallPosWest = hasWestWall ? (mx + 0.10) : mx;
      const wallPosEast = hasEastWall ? (mx + 0.90) : (mx + 1.0);
      const wallPosNorth = hasNorthWall ? (my + 0.10) : my;
      const wallPosSouth = hasSouthWall ? (my + 0.90) : (my + 1.0);

      // Renderizar cada caja/escalón
      for (let b = 0; b < steps.length; b++) {
        const box = steps[b];
        const { minX, maxX, minY, maxY, minZ, maxZ, isDown, topRiserZ } = box;

        if (isDown) {
          // Escalera hacia abajo (bajo el suelo):
          // 1. Contrahuella vertical entre peldaños (en blanco luminoso)
          if (orient === 'N') {
            if (posY > maxY) this._renderStairVerticalFace(player, horizon, eyeHeight, 'y', maxY, minX, maxX, minZ, topRiserZ, 0xffffff, 0.96);
            else if (posY < minY) this._renderStairVerticalFace(player, horizon, eyeHeight, 'y', minY, minX, maxX, minZ, topRiserZ, 0xffffff, 0.96);
          } else if (orient === 'S') {
            if (posY < minY) this._renderStairVerticalFace(player, horizon, eyeHeight, 'y', minY, minX, maxX, minZ, topRiserZ, 0xffffff, 0.96);
            else if (posY > maxY) this._renderStairVerticalFace(player, horizon, eyeHeight, 'y', maxY, minX, maxX, minZ, topRiserZ, 0xffffff, 0.96);
          } else if (orient === 'E') {
            if (posX < minX) this._renderStairVerticalFace(player, horizon, eyeHeight, 'x', minX, minY, maxY, minZ, topRiserZ, 0xffffff, 0.96);
            else if (posX > maxX) this._renderStairVerticalFace(player, horizon, eyeHeight, 'x', maxX, minY, maxY, minZ, topRiserZ, 0xffffff, 0.96);
          } else if (orient === 'O' || orient === 'W') {
            if (posX > maxX) this._renderStairVerticalFace(player, horizon, eyeHeight, 'x', maxX, minY, maxY, minZ, topRiserZ, 0xffffff, 0.96);
            else if (posX < minX) this._renderStairVerticalFace(player, horizon, eyeHeight, 'x', minX, minY, maxY, minZ, topRiserZ, 0xffffff, 0.96);
          }

          // 2. Paredes laterales y de cierre del foso en BLANCO PURO LUMINOSO alineadas con el tabique superior si existe
          const groundZ = 0.0;
          if (orient === 'N' || orient === 'S') {
            if (!hasWestStair) this._renderStairVerticalFace(player, horizon, eyeHeight, 'x', wallPosWest, minY, maxY, minZ, groundZ, 0xfafcff, 0.96);
            if (!hasEastStair) this._renderStairVerticalFace(player, horizon, eyeHeight, 'x', wallPosEast, minY, maxY, minZ, groundZ, 0xf0f4fa, 0.92);

            // Muro de cierre al fondo del tramo inferior si no continúa otra escalera
            if (box.stepIdx === 2) {
              if (orient === 'N' && !hasNorthStair) {
                this._renderStairVerticalFace(player, horizon, eyeHeight, 'y', wallPosNorth, minX, maxX, minZ, groundZ, 0xf8faff, 0.94);
              } else if (orient === 'S' && !hasSouthStair) {
                this._renderStairVerticalFace(player, horizon, eyeHeight, 'y', wallPosSouth, minX, maxX, minZ, groundZ, 0xf8faff, 0.94);
              }
            }
          } else {
            if (!hasNorthStair) this._renderStairVerticalFace(player, horizon, eyeHeight, 'y', wallPosNorth, minX, maxX, minZ, groundZ, 0xfafcff, 0.96);
            if (!hasSouthStair) this._renderStairVerticalFace(player, horizon, eyeHeight, 'y', wallPosSouth, minX, maxX, minZ, groundZ, 0xf0f4fa, 0.92);

            // Muro de cierre al fondo si no continúa
            if (box.stepIdx === 2) {
              if (orient === 'E' && !hasEastStair) {
                this._renderStairVerticalFace(player, horizon, eyeHeight, 'x', wallPosEast, minY, maxY, minZ, groundZ, 0xf8faff, 0.94);
              } else if ((orient === 'O' || orient === 'W') && !hasWestStair) {
                this._renderStairVerticalFace(player, horizon, eyeHeight, 'x', wallPosWest, minY, maxY, minZ, groundZ, 0xf8faff, 0.94);
              }
            }
          }

          // 3. Huella horizontal (tread) a la altura negativa stepH
          if (eyeHeight > maxZ) {
            this._renderStairHorizontalTread(player, horizon, eyeHeight, minX, maxX, minY, maxY, maxZ, orient);
          }
        } else {
          // Escalera hacia arriba:
          // 1. Contrahuella frontal de cada peldaño
          if (orient === 'N') {
            if (posY < minY) this._renderStairVerticalFace(player, horizon, eyeHeight, 'y', minY, minX, maxX, minZ, maxZ, 0xffffff, 0.96);
            else if (posY > maxY) this._renderStairVerticalFace(player, horizon, eyeHeight, 'y', maxY, minX, maxX, minZ, maxZ, 0xffffff, 0.96);
          } else if (orient === 'S') {
            if (posY > maxY) this._renderStairVerticalFace(player, horizon, eyeHeight, 'y', maxY, minX, maxX, minZ, maxZ, 0xffffff, 0.96);
            else if (posY < minY) this._renderStairVerticalFace(player, horizon, eyeHeight, 'y', minY, minX, maxX, minZ, maxZ, 0xffffff, 0.96);
          } else if (orient === 'E') {
            if (posX > maxX) this._renderStairVerticalFace(player, horizon, eyeHeight, 'x', maxX, minY, maxY, minZ, maxZ, 0xffffff, 0.96);
            else if (posX < minX) this._renderStairVerticalFace(player, horizon, eyeHeight, 'x', minX, minY, maxY, minZ, maxZ, 0xffffff, 0.96);
          } else if (orient === 'O' || orient === 'W') {
            if (posX < minX) this._renderStairVerticalFace(player, horizon, eyeHeight, 'x', minX, minY, maxY, minZ, maxZ, 0xffffff, 0.96);
            else if (posX > maxX) this._renderStairVerticalFace(player, horizon, eyeHeight, 'x', maxX, minY, maxY, minZ, maxZ, 0xffffff, 0.96);
          }

          // 2. Laterales de los escalones tapados (desde el suelo minZ hasta la altura de cada peldaño maxZ)
          if (orient === 'N' || orient === 'S') {
            if (!hasWestStair) this._renderStairVerticalFace(player, horizon, eyeHeight, 'x', minX, minY, maxY, minZ, maxZ, 0xfafcff, 0.96);
            if (!hasEastStair) this._renderStairVerticalFace(player, horizon, eyeHeight, 'x', maxX, minY, maxY, minZ, maxZ, 0xf0f4fa, 0.92);
          } else {
            if (!hasNorthStair) this._renderStairVerticalFace(player, horizon, eyeHeight, 'y', minY, minX, maxX, minZ, maxZ, 0xfafcff, 0.96);
            if (!hasSouthStair) this._renderStairVerticalFace(player, horizon, eyeHeight, 'y', maxY, minX, maxX, minZ, maxZ, 0xf0f4fa, 0.92);
          }

          // 3. Huella horizontal (tread) superior de cada peldaño
          if (eyeHeight > maxZ) {
            this._renderStairHorizontalTread(player, horizon, eyeHeight, minX, maxX, minY, maxY, maxZ, orient);
          }
        }
      }

      // Techo inclinado LISO continuo de la escalera hacia abajo (rampa lisa a +3m de altura libre sobre peldaños)
      if (!isUp) {
        const startZ = - (3 - level) * 1.0;
        const ceilingRoomZ = this.wallHeightScale; // 3.0m

        // 1. Intradós LISO continuo (plano inclinado diagonal a cota startZ + 3.0 bajando 1.0m)
        this._renderSmoothSlantedCeiling(
          player, horizon, eyeHeight,
          wallPosWest, wallPosEast, wallPosNorth, wallPosSouth,
          startZ, orient
        );

        // 2. Paredes laterales triangulares de la cuña (desde la rampa inclinada hasta el techo plano de la sala a 3m)
        if (orient === 'N' || orient === 'S') {
          if (!hasWestStair) this._renderSmoothWedgeSide(player, horizon, eyeHeight, 'x', wallPosWest, wallPosNorth, wallPosSouth, startZ, orient, 0xfafcff, 0.96);
          if (!hasEastStair) this._renderSmoothWedgeSide(player, horizon, eyeHeight, 'x', wallPosEast, wallPosNorth, wallPosSouth, startZ, orient, 0xf0f4fa, 0.92);

          // Cierre frontal superior al fondo si no continúa
          if (orient === 'N' && !hasNorthStair) {
            this._renderStairVerticalFace(player, horizon, eyeHeight, 'y', wallPosNorth, wallPosWest, wallPosEast, startZ + 2.0, ceilingRoomZ, 0xf8faff, 0.94);
          } else if (orient === 'S' && !hasSouthStair) {
            this._renderStairVerticalFace(player, horizon, eyeHeight, 'y', wallPosSouth, wallPosWest, wallPosEast, startZ + 2.0, ceilingRoomZ, 0xf8faff, 0.94);
          }
        } else {
          if (!hasNorthStair) this._renderSmoothWedgeSide(player, horizon, eyeHeight, 'y', wallPosNorth, wallPosWest, wallPosEast, startZ, orient, 0xfafcff, 0.96);
          if (!hasSouthStair) this._renderSmoothWedgeSide(player, horizon, eyeHeight, 'y', wallPosSouth, wallPosWest, wallPosEast, startZ, orient, 0xf0f4fa, 0.92);

          // Cierre frontal superior al fondo si no continúa
          if (orient === 'E' && !hasEastStair) {
            this._renderStairVerticalFace(player, horizon, eyeHeight, 'x', wallPosEast, wallPosNorth, wallPosSouth, startZ + 2.0, ceilingRoomZ, 0xf8faff, 0.94);
          } else if ((orient === 'O' || orient === 'W') && !hasWestStair) {
            this._renderStairVerticalFace(player, horizon, eyeHeight, 'x', wallPosWest, wallPosNorth, wallPosSouth, startZ + 2.0, ceilingRoomZ, 0xf8faff, 0.94);
          }
        }
      }

      // Hueco de escalera hacia arriba: apertura en el techo a 3m y paredes blancas en el tiro superior (3m a 6m)
      if (isUp) {
        const upperShaftZ = 6.0; // Altura del remate superior del hueco

        // 1. Paredes blancas del tiro superior (solo desde el techo de la sala a 3m hasta 6m)
        if (orient === 'N' || orient === 'S') {
          if (!hasWestStair) this._renderStairVerticalFace(player, horizon, eyeHeight, 'x', wallPosWest, wallPosNorth, wallPosSouth, 3.0, upperShaftZ, 0xfafcff, 0.96);
          if (!hasEastStair) this._renderStairVerticalFace(player, horizon, eyeHeight, 'x', wallPosEast, wallPosNorth, wallPosSouth, 3.0, upperShaftZ, 0xf0f4fa, 0.92);

          // Pared sobre la entrada (de 3m a 6m en el extremo bajo)
          if (orient === 'N' && (!hasSouthStair || level === 1)) {
            this._renderStairVerticalFace(player, horizon, eyeHeight, 'y', wallPosSouth, wallPosWest, wallPosEast, 3.0, upperShaftZ, 0xf8faff, 0.94);
          } else if (orient === 'S' && (!hasNorthStair || level === 1)) {
            this._renderStairVerticalFace(player, horizon, eyeHeight, 'y', wallPosNorth, wallPosWest, wallPosEast, 3.0, upperShaftZ, 0xf8faff, 0.94);
          }

          // Pared de cierre superior al fondo (de 3m a 6m en el extremo alto si no continúa)
          if (orient === 'N' && !hasNorthStair) {
            this._renderStairVerticalFace(player, horizon, eyeHeight, 'y', wallPosNorth, wallPosWest, wallPosEast, 3.0, upperShaftZ, 0xf8faff, 0.94);
          } else if (orient === 'S' && !hasSouthStair) {
            this._renderStairVerticalFace(player, horizon, eyeHeight, 'y', wallPosSouth, wallPosWest, wallPosEast, 3.0, upperShaftZ, 0xf8faff, 0.94);
          }
        } else {
          if (!hasNorthStair) this._renderStairVerticalFace(player, horizon, eyeHeight, 'y', wallPosNorth, wallPosWest, wallPosEast, 3.0, upperShaftZ, 0xfafcff, 0.96);
          if (!hasSouthStair) this._renderStairVerticalFace(player, horizon, eyeHeight, 'y', wallPosSouth, wallPosWest, wallPosEast, 3.0, upperShaftZ, 0xf0f4fa, 0.92);

          // Pared sobre la entrada (de 3m a 6m)
          if (orient === 'E' && (!hasWestStair || level === 1)) {
            this._renderStairVerticalFace(player, horizon, eyeHeight, 'x', wallPosWest, wallPosNorth, wallPosSouth, 3.0, upperShaftZ, 0xf8faff, 0.94);
          } else if ((orient === 'O' || orient === 'W') && (!hasEastStair || level === 1)) {
            this._renderStairVerticalFace(player, horizon, eyeHeight, 'x', wallPosEast, wallPosNorth, wallPosSouth, 3.0, upperShaftZ, 0xf8faff, 0.94);
          }

          // Pared de cierre superior al fondo si no continúa
          if (orient === 'E' && !hasEastStair) {
            this._renderStairVerticalFace(player, horizon, eyeHeight, 'x', wallPosEast, wallPosNorth, wallPosSouth, 3.0, upperShaftZ, 0xf8faff, 0.94);
          } else if ((orient === 'O' || orient === 'W') && !hasWestStair) {
            this._renderStairVerticalFace(player, horizon, eyeHeight, 'x', wallPosWest, wallPosNorth, wallPosSouth, 3.0, upperShaftZ, 0xf8faff, 0.94);
          }
        }

        // 2. Techo horizontal superior al fondo del tiro a cota 6m (cierra el tiro para no ver cielo azul)
        this._renderStairHorizontalCeiling(player, horizon, eyeHeight, wallPosWest, wallPosEast, wallPosNorth, wallPosSouth, upperShaftZ);
      }
    }
  }

  /**
   * Renderiza una cara vertical de un escalón en 3D
   */
  _renderStairVerticalFace(player, horizon, eyeHeight, axis, pos, minCoord, maxCoord, minZ, maxZ, baseColor, shadeFactor) {
    const w = this.width;
    const h = this.height;
    const pixels = this.pixels;
    const invDet = 1.0 / (player.planeX * player.dirY - player.dirX * player.planeY);
    const p1x = (axis === 'y') ? minCoord : pos;
    const p1y = (axis === 'y') ? pos : minCoord;
    const p2x = (axis === 'y') ? maxCoord : pos;
    const p2y = (axis === 'y') ? pos : maxCoord;

    const dx1 = p1x - player.posX, dy1 = p1y - player.posY;
    const dx2 = p2x - player.posX, dy2 = p2y - player.posY;

    let camY1 = invDet * (-player.planeY * dx1 + player.planeX * dy1);
    let camX1 = invDet * (player.dirY * dx1 - player.dirX * dy1);
    let camY2 = invDet * (-player.planeY * dx2 + player.planeX * dy2);
    let camX2 = invDet * (player.dirY * dx2 - player.dirX * dy2);

    if (camY1 <= 0.05 && camY2 <= 0.05) return;

    if (camY1 < 0.05) {
      const t = (0.05 - camY1) / (camY2 - camY1);
      camX1 = camX1 + t * (camX2 - camX1);
      camY1 = 0.05;
    } else if (camY2 < 0.05) {
      const t = (0.05 - camY2) / (camY1 - camY2);
      camX2 = camX2 + t * (camX1 - camX2);
      camY2 = 0.05;
    }

    const sx1 = (w / 2) * (1 + camX1 / camY1);
    const sx2 = (w / 2) * (1 + camX2 / camY2);
    const startCol = Math.max(0, Math.floor(Math.min(sx1, sx2)) - 1);
    const endCol = Math.min(w - 1, Math.ceil(Math.max(sx1, sx2)) + 1);
    if (startCol > endCol) return;

    for (let col = startCol; col <= endCol; col++) {
      const cameraX = (2 * col / w) - 1;
      const rayDirX = player.dirX + player.planeX * cameraX;
      const rayDirY = player.dirY + player.planeY * cameraX;

      let hitDist = Infinity;
      let hitCoord = 0;

      if (axis === 'y') {
        if (Math.abs(rayDirY) < 1e-6) continue;
        const t = (pos - player.posY) / rayDirY;
        if (t <= 0.05) continue;
        hitCoord = player.posX + t * rayDirX;
        if (hitCoord < minCoord || hitCoord > maxCoord) continue;
        const dx = hitCoord - player.posX;
        const dy = pos - player.posY;
        hitDist = invDet * (-player.planeY * dx + player.planeX * dy);
      } else {
        if (Math.abs(rayDirX) < 1e-6) continue;
        const t = (pos - player.posX) / rayDirX;
        if (t <= 0.05) continue;
        hitCoord = player.posY + t * rayDirY;
        if (hitCoord < minCoord || hitCoord > maxCoord) continue;
        const dx = pos - player.posX;
        const dy = hitCoord - player.posY;
        hitDist = invDet * (-player.planeY * dx + player.planeX * dy);
      }

      if (hitDist <= 0.05) continue;

      const proj = h / hitDist;
      const topY = Math.max(0, Math.floor(horizon - (maxZ - eyeHeight) * proj));
      const bottomY = Math.min(h - 1, Math.floor(horizon - (minZ - eyeHeight) * proj));
      if (bottomY < topY) continue;

      const distShade = Math.max(0.48, Math.min(1.0, 1.0 / (1.0 + hitDist * 0.12))) * shadeFactor;
      const r = Math.floor(((baseColor >> 16) & 0xFF) * distShade);
      const g = Math.floor(((baseColor >> 8) & 0xFF) * distShade);
      const b = Math.floor((baseColor & 0xFF) * distShade);
      const shadedPixel = (255 << 24) | (b << 16) | (g << 8) | r;

      for (let y = topY; y <= bottomY; y++) {
        const pIdx = y * w + col;
        if (this.pixelDepthBuffer && hitDist >= this.pixelDepthBuffer[pIdx] + 0.001) continue;
        pixels[pIdx] = shadedPixel;
        this.pixelDepthBuffer[pIdx] = hitDist;
      }
    }
  }

  /**
   * Renderiza la huella horizontal superior (tapa) de un escalón en 3D
   */
  _renderStairHorizontalTread(player, horizon, eyeHeight, minX, maxX, minY, maxY, maxZ, orient = 'N') {
    const eyeAbove = eyeHeight - maxZ;
    if (eyeAbove <= 0.001) return;

    const w = this.width;
    const h = this.height;
    const pixels = this.pixels;
    const { posX, posY, dirX, dirY, planeX, planeY } = player;

    const rayDirX0 = dirX - planeX;
    const rayDirY0 = dirY - planeY;
    const rayDirX1 = dirX + planeX;
    const rayDirY1 = dirY + planeY;

    const corners = [
      [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]
    ];
    let minYScreen = Infinity;
    let maxYScreen = -Infinity;
    let minXScreen = Infinity;
    let maxXScreen = -Infinity;
    let anyInFront = false;

    const invDet = 1.0 / (planeX * dirY - dirX * planeY);
    for (let c = 0; c < 4; c++) {
      const dx = corners[c][0] - posX;
      const dy = corners[c][1] - posY;
      const camY = invDet * (-planeY * dx + planeX * dy);
      if (camY > 0.05) {
        anyInFront = true;
        const camX = invDet * (dirY * dx - dirX * dy);
        const sy = horizon - (maxZ - eyeHeight) * (h / camY);
        const sx = (w / 2) * (1 + camX / camY);
        if (sy < minYScreen) minYScreen = sy;
        if (sy > maxYScreen) maxYScreen = sy;
        if (sx < minXScreen) minXScreen = sx;
        if (sx > maxXScreen) maxXScreen = sx;
      }
    }

    if (!anyInFront) return;

    const startY = Math.max(Math.ceil(horizon) + 1, Math.floor(minYScreen) - 2);
    const endY = Math.min(h - 1, Math.ceil(maxYScreen) + 2);
    if (endY < startY) return;

    const startX = Math.max(0, Math.floor(minXScreen) - 3);
    const endX = Math.min(w - 1, Math.ceil(maxXScreen) + 3);
    if (endX < startX) return;

    for (let y = startY; y <= endY; y++) {
      const rowOffset = y - horizon;
      if (rowOffset <= 0) continue;
      const rowDist = eyeAbove * h / rowOffset;
      if (rowDist <= 0.05) continue;

      const floorStepX = rowDist * (rayDirX1 - rayDirX0) / w;
      const floorStepY = rowDist * (rayDirY1 - rayDirY0) / w;

      let floorX = posX + rowDist * (rayDirX0 + (rayDirX1 - rayDirX0) * (startX / w));
      let floorY = posY + rowDist * (rayDirY0 + (rayDirY1 - rayDirY0) * (startX / w));
      const rowPixelBase = y * w;

      for (let x = startX; x <= endX; x++, floorX += floorStepX, floorY += floorStepY) {
        if (floorX < minX || floorX > maxX || floorY < minY || floorY > maxY) continue;

        const pIdx = rowPixelBase + x;
        if (this.pixelDepthBuffer && rowDist >= this.pixelDepthBuffer[pIdx] + 0.001) continue;

        const shade = Math.max(0.48, Math.min(1.0, 1.0 / (1.0 + rowDist * 0.12)));
        let stepEdgeShade = 1.0;
        if (orient === 'N' && Math.abs(floorY - maxY) < 0.035) stepEdgeShade = 0.88;
        else if (orient === 'S' && Math.abs(floorY - minY) < 0.035) stepEdgeShade = 0.88;
        else if (orient === 'E' && Math.abs(floorX - minX) < 0.035) stepEdgeShade = 0.88;
        else if ((orient === 'O' || orient === 'W') && Math.abs(floorX - maxX) < 0.035) stepEdgeShade = 0.88;

        const r = Math.floor(250 * shade * stepEdgeShade);
        const g = Math.floor(252 * shade * stepEdgeShade);
        const b = Math.floor(255 * shade * stepEdgeShade);

        pixels[pIdx] = (255 << 24) | (b << 16) | (g << 8) | r;
        this.pixelDepthBuffer[pIdx] = rowDist;
      }
    }
  }

  /**
   * Renderiza el intradós completamente LISO (rampa continua diagonal) del techo de la escalera en 3D
   */
  _renderSmoothSlantedCeiling(player, horizon, eyeHeight, minX, maxX, minY, maxY, startZ, orient) {
    const w = this.width;
    const h = this.height;
    const pixels = this.pixels;
    const { posX, posY, dirX, dirY, planeX, planeY } = player;

    const Z_base = startZ + 3.0; // Altura del techo en la entrada de la celda

    let prog0, dProgDirX, dProgDirY;
    if (orient === 'N') {
      const lenY = maxY - minY;
      if (lenY <= 1e-6) return;
      prog0 = (maxY - posY) / lenY;
      dProgDirX = 0;
      dProgDirY = -1 / lenY;
    } else if (orient === 'S') {
      const lenY = maxY - minY;
      if (lenY <= 1e-6) return;
      prog0 = (posY - minY) / lenY;
      dProgDirX = 0;
      dProgDirY = 1 / lenY;
    } else if (orient === 'E') {
      const lenX = maxX - minX;
      if (lenX <= 1e-6) return;
      prog0 = (posX - minX) / lenX;
      dProgDirX = 1 / lenX;
      dProgDirY = 0;
    } else { // 'O' o 'W'
      const lenX = maxX - minX;
      if (lenX <= 1e-6) return;
      prog0 = (maxX - posX) / lenX;
      dProgDirX = -1 / lenX;
      dProgDirY = 0;
    }

    const numerBase = (Z_base - prog0) - eyeHeight;

    const corners = [ [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY] ];
    const invDet = 1.0 / (planeX * dirY - dirX * planeY);
    let minColScreen = Infinity;
    let maxColScreen = -Infinity;
    let anyInFront = false;
    for (let c = 0; c < 4; c++) {
      const dx = corners[c][0] - posX;
      const dy = corners[c][1] - posY;
      const camY = invDet * (-planeY * dx + planeX * dy);
      if (camY > 0.05) {
        anyInFront = true;
        const camX = invDet * (dirY * dx - dirX * dy);
        const sx = (w / 2) * (1 + camX / camY);
        if (sx < minColScreen) minColScreen = sx;
        if (sx > maxColScreen) maxColScreen = sx;
      }
    }
    if (!anyInFront) return;
    const startCol = Math.max(0, Math.floor(minColScreen) - 2);
    const endCol = Math.min(w - 1, Math.ceil(maxColScreen) + 2);
    if (startCol > endCol) return;

    for (let col = startCol; col <= endCol; col++) {
      const cameraX = (2 * col / w) - 1;
      const rayDirX = dirX + planeX * cameraX;
      const rayDirY = dirY + planeY * cameraX;

      // Intersección 2D de rayo contra caja AABB [minX, maxX] x [minY, maxY]
      let tNear = -Infinity;
      let tFar = Infinity;

      if (Math.abs(rayDirX) > 1e-6) {
        const invX = 1.0 / rayDirX;
        let t1 = (minX - posX) * invX;
        let t2 = (maxX - posX) * invX;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tNear) tNear = t1;
        if (t2 < tFar) tFar = t2;
      } else {
        if (posX < minX || posX > maxX) continue;
      }

      if (Math.abs(rayDirY) > 1e-6) {
        const invY = 1.0 / rayDirY;
        let t1 = (minY - posY) * invY;
        let t2 = (maxY - posY) * invY;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tNear) tNear = t1;
        if (t2 < tFar) tFar = t2;
      } else {
        if (posY < minY || posY > maxY) continue;
      }

      if (tNear > tFar || tFar <= 0.05) continue;
      tNear = Math.max(0.05, tNear);

      const dProg = dProgDirX * rayDirX + dProgDirY * rayDirY;

      // Proyección vertical estimada de los extremos del segmento
      const progNear = prog0 + tNear * dProg;
      const zNear = Z_base - progNear;
      const yNear = horizon - (zNear - eyeHeight) * (h / tNear);

      const progFar = prog0 + tFar * dProg;
      const zFar = Z_base - progFar;
      const yFar = horizon - (zFar - eyeHeight) * (h / tFar);

      const startY = Math.max(0, Math.floor(Math.min(yNear, yFar)) - 2);
      const endY = Math.min(h - 1, Math.ceil(Math.max(yNear, yFar)) + 2);
      if (endY < startY) continue;

      for (let y = startY; y <= endY; y++) {
        const slopeZ = (horizon - y) / h;
        const denom = slopeZ + dProg;
        if (Math.abs(denom) < 1e-6) continue;

        const dist = numerBase / denom;
        if (dist < tNear - 0.005 || dist > tFar + 0.005) continue;

        const pIdx = y * w + col;
        if (this.pixelDepthBuffer && dist >= this.pixelDepthBuffer[pIdx] - 0.001) continue;

        // Tonalidad blanca arquitectónica y sombreado por distancia suave
        const distShade = Math.max(0.50, Math.min(1.0, 1.0 / (1.0 + dist * 0.12))) * 0.94;
        const r = Math.floor(248 * distShade);
        const g = Math.floor(250 * distShade);
        const b = Math.floor(255 * distShade);

        pixels[pIdx] = (255 << 24) | (b << 16) | (g << 8) | r;
        this.pixelDepthBuffer[pIdx] = dist;
      }
    }
  }

  /**
   * Renderiza una pared lateral triangular/trapezoidal que cierra la cuña superior del techo inclinado
   */
  _renderSmoothWedgeSide(player, horizon, eyeHeight, axis, pos, minCoord, maxCoord, startZ, orient, baseColor, shadeFactor) {
    const w = this.width;
    const h = this.height;
    const pixels = this.pixels;
    const invDet = 1.0 / (player.planeX * player.dirY - player.dirX * player.planeY);
    const ceilingRoomZ = this.wallHeightScale; // 3.0m
    const len = maxCoord - minCoord;
    if (len <= 1e-6) return;

    const p1x = (axis === 'y') ? minCoord : pos;
    const p1y = (axis === 'y') ? pos : minCoord;
    const p2x = (axis === 'y') ? maxCoord : pos;
    const p2y = (axis === 'y') ? pos : maxCoord;

    const dx1 = p1x - player.posX, dy1 = p1y - player.posY;
    const dx2 = p2x - player.posX, dy2 = p2y - player.posY;

    let camY1 = invDet * (-player.planeY * dx1 + player.planeX * dy1);
    let camX1 = invDet * (player.dirY * dx1 - player.dirX * dy1);
    let camY2 = invDet * (-player.planeY * dx2 + player.planeX * dy2);
    let camX2 = invDet * (player.dirY * dx2 - player.dirX * dy2);

    if (camY1 <= 0.05 && camY2 <= 0.05) return;

    if (camY1 < 0.05) {
      const t = (0.05 - camY1) / (camY2 - camY1);
      camX1 = camX1 + t * (camX2 - camX1);
      camY1 = 0.05;
    } else if (camY2 < 0.05) {
      const t = (0.05 - camY2) / (camY1 - camY2);
      camX2 = camX2 + t * (camX1 - camX2);
      camY2 = 0.05;
    }

    const sx1 = (w / 2) * (1 + camX1 / camY1);
    const sx2 = (w / 2) * (1 + camX2 / camY2);
    const startCol = Math.max(0, Math.floor(Math.min(sx1, sx2)) - 1);
    const endCol = Math.min(w - 1, Math.ceil(Math.max(sx1, sx2)) + 1);
    if (startCol > endCol) return;

    for (let col = startCol; col <= endCol; col++) {
      const cameraX = (2 * col / w) - 1;
      const rayDirX = player.dirX + player.planeX * cameraX;
      const rayDirY = player.dirY + player.planeY * cameraX;

      let hitDist = Infinity;
      let hitCoord = 0;

      if (axis === 'y') {
        if (Math.abs(rayDirY) < 1e-6) continue;
        const t = (pos - player.posY) / rayDirY;
        if (t <= 0.05) continue;
        hitCoord = player.posX + t * rayDirX;
        if (hitCoord < minCoord || hitCoord > maxCoord) continue;
        const dx = hitCoord - player.posX;
        const dy = pos - player.posY;
        hitDist = invDet * (-player.planeY * dx + player.planeX * dy);
      } else {
        if (Math.abs(rayDirX) < 1e-6) continue;
        const t = (pos - player.posX) / rayDirX;
        if (t <= 0.05) continue;
        hitCoord = player.posY + t * rayDirY;
        if (hitCoord < minCoord || hitCoord > maxCoord) continue;
        const dx = pos - player.posX;
        const dy = hitCoord - player.posY;
        hitDist = invDet * (-player.planeY * dx + player.planeX * dy);
      }

      if (hitDist <= 0.05) continue;

      let prog = 0;
      if (orient === 'N') {
        prog = (maxCoord - hitCoord) / len;
      } else if (orient === 'S') {
        prog = (hitCoord - minCoord) / len;
      } else if (orient === 'E') {
        prog = (hitCoord - minCoord) / len;
      } else {
        prog = (maxCoord - hitCoord) / len;
      }
      prog = Math.max(0.0, Math.min(1.0, prog));

      const minZ = (startZ + 3.0) - prog * 1.0;
      const maxZ = ceilingRoomZ;
      if (minZ >= maxZ - 0.001) continue;

      const proj = h / hitDist;
      const topY = Math.max(0, Math.floor(horizon - (maxZ - eyeHeight) * proj));
      const bottomY = Math.min(h - 1, Math.floor(horizon - (minZ - eyeHeight) * proj));
      if (bottomY < topY) continue;

      const distShade = Math.max(0.48, Math.min(1.0, 1.0 / (1.0 + hitDist * 0.12))) * shadeFactor;
      const r = Math.floor(((baseColor >> 16) & 0xFF) * distShade);
      const g = Math.floor(((baseColor >> 8) & 0xFF) * distShade);
      const b = Math.floor((baseColor & 0xFF) * distShade);
      const shadedPixel = (255 << 24) | (b << 16) | (g << 8) | r;

      for (let y = topY; y <= bottomY; y++) {
        const pIdx = y * w + col;
        if (this.pixelDepthBuffer && hitDist >= this.pixelDepthBuffer[pIdx] + 0.001) continue;
        pixels[pIdx] = shadedPixel;
        this.pixelDepthBuffer[pIdx] = hitDist;
      }
    }
  }

  /**
   * Renderiza un techo horizontal plano para cerrar huecos en 3D (ej. caja de escalera alta)
   */
  _renderStairHorizontalCeiling(player, horizon, eyeHeight, minX, maxX, minY, maxY, ceilZ) {
    const eyeBelow = ceilZ - eyeHeight;
    if (eyeBelow <= 0.001) return;

    const w = this.width;
    const h = this.height;
    const pixels = this.pixels;
    const { posX, posY, dirX, dirY, planeX, planeY } = player;

    const rayDirX0 = dirX - planeX;
    const rayDirY0 = dirY - planeY;
    const rayDirX1 = dirX + planeX;
    const rayDirY1 = dirY + planeY;

    const corners = [
      [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]
    ];
    let minYScreen = Infinity;
    let maxYScreen = -Infinity;

    for (let c = 0; c < 4; c++) {
      const dx = corners[c][0] - posX;
      const dy = corners[c][1] - posY;
      const invDet = 1.0 / (planeX * dirY - dirX * planeY);
      const camY = invDet * (-planeY * dx + planeX * dy);
      if (camY > 0.05) {
        const sy = horizon - (ceilZ - eyeHeight) * (h / camY);
        if (sy < minYScreen) minYScreen = sy;
        if (sy > maxYScreen) maxYScreen = sy;
      }
    }

    const startY = Math.max(0, Math.floor(minYScreen) - 2);
    const endY = Math.min(Math.floor(horizon) - 1, Math.ceil(maxYScreen) + 2);
    if (endY < startY) return;

    for (let y = startY; y <= endY; y++) {
      const rowAbove = horizon - y;
      if (rowAbove <= 0) continue;
      const rowDist = eyeBelow * h / rowAbove;
      if (rowDist <= 0.05) continue;

      const stepX = rowDist * (rayDirX1 - rayDirX0) / w;
      const stepY = rowDist * (rayDirY1 - rayDirY0) / w;

      let floorX = posX + rowDist * rayDirX0;
      let floorY = posY + rowDist * rayDirY0;
      const rowPixelBase = y * w;

      for (let x = 0; x < w; x++, floorX += stepX, floorY += stepY) {
        if (floorX < minX || floorX > maxX || floorY < minY || floorY > maxY) continue;

        const pIdx = rowPixelBase + x;
        if (this.pixelDepthBuffer && rowDist >= this.pixelDepthBuffer[pIdx] + 0.001) continue;

        const shade = Math.max(0.50, Math.min(1.0, 1.0 / (1.0 + rowDist * 0.12))) * 0.94;
        const r = Math.floor(248 * shade);
        const g = Math.floor(250 * shade);
        const b = Math.floor(255 * shade);

        pixels[pIdx] = (255 << 24) | (b << 16) | (g << 8) | r;
        this.pixelDepthBuffer[pIdx] = rowDist;
      }
    }
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
    const horizon = halfH + Math.round(player.pitchOffset || 0); // sincronizar con render()
    const pixels = this.pixels;

    // Calcular distancia al cuadrado para ordenación
    for (let i = 0; i < sprites.length; i++) {
      const s = sprites[i];
      s.distSq = (posX - s.x) * (posX - s.x) + (posY - s.y) * (posY - s.y);
    }
    // Ordenar de más lejos a más cerca
    sprites.sort((a, b) => b.distSq - a.distSq);

    const invDet = 1.0 / (planeX * dirY - dirX * planeY);
    const eyeHeight = this.wallHeightScale / 2 + (player.elevation || 0); // 1.5 (+ elevación escalera)
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

      // Ajuste fino por caso (dir_pos) y variante de textura activa.
      // dx>0=Este, dy>0=Sur. Se acumula caso a caso según pruebas.
      // Ajuste fino por caso+variante. dy>0=Sur, dy<0=Norte, dx>0=Este, dx<0=Oeste.
      // dy:0 = sin cambio (posición base del preset b/c/t).
      // Se va completando caso a caso según pruebas.
      const _variantFix = {
        'L_b_front': { dy: 0.2 },
        'L_b_back':  { dy: 0.2 },
        'L_b_left':  { dy: 0.2 },
        'L_b_right': { dy: 0.2 },
        'R_b_front': { dy: -0.2 },
        'R_b_back':  { dy: -0.2 },
        'R_b_left':  { dy: -0.2 },
        'R_b_right': { dy: -0.2 },
      };
      const _mDir = sprite.monitorDir || '';
      const _mPos = sprite.monitorPos || 'c';
      const _vf = _variantFix[`${_mDir}_${_mPos}_${activeVariant}`] || {};

      const spriteX = sprite.x + (_vf.dx || 0) - posX;
      const spriteY = sprite.y + (_vf.dy || 0) - posY;

      const transformX = invDet * (dirY * spriteX - dirX * spriteY);
      const transformY = invDet * (-planeY * spriteX + planeX * spriteY);

      if (transformY <= 0.5) continue; // Detrás o muy cerca de la cámara
      // Saltar sprites que estén en la misma celda que el jugador (evita zoom extremo en spawn)
      if (Math.floor(posX) === sprite.mapX && Math.floor(posY) === sprite.mapY) continue;

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
      const bottomY = horizon + (eyeHeight - baseElevation) * proj;
      const topY = bottomY - spriteScreenHeight;

      const drawStartY = Math.max(0, Math.floor(topY));
      const drawEndY = Math.min(h - 1, Math.floor(bottomY));

      const effScreenX = spriteScreenX;

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

        // Escaleras en el minimapa (color blanco con peldaños)
        let stairsToken = null;
        if (typeof codes === 'string' && codes.startsWith('STAIRS_')) stairsToken = codes;
        else if (Array.isArray(codes)) stairsToken = codes.find(c => typeof c === 'string' && c.startsWith('STAIRS_'));
        if (stairsToken) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
          ctx.fillRect(px + 1, py + 1, cellSize - 2, cellSize - 2);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 1, py + 1, cellSize - 2, cellSize - 2);
          const parts = stairsToken.split('_');
          const orient = parts[2] || 'N';
          ctx.beginPath();
          if (orient === 'N' || orient === 'S') {
            const h = (cellSize - 2) / 3;
            ctx.moveTo(px + 1, py + 1 + h);
            ctx.lineTo(px + cellSize - 1, py + 1 + h);
            ctx.moveTo(px + 1, py + 1 + h * 2);
            ctx.lineTo(px + cellSize - 1, py + 1 + h * 2);
          } else {
            const w = (cellSize - 2) / 3;
            ctx.moveTo(px + 1 + w, py + 1);
            ctx.lineTo(px + 1 + w, py + cellSize - 1);
            ctx.moveTo(px + 1 + w * 2, py + 1);
            ctx.lineTo(px + 1 + w * 2, py + cellSize - 1);
          }
          ctx.stroke();

          // Rótulo de nivel en minimapa
          const level = parts[3] || '1';
          ctx.fillStyle = '#ffffff';
          ctx.font = `bold ${Math.max(6, Math.floor(cellSize * 0.35))}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`N${level}`, px + cellSize / 2, py + cellSize / 2);
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

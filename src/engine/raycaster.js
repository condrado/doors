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

  isSolidCell(codes) {
    if (!codes || codes.length === 0) return false;
    return codes.includes('N') && codes.includes('S') && codes.includes('E') && codes.includes('W');
  }

  isCenterWestConnected(mapX, mapY, currentCodes) {
    if (currentCodes.includes('W') || currentCodes.includes('DW') || currentCodes.includes('WW')) return true;
    if (mapX - 1 < 0) return false;
    const wCodes = this.getCellCodes(mapX - 1, mapY);
    if (this.isSolidCell(wCodes)) return true;
    return wCodes.some(c => ['CH', 'DCH', 'WCH', 'CE', 'E', 'DE', 'WE'].includes(c));
  }

  isCenterEastConnected(mapX, mapY, currentCodes) {
    if (currentCodes.includes('E') || currentCodes.includes('DE') || currentCodes.includes('WE')) return true;
    if (mapX + 1 >= this.mapWidth) return false;
    const eCodes = this.getCellCodes(mapX + 1, mapY);
    if (this.isSolidCell(eCodes)) return true;
    return eCodes.some(c => ['CH', 'DCH', 'WCH', 'CW', 'W', 'DW', 'WW'].includes(c));
  }

  isCenterNorthConnected(mapX, mapY, currentCodes) {
    if (currentCodes.includes('N') || currentCodes.includes('DN') || currentCodes.includes('WN')) return true;
    if (mapY - 1 < 0) return false;
    const nCodes = this.getCellCodes(mapX, mapY - 1);
    if (this.isSolidCell(nCodes)) return true;
    return nCodes.some(c => ['CV', 'DCV', 'WCV', 'CS', 'S', 'DS', 'WS'].includes(c));
  }

  isCenterSouthConnected(mapX, mapY, currentCodes) {
    if (currentCodes.includes('S') || currentCodes.includes('DS') || currentCodes.includes('WS')) return true;
    if (mapY + 1 >= this.mapHeight) return false;
    const sCodes = this.getCellCodes(mapX, mapY + 1);
    if (this.isSolidCell(sCodes)) return true;
    return sCodes.some(c => ['CV', 'DCV', 'WCV', 'CN', 'N', 'DN', 'WN'].includes(c));
  }

  isPerimeterWestConnected(whichEdge, mapX, mapY, currentCodes) {
    if (currentCodes.includes('W') || currentCodes.includes('DW') || currentCodes.includes('WW')) return true;
    if (mapX - 1 >= 0) {
      const wCodes = this.getCellCodes(mapX - 1, mapY);
      if (this.isSolidCell(wCodes)) return true;
      if (whichEdge === 'N' && wCodes.some(c => ['N', 'DN', 'WN', 'E', 'DE', 'WE'].includes(c))) return true;
      if (whichEdge === 'S' && wCodes.some(c => ['S', 'DS', 'WS', 'E', 'DE', 'WE'].includes(c))) return true;
    }
    if (whichEdge === 'N' && mapY - 1 >= 0) {
      const nCodes = this.getCellCodes(mapX, mapY - 1);
      if (this.isSolidCell(nCodes) || nCodes.some(c => ['W', 'DW', 'WW'].includes(c))) return true;
    }
    if (whichEdge === 'S' && mapY + 1 < this.mapHeight) {
      const sCodes = this.getCellCodes(mapX, mapY + 1);
      if (this.isSolidCell(sCodes) || sCodes.some(c => ['W', 'DW', 'WW'].includes(c))) return true;
    }
    return false;
  }

  isPerimeterEastConnected(whichEdge, mapX, mapY, currentCodes) {
    if (currentCodes.includes('E') || currentCodes.includes('DE') || currentCodes.includes('WE')) return true;
    if (mapX + 1 < this.mapWidth) {
      const eCodes = this.getCellCodes(mapX + 1, mapY);
      if (this.isSolidCell(eCodes)) return true;
      if (whichEdge === 'N' && eCodes.some(c => ['N', 'DN', 'WN', 'W', 'DW', 'WW'].includes(c))) return true;
      if (whichEdge === 'S' && eCodes.some(c => ['S', 'DS', 'WS', 'W', 'DW', 'WW'].includes(c))) return true;
    }
    if (whichEdge === 'N' && mapY - 1 >= 0) {
      const nCodes = this.getCellCodes(mapX, mapY - 1);
      if (this.isSolidCell(nCodes) || nCodes.some(c => ['E', 'DE', 'WE'].includes(c))) return true;
    }
    if (whichEdge === 'S' && mapY + 1 < this.mapHeight) {
      const sCodes = this.getCellCodes(mapX, mapY + 1);
      if (this.isSolidCell(sCodes) || sCodes.some(c => ['E', 'DE', 'WE'].includes(c))) return true;
    }
    return false;
  }

  isPerimeterNorthConnected(whichEdge, mapX, mapY, currentCodes) {
    if (currentCodes.includes('N') || currentCodes.includes('DN') || currentCodes.includes('WN')) return true;
    if (mapY - 1 >= 0) {
      const nCodes = this.getCellCodes(mapX, mapY - 1);
      if (this.isSolidCell(nCodes)) return true;
      if (whichEdge === 'W' && nCodes.some(c => ['W', 'DW', 'WW', 'S', 'DS', 'WS'].includes(c))) return true;
      if (whichEdge === 'E' && nCodes.some(c => ['E', 'DE', 'WE', 'S', 'DS', 'WS'].includes(c))) return true;
    }
    if (whichEdge === 'W' && mapX - 1 >= 0) {
      const wCodes = this.getCellCodes(mapX - 1, mapY);
      if (this.isSolidCell(wCodes) || wCodes.some(c => ['N', 'DN', 'WN'].includes(c))) return true;
    }
    if (whichEdge === 'E' && mapX + 1 < this.mapWidth) {
      const eCodes = this.getCellCodes(mapX + 1, mapY);
      if (this.isSolidCell(eCodes) || eCodes.some(c => ['N', 'DN', 'WN'].includes(c))) return true;
    }
    return false;
  }

  isPerimeterSouthConnected(whichEdge, mapX, mapY, currentCodes) {
    if (currentCodes.includes('S') || currentCodes.includes('DS') || currentCodes.includes('WS')) return true;
    if (mapY + 1 < this.mapHeight) {
      const sCodes = this.getCellCodes(mapX, mapY + 1);
      if (this.isSolidCell(sCodes)) return true;
      if (whichEdge === 'W' && sCodes.some(c => ['W', 'DW', 'WW', 'N', 'DN', 'WN'].includes(c))) return true;
      if (whichEdge === 'E' && sCodes.some(c => ['E', 'DE', 'WE', 'N', 'DN', 'WN'].includes(c))) return true;
    }
    if (whichEdge === 'W' && mapX - 1 >= 0) {
      const wCodes = this.getCellCodes(mapX - 1, mapY);
      if (this.isSolidCell(wCodes) || wCodes.some(c => ['S', 'DS', 'WS'].includes(c))) return true;
    }
    if (whichEdge === 'E' && mapX + 1 < this.mapWidth) {
      const eCodes = this.getCellCodes(mapX + 1, mapY);
      if (this.isSolidCell(eCodes) || eCodes.some(c => ['S', 'DS', 'WS'].includes(c))) return true;
    }
    return false;
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
   * Los cantos (textures[10]) solo se colocan en extremos abiertos/vistos al aire;
   * si la pared se une con otra pared o esquina, el canto se suprime para aligerar la carga y evitar ralentizaciones.
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

    // 0. BLOQUE SÓLIDO COMPLETO 1x1 (celda numérica 1 o ['N', 'S', 'E', 'W'])
    if (has('N') && has('S') && has('E') && has('W')) {
      faces.push(
        { axis: 'y', pos: y0, minX: x0, maxX: x1, type: 1, name: 'Pared Bloque (N)' },
        { axis: 'y', pos: y1, minX: x0, maxX: x1, type: 1, name: 'Pared Bloque (S)' },
        { axis: 'x', pos: x0, minY: y0, maxY: y1, type: 1, name: 'Pared Bloque (O)' },
        { axis: 'x', pos: x1, minY: y0, maxY: y1, type: 1, name: 'Pared Bloque (E)' }
      );
      return faces;
    }

    // 1. RINCONES EN EL CENTRO (EN FORMA DE L CON GROSOR 0.20)
    // -------------------------------------------------------------
    if (has('CN') && has('CW')) { // Rincón Centro Noroeste ┌
      faces.push(
        { axis: 'x', pos: cxB, minY: y0, maxY: cyB, type: 1, name: 'Rincón (Exterior Este)' },
        { axis: 'y', pos: cyB, minX: x0, maxX: cxB, type: 1, name: 'Rincón (Exterior Sur)' },
        { axis: 'x', pos: cxA, minY: y0, maxY: cyA, type: 1, name: 'Rincón (Interior Oeste)' },
        { axis: 'y', pos: cyA, minX: x0, maxX: cxA, type: 1, name: 'Rincón (Interior Norte)' }
      );
      if (!this.isCenterNorthConnected(mapX, mapY, codes)) {
        faces.push({ axis: 'y', pos: y0, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Norte' });
      }
      if (!this.isCenterWestConnected(mapX, mapY, codes)) {
        faces.push({ axis: 'x', pos: x0, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Oeste' });
      }
      return faces;
    }

    if (has('CN') && has('CE')) { // Rincón Centro Noreste ┐
      faces.push(
        { axis: 'x', pos: cxA, minY: y0, maxY: cyB, type: 1, name: 'Rincón (Exterior Oeste)' },
        { axis: 'y', pos: cyB, minX: cxA, maxX: x1, type: 1, name: 'Rincón (Exterior Sur)' },
        { axis: 'x', pos: cxB, minY: y0, maxY: cyA, type: 1, name: 'Rincón (Interior Este)' },
        { axis: 'y', pos: cyA, minX: cxB, maxX: x1, type: 1, name: 'Rincón (Interior Norte)' }
      );
      if (!this.isCenterNorthConnected(mapX, mapY, codes)) {
        faces.push({ axis: 'y', pos: y0, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Norte' });
      }
      if (!this.isCenterEastConnected(mapX, mapY, codes)) {
        faces.push({ axis: 'x', pos: x1, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Este' });
      }
      return faces;
    }

    if (has('CS') && has('CW')) { // Rincón Centro Suroeste └
      faces.push(
        { axis: 'x', pos: cxB, minY: cyA, maxY: y1, type: 1, name: 'Rincón (Exterior Este)' },
        { axis: 'y', pos: cyA, minX: x0, maxX: cxB, type: 1, name: 'Rincón (Exterior Norte)' },
        { axis: 'x', pos: cxA, minY: cyB, maxY: y1, type: 1, name: 'Rincón (Interior Oeste)' },
        { axis: 'y', pos: cyB, minX: x0, maxX: cxA, type: 1, name: 'Rincón (Interior Sur)' }
      );
      if (!this.isCenterSouthConnected(mapX, mapY, codes)) {
        faces.push({ axis: 'y', pos: y1, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Sur' });
      }
      if (!this.isCenterWestConnected(mapX, mapY, codes)) {
        faces.push({ axis: 'x', pos: x0, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Oeste' });
      }
      return faces;
    }

    if (has('CS') && has('CE')) { // Rincón Centro Sureste ┘
      faces.push(
        { axis: 'x', pos: cxA, minY: cyA, maxY: y1, type: 1, name: 'Rincón (Exterior Oeste)' },
        { axis: 'y', pos: cyA, minX: cxA, maxX: x1, type: 1, name: 'Rincón (Exterior Norte)' },
        { axis: 'x', pos: cxB, minY: cyB, maxY: y1, type: 1, name: 'Rincón (Interior Este)' },
        { axis: 'y', pos: cyB, minX: cxB, maxX: x1, type: 1, name: 'Rincón (Interior Sur)' }
      );
      if (!this.isCenterSouthConnected(mapX, mapY, codes)) {
        faces.push({ axis: 'y', pos: y1, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Sur' });
      }
      if (!this.isCenterEastConnected(mapX, mapY, codes)) {
        faces.push({ axis: 'x', pos: x1, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Este' });
      }
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
      if (!this.isCenterNorthConnected(mapX, mapY, codes)) {
        faces.push({ axis: 'y', pos: y0, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Norte' });
      }
      if (!this.isCenterSouthConnected(mapX, mapY, codes)) {
        faces.push({ axis: 'y', pos: y1, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Sur' });
      }
      if (!this.isCenterWestConnected(mapX, mapY, codes)) {
        faces.push({ axis: 'x', pos: x0, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Oeste' });
      }
      if (!this.isCenterEastConnected(mapX, mapY, codes)) {
        faces.push({ axis: 'x', pos: x1, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Este' });
      }
      return faces;
    }

    // 3. TABIQUES, PUERTAS O VENTANAS COMPLETAS
    // -------------------------------------------------------------
    if (has('CH') || has('DCH') || has('WCH')) {
      const isDoor = has('DCH');
      const isWin = has('WCH');
      const type = isDoor ? 2 : isWin ? 6 : 1;
      const name = isDoor ? 'Puerta Central' : isWin ? 'Ventana Central' : 'Pared Central (N)';
      faces.push(
        { axis: 'y', pos: cyA, minX: x0, maxX: x1, type, name },
        { axis: 'y', pos: cyB, minX: x0, maxX: x1, type, name }
      );
      if (!this.isCenterWestConnected(mapX, mapY, codes)) {
        faces.push({ axis: 'x', pos: x0, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Oeste' });
      }
      if (!this.isCenterEastConnected(mapX, mapY, codes)) {
        faces.push({ axis: 'x', pos: x1, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Este' });
      }
    }

    if (has('CV') || has('DCV') || has('WCV')) {
      const isDoor = has('DCV');
      const isWin = has('WCV');
      const type = isDoor ? 3 : isWin ? 6 : 1;
      const name = isDoor ? 'Puerta Central' : isWin ? 'Ventana Central' : 'Pared Central (O)';
      faces.push(
        { axis: 'x', pos: cxA, minY: y0, maxY: y1, type, name },
        { axis: 'x', pos: cxB, minY: y0, maxY: y1, type, name }
      );
      if (!this.isCenterNorthConnected(mapX, mapY, codes)) {
        faces.push({ axis: 'y', pos: y0, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Norte' });
      }
      if (!this.isCenterSouthConnected(mapX, mapY, codes)) {
        faces.push({ axis: 'y', pos: y1, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Sur' });
      }
    }

    // Semiramas aisladas o conectadas en T
    if (has('CN') && !has('CW') && !has('CE')) {
      const endY = has('CH') ? cyA : cyB;
      faces.push(
        { axis: 'x', pos: cxA, minY: y0, maxY: endY, type: 1, name: 'Muro CN (O)' },
        { axis: 'x', pos: cxB, minY: y0, maxY: endY, type: 1, name: 'Muro CN (E)' }
      );
      if (!this.isCenterNorthConnected(mapX, mapY, codes)) {
        faces.push({ axis: 'y', pos: y0, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Norte' });
      }
      if (!has('CH') && !has('CS')) {
        faces.push({ axis: 'y', pos: cyB, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Sur' });
      }
    }
    if (has('CS') && !has('CW') && !has('CE')) {
      const startY = has('CH') ? cyB : cyA;
      faces.push(
        { axis: 'x', pos: cxA, minY: startY, maxY: y1, type: 1, name: 'Muro CS (O)' },
        { axis: 'x', pos: cxB, minY: startY, maxY: y1, type: 1, name: 'Muro CS (E)' }
      );
      if (!this.isCenterSouthConnected(mapX, mapY, codes)) {
        faces.push({ axis: 'y', pos: y1, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Sur' });
      }
      if (!has('CH') && !has('CN')) {
        faces.push({ axis: 'y', pos: cyA, minX: cxA, maxX: cxB, type: 10, isCap: true, name: 'Canto Norte' });
      }
    }
    if (has('CW') && !has('CN') && !has('CS')) {
      const endX = has('CV') ? cxA : cxB;
      faces.push(
        { axis: 'y', pos: cyA, minX: x0, maxX: endX, type: 1, name: 'Muro CW (N)' },
        { axis: 'y', pos: cyB, minX: x0, maxX: endX, type: 1, name: 'Muro CW (S)' }
      );
      if (!this.isCenterWestConnected(mapX, mapY, codes)) {
        faces.push({ axis: 'x', pos: x0, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Oeste' });
      }
      if (!has('CV') && !has('CE')) {
        faces.push({ axis: 'x', pos: cxB, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Este' });
      }
    }
    if (has('CE') && !has('CN') && !has('CS')) {
      const startX = has('CV') ? cxB : cxA;
      faces.push(
        { axis: 'y', pos: cyA, minX: startX, maxX: x1, type: 1, name: 'Muro CE (N)' },
        { axis: 'y', pos: cyB, minX: startX, maxX: x1, type: 1, name: 'Muro CE (S)' }
      );
      if (!this.isCenterEastConnected(mapX, mapY, codes)) {
        faces.push({ axis: 'x', pos: x1, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Este' });
      }
      if (!has('CV') && !has('CW')) {
        faces.push({ axis: 'x', pos: cxA, minY: cyA, maxY: cyB, type: 10, isCap: true, name: 'Canto Oeste' });
      }
    }

    // 4. ESQUINAS EN BORDES (NW, NE, SW, SE)
    // -------------------------------------------------------------
    if (has('N') && has('W') && !has('S') && !has('E')) {
      faces.push(
        { axis: 'y', pos: nyA, minX: x0, maxX: x1, type: 1, name: 'Esquina NO (N)' },
        { axis: 'x', pos: wxA, minY: y0, maxY: y1, type: 1, name: 'Esquina NO (O)' },
        { axis: 'y', pos: nyB, minX: wxB, maxX: x1, type: 1, name: 'Esquina NO (S)' },
        { axis: 'x', pos: wxB, minY: nyB, maxY: y1, type: 1, name: 'Esquina NO (E)' }
      );
      if (!this.isPerimeterEastConnected('N', mapX, mapY, codes)) {
        faces.push({ axis: 'x', pos: x1, minY: nyA, maxY: nyB, type: 10, isCap: true, name: 'Canto Este' });
      }
      if (!this.isPerimeterSouthConnected('W', mapX, mapY, codes)) {
        faces.push({ axis: 'y', pos: y1, minX: wxA, maxX: wxB, type: 10, isCap: true, name: 'Canto Sur' });
      }
      return faces;
    }
    if (has('N') && has('E') && !has('S') && !has('W')) {
      faces.push(
        { axis: 'y', pos: nyA, minX: x0, maxX: x1, type: 1, name: 'Esquina NE (N)' },
        { axis: 'x', pos: exB, minY: y0, maxY: y1, type: 1, name: 'Esquina NE (E)' },
        { axis: 'y', pos: nyB, minX: x0, maxX: exA, type: 1, name: 'Esquina NE (S)' },
        { axis: 'x', pos: exA, minY: nyB, maxY: y1, type: 1, name: 'Esquina NE (O)' }
      );
      if (!this.isPerimeterWestConnected('N', mapX, mapY, codes)) {
        faces.push({ axis: 'x', pos: x0, minY: nyA, maxY: nyB, type: 10, isCap: true, name: 'Canto Oeste' });
      }
      if (!this.isPerimeterSouthConnected('E', mapX, mapY, codes)) {
        faces.push({ axis: 'y', pos: y1, minX: exA, maxX: exB, type: 10, isCap: true, name: 'Canto Sur' });
      }
      return faces;
    }
    if (has('S') && has('W') && !has('N') && !has('E')) {
      faces.push(
        { axis: 'y', pos: syB, minX: x0, maxX: x1, type: 1, name: 'Esquina SO (S)' },
        { axis: 'x', pos: wxA, minY: y0, maxY: y1, type: 1, name: 'Esquina SO (O)' },
        { axis: 'y', pos: syA, minX: wxB, maxX: x1, type: 1, name: 'Esquina SO (N)' },
        { axis: 'x', pos: wxB, minY: y0, maxY: syA, type: 1, name: 'Esquina SO (E)' }
      );
      if (!this.isPerimeterEastConnected('S', mapX, mapY, codes)) {
        faces.push({ axis: 'x', pos: x1, minY: syA, maxY: syB, type: 10, isCap: true, name: 'Canto Este' });
      }
      if (!this.isPerimeterNorthConnected('W', mapX, mapY, codes)) {
        faces.push({ axis: 'y', pos: y0, minX: wxA, maxX: wxB, type: 10, isCap: true, name: 'Canto Norte' });
      }
      return faces;
    }
    if (has('S') && has('E') && !has('N') && !has('W')) {
      faces.push(
        { axis: 'y', pos: syB, minX: x0, maxX: x1, type: 1, name: 'Esquina SE (S)' },
        { axis: 'x', pos: exB, minY: y0, maxY: y1, type: 1, name: 'Esquina SE (E)' },
        { axis: 'y', pos: syA, minX: x0, maxX: exA, type: 1, name: 'Esquina SE (N)' },
        { axis: 'x', pos: exA, minY: y0, maxY: syA, type: 1, name: 'Esquina SE (O)' }
      );
      if (!this.isPerimeterWestConnected('S', mapX, mapY, codes)) {
        faces.push({ axis: 'x', pos: x0, minY: syA, maxY: syB, type: 10, isCap: true, name: 'Canto Oeste' });
      }
      if (!this.isPerimeterNorthConnected('E', mapX, mapY, codes)) {
        faces.push({ axis: 'y', pos: y0, minX: exA, maxX: exB, type: 10, isCap: true, name: 'Canto Norte' });
      }
      return faces;
    }

    // 5. MUROS, PUERTAS Y VENTANAS EN BORDES SUELTOS O COMBINADOS
    // -------------------------------------------------------------
    if (has('N') || has('DN') || has('WN')) {
      const isDoor = has('DN');
      const isWin = has('WN');
      const type = isDoor ? 2 : isWin ? 6 : 1;
      const name = isDoor ? 'Puerta Norte' : isWin ? 'Ventana Norte' : 'Pared Norte';
      faces.push(
        { axis: 'y', pos: nyB, minX: x0, maxX: x1, type, name },
        { axis: 'y', pos: nyA, minX: x0, maxX: x1, type, name }
      );
      if (!this.isPerimeterWestConnected('N', mapX, mapY, codes)) {
        faces.push({ axis: 'x', pos: x0, minY: nyA, maxY: nyB, type: 10, isCap: true, name: 'Canto Oeste' });
      }
      if (!this.isPerimeterEastConnected('N', mapX, mapY, codes)) {
        faces.push({ axis: 'x', pos: x1, minY: nyA, maxY: nyB, type: 10, isCap: true, name: 'Canto Este' });
      }
    }

    if (has('S') || has('DS') || has('WS')) {
      const isDoor = has('DS');
      const isWin = has('WS');
      const type = isDoor ? 4 : isWin ? 6 : 1;
      const name = isDoor ? 'Puerta Sur' : isWin ? 'Ventana Sur' : 'Pared Sur';
      faces.push(
        { axis: 'y', pos: syA, minX: x0, maxX: x1, type, name },
        { axis: 'y', pos: syB, minX: x0, maxX: x1, type, name }
      );
      if (!this.isPerimeterWestConnected('S', mapX, mapY, codes)) {
        faces.push({ axis: 'x', pos: x0, minY: syA, maxY: syB, type: 10, isCap: true, name: 'Canto Oeste' });
      }
      if (!this.isPerimeterEastConnected('S', mapX, mapY, codes)) {
        faces.push({ axis: 'x', pos: x1, minY: syA, maxY: syB, type: 10, isCap: true, name: 'Canto Este' });
      }
    }

    if (has('W') || has('DW') || has('WW')) {
      const isDoor = has('DW');
      const isWin = has('WW');
      const type = isDoor ? 5 : isWin ? 6 : 1;
      const name = isDoor ? 'Puerta Oeste' : isWin ? 'Ventana Oeste' : 'Pared Oeste';
      faces.push(
        { axis: 'x', pos: wxB, minY: y0, maxY: y1, type, name },
        { axis: 'x', pos: wxA, minY: y0, maxY: y1, type, name }
      );
      if (!this.isPerimeterNorthConnected('W', mapX, mapY, codes)) {
        faces.push({ axis: 'y', pos: y0, minX: wxA, maxX: wxB, type: 10, isCap: true, name: 'Canto Norte' });
      }
      if (!this.isPerimeterSouthConnected('W', mapX, mapY, codes)) {
        faces.push({ axis: 'y', pos: y1, minX: wxA, maxX: wxB, type: 10, isCap: true, name: 'Canto Sur' });
      }
    }

    if (has('E') || has('DE') || has('WE')) {
      const isDoor = has('DE');
      const isWin = has('WE');
      const type = isDoor ? 3 : isWin ? 6 : 1;
      const name = isDoor ? 'Puerta Este' : isWin ? 'Ventana Este' : 'Pared Este';
      faces.push(
        { axis: 'x', pos: exA, minY: y0, maxY: y1, type, name },
        { axis: 'x', pos: exB, minY: y0, maxY: y1, type, name }
      );
      if (!this.isPerimeterNorthConnected('E', mapX, mapY, codes)) {
        faces.push({ axis: 'y', pos: y0, minX: exA, maxX: exB, type: 10, isCap: true, name: 'Canto Norte' });
      }
      if (!this.isPerimeterSouthConnected('E', mapX, mapY, codes)) {
        faces.push({ axis: 'y', pos: y1, minX: exA, maxX: exB, type: 10, isCap: true, name: 'Canto Sur' });
      }
    }

    // 6. PUERTAS ABIERTAS (HOJA ABATIDA A 90° CON DIMENSIONES IDÉNTICAS A CERRADA: 1.0x0.20)
    // --------------------------------------------------------------------------------------
    if (has('ODN')) {
      const type = 2;
      const name = 'Puerta Norte [N] (Abierta)';
      faces.push(
        { axis: 'x', pos: wxB, minY: y0, maxY: y1, type, name },
        { axis: 'x', pos: wxA, minY: y0, maxY: y1, type, name },
        { axis: 'y', pos: y1, minX: wxA, maxX: wxB, type: 10, isCap: true, name: 'Canto Puerta' }
      );
      if (!this.isPerimeterNorthConnected('W', mapX, mapY, codes)) {
        faces.push({ axis: 'y', pos: y0, minX: wxA, maxX: wxB, type: 10, isCap: true, name: 'Canto Puerta' });
      }
    }

    if (has('ODS')) {
      const type = 4;
      const name = 'Puerta Sur [S] (Abierta)';
      faces.push(
        { axis: 'x', pos: wxB, minY: y0, maxY: y1, type, name },
        { axis: 'x', pos: wxA, minY: y0, maxY: y1, type, name },
        { axis: 'y', pos: y0, minX: wxA, maxX: wxB, type: 10, isCap: true, name: 'Canto Puerta' }
      );
      if (!this.isPerimeterSouthConnected('W', mapX, mapY, codes)) {
        faces.push({ axis: 'y', pos: y1, minX: wxA, maxX: wxB, type: 10, isCap: true, name: 'Canto Puerta' });
      }
    }

    if (has('ODW')) {
      const type = 5;
      const name = 'Puerta Oeste [O] (Abierta)';
      faces.push(
        { axis: 'y', pos: nyB, minX: x0, maxX: x1, type, name },
        { axis: 'y', pos: nyA, minX: x0, maxX: x1, type, name },
        { axis: 'x', pos: x1, minY: nyA, maxY: nyB, type: 10, isCap: true, name: 'Canto Puerta' }
      );
      if (!this.isPerimeterWestConnected('N', mapX, mapY, codes)) {
        faces.push({ axis: 'x', pos: x0, minY: nyA, maxY: nyB, type: 10, isCap: true, name: 'Canto Puerta' });
      }
    }

    if (has('ODE')) {
      const type = 3;
      const name = 'Puerta Este [E] (Abierta)';
      faces.push(
        { axis: 'y', pos: nyB, minX: x0, maxX: x1, type, name },
        { axis: 'y', pos: nyA, minX: x0, maxX: x1, type, name },
        { axis: 'x', pos: x0, minY: nyA, maxY: nyB, type: 10, isCap: true, name: 'Canto Puerta' }
      );
      if (!this.isPerimeterEastConnected('N', mapX, mapY, codes)) {
        faces.push({ axis: 'x', pos: x1, minY: nyA, maxY: nyB, type: 10, isCap: true, name: 'Canto Puerta' });
      }
    }

    if (has('ODCH')) {
      const type = 2;
      const name = 'Puerta Central (Abierta)';
      faces.push(
        { axis: 'x', pos: wxB, minY: y0, maxY: y1, type, name },
        { axis: 'x', pos: wxA, minY: y0, maxY: y1, type, name },
        { axis: 'y', pos: y0, minX: wxA, maxX: wxB, type: 10, isCap: true, name: 'Canto Puerta' },
        { axis: 'y', pos: y1, minX: wxA, maxX: wxB, type: 10, isCap: true, name: 'Canto Puerta' }
      );
    }

    if (has('ODCV')) {
      const type = 3;
      const name = 'Puerta Central (Abierta)';
      faces.push(
        { axis: 'y', pos: nyB, minX: x0, maxX: x1, type, name },
        { axis: 'y', pos: nyA, minX: x0, maxX: x1, type, name },
        { axis: 'x', pos: x0, minY: nyA, maxY: nyB, type: 10, isCap: true, name: 'Canto Puerta' },
        { axis: 'x', pos: x1, minY: nyA, maxY: nyB, type: 10, isCap: true, name: 'Canto Puerta' }
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

    // Textura 6: Ventana medieval gótica de cristal biselado con cruceta de hierro
    this.textures[6] = this.createWindowTexture();

    // Textura 10: Marco / Jamba de puerta metálica y piedra (profundidad fina 0.2)
    this.textures[10] = this.createDoorFrameTexture();
  }

  createWindowTexture() {
    const size = this.textureSize;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Marco exterior de piedra oscura
    ctx.fillStyle = '#1e222a';
    ctx.fillRect(0, 0, size, size);

    // Alféizar y bisel
    ctx.fillStyle = '#2f3640';
    ctx.fillRect(4, 4, size - 8, size - 8);

    // Vidrio con degradado azul cielo translúcido
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, '#54a0ff');
    grad.addColorStop(0.35, '#70a1ff');
    grad.addColorStop(0.7, '#2e86de');
    grad.addColorStop(1, '#1e3799');
    ctx.fillStyle = grad;
    ctx.fillRect(7, 7, size - 14, size - 14);

    // Destellos diagonales en el cristal
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.moveTo(12, 7);
    ctx.lineTo(24, 7);
    ctx.lineTo(7, 24);
    ctx.lineTo(7, 12);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(30, 7);
    ctx.lineTo(40, 7);
    ctx.lineTo(7, 40);
    ctx.lineTo(7, 30);
    ctx.closePath();
    ctx.fill();

    // Cruceta de herrería / madera oscura dividiendo la ventana en 4 vidrieras
    const mid = Math.floor(size / 2);
    ctx.fillStyle = '#151922';
    ctx.fillRect(mid - 2, 6, 4, size - 12);
    ctx.fillRect(6, mid - 2, size - 12, 4);

    // Remache central
    ctx.fillStyle = '#8395a7';
    ctx.fillRect(mid - 1, mid - 1, 2, 2);

    // Ruido granulado sutil
    const img = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 10;
      img.data[i] = Math.min(255, Math.max(0, img.data[i] + noise));
      img.data[i+1] = Math.min(255, Math.max(0, img.data[i+1] + noise));
      img.data[i+2] = Math.min(255, Math.max(0, img.data[i+2] + noise));
    }
    ctx.putImageData(img, 0, 0);

    return new Uint32Array(ctx.getImageData(0, 0, size, size).data.buffer);
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

/**
 * Lógica del Editor Visual de Niveles y Generador de JSON
 */

// Colores representativos de cada estilo, para distinguirlos de un vistazo en la
// cuadrícula 2D del editor (la textura real solo se ve en la Demo 3D)
const WALL_STYLE_COLORS = {
  castillo: '#5a6275',
  blanca: '#e8eaed',
  cristal: '#5fb8e8'
};
const DOOR_STYLE_COLORS = {
  castillo: '#a9723f',
  blanca: '#e8eaed',
  negra: '#2b2d33',
  cristal: '#5fb8e8'
};

// Tipos de textura del motor (RaycasterEngine.textures) disponibles para override por imagen
const TEXTURE_SLOTS = [
  { type: 1, label: 'Pared' },
  { type: 2, label: 'Puerta Norte' },
  { type: 3, label: 'Puerta Este' },
  { type: 4, label: 'Puerta Sur' },
  { type: 5, label: 'Puerta Oeste' },
  { type: 6, label: 'Ventana' },
  { type: 10, label: 'Canto / Jamba' }
];

class LevelEditor {
  constructor() {
    this.canvas = document.getElementById('editorCanvas');
    this.ctx = this.canvas.getContext('2d');

    // Dimensiones iniciales
    this.cols = 12;
    this.rows = 12;
    this.cellSize = 36;

    // Estado del mapa y jugador
    this.grid = [];
    this.player = { x: 3.5, y: 3.5, angle: -Math.PI / 2 };

    // Texturas personalizadas: { [tipo]: 'data:image/png;base64,...' }
    this.customTextures = {};

    // Estilo de pincel activo (ver src/engine/textures.js): con QUÉ estilo se
    // etiquetan las paredes/puertas que se coloquen A PARTIR DE AHORA. Cada
    // segmento ya colocado conserva el estilo con el que se pintó (wallStyleMap),
    // así que cambiar esto NO afecta a lo que ya existe en el mapa.
    this.wallStyle = 'castillo';
    this.doorStyle = 'castillo';
    // Estilo del dintel: la franja de PARED que queda fija por encima de cada puerta
    // (las puertas son más bajas que las paredes). Usa el catálogo de estilos de pared.
    this.lintelStyle = 'castillo';

    // Estilo por segmento: { "x,y": { N: 'blanca', DW: 'negra', ... } }
    this.wallStyleMap = {};

    // Herramientas y selección
    this.currentTool = 'brush'; // 'brush', 'room', 'eraser'
    this.selectedTile = 1; // 1 = pared, 0 = suelo, 'accessories' = accesorios, 'player' = spawn
    this.selectedAccessory = 'door'; // 'door', 'window'
    this.isMouseDown = false;
    this.roomStart = null;
    this.hoverCell = { x: -1, y: -1 };

    // Colocación y Rotación de tabique (5x1)
    this.placementMode = 'N';
    this.rotation = 'H'; // 'H' (Horizontal ━) o 'V' (Vertical ┃)
    this.hoverSubEdge = 'N';

    // Modo de Zoom
    this.zoomMode = 'auto'; // 'auto' o 'manual'
    this.cellSize = 32;

    // Referencias DOM
    this.canvasContainer = document.getElementById('canvasContainer');
    this.jsonOutput = document.getElementById('jsonOutput');
    this.cursorCoords = document.getElementById('cursorCoords');
    this.mapStats = document.getElementById('mapStats');
    this.toast = document.getElementById('toastMessage');
    this.zoomLabel = document.getElementById('zoomLabel');
    this.inputCols = document.getElementById('inputCols');
    this.inputRows = document.getElementById('inputRows');
    this.inputMapName = document.getElementById('inputMapName');

    const hasSavedMap = this.loadSavedMapIfExists();
    if (!hasSavedMap) {
      this.initDefaultMap();
    }
    this.setupEventListeners();
    this.setupTextureManager();
    this.setupStyleModals();
    this.restoreUIState();
    this.resizeCanvas();
    this.render();
    this.updateJSON();
  }

  /**
   * Intenta recuperar y restaurar un mapa guardado previamente en localStorage
   */
  loadSavedMapIfExists() {
    try {
      const savedMap = localStorage.getItem('customRaycasterMap');
      if (savedMap) {
        const data = JSON.parse(savedMap);
        if (data && data.map && Array.isArray(data.map) && data.map.length > 0) {
          this.rows = data.map.length;
          this.cols = data.map[0].length;
          this.grid = data.map;
          if (data.playerStart) {
            this.player.x = (typeof data.playerStart.x === 'number') ? data.playerStart.x : (this.cols / 2);
            this.player.y = (typeof data.playerStart.y === 'number') ? data.playerStart.y : (this.rows / 2);
            this.player.angle = (typeof data.playerStart.angle === 'number') ? data.playerStart.angle : -Math.PI / 2;
          }
          if (this.inputCols) this.inputCols.value = this.cols;
          if (this.inputRows) this.inputRows.value = this.rows;
          if (data.name && this.inputMapName) {
            this.inputMapName.value = data.name;
          }
          this.customTextures = (data.customTextures && typeof data.customTextures === 'object') ? data.customTextures : {};
          this.wallStyleMap = (data.wallStyleMap && typeof data.wallStyleMap === 'object') ? data.wallStyleMap : {};
          // El pincel activo se recuerda tal cual quedó (último estilo usado), no afecta a lo ya colocado
          this.wallStyle = (data.activeWallStyle && WALL_STYLES[data.activeWallStyle]) ? data.activeWallStyle : 'castillo';
          this.doorStyle = (data.activeDoorStyle && DOOR_STYLES[data.activeDoorStyle]) ? data.activeDoorStyle : 'castillo';
          this.lintelStyle = (data.activeLintelStyle && WALL_STYLES[data.activeLintelStyle]) ? data.activeLintelStyle : 'castillo';
          this.migrateCenteredDoors(this.grid);
          return true;
        }
      }
    } catch (e) {
      console.warn('Error al cargar mapa guardado de localStorage:', e);
    }
    return false;
  }

  /**
   * Sanea y migra la matriz del mapa convirtiendo cualquier puerta centrada obsoleta
   * (DCH / DCV / ODCH / ODCV) en su equivalente de pared normal (CH / CV).
   * También migra las claves asociadas en wallStyleMap si existían.
   * Devuelve true si se realizó alguna migración.
   */
  migrateCenteredDoors(grid) {
    if (!Array.isArray(grid)) return false;
    let migratedCount = 0;
    for (let y = 0; y < grid.length; y++) {
      const row = grid[y];
      if (!Array.isArray(row)) continue;
      for (let x = 0; x < row.length; x++) {
        const cell = row[x];
        if (Array.isArray(cell)) {
          let cellModified = false;
          const newCell = cell.map(code => {
            if (code === 'DCH' || code === 'ODCH') {
              cellModified = true;
              migratedCount++;
              this.migrateSegmentStyle(x, y, code, 'CH');
              return 'CH';
            }
            if (code === 'DCV' || code === 'ODCV') {
              cellModified = true;
              migratedCount++;
              this.migrateSegmentStyle(x, y, code, 'CV');
              return 'CV';
            }
            return code;
          });
          if (cellModified) {
            row[x] = newCell;
          }
        }
      }
    }
    return migratedCount > 0;
  }

  migrateSegmentStyle(x, y, oldCode, newCode) {
    if (!this.wallStyleMap) return;
    const key = `${x},${y}`;
    if (!this.wallStyleMap[key]) return;
    if (this.wallStyleMap[key][oldCode]) {
      this.wallStyleMap[key][newCode] = this.wallStyleMap[key][oldCode];
      delete this.wallStyleMap[key][oldCode];
    }
    if (this.wallStyleMap[key][oldCode + '_lintel']) {
      delete this.wallStyleMap[key][oldCode + '_lintel'];
    }
  }

  /**
   * Inicializa un mapa base con tabiques finos (5x1) en los bordes y esquinas
   */
  initDefaultMap() {
    this.grid = [];
    this.wallStyleMap = {};
    for (let y = 0; y < this.rows; y++) {
      const row = [];
      for (let x = 0; x < this.cols; x++) {
        const segs = [];
        if (y === 0) segs.push('N');
        if (y === this.rows - 1) segs.push('S');
        if (x === 0) segs.push('W');
        if (x === this.cols - 1) segs.push('E');
        row.push(segs);
      }
      this.grid.push(row);
    }

    // Colocar las 4 puertas finas en los centros de los muros
    const midX = Math.floor(this.cols / 2);
    const midY = Math.floor(this.rows / 2);
    this.grid[0][midX] = ['DN']; // Puerta Norte
    this.grid[midY][this.cols - 1] = ['DE']; // Puerta Este
    this.grid[this.rows - 1][midX] = ['DS']; // Puerta Sur
    this.grid[midY][0] = ['DW']; // Puerta Oeste

    this.player.x = midX + 0.5;
    this.player.y = midY + 0.5;
  }

  resizeCanvas() {
    if (this.zoomMode === 'auto') {
      const container = this.canvasContainer || document.getElementById('canvasContainer');
      const availW = container ? Math.max(260, container.clientWidth - 48) : 500;
      const availH = container ? Math.max(260, container.clientHeight - 48) : 450;
      this.cellSize = Math.max(18, Math.min(48, Math.floor(availW / this.cols), Math.floor(availH / this.rows)));
    }

    this.canvas.width = this.cols * this.cellSize;
    this.canvas.height = this.rows * this.cellSize;

    if (this.zoomLabel) {
      this.zoomLabel.textContent = `${this.cellSize}px`;
    }
  }

  setupEventListeners() {
    // Redimensionar al cambiar ventana
    window.addEventListener('resize', () => {
      this.resizeCanvas();
      this.render();
    });

    // Herramientas (Lápiz, Habitación, Goma)
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentTool = btn.dataset.tool;
        this.saveUIState();
      });
    });

    // Secciones plegables y desplegables (Accordion)
    document.querySelectorAll('.tool-section').forEach(section => {
      const header = section.querySelector('h2');
      if (header) {
        header.addEventListener('click', () => {
          section.classList.toggle('collapsed');
          this.saveUIState();
        });
      }
    });

    // Selector de categorías de paredes (Laterales y Centro)
    document.querySelectorAll('.wall-cat-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.wall-cat-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const target = tab.dataset.tab;
        const pLaterales = document.getElementById('panelLaterales');
        const pCentro = document.getElementById('panelCentro');

        if (pLaterales) pLaterales.classList.add('hidden');
        if (pCentro) pCentro.classList.add('hidden');

        if (target === 'laterales' && pLaterales) pLaterales.classList.remove('hidden');
        else if (target === 'centro' && pCentro) pCentro.classList.remove('hidden');

        this.saveUIState();
      });
    });

    // Cuadrículas visuales (3x3, 2x2) y botones auxiliares de paredes y esquinas
    document.querySelectorAll('.wall-tile-btn, .wall-aux-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.action === 'select-floor') {
          document.querySelectorAll('.wall-tile-btn, .wall-aux-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.placementMode = 'empty';
          this.showToast('Modo: Suelo libre / Borrar muros de casilla');
          this.render();
          this.saveUIState();
          return;
        }

        const mode = btn.dataset.mode;
        if (!mode) return;

        document.querySelectorAll('.wall-tile-btn, .wall-aux-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.placementMode = mode;
        this.showToast(`Modo: ${btn.title}`);
        this.render();
        this.saveUIState();
      });
    });

    // Paleta de elementos (auto-mostrar Colocación de Paredes o Accesorios según selección)
    const sectionWallPlacement = document.getElementById('sectionWallPlacement');
    const sectionAccessoryPlacement = document.getElementById('sectionAccessoryPlacement');

    document.querySelectorAll('input[name="tileSelect"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        document.querySelectorAll('.palette-item').forEach(p => p.classList.remove('active'));
        e.target.closest('.palette-item').classList.add('active');
        const val = e.target.value;
        this.selectedTile = (val === 'player' || val === 'accessories' || val === 'door' || val === 'window') ? val : parseInt(val, 10);

        // Si pulso en Pared (1), mostrar solo Colocación de Paredes
        if (sectionWallPlacement) {
          if (val === '1' || val === 1) {
            sectionWallPlacement.style.display = '';
            sectionWallPlacement.classList.remove('collapsed');
          } else {
            sectionWallPlacement.style.display = 'none';
          }
        }

        // Si pulso en Accesorios, mostrar solo Colocación de Accesorios
        if (sectionAccessoryPlacement) {
          if (val === 'accessories') {
            sectionAccessoryPlacement.style.display = '';
            sectionAccessoryPlacement.classList.remove('collapsed');
          } else {
            sectionAccessoryPlacement.style.display = 'none';
          }
        }

        this.render();
        this.saveUIState();
      });
    });

    // Selector de accesorios (Puerta, Ventana, etc.)
    document.querySelectorAll('.accessory-tile-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.accessory-tile-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedAccessory = btn.dataset.accessory;
        const name = this.selectedAccessory === 'door' ? 'Puerta' : 'Ventana';
        this.showToast(`Accesorio activo: ${name}`);
        this.render();
        this.saveUIState();
      });
    });

    // Quick size chips (8x8, 12x12, 16x16, 20x20)
    document.querySelectorAll('.btn-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.btn-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const c = parseInt(chip.dataset.cols, 10);
        const r = parseInt(chip.dataset.rows, 10);
        this.inputCols.value = c;
        this.inputRows.value = r;
        this.resizeGrid(c, r);
      });
    });

    // Dimensiones del mapa: Botón Redimensionar
    const triggerResize = () => {
      const newCols = parseInt(this.inputCols.value, 10);
      const newRows = parseInt(this.inputRows.value, 10);
      if (isNaN(newCols) || isNaN(newRows) || newCols < 5 || newRows < 5 || newCols > 50 || newRows > 50) {
        this.showToast('Las dimensiones deben estar entre 5 y 50 celdas');
        return;
      }
      this.resizeGrid(newCols, newRows);
    };

    document.getElementById('btnResizeMap').addEventListener('click', triggerResize);

    // Botón para crear nueva sala limpia del tamaño especificado
    document.getElementById('btnNewRoomOfSize').addEventListener('click', () => {
      const newCols = parseInt(this.inputCols.value, 10);
      const newRows = parseInt(this.inputRows.value, 10);
      if (isNaN(newCols) || isNaN(newRows) || newCols < 5 || newRows < 5 || newCols > 50 || newRows > 50) {
        this.showToast('⚠️ Las dimensiones deben estar entre 5 y 50 celdas');
        return;
      }
      this.createNewRoomOfSize(newCols, newRows);
    });

    // Permitir pulsar Enter en los inputs de ancho y alto
    [this.inputCols, this.inputRows].forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          triggerResize();
        }
      });
    });

    // Campo de nombre del mapa
    if (this.inputMapName) {
      this.inputMapName.addEventListener('input', () => {
        this.updateJSON();
      });
    }

    // Controles de Zoom
    document.getElementById('btnZoomIn').addEventListener('click', () => {
      this.zoomMode = 'manual';
      this.cellSize = Math.min(60, this.cellSize + 4);
      this.resizeCanvas();
      this.render();
      this.saveUIState();
    });

    document.getElementById('btnZoomOut').addEventListener('click', () => {
      this.zoomMode = 'manual';
      this.cellSize = Math.max(16, this.cellSize - 4);
      this.resizeCanvas();
      this.render();
      this.saveUIState();
    });

    document.getElementById('btnZoomAuto').addEventListener('click', () => {
      this.zoomMode = 'auto';
      this.resizeCanvas();
      this.render();
      this.showToast('🔍 Zoom automático ajustado');
      this.saveUIState();
    });

    // Plantillas
    document.getElementById('preset4Doors').addEventListener('click', () => this.applyPreset('4doors'));
    document.getElementById('presetTwoRooms').addEventListener('click', () => this.applyPreset('twoRooms'));
    document.getElementById('presetMaze').addEventListener('click', () => this.applyPreset('maze'));
    document.getElementById('btnClearMap').addEventListener('click', () => this.clearMap());

    // Canvas Mouse Events
    this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    window.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    this.canvas.addEventListener('mouseleave', () => {
      this.hoverCell = { x: -1, y: -1 };
      this.cursorCoords.textContent = 'Celda: (X: -, Y: -)';
      this.render();
    });

    // Touch Events
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const mouseEvent = new MouseEvent('mousedown', {
        clientX: touch.clientX,
        clientY: touch.clientY
      });
      this.canvas.dispatchEvent(mouseEvent);
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const mouseEvent = new MouseEvent('mousemove', {
        clientX: touch.clientX,
        clientY: touch.clientY
      });
      window.dispatchEvent(mouseEvent);
    }, { passive: false });

    this.canvas.addEventListener('touchend', (e) => {
      const mouseEvent = new MouseEvent('mouseup', {});
      window.dispatchEvent(mouseEvent);
    });

    // JSON Actions
    document.getElementById('btnCopyJson').addEventListener('click', () => this.copyJson());
    document.getElementById('btnDownloadJson').addEventListener('click', () => this.downloadJson());
    document.getElementById('btnImportJson').addEventListener('click', () => {
      document.getElementById('fileInput').click();
    });
    document.getElementById('fileInput').addEventListener('change', (e) => this.importFile(e));
    document.getElementById('btnApplyManualJson').addEventListener('click', () => this.applyManualJson());

    // Probar en 3D
    document.getElementById('btnPlayLevel').addEventListener('click', () => this.playCurrentLevel());

    // Colapsar y expandir sidebar de JSON (40px colapsada)
    const workspace = document.querySelector('.workspace');
    const jsonSidebar = document.getElementById('jsonSidebar');
    const btnToggleJsonSidebar = document.getElementById('btnToggleJsonSidebar');

    const toggleJsonSidebar = () => {
      if (!workspace || !jsonSidebar) return;
      const isCollapsed = !workspace.classList.contains('json-collapsed');
      this.setJsonSidebarCollapsed(isCollapsed);
      this.saveUIState();

      // Reajustar tamaño del canvas cuando se termine la animación
      setTimeout(() => {
        this.resizeCanvas();
        this.render();
      }, 260);
    };

    if (btnToggleJsonSidebar) {
      btnToggleJsonSidebar.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleJsonSidebar();
      });
    }

    if (jsonSidebar) {
      jsonSidebar.addEventListener('click', () => {
        if (jsonSidebar.classList.contains('collapsed')) {
          toggleJsonSidebar();
        }
      });
    }
  }

  getCellFromEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / this.cellSize);
    const y = Math.floor((e.clientY - rect.top) / this.cellSize);
    if (x >= 0 && x < this.cols && y >= 0 && y < this.rows) {
      return { x, y };
    }
    return null;
  }

  handleMouseDown(e) {
    const cell = this.getCellFromEvent(e);
    if (!cell) return;

    this.isMouseDown = true;

    if (this.currentTool === 'room') {
      this.roomStart = cell;
    } else {
      const rect = this.canvas.getBoundingClientRect();
      const localX = (e.clientX - rect.left) / this.cellSize - cell.x;
      const localY = (e.clientY - rect.top) / this.cellSize - cell.y;
      this.updateHoverSubEdge(cell, localX, localY);
      this.applyToolAt(cell.x, cell.y);
    }
    this.render();
  }

  updateHoverSubEdge(cell, localX, localY) {
    this.lastLocalX = localX;
    this.lastLocalY = localY;

    let cellSegs = [];
    if (this.grid[cell.y] && this.grid[cell.y][cell.x]) {
      const val = this.grid[cell.y][cell.x];
      if (Array.isArray(val)) {
        cellSegs = val;
      } else if (val === 1) {
        cellSegs = ['N', 'S', 'E', 'W'];
      } else if (typeof val === 'number' && val >= 2 && val <= 5) {
        cellSegs = [['DN'], ['DE'], ['DS'], ['DW']][val - 2];
      }
    }

    if (this.currentTool === 'eraser') {
      // Si la casilla tiene solo 1 segmento (como un muro de habitación 'N', 'S', etc.), ese es el objetivo directo
      if (cellSegs.length === 1) {
        this.hoverSubEdge = cellSegs[0].replace(/^[DW]/, '');
        return;
      }

      // Si la casilla tiene varios segmentos existentes, buscar el más cercano geométricamente al cursor
      if (cellSegs.length > 1) {
        let bestSeg = cellSegs[0];
        let minDist = Infinity;

        const getDist = (segRaw) => {
          const s = segRaw.replace(/^[DW]/, '');
          switch (s) {
            case 'N': return Math.abs(localY);
            case 'S': return Math.abs(1 - localY);
            case 'W': return Math.abs(localX);
            case 'E': return Math.abs(1 - localX);
            case 'CH': return Math.abs(0.5 - localY);
            case 'CV': return Math.abs(0.5 - localX);
            case 'CN': return Math.hypot(0.5 - localX, Math.max(0, localY - 0.5));
            case 'CS': return Math.hypot(0.5 - localX, Math.max(0, 0.5 - localY));
            case 'CW': return Math.hypot(Math.max(0, localX - 0.5), 0.5 - localY);
            case 'CE': return Math.hypot(Math.max(0, 0.5 - localX), 0.5 - localY);
            case 'RNW': return Math.hypot(localX, localY);
            case 'RNE': return Math.hypot(1 - localX, localY);
            case 'RSW': return Math.hypot(localX, 1 - localY);
            case 'RSE': return Math.hypot(1 - localX, 1 - localY);
            default: return 1;
          }
        };

        for (const s of cellSegs) {
          const d = getDist(s);
          if (d < minDist) {
            minDist = d;
            bestSeg = s;
          }
        }
        this.hoverSubEdge = bestSeg.replace(/^[DW]/, '');
        return;
      }

      // Si la celda está vacía, detectar el borde más cercano por geometría general
      const dN = localY;
      const dS = 1 - localY;
      const dW = localX;
      const dE = 1 - localX;
      const dCH = Math.abs(0.5 - localY);
      const dCV = Math.abs(0.5 - localX);

      const minEdgeDist = Math.min(dN, dS, dW, dE, dCH, dCV);
      if (minEdgeDist === dN) this.hoverSubEdge = 'N';
      else if (minEdgeDist === dS) this.hoverSubEdge = 'S';
      else if (minEdgeDist === dW) this.hoverSubEdge = 'W';
      else if (minEdgeDist === dE) this.hoverSubEdge = 'E';
      else if (minEdgeDist === dCH) this.hoverSubEdge = 'CH';
      else this.hoverSubEdge = 'CV';
      return;
    }

    if (this.selectedTile === 'accessories' || this.selectedTile === 'door' || this.selectedTile === 'window') {
      if (localY < 0.28) this.hoverSubEdge = 'N';
      else if (localY > 0.72) this.hoverSubEdge = 'S';
      else if (localX < 0.28) this.hoverSubEdge = 'W';
      else if (localX > 0.72) this.hoverSubEdge = 'E';
      else this.hoverSubEdge = (this.rotation === 'H') ? 'CH' : 'CV';
    } else if (this.placementMode.startsWith('corner_')) {
      this.hoverSubEdge = this.placementMode;
    } else if (this.placementMode === 'auto') {
      if (localY < 0.28) this.hoverSubEdge = 'N';
      else if (localY > 0.72) this.hoverSubEdge = 'S';
      else if (localX < 0.28) this.hoverSubEdge = 'W';
      else if (localX > 0.72) this.hoverSubEdge = 'E';
      else this.hoverSubEdge = (this.rotation === 'H') ? 'CH' : 'CV';
    } else if (this.placementMode === 'center') {
      this.hoverSubEdge = (this.rotation === 'H') ? 'CH' : 'CV';
    } else if (this.placementMode === 'empty') {
      this.hoverSubEdge = 'empty';
    } else {
      this.hoverSubEdge = this.placementMode;
    }
  }

  handleMouseMove(e) {
    const cell = this.getCellFromEvent(e);
    if (cell) {
      this.hoverCell = cell;
      this.cursorCoords.textContent = `Celda: (X: ${cell.x}, Y: ${cell.y})`;

      // Calcular borde / lateral bajo el cursor dentro de la celda
      const rect = this.canvas.getBoundingClientRect();
      const localX = (e.clientX - rect.left) / this.cellSize - cell.x;
      const localY = (e.clientY - rect.top) / this.cellSize - cell.y;

      this.updateHoverSubEdge(cell, localX, localY);

      if (this.isMouseDown && this.currentTool !== 'room') {
        this.applyToolAt(cell.x, cell.y);
      }
    } else {
      this.hoverCell = { x: -1, y: -1 };
    }
    this.render();
  }

  handleMouseUp(e) {
    if (!this.isMouseDown) return;
    this.isMouseDown = false;

    if (this.currentTool === 'room' && this.roomStart) {
      const cell = this.getCellFromEvent(e) || this.hoverCell;
      if (cell && cell.x >= 0) {
        this.createRoom(this.roomStart, cell);
      }
      this.roomStart = null;
      this.render();
      this.updateJSON();
    }
  }

  /**
   * Etiqueta un código de segmento (borde/centro) recién colocado en (x,y) con el
   * estilo de pincel activo en ese momento (this.wallStyle, this.doorStyle o
   * this.lintelStyle según sea pared, puerta o dintel). Las ventanas no tienen
   * variantes de estilo, se ignoran. Un código terminado en "_lintel" es el hueco
   * de pared que queda fijo por encima de una puerta (las puertas son más bajas
   * que las paredes) y usa SIEMPRE this.lintelStyle, aunque el código en sí
   * empiece por "D".
   */
  setSegmentStyle(x, y, edgeCode) {
    // Ventanas (WN, WS, WE, WW, WCH, WCV): sin variantes de estilo, se ignoran.
    // OJO: el código de pared Oeste es exactamente 'W' (1 carácter) y NO debe
    // confundirse con los códigos de ventana, que siempre tienen 2+ caracteres.
    if (edgeCode.length > 1 && edgeCode.startsWith('W') && !edgeCode.endsWith('_lintel')) return;
    const key = `${x},${y}`;
    if (!this.wallStyleMap[key]) this.wallStyleMap[key] = {};
    const isLintel = edgeCode.endsWith('_lintel');
    const isDoor = !isLintel && edgeCode.startsWith('D');
    this.wallStyleMap[key][edgeCode] = isLintel ? this.lintelStyle : (isDoor ? this.doorStyle : this.wallStyle);
  }

  /**
   * Olvida el estilo asociado a un código de segmento eliminado en (x,y)
   */
  clearSegmentStyle(x, y, edgeCode) {
    const key = `${x},${y}`;
    if (!this.wallStyleMap[key]) return;
    delete this.wallStyleMap[key][edgeCode];
    if (Object.keys(this.wallStyleMap[key]).length === 0) delete this.wallStyleMap[key];
  }

  /**
   * Olvida todos los estilos de segmento guardados para la celda (x,y)
   */
  clearCellStyles(x, y) {
    delete this.wallStyleMap[`${x},${y}`];
  }

  applyToolAt(x, y) {
    let changed = false;

    // Normalizar celda a array si era un valor numérico
    if (!Array.isArray(this.grid[y][x])) {
      if (this.grid[y][x] === 1) this.grid[y][x] = ['N', 'S', 'E', 'W'];
      else if (this.grid[y][x] === 2) this.grid[y][x] = ['DN'];
      else if (this.grid[y][x] === 3) this.grid[y][x] = ['DE'];
      else if (this.grid[y][x] === 4) this.grid[y][x] = ['DS'];
      else if (this.grid[y][x] === 5) this.grid[y][x] = ['DW'];
      else this.grid[y][x] = [];
    }

    const currentSegs = this.grid[y][x];

    if (this.currentTool === 'eraser') {
      // Borrado con herramienta Borrador
      if (currentSegs.length > 0) {
        const target = this.hoverSubEdge;
        let idx = currentSegs.findIndex(s => s === target || s === 'D' + target || s === 'W' + target);

        // Si no hubo coincidencia exacta pero solo queda 1 segmento en la celda, borrarlo directamente
        if (idx === -1 && currentSegs.length === 1) {
          idx = 0;
        }

        // Si aún no coincide y tenemos coordenadas del cursor, buscar el segmento geométricamente más cercano
        if (idx === -1 && typeof this.lastLocalX === 'number' && typeof this.lastLocalY === 'number') {
          const lx = this.lastLocalX;
          const ly = this.lastLocalY;
          let bestIdx = 0;
          let minDist = Infinity;
          currentSegs.forEach((segRaw, i) => {
            const s = segRaw.replace(/^[DW]/, '');
            let d = 1;
            if (s === 'N') d = Math.abs(ly);
            else if (s === 'S') d = Math.abs(1 - ly);
            else if (s === 'W') d = Math.abs(lx);
            else if (s === 'E') d = Math.abs(1 - lx);
            else if (s === 'CH') d = Math.abs(0.5 - ly);
            else if (s === 'CV') d = Math.abs(0.5 - lx);
            else if (s === 'CN') d = Math.hypot(0.5 - lx, Math.max(0, ly - 0.5));
            else if (s === 'CS') d = Math.hypot(0.5 - lx, Math.max(0, 0.5 - ly));
            else if (s === 'CW') d = Math.hypot(Math.max(0, lx - 0.5), 0.5 - ly);
            else if (s === 'CE') d = Math.hypot(Math.max(0, 0.5 - lx), 0.5 - ly);
            else if (s === 'RNW') d = Math.hypot(lx, ly);
            else if (s === 'RNE') d = Math.hypot(1 - lx, ly);
            else if (s === 'RSW') d = Math.hypot(lx, 1 - ly);
            else if (s === 'RSE') d = Math.hypot(1 - lx, 1 - ly);
            if (d < minDist) {
              minDist = d;
              bestIdx = i;
            }
          });
          idx = bestIdx;
        }

        if (idx !== -1) {
          const removedCode = currentSegs[idx];
          this.clearSegmentStyle(x, y, removedCode);
          if (removedCode.startsWith('D')) this.clearSegmentStyle(x, y, removedCode + '_lintel');
          currentSegs.splice(idx, 1);
          changed = true;
        }
      }
    } else if (this.selectedTile === 'player') {
      this.player.x = x + 0.5;
      this.player.y = y + 0.5;
      this.grid[y][x] = [];
      this.clearCellStyles(x, y);
      changed = true;
    } else if (this.selectedTile === 0 || this.hoverSubEdge === 'empty') {
      // Suelo libre: vaciar toda la casilla
      if (currentSegs.length > 0) {
        this.grid[y][x] = [];
        this.clearCellStyles(x, y);
        changed = true;
      }
    } else if (this.hoverSubEdge.startsWith('corner_')) {
      // Esquinas rápidas en bordes, centradas y cruces
      const c = this.hoverSubEdge.replace('corner_', '');
      const cornerMap = {
        'FULL_BOX': ['N', 'S', 'E', 'W'],
        'NW': ['N', 'W'],
        'NE': ['N', 'E'],
        'SW': ['S', 'W'],
        'SE': ['S', 'E'],
        'CH_W': ['CH', 'W'],
        'CH_E': ['CH', 'E'],
        'CV_N': ['CV', 'N'],
        'CV_S': ['CV', 'S'],
        'CH_W_full': ['CH', 'W'],
        'CH_E_full': ['CH', 'E'],
        'CENTER_CROSS': ['CH', 'CV'],
        'CENTER_NW': ['CN', 'CW'],
        'CENTER_NE': ['CN', 'CE'],
        'CENTER_SW': ['CS', 'CW'],
        'CENTER_SE': ['CS', 'CE'],
        'T_INT_N': ['CH', 'CN'],
        'T_INT_S': ['CH', 'CS'],
        'T_INT_W': ['CV', 'CW'],
        'T_INT_E': ['CV', 'CE']
      };
      const segs = cornerMap[c] || ['N', 'W'];
      segs.forEach(s => {
        if (!currentSegs.includes(s)) currentSegs.push(s);
        this.setSegmentStyle(x, y, s);
      });
      changed = true;
    } else {
      // Colocar pared, puerta o ventana en el lateral o centro
      let codeToPlace = this.hoverSubEdge;
      if (this.selectedTile === 'accessories') {
        codeToPlace = (this.selectedAccessory === 'window' ? 'W' : 'D') + this.hoverSubEdge;
      } else if (this.selectedTile === 'door' || (typeof this.selectedTile === 'number' && this.selectedTile >= 2)) {
        codeToPlace = 'D' + this.hoverSubEdge;
      } else if (this.selectedTile === 'window') {
        codeToPlace = 'W' + this.hoverSubEdge;
      }

      // Las puertas no están permitidas en paredes centradas (CH/CV): el motor 3D
      // las abre incorrectamente al tratarse de un eje que divide la celda por la mitad.
      if (codeToPlace.startsWith('D') && (this.hoverSubEdge === 'CH' || this.hoverSubEdge === 'CV')) {
        this.showToast('🚫 No se pueden colocar puertas en paredes centradas');
        return;
      }

      // Limpiar cualquier pared, puerta o ventana previa en este mismo borde
      const baseEdge = codeToPlace.replace(/^[DW]/, '');
      const conflicts = [baseEdge, 'D' + baseEdge, 'W' + baseEdge];
      conflicts.forEach(c => {
        const idx = currentSegs.indexOf(c);
        if (idx !== -1) {
          currentSegs.splice(idx, 1);
          this.clearSegmentStyle(x, y, c);
          if (c.startsWith('D')) this.clearSegmentStyle(x, y, c + '_lintel');
        }
      });

      currentSegs.push(codeToPlace);
      this.setSegmentStyle(x, y, codeToPlace);
      // Las puertas son más bajas que las paredes: el hueco de pared que queda por
      // encima (el "dintel") se etiqueta con el pincel de DINTEL activo en ese momento.
      if (codeToPlace.startsWith('D')) {
        this.setSegmentStyle(x, y, codeToPlace + '_lintel');
      }
      changed = true;
    }

    if (changed) {
      this.updateJSON();
    }
  }

  /**
   * Crea una habitación rectangular con tabiques finos exteriores y esquinas limpias
   */
  createRoom(start, end) {
    const x1 = Math.min(start.x, end.x);
    const x2 = Math.max(start.x, end.x);
    const y1 = Math.min(start.y, end.y);
    const y2 = Math.max(start.y, end.y);

    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        const segs = [];
        if (y === y1) segs.push('N');
        if (y === y2) segs.push('S');
        if (x === x1) segs.push('W');
        if (x === x2) segs.push('E');
        this.grid[y][x] = segs;
        this.clearCellStyles(x, y);
        segs.forEach(s => this.setSegmentStyle(x, y, s));
      }
    }
  }

  resizeGrid(newCols, newRows) {
    const oldCols = this.cols;
    const oldRows = this.rows;
    const newGrid = [];

    for (let y = 0; y < newRows; y++) {
      const row = [];
      for (let x = 0; x < newCols; x++) {
        if (y < oldRows && x < oldCols) {
          const val = this.grid[y][x];
          row.push(Array.isArray(val) ? [...val] : (val === 1 ? ['N', 'S', 'E', 'W'] : []));
        } else {
          const segs = [];
          if (y === 0) segs.push('N');
          if (y === newRows - 1) segs.push('S');
          if (x === 0) segs.push('W');
          if (x === newCols - 1) segs.push('E');
          row.push(segs);
        }
      }
      newGrid.push(row);
    }

    this.cols = newCols;
    this.rows = newRows;
    this.grid = newGrid;

    if (this.inputCols) this.inputCols.value = newCols;
    if (this.inputRows) this.inputRows.value = newRows;

    // Ajustar jugador si quedó fuera
    if (this.player.x >= this.cols) this.player.x = this.cols / 2;
    if (this.player.y >= this.rows) this.player.y = this.rows / 2;

    this.resizeCanvas();
    this.render();
    this.updateJSON();
    this.showToast(`✅ Mapa redimensionado a ${newCols}x${newRows}`);
  }

  /**
   * Crea una nueva sala limpia con tabiques finos perimetrales (5x1), esquinas y 4 puertas
   */
  createNewRoomOfSize(newCols, newRows) {
    this.cols = newCols;
    this.rows = newRows;
    this.grid = [];
    this.wallStyleMap = {};

    for (let y = 0; y < this.rows; y++) {
      const row = [];
      for (let x = 0; x < this.cols; x++) {
        const segs = [];
        if (y === 0) segs.push('N');
        if (y === this.rows - 1) segs.push('S');
        if (x === 0) segs.push('W');
        if (x === this.cols - 1) segs.push('E');
        row.push(segs);
      }
      this.grid.push(row);
    }

    // Puertas en los centros
    const midX = Math.floor(this.cols / 2);
    const midY = Math.floor(this.rows / 2);
    this.grid[0][midX] = ['DN']; // Norte
    this.grid[midY][this.cols - 1] = ['DE']; // Este
    this.grid[this.rows - 1][midX] = ['DS']; // Sur
    this.grid[midY][0] = ['DW']; // Oeste

    this.player.x = midX + 0.5;
    this.player.y = midY + 0.5;

    if (this.inputCols) this.inputCols.value = newCols;
    if (this.inputRows) this.inputRows.value = newRows;

    this.resizeCanvas();
    this.render();
    this.updateJSON();
    this.showToast(`✨ Sala limpia de ${newCols}x${newRows} con paredes y esquinas finas creada`);
  }

  clearMap() {
    this.wallStyleMap = {};
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const segs = [];
        if (y === 0) segs.push('N');
        if (y === this.rows - 1) segs.push('S');
        if (x === 0) segs.push('W');
        if (x === this.cols - 1) segs.push('E');
        this.grid[y][x] = segs;
      }
    }
    this.render();
    this.updateJSON();
    this.showToast('Mapa vaciado (paredes perimetrales conservadas)');
  }

  applyPreset(presetName) {
    this.wallStyleMap = {};
    if (presetName === '4doors') {
      this.cols = 7;
      this.rows = 7;
      this.inputCols.value = 7;
      this.inputRows.value = 7;
      if (this.inputMapName) this.inputMapName.value = 'Sala 4 Puertas (7x7)';
      this.initDefaultMap();
    } else if (presetName === 'twoRooms') {
      this.cols = 14;
      this.rows = 8;
      this.inputCols.value = 14;
      this.inputRows.value = 8;
      if (this.inputMapName) this.inputMapName.value = '2 Habitaciones Conectadas (14x8)';
      this.grid = [];
      for (let y = 0; y < this.rows; y++) {
        const row = [];
        for (let x = 0; x < this.cols; x++) {
          const segs = [];
          if (y === 0) segs.push('N');
          if (y === this.rows - 1) segs.push('S');
          if (x === 0) segs.push('W');
          if (x === this.cols - 1) segs.push('E');
          if (x === 6) {
            if (y === 3) segs.push('DE'); // Puerta divisoria entre salas
            else segs.push('E'); // Muro divisor
          }
          row.push(segs);
        }
        this.grid.push(row);
      }
      this.player = { x: 2.5, y: 3.5, angle: 0 };
    } else if (presetName === 'maze') {
      this.cols = 11;
      this.rows = 11;
      this.inputCols.value = 11;
      this.inputRows.value = 11;
      if (this.inputMapName) this.inputMapName.value = 'Mini Laberinto (11x11)';
      this.grid = [];
      for (let y = 0; y < this.rows; y++) {
        const row = [];
        for (let x = 0; x < this.cols; x++) {
          const segs = [];
          if (y === 0) segs.push('N');
          if (y === this.rows - 1) segs.push('S');
          if (x === 0) segs.push('W');
          if (x === this.cols - 1) segs.push('E');
          // Laberinto con tabiques interiores
          if ((x % 2 === 0 && y % 2 === 0) && x > 1 && x < 9 && y > 1 && y < 9) {
            segs.push('CH');
            segs.push('CV');
          }
          row.push(segs);
        }
        this.grid.push(row);
      }
      this.grid[0][5] = ['DN'];
      this.player = { x: 1.5, y: 1.5, angle: 0 };
    }

    this.resizeCanvas();
    this.render();
    this.updateJSON();
    this.showToast(`Plantilla "${presetName}" cargada`);
  }

  drawDoorBadge(ctx, bx, by, iconType, color, cs) {
    const r = Math.floor(cs * 0.24);
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15, 18, 25, 0.94)';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (iconType === 'door') {
      // Icono vectorial limpio de puerta
      const dw = Math.floor(cs * 0.18);
      const dh = Math.floor(cs * 0.28);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.3;
      ctx.strokeRect(bx - dw / 2, by - dh / 2, dw, dh);
      // Pomo dorado
      ctx.fillStyle = '#f39c12';
      ctx.beginPath();
      ctx.arc(bx + dw / 4, by, 1.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (iconType === 'window') {
      // Icono vectorial limpio de ventana con cruceta
      const sz = Math.floor(cs * 0.22);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.3;
      ctx.strokeRect(bx - sz / 2, by - sz / 2, sz, sz);
      ctx.beginPath();
      ctx.moveTo(bx, by - sz / 2);
      ctx.lineTo(bx, by + sz / 2);
      ctx.moveTo(bx - sz / 2, by);
      ctx.lineTo(bx + sz / 2, by);
      ctx.strokeStyle = 'rgba(84, 160, 255, 0.95)';
      ctx.stroke();
    } else {
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.floor(cs * 0.22)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(iconType, bx, by + 1);
    }
  }

  /**
   * Dibuja toda la cuadrícula, tabiques finos (5x1) en laterales/centro, esquinas y previsualizaciones
   */
  render() {
    const ctx = this.ctx;
    const cs = this.cellSize;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const accessoryConfig = {
      'DN': { bg: '#e5a93b', icon: 'door', border: '#f39c12' },
      'DE': { bg: '#e5a93b', icon: 'door', border: '#f39c12' },
      'DS': { bg: '#e5a93b', icon: 'door', border: '#f39c12' },
      'DW': { bg: '#e5a93b', icon: 'door', border: '#f39c12' },
      'WN': { bg: '#54a0ff', icon: 'window', border: '#2e86de' },
      'WE': { bg: '#54a0ff', icon: 'window', border: '#2e86de' },
      'WS': { bg: '#54a0ff', icon: 'window', border: '#2e86de' },
      'WW': { bg: '#54a0ff', icon: 'window', border: '#2e86de' },
      'WCH': { bg: '#54a0ff', icon: 'window', border: '#2e86de' },
      'WCV': { bg: '#54a0ff', icon: 'window', border: '#2e86de' }
    };

    const th = Math.max(4, Math.floor(cs * 0.22));

    // Dibujar celdas
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const px = x * cs;
        const py = y * cs;

        // Suelo base oscuro
        ctx.fillStyle = '#11151f';
        ctx.fillRect(px, py, cs, cs);

        // Líneas sutiles de la cuadrícula
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px, py, cs, cs);

        // Obtener segmentos de la celda
        let cell = this.grid[y][x];
        let segs = [];
        if (Array.isArray(cell)) {
          segs = cell;
        } else if (cell === 1) {
          segs = ['N', 'S', 'E', 'W'];
        } else if (cell === 2) segs = ['DN'];
        else if (cell === 3) segs = ['DE'];
        else if (cell === 4) segs = ['DS'];
        else if (cell === 5) segs = ['DW'];

        // Dibujar cada segmento fino en su lateral o centro
        const cellStyleEntry = this.wallStyleMap[`${x},${y}`];
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i];
          const acc = accessoryConfig[s];
          const segStyle = (cellStyleEntry && cellStyleEntry[s]) || 'castillo';
          let wallColor = WALL_STYLE_COLORS[segStyle] || WALL_STYLE_COLORS.castillo;
          let badgeBorder = acc ? acc.border : null;
          if (acc) {
            wallColor = acc.bg;
            if (s.startsWith('D')) badgeBorder = DOOR_STYLE_COLORS[segStyle] || DOOR_STYLE_COLORS.castillo;
          }

          ctx.fillStyle = wallColor;

          switch (s) {
            case 'N':
            case 'DN':
            case 'WN':
              ctx.fillRect(px, py, cs, th);
              if (acc) this.drawDoorBadge(ctx, px + cs / 2, py + th / 2, acc.icon, badgeBorder, cs);
              break;
            case 'S':
            case 'DS':
            case 'WS':
              ctx.fillRect(px, py + cs - th, cs, th);
              if (acc) this.drawDoorBadge(ctx, px + cs / 2, py + cs - th / 2, acc.icon, badgeBorder, cs);
              break;
            case 'W':
            case 'DW':
            case 'WW':
              ctx.fillRect(px, py, th, cs);
              if (acc) this.drawDoorBadge(ctx, px + th / 2, py + cs / 2, acc.icon, badgeBorder, cs);
              break;
            case 'E':
            case 'DE':
            case 'WE':
              ctx.fillRect(px + cs - th, py, th, cs);
              if (acc) this.drawDoorBadge(ctx, px + cs - th / 2, py + cs / 2, acc.icon, badgeBorder, cs);
              break;
            case 'CH':
            case 'WCH': {
              const cy0 = py + Math.floor((cs - th) / 2);
              ctx.fillRect(px, cy0, cs, th);
              if (acc) this.drawDoorBadge(ctx, px + cs / 2, py + cs / 2, acc.icon, badgeBorder, cs);
              break;
            }
            case 'CV':
            case 'WCV': {
              const cx0 = px + Math.floor((cs - th) / 2);
              ctx.fillRect(cx0, py, th, cs);
              if (acc) this.drawDoorBadge(ctx, px + cs / 2, py + cs / 2, acc.icon, badgeBorder, cs);
              break;
            }
            case 'CN': {
              const cx0 = px + Math.floor((cs - th) / 2);
              const cy1 = py + Math.floor((cs - th) / 2) + th;
              ctx.fillRect(cx0, py, th, cy1 - py);
              break;
            }
            case 'CS': {
              const cx0 = px + Math.floor((cs - th) / 2);
              const cy0 = py + Math.floor((cs - th) / 2);
              ctx.fillRect(cx0, cy0, th, (py + cs) - cy0);
              break;
            }
            case 'CW': {
              const cx1 = px + Math.floor((cs - th) / 2) + th;
              const cy0 = py + Math.floor((cs - th) / 2);
              ctx.fillRect(px, cy0, cx1 - px, th);
              break;
            }
            case 'CE': {
              const cx0 = px + Math.floor((cs - th) / 2);
              const cy0 = py + Math.floor((cs - th) / 2);
              ctx.fillRect(cx0, cy0, (px + cs) - cx0, th);
              break;
            }
            case 'RNW': {
              ctx.fillRect(px, py, th, th);
              break;
            }
            case 'RNE': {
              ctx.fillRect(px + cs - th, py, th, th);
              break;
            }
            case 'RSW': {
              ctx.fillRect(px, py + cs - th, th, th);
              break;
            }
            case 'RSE': {
              ctx.fillRect(px + cs - th, py + cs - th, th, th);
              break;
            }
          }
        }
      }
    }

    // Previsualización de herramienta Habitación
    if (this.currentTool === 'room' && this.isMouseDown && this.roomStart && this.hoverCell.x >= 0) {
      const x1 = Math.min(this.roomStart.x, this.hoverCell.x);
      const x2 = Math.max(this.roomStart.x, this.hoverCell.x);
      const y1 = Math.min(this.roomStart.y, this.hoverCell.y);
      const y2 = Math.max(this.roomStart.y, this.hoverCell.y);

      ctx.fillStyle = 'rgba(79, 163, 227, 0.2)';
      ctx.fillRect(x1 * cs, y1 * cs, (x2 - x1 + 1) * cs, (y2 - y1 + 1) * cs);
      ctx.strokeStyle = '#4fa3e3';
      ctx.lineWidth = 2;
      ctx.strokeRect(x1 * cs, y1 * cs, (x2 - x1 + 1) * cs, (y2 - y1 + 1) * cs);
    }

    // Previsualización interactiva del lateral/centro bajo el cursor
    if (this.hoverCell.x >= 0 && this.hoverCell.x < this.cols && this.hoverCell.y >= 0 && this.hoverCell.y < this.rows) {
      const hpx = this.hoverCell.x * cs;
      const hpy = this.hoverCell.y * cs;

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(hpx, hpy, cs, cs);

      if (this.currentTool === 'brush') {
        if (this.selectedTile === 'accessories') {
          ctx.fillStyle = (this.selectedAccessory === 'door') ? 'rgba(229, 169, 59, 0.8)' : 'rgba(84, 160, 255, 0.8)';
        } else if (this.selectedTile === 'door' || (typeof this.selectedTile === 'number' && this.selectedTile >= 2)) {
          ctx.fillStyle = 'rgba(229, 169, 59, 0.8)';
        } else if (this.selectedTile === 'window') {
          ctx.fillStyle = 'rgba(84, 160, 255, 0.8)';
        } else {
          ctx.fillStyle = 'rgba(79, 163, 227, 0.8)';
        }

        if (this.hoverSubEdge.startsWith('corner_')) {
          const c = this.hoverSubEdge.replace('corner_', '');
          const hcx0 = hpx + Math.floor((cs - th) / 2);
          const hcx1 = hcx0 + th;
          const hcy0 = hpy + Math.floor((cs - th) / 2);
          const hcy1 = hcy0 + th;

          if (c === 'FULL_BOX') {
            ctx.fillRect(hpx, hpy, cs, th);
            ctx.fillRect(hpx, hpy + cs - th, cs, th);
            ctx.fillRect(hpx, hpy, th, cs);
            ctx.fillRect(hpx + cs - th, hpy, th, cs);
          }
          else if (c === 'NW') { ctx.fillRect(hpx, hpy, cs, th); ctx.fillRect(hpx, hpy, th, cs); }
          else if (c === 'NE') { ctx.fillRect(hpx, hpy, cs, th); ctx.fillRect(hpx + cs - th, hpy, th, cs); }
          else if (c === 'SW') { ctx.fillRect(hpx, hpy + cs - th, cs, th); ctx.fillRect(hpx, hpy, th, cs); }
          else if (c === 'SE') { ctx.fillRect(hpx, hpy + cs - th, cs, th); ctx.fillRect(hpx + cs - th, hpy, th, cs); }
          else if (c === 'CH_W' || c === 'CH_W_full') { ctx.fillRect(hpx, hcy0, cs, th); ctx.fillRect(hpx, hpy, th, cs); }
          else if (c === 'CH_E' || c === 'CH_E_full') { ctx.fillRect(hpx, hcy0, cs, th); ctx.fillRect(hpx + cs - th, hpy, th, cs); }
          else if (c === 'CV_N') { ctx.fillRect(hcx0, hpy, th, cs); ctx.fillRect(hpx, hpy, cs, th); }
          else if (c === 'CV_S') { ctx.fillRect(hcx0, hpy, th, cs); ctx.fillRect(hpx, hpy + cs - th, cs, th); }
          else if (c === 'CENTER_CROSS') { ctx.fillRect(hpx, hcy0, cs, th); ctx.fillRect(hcx0, hpy, th, cs); }
          else if (c === 'CENTER_NW') {
            ctx.fillRect(hcx0, hpy, th, hcy1 - hpy);
            ctx.fillRect(hpx, hcy0, hcx1 - hpx, th);
          }
          else if (c === 'CENTER_NE') {
            ctx.fillRect(hcx0, hpy, th, hcy1 - hpy);
            ctx.fillRect(hcx0, hcy0, (hpx + cs) - hcx0, th);
          }
          else if (c === 'CENTER_SW') {
            ctx.fillRect(hcx0, hcy0, th, (hpy + cs) - hcy0);
            ctx.fillRect(hpx, hcy0, hcx1 - hpx, th);
          }
          else if (c === 'CENTER_SE') {
            ctx.fillRect(hcx0, hcy0, th, (hpy + cs) - hcy0);
            ctx.fillRect(hcx0, hcy0, (hpx + cs) - hcx0, th);
          }
          else if (c === 'T_INT_N') {
            ctx.fillRect(hpx, hcy0, cs, th);
            ctx.fillRect(hcx0, hpy, th, hcy1 - hpy);
          }
          else if (c === 'T_INT_S') {
            ctx.fillRect(hpx, hcy0, cs, th);
            ctx.fillRect(hcx0, hcy0, th, (hpy + cs) - hcy0);
          }
          else if (c === 'T_INT_W') {
            ctx.fillRect(hcx0, hpy, th, cs);
            ctx.fillRect(hpx, hcy0, hcx1 - hpx, th);
          }
          else if (c === 'T_INT_E') {
            ctx.fillRect(hcx0, hpy, th, cs);
            ctx.fillRect(hcx0, hcy0, (hpx + cs) - hcx0, th);
          }
        } else if (this.hoverSubEdge === 'empty') {
          ctx.strokeStyle = '#e74c3c';
          ctx.lineWidth = 2;
          ctx.strokeRect(hpx + 3, hpy + 3, cs - 6, cs - 6);
        } else {
          const hcx0 = hpx + Math.floor((cs - th) / 2);
          const hcx1 = hcx0 + th;
          const hcy0 = hpy + Math.floor((cs - th) / 2);
          const hcy1 = hcy0 + th;

          switch (this.hoverSubEdge) {
            case 'N': ctx.fillRect(hpx, hpy, cs, th); break;
            case 'S': ctx.fillRect(hpx, hpy + cs - th, cs, th); break;
            case 'W': ctx.fillRect(hpx, hpy, th, cs); break;
            case 'E': ctx.fillRect(hpx + cs - th, hpy, th, cs); break;
            case 'CH': ctx.fillRect(hpx, hcy0, cs, th); break;
            case 'CV': ctx.fillRect(hcx0, hpy, th, cs); break;
            case 'CN': ctx.fillRect(hcx0, hpy, th, hcy1 - hpy); break;
            case 'CS': ctx.fillRect(hcx0, hcy0, th, (hpy + cs) - hcy0); break;
            case 'CW': ctx.fillRect(hpx, hcy0, hcx1 - hpx, th); break;
            case 'CE': ctx.fillRect(hcx0, hcy0, (hpx + cs) - hcx0, th); break;
            case 'RNW': ctx.fillRect(hpx, hpy, th, th); break;
            case 'RNE': ctx.fillRect(hpx + cs - th, hpy, th, th); break;
            case 'RSW': ctx.fillRect(hpx, hpy + cs - th, th, th); break;
            case 'RSE': ctx.fillRect(hpx + cs - th, hpy + cs - th, th, th); break;
          }
        }
      } else if (this.currentTool === 'eraser') {
        // Previsualización de borrado en color rojo
        ctx.fillStyle = 'rgba(231, 76, 60, 0.85)';
        ctx.strokeStyle = 'rgba(231, 76, 60, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(hpx + 1, hpy + 1, cs - 2, cs - 2);

        const hcx0 = hpx + Math.floor((cs - th) / 2);
        const hcx1 = hcx0 + th;
        const hcy0 = hpy + Math.floor((cs - th) / 2);
        const hcy1 = hcy0 + th;

        switch (this.hoverSubEdge) {
          case 'N': ctx.fillRect(hpx, hpy, cs, th); break;
          case 'S': ctx.fillRect(hpx, hpy + cs - th, cs, th); break;
          case 'W': ctx.fillRect(hpx, hpy, th, cs); break;
          case 'E': ctx.fillRect(hpx + cs - th, hpy, th, cs); break;
          case 'CH': ctx.fillRect(hpx, hcy0, cs, th); break;
          case 'CV': ctx.fillRect(hcx0, hpy, th, cs); break;
          case 'CN': ctx.fillRect(hcx0, hpy, th, hcy1 - hpy); break;
          case 'CS': ctx.fillRect(hcx0, hcy0, th, (hpy + cs) - hcy0); break;
          case 'CW': ctx.fillRect(hpx, hcy0, hcx1 - hpx, th); break;
          case 'CE': ctx.fillRect(hcx0, hcy0, (hpx + cs) - hcx0, th); break;
          case 'RNW': ctx.fillRect(hpx, hpy, th, th); break;
          case 'RNE': ctx.fillRect(hpx + cs - th, hpy, th, th); break;
          case 'RSW': ctx.fillRect(hpx, hpy + cs - th, th, th); break;
          case 'RSE': ctx.fillRect(hpx + cs - th, hpy + cs - th, th, th); break;
          default: break;
        }
      }
    }

    // Dibujar Jugador
    const pPx = this.player.x * cs;
    const pPy = this.player.y * cs;

    // Resplandor del jugador
    ctx.beginPath();
    ctx.arc(pPx, pPy, cs * 0.38, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 210, 211, 0.25)';
    ctx.fill();

    // Punto central del jugador
    ctx.beginPath();
    ctx.arc(pPx, pPy, cs * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = '#00d2d3';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Flecha de orientación del jugador
    const arrowLen = cs * 0.45;
    const endX = pPx + Math.cos(this.player.angle) * arrowLen;
    const endY = pPy + Math.sin(this.player.angle) * arrowLen;
    ctx.beginPath();
    ctx.moveTo(pPx, pPy);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Actualizar texto de estadísticas
    this.mapStats.textContent = `Dimensiones: ${this.cols}x${this.rows} • Jugador: (X: ${this.player.x.toFixed(1)}, Y: ${this.player.y.toFixed(1)})`;
  }

  /**
   * Genera el objeto JSON del nivel
   */
  getLevelObject() {
    const mapName = (this.inputMapName && this.inputMapName.value.trim()) ? this.inputMapName.value.trim() : 'Laberinto Personalizado';
    const level = {
      name: mapName,
      width: this.cols,
      height: this.rows,
      playerStart: {
        x: Number(this.player.x.toFixed(2)),
        y: Number(this.player.y.toFixed(2)),
        angle: 0
      },
      legend: {
        0: 'Suelo libre / pasillo',
        1: 'Pared de piedra (N, S, E, W, CH, CV, etc.)',
        'DN, DS, DE, DW': 'Puertas (no permitidas en ejes centrales CH/CV)',
        'WN, WS, WE, WW, WCH, WCV': 'Ventanas'
      },
      map: this.grid
    };
    if (Object.keys(this.customTextures).length > 0) {
      level.customTextures = this.customTextures;
    }
    // Estilo con el que se pintó cada segmento (persiste por pared/puerta, no es global)
    if (Object.keys(this.wallStyleMap).length > 0) {
      level.wallStyleMap = this.wallStyleMap;
    }
    // Pincel activo en el editor (solo afecta a lo próximo que se coloque)
    if (this.wallStyle !== 'castillo') level.activeWallStyle = this.wallStyle;
    if (this.doorStyle !== 'castillo') level.activeDoorStyle = this.doorStyle;
    if (this.lintelStyle !== 'castillo') level.activeLintelStyle = this.lintelStyle;
    return level;
  }

  updateJSON() {
    const data = this.getLevelObject();
    this.jsonOutput.value = JSON.stringify(data, null, 2);
    try {
      localStorage.setItem('customRaycasterMap', JSON.stringify(data));
    } catch (e) {
      console.warn('Error al guardar el mapa en localStorage:', e);
    }
  }

  /**
   * Ajusta visualmente el estado colapsado o expandido de la barra lateral JSON
   */
  setJsonSidebarCollapsed(collapsed) {
    const workspace = document.querySelector('.workspace');
    const jsonSidebar = document.getElementById('jsonSidebar');
    const iconToggleJson = document.getElementById('iconToggleJson');
    const btnToggleJsonSidebar = document.getElementById('btnToggleJsonSidebar');
    if (!workspace || !jsonSidebar) return;

    if (collapsed) {
      workspace.classList.add('json-collapsed');
      jsonSidebar.classList.add('collapsed');
      if (iconToggleJson) iconToggleJson.className = 'ri-arrow-left-s-line';
      if (btnToggleJsonSidebar) btnToggleJsonSidebar.title = 'Descolapsar panel JSON';
    } else {
      workspace.classList.remove('json-collapsed');
      jsonSidebar.classList.remove('collapsed');
      if (iconToggleJson) iconToggleJson.className = 'ri-arrow-right-s-line';
      if (btnToggleJsonSidebar) btnToggleJsonSidebar.title = 'Colapsar panel JSON (40px)';
    }
  }

  /**
   * Guarda el estado de la UI (acordeones colapsados, panel json, herramienta activa, paleta, zoom)
   */
  saveUIState() {
    try {
      const collapsedSections = [];
      document.querySelectorAll('.tool-section').forEach(sec => {
        if (sec.id && sec.classList.contains('collapsed')) {
          collapsedSections.push(sec.id);
        }
      });

      const workspace = document.querySelector('.workspace');
      const isJsonCollapsed = workspace ? workspace.classList.contains('json-collapsed') : false;

      const activeTabEl = document.querySelector('.wall-cat-tab.active');
      const activeWallTab = activeTabEl ? activeTabEl.dataset.tab : 'laterales';

      const state = {
        collapsedSections,
        jsonSidebarCollapsed: isJsonCollapsed,
        currentTool: this.currentTool,
        selectedTile: this.selectedTile,
        selectedAccessory: this.selectedAccessory,
        placementMode: this.placementMode,
        activeWallTab,
        zoomMode: this.zoomMode,
        cellSize: this.cellSize
      };

      localStorage.setItem('levelEditor_uiState', JSON.stringify(state));
    } catch (e) {
      console.warn('Error al guardar estado de UI en localStorage:', e);
    }
  }

  /**
   * Restaura el estado de la UI desde localStorage
   */
  restoreUIState() {
    try {
      const saved = localStorage.getItem('levelEditor_uiState');
      if (!saved) return;
      const state = JSON.parse(saved);

      // 1. Restaurar secciones colapsadas del menú
      if (Array.isArray(state.collapsedSections)) {
        document.querySelectorAll('.tool-section').forEach(sec => {
          if (sec.id) {
            sec.classList.toggle('collapsed', state.collapsedSections.includes(sec.id));
          }
        });
      }

      // 2. Restaurar estado de JSON sidebar
      if (typeof state.jsonSidebarCollapsed === 'boolean') {
        this.setJsonSidebarCollapsed(state.jsonSidebarCollapsed);
      }

      // 3. Restaurar herramienta actual (brush, room, eraser)
      if (state.currentTool) {
        this.currentTool = state.currentTool;
        document.querySelectorAll('.tool-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.tool === state.currentTool);
        });
      }

      // 4. Restaurar elemento seleccionado (Pared, Accesorios, Suelo, Jugador)
      if (state.selectedTile !== undefined) {
        const radio = document.querySelector(`input[name="tileSelect"][value="${state.selectedTile}"]`);
        if (radio) {
          radio.checked = true;
          document.querySelectorAll('.palette-item').forEach(p => p.classList.remove('active'));
          radio.closest('.palette-item')?.classList.add('active');
          this.selectedTile = (state.selectedTile === 'player' || state.selectedTile === 'accessories')
            ? state.selectedTile
            : parseInt(state.selectedTile, 10);

          const sectionWallPlacement = document.getElementById('sectionWallPlacement');
          const sectionAccessoryPlacement = document.getElementById('sectionAccessoryPlacement');

          if (sectionWallPlacement) {
            sectionWallPlacement.style.display = (state.selectedTile === '1' || state.selectedTile === 1) ? '' : 'none';
          }
          if (sectionAccessoryPlacement) {
            sectionAccessoryPlacement.style.display = (state.selectedTile === 'accessories') ? '' : 'none';
          }
        }
      }

      // 5. Restaurar pestaña activa de colocación de paredes (laterales, centro)
      const validWallTab = (state.activeWallTab === 'centro') ? 'centro' : 'laterales';
      const tabBtn = document.querySelector(`.wall-cat-tab[data-tab="${validWallTab}"]`);
      if (tabBtn) {
        document.querySelectorAll('.wall-cat-tab').forEach(t => t.classList.remove('active'));
        tabBtn.classList.add('active');
        const pLaterales = document.getElementById('panelLaterales');
        const pCentro = document.getElementById('panelCentro');
        if (pLaterales) pLaterales.classList.toggle('hidden', validWallTab !== 'laterales');
        if (pCentro) pCentro.classList.toggle('hidden', validWallTab !== 'centro');
      }

      // 6. Restaurar modo específico de pared (placementMode)
      const validModes = ['N', 'S', 'W', 'E', 'CH', 'CV', 'CN', 'CS', 'CW', 'CE', 'RNW', 'RNE', 'RSW', 'RSE', 'empty'];
      const modeToRestore = validModes.includes(state.placementMode) ? state.placementMode : 'N';
      this.placementMode = modeToRestore;
      document.querySelectorAll('.wall-tile-btn, .wall-aux-btn').forEach(b => {
        if (modeToRestore === 'empty' && b.dataset.action === 'select-floor') {
          b.classList.add('active');
        } else if (b.dataset.mode === modeToRestore) {
          b.classList.add('active');
        } else {
          b.classList.remove('active');
        }
      });

      // 7. Restaurar accesorio seleccionado
      if (state.selectedAccessory) {
        this.selectedAccessory = state.selectedAccessory;
        document.querySelectorAll('.accessory-tile-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.accessory === state.selectedAccessory);
        });
      }

      // 8. Restaurar Zoom
      if (state.zoomMode) {
        this.zoomMode = state.zoomMode;
        if (state.cellSize && state.zoomMode === 'manual') {
          this.cellSize = state.cellSize;
        }
      }
    } catch (e) {
      console.warn('Error al restaurar estado de UI:', e);
    }
  }

  copyJson() {
    this.updateJSON();
    navigator.clipboard.writeText(this.jsonOutput.value).then(() => {
      this.showToast('¡JSON copiado al portapapeles!');
    }).catch(() => {
      this.showToast('Selecciona el texto y usa Ctrl+C');
    });
  }

  downloadJson() {
    this.updateJSON();
    const blob = new Blob([this.jsonOutput.value], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `laberinto_${this.cols}x${this.rows}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast('Archivo JSON descargado');
  }

  importFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        this.loadLevelData(data);
        this.showToast('¡Nivel cargado con éxito!');
      } catch (err) {
        alert('Error al leer el archivo JSON: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  applyManualJson() {
    try {
      const data = JSON.parse(this.jsonOutput.value);
      this.loadLevelData(data);
      this.showToast('Cambios del JSON aplicados');
    } catch (err) {
      alert('Sintaxis JSON inválida: ' + err.message);
    }
  }

  loadLevelData(data) {
    if (!data.map || !Array.isArray(data.map)) {
      throw new Error('El JSON debe contener una propiedad "map" con una matriz 2D.');
    }
    this.rows = data.map.length;
    this.cols = data.map[0].length;
    this.grid = data.map;

    if (data.playerStart) {
      this.player.x = (typeof data.playerStart.x === 'number') ? data.playerStart.x : 1.5;
      this.player.y = (typeof data.playerStart.y === 'number') ? data.playerStart.y : 1.5;
      this.player.angle = (typeof data.playerStart.angle === 'number') ? data.playerStart.angle : -Math.PI / 2;
    }

    if (this.inputCols) this.inputCols.value = this.cols;
    if (this.inputRows) this.inputRows.value = this.rows;
    if (data.name && this.inputMapName) {
      this.inputMapName.value = data.name;
    }

    this.customTextures = (data.customTextures && typeof data.customTextures === 'object') ? data.customTextures : {};
    this.renderTextureGrid();

    this.wallStyleMap = (data.wallStyleMap && typeof data.wallStyleMap === 'object') ? data.wallStyleMap : {};
    this.wallStyle = (data.activeWallStyle && WALL_STYLES[data.activeWallStyle]) ? data.activeWallStyle : 'castillo';
    this.doorStyle = (data.activeDoorStyle && DOOR_STYLES[data.activeDoorStyle]) ? data.activeDoorStyle : 'castillo';
    this.lintelStyle = (data.activeLintelStyle && WALL_STYLES[data.activeLintelStyle]) ? data.activeLintelStyle : 'castillo';
    this.updateStyleLabels();

    // Actualizar botones de chips de dimensiones rápidas
    document.querySelectorAll('.btn-chip').forEach(chip => {
      const c = parseInt(chip.dataset.cols, 10);
      const r = parseInt(chip.dataset.rows, 10);
      chip.classList.toggle('active', c === this.cols && r === this.rows);
    });

    const migrated = this.migrateCenteredDoors(this.grid);
    if (migrated) {
      this.showToast('ℹ️ Puertas centradas obsoletas convertidas en pared normal');
    }

    this.resizeCanvas();
    this.render();
    this.updateJSON();
  }

  /**
   * Guarda el nivel actual en localStorage y abre la demo en primera persona
   */
  playCurrentLevel() {
    const levelData = this.getLevelObject();
    localStorage.setItem('customRaycasterMap', JSON.stringify(levelData));
    this.saveUIState();
    this.showToast('Cargando nivel en el motor 3D...');
    setTimeout(() => {
      window.location.href = '../demo/index.html?custom=1';
    }, 300);
  }

  /**
   * Construye la cuadrícula de slots de texturas personalizadas y conecta
   * la subida/eliminación de imágenes (delegación de eventos en el contenedor)
   */
  setupTextureManager() {
    this.textureGridEl = document.getElementById('textureGrid');
    if (!this.textureGridEl) return;

    this.textureGridEl.innerHTML = TEXTURE_SLOTS.map(slot => `
      <div class="texture-slot" data-type="${slot.type}">
        <div class="texture-thumb" id="textureThumb-${slot.type}"></div>
        <div class="texture-slot-info">
          <strong>${slot.label}</strong>
          <div class="texture-slot-actions">
            <label class="texture-upload-btn">
              <i class="ri-upload-2-line"></i> Subir
              <input type="file" accept="image/*" data-type="${slot.type}" hidden>
            </label>
            <button class="texture-remove-btn" data-type="${slot.type}" hidden><i class="ri-close-line"></i> Quitar</button>
          </div>
        </div>
      </div>
    `).join('');

    this.textureGridEl.addEventListener('change', (e) => {
      const input = e.target.closest('input[type="file"]');
      if (!input || !input.files || !input.files[0]) return;
      const type = parseInt(input.dataset.type, 10);
      this.handleTextureUpload(type, input.files[0]);
      input.value = '';
    });

    this.textureGridEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.texture-remove-btn');
      if (!btn) return;
      this.removeCustomTexture(parseInt(btn.dataset.type, 10));
    });

    this.renderTextureGrid();
  }

  /**
   * Lee la imagen subida, la reescala a 64x64 (tamaño de textura del motor)
   * y la guarda como Data URL en this.customTextures
   */
  handleTextureUpload(type, file) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 64;
        const off = document.createElement('canvas');
        off.width = size;
        off.height = size;
        const octx = off.getContext('2d');
        octx.drawImage(img, 0, 0, size, size);
        this.customTextures[type] = off.toDataURL('image/png');
        this.renderTextureSlot(type);
        this.updateJSON();
        this.showToast('✅ Textura personalizada aplicada');
      };
      img.onerror = () => this.showToast('⚠️ No se pudo leer la imagen');
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  removeCustomTexture(type) {
    delete this.customTextures[type];
    this.renderTextureSlot(type);
    this.updateJSON();
    this.showToast('Textura personalizada eliminada');
  }

  renderTextureGrid() {
    if (!this.textureGridEl) return;
    TEXTURE_SLOTS.forEach(slot => this.renderTextureSlot(slot.type));
  }

  renderTextureSlot(type) {
    const slotEl = this.textureGridEl && this.textureGridEl.querySelector(`.texture-slot[data-type="${type}"]`);
    if (!slotEl) return;
    const thumbEl = slotEl.querySelector('.texture-thumb');
    const removeBtn = slotEl.querySelector('.texture-remove-btn');
    const dataUrl = this.customTextures[type];

    thumbEl.innerHTML = dataUrl ? `<img src="${dataUrl}" alt="">` : '';
    slotEl.classList.toggle('has-custom', !!dataUrl);
    if (removeBtn) removeBtn.hidden = !dataUrl;
  }

  /**
   * Conecta los botones "Estilo de Pared" / "Estilo de Puerta" con el modal
   * selector, que muestra miniaturas generadas en vivo desde src/engine/textures.js
   */
  setupStyleModals() {
    this.styleModalOverlay = document.getElementById('styleModalOverlay');
    this.styleModalTitle = document.getElementById('styleModalTitle');
    this.styleModalGrid = document.getElementById('styleModalGrid');
    if (!this.styleModalOverlay) return;

    document.getElementById('styleModalClose').addEventListener('click', () => this.closeStyleModal());
    this.styleModalOverlay.addEventListener('click', (e) => {
      if (e.target === this.styleModalOverlay) this.closeStyleModal();
    });

    const btnWallStyle = document.getElementById('btnWallStyle');
    const btnDoorStyle = document.getElementById('btnDoorStyle');
    const btnLintelStyle = document.getElementById('btnLintelStyle');
    if (btnWallStyle) btnWallStyle.addEventListener('click', () => this.openStyleModal('wall'));
    if (btnDoorStyle) btnDoorStyle.addEventListener('click', () => this.openStyleModal('door'));
    if (btnLintelStyle) btnLintelStyle.addEventListener('click', () => this.openStyleModal('lintel'));

    this.updateStyleLabels();
  }

  /**
   * Metadatos de cada "pincel" de estilo: catálogo de estilos que ofrece, en qué
   * propiedad de this se guarda el valor activo, cómo se llama en la UI y con qué
   * texto se construye la miniatura de puerta (solo aplica a kind === 'door').
   */
  _styleKindInfo(kind) {
    if (kind === 'wall') return { styles: WALL_STYLES, prop: 'wallStyle', label: 'Pared', isDoorKind: false };
    if (kind === 'lintel') return { styles: WALL_STYLES, prop: 'lintelStyle', label: 'Dintel', isDoorKind: false };
    return { styles: DOOR_STYLES, prop: 'doorStyle', label: 'Puerta', isDoorKind: true };
  }

  openStyleModal(kind) {
    this.styleModalKind = kind;
    const { styles, prop, label, isDoorKind } = this._styleKindInfo(kind);
    const current = this[prop];

    this.styleModalTitle.innerHTML = `<i class="ri-palette-line"></i> Estilo de ${label}`;
    this.styleModalGrid.innerHTML = Object.entries(styles).map(([key, def]) => `
      <button class="style-card ${key === current ? 'active' : ''}" data-style="${key}">
        <img src="${this.renderStylePreview(isDoorKind, def)}" alt="${def.label}">
        <span>${def.label}</span>
      </button>
    `).join('');

    this.styleModalGrid.querySelectorAll('.style-card').forEach(card => {
      card.addEventListener('click', () => this.selectStyle(kind, card.dataset.style));
    });

    this.styleModalOverlay.hidden = false;
  }

  /**
   * Dibuja una miniatura con la misma función procedural que usará el motor 3D
   * Puertas: 64x128 px (proporción 5:10). Paredes y dinteles: 64x192 px (proporción 5:15).
   */
  renderStylePreview(isDoorKind, styleDef) {
    const w = 64;
    const h = isDoorKind ? 128 : 192;
    const pixels = isDoorKind ? styleDef.door(w, h) : styleDef.wall(w, h);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(w, h);
    new Uint32Array(imgData.data.buffer).set(pixels);
    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL('image/png');
  }

  selectStyle(kind, styleKey) {
    const { styles, prop, label } = this._styleKindInfo(kind);
    this[prop] = styleKey;
    this.updateStyleLabels();
    this.closeStyleModal();
    this.updateJSON();
    this.showToast(`🖌️ Pincel de ${label.toLowerCase()}: ${styles[styleKey].label} (se aplicará a lo próximo que coloques)`);
  }

  closeStyleModal() {
    this.styleModalOverlay.hidden = true;
  }

  updateStyleLabels() {
    const wallLabelEl = document.getElementById('wallStyleLabel');
    const doorLabelEl = document.getElementById('doorStyleLabel');
    const lintelLabelEl = document.getElementById('lintelStyleLabel');
    if (wallLabelEl) wallLabelEl.textContent = WALL_STYLES[this.wallStyle].label;
    if (doorLabelEl) doorLabelEl.textContent = DOOR_STYLES[this.doorStyle].label;
    if (lintelLabelEl) lintelLabelEl.textContent = WALL_STYLES[this.lintelStyle].label;
  }

  showToast(msg) {
    this.toast.textContent = msg;
    this.toast.classList.add('show');
    setTimeout(() => {
      this.toast.classList.remove('show');
    }, 2400);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.editor = new LevelEditor();
});

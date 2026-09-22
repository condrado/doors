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

function getWallStyleColor(styleKey) {
  if (WALL_STYLE_COLORS[styleKey]) return WALL_STYLE_COLORS[styleKey];
  if (!styleKey) return WALL_STYLE_COLORS.castillo;
  if (styleKey.includes('cristal')) return '#38bdf8';
  if (styleKey.includes('blanca')) return '#f8fafc';
  if (styleKey.includes('negra')) return '#1e293b';
  let hash = 0;
  for (let i = 0; i < styleKey.length; i++) hash = styleKey.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 65%, 55%)`;
}

function getDoorStyleColor(styleKey) {
  if (DOOR_STYLE_COLORS[styleKey]) return DOOR_STYLE_COLORS[styleKey];
  if (!styleKey) return DOOR_STYLE_COLORS.castillo;
  let hash = 0;
  for (let i = 0; i < styleKey.length; i++) hash = styleKey.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 65%, 55%)`;
}

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
    this.tableType = 9; // código de celda de mesa activo (9=4patas, 15=sin patas, 16-21=variantes)
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
    this.toolsSidebar = document.querySelector('.sidebar.tools-sidebar');
    this.jsonSidebar = document.getElementById('jsonSidebar');
    this.jsonOutput = document.getElementById('jsonOutput');
    this.cursorCoords = document.getElementById('cursorCoords');
    this.mapStats = document.getElementById('mapStats');
    this.toast = document.getElementById('toastMessage');
    this.zoomLabel = document.getElementById('zoomLabel');
    this.inputCols = document.getElementById('inputCols');
    this.inputRows = document.getElementById('inputRows');
    this.inputMapName = document.getElementById('inputMapName');
    this.selectMapPreset = document.getElementById('selectMapPreset');
    this.lastMapBackup = null;
    this.previousPresetValue = 'custom';

    // Gestión de Proyectos y Multimapas
    this.projects = {};
    this.currentProjectId = null;
    this.currentProject = null;
    this.currentMapId = null;
    this.doorLinks = {};
    this.expandedMapId = null;

    this.headerProjectName = document.getElementById('headerProjectName');
    this.sidebarProjectName = document.getElementById('sidebarProjectName');
    this.selectActiveProject = document.getElementById('selectActiveProject');
    this.btnQuickNewProject = document.getElementById('btnQuickNewProject');
    this.btnOpenProjectsFromSidebar = document.getElementById('btnOpenProjectsFromSidebar');
    this.btnOpenProjectsFromHeader = document.getElementById('btnOpenProjectsFromHeader');
    this.selectActiveMap = document.getElementById('selectActiveMap');
    this.badgeStartingMap = document.getElementById('badgeStartingMap');
    this.iconStartingMap = document.getElementById('iconStartingMap');
    this.btnQuickNewMap = document.getElementById('btnQuickNewMap');
    this.btnManageMapsInModal = document.getElementById('btnManageMapsInModal');
    this.btnNewMapInProject = document.getElementById('btnNewMapInProject');
    this.btnDuplicateMap = document.getElementById('btnDuplicateMap');
    this.btnSetStartingMap = document.getElementById('btnSetStartingMap');
    this.btnDeleteMap = document.getElementById('btnDeleteMap');
    this.btnOpenDoorLinksModal = document.getElementById('btnOpenDoorLinksModal');

    // Elementos de la Modal de Proyectos y Salas
    this.projectModalOverlay = document.getElementById('projectModalOverlay');
    this.btnTabProjects = document.getElementById('btnTabProjects');
    this.btnTabMaps = document.getElementById('btnTabMaps');
    this.paneProjects = document.getElementById('paneProjects');
    this.paneMaps = document.getElementById('paneMaps');
    this.modalMapCountBadge = document.getElementById('modalMapCountBadge');
    this.modalActiveProjectBadge = document.getElementById('modalActiveProjectBadge');
    this.modalProjectNameMaps = document.getElementById('modalProjectNameMaps');
    this.modalMapListContainer = document.getElementById('modalMapListContainer');
    this.btnGenerateGameInModal = document.getElementById('btnGenerateGameInModal');
    this.btnAddNewMapFromModal = document.getElementById('btnAddNewMapFromModal');
    this.btnGenerateGame = document.getElementById('btnGenerateGame');
    this.modalActiveRoomNameDisplay = document.getElementById('modalActiveRoomNameDisplay');
    this.modalActiveRoomSpawnBadge = document.getElementById('modalActiveRoomSpawnBadge');

    this.doorLinkModalOverlay = document.getElementById('doorLinkModalOverlay');

    this.initProjectSystem();
    this.setupEventListeners();
    this.setupProjectEventListeners();
    this.setupDoorLinkEventListeners();
    this.setupTextureManager();
    this.setupStyleModals();
    this.setupMesaModal();
    this.setupConfirmModal();
    this.restoreUIState();
    this.updateToolPanelsVisibility();
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

  /**
   * Crea un objeto completo de mapa con sala base de 4 puertas
   */
  createDefaultMapObject(id, name, cols = 12, rows = 12) {
    const grid = [];
    for (let y = 0; y < rows; y++) {
      const row = [];
      for (let x = 0; x < cols; x++) {
        const segs = [];
        if (y === 0) segs.push('N');
        if (y === rows - 1) segs.push('S');
        if (x === 0) segs.push('W');
        if (x === cols - 1) segs.push('E');
        row.push(segs);
      }
      grid.push(row);
    }
    const midX = Math.floor(cols / 2);
    const midY = Math.floor(rows / 2);
    grid[0][midX] = ['DN'];
    grid[midY][cols - 1] = ['DE'];
    grid[rows - 1][midX] = ['DS'];
    grid[midY][0] = ['DW'];

    return {
      id: id,
      name: name,
      width: cols,
      height: rows,
      playerStart: { x: midX + 0.5, y: midY + 0.5, angle: -Math.PI / 2 },
      map: grid,
      wallStyleMap: {},
      customTextures: {},
      doorLinks: {},
      activeWallStyle: 'castillo',
      activeDoorStyle: 'castillo',
      activeLintelStyle: 'castillo'
    };
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
        this.updateToolPanelsVisibility();
        this.render();
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
    document.querySelectorAll('input[name="tileSelect"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        document.querySelectorAll('.palette-item').forEach(p => p.classList.remove('active'));
        e.target.closest('.palette-item').classList.add('active');
        const val = e.target.value;
        this.selectedTile = (val === 'player' || val === 'accessories' || val === 'door' || val === 'window' || val === 'table') ? val : parseInt(val, 10);
        this.updateToolPanelsVisibility();
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

    // Dimensiones del mapa: Botón Redimensionar con confirmación
    const triggerResize = () => {
      if (!this.inputCols || !this.inputRows) return;
      const newCols = parseInt(this.inputCols.value, 10);
      const newRows = parseInt(this.inputRows.value, 10);
      if (isNaN(newCols) || isNaN(newRows) || newCols < 5 || newRows < 5 || newCols > 50 || newRows > 50) {
        this.showToast('⚠️ Las dimensiones deben estar entre 5 y 50 celdas');
        return;
      }
      if (newCols === this.cols && newRows === this.rows) {
        this.showToast('ℹ️ El mapa ya tiene este tamaño');
        return;
      }

      const isShrinking = (newCols < this.cols || newRows < this.rows);
      const hasContent = this.hasMapContent();

      if (isShrinking && hasContent) {
        this.showConfirmDialog({
          title: '¿Redimensionar cuadrícula?',
          message: `El mapa se reducirá de ${this.cols}x${this.rows} a ${newCols}x${newRows}. Las paredes o elementos que queden fuera del nuevo tamaño se recortarán.`,
          acceptText: 'Redimensionar',
          isDanger: true,
          onAccept: () => {
            this.backupCurrentMap();
            this.resizeGrid(newCols, newRows);
          },
          onCancel: () => {
            if (this.inputCols) this.inputCols.value = this.cols;
            if (this.inputRows) this.inputRows.value = this.rows;
            document.querySelectorAll('#sectionMapConfig .btn-chip').forEach(chip => {
              const c = parseInt(chip.dataset.cols, 10);
              const r = parseInt(chip.dataset.rows, 10);
              chip.classList.toggle('active', c === this.cols && r === this.rows);
            });
          }
        });
      } else {
        this.backupCurrentMap();
        this.resizeGrid(newCols, newRows);
      }
    };

    // Quick size chips (si existen en el sidebar)
    if (this.inputCols && this.inputRows) {
      document.querySelectorAll('#sectionMapConfig .btn-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const c = parseInt(chip.dataset.cols, 10);
          const r = parseInt(chip.dataset.rows, 10);
          if (c === this.cols && r === this.rows) return;
          this.inputCols.value = c;
          this.inputRows.value = r;
          triggerResize();
        });
      });
    }

    const btnResizeMap = document.getElementById('btnResizeMap');
    if (btnResizeMap) {
      btnResizeMap.addEventListener('click', triggerResize);
    }

    // Permitir pulsar Enter en los inputs de ancho y alto si existen
    [this.inputCols, this.inputRows].filter(Boolean).forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          triggerResize();
        }
      });
    });

    // Campo de nombre del mapa
    if (this.inputMapName) {
      this.inputMapName.addEventListener('input', () => {
        if (this.currentProject && this.currentMapId && this.currentProject.maps[this.currentMapId]) {
          const newName = this.inputMapName.value.trim() || 'Sala';
          this.currentProject.maps[this.currentMapId].name = newName;
          if (this.modalActiveRoomNameDisplay) {
            this.modalActiveRoomNameDisplay.textContent = newName;
          }
          this.renderMapDropdown();
          const cardNameEl = document.querySelector(`.modal-map-card[data-map-id="${this.currentMapId}"] .modal-map-name`);
          if (cardNameEl) cardNameEl.textContent = newName;
        }
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

    // Selector de Plantillas Rápidas con Confirmación si hay contenido
    if (this.selectMapPreset) {
      this.previousPresetValue = this.selectMapPreset.value || 'custom';

      this.selectMapPreset.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'custom') {
          this.previousPresetValue = 'custom';
          return;
        }

        const presetLabels = {
          '4doors': '1. Sala 4 Puertas (7x7)',
          'twoRooms': '2. 2 Salas Conectadas (14x8)',
          'crossRooms': '3. 4 Habitaciones / Cruce (12x12)',
          'hallway': '4. Pasillo Central y Cámaras (15x9)',
          'maze': '5. Mini Laberinto (11x11)'
        };
        const label = presetLabels[val] || val;

        const hasContent = this.hasMapContent();
        if (hasContent) {
          this.showConfirmDialog({
            title: `¿Cargar plantilla?`,
            message: `Vas a cargar "${label}". Se reemplazará el mapa actual y se perderá lo que hayas dibujado.`,
            acceptText: 'Cargar Plantilla',
            isDanger: true,
            onAccept: () => {
              this.backupCurrentMap();
              this.previousPresetValue = val;
              this.applyPreset(val);
            },
            onCancel: () => {
              this.selectMapPreset.value = this.previousPresetValue || 'custom';
            }
          });
        } else {
          this.backupCurrentMap();
          this.previousPresetValue = val;
          this.applyPreset(val);
        }
      });
    }

    // Botón Vaciar Mapa con Confirmación
    const btnClearMap = document.getElementById('btnClearMap');
    if (btnClearMap) {
      btnClearMap.addEventListener('click', () => {
        this.showConfirmDialog({
          title: '¿Vaciar el mapa actual?',
          message: 'Se eliminarán todas las paredes, puertas y accesorios del interior conservando únicamente los muros perimetrales.',
          acceptText: 'Vaciar Todo',
          isDanger: true,
          onAccept: () => {
            this.backupCurrentMap();
            this.clearMap();
            this.showToast('🗑️ Mapa vaciado. (Pulsa Ctrl+Z si deseas deshacer)');
          }
        });
      });
    }

    // Atajo de teclado Ctrl+Z para deshacer vaciado / plantilla
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (this.lastMapBackup) {
          e.preventDefault();
          this.restoreBackupMap();
        }
      }
    });

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

    // Persistencia de scroll y estado al salir o hacer clic en Volver a Demo / Hub
    const btnBackToGame = document.getElementById('btnBackToGame');
    if (btnBackToGame) {
      btnBackToGame.addEventListener('click', () => this.saveUIState());
    }
    const btnBackToHub = document.getElementById('btnBackToHub');
    if (btnBackToHub) {
      btnBackToHub.addEventListener('click', () => this.saveUIState());
    }
    window.addEventListener('beforeunload', () => this.saveUIState());
    window.addEventListener('pagehide', () => this.saveUIState());

    // Guardado debounced de scroll para que no se pierda al navegar
    let scrollSaveTimeout = null;
    const debouncedSaveScroll = () => {
      if (scrollSaveTimeout) clearTimeout(scrollSaveTimeout);
      scrollSaveTimeout = setTimeout(() => {
        this.saveUIState();
      }, 150);
    };

    if (this.toolsSidebar) {
      this.toolsSidebar.addEventListener('scroll', debouncedSaveScroll, { passive: true });
    }
    if (this.canvasContainer) {
      this.canvasContainer.addEventListener('scroll', debouncedSaveScroll, { passive: true });
    }
    if (jsonSidebar) {
      jsonSidebar.addEventListener('scroll', debouncedSaveScroll, { passive: true });
    }
    window.addEventListener('scroll', debouncedSaveScroll, { passive: true });
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
      } else if (typeof val === 'number' && (val === 9 || (val >= 15 && val <= 21))) {
        cellSegs = ['T' + val];
      }
    }

    if (this.currentTool === 'eraser') {
      // Si la casilla tiene solo 1 segmento (como un muro de habitación 'N', 'S', etc.), ese es el objetivo directo
      if (cellSegs.length === 1) {
        this.hoverSubEdge = (typeof cellSegs[0] === 'string' && cellSegs[0].startsWith('T')) ? cellSegs[0] : String(cellSegs[0]).replace(/^[DW]/, '');
        return;
      }

      // Si la casilla tiene varios segmentos existentes, buscar el más cercano geométricamente al cursor
      if (cellSegs.length > 1) {
        let bestSeg = cellSegs[0];
        let minDist = Infinity;

        const getDist = (segRaw) => {
          if (typeof segRaw === 'string' && segRaw.startsWith('T')) {
            return Math.hypot(localX - 0.5, localY - 0.5);
          }
          if (typeof segRaw === 'number' && (segRaw === 9 || (segRaw >= 15 && segRaw <= 21))) {
            return Math.hypot(localX - 0.5, localY - 0.5);
          }
          const s = String(segRaw).replace(/^[DW]/, '');
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
        this.hoverSubEdge = (typeof bestSeg === 'string' && bestSeg.startsWith('T')) ? bestSeg : String(bestSeg).replace(/^[DW]/, '');
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
   * Olvida todos los estilos de segmento guardados para la celda (x,y) y limpia enlaces de portal
   */
  clearCellStyles(x, y) {
    delete this.wallStyleMap[`${x},${y}`];
    if (this.doorLinks) {
      ['DN', 'DS', 'DE', 'DW'].forEach(d => delete this.doorLinks[`${x},${y},${d}`]);
      delete this.doorLinks[`${x},${y}`];
    }
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
      else if (this.grid[y][x] === 9 || (this.grid[y][x] >= 15 && this.grid[y][x] <= 21)) {
        this.grid[y][x] = ['T' + this.grid[y][x]];
      } else this.grid[y][x] = [];
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
            let d = 1;
            if (typeof segRaw === 'string' && segRaw.startsWith('T')) {
              d = Math.hypot(lx - 0.5, ly - 0.5);
            } else if (typeof segRaw === 'number' && (segRaw === 9 || (segRaw >= 15 && segRaw <= 21))) {
              d = Math.hypot(lx - 0.5, ly - 0.5);
            } else {
              const s = String(segRaw).replace(/^[DW]/, '');
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
            }
            if (d < minDist) {
              minDist = d;
              bestIdx = i;
            }
          });
          idx = bestIdx;
        }

        if (idx !== -1) {
          const removedCode = currentSegs[idx];
          if (typeof removedCode === 'string' && !removedCode.startsWith('T')) {
            this.clearSegmentStyle(x, y, removedCode);
            if (removedCode.startsWith('D')) {
              this.clearSegmentStyle(x, y, removedCode + '_lintel');
              if (this.doorLinks) {
                delete this.doorLinks[`${x},${y},${removedCode}`];
                delete this.doorLinks[`${x},${y}`];
              }
            }
          }
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
    } else if (this.selectedTile === 'table') {
      const tableCode = 'T' + this.tableType;
      const oldIdx = currentSegs.findIndex(s => (typeof s === 'string' && s.startsWith('T')) || (typeof s === 'number' && (s === 9 || (s >= 15 && s <= 21))));
      if (oldIdx !== -1) {
        if (currentSegs[oldIdx] !== tableCode) {
          currentSegs[oldIdx] = tableCode;
          changed = true;
        }
      } else {
        currentSegs.push(tableCode);
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
      if (this.selectMapPreset) this.selectMapPreset.value = 'custom';
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
    if (this.selectMapPreset) this.selectMapPreset.value = 'custom';
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
          row.push(Array.isArray(val) ? [...val] : (val === 1 ? ['N', 'S', 'E', 'W'] : (val === 9 || (val >= 15 && val <= 21)) ? ['T' + val] : []));
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
    if (this.selectMapPreset) this.selectMapPreset.value = 'custom';

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
    if (this.selectMapPreset) this.selectMapPreset.value = 'custom';

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
    if (this.selectMapPreset) this.selectMapPreset.value = 'custom';
    this.render();
    this.updateJSON();
    this.showToast('Mapa vaciado (paredes perimetrales conservadas)');
  }

  applyPreset(presetName) {
    this.wallStyleMap = {};

    if (presetName === '4doors') {
      this.cols = 7;
      this.rows = 7;
      if (this.inputCols) this.inputCols.value = 7;
      if (this.inputRows) this.inputRows.value = 7;
      if (this.inputMapName) this.inputMapName.value = 'Sala 4 Puertas (7x7)';
      this.initDefaultMap();
    } else if (presetName === 'twoRooms') {
      this.cols = 14;
      this.rows = 8;
      if (this.inputCols) this.inputCols.value = 14;
      if (this.inputRows) this.inputRows.value = 8;
      if (this.inputMapName) this.inputMapName.value = '2 Salas Conectadas (14x8)';
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
      this.grid[0][3] = ['DN']; // Entrada exterior
      this.player = { x: 2.5, y: 3.5, angle: 0 };
    } else if (presetName === 'crossRooms') {
      this.cols = 12;
      this.rows = 12;
      if (this.inputCols) this.inputCols.value = 12;
      if (this.inputRows) this.inputRows.value = 12;
      if (this.inputMapName) this.inputMapName.value = '4 Habitaciones / Cruce (12x12)';
      this.grid = [];
      for (let y = 0; y < this.rows; y++) {
        const row = [];
        for (let x = 0; x < this.cols; x++) {
          const segs = [];
          if (y === 0) segs.push('N');
          if (y === this.rows - 1) segs.push('S');
          if (x === 0) segs.push('W');
          if (x === this.cols - 1) segs.push('E');

          // Muro vertical central divisor entre x=5 y x=6
          if (x === 5) {
            if (y === 2 || y === 9) segs.push('DE'); // Puertas a salas este
            else segs.push('E'); // Muro vertical
          }

          // Muro horizontal central divisor entre y=5 e y=6
          if (y === 5) {
            if (x === 2 || x === 9) segs.push('DS'); // Puertas a salas sur
            else segs.push('S'); // Muro horizontal
          }

          row.push(segs);
        }
        this.grid.push(row);
      }
      this.grid[0][2] = ['DN']; // Entrada exterior norte
      this.player = { x: 5.5, y: 5.5, angle: 0 };
    } else if (presetName === 'hallway') {
      this.cols = 15;
      this.rows = 9;
      if (this.inputCols) this.inputCols.value = 15;
      if (this.inputRows) this.inputRows.value = 9;
      if (this.inputMapName) this.inputMapName.value = 'Pasillo Central y Cámaras (15x9)';
      this.grid = [];
      for (let y = 0; y < this.rows; y++) {
        const row = [];
        for (let x = 0; x < this.cols; x++) {
          const segs = [];
          if (y === 0) segs.push('N');
          if (y === this.rows - 1) segs.push('S');
          if (x === 0) segs.push('W');
          if (x === this.cols - 1) segs.push('E');

          // Separador Norte de pasillo (en fila y=3, segmento 'S')
          if (y === 3 && x >= 1 && x <= 13) {
            if (x === 3 || x === 11) segs.push('DS'); // Puertas a salas norte
            else segs.push('S'); // Muro
          }

          // Separador Sur de pasillo (en fila y=5, segmento 'N')
          if (y === 5 && x >= 1 && x <= 13) {
            if (x === 3 || x === 11) segs.push('DN'); // Puertas a salas sur
            else segs.push('N'); // Muro
          }

          // Paredes divisorias entre salas norte y sur (en columna x=7)
          if (x === 7 && (y === 1 || y === 2 || y === 6 || y === 7)) {
            segs.push('E');
          }

          row.push(segs);
        }
        this.grid.push(row);
      }
      this.grid[4][0] = ['DW']; // Puerta entrada pasillo oeste
      this.player = { x: 1.5, y: 4.5, angle: 0 };
    } else if (presetName === 'maze') {
      this.cols = 11;
      this.rows = 11;
      if (this.inputCols) this.inputCols.value = 11;
      if (this.inputRows) this.inputRows.value = 11;
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

    if (this.selectMapPreset) {
      this.selectMapPreset.value = presetName;
    }

    // Actualizar botones de chips de dimensiones rápidas
    document.querySelectorAll('.btn-chip').forEach(chip => {
      const c = parseInt(chip.dataset.cols, 10);
      const r = parseInt(chip.dataset.rows, 10);
      chip.classList.toggle('active', c === this.cols && r === this.rows);
    });

    this.resizeCanvas();
    this.render();
    this.updateJSON();
    this.showToast(`Plantilla cargada: ${this.inputMapName ? this.inputMapName.value : presetName}`);
  }

  drawDoorBadge(ctx, bx, by, iconType, color, cs, isPortal = false) {
    const r = Math.floor(cs * 0.24);
    if (isPortal) {
      // Resplandor exterior portal mágico
      ctx.beginPath();
      ctx.arc(bx, by, r + 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(165, 94, 234, 0.45)';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fillStyle = isPortal ? 'rgba(38, 12, 60, 0.95)' : 'rgba(15, 18, 25, 0.94)';
    ctx.fill();
    ctx.strokeStyle = isPortal ? '#a55eea' : color;
    ctx.lineWidth = isPortal ? 2 : 1.5;
    ctx.stroke();

    if (iconType === 'door') {
      // Icono vectorial limpio de puerta
      const dw = Math.floor(cs * 0.18);
      const dh = Math.floor(cs * 0.28);
      ctx.strokeStyle = isPortal ? '#e0b0ff' : '#fff';
      ctx.lineWidth = 1.3;
      ctx.strokeRect(bx - dw / 2, by - dh / 2, dw, dh);
      // Pomo
      ctx.fillStyle = isPortal ? '#00ffff' : '#f39c12';
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

    // Grosor de pared, accesorio y puerta: 10% del tamaño de celda (proporción 1/10)
    const th = Math.max(2, Math.floor(cs * 0.10));
    const thDoor = th;
    const dOffset = 0;

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
        let tableCode = null;

        if (Array.isArray(cell)) {
          for (let i = 0; i < cell.length; i++) {
            const item = cell[i];
            if (typeof item === 'string' && item.startsWith('T')) {
              tableCode = parseInt(item.slice(1), 10);
            } else if (typeof item === 'number' && (item === 9 || (item >= 15 && item <= 21))) {
              tableCode = item;
            } else {
              segs.push(item);
            }
          }
        } else if (cell === 1) {
          segs = ['N', 'S', 'E', 'W'];
        } else if (cell === 2) segs = ['DN'];
        else if (cell === 3) segs = ['DE'];
        else if (cell === 4) segs = ['DS'];
        else if (cell === 5) segs = ['DW'];
        else if (cell === 9 || (cell >= 15 && cell <= 21)) {
          tableCode = cell;
        }

        // 1. Dibuja la mesa primero al fondo si existe en esta casilla
        if (tableCode) {
          const legCorners = { 9:[1,1,1,1], 15:[0,0,0,0], 16:[1,0,1,0], 17:[0,1,0,1], 18:[1,0,0,0], 19:[0,1,0,0], 20:[0,0,1,0], 21:[0,0,0,1] };
          const lc = legCorners[tableCode] || [0,0,0,0];
          ctx.fillStyle = '#6b4423';
          ctx.fillRect(px + cs * 0.1, py + cs * 0.1, cs * 0.8, cs * 0.8);
          ctx.strokeStyle = '#4a2e17';
          ctx.lineWidth = 1;
          ctx.strokeRect(px + cs * 0.1, py + cs * 0.1, cs * 0.8, cs * 0.8);
          const lw = cs * 0.15;
          ctx.fillStyle = '#3a2010';
          if (lc[0]) ctx.fillRect(px + cs * 0.1, py + cs * 0.1, lw, lw);
          if (lc[1]) ctx.fillRect(px + cs * 0.9 - lw, py + cs * 0.1, lw, lw);
          if (lc[2]) ctx.fillRect(px + cs * 0.1, py + cs * 0.9 - lw, lw, lw);
          if (lc[3]) ctx.fillRect(px + cs * 0.9 - lw, py + cs * 0.9 - lw, lw, lw);
        }

        // 2. Dibuja cada segmento fino de pared/puerta por encima de la mesa
        const cellStyleEntry = this.wallStyleMap[`${x},${y}`];
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i];
          const acc = accessoryConfig[s];
          const segStyle = (cellStyleEntry && cellStyleEntry[s]) || 'castillo';
          let wallColor = getWallStyleColor(segStyle);
          let badgeBorder = acc ? acc.border : null;
          if (acc) {
            wallColor = acc.bg;
            if (s.startsWith('D')) badgeBorder = getDoorStyleColor(segStyle);
          }

          const isPortal = s.startsWith('D') && !!(this.doorLinks && (this.doorLinks[`${x},${y},${s}`] || this.doorLinks[`${x},${y}`]));

          ctx.fillStyle = wallColor;

          switch (s) {
            case 'N':
            case 'WN':
              ctx.fillRect(px, py, cs, th);
              if (acc) this.drawDoorBadge(ctx, px + cs / 2, py + th / 2, acc.icon, badgeBorder, cs);
              break;
            case 'DN':
              ctx.fillRect(px, py + dOffset, cs, thDoor);
              if (acc) this.drawDoorBadge(ctx, px + cs / 2, py + dOffset + thDoor / 2, acc.icon, badgeBorder, cs, isPortal);
              break;
            case 'S':
            case 'WS':
              ctx.fillRect(px, py + cs - th, cs, th);
              if (acc) this.drawDoorBadge(ctx, px + cs / 2, py + cs - th / 2, acc.icon, badgeBorder, cs);
              break;
            case 'DS':
              ctx.fillRect(px, py + cs - th + dOffset, cs, thDoor);
              if (acc) this.drawDoorBadge(ctx, px + cs / 2, py + cs - th + dOffset + thDoor / 2, acc.icon, badgeBorder, cs, isPortal);
              break;
            case 'W':
            case 'WW':
              ctx.fillRect(px, py, th, cs);
              if (acc) this.drawDoorBadge(ctx, px + th / 2, py + cs / 2, acc.icon, badgeBorder, cs);
              break;
            case 'DW':
              ctx.fillRect(px + dOffset, py, thDoor, cs);
              if (acc) this.drawDoorBadge(ctx, px + dOffset + thDoor / 2, py + cs / 2, acc.icon, badgeBorder, cs, isPortal);
              break;
            case 'E':
            case 'WE':
              ctx.fillRect(px + cs - th, py, th, cs);
              if (acc) this.drawDoorBadge(ctx, px + cs - th / 2, py + cs / 2, acc.icon, badgeBorder, cs);
              break;
            case 'DE':
              ctx.fillRect(px + cs - th + dOffset, py, thDoor, cs);
              if (acc) this.drawDoorBadge(ctx, px + cs - th + dOffset + thDoor / 2, py + cs / 2, acc.icon, badgeBorder, cs, isPortal);
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

        if (this.selectedTile === 'table') {
          ctx.fillStyle = 'rgba(107, 68, 35, 0.55)';
          ctx.fillRect(hpx + cs * 0.1, hpy + cs * 0.1, cs * 0.8, cs * 0.8);
          ctx.strokeStyle = '#e5a93b';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(hpx + cs * 0.1, hpy + cs * 0.1, cs * 0.8, cs * 0.8);
        } else if (this.hoverSubEdge.startsWith('corner_')) {
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

          const isDoorPreview = (this.selectedTile === 'door' || (this.selectedTile === 'accessories' && this.selectedAccessory === 'door') || (typeof this.selectedTile === 'number' && this.selectedTile >= 2));
          const pTh = isDoorPreview ? thDoor : th;
          const pOffset = isDoorPreview ? dOffset : 0;

          switch (this.hoverSubEdge) {
            case 'N': ctx.fillRect(hpx, hpy + pOffset, cs, pTh); break;
            case 'S': ctx.fillRect(hpx, hpy + cs - th + pOffset, cs, pTh); break;
            case 'W': ctx.fillRect(hpx + pOffset, hpy, pTh, cs); break;
            case 'E': ctx.fillRect(hpx + cs - th + pOffset, hpy, pTh, cs); break;
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
    const existingName = (this.currentProject && this.currentMapId && this.currentProject.maps[this.currentMapId])
      ? this.currentProject.maps[this.currentMapId].name
      : null;
    const mapName = existingName || this.mapName || (this.inputMapName && this.inputMapName.value.trim()) || 'Sala Principal';
    const level = {
      name: mapName,
      width: this.cols,
      height: this.rows,
      playerStart: {
        x: Number(this.player.x.toFixed(2)),
        y: Number(this.player.y.toFixed(2)),
        angle: (typeof this.player.angle === 'number') ? this.player.angle : -Math.PI / 2
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
    if (this.doorLinks && Object.keys(this.doorLinks).length > 0) {
      level.doorLinks = this.doorLinks;
    }
    // Texturas personalizadas definidas en el proyecto para esta sala / juego
    if (this.currentProject && this.currentProject.customStyles) {
      const hasWalls = Object.keys(this.currentProject.customStyles.walls || {}).length > 0;
      const hasDoors = Object.keys(this.currentProject.customStyles.doors || {}).length > 0;
      if (hasWalls || hasDoors) {
        level.customStyles = this.currentProject.customStyles;
      }
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
    this.saveProjectsToStorage();
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
   * Controla la visibilidad de los paneles inferiores según la herramienta activa.
   * Con el borrador, oculta las opciones de colocación inferiores para evitar confusiones.
   * Con pincel o habitación, restaura la paleta y los paneles de pared/accesorios tal y como estaban.
   */
  updateToolPanelsVisibility() {
    const sectionElementPalette = document.getElementById('sectionElementPalette');
    const sectionWallPlacement = document.getElementById('sectionWallPlacement');
    const sectionAccessoryPlacement = document.getElementById('sectionAccessoryPlacement');
    const sectionMesaPlacement = document.getElementById('sectionMesaPlacement');
    const sectionEraserInfo = document.getElementById('sectionEraserInfo');

    if (this.currentTool === 'eraser') {
      if (sectionElementPalette) sectionElementPalette.style.display = 'none';
      if (sectionWallPlacement) sectionWallPlacement.style.display = 'none';
      if (sectionAccessoryPlacement) sectionAccessoryPlacement.style.display = 'none';
      if (sectionMesaPlacement) sectionMesaPlacement.style.display = 'none';
      if (sectionEraserInfo) sectionEraserInfo.style.display = '';
    } else {
      if (sectionEraserInfo) sectionEraserInfo.style.display = 'none';
      if (sectionElementPalette) sectionElementPalette.style.display = '';

      const isWall = (this.selectedTile === 1 || this.selectedTile === '1');
      const isAccessory = (this.selectedTile === 'accessories');
      const isMesa = (this.selectedTile === 'table');

      if (sectionWallPlacement) {
        sectionWallPlacement.style.display = isWall ? '' : 'none';
        if (isWall) sectionWallPlacement.classList.remove('collapsed');
      }
      if (sectionAccessoryPlacement) {
        sectionAccessoryPlacement.style.display = isAccessory ? '' : 'none';
        if (isAccessory) sectionAccessoryPlacement.classList.remove('collapsed');
      }
      if (sectionMesaPlacement) {
        sectionMesaPlacement.style.display = isMesa ? '' : 'none';
        if (isMesa) sectionMesaPlacement.classList.remove('collapsed');
      }
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

      const toolsSidebar = this.toolsSidebar || document.querySelector('.sidebar.tools-sidebar');
      const canvasContainer = this.canvasContainer || document.getElementById('canvasContainer');
      const jsonSidebar = this.jsonSidebar || document.getElementById('jsonSidebar');

      let prevScrollState = {};
      try {
        const saved = localStorage.getItem('levelEditor_uiState');
        if (saved) prevScrollState = JSON.parse(saved);
      } catch (e) {}

      const sidebarScrollTop = toolsSidebar ? toolsSidebar.scrollTop : (prevScrollState.sidebarScrollTop || 0);
      const canvasScrollLeft = canvasContainer ? canvasContainer.scrollLeft : (prevScrollState.canvasScrollLeft || 0);
      const canvasScrollTop = canvasContainer ? canvasContainer.scrollTop : (prevScrollState.canvasScrollTop || 0);
      const jsonSidebarScrollTop = jsonSidebar ? jsonSidebar.scrollTop : (prevScrollState.jsonSidebarScrollTop || 0);
      const windowScrollX = (typeof window.scrollX === 'number') ? window.scrollX : (prevScrollState.windowScrollX || 0);
      const windowScrollY = (typeof window.scrollY === 'number') ? window.scrollY : (prevScrollState.windowScrollY || 0);

      const state = {
        collapsedSections,
        jsonSidebarCollapsed: isJsonCollapsed,
        currentTool: this.currentTool,
        selectedTile: this.selectedTile,
        selectedAccessory: this.selectedAccessory,
        placementMode: this.placementMode,
        activeWallTab,
        zoomMode: this.zoomMode,
        cellSize: this.cellSize,
        sidebarScrollTop,
        canvasScrollLeft,
        canvasScrollTop,
        jsonSidebarScrollTop,
        windowScrollX,
        windowScrollY
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
        }
      }

      this.updateToolPanelsVisibility();

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

      // 9. Restaurar posiciones de scroll (sidebar de herramientas, canvas, json, ventana)
      const restoreScrollPositions = () => {
        const toolsSidebar = this.toolsSidebar || document.querySelector('.sidebar.tools-sidebar');
        const canvasContainer = this.canvasContainer || document.getElementById('canvasContainer');
        const jsonSidebar = this.jsonSidebar || document.getElementById('jsonSidebar');

        if (toolsSidebar && typeof state.sidebarScrollTop === 'number') {
          toolsSidebar.scrollTop = state.sidebarScrollTop;
        }
        if (canvasContainer) {
          if (typeof state.canvasScrollLeft === 'number') {
            canvasContainer.scrollLeft = state.canvasScrollLeft;
          }
          if (typeof state.canvasScrollTop === 'number') {
            canvasContainer.scrollTop = state.canvasScrollTop;
          }
        }
        if (jsonSidebar && typeof state.jsonSidebarScrollTop === 'number') {
          jsonSidebar.scrollTop = state.jsonSidebarScrollTop;
        }
        if (typeof state.windowScrollX === 'number' || typeof state.windowScrollY === 'number') {
          window.scrollTo(state.windowScrollX || 0, state.windowScrollY || 0);
        }
      };

      restoreScrollPositions();
      requestAnimationFrame(() => restoreScrollPositions());
      setTimeout(restoreScrollPositions, 40);
      setTimeout(restoreScrollPositions, 120);
      setTimeout(restoreScrollPositions, 300);
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
    if (data.name) {
      this.mapName = data.name;
      if (this.inputMapName) {
        this.inputMapName.value = data.name;
      }
    }

    this.customTextures = (data.customTextures && typeof data.customTextures === 'object') ? data.customTextures : {};
    this.renderTextureGrid();

    if (data.customStyles && typeof data.customStyles === 'object') {
      if (!this.currentProject) this.currentProject = { customStyles: { walls: {}, doors: {} } };
      if (!this.currentProject.customStyles) this.currentProject.customStyles = { walls: {}, doors: {} };
      if (data.customStyles.walls) {
        this.currentProject.customStyles.walls = {
          ...(this.currentProject.customStyles.walls || {}),
          ...data.customStyles.walls
        };
      }
      if (data.customStyles.doors) {
        this.currentProject.customStyles.doors = {
          ...(this.currentProject.customStyles.doors || {}),
          ...data.customStyles.doors
        };
      }
      if (typeof loadCustomStyles === 'function') {
        loadCustomStyles(this.currentProject.customStyles);
      }
    }

    this.wallStyleMap = (data.wallStyleMap && typeof data.wallStyleMap === 'object') ? data.wallStyleMap : {};
    this.wallStyle = (data.activeWallStyle && WALL_STYLES[data.activeWallStyle]) ? data.activeWallStyle : 'castillo';
    this.doorStyle = (data.activeDoorStyle && DOOR_STYLES[data.activeDoorStyle]) ? data.activeDoorStyle : 'castillo';
    this.lintelStyle = (data.activeLintelStyle && WALL_STYLES[data.activeLintelStyle]) ? data.activeLintelStyle : 'castillo';
    this.doorLinks = (data.doorLinks && typeof data.doorLinks === 'object') ? data.doorLinks : {};
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

    if (this.selectMapPreset) this.selectMapPreset.value = 'custom';
    this.resizeCanvas();
    this.render();
    this.updateJSON();
  }

  /**
   * Guarda el nivel actual en localStorage y abre la demo en primera persona
   */
  playCurrentLevel() {
    this.saveProjectsToStorage();
    try {
      const levelObj = this.getLevelObject();
      localStorage.setItem('customRaycasterMap', JSON.stringify(levelObj));
    } catch (e) {}
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
  /**
   * Conecta los botones "Estilo de Pared" / "Estilo de Puerta" con el modal
   * selector, que muestra miniaturas generadas y permite subir nuevos estilos PNG
   */
  setupStyleModals() {
    this.styleModalOverlay = document.getElementById('styleModalOverlay');
    this.styleModalTitle = document.getElementById('styleModalTitle');
    this.styleModalGrid = document.getElementById('styleModalGrid');
    if (!this.styleModalOverlay) return;

    document.getElementById('styleModalClose').addEventListener('click', () => this.closeStyleModal());

    const btnWallStyle = document.getElementById('btnWallStyle');
    const btnDoorStyle = document.getElementById('btnDoorStyle');
    const btnLintelStyle = document.getElementById('btnLintelStyle');
    if (btnWallStyle) btnWallStyle.addEventListener('click', () => this.openStyleModal('wall'));
    if (btnDoorStyle) btnDoorStyle.addEventListener('click', () => this.openStyleModal('door'));
    if (btnLintelStyle) btnLintelStyle.addEventListener('click', () => this.openStyleModal('lintel'));

    // Botones del panel de nuevo estilo
    this.btnToggleNewStylePanel = document.getElementById('btnToggleNewStylePanel');
    this.newStylePanel = document.getElementById('newStylePanel');
    this.inputNewStyleName = document.getElementById('inputNewStyleName');
    this.inputNewStyleFile = document.getElementById('inputNewStyleFile');
    this.dropZoneNewStyle = document.getElementById('dropZoneNewStyle');
    this.btnSaveNewStyle = document.getElementById('btnSaveNewStyle');
    this.btnCancelNewStyle = document.getElementById('btnCancelNewStyle');
    this.newStyleCanvasPreview = document.getElementById('newStyleCanvasPreview');
    this.newStyleEmptyState = document.getElementById('newStyleEmptyState');
    this.chkAutoGenerateCap = document.getElementById('chkAutoGenerateCap');
    this.newStylePreviewMeta = document.getElementById('newStylePreviewMeta');
    this.newStyleKindBadge = document.getElementById('newStyleKindBadge');
    this.newStyleWallOptions = document.getElementById('newStyleWallOptions');

    // Elementos del Analizador de Calidad y Rendimiento
    this.newStyleAnalysisCard = document.getElementById('newStyleAnalysisCard');
    this.analysisStatusBadge = document.getElementById('analysisStatusBadge');
    this.analysisPerfPill = document.getElementById('analysisPerfPill');
    this.analysisOrigRes = document.getElementById('analysisOrigRes');
    this.analysisAspect = document.getElementById('analysisAspect');
    this.analysisNotes = document.getElementById('analysisNotes');

    this.pendingStyleDataUrl = null;

    if (this.btnToggleNewStylePanel) {
      this.btnToggleNewStylePanel.addEventListener('click', () => {
        const isVisible = this.newStylePanel.style.display !== 'none';
        this.toggleNewStylePanel(!isVisible);
      });
    }

    if (this.btnCancelNewStyle) {
      this.btnCancelNewStyle.addEventListener('click', () => {
        this.toggleNewStylePanel(false);
      });
    }

    if (this.inputNewStyleName) {
      this.inputNewStyleName.addEventListener('input', () => {
        this.validateNewStyleForm();
      });
    }

    if (this.inputNewStyleFile) {
      this.inputNewStyleFile.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          this.processUploadedStyleImage(e.target.files[0]);
        }
      });
    }

    // Drag & Drop en la zona de subida
    if (this.dropZoneNewStyle) {
      ['dragenter', 'dragover'].forEach(eventName => {
        this.dropZoneNewStyle.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.dropZoneNewStyle.classList.add('dragover');
        });
      });

      ['dragleave', 'drop'].forEach(eventName => {
        this.dropZoneNewStyle.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.dropZoneNewStyle.classList.remove('dragover');
        });
      });

      this.dropZoneNewStyle.addEventListener('drop', (e) => {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          this.processUploadedStyleImage(e.dataTransfer.files[0]);
        }
      });
    }

    if (this.btnSaveNewStyle) {
      this.btnSaveNewStyle.addEventListener('click', () => {
        this.saveNewCustomStyle();
      });
    }

    this.updateStyleLabels();
    this.exportBaseTexturesToDisk();
    this.syncTexturesFromDisk();
  }

  /**
   * Exporta automáticamente las texturas base del motor a archivos PNG en el disco
   */
  async exportBaseTexturesToDisk() {
    if (typeof window === 'undefined' || sessionStorage.getItem('doors_base_textures_saved')) return;
    try {
      if (typeof exportBaseTexturesAsPngDataUrls === 'function') {
        const textures = exportBaseTexturesAsPngDataUrls();
        const entries = Object.entries(textures);
        for (const [relativePath, base64Data] of entries) {
          fetch('/api/save-texture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ relativePath, base64Data })
          }).catch(() => {});
        }
        sessionStorage.setItem('doors_base_textures_saved', '1');
      }
    } catch (e) {
      console.warn('Exportación de texturas base:', e);
    }
  }

  /**
   * Asegura que los estilos personalizados del proyecto actual estén registrados en el motor
   */
  syncCustomStylesFromProject() {
    if (!this.currentProject) return;
    if (this.currentProject.customStyles) {
      if (typeof loadCustomStyles === 'function') {
        loadCustomStyles(this.currentProject.customStyles);
      }
    }
  }

  toggleNewStylePanel(show) {
    if (!this.newStylePanel) return;
    this.newStylePanel.style.display = show ? 'block' : 'none';
    if (show) {
      this.resetNewStyleForm();
      if (this.inputNewStyleName) this.inputNewStyleName.focus();
    }
  }

  /**
   * Sincroniza texturas físicas presentes en carpetas del disco a través de la API
   */
  async syncTexturesFromDisk() {
    try {
      const res = await fetch('/api/list-textures');
      if (!res.ok) return;
      const data = await res.json();
      let updated = false;

      if (!this.currentProject) this.currentProject = { customStyles: { walls: {}, doors: {} } };
      if (!this.currentProject.customStyles) this.currentProject.customStyles = { walls: {}, doors: {} };
      if (!this.currentProject.customStyles.walls) this.currentProject.customStyles.walls = {};
      if (!this.currentProject.customStyles.doors) this.currentProject.customStyles.doors = {};

      const defaultBasics = ['castillo', 'blanca', 'negra', 'cristal'];

      if (data.walls && Array.isArray(data.walls)) {
        data.walls.forEach(item => {
          const isTrans = (/^(cristal|glass|trans|reja|enrejado)/i.test(item.name));
          const capFile = item.capFile || ('caps/' + item.name + '.png');
          const capUrl = item.capUrl || ('/src/engine/textures/caps/' + item.name + '.png');
          
          registerWallStyle(item.name, {
            label: item.name.charAt(0).toUpperCase() + item.name.slice(1).replace(/_/g, ' '),
            pngUrl: item.url,
            file: item.file,
            capFile: capFile,
            capPngUrl: capUrl,
            hasTransparency: isTrans,
            isCustom: true
          });

          if (!defaultBasics.includes(item.name)) {
            const existing = this.currentProject.customStyles.walls[item.name] || {};
            // Limpiar dataUrl y capDataUrl en base64 para que el archivo del disco tenga prioridad absoluta
            delete existing.dataUrl;
            delete existing.capDataUrl;
            this.currentProject.customStyles.walls[item.name] = {
              ...existing,
              label: existing.label || (item.name.charAt(0).toUpperCase() + item.name.slice(1).replace(/_/g, ' ')),
              pngUrl: item.url,
              file: item.file,
              capFile: capFile,
              capPngUrl: capUrl,
              hasTransparency: isTrans,
              isCustom: true
            };
            updated = true;
          }
        });
      }
      if (data.doors && Array.isArray(data.doors)) {
        data.doors.forEach(item => {
          const isTrans = (/^(cristal|glass|trans|reja|enrejado)/i.test(item.name));
          const capFile = item.capFile || ('caps/' + item.name + '.png');
          const capUrl = item.capUrl || ('/src/engine/textures/caps/' + item.name + '.png');
          
          registerDoorStyle(item.name, {
            label: item.name.charAt(0).toUpperCase() + item.name.slice(1).replace(/_/g, ' '),
            pngUrl: item.url,
            file: item.file,
            capFile: capFile,
            capPngUrl: capUrl,
            hasTransparency: isTrans,
            isCustom: true
          });

          if (!defaultBasics.includes(item.name)) {
            const existing = this.currentProject.customStyles.doors[item.name] || {};
            delete existing.dataUrl;
            delete existing.capDataUrl;
            this.currentProject.customStyles.doors[item.name] = {
              ...existing,
              label: existing.label || (item.name.charAt(0).toUpperCase() + item.name.slice(1).replace(/_/g, ' ')),
              pngUrl: item.url,
              file: item.file,
              capFile: capFile,
              capPngUrl: capUrl,
              hasTransparency: isTrans,
              isCustom: true
            };
            updated = true;
          }
        });
      }

      if (updated) {
        this.saveProjectsToStorage();
        this.updateJSON();
        this.updateStyleLabels();
      }
    } catch (e) {
      // Entorno offline o sin endpoint disponible
    }
  }

  resetNewStyleForm() {
    this.pendingStyleDataUrl = null;
    if (this.inputNewStyleName) this.inputNewStyleName.value = '';
    if (this.inputNewStyleFile) this.inputNewStyleFile.value = '';
    if (this.btnSaveNewStyle) this.btnSaveNewStyle.disabled = true;
    if (this.newStyleEmptyState) this.newStyleEmptyState.style.display = 'flex';
    if (this.newStyleCanvasPreview) this.newStyleCanvasPreview.style.display = 'none';
    if (this.newStyleAnalysisCard) this.newStyleAnalysisCard.style.display = 'none';

    const isDoor = (this.styleModalKind === 'door');
    const targetW = 64;
    const targetH = isDoor ? 128 : 192;
    const kindLabel = isDoor ? 'Puerta' : (this.styleModalKind === 'lintel' ? 'Dintel' : 'Pared');

    if (this.newStyleKindBadge) {
      this.newStyleKindBadge.textContent = `${kindLabel} (${targetW}×${targetH} px) | Canto: 64×192 px ó 16×192 px`;
    }
    if (this.newStylePreviewMeta) {
      this.newStylePreviewMeta.textContent = `${targetW} × ${targetH} px (${isDoor ? 'Hoja' : 'Frontal'})`;
    }
    const capHint = document.getElementById('newStyleCapHint');
    if (capHint) {
      capHint.textContent = `Canto (caps/): 64×192 px (HD) ó 16×192 px (20cm)`;
    }
    if (this.newStyleWallOptions) {
      this.newStyleWallOptions.style.display = isDoor ? 'none' : 'block';
    }
  }

  validateNewStyleForm() {
    const hasName = this.inputNewStyleName && this.inputNewStyleName.value.trim().length > 0;
    const hasImage = !!this.pendingStyleDataUrl;
    if (this.btnSaveNewStyle) {
      this.btnSaveNewStyle.disabled = !(hasName && hasImage);
    }
  }

  /**
   * Analiza la calidad, dimensiones y rendimiento de la imagen subida para el motor 3D
   */
  analyzeTextureImage(img, file, isDoor) {
    if (!this.newStyleAnalysisCard) return;
    const origW = img.naturalWidth || img.width;
    const origH = img.naturalHeight || img.height;
    const targetW = 64;
    const targetH = isDoor ? 128 : 192;
    const idealRatio = targetW / targetH; // 0.333 para paredes (1:3), 0.5 para puertas (1:2)
    const actualRatio = origW / origH;
    const ratioDiff = Math.abs(actualRatio - idealRatio);

    if (this.analysisOrigRes) {
      this.analysisOrigRes.textContent = `${origW} × ${origH} px`;
    }

    let aspectText = '';
    if (actualRatio > 1.2) aspectText = 'Horizontal (Apaisada)';
    else if (actualRatio >= 0.85 && actualRatio <= 1.15) aspectText = 'Cuadrada (1:1)';
    else aspectText = `Vertical (${origW}:${origH})`;
    if (this.analysisAspect) this.analysisAspect.textContent = aspectText;

    let isOptimal = true;
    const warnings = [];

    // Verificación de tamaño excesivo o muy bajo
    if (origW > 2048 || origH > 2048 || (file && file.size > 2 * 1024 * 1024)) {
      const mb = file ? (file.size / (1024 * 1024)).toFixed(1) : '>2';
      warnings.push(`Imagen de alta resolución (${mb} MB). Se normaliza a ${targetW}×${targetH} px para garantizar 60 FPS estables sin sobrecargar la memoria.`);
      isOptimal = false;
    } else if (origW < 32 || origH < (isDoor ? 64 : 96)) {
      warnings.push(`Resolución reducida (${origW}×${origH} px). Podría percibirse desenfocada o pixelada al acercarse.`);
      isOptimal = false;
    }

    // Verificación de proporción
    if (ratioDiff > 0.15) {
      warnings.push(`La proporción no es exactamente ${isDoor ? '1:2' : '1:3'}. El editor la escala adaptándola al formato nativo.`);
      isOptimal = false;
    }

    if (this.pendingStyleHasTransparency) {
      warnings.unshift('✨ Transparencia detectada: El motor 3D la tratará como superficie translúcida (efecto cristal/reja) permitiendo ver a través de ella.');
    }

    if (this.analysisStatusBadge) {
      if (isOptimal) {
        this.analysisStatusBadge.className = 'analysis-status-badge badge-optimal';
        this.analysisStatusBadge.innerHTML = '<i class="ri-checkbox-circle-line"></i> Óptima para 3D';
      } else {
        this.analysisStatusBadge.className = 'analysis-status-badge badge-warning';
        this.analysisStatusBadge.innerHTML = '<i class="ri-information-line"></i> Adaptada al Motor';
      }
    }

    if (this.analysisNotes) {
      if (warnings.length > 0) {
        this.analysisNotes.textContent = warnings.join(' ');
        this.analysisNotes.style.display = 'block';
      } else {
        this.analysisNotes.textContent = `Proporción y resolución excelentes. Normalizada a ${targetW}×${targetH} px con rendimiento óptimo a 60 FPS.`;
        this.analysisNotes.style.display = 'block';
      }
    }

    this.newStyleAnalysisCard.style.display = 'flex';
  }

  /**
   * Lee la imagen del usuario, la escala a la proporción nativa en un canvas 2D
   * y genera la vista previa
   */
  processUploadedStyleImage(file) {
    if (!file || !file.type.startsWith('image/')) {
      this.showToast('⚠️ Por favor selecciona un archivo de imagen válido (.png, .jpg, .webp)');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const isDoor = (this.styleModalKind === 'door');
        const targetW = 64;
        const targetH = isDoor ? 128 : 192;

        const canvas = this.newStyleCanvasPreview;
        if (!canvas) return;
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        // Ajuste inteligente: dibujar cubriendo todo el área nativa
        ctx.clearRect(0, 0, targetW, targetH);
        ctx.drawImage(img, 0, 0, targetW, targetH);

        // Detectar si la imagen contiene canal alfa con transparencia o translucidez
        const imgPixels = ctx.getImageData(0, 0, targetW, targetH).data;
        let hasTrans = false;
        for (let i = 3; i < imgPixels.length; i += 4) {
          if (imgPixels[i] < 250) {
            hasTrans = true;
            break;
          }
        }
        this.pendingStyleHasTransparency = hasTrans;
        this.pendingStyleDataUrl = canvas.toDataURL('image/png');

        // Mostrar canvas de vista previa
        if (this.newStyleEmptyState) this.newStyleEmptyState.style.display = 'none';
        canvas.style.display = 'block';

        // Auto-asignar nombre a partir del archivo si está vacío
        if (this.inputNewStyleName && !this.inputNewStyleName.value.trim()) {
          const rawName = file.name.replace(/\.[^/.]+$/, '').replace(/[_\-]/g, ' ');
          this.inputNewStyleName.value = rawName.charAt(0).toUpperCase() + rawName.slice(1);
        }

        this.analyzeTextureImage(img, file, isDoor);
        this.validateNewStyleForm();
        this.showToast('✅ Imagen cargada y adaptada a resolución nativa');
      };
      img.onerror = () => {
        this.showToast('⚠️ No se pudo procesar la imagen seleccionada');
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  /**
   * Guarda el estilo personalizado en el proyecto actual y en el catálogo del motor
   */
  async saveNewCustomStyle() {
    const name = this.inputNewStyleName ? this.inputNewStyleName.value.trim() : '';
    if (!name || !this.pendingStyleDataUrl) {
      this.showToast('⚠️ Debes ingresar un nombre y seleccionar una imagen');
      return;
    }

    const kind = this.styleModalKind || 'wall';
    const isDoor = (kind === 'door');
    const targetFolder = isDoor ? 'doors' : 'walls';
    const cleanSlug = name.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || ('custom_' + Date.now());
    const styleKey = cleanSlug;
    const relativeDiskPath = `src/engine/textures/${targetFolder}/${styleKey}.png`;

    // Inicializar almacén de estilos personalizados en el proyecto si no existiera
    if (!this.currentProject.customStyles) {
      this.currentProject.customStyles = { walls: {}, doors: {} };
    }
    if (!this.currentProject.customStyles.walls) this.currentProject.customStyles.walls = {};
    if (!this.currentProject.customStyles.doors) this.currentProject.customStyles.doors = {};

    let capDataUrl = null;
    if (!isDoor && this.chkAutoGenerateCap && this.chkAutoGenerateCap.checked) {
      const capPixels = createCapFromWallImage(this.pendingStyleDataUrl, 64, 192);
      const capCanvas = document.createElement('canvas');
      capCanvas.width = 64;
      capCanvas.height = 192;
      const cctx = capCanvas.getContext('2d');
      const imgData = cctx.createImageData(64, 192);
      new Uint32Array(imgData.data.buffer).set(capPixels);
      cctx.putImageData(imgData, 0, 0);
      capDataUrl = capCanvas.toDataURL('image/png');
    }

    const tNow = Date.now();
    const styleData = {
      label: name,
      isCustom: true,
      hasTransparency: !!this.pendingStyleHasTransparency,
      dataUrl: this.pendingStyleDataUrl,
      capDataUrl: capDataUrl,
      file: `${targetFolder}/${styleKey}.png`,
      pngUrl: '/' + relativeDiskPath + '?t=' + tNow,
      capFile: `caps/${styleKey}.png`,
      capPngUrl: `/src/engine/textures/caps/${styleKey}.png?t=${tNow}`
    };

    if (isDoor) {
      this.currentProject.customStyles.doors[styleKey] = styleData;
      registerDoorStyle(styleKey, styleData);
    } else {
      this.currentProject.customStyles.walls[styleKey] = styleData;
      registerWallStyle(styleKey, styleData);
    }

    // Guardar archivo físico PNG en el servidor de desarrollo (asíncrono)
    const saveImgPromise = fetch('/api/save-texture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        relativePath: relativeDiskPath,
        base64Data: this.pendingStyleDataUrl
      })
    }).catch(() => {});

    // Si tiene canto generado, guardarlo también en disco en caps/
    const saveCapPromise = capDataUrl ? fetch('/api/save-texture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        relativePath: `src/engine/textures/caps/${styleKey}.png`,
        base64Data: capDataUrl
      })
    }).catch(() => {}) : Promise.resolve();

    Promise.all([saveImgPromise, saveCapPromise]).then(() => {
      this.syncTexturesFromDisk();
    });

    // Persistir proyecto en localStorage y actualizar de inmediato el visor JSON de la sala
    this.saveProjectsToStorage();
    this.updateJSON();

    // Seleccionar el nuevo estilo de inmediato y actualizar modal
    this.toggleNewStylePanel(false);
    this.selectStyle(kind, styleKey);
    this.openStyleModal(kind);

    this.showToast(`✨ Estilo "${name}" guardado y añadido a la sala`);
  }

  /**
   * Elimina un estilo personalizado creado por el usuario
   */
  deleteCustomStyle(kind, styleKey) {
    const { styles } = this._styleKindInfo(kind);
    const def = styles[styleKey];
    const styleLabel = (def && def.label) || 'este estilo';

    this.showConfirmDialog({
      title: `¿Eliminar estilo "${styleLabel}"?`,
      message: 'Este diseño personalizado se eliminará del catálogo de estilos y del JSON de esta sala.',
      acceptText: 'Eliminar Estilo',
      isDanger: true,
      onAccept: () => {
        if (this.currentProject && this.currentProject.customStyles) {
          if (kind === 'door' && this.currentProject.customStyles.doors) {
            delete this.currentProject.customStyles.doors[styleKey];
          } else if (this.currentProject.customStyles.walls) {
            delete this.currentProject.customStyles.walls[styleKey];
          }
        }

        removeCustomStyle(kind, styleKey);

        // Si estaba seleccionado, volver a 'castillo'
        const { prop } = this._styleKindInfo(kind);
        if (this[prop] === styleKey) {
          this[prop] = 'castillo';
          if (kind === 'door') this.lintelStyle = 'castillo';
        }

        this.saveProjectsToStorage();
        this.updateStyleLabels();
        this.updateJSON();
        this.openStyleModal(kind);
        this.showToast(`🗑️ Estilo "${styleLabel}" eliminado`);
      }
    });
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
    this.syncCustomStylesFromProject();
    const { styles, prop, label, isDoorKind } = this._styleKindInfo(kind);
    const current = this[prop];

    this.styleModalTitle.innerHTML = `<i class="ri-palette-line"></i> Estilo de ${label}`;

    // Actualizar guía de medidas visible en la cabecera de la modal
    const lblDimFrontalTitle = document.getElementById('lblDimFrontalTitle');
    const valDimFrontal = document.getElementById('valDimFrontal');
    if (lblDimFrontalTitle && valDimFrontal) {
      if (isDoorKind) {
        lblDimFrontalTitle.textContent = 'Hoja de Puerta:';
        valDimFrontal.innerHTML = '64 × 128 px <small>(Proporción 1:2)</small>';
      } else {
        lblDimFrontalTitle.textContent = 'Frontal de Pared:';
        valDimFrontal.innerHTML = '64 × 192 px <small>(Proporción 1:3)</small>';
      }
    }
    
    // Ocultar panel de nuevo estilo al abrir el modal
    if (this.newStylePanel) this.newStylePanel.style.display = 'none';

    this.styleModalGrid.innerHTML = Object.entries(styles).map(([key, def]) => {
      const isCustom = !!def.isCustom;
      const previewImg = def.dataUrl || def.pngUrl || this.renderStylePreview(isDoorKind, def);
      return `
        <div class="style-card ${key === current ? 'active' : ''}" data-style="${key}" title="${def.label}">
          ${isCustom ? '<span class="style-card-badge">PNG</span>' : ''}
          ${isCustom ? `<button class="style-card-delete-btn" data-delete-key="${key}" title="Eliminar este estilo"><i class="ri-delete-bin-line"></i></button>` : ''}
          <img src="${previewImg}" alt="${def.label}">
          <span class="style-card-title">${def.label}</span>
        </div>
      `;
    }).join('');

    this.styleModalGrid.querySelectorAll('.style-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.style-card-delete-btn');
        if (deleteBtn) {
          e.stopPropagation();
          this.deleteCustomStyle(kind, deleteBtn.dataset.deleteKey);
          return;
        }
        this.selectStyle(kind, card.dataset.style);
      });
    });

    this.styleModalOverlay.hidden = false;
  }

  /**
   * Dibuja una miniatura con la misma función procedural que usará el motor 3D
   * Puertas: 64x128 px (proporción 5:10). Paredes y dinteles: 64x192 px (proporción 5:15).
   */
  renderStylePreview(isDoorKind, styleDef) {
    if (styleDef.dataUrl) return styleDef.dataUrl;
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

    // Sincronización inteligente: al cambiar la puerta, el dintel adopta automáticamente el mismo estilo
    if (kind === 'door' && typeof WALL_STYLES !== 'undefined' && WALL_STYLES[styleKey]) {
      this.lintelStyle = styleKey;
    }

    this.updateStyleLabels();
    this.closeStyleModal();
    this.updateJSON();

    if (kind === 'door' && typeof WALL_STYLES !== 'undefined' && WALL_STYLES[styleKey]) {
      this.showToast(`🚪 Puerta y dintel sincronizados: ${styles[styleKey]?.label || styleKey}`);
    } else {
      this.showToast(`🖌️ Pincel de ${label.toLowerCase()}: ${styles[styleKey]?.label || styleKey} (se aplicará a lo próximo que coloques)`);
    }
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

  setupMesaModal() {
    const MESA_TYPES = [
      { code: 9,  label: '4 Patas',   desc: 'Mesa independiente',        svg: `<svg viewBox="0 0 40 40" width="60" height="60"><rect x="2" y="2" width="36" height="36" fill="#6b4423" rx="2"/><rect x="2" y="2" width="7" height="36" fill="#3a2010"/><rect x="31" y="2" width="7" height="36" fill="#3a2010"/></svg>` },
      { code: 15, label: 'Sin Patas', desc: 'Interior de mesa grande',    svg: `<svg viewBox="0 0 40 40" width="60" height="60"><rect x="2" y="2" width="36" height="36" fill="#6b4423" rx="2"/></svg>` },
      { code: 16, label: 'Ext. Izq',  desc: 'Extremo izquierdo (2 patas)', svg: `<svg viewBox="0 0 40 40" width="60" height="60"><rect x="2" y="2" width="36" height="36" fill="#6b4423" rx="2"/><rect x="2" y="2" width="7" height="36" fill="#3a2010"/></svg>` },
      { code: 17, label: 'Ext. Der',  desc: 'Extremo derecho (2 patas)',  svg: `<svg viewBox="0 0 40 40" width="60" height="60"><rect x="2" y="2" width="36" height="36" fill="#6b4423" rx="2"/><rect x="31" y="2" width="7" height="36" fill="#3a2010"/></svg>` },
      { code: 18, label: 'Esq. TL',   desc: 'Esquina arriba-izquierda',   svg: `<svg viewBox="0 0 40 40" width="60" height="60"><rect x="2" y="2" width="36" height="36" fill="#6b4423" rx="2"/><rect x="2" y="2" width="7" height="7" fill="#3a2010"/></svg>` },
      { code: 19, label: 'Esq. TR',   desc: 'Esquina arriba-derecha',     svg: `<svg viewBox="0 0 40 40" width="60" height="60"><rect x="2" y="2" width="36" height="36" fill="#6b4423" rx="2"/><rect x="31" y="2" width="7" height="7" fill="#3a2010"/></svg>` },
      { code: 20, label: 'Esq. BL',   desc: 'Esquina abajo-izquierda',    svg: `<svg viewBox="0 0 40 40" width="60" height="60"><rect x="2" y="2" width="36" height="36" fill="#6b4423" rx="2"/><rect x="2" y="31" width="7" height="7" fill="#3a2010"/></svg>` },
      { code: 21, label: 'Esq. BR',   desc: 'Esquina abajo-derecha',      svg: `<svg viewBox="0 0 40 40" width="60" height="60"><rect x="2" y="2" width="36" height="36" fill="#6b4423" rx="2"/><rect x="31" y="31" width="7" height="7" fill="#3a2010"/></svg>` },
    ];

    this.mesaModalOverlay = document.getElementById('mesaModalOverlay');
    const mesaModalGrid = document.getElementById('mesaModalGrid');
    const mesaModalClose = document.getElementById('mesaModalClose');
    const btnMesaType = document.getElementById('btnMesaType');
    const mesaTypeLabel = document.getElementById('mesaTypeLabel');

    if (!this.mesaModalOverlay) return;

    mesaModalClose.addEventListener('click', () => { this.mesaModalOverlay.hidden = true; });
    this.mesaModalOverlay.addEventListener('click', (e) => {
      if (e.target === this.mesaModalOverlay) this.mesaModalOverlay.hidden = true;
    });

    if (btnMesaType) btnMesaType.addEventListener('click', () => {
      mesaModalGrid.innerHTML = MESA_TYPES.map(t => `
        <div class="style-card ${t.code === this.tableType ? 'active' : ''}" data-code="${t.code}" title="${t.desc}">
          ${t.svg}
          <span class="style-card-title">${t.label}</span>
        </div>
      `).join('');
      mesaModalGrid.querySelectorAll('.style-card').forEach(card => {
        card.addEventListener('click', () => {
          this.tableType = parseInt(card.dataset.code, 10);
          const found = MESA_TYPES.find(t => t.code === this.tableType);
          if (mesaTypeLabel) mesaTypeLabel.textContent = found ? found.label : this.tableType;
          this.mesaModalOverlay.hidden = true;
          this.showToast(`🪵 Tipo de mesa: ${found ? found.label : this.tableType}`);
        });
      });
      this.mesaModalOverlay.hidden = false;
    });
  }

  setupConfirmModal() {
    this.confirmModalOverlay = document.getElementById('confirmModalOverlay');
    this.confirmModalTitle = document.getElementById('confirmModalTitle');
    this.confirmModalMessage = document.getElementById('confirmModalMessage');
    this.confirmModalAccept = document.getElementById('confirmModalAccept');
    this.confirmModalCancel = document.getElementById('confirmModalCancel');
    this.confirmModalClose = document.getElementById('confirmModalClose');

    if (!this.confirmModalOverlay) return;

    this.confirmModalClose?.addEventListener('click', () => this.closeConfirmDialog(false));
    this.confirmModalCancel?.addEventListener('click', () => this.closeConfirmDialog(false));
    this.confirmModalAccept?.addEventListener('click', () => this.closeConfirmDialog(true));
  }

  showConfirmDialog({ title, message, acceptText = 'Aceptar', isDanger = true, onAccept, onCancel }) {
    if (!this.confirmModalOverlay) {
      if (confirm(`${title}\n\n${message}`)) {
        if (onAccept) onAccept();
      } else {
        if (onCancel) onCancel();
      }
      return;
    }

    if (this.confirmModalTitle) this.confirmModalTitle.innerHTML = `<i class="ri-error-warning-line"></i> ${title}`;
    if (this.confirmModalMessage) this.confirmModalMessage.textContent = message;
    if (this.confirmModalAccept) {
      this.confirmModalAccept.textContent = acceptText;
      this.confirmModalAccept.className = isDanger ? 'btn-subtle danger' : 'btn-subtle primary-btn';
    }

    this.onConfirmAccept = onAccept;
    this.onConfirmCancel = onCancel;

    this.confirmModalOverlay.hidden = false;
  }

  closeConfirmDialog(accepted = false) {
    if (!this.confirmModalOverlay) return;
    this.confirmModalOverlay.hidden = true;
    const acceptCb = this.onConfirmAccept;
    const cancelCb = this.onConfirmCancel;
    this.onConfirmAccept = null;
    this.onConfirmCancel = null;

    if (accepted) {
      if (acceptCb) acceptCb();
    } else {
      if (cancelCb) cancelCb();
    }
  }

  backupCurrentMap() {
    try {
      this.lastMapBackup = JSON.parse(JSON.stringify(this.getLevelObject()));
    } catch (e) {
      console.warn('No se pudo crear backup del mapa:', e);
    }
  }

  restoreBackupMap() {
    if (!this.lastMapBackup) {
      this.showToast('ℹ️ No hay ningún mapa anterior para restaurar');
      return;
    }
    const backup = this.lastMapBackup;
    this.lastMapBackup = null;
    this.loadLevelData(backup);
    this.showToast('↩️ Mapa anterior restaurado con éxito');
  }

  hasMapContent() {
    if (!Array.isArray(this.grid)) return false;
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const segs = this.grid[y] && this.grid[y][x];
        if (!segs) continue;
        if (Array.isArray(segs)) {
          const isInterior = (x > 0 && x < this.cols - 1 && y > 0 && y < this.rows - 1);
          if (isInterior && segs.length > 0) return true;
          if (segs.some(s => s.startsWith('D') || s.startsWith('W') || s.startsWith('C') || s.startsWith('R'))) return true;
        } else if (segs === 1) {
          const isInterior = (x > 0 && x < this.cols - 1 && y > 0 && y < this.rows - 1);
          if (isInterior) return true;
        }
      }
    }
    return false;
  }

  /* ==========================================================================
     SISTEMA DE PROYECTOS & MULTIMAPAS
     ========================================================================== */

  /**
   * Inicializa el sistema de proyectos: carga desde localStorage o migra
   * mapas antiguos a la estructura de proyectos v2.
   */
  initProjectSystem() {
    try {
      const savedProjects = localStorage.getItem('doors_projects_v2');
      if (savedProjects) {
        this.projects = JSON.parse(savedProjects);
      }
    } catch (e) {
      console.warn('Error leyendo doors_projects_v2:', e);
      this.projects = {};
    }

    if (!this.projects || typeof this.projects !== 'object' || Object.keys(this.projects).length === 0) {
      this.projects = {};
      let initialMap = null;
      try {
        const legacyMap = localStorage.getItem('customRaycasterMap');
        if (legacyMap) {
          const parsed = JSON.parse(legacyMap);
          if (parsed && parsed.map && Array.isArray(parsed.map) && parsed.map.length > 0) {
            initialMap = parsed;
          }
        }
      } catch (e) {
        console.warn('Error migrando mapa legacy:', e);
      }

      const initialProjId = 'proj_' + Date.now();
      const initialMapId = 'map_1';
      if (!initialMap) {
        initialMap = this.createDefaultMapObject(initialMapId, 'Sala Principal', 12, 12);
      } else {
        initialMap.id = initialMapId;
        if (!initialMap.name) initialMap.name = 'Sala Principal';
        if (!initialMap.doorLinks) initialMap.doorLinks = {};
      }

      this.projects[initialProjId] = {
        id: initialProjId,
        name: 'Mi Primer Proyecto',
        version: 2,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        startingMapId: initialMapId,
        maps: {
          [initialMapId]: initialMap
        }
      };
      this.currentProjectId = initialProjId;
    } else {
      const savedProjId = localStorage.getItem('doors_current_project_id');
      if (savedProjId && this.projects[savedProjId]) {
        this.currentProjectId = savedProjId;
      } else {
        this.currentProjectId = Object.keys(this.projects)[0];
      }
    }

    this.currentProject = this.projects[this.currentProjectId];
    if (!this.currentProject.maps || Object.keys(this.currentProject.maps).length === 0) {
      const mId = 'map_1';
      this.currentProject.maps = {
        [mId]: this.createDefaultMapObject(mId, 'Sala Principal', 12, 12)
      };
      this.currentProject.startingMapId = mId;
    }

    if (!this.currentProject.startingMapId || !this.currentProject.maps[this.currentProject.startingMapId]) {
      this.currentProject.startingMapId = Object.keys(this.currentProject.maps)[0];
    }

    this.currentMapId = this.currentProject.startingMapId;
    this.syncCustomStylesFromProject();
    this.loadLevelData(this.currentProject.maps[this.currentMapId]);
    this.updateHeaderProject();
    this.renderMapDropdown();
    this.saveProjectsToStorage();
  }

  updateHeaderProject() {
    if (!this.currentProject) return;
    if (this.headerProjectName) {
      this.headerProjectName.textContent = this.currentProject.name;
    }
    this.renderProjectDropdown();
    if (this.sidebarProjectName) {
      this.sidebarProjectName.textContent = this.currentProject.name;
    }
    if (this.modalActiveProjectBadge) {
      this.modalActiveProjectBadge.textContent = this.currentProject.name;
    }
    if (this.modalProjectNameMaps) {
      this.modalProjectNameMaps.textContent = this.currentProject.name;
    }
    if (this.modalActiveRoomNameDisplay && this.currentMapId && this.currentProject.maps[this.currentMapId]) {
      this.modalActiveRoomNameDisplay.textContent = this.currentProject.maps[this.currentMapId].name || 'Sala';
    }
    if (this.modalActiveRoomSpawnBadge && this.currentMapId) {
      const isStart = (this.currentMapId === this.currentProject.startingMapId);
      this.modalActiveRoomSpawnBadge.style.display = isStart ? '' : 'none';
    }
  }

  saveProjectsToStorage() {
    if (!this.currentProject || !this.currentMapId) return;
    try {
      const currentMapObj = this.currentProject.maps[this.currentMapId];
      const levelData = this.getLevelObject();
      levelData.id = this.currentMapId;
      if (currentMapObj && currentMapObj.name) {
        levelData.name = currentMapObj.name;
      }
      levelData.doorLinks = this.doorLinks || {};
      this.currentProject.maps[this.currentMapId] = levelData;
      this.currentProject.updatedAt = Date.now();

      localStorage.setItem('doors_projects_v2', JSON.stringify(this.projects));
      localStorage.setItem('doors_current_project_id', this.currentProjectId);
      localStorage.setItem('doors_current_map_id', this.currentMapId);
      localStorage.setItem('customRaycasterMap', JSON.stringify(levelData));
    } catch (e) {
      console.warn('Error al guardar proyectos en localStorage:', e);
    }
  }

  setupProjectEventListeners() {
    // Abrir modal desde la cabecera o el panel lateral
    if (this.btnOpenProjectsFromSidebar) {
      this.btnOpenProjectsFromSidebar.addEventListener('click', () => {
        this.openProjectModal('tabProjects');
      });
    }

    if (this.btnOpenProjectsFromHeader) {
      this.btnOpenProjectsFromHeader.addEventListener('click', () => {
        this.openProjectModal('tabProjects');
      });
    }

    if (this.btnManageMapsInModal) {
      this.btnManageMapsInModal.addEventListener('click', () => {
        this.openProjectModal('tabMaps');
      });
    }

    // Pestañas de la modal
    if (this.btnTabProjects) {
      this.btnTabProjects.addEventListener('click', () => {
        this.switchModalTab('tabProjects');
      });
    }

    if (this.btnTabMaps) {
      this.btnTabMaps.addEventListener('click', () => {
        this.switchModalTab('tabMaps');
      });
    }

    const projClose = document.getElementById('projectModalClose');
    if (projClose) projClose.addEventListener('click', () => this.closeProjectModal());

    const btnNewProj = document.getElementById('btnCreateNewProject');
    if (btnNewProj) {
      btnNewProj.addEventListener('click', () => {
        const name = prompt('Nombre para el nuevo proyecto:');
        if (name !== null) {
          this.createNewProject(name);
        }
      });
    }

    const inputImport = document.getElementById('inputImportProject');
    if (inputImport) {
      inputImport.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          this.importProjectJson(e.target.files[0]);
          e.target.value = '';
        }
      });
    }

    if (this.selectActiveProject) {
      this.selectActiveProject.addEventListener('change', (e) => {
        this.switchProject(e.target.value);
      });
    }

    if (this.btnQuickNewProject) {
      this.btnQuickNewProject.addEventListener('click', () => {
        const name = prompt('Nombre para el nuevo proyecto:');
        if (name !== null) {
          this.createNewProject(name);
        }
      });
    }

    if (this.selectActiveMap) {
      this.selectActiveMap.addEventListener('change', (e) => {
        this.switchMap(e.target.value);
      });
    }

    if (this.btnQuickNewMap) {
      this.btnQuickNewMap.addEventListener('click', () => {
        this.createMapInProject();
      });
    }

    if (this.btnAddNewMapFromModal) {
      this.btnAddNewMapFromModal.addEventListener('click', () => {
        this.createMapInProject();
        this.renderModalMapList();
      });
    }

    if (this.btnNewMapInProject) {
      this.btnNewMapInProject.addEventListener('click', () => {
        this.createMapInProject();
      });
    }

    if (this.btnDuplicateMap) {
      this.btnDuplicateMap.addEventListener('click', () => {
        this.duplicateCurrentMap();
      });
    }

    if (this.btnSetStartingMap) {
      this.btnSetStartingMap.addEventListener('click', () => {
        this.setStartingMap(this.currentMapId);
      });
    }

    if (this.btnDeleteMap) {
      this.btnDeleteMap.addEventListener('click', () => {
        this.deleteCurrentMap();
      });
    }

    if (this.btnGenerateGameInModal) {
      this.btnGenerateGameInModal.addEventListener('click', () => {
        this.generateStandaloneGame();
      });
    }

    if (this.btnGenerateGame) {
      this.btnGenerateGame.addEventListener('click', () => {
        this.generateStandaloneGame();
      });
    }
  }

  openProjectModal(initialTab = 'tabProjects') {
    this.saveProjectsToStorage();
    this.updateHeaderProject();
    this.switchModalTab(initialTab);
    if (this.projectModalOverlay) this.projectModalOverlay.hidden = false;
  }

  closeProjectModal() {
    if (this.projectModalOverlay) this.projectModalOverlay.hidden = true;
  }

  switchModalTab(tabName) {
    if (tabName === 'tabMaps') {
      if (this.btnTabMaps) this.btnTabMaps.classList.add('active');
      if (this.btnTabProjects) this.btnTabProjects.classList.remove('active');
      if (this.paneMaps) this.paneMaps.style.display = '';
      if (this.paneProjects) this.paneProjects.style.display = 'none';
      this.renderModalMapList();
    } else {
      if (this.btnTabProjects) this.btnTabProjects.classList.add('active');
      if (this.btnTabMaps) this.btnTabMaps.classList.remove('active');
      if (this.paneProjects) this.paneProjects.style.display = '';
      if (this.paneMaps) this.paneMaps.style.display = 'none';
      this.renderProjectList();
    }
  }

  renderModalMapList() {
    if (!this.modalMapListContainer || !this.currentProject) return;
    const mapIds = Object.keys(this.currentProject.maps);
    const startMapId = this.currentProject.startingMapId;

    this.modalMapListContainer.innerHTML = mapIds.map(id => {
      const m = this.currentProject.maps[id];
      const isStart = (id === startMapId);
      const isCurrent = (id === this.currentMapId);
      const isExpanded = (this.expandedMapId === id);
      const rows = m.map ? m.map.length : (m.rows || 12);
      const cols = m.map && m.map[0] ? m.map[0].length : (m.cols || 12);
      const doorCount = m.doorLinks ? Object.keys(m.doorLinks).length : 0;

      return `
        <div class="modal-map-card ${isCurrent ? 'active' : ''} ${isExpanded ? 'expanded' : ''}" data-map-id="${id}">
          <div class="modal-map-card-header">
            <div class="modal-map-info">
              <div class="modal-map-title-row">
                <span class="modal-map-name">${m.name || id}</span>
                ${isStart ? '<span class="starting-map-badge"><i class="ri-flag-fill"></i> Spawn Inicial</span>' : ''}
                ${isCurrent ? '<span class="project-active-badge"><i class="ri-pencil-line"></i> Activa en Editor</span>' : ''}
              </div>
              <div class="modal-map-meta">
                <span><i class="ri-grid-line"></i> ${cols}x${rows}</span>
                <span>•</span>
                <span><i class="ri-door-open-line"></i> ${doorCount} ${doorCount === 1 ? 'conexión' : 'conexiones'}</span>
              </div>
            </div>
            <div class="modal-map-actions">
              ${isExpanded ? `
                <button class="btn-subtle btn-modal-header-save" data-map-id="${id}" title="Guardar cambios de esta sala">
                  <i class="ri-check-line"></i> Guardar
                </button>
                <button class="btn-subtle btn-modal-header-cancel" data-map-id="${id}" title="Descartar cambios y cancelar edición">
                  <i class="ri-close-line"></i> Cancelar
                </button>
              ` : `
                <button class="btn-subtle btn-modal-toggle-edit" data-map-id="${id}" title="Editar nombre, plantilla y dimensiones">
                  <i class="ri-edit-line"></i> Editar
                </button>
                <button class="btn-subtle primary-btn btn-modal-switch-and-draw" data-map-id="${id}" title="Seleccionar sala y dibujar en el lienzo">
                  <i class="ri-brush-line"></i> Dibujar
                </button>
              `}
              <button class="btn-icon-chip btn-modal-start-map ${isStart ? 'active-flag' : ''}" data-map-id="${id}" title="${isStart ? 'Esta sala es el inicio del juego' : 'Definir como sala inicial (Spawn)'}">
                <i class="${isStart ? 'ri-flag-fill' : 'ri-flag-line'}"></i>
              </button>
              <button class="btn-icon-chip btn-modal-duplicate-map" data-map-id="${id}" title="Duplicar esta sala"><i class="ri-file-copy-line"></i></button>
              <button class="btn-icon-chip danger btn-modal-delete-map" data-map-id="${id}" ${mapIds.length <= 1 ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''} title="Eliminar sala"><i class="ri-delete-bin-line"></i></button>
            </div>
          </div>

          ${isExpanded ? `
            <div class="modal-map-edit-tray" data-map-id="${id}">
              <div class="room-edit-grid">
                <div class="room-edit-field">
                  <label><i class="ri-edit-line"></i> Nombre de la Sala:</label>
                  <input type="text" class="room-edit-name-input" data-map-id="${id}" value="${m.name || id}" placeholder="Nombre de la sala...">
                </div>
                <div class="room-edit-field">
                  <label><i class="ri-flashlight-line"></i> Plantilla Predefinida:</label>
                  <select class="room-edit-preset-select" data-map-id="${id}">
                    <option value="custom" selected>Personalizada</option>
                    <option value="4doors">1. Sala 4 Puertas (7x7)</option>
                    <option value="twoRooms">2. 2 Salas Conectadas (14x8)</option>
                    <option value="crossRooms">3. 4 Habitaciones / Cruce (12x12)</option>
                    <option value="hallway">4. Pasillo Central y Cámaras (15x9)</option>
                    <option value="maze">5. Mini Laberinto (11x11)</option>
                  </select>
                </div>
              </div>

              <div class="room-edit-dim-row">
                <div class="room-dim-inputs">
                  <div class="input-group compact">
                    <label>Cols (X):</label>
                    <input type="number" class="room-edit-cols-input" data-map-id="${id}" min="5" max="50" value="${cols}">
                  </div>
                  <div class="input-group compact">
                    <label>Filas (Y):</label>
                    <input type="number" class="room-edit-rows-input" data-map-id="${id}" min="5" max="50" value="${rows}">
                  </div>
                </div>
                <div class="quick-sizes-box">
                  <span class="quick-sizes-label">Tamaños rápidos:</span>
                  <div class="quick-sizes compact">
                    <button class="btn-chip btn-room-chip ${cols===8 && rows===8 ? 'active':''}" data-cols="8" data-rows="8">8x8</button>
                    <button class="btn-chip btn-room-chip ${cols===12 && rows===12 ? 'active':''}" data-cols="12" data-rows="12">12x12</button>
                    <button class="btn-chip btn-room-chip ${cols===16 && rows===16 ? 'active':''}" data-cols="16" data-rows="16">16x16</button>
                    <button class="btn-chip btn-room-chip ${cols===20 && rows===20 ? 'active':''}" data-cols="20" data-rows="20">20x20</button>
                  </div>
                </div>
              </div>

              <div class="room-edit-actions-row">
                <div class="room-edit-actions-left">
                  <button class="btn-subtle primary-btn btn-room-save" data-map-id="${id}" title="Confirmar y guardar el nombre y dimensiones">
                    <i class="ri-check-line"></i> Guardar Cambios
                  </button>
                  <button class="btn-subtle btn-room-cancel" data-map-id="${id}" title="Descartar cambios y cerrar edición">
                    <i class="ri-close-line"></i> Cancelar
                  </button>
                  <button class="btn-subtle danger btn-room-clear" data-map-id="${id}" title="Vaciar todo el interior del mapa conservando perímetro">
                    <i class="ri-delete-bin-line"></i> Vaciar Sala
                  </button>
                </div>
                <div class="room-edit-actions-right">
                  <button class="btn-subtle btn-room-draw" data-map-id="${id}" title="Guardar cambios e ir directamente a dibujar en el lienzo">
                    <i class="ri-brush-line"></i> Guardar y Dibujar
                  </button>
                </div>
              </div>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    // Toggle expand/collapse edit tray
    this.modalMapListContainer.querySelectorAll('.btn-modal-toggle-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.mapId;
        if (this.expandedMapId === id) {
          this.expandedMapId = null;
        } else {
          this.expandedMapId = id;
        }
        this.renderModalMapList();
      });
    });

    // Switch map & draw (direct from card header)
    this.modalMapListContainer.querySelectorAll('.btn-modal-switch-and-draw').forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchMap(btn.dataset.mapId);
        this.closeProjectModal();
      });
    });

    // Enter key on name input to save
    this.modalMapListContainer.querySelectorAll('.room-edit-name-input').forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const tray = input.closest('.modal-map-edit-tray');
          const saveBtn = tray ? tray.querySelector('.btn-room-save') : null;
          if (saveBtn) saveBtn.click();
        }
      });
    });

    // Preset select in tray
    this.modalMapListContainer.querySelectorAll('.room-edit-preset-select').forEach(select => {
      select.addEventListener('change', () => {
        const id = select.dataset.mapId;
        const val = select.value;
        if (val === 'custom') return;
        if (this.currentMapId !== id) {
          this.switchMap(id);
        }
        const presetLabels = {
          '4doors': '1. Sala 4 Puertas (7x7)',
          'twoRooms': '2. 2 Salas Conectadas (14x8)',
          'crossRooms': '3. 4 Habitaciones / Cruce (12x12)',
          'hallway': '4. Pasillo Central y Cámaras (15x9)',
          'maze': '5. Mini Laberinto (11x11)'
        };
        const label = presetLabels[val] || val;

        const doApply = () => {
          this.backupCurrentMap();
          this.applyPreset(val);
          this.saveProjectsToStorage();
          this.renderModalMapList();
        };

        if (this.hasMapContent()) {
          this.showConfirmDialog({
            title: '¿Cargar plantilla?',
            message: `Vas a cargar "${label}". Se reemplazará el mapa actual y se perderá lo que hayas dibujado.`,
            acceptText: 'Cargar Plantilla',
            isDanger: true,
            onAccept: doApply,
            onCancel: () => {
              select.value = 'custom';
            }
          });
        } else {
          doApply();
        }
      });
    });

    // Quick size chips in tray
    this.modalMapListContainer.querySelectorAll('.btn-room-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const tray = chip.closest('.modal-map-edit-tray');
        if (!tray) return;
        const colsInput = tray.querySelector('.room-edit-cols-input');
        const rowsInput = tray.querySelector('.room-edit-rows-input');
        if (colsInput) colsInput.value = chip.dataset.cols;
        if (rowsInput) rowsInput.value = chip.dataset.rows;
        tray.querySelectorAll('.btn-room-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
    });

    // Helper to commit changes
    const commitRoomChanges = (id, tray, callback) => {
      const nameInput = tray.querySelector('.room-edit-name-input');
      const colsInput = tray.querySelector('.room-edit-cols-input');
      const rowsInput = tray.querySelector('.room-edit-rows-input');
      const newName = nameInput ? (nameInput.value.trim() || 'Sala') : 'Sala';
      const newCols = colsInput ? parseInt(colsInput.value, 10) : this.cols;
      const newRows = rowsInput ? parseInt(rowsInput.value, 10) : this.rows;

      if (isNaN(newCols) || isNaN(newRows) || newCols < 5 || newRows < 5 || newCols > 50 || newRows > 50) {
        this.showToast('⚠️ Las dimensiones deben estar entre 5 y 50');
        return;
      }

      const targetMap = this.currentProject.maps[id];
      if (!targetMap) return;

      const currentCols = targetMap.map ? targetMap.map[0].length : 12;
      const currentRows = targetMap.map ? targetMap.map.length : 12;
      const isShrinking = (newCols < currentCols || newRows < currentRows);

      const apply = () => {
        targetMap.name = newName;
        if (this.currentMapId === id) {
          this.mapName = newName;
          if (newCols !== this.cols || newRows !== this.rows) {
            this.backupCurrentMap();
            this.resizeGrid(newCols, newRows);
          }
        } else {
          // If not active on canvas, switch to it to resize cleanly
          this.switchMap(id);
          if (newCols !== this.cols || newRows !== this.rows) {
            this.backupCurrentMap();
            this.resizeGrid(newCols, newRows);
          }
        }
        targetMap.name = newName;
        this.saveProjectsToStorage();
        this.renderMapDropdown();
        this.showToast(`💾 Cambios guardados en "${newName}"`);
        if (callback) callback();
      };

      if (isShrinking) {
        this.showConfirmDialog({
          title: '¿Confirmar cambio de dimensiones?',
          message: `El mapa se reducirá de ${currentCols}x${currentRows} a ${newCols}x${newRows}. Las paredes o elementos que queden fuera se recortarán.`,
          acceptText: 'Guardar Cambios',
          isDanger: true,
          onAccept: apply
        });
      } else {
        apply();
      }
    };

    // Botón Guardar Cambios (desde bandeja o cabecera de tarjeta)
    const handleSave = (id, tray) => {
      if (!tray) return;
      commitRoomChanges(id, tray, () => {
        this.expandedMapId = null;
        this.renderModalMapList();
      });
    };

    this.modalMapListContainer.querySelectorAll('.btn-room-save').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.mapId;
        const tray = btn.closest('.modal-map-edit-tray');
        handleSave(id, tray);
      });
    });

    this.modalMapListContainer.querySelectorAll('.btn-modal-header-save').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.mapId;
        const card = btn.closest('.modal-map-card');
        const tray = card ? card.querySelector('.modal-map-edit-tray') : null;
        handleSave(id, tray);
      });
    });

    // Botón Cancelar (desde bandeja o cabecera de tarjeta)
    const handleCancel = () => {
      this.expandedMapId = null;
      this.renderModalMapList();
      this.showToast('↩️ Edición cancelada');
    };

    this.modalMapListContainer.querySelectorAll('.btn-room-cancel').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleCancel();
      });
    });

    this.modalMapListContainer.querySelectorAll('.btn-modal-header-cancel').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleCancel();
      });
    });

    // Botón Guardar y Dibujar
    this.modalMapListContainer.querySelectorAll('.btn-room-draw').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.mapId;
        const tray = btn.closest('.modal-map-edit-tray');
        if (!tray) return;
        commitRoomChanges(id, tray, () => {
          this.switchMap(id);
          this.closeProjectModal();
        });
      });
    });

    // Clear room in tray
    this.modalMapListContainer.querySelectorAll('.btn-room-clear').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.mapId;
        if (this.currentMapId !== id) {
          this.switchMap(id);
        }
        this.showConfirmDialog({
          title: '¿Vaciar sala?',
          message: 'Se borrarán todos los muros y accesorios interiores conservando el perímetro exterior.',
          acceptText: 'Vaciar Sala',
          isDanger: true,
          onAccept: () => {
            this.backupCurrentMap();
            this.clearMap();
            this.saveProjectsToStorage();
            this.renderModalMapList();
            this.showToast('🧹 Sala vaciada');
          }
        });
      });
    });

    // Done button in tray
    this.modalMapListContainer.querySelectorAll('.btn-room-done').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.mapId;
        if (this.currentMapId !== id) {
          this.switchMap(id);
        }
        this.closeProjectModal();
      });
    });

    // Set starting room (spawn)
    this.modalMapListContainer.querySelectorAll('.btn-modal-start-map').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setStartingMap(btn.dataset.mapId);
        this.renderModalMapList();
      });
    });

    // Duplicate room
    this.modalMapListContainer.querySelectorAll('.btn-modal-duplicate-map').forEach(btn => {
      btn.addEventListener('click', () => {
        this.duplicateMapById(btn.dataset.mapId);
        this.renderModalMapList();
      });
    });

    // Delete room
    this.modalMapListContainer.querySelectorAll('.btn-modal-delete-map').forEach(btn => {
      btn.addEventListener('click', () => {
        this.deleteMapById(btn.dataset.mapId);
      });
    });

    // Auto-scroll to expanded room card if opened
    if (this.expandedMapId) {
      const el = this.modalMapListContainer.querySelector('.modal-map-card.expanded');
      if (el) {
        setTimeout(() => {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 60);
      }
    }
  }

  renderProjectList() {
    const container = document.getElementById('projectListContainer');
    if (!container) return;

    const projIds = Object.keys(this.projects);
    container.innerHTML = projIds.map(id => {
      const p = this.projects[id];
      const isActive = (id === this.currentProjectId);
      const mapCount = p.maps ? Object.keys(p.maps).length : 0;
      const updatedStr = p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : 'Reciente';

      return `
        <div class="project-card ${isActive ? 'active' : ''}" data-project-id="${id}">
          <div class="project-card-info">
            <div class="project-card-title-row">
              <h4 class="project-card-name">${p.name || 'Sin Nombre'}</h4>
              ${isActive ? '<span class="project-active-badge"><i class="ri-check-line"></i> Activo</span>' : ''}
            </div>
            <div class="project-card-meta">
              <span><i class="ri-map-2-line"></i> ${mapCount} ${mapCount === 1 ? 'mapa' : 'mapas'}</span>
              <span>•</span>
              <span><i class="ri-time-line"></i> ${updatedStr}</span>
            </div>
          </div>
          <div class="project-card-actions">
            ${!isActive ? `<button class="btn-subtle primary-btn btn-switch-proj" data-project-id="${id}" title="Abrir y editar este proyecto"><i class="ri-folder-open-line"></i> Abrir</button>` : ''}
            <button class="btn-subtle btn-generate-game-proj" data-project-id="${id}" title="Generar archivo HTML autónomo para jugar a '${p.name || 'este proyecto'}'">
              <i class="ri-rocket-2-line"></i> Generar Juego
            </button>
            <button class="btn-icon-chip btn-rename-proj" data-project-id="${id}" title="Renombrar proyecto"><i class="ri-edit-line"></i></button>
            <button class="btn-icon-chip btn-export-proj" data-project-id="${id}" title="Descargar copia en JSON"><i class="ri-download-2-line"></i></button>
            <button class="btn-icon-chip danger btn-delete-proj" data-project-id="${id}" ${projIds.length <= 1 ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''} title="Eliminar proyecto"><i class="ri-delete-bin-line"></i></button>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.btn-switch-proj').forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchProject(btn.dataset.projectId);
      });
    });

    container.querySelectorAll('.btn-generate-game-proj').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.generateStandaloneGame(btn.dataset.projectId);
      });
    });

    container.querySelectorAll('.btn-rename-proj').forEach(btn => {
      btn.addEventListener('click', () => {
        this.promptRenameProject(btn.dataset.projectId);
      });
    });

    container.querySelectorAll('.btn-export-proj').forEach(btn => {
      btn.addEventListener('click', () => {
        this.exportProjectJson(btn.dataset.projectId);
      });
    });

    container.querySelectorAll('.btn-delete-proj').forEach(btn => {
      btn.addEventListener('click', () => {
        this.deleteProject(btn.dataset.projectId);
      });
    });
  }

  createNewProject(name = '') {
    const projCount = Object.keys(this.projects).length + 1;
    const projName = name.trim() || `Proyecto ${projCount}`;
    const newProjId = 'proj_' + Date.now();
    const defaultMapId = 'map_1';
    const defaultMap = this.createDefaultMapObject(defaultMapId, 'Sala Principal', 12, 12);

    this.saveProjectsToStorage();

    this.projects[newProjId] = {
      id: newProjId,
      name: projName,
      version: 2,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      startingMapId: defaultMapId,
      maps: {
        [defaultMapId]: defaultMap
      }
    };

    this.switchProject(newProjId);
    this.showToast(`✨ Nuevo proyecto creado: ${projName}`);
  }

  switchProject(projId) {
    if (!this.projects[projId]) return;
    this.saveProjectsToStorage();

    this.currentProjectId = projId;
    this.currentProject = this.projects[projId];
    if (!this.currentProject.startingMapId || !this.currentProject.maps[this.currentProject.startingMapId]) {
      this.currentProject.startingMapId = Object.keys(this.currentProject.maps)[0];
    }
    this.currentMapId = this.currentProject.startingMapId;
    this.syncCustomStylesFromProject();
    this.loadLevelData(this.currentProject.maps[this.currentMapId]);
    this.updateHeaderProject();
    this.renderMapDropdown();
    this.closeProjectModal();
    this.resizeCanvas();
    this.render();
    this.updateJSON();
    this.showToast(`📂 Proyecto cargado: ${this.currentProject.name}`);
  }

  promptRenameProject(projId) {
    const p = this.projects[projId];
    if (!p) return;
    const newName = prompt('Nombre para este proyecto:', p.name);
    if (newName && newName.trim() && newName.trim() !== p.name) {
      p.name = newName.trim();
      p.updatedAt = Date.now();
      this.updateHeaderProject();
      this.saveProjectsToStorage();
      this.renderProjectList();
      this.renderProjectDropdown();
      this.showToast(`✏️ Proyecto renombrado a: ${p.name}`);
    }
  }

  deleteProject(projId) {
    const projIds = Object.keys(this.projects);
    if (projIds.length <= 1) {
      this.showToast('⚠️ No puedes eliminar el único proyecto existente');
      return;
    }
    const p = this.projects[projId];
    if (!p) return;

    this.showConfirmDialog({
      title: `¿Eliminar "${p.name}"?`,
      message: 'Se eliminarán permanentemente todos los mapas y configuraciones de este proyecto.',
      acceptText: 'Eliminar Proyecto',
      isDanger: true,
      onAccept: () => {
        delete this.projects[projId];
        if (this.currentProjectId === projId) {
          const nextId = Object.keys(this.projects)[0];
          this.switchProject(nextId);
        } else {
          this.saveProjectsToStorage();
          this.renderProjectList();
          this.renderProjectDropdown();
        }
        this.showToast(`🗑️ Proyecto eliminado`);
      }
    });
  }

  exportProjectJson(projId) {
    const p = this.projects[projId];
    if (!p) return;
    this.saveProjectsToStorage();
    const jsonStr = JSON.stringify(p, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = p.name.replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase();
    a.download = `${safeName}_proyecto.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast(`💾 Proyecto exportado en JSON`);
  }

  importProjectJson(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data || typeof data !== 'object') throw new Error('Archivo inválido');

        if (data.maps && typeof data.maps === 'object') {
          const newId = 'proj_' + Date.now();
          data.id = newId;
          data.name = (data.name || 'Proyecto Importado') + ' (Importado)';
          data.updatedAt = Date.now();
          this.projects[newId] = data;
          this.switchProject(newId);
          this.showToast('✅ ¡Proyecto importado con éxito!');
        } else if (data.map && Array.isArray(data.map)) {
          const newId = 'proj_' + Date.now();
          const mapId = 'map_1';
          data.id = mapId;
          data.doorLinks = data.doorLinks || {};
          this.projects[newId] = {
            id: newId,
            name: (data.name || 'Mapa Importado') + ' (Proyecto)',
            version: 2,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            startingMapId: mapId,
            maps: {
              [mapId]: data
            }
          };
          this.switchProject(newId);
          this.showToast('✅ ¡Mapa importado como nuevo proyecto!');
        } else {
          throw new Error('El formato JSON no corresponde a un proyecto ni a un mapa válido.');
        }
      } catch (err) {
        alert('Error al importar el proyecto JSON: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  /* ==========================================================================
     GESTIÓN DE MAPAS DENTRO DEL PROYECTO
     ========================================================================== */

  renderMapDropdown() {
    if (!this.selectActiveMap || !this.currentProject) return;
    const mapIds = Object.keys(this.currentProject.maps);
    this.selectActiveMap.innerHTML = mapIds.map(id => {
      const m = this.currentProject.maps[id];
      const isStart = (id === this.currentProject.startingMapId);
      return `<option value="${id}" ${id === this.currentMapId ? 'selected' : ''}>${isStart ? '⚑ ' : ''}${m.name || id}</option>`;
    }).join('');

    const isCurrentStarting = (this.currentMapId === this.currentProject.startingMapId);
    if (this.iconStartingMap) {
      this.iconStartingMap.classList.toggle('hidden', !isCurrentStarting);
    }

    if (this.modalMapCountBadge) {
      this.modalMapCountBadge.textContent = mapIds.length;
    }

    if (this.modalActiveRoomNameDisplay && this.currentMapId && this.currentProject.maps[this.currentMapId]) {
      this.modalActiveRoomNameDisplay.textContent = this.currentProject.maps[this.currentMapId].name || 'Sala';
    }

    if (this.modalActiveRoomSpawnBadge && this.currentMapId) {
      this.modalActiveRoomSpawnBadge.style.display = isCurrentStarting ? '' : 'none';
    }

    if (this.btnDeleteMap) {
      this.btnDeleteMap.disabled = (mapIds.length <= 1);
      this.btnDeleteMap.title = (mapIds.length <= 1) ? 'No se puede eliminar el único mapa' : 'Eliminar este mapa del proyecto';
    }
  }

  renderProjectDropdown() {
    if (!this.selectActiveProject) return;
    const ids = Object.keys(this.projects);
    this.selectActiveProject.innerHTML = ids.map(id => {
      const p = this.projects[id];
      return `<option value="${id}" ${id === this.currentProjectId ? 'selected' : ''}>${p.name || id}</option>`;
    }).join('');
  }

  switchMap(mapId) {
    if (!this.currentProject || !this.currentProject.maps[mapId]) return;
    if (mapId === this.currentMapId) return;

    this.saveProjectsToStorage();
    this.currentMapId = mapId;
    this.loadLevelData(this.currentProject.maps[mapId]);
    this.renderMapDropdown();
    this.resizeCanvas();
    this.render();
    this.updateJSON();
    this.showToast(`🗺️ Sala activa: ${this.currentProject.maps[mapId].name}`);
  }

  createMapInProject() {
    if (!this.currentProject) return;
    const mapCount = Object.keys(this.currentProject.maps).length + 1;
    const newMapId = 'map_' + Date.now();
    const newMapName = `Sala ${mapCount}`;

    this.saveProjectsToStorage();

    const newMap = this.createDefaultMapObject(newMapId, newMapName, 12, 12);
    this.currentProject.maps[newMapId] = newMap;
    this.switchMap(newMapId);
    this.expandedMapId = newMapId;
    this.renderModalMapList();
    this.showToast(`✨ Nueva sala creada: ${newMapName}`);
  }

  duplicateMapById(mapId) {
    if (!this.currentProject || !this.currentProject.maps[mapId]) return;
    this.saveProjectsToStorage();

    const targetMap = this.currentProject.maps[mapId];
    const newMapId = 'map_' + Date.now();
    const duplicated = JSON.parse(JSON.stringify(targetMap));
    duplicated.id = newMapId;
    duplicated.name = `${targetMap.name || 'Sala'} (Copia)`;
    this.currentProject.maps[newMapId] = duplicated;

    this.switchMap(newMapId);
    this.expandedMapId = newMapId;
    this.renderModalMapList();
    this.showToast(`📋 Sala duplicada: ${duplicated.name}`);
  }

  duplicateCurrentMap() {
    this.duplicateMapById(this.currentMapId);
  }

  deleteMapById(mapId) {
    if (!this.currentProject) return;
    const mapIds = Object.keys(this.currentProject.maps);
    if (mapIds.length <= 1) {
      this.showToast('⚠️ No puedes eliminar el único mapa del proyecto');
      return;
    }

    const targetName = this.currentProject.maps[mapId]?.name || 'esta sala';
    this.showConfirmDialog({
      title: `¿Eliminar "${targetName}"?`,
      message: 'Esta acción borrará la sala y todas sus conexiones de puertas en este proyecto.',
      acceptText: 'Eliminar Sala',
      isDanger: true,
      onAccept: () => {
        delete this.currentProject.maps[mapId];
        if (this.currentProject.startingMapId === mapId) {
          this.currentProject.startingMapId = Object.keys(this.currentProject.maps)[0];
        }
        if (this.currentMapId === mapId) {
          const remainingId = this.currentProject.startingMapId || Object.keys(this.currentProject.maps)[0];
          this.currentMapId = remainingId;
          this.loadLevelData(this.currentProject.maps[remainingId]);
          this.resizeCanvas();
          this.render();
          this.updateJSON();
        }
        this.renderMapDropdown();
        this.renderModalMapList();
        this.saveProjectsToStorage();
        this.showToast(`🗑️ Sala "${targetName}" eliminada`);
      }
    });
  }

  deleteCurrentMap() {
    this.deleteMapById(this.currentMapId);
  }

  setStartingMap(mapId) {
    if (!this.currentProject || !this.currentProject.maps[mapId]) return;
    this.currentProject.startingMapId = mapId;
    this.renderMapDropdown();
    this.renderModalMapList();
    this.saveProjectsToStorage();
    this.showToast(`🚩 "${this.currentProject.maps[mapId].name}" marcada como mapa de inicio`);
  }

  /* ==========================================================================
     CONEXIÓN DE PUERTAS (PORTALES INTER-MAPA)
     ========================================================================== */

  setupDoorLinkEventListeners() {
    if (this.btnOpenDoorLinksModal) {
      this.btnOpenDoorLinksModal.addEventListener('click', () => this.openDoorLinksModal());
    }

    const modalClose = document.getElementById('doorLinkModalClose');
    const btnCancel = document.getElementById('btnCancelDoorLink');
    if (modalClose) modalClose.addEventListener('click', () => this.closeDoorLinksModal());
    if (btnCancel) btnCancel.addEventListener('click', () => this.closeDoorLinksModal());

    const selectDoor = document.getElementById('selectDoorToConfigure');
    const selectTargetMap = document.getElementById('selectDoorTargetMap');
    const selectArrivalMode = document.getElementById('selectDoorArrivalMode');
    const btnSave = document.getElementById('btnSaveDoorLink');
    const btnRemove = document.getElementById('btnRemoveDoorLink');

    if (selectDoor) {
      selectDoor.addEventListener('change', () => this.onDoorSelectChanged());
    }
    if (selectTargetMap) {
      selectTargetMap.addEventListener('change', () => this.onTargetMapChanged());
    }
    if (selectArrivalMode) {
      selectArrivalMode.addEventListener('change', () => {
        const isCustom = (selectArrivalMode.value === 'custom');
        const row = document.getElementById('rowCustomArrivalCoords');
        if (row) row.style.display = isCustom ? 'flex' : 'none';
      });
    }

    if (btnSave) {
      btnSave.addEventListener('click', () => this.saveDoorLink());
    }
    if (btnRemove) {
      btnRemove.addEventListener('click', () => this.removeDoorLink());
    }
  }

  scanCurrentMapDoors() {
    const doors = [];
    if (!this.grid || !Array.isArray(this.grid)) return doors;
    const dirNames = { 'DN': 'Norte', 'DS': 'Sur', 'DE': 'Este', 'DW': 'Oeste' };

    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const cell = this.grid[y] && this.grid[y][x];
        if (!cell) continue;
        const segs = Array.isArray(cell) ? cell : (typeof cell === 'number' && cell >= 2 && cell <= 5 ? [['DN'],['DE'],['DS'],['DW']][cell-2] : []);
        segs.forEach(s => {
          if (s === 'DN' || s === 'DS' || s === 'DE' || s === 'DW') {
            const key = `${x},${y},${s}`;
            doors.push({
              x,
              y,
              dir: s,
              key,
              label: `Puerta ${dirNames[s]} en [${x}, ${y}]`
            });
          }
        });
      }
    }
    return doors;
  }

  openDoorLinksModal() {
    const doors = this.scanCurrentMapDoors();
    const selectDoor = document.getElementById('selectDoorToConfigure');
    const selectTargetMap = document.getElementById('selectDoorTargetMap');

    if (doors.length === 0) {
      this.showToast('⚠️ No hay ninguna puerta colocada en este mapa. Coloca una primero.');
      return;
    }

    if (selectDoor) {
      selectDoor.innerHTML = doors.map(d => {
        const hasLink = !!(this.doorLinks && (this.doorLinks[d.key] || this.doorLinks[`${d.x},${d.y}`]));
        return `<option value="${d.key}">${d.label} ${hasLink ? '🌀 (Conectada)' : ''}</option>`;
      }).join('');
    }

    if (selectTargetMap && this.currentProject) {
      const mapOptions = Object.keys(this.currentProject.maps).map(id => {
        const m = this.currentProject.maps[id];
        const isCurrent = (id === this.currentMapId);
        return `<option value="${id}">${m.name || id} ${isCurrent ? '(Esta sala)' : ''}</option>`;
      }).join('');
      selectTargetMap.innerHTML = `
        <option value="none">-- Puerta normal (sin conexión a otro mapa) --</option>
        ${mapOptions}
      `;
    }

    this.onDoorSelectChanged();
    if (this.doorLinkModalOverlay) this.doorLinkModalOverlay.hidden = false;
  }

  closeDoorLinksModal() {
    if (this.doorLinkModalOverlay) this.doorLinkModalOverlay.hidden = true;
  }

  onDoorSelectChanged() {
    const selectDoor = document.getElementById('selectDoorToConfigure');
    const selectTargetMap = document.getElementById('selectDoorTargetMap');
    const selectArrivalMode = document.getElementById('selectDoorArrivalMode');
    const rowCoords = document.getElementById('rowCustomArrivalCoords');
    const btnRemove = document.getElementById('btnRemoveDoorLink');
    const arrivalBox = document.getElementById('doorLinkArrivalBox');

    if (!selectDoor) return;
    const doorKey = selectDoor.value;
    const parts = doorKey.split(',');
    const fallbackKey = parts.length >= 2 ? `${parts[0]},${parts[1]}` : null;
    const existingLink = (this.doorLinks && (this.doorLinks[doorKey] || (fallbackKey && this.doorLinks[fallbackKey])));

    if (existingLink && selectTargetMap) {
      selectTargetMap.value = existingLink.targetMapId || 'none';
      if (arrivalBox) arrivalBox.style.display = (existingLink.targetMapId && existingLink.targetMapId !== 'none') ? 'block' : 'none';
      if (selectArrivalMode) selectArrivalMode.value = existingLink.arrivalMode || 'spawn';
      if (rowCoords) rowCoords.style.display = (existingLink.arrivalMode === 'custom') ? 'flex' : 'none';
      const inX = document.getElementById('inputDoorTargetX');
      const inY = document.getElementById('inputDoorTargetY');
      if (inX) inX.value = (typeof existingLink.targetX === 'number') ? existingLink.targetX : 1.5;
      if (inY) inY.value = (typeof existingLink.targetY === 'number') ? existingLink.targetY : 1.5;
      if (btnRemove) btnRemove.style.display = 'inline-flex';
    } else {
      if (selectTargetMap) selectTargetMap.value = 'none';
      if (arrivalBox) arrivalBox.style.display = 'none';
      if (selectArrivalMode) selectArrivalMode.value = 'spawn';
      if (rowCoords) rowCoords.style.display = 'none';
      if (btnRemove) btnRemove.style.display = 'none';
    }
  }

  onTargetMapChanged() {
    const selectTargetMap = document.getElementById('selectDoorTargetMap');
    const arrivalBox = document.getElementById('doorLinkArrivalBox');
    const val = selectTargetMap ? selectTargetMap.value : 'none';
    if (arrivalBox) {
      arrivalBox.style.display = (val && val !== 'none') ? 'block' : 'none';
    }
  }

  saveDoorLink() {
    const selectDoor = document.getElementById('selectDoorToConfigure');
    const selectTargetMap = document.getElementById('selectDoorTargetMap');
    const selectArrivalMode = document.getElementById('selectDoorArrivalMode');
    if (!selectDoor || !selectTargetMap) return;

    const doorKey = selectDoor.value;
    const targetMapId = selectTargetMap.value;

    if (!this.doorLinks) this.doorLinks = {};

    if (!targetMapId || targetMapId === 'none') {
      delete this.doorLinks[doorKey];
      const parts = doorKey.split(',');
      if (parts.length >= 2) delete this.doorLinks[`${parts[0]},${parts[1]}`];
      this.showToast('🚪 Puerta configurada como normal (sin portal)');
    } else {
      const arrivalMode = selectArrivalMode ? selectArrivalMode.value : 'spawn';
      const inX = document.getElementById('inputDoorTargetX');
      const inY = document.getElementById('inputDoorTargetY');
      const targetX = inX ? parseFloat(inX.value) || 1.5 : 1.5;
      const targetY = inY ? parseFloat(inY.value) || 1.5 : 1.5;

      this.doorLinks[doorKey] = {
        targetMapId,
        arrivalMode,
        targetX,
        targetY
      };
      const targetName = (this.currentProject.maps[targetMapId] && this.currentProject.maps[targetMapId].name) || targetMapId;
      this.showToast(`🌀 ¡Puerta conectada con "${targetName}"!`);
    }

    this.closeDoorLinksModal();
    this.saveProjectsToStorage();
    this.render();
    this.updateJSON();
  }

  removeDoorLink() {
    const selectDoor = document.getElementById('selectDoorToConfigure');
    if (!selectDoor) return;
    const doorKey = selectDoor.value;
    if (this.doorLinks) {
      delete this.doorLinks[doorKey];
      const parts = doorKey.split(',');
      if (parts.length >= 2) delete this.doorLinks[`${parts[0]},${parts[1]}`];
    }
    this.closeDoorLinksModal();
    this.saveProjectsToStorage();
    this.render();
    this.updateJSON();
    this.showToast('Portal desconectado. Ahora es una puerta normal.');
  }

  /* ==========================================================================
     GENERADOR DE JUEGO AUTÓNOMO (HTML INDEPENDIENTE)
     ========================================================================== */

  async generateStandaloneGame(targetProjectId = null) {
    this.saveProjectsToStorage();
    const pid = targetProjectId || this.currentProjectId;
    const projectToExport = this.projects[pid] || this.currentProject;
    if (!projectToExport) {
      this.showToast('⚠️ No se encontró el proyecto seleccionado');
      return;
    }

    const projectName = projectToExport.name || 'Laberinto 3D';
    const safeProjectName = projectName.replace(/[^a-zA-Z0-9_\-]/g, '_');
    this.showToast(`⏳ Empaquetando juego de "${projectName}"...`);

    try {
      const [styleRes, texturesRes, raycasterRes, gameRes, demoHtmlRes] = await Promise.all([
        fetch('../demo/style.css'),
        fetch('../engine/textures.js'),
        fetch('../engine/raycaster.js'),
        fetch('../demo/game.js'),
        fetch('../demo/index.html')
      ]);

      const styleCss = await styleRes.text();
      const texturesJs = await texturesRes.text();
      const raycasterJs = await raycasterRes.text();
      const gameJs = await gameRes.text();
      const demoHtml = await demoHtmlRes.text();

      const bodyMatch = demoHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      let bodyContent = bodyMatch ? bodyMatch[1] : '';

      bodyContent = bodyContent.replace(/<script\s+src="[^"]+"><\/script>/gi, '');

      const customCss = `
        /* Ocultar accesos a editor y hub en juego independiente */
        #btnOpenEditor, #btnOpenHub { display: none !important; }
        .header-info { display: flex; gap: 8px; align-items: center; }
      `;

      const standaloneHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${projectName} - Juego 3D Autónomo</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Rajdhani:wght@500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/remixicon@4.5.0/fonts/remixicon.css">
  <style>
${styleCss}
${customCss}
  </style>
</head>
<body>
${bodyContent}

  <!-- DATOS DEL PROYECTO INCLUIDOS DE FORMA AUTÓNOMA -->
  <script>
    window.STANDALONE_PROJECT = ${JSON.stringify(projectToExport, null, 2)};
  </script>

  <!-- MOTOR PROCEDURAL DE TEXTURAS -->
  <script>
${texturesJs}
  </script>

  <!-- MOTOR RAYCASTER 2.5D -->
  <script>
${raycasterJs}
  </script>

  <!-- LÓGICA DE JUEGO & TRANSICIONES DE MAPAS -->
  <script>
${gameJs}
  </script>
</body>
</html>`;

      const blob = new Blob([standaloneHtml], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeProjectName}_Juego.html`;
      a.click();
      URL.revokeObjectURL(url);

      this.showToast(`🎮 ¡Juego "${projectName}" generado! Listo para jugar.`);
    } catch (err) {
      console.error('Error generando juego autónomo:', err);
      alert('Error al generar el archivo autónomo: ' + err.message);
    }
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

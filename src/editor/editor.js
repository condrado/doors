/**
 * Lógica del Editor Visual de Niveles y Generador de JSON
 */

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

    // Herramientas y selección
    this.currentTool = 'brush'; // 'brush', 'room', 'eraser'
    this.selectedTile = 1; // 1 = pared, 0 = suelo, 'accessories' = accesorios, 'player' = spawn
    this.selectedAccessory = 'door'; // 'door', 'window'
    this.isMouseDown = false;
    this.roomStart = null;
    this.hoverCell = { x: -1, y: -1 };

    // Colocación y Rotación de tabique (5x1)
    this.placementMode = 'corner_CENTER_CROSS';
    this.rotation = 'H'; // 'H' (Horizontal ━) o 'V' (Vertical ┃)
    this.hoverSubEdge = 'corner_CENTER_CROSS';

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

    this.initDefaultMap();
    this.setupEventListeners();
    this.resizeCanvas();
    this.render();
    this.updateJSON();
  }

  /**
   * Inicializa un mapa base con tabiques finos (5x1) en los bordes y esquinas
   */
  initDefaultMap() {
    this.grid = [];
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
      });
    });

    // Secciones plegables y desplegables (Accordion)
    document.querySelectorAll('.tool-section').forEach(section => {
      const header = section.querySelector('h2');
      if (header) {
        header.addEventListener('click', () => {
          section.classList.toggle('collapsed');
        });
      }
    });

    // Selector de categorías de paredes (Laterales, Centro, Uniones T)
    document.querySelectorAll('.wall-cat-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.wall-cat-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const target = tab.dataset.tab;
        const pLaterales = document.getElementById('panelLaterales');
        const pCentro = document.getElementById('panelCentro');
        const pUnionesT = document.getElementById('panelUnionesT');

        if (pLaterales) pLaterales.classList.add('hidden');
        if (pCentro) pCentro.classList.add('hidden');
        if (pUnionesT) pUnionesT.classList.add('hidden');

        if (target === 'laterales' && pLaterales) pLaterales.classList.remove('hidden');
        else if (target === 'centro' && pCentro) pCentro.classList.remove('hidden');
        else if (target === 'uniones-t' && pUnionesT) pUnionesT.classList.remove('hidden');
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
          return;
        }

        const mode = btn.dataset.mode;
        if (!mode) return;

        document.querySelectorAll('.wall-tile-btn, .wall-aux-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.placementMode = mode;
        this.showToast(`Modo: ${btn.title}`);
        this.render();
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

    // Controles de Zoom
    document.getElementById('btnZoomIn').addEventListener('click', () => {
      this.zoomMode = 'manual';
      this.cellSize = Math.min(60, this.cellSize + 4);
      this.resizeCanvas();
      this.render();
    });

    document.getElementById('btnZoomOut').addEventListener('click', () => {
      this.zoomMode = 'manual';
      this.cellSize = Math.max(16, this.cellSize - 4);
      this.resizeCanvas();
      this.render();
    });

    document.getElementById('btnZoomAuto').addEventListener('click', () => {
      this.zoomMode = 'auto';
      this.resizeCanvas();
      this.render();
      this.showToast('🔍 Zoom automático ajustado');
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
    const iconToggleJson = document.getElementById('iconToggleJson');

    const toggleJsonSidebar = () => {
      if (!workspace || !jsonSidebar) return;
      const isCollapsed = workspace.classList.toggle('json-collapsed');
      jsonSidebar.classList.toggle('collapsed', isCollapsed);

      if (iconToggleJson) {
        iconToggleJson.className = isCollapsed ? 'ri-arrow-left-s-line' : 'ri-arrow-right-s-line';
      }
      if (btnToggleJsonSidebar) {
        btnToggleJsonSidebar.title = isCollapsed ? 'Descolapsar panel JSON' : 'Colapsar panel JSON (40px)';
      }

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
            if (d < minDist) {
              minDist = d;
              bestIdx = i;
            }
          });
          idx = bestIdx;
        }

        if (idx !== -1) {
          currentSegs.splice(idx, 1);
          changed = true;
        }
      }
    } else if (this.selectedTile === 'player') {
      this.player.x = x + 0.5;
      this.player.y = y + 0.5;
      this.grid[y][x] = [];
      changed = true;
    } else if (this.selectedTile === 0 || this.hoverSubEdge === 'empty') {
      // Suelo libre: vaciar toda la casilla
      if (currentSegs.length > 0) {
        this.grid[y][x] = [];
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

      // Limpiar cualquier pared, puerta o ventana previa en este mismo borde
      const baseEdge = codeToPlace.replace(/^[DW]/, '');
      const conflicts = [baseEdge, 'D' + baseEdge, 'W' + baseEdge];
      conflicts.forEach(c => {
        const idx = currentSegs.indexOf(c);
        if (idx !== -1) currentSegs.splice(idx, 1);
      });

      currentSegs.push(codeToPlace);
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
    if (presetName === '4doors') {
      this.cols = 7;
      this.rows = 7;
      this.inputCols.value = 7;
      this.inputRows.value = 7;
      this.initDefaultMap();
    } else if (presetName === 'twoRooms') {
      this.cols = 14;
      this.rows = 8;
      this.inputCols.value = 14;
      this.inputRows.value = 8;
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
      'DCH': { bg: '#e5a93b', icon: 'door', border: '#f39c12' },
      'DCV': { bg: '#e5a93b', icon: 'door', border: '#f39c12' },
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
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i];
          const acc = accessoryConfig[s];
          let wallColor = '#5a6275';
          if (acc) {
            wallColor = acc.bg;
          }

          ctx.fillStyle = wallColor;

          switch (s) {
            case 'N':
            case 'DN':
            case 'WN':
              ctx.fillRect(px, py, cs, th);
              if (acc) this.drawDoorBadge(ctx, px + cs / 2, py + th / 2, acc.icon, acc.border, cs);
              break;
            case 'S':
            case 'DS':
            case 'WS':
              ctx.fillRect(px, py + cs - th, cs, th);
              if (acc) this.drawDoorBadge(ctx, px + cs / 2, py + cs - th / 2, acc.icon, acc.border, cs);
              break;
            case 'W':
            case 'DW':
            case 'WW':
              ctx.fillRect(px, py, th, cs);
              if (acc) this.drawDoorBadge(ctx, px + th / 2, py + cs / 2, acc.icon, acc.border, cs);
              break;
            case 'E':
            case 'DE':
            case 'WE':
              ctx.fillRect(px + cs - th, py, th, cs);
              if (acc) this.drawDoorBadge(ctx, px + cs - th / 2, py + cs / 2, acc.icon, acc.border, cs);
              break;
            case 'CH':
            case 'DCH':
            case 'WCH': {
              const cy0 = py + Math.floor((cs - th) / 2);
              ctx.fillRect(px, cy0, cs, th);
              if (acc) this.drawDoorBadge(ctx, px + cs / 2, py + cs / 2, acc.icon, acc.border, cs);
              break;
            }
            case 'CV':
            case 'DCV':
            case 'WCV': {
              const cx0 = px + Math.floor((cs - th) / 2);
              ctx.fillRect(cx0, py, th, cs);
              if (acc) this.drawDoorBadge(ctx, px + cs / 2, py + cs / 2, acc.icon, acc.border, cs);
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
          switch (this.hoverSubEdge) {
            case 'N': ctx.fillRect(hpx, hpy, cs, th); break;
            case 'S': ctx.fillRect(hpx, hpy + cs - th, cs, th); break;
            case 'W': ctx.fillRect(hpx, hpy, th, cs); break;
            case 'E': ctx.fillRect(hpx + cs - th, hpy, th, cs); break;
            case 'CH': ctx.fillRect(hpx, hpy + Math.floor((cs - th) / 2), cs, th); break;
            case 'CV': ctx.fillRect(hpx + Math.floor((cs - th) / 2), hpy, th, cs); break;
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
    return {
      name: 'Laberinto Personalizado',
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
        'DN, DS, DE, DW, DCH, DCV': 'Puertas',
        'WN, WS, WE, WW, WCH, WCV': 'Ventanas'
      },
      map: this.grid
    };
  }

  updateJSON() {
    const data = this.getLevelObject();
    this.jsonOutput.value = JSON.stringify(data, null, 2);
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
      this.player.x = data.playerStart.x || 1.5;
      this.player.y = data.playerStart.y || 1.5;
    }

    document.getElementById('inputCols').value = this.cols;
    document.getElementById('inputRows').value = this.rows;

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
    this.showToast('Cargando nivel en el motor 3D...');
    setTimeout(() => {
      window.location.href = '../demo/index.html?custom=1';
    }, 300);
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

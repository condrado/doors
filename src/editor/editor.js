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
    this.selectedTile = 1; // 1 = piedra, 0 = suelo, 2..5 = puertas, 'player' = spawn
    this.isMouseDown = false;
    this.roomStart = null;
    this.hoverCell = { x: -1, y: -1 };

    // Colocación y Rotación de tabique (5x1)
    this.placementMode = 'auto'; // 'auto', 'N', 'S', 'E', 'W', 'center'
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
    this.rotLabel = document.getElementById('rotLabel');

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

    // Rotación de tabique (tecla R y botón)
    const toggleRotation = () => {
      this.rotation = (this.rotation === 'H') ? 'V' : 'H';
      if (this.rotLabel) {
        this.rotLabel.textContent = (this.rotation === 'H') ? '━ H' : '┃ V';
      }
      this.showToast(`Orientación: ${this.rotation === 'H' ? 'Horizontal ━' : 'Vertical ┃'}`);
      this.render();
    };

    const btnRotateWall = document.getElementById('btnRotateWall');
    if (btnRotateWall) {
      btnRotateWall.addEventListener('click', toggleRotation);
    }

    window.addEventListener('keydown', (e) => {
      if ((e.key === 'r' || e.key === 'R') && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        toggleRotation();
      }
    });

    // Cuadrícula visual 5x5 de colocación de paredes y esquinas
    document.querySelectorAll('.wall-tile-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.action === 'toggle-rot') {
          toggleRotation();
          return;
        }

        if (btn.dataset.action === 'select-floor') {
          document.querySelectorAll('.wall-tile-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.placementMode = 'empty';
          this.showToast('Modo: Suelo libre / Borrar muros de casilla');
          this.render();
          return;
        }

        const mode = btn.dataset.mode;
        if (!mode) return;

        document.querySelectorAll('.wall-tile-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.placementMode = mode;
        this.showToast(`Modo: ${btn.title}`);
        this.render();
      });
    });

    // Paleta de elementos
    document.querySelectorAll('input[name="tileSelect"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        document.querySelectorAll('.palette-item').forEach(p => p.classList.remove('active'));
        e.target.closest('.palette-item').classList.add('active');
        const val = e.target.value;
        this.selectedTile = (val === 'player') ? 'player' : parseInt(val, 10);
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
        this.showToast('⚠️ Las dimensiones deben estar entre 5 y 50 celdas');
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
      this.applyToolAt(cell.x, cell.y);
    }
    this.render();
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

      if (this.placementMode.startsWith('corner_')) {
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

    if (this.selectedTile === 'player') {
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
    } else if (this.currentTool === 'eraser') {
      // Borrar segmento específico
      const target = this.hoverSubEdge;
      const idx = currentSegs.findIndex(s => s === target || s === 'D' + target);
      if (idx !== -1) {
        currentSegs.splice(idx, 1);
        changed = true;
      }
    } else if (this.hoverSubEdge.startsWith('corner_')) {
      // Esquinas rápidas en bordes, centradas y cruces
      const c = this.hoverSubEdge.replace('corner_', '');
      const cornerMap = {
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
        'CENTER_SE': ['CS', 'CE']
      };
      const segs = cornerMap[c] || ['N', 'W'];
      segs.forEach(s => {
        if (!currentSegs.includes(s)) currentSegs.push(s);
      });
      changed = true;
    } else {
      // Colocar tabique o puerta fina en el lateral o centro
      let codeToPlace = this.hoverSubEdge;
      if (this.selectedTile >= 2) {
        codeToPlace = 'D' + this.hoverSubEdge;
      }

      // Evitar tener pared normal y puerta en la misma posición exacta
      const alt = codeToPlace.startsWith('D') ? codeToPlace.slice(1) : ('D' + codeToPlace);
      const altIdx = currentSegs.indexOf(alt);
      if (altIdx !== -1) currentSegs.splice(altIdx, 1);

      if (!currentSegs.includes(codeToPlace)) {
        currentSegs.push(codeToPlace);
        changed = true;
      }
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
    this.showToast('Mapa vaciado (tabiques perimetrales conservados)');
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

  drawDoorBadge(ctx, bx, by, text, color, cs) {
    ctx.beginPath();
    ctx.arc(bx, by, Math.floor(cs * 0.2), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15, 18, 25, 0.9)';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.floor(cs * 0.22)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx, by);
  }

  /**
   * Dibuja toda la cuadrícula, tabiques finos (5x1) en laterales/centro, esquinas y previsualizaciones
   */
  render() {
    const ctx = this.ctx;
    const cs = this.cellSize;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const doorColors = {
      'DN': { bg: '#e74c3c', text: 'N' },
      'DE': { bg: '#2ecc71', text: 'E' },
      'DS': { bg: '#3498db', text: 'S' },
      'DW': { bg: '#f39c12', text: 'O' },
      'DCH': { bg: '#e5a93b', text: 'D' },
      'DCV': { bg: '#e5a93b', text: 'D' }
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
          const isDoor = s.startsWith('D');
          const door = doorColors[s];
          const wallColor = isDoor ? (door ? door.bg : '#e5a93b') : '#5a6275';

          ctx.fillStyle = wallColor;

          switch (s) {
            case 'N':
            case 'DN':
              ctx.fillRect(px, py, cs, th);
              if (isDoor) this.drawDoorBadge(ctx, px + cs / 2, py + th / 2, door ? door.text : 'N', door ? door.bg : '#e74c3c', cs);
              break;
            case 'S':
            case 'DS':
              ctx.fillRect(px, py + cs - th, cs, th);
              if (isDoor) this.drawDoorBadge(ctx, px + cs / 2, py + cs - th / 2, door ? door.text : 'S', door ? door.bg : '#3498db', cs);
              break;
            case 'W':
            case 'DW':
              ctx.fillRect(px, py, th, cs);
              if (isDoor) this.drawDoorBadge(ctx, px + th / 2, py + cs / 2, door ? door.text : 'O', door ? door.bg : '#f39c12', cs);
              break;
            case 'E':
            case 'DE':
              ctx.fillRect(px + cs - th, py, th, cs);
              if (isDoor) this.drawDoorBadge(ctx, px + cs - th / 2, py + cs / 2, door ? door.text : 'E', door ? door.bg : '#2ecc71', cs);
              break;
            case 'CH':
            case 'DCH': {
              const cy0 = py + Math.floor((cs - th) / 2);
              ctx.fillRect(px, cy0, cs, th);
              if (isDoor) this.drawDoorBadge(ctx, px + cs / 2, py + cs / 2, 'D', '#e5a93b', cs);
              break;
            }
            case 'CV':
            case 'DCV': {
              const cx0 = px + Math.floor((cs - th) / 2);
              ctx.fillRect(cx0, py, th, cs);
              if (isDoor) this.drawDoorBadge(ctx, px + cs / 2, py + cs / 2, 'D', '#e5a93b', cs);
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
              const cx1 = px + Math.floor((cellSize - th) / 2) + th;
              const cy0 = py + Math.floor((cellSize - th) / 2);
              ctx.fillRect(px, cy0, cx1 - px, th);
              break;
            }
            case 'CE': {
              const cx0 = px + Math.floor((cellSize - th) / 2);
              const cy0 = py + Math.floor((cellSize - th) / 2);
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
        ctx.fillStyle = (this.selectedTile >= 2) ? 'rgba(229, 169, 59, 0.8)' : 'rgba(79, 163, 227, 0.8)';

        if (this.hoverSubEdge.startsWith('corner_')) {
          const c = this.hoverSubEdge.replace('corner_', '');
          const hcx0 = hpx + Math.floor((cs - th) / 2);
          const hcx1 = hcx0 + th;
          const hcy0 = hpy + Math.floor((cs - th) / 2);
          const hcy1 = hcy0 + th;

          if (c === 'NW') { ctx.fillRect(hpx, hpy, cs, th); ctx.fillRect(hpx, hpy, th, cs); }
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
        1: 'Muro de piedra',
        2: 'Puerta Norte [N]',
        3: 'Puerta Este [E]',
        4: 'Puerta Sur [S]',
        5: 'Puerta Oeste [O]'
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

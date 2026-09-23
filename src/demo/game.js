/**
 * Controlador Principal del Juego (Bucle, Entradas y Estado)
 * Incluye soporte de Mouse Look (Pointer Lock API) y Desplazamiento Lateral (Strafe).
 */

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('gameCanvas');
  const minimapCanvas = document.getElementById('minimapCanvas');

  // Inicializar motor Raycaster
  const engine = new RaycasterEngine(canvas, minimapCanvas);

  // Control de Zoom para el Minimapa / Radar (-1, 0, 1)
  const btnMinimapZoomOut = document.getElementById('btnMinimapZoomOut');
  const btnMinimapZoomIn = document.getElementById('btnMinimapZoomIn');
  const minimapZoomBadge = document.getElementById('minimapZoomBadge');

  function updateMinimapZoomUI() {
    if (minimapZoomBadge) {
      const z = engine.minimapZoomLevel;
      minimapZoomBadge.textContent = z > 0 ? `+${z}` : `${z}`;
    }
    // Con + amplías hacia -1 (cercano). Si ya estás en -1, no se puede ampliar más
    if (btnMinimapZoomIn) {
      btnMinimapZoomIn.disabled = (engine.minimapZoomLevel <= -1);
      btnMinimapZoomIn.style.opacity = (engine.minimapZoomLevel <= -1) ? '0.35' : '1';
    }
    // Con - te alejas hacia +1 (alejado). Si ya estás en +1, no se puede alejar más
    if (btnMinimapZoomOut) {
      btnMinimapZoomOut.disabled = (engine.minimapZoomLevel >= 1);
      btnMinimapZoomOut.style.opacity = (engine.minimapZoomLevel >= 1) ? '0.35' : '1';
    }
  }

  function cycleMinimapZoom() {
    engine.cycleMinimapZoom();
    updateMinimapZoomUI();
  }

  // Botón [ - ]: Alejar (0 -> +1, o -1 -> 0)
  if (btnMinimapZoomOut) {
    btnMinimapZoomOut.addEventListener('click', (e) => {
      e.stopPropagation();
      if (engine.minimapZoomLevel < 1) {
        engine.setMinimapZoom(engine.minimapZoomLevel + 1);
        updateMinimapZoomUI();
      }
    });
  }

  // Botón [ + ]: Ampliar (0 -> -1, o +1 -> 0)
  if (btnMinimapZoomIn) {
    btnMinimapZoomIn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (engine.minimapZoomLevel > -1) {
        engine.setMinimapZoom(engine.minimapZoomLevel - 1);
        updateMinimapZoomUI();
      }
    });
  }

  if (minimapCanvas) {
    minimapCanvas.style.cursor = 'pointer';
    minimapCanvas.addEventListener('click', (e) => {
      e.stopPropagation();
      cycleMinimapZoom();
    });
  }

  updateMinimapZoomUI();

  // Estado del Jugador (Inicialmente en el centro exacto de la sala 7x7: x=3.5, y=3.5)
  // Mirando hacia el Norte (hacia la Puerta Norte: dirX=0, dirY=-1)
  const player = {
    posX: 3.5,
    posY: 3.5,
    // Vector de dirección
    dirX: 0,
    dirY: -1,
    // Vector del plano de cámara (define el FOV de ~66 grados)
    planeX: 0.66,
    planeY: 0,
    // Velocidades
    rotSpeedBase: 2.2, // radianes por segundo (para giros con botones táctiles)
    moveSpeedBase: 3.0 // bloques por segundo (avance, retroceso y strafe)
  };

  // Estado de las teclas / botones pulsados
  const keys = {
    strafeLeft: false,   // A o Flecha Izq (Desplazamiento lateral izquierdo)
    strafeRight: false,  // D o Flecha Der (Desplazamiento lateral derecho)
    moveForward: false,  // W o Flecha Arriba
    moveBackward: false  // S o Flecha Abajo
  };

  // Sensibilidad de ratón (ajustable desde UI)
  let mouseSensitivity = 0.0024; // radianes por píxel

  // Elementos del DOM para el HUD y Controles
  const compassText = document.getElementById('compassText');
  const facingTargetText = document.getElementById('facingTargetText');
  const compassCanvas = document.getElementById('compassCanvas');
  const compassCtx = compassCanvas ? compassCanvas.getContext('2d') : null;
  const mouseSensRange = document.getElementById('mouseSensRange');
  const textureModeSelect = document.getElementById('textureModeSelect');
  const levelPill = document.getElementById('levelPill');
  const levelNameText = document.getElementById('levelNameText');
  const promptHud = document.getElementById('promptHud');
  const renderQualitySelect = document.getElementById('renderQualitySelect');

  // ==========================================
  // RESOLUCIÓN DINÁMICA & NITIDEZ 1:1 NATIVA
  // ==========================================
  let renderScaleMode = '1.0';
  try {
    const savedQuality = localStorage.getItem('maze3d_render_quality');
    if (savedQuality) {
      renderScaleMode = savedQuality;
      if (renderQualitySelect) {
        renderQualitySelect.value = savedQuality;
      }
    }
  } catch (e) {}

  function updateCanvasResolution() {
    const winW = window.innerWidth || document.documentElement.clientWidth || 1280;
    const winH = window.innerHeight || document.documentElement.clientHeight || 720;

    let targetW, targetH;
    if (renderScaleMode === 'retro') {
      targetW = 640;
      targetH = 400;
    } else {
      const scale = parseFloat(renderScaleMode) || 1.0;
      targetW = Math.max(320, Math.round(winW * scale));
      targetH = Math.max(200, Math.round(winH * scale));
    }

    if (engine && typeof engine.resize === 'function') {
      engine.resize(targetW, targetH);
    } else {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    // Adaptar plano de cámara según relación de aspecto real para evitar deformaciones
    const aspect = winW / winH;
    const fovBase = 0.66;
    const planeScale = fovBase * (aspect / (16 / 10));

    const dirLen = Math.hypot(player.dirX, player.dirY) || 1;
    const nx = player.dirX / dirLen;
    const ny = player.dirY / dirLen;
    player.planeX = -ny * planeScale;
    player.planeY = nx * planeScale;
  }

  if (renderQualitySelect) {
    renderQualitySelect.addEventListener('change', (e) => {
      renderScaleMode = e.target.value;
      try {
        localStorage.setItem('maze3d_render_quality', renderScaleMode);
      } catch (err) {}
      updateCanvasResolution();
    });
  }

  window.addEventListener('resize', updateCanvasResolution);
  updateCanvasResolution();

  // Estado de carrera / sprint (Shift / Mayúsculas)
  let isRunning = false;
  const btnToggleSprint = document.getElementById('btnToggleSprint');
  const sprintIcon = document.getElementById('sprintIcon');
  const sprintLabel = document.getElementById('sprintLabel');
  const dayzStanceHud = document.getElementById('dayzStanceHud');
  const dayzStanceIcon = document.getElementById('dayzStanceIcon');
  const dayzStanceText = document.getElementById('dayzStanceText');
  const dayzChevrons = document.getElementById('dayzChevrons');

  function updateSprintUI() {
    // 1. Botón en el panel inferior
    if (btnToggleSprint) {
      if (isRunning) {
        btnToggleSprint.classList.add('running');
        if (sprintIcon) sprintIcon.className = 'ri-run-line';
        if (sprintLabel) sprintLabel.textContent = 'Corriendo [Shift]';
      } else {
        btnToggleSprint.classList.remove('running');
        if (sprintIcon) sprintIcon.className = 'ri-walk-line';
        if (sprintLabel) sprintLabel.textContent = 'Andando [Shift]';
      }
    }

    // 2. Indicador táctico estilo DayZ en el Viewport
    if (dayzStanceHud) {
      if (isRunning) {
        dayzStanceHud.classList.add('sprinting');
        if (dayzStanceIcon) dayzStanceIcon.className = 'ri-run-line';
        if (dayzStanceText) dayzStanceText.textContent = 'SPRINT';
        if (dayzChevrons) {
          dayzChevrons.innerHTML = `
            <span class="chv c1 active">›</span>
            <span class="chv c2 active">›</span>
            <span class="chv c3 active">›</span>
          `;
        }
      } else {
        dayzStanceHud.classList.remove('sprinting');
        if (dayzStanceIcon) dayzStanceIcon.className = 'ri-walk-line';
        if (dayzStanceText) dayzStanceText.textContent = 'ANDAR';
        if (dayzChevrons) {
          dayzChevrons.innerHTML = `
            <span class="chv c1 active">›</span>
            <span class="chv c2">›</span>
            <span class="chv c3">›</span>
          `;
        }
      }
    }
  }

  function toggleSprint() {
    isRunning = !isRunning;
    updateSprintUI();
  }

  if (btnToggleSprint) {
    btnToggleSprint.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSprint();
    });
  }

  if (dayzStanceHud) {
    dayzStanceHud.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSprint();
    });
  }

  // Guardar punto de spawn original para el botón de centrar
  let spawnX = player.posX;
  let spawnY = player.posY;
  let spawnAngle = player.angle;

  // Soporte para proyectos multimapa:
  // 1. window.STANDALONE_PROJECT (en juego exportado)
  // 2. localStorage 'doors_projects_v2' (en demo con proyecto activo)
  // 3. Fallback: customRaycasterMap (nivel individual)
  let activeProject = null;
  let activeMapData = null;
  let currentMapId = null;
  let isTransitioning = false;

  function sanitizeMapGrid(mapData) {
    if (!mapData || !mapData.map || !Array.isArray(mapData.map)) return;
    mapData.map.forEach((row, y) => {
      if (Array.isArray(row)) {
        row.forEach((cell, x) => {
          if (Array.isArray(cell)) {
            row[x] = cell.map(code => {
              if (code === 'DCH' || code === 'ODCH') {
                if (mapData.wallStyleMap && mapData.wallStyleMap[`${x},${y}`]) {
                  mapData.wallStyleMap[`${x},${y}`]['CH'] = mapData.wallStyleMap[`${x},${y}`][code];
                  delete mapData.wallStyleMap[`${x},${y}`][code];
                }
                return 'CH';
              }
              if (code === 'DCV' || code === 'ODCV') {
                if (mapData.wallStyleMap && mapData.wallStyleMap[`${x},${y}`]) {
                  mapData.wallStyleMap[`${x},${y}`]['CV'] = mapData.wallStyleMap[`${x},${y}`][code];
                  delete mapData.wallStyleMap[`${x},${y}`][code];
                }
                return 'CV';
              }
              return code;
            });
          }
        });
      }
    });
  }

  function loadMapIntoGame(mapData) {
    if (!mapData || !mapData.map) return;
    sanitizeMapGrid(mapData);

    engine.map = mapData.map;
    engine.mapWidth = mapData.map[0].length;
    engine.mapHeight = mapData.map.length;
    engine.wallStyleMap = mapData.wallStyleMap || {};
    engine.clearSegmentsCache?.();

    if (mapData.playerStart) {
      player.posX = (typeof mapData.playerStart.x === 'number') ? mapData.playerStart.x : (engine.mapWidth / 2);
      player.posY = (typeof mapData.playerStart.y === 'number') ? mapData.playerStart.y : (engine.mapHeight / 2);
      if (typeof mapData.playerStart.angle === 'number') {
        player.angle = mapData.playerStart.angle;
        player.dirX = Math.cos(player.angle);
        player.dirY = Math.sin(player.angle);
      }
      spawnX = player.posX;
      spawnY = player.posY;
      spawnAngle = player.angle;
    }
    if (typeof updateCanvasResolution === 'function') {
      updateCanvasResolution();
    }

    if (levelPill && levelNameText) {
      levelPill.style.display = 'inline-block';
      levelNameText.textContent = `${mapData.name || 'Sala'} (${engine.mapWidth}x${engine.mapHeight})`;
    }

    if (mapData.customTextures) {
      engine.applyCustomTextures(mapData.customTextures);
    }

    if (mapData.customStyles && typeof loadCustomStyles === 'function') {
      loadCustomStyles(mapData.customStyles);
      engine.generateProceduralTextures();
    }
  }

  // Detectar si venimos del Editor (?custom=1)
  const urlParams = new URLSearchParams(window.location.search);
  const isCustomMode = urlParams.get('custom') === '1';

  // 1. Detección de proyecto embebido (Standalone) o en localStorage
  if (window.STANDALONE_PROJECT && typeof window.STANDALONE_PROJECT === 'object') {
    activeProject = window.STANDALONE_PROJECT;
  } else {
    try {
      const activeProjId = localStorage.getItem('doors_current_project_id');
      const allProjects = JSON.parse(localStorage.getItem('doors_projects_v2') || '{}');
      if (activeProjId && allProjects[activeProjId]) {
        activeProject = allProjects[activeProjId];
      }
    } catch (e) {
      console.warn('Error leyendo proyectos en demo:', e);
    }
  }

  // Sincronizar estilos y texturas personalizadas del proyecto
  if (activeProject && activeProject.customStyles && typeof loadCustomStyles === 'function') {
    loadCustomStyles(activeProject.customStyles);
    engine.generateProceduralTextures();
  }

  // Sincronizar también texturas físicas descubiertas en carpetas (ej. cristal-c.png)
  if (typeof fetch === 'function') {
    fetch('/api/list-textures')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        let needsRegen = false;

        // Limpiar dataUrls obsoletos en customStyles si ahora hay archivos físicos en disco
        if (activeProject && activeProject.customStyles) {
          if (data.walls && activeProject.customStyles.walls) {
            data.walls.forEach(item => {
              if (activeProject.customStyles.walls[item.name]) {
                activeProject.customStyles.walls[item.name].pngUrl = item.url;
                activeProject.customStyles.walls[item.name].capPngUrl = item.capUrl;
                delete activeProject.customStyles.walls[item.name].capDataUrl;
                delete activeProject.customStyles.walls[item.name].dataUrl;
              }
            });
          }
          if (data.doors && activeProject.customStyles.doors) {
            data.doors.forEach(item => {
              if (activeProject.customStyles.doors[item.name]) {
                activeProject.customStyles.doors[item.name].pngUrl = item.url;
                activeProject.customStyles.doors[item.name].capPngUrl = item.capUrl;
                delete activeProject.customStyles.doors[item.name].capDataUrl;
                delete activeProject.customStyles.doors[item.name].dataUrl;
              }
            });
          }
        }

        if (data.walls && typeof registerWallStyle === 'function') {
          data.walls.forEach(item => {
            const isTrans = (/^(cristal|glass|trans|reja|enrejado)/i.test(item.name));
            const capFile = item.capFile || ('caps/' + item.name + '.png');
            const capUrl = item.capUrl || ('/src/engine/textures/caps/' + item.name + '.png');
            // Siempre registrar/actualizar con la URL fresca del disco (incluyendo query ?t=)
            registerWallStyle(item.name, {
              label: item.name.charAt(0).toUpperCase() + item.name.slice(1).replace(/_/g, ' '),
              pngUrl: item.url,
              file: item.file,
              capFile: capFile,
              capPngUrl: capUrl,
              hasTransparency: isTrans,
              isCustom: true
            });
            needsRegen = true;
          });
        }
        if (data.doors && typeof registerDoorStyle === 'function') {
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
            needsRegen = true;
          });
        }
        if (needsRegen) {
          engine.generateProceduralTextures();
        }
      })
      .catch(() => {});
  }

  if (activeProject && activeProject.maps && Object.keys(activeProject.maps).length > 0) {
    const savedActiveMapId = localStorage.getItem('doors_current_map_id');
    if (isCustomMode && savedActiveMapId && activeProject.maps[savedActiveMapId]) {
      currentMapId = savedActiveMapId;
    } else {
      currentMapId = activeProject.startingMapId || Object.keys(activeProject.maps)[0];
    }
    activeMapData = activeProject.maps[currentMapId];
    loadMapIntoGame(activeMapData);
  } else {
    // Fallback: Nivel individual guardado
    const savedCustom = localStorage.getItem('customRaycasterMap');
    if (savedCustom) {
      try {
        const customData = JSON.parse(savedCustom);
        activeMapData = customData;
        loadMapIntoGame(customData);
      } catch (err) {
        console.warn('No se pudo cargar el mapa personalizado:', err);
      }
    }
  }

  // Botones táctiles / UI
  const btnStrafeLeft = document.getElementById('btnStrafeLeft');
  const btnStrafeRight = document.getElementById('btnStrafeRight');
  const btnForward = document.getElementById('btnForward');
  const btnBackward = document.getElementById('btnBackward');
  const btnCenter = document.getElementById('btnCenter');

  // ==========================================
  // BOTONES FLOTANTES DE ACCIÓN RÁPIDA
  // ==========================================
  const appContainer = document.querySelector('.app-container');
  const hudFloatingBar = document.getElementById('hudFloatingBar');
  const btnTogglePanels = document.getElementById('btnTogglePanels');
  const iconTogglePanels = document.getElementById('iconTogglePanels');
  const textTogglePanels = document.getElementById('textTogglePanels');
  const btnMouseLook = document.getElementById('btnMouseLook');
  const iconMouseLook = document.getElementById('iconMouseLook');
  const textMouseLook = document.getElementById('textMouseLook');
  const btnFullscreen = document.getElementById('btnFullscreen');
  const iconFullscreen = document.getElementById('iconFullscreen');
  const textFullscreen = document.getElementById('textFullscreen');
  const viewportWrapper = document.querySelector('.viewport-wrapper');

  // 1. Mostrar / Ocultar Paneles Superiores e Inferiores
  function togglePanelsVisibility() {
    if (!appContainer) return;
    const isHidden = appContainer.classList.toggle('panels-hidden');
    if (btnTogglePanels) {
      if (isHidden) {
        btnTogglePanels.classList.add('panel-toggle-active');
        btnTogglePanels.title = 'Mostrar Paneles (H)';
        if (iconTogglePanels) iconTogglePanels.className = 'ri-eye-line';
        if (textTogglePanels) textTogglePanels.textContent = 'Mostrar Paneles';
      } else {
        btnTogglePanels.classList.remove('panel-toggle-active');
        btnTogglePanels.title = 'Ocultar Paneles (H)';
        if (iconTogglePanels) iconTogglePanels.className = 'ri-eye-off-line';
        if (textTogglePanels) textTogglePanels.textContent = 'Ocultar Paneles';
      }
    }
  }

  if (btnTogglePanels) {
    btnTogglePanels.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePanelsVisibility();
    });
  }

  // 2. Mirar con el Ratón (Pointer Lock)
  function requestLock() {
    canvas.requestPointerLock = canvas.requestPointerLock || canvas.mozRequestPointerLock;
    if (canvas.requestPointerLock) {
      canvas.requestPointerLock();
    }
  }

  function releaseLock() {
    if (document.exitPointerLock) {
      document.exitPointerLock();
    } else if (document.mozExitPointerLock) {
      document.mozExitPointerLock();
    }
  }

  function toggleMouseLook() {
    const isLocked = (document.pointerLockElement === canvas || document.mozPointerLockElement === canvas);
    if (isLocked) {
      releaseLock();
    } else {
      requestLock();
    }
  }

  if (btnMouseLook) {
    btnMouseLook.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMouseLook();
    });
  }

  // 3. Pantalla Completa (Fullscreen API)
  async function toggleFullscreen() {
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);
    if (!isFs) {
      try {
        if (viewportWrapper.requestFullscreen) {
          await viewportWrapper.requestFullscreen();
        } else if (viewportWrapper.webkitRequestFullscreen) {
          await viewportWrapper.webkitRequestFullscreen();
        } else if (viewportWrapper.mozRequestFullScreen) {
          await viewportWrapper.mozRequestFullScreen();
        }
        requestLock();
      } catch (err) {
        console.warn('Error al activar pantalla completa:', err);
      }
    } else {
      try {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          await document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
          await document.mozCancelFullScreen();
        }
      } catch (err) {
        console.warn('Error al salir de pantalla completa:', err);
      }
    }
  }

  if (btnFullscreen) {
    btnFullscreen.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFullscreen();
    });
  }

  function onFullscreenChange() {
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);

    if (btnFullscreen) {
      if (isFs) {
        btnFullscreen.classList.add('active');
        if (iconFullscreen) iconFullscreen.className = 'ri-fullscreen-exit-line';
        if (textFullscreen) textFullscreen.textContent = 'Salir Fullscreen';
        btnFullscreen.title = 'Salir de pantalla completa (ESC / F)';
      } else {
        btnFullscreen.classList.remove('active');
        if (iconFullscreen) iconFullscreen.className = 'ri-fullscreen-line';
        if (textFullscreen) textFullscreen.textContent = 'Pantalla Completa';
        btnFullscreen.title = 'Pantalla Completa (F)';
      }
    }

    updateCanvasResolution();

    if (isFs) {
      requestLock();
    } else {
      releaseLock();
    }
    onPointerLockChange();
  }

  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  document.addEventListener('mozfullscreenchange', onFullscreenChange);

  canvas.addEventListener('click', requestLock);

  // En pantalla completa, cualquier clic en el contenedor bloquea el ratón de nuevo
  if (viewportWrapper) {
    viewportWrapper.addEventListener('click', () => {
      const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);
      if (isFs && document.pointerLockElement !== canvas) {
        requestLock();
      }
    });
  }

  // ==========================================
  // APERTURA Y CIERRE DE PUERTAS (Ratón Izquierdo o Enter)
  // ==========================================
  let feedbackTimeout = null;

  function getAudioContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!window._doorAudioCtx) {
      window._doorAudioCtx = new AudioCtx();
    }
    const ctx = window._doorAudioCtx;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    return ctx;
  }

  function playDoorOpenSound() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Sonido de mecanismo abriendo puerta y chirrido de bisagra
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(120, now);
      osc.frequency.exponentialRampToValueAtTime(190, now + 0.24);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.28);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.3);

      // Armónico metálico de pestillo
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(260, now + 0.03);
      osc2.frequency.exponentialRampToValueAtTime(460, now + 0.18);

      gain2.gain.setValueAtTime(0.14, now + 0.03);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.03);
      osc2.stop(now + 0.24);
    } catch (e) {
      // Ignorar si audio está restringido
    }
  }

  function playDoorCloseSound() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Golpe seco de madera contra marco (thump)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.18);

      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.24);

      // Pestillo metálico encajando (clack)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(480, now + 0.08);
      osc2.frequency.exponentialRampToValueAtTime(220, now + 0.18);

      gain2.gain.setValueAtTime(0.18, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.22);
    } catch (e) {
      // Ignorar si audio está restringido
    }
  }

  function playBlockedSound() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(110, now);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.16);
    } catch (e) {
      // Ignorar si audio está restringido
    }
  }

  function showDoorFeedback(message, color = '#f1c40f') {
    if (!promptHud) return;
    promptHud.innerHTML = `<span style="color: ${color}; font-weight: 700; display: inline-flex; align-items: center; gap: 6px;"><i class="ri-door-open-line"></i> ${message}</span>`;
    if (feedbackTimeout) clearTimeout(feedbackTimeout);
    feedbackTimeout = setTimeout(() => {
      onPointerLockChange();
    }, 2400);
  }

  function tryInteractDoor() {
    const res = engine.interactDoor(player, 2.6);
    if (!res) return;

    if (res.blocked) {
      playBlockedSound();
      showDoorFeedback(res.message, '#ff6b6b');
    } else if (res.success) {
      if (res.action === 'close') {
        playDoorCloseSound();
        showDoorFeedback(`¡${res.name} cerrada!`, '#54a0ff');
      } else {
        playDoorOpenSound();
        showDoorFeedback(`¡${res.name} abierta!`, '#f1c40f');
      }
    }
  }

  function playPortalTransitionSound() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Resonancia de portal dimensional
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(580, now + 0.18);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.35);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.42);
    } catch (e) {}
  }

  function transitionToMap(targetMapId, linkInfo) {
    if (isTransitioning) return;
    if (!activeProject || !activeProject.maps || !activeProject.maps[targetMapId]) {
      console.warn('Mapa destino no encontrado en el proyecto:', targetMapId);
      return;
    }

    isTransitioning = true;
    const transitionOverlay = document.getElementById('transitionOverlay');
    if (transitionOverlay) transitionOverlay.classList.add('active');

    playPortalTransitionSound();

    setTimeout(() => {
      const targetMap = activeProject.maps[targetMapId];
      currentMapId = targetMapId;
      activeMapData = targetMap;

      loadMapIntoGame(targetMap);

      if (linkInfo && linkInfo.arrivalMode === 'custom' && typeof linkInfo.targetX === 'number' && typeof linkInfo.targetY === 'number') {
        player.posX = linkInfo.targetX;
        player.posY = linkInfo.targetY;
        spawnX = player.posX;
        spawnY = player.posY;
      }

      showDoorFeedback(`Has entrado en: ${targetMap.name || targetMapId}`, '#9b59b6');

      setTimeout(() => {
        if (transitionOverlay) transitionOverlay.classList.remove('active');
        setTimeout(() => {
          isTransitioning = false;
        }, 300);
      }, 120);
    }, 280);
  }

  function checkPortalThreshold() {
    if (isTransitioning || !activeMapData || !activeMapData.doorLinks) return;
    const links = activeMapData.doorLinks;

    for (const [key, link] of Object.entries(links)) {
      if (!link || !link.targetMapId) continue;
      const parts = key.split(',');
      const dx = parseInt(parts[0], 10);
      const dy = parseInt(parts[1], 10);
      if (isNaN(dx) || isNaN(dy)) continue;

      const distSq = (player.posX - (dx + 0.5)) ** 2 + (player.posY - (dy + 0.5)) ** 2;
      // Umbral de paso por la puerta
      if (distSq < 0.32) {
        transitionToMap(link.targetMapId, link);
        break;
      }
    }
  }

  // Interacción con botón izquierdo del ratón (botón 0)
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      tryInteractDoor();
    }
  });

  function onPointerLockChange() {
    const isLocked = (document.pointerLockElement === canvas || document.mozPointerLockElement === canvas);
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);

    if (btnMouseLook) {
      if (isLocked) {
        btnMouseLook.classList.add('active');
        if (iconMouseLook) iconMouseLook.className = 'ri-mouse-fill';
        if (textMouseLook) textMouseLook.textContent = 'Mirando (ESC)';
        btnMouseLook.title = 'Liberar ratón (ESC)';
      } else {
        btnMouseLook.classList.remove('active');
        if (iconMouseLook) iconMouseLook.className = 'ri-mouse-line';
        if (textMouseLook) textMouseLook.textContent = 'Mirar con el ratón';
        btnMouseLook.title = 'Haz clic para mirar con el ratón';
      }
    }

    if (promptHud) {
      const panelsHidden = appContainer && appContainer.classList.contains('panels-hidden');
      const panelHint = panelsHidden ? 'mostrar paneles' : 'ocultar paneles';
      if (isFs) {
        promptHud.innerHTML = isLocked
          ? `Pantalla Completa • Mueve el ratón para <strong>mirar</strong> • <strong>[A][D]</strong> strafe • <strong>[Clic Izq / Enter]</strong> abrir/cerrar puerta • [ESC] o [F] salir`
          : `Haz clic o pulsa <strong>[Mirar con el ratón]</strong> para bloquear de nuevo • [ESC] o [F] salir`;
      } else {
        promptHud.innerHTML = isLocked
          ? `Mueve el ratón para <strong>mirar</strong> • <strong>[A][D]</strong> strafe • <strong>[Clic Izq / Enter]</strong> abrir/cerrar puerta • [ESC] liberar ratón`
          : `Haz clic o usa <strong>[Mirar con el ratón]</strong> para apuntar • <strong>[H]</strong> ${panelHint} • <strong>[F]</strong> pantalla completa`;
      }
    }
  }

  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('mozpointerlockchange', onPointerLockChange);

  // Girar la cámara al mover el ratón cuando está bloqueado
  window.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas || document.mozPointerLockElement === canvas) {
      const movementX = e.movementX || e.mozMovementX || e.webkitMovementX || 0;
      if (movementX !== 0) {
        rotatePlayer(movementX * mouseSensitivity);
      }
    }
  });

  // Soporte táctil / arrastre opcional en canvas cuando no hay pointer lock
  let touchStartX = null;
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
    }
  }, { passive: true });

  canvas.addEventListener('touchmove', (e) => {
    if (touchStartX !== null && e.touches.length === 1) {
      const deltaX = e.touches[0].clientX - touchStartX;
      touchStartX = e.touches[0].clientX;
      rotatePlayer(deltaX * mouseSensitivity * 1.6);
    }
  }, { passive: true });

  canvas.addEventListener('touchend', () => {
    touchStartX = null;
  });

  // ==========================================
  // MANEJO DE TECLADO
  // ==========================================
  window.addEventListener('keydown', (e) => {
    // Zoom de minimapa con teclas '+' (ampliar a -1) y '-' (alejar a +1)
    if (e.key === '+' || e.code === 'NumpadAdd' || e.key === 'Add') {
      if (engine.minimapZoomLevel > -1) {
        engine.setMinimapZoom(engine.minimapZoomLevel - 1);
        updateMinimapZoomUI();
      }
      e.preventDefault();
      return;
    }

    if (e.key === '-' || e.code === 'NumpadSubtract' || e.key === 'Subtract') {
      if (engine.minimapZoomLevel < 1) {
        engine.setMinimapZoom(engine.minimapZoomLevel + 1);
        updateMinimapZoomUI();
      }
      e.preventDefault();
      return;
    }

    // Alternar Correr / Andar con tecla Shift (Mayúsculas)
    if (e.key === 'Shift') {
      toggleSprint();
      e.preventDefault();
      return;
    }

    switch (e.key.toLowerCase()) {
      case 'enter':
        tryInteractDoor();
        e.preventDefault();
        break;
      case 'a':
      case 'arrowleft':
        keys.strafeLeft = true;
        if (btnStrafeLeft) btnStrafeLeft.classList.add('active');
        e.preventDefault();
        break;
      case 'd':
      case 'arrowright':
        keys.strafeRight = true;
        if (btnStrafeRight) btnStrafeRight.classList.add('active');
        e.preventDefault();
        break;
      case 'w':
      case 'arrowup':
        keys.moveForward = true;
        if (btnForward) btnForward.classList.add('active');
        e.preventDefault();
        break;
      case 's':
      case 'arrowdown':
        keys.moveBackward = true;
        if (btnBackward) btnBackward.classList.add('active');
        e.preventDefault();
        break;
      case 'f':
        toggleFullscreen();
        e.preventDefault();
        break;
      case 'h':
        togglePanelsVisibility();
        e.preventDefault();
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    switch (e.key.toLowerCase()) {
      case 'a':
      case 'arrowleft':
        keys.strafeLeft = false;
        if (btnStrafeLeft) btnStrafeLeft.classList.remove('active');
        break;
      case 'd':
      case 'arrowright':
        keys.strafeRight = false;
        if (btnStrafeRight) btnStrafeRight.classList.remove('active');
        break;
      case 'w':
      case 'arrowup':
        keys.moveForward = false;
        if (btnForward) btnForward.classList.remove('active');
        break;
      case 's':
      case 'arrowdown':
        keys.moveBackward = false;
        if (btnBackward) btnBackward.classList.remove('active');
        break;
    }
  });

  // ==========================================
  // MANEJO DE BOTONES EN PANTALLA (RATÓN Y TÁCTIL)
  // ==========================================
  function bindButton(btn, keyName) {
    if (!btn) return;
    const startAction = (e) => {
      e.preventDefault();
      keys[keyName] = true;
      btn.classList.add('active');
    };
    const endAction = (e) => {
      e.preventDefault();
      keys[keyName] = false;
      btn.classList.remove('active');
    };

    btn.addEventListener('mousedown', startAction);
    btn.addEventListener('mouseup', endAction);
    btn.addEventListener('mouseleave', endAction);

    btn.addEventListener('touchstart', startAction, { passive: false });
    btn.addEventListener('touchend', endAction, { passive: false });
    btn.addEventListener('touchcancel', endAction, { passive: false });
  }

  bindButton(btnStrafeLeft, 'strafeLeft');
  bindButton(btnStrafeRight, 'strafeRight');
  bindButton(btnForward, 'moveForward');
  bindButton(btnBackward, 'moveBackward');

  // Botón para volver a colocar al jugador en el centro / spawn del mapa
  if (btnCenter) {
    btnCenter.addEventListener('click', () => {
      player.posX = spawnX;
      player.posY = spawnY;
      if (typeof spawnAngle === 'number') {
        player.angle = spawnAngle;
        player.dirX = Math.cos(player.angle);
        player.dirY = Math.sin(player.angle);
        if (typeof updateCanvasResolution === 'function') {
          updateCanvasResolution();
        }
      }
    });
  }

  // ==========================================
  // AJUSTES
  // ==========================================
  const mouseSensValLabel = document.getElementById('mouseSensValLabel');

  /**
   * Mapeo de sensibilidad de ratón con curva exponencial:
   * - val = 1.0 (mínimo): 0.00030 rad/px (8x más lenta que por defecto, movimiento quirúrgico y muy pausado)
   * - val = 3.0 (defecto): 0.00240 rad/px (velocidad estándar cómoda)
   * - val = 5.0 (máximo): 0.00680 rad/px (giro rápido)
   */
  function calculateMouseSensitivity(val) {
    const t = Math.max(0, Math.min(1, (val - 1) / 4));
    return 0.0003 + Math.pow(t, 1.63) * 0.0065;
  }

  function getMouseSensLabel(val) {
    if (val <= 1.0) return 'Mínima (0.1x)';
    if (val <= 1.5) return 'Muy lenta (0.3x)';
    if (val <= 2.0) return 'Lenta (0.5x)';
    if (val <= 2.5) return 'Media-baja (0.7x)';
    if (val <= 3.0) return 'Normal (1.0x)';
    if (val <= 3.5) return 'Media-alta (1.4x)';
    if (val <= 4.0) return 'Rápida (1.8x)';
    if (val <= 4.5) return 'Muy rápida (2.3x)';
    return 'Máxima (2.8x)';
  }

  function applyMouseSensitivity(val) {
    mouseSensitivity = calculateMouseSensitivity(val);
    if (mouseSensValLabel) {
      mouseSensValLabel.textContent = getMouseSensLabel(val);
    }
    try {
      localStorage.setItem('maze3d_mouse_sens', val.toString());
    } catch (e) {}
  }

  if (mouseSensRange) {
    try {
      const savedSens = localStorage.getItem('maze3d_mouse_sens');
      if (savedSens !== null) {
        const parsed = parseFloat(savedSens);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= 5) {
          mouseSensRange.value = parsed;
        }
      }
    } catch (e) {}

    applyMouseSensitivity(parseFloat(mouseSensRange.value));

    mouseSensRange.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      applyMouseSensitivity(val);
    });
  }

  if (textureModeSelect) {
    textureModeSelect.addEventListener('change', (e) => {
      engine.textureMode = e.target.value;
    });
  }

  // ==========================================
  // MATEMÁTICAS DE ROTACIÓN Y MOVIMIENTO
  // ==========================================
  function rotatePlayer(angle) {
    const oldDirX = player.dirX;
    player.dirX = player.dirX * Math.cos(angle) - player.dirY * Math.sin(angle);
    player.dirY = oldDirX * Math.sin(angle) + player.dirY * Math.cos(angle);

    const oldPlaneX = player.planeX;
    player.planeX = player.planeX * Math.cos(angle) - player.planeY * Math.sin(angle);
    player.planeY = oldPlaneX * Math.sin(angle) + player.planeY * Math.cos(angle);
  }

  /**
   * Comprobación de colisiones con muros y puertas sólidas
   */
  function canStepTo(targetX, targetY) {
    const mX = Math.floor(targetX);
    const mY = Math.floor(targetY);
    if (mY < 0 || mY >= engine.mapHeight || mX < 0 || mX >= engine.mapWidth) return false;

    const segments = engine.getCellSegments(mX, mY);
    if (!segments || segments.length === 0) return true;

    // Comprobar colisión con cada cara sólida (margen fino de 0.10 unidades)
    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s];
      // El dintel está en lo alto (por encima de la cabeza): no genera colisión física en el suelo
      if (seg.isLintelOnly) continue;

      if (seg.axis === 'y') {
        const minX = seg.minX !== undefined ? seg.minX : mX;
        const maxX = seg.maxX !== undefined ? seg.maxX : (mX + 1.0);
        if (Math.abs(targetY - seg.pos) < 0.10 && targetX >= minX - 0.08 && targetX <= maxX + 0.08) {
          return false;
        }
      } else if (seg.axis === 'x') {
        const minY = seg.minY !== undefined ? seg.minY : mY;
        const maxY = seg.maxY !== undefined ? seg.maxY : (mY + 1.0);
        if (Math.abs(targetX - seg.pos) < 0.10 && targetY >= minY - 0.08 && targetY <= maxY + 0.08) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Movimiento de avance / retroceso en la dirección de la mirada (dirX, dirY)
   */
  function movePlayer(dist) {
    const nextX = player.posX + player.dirX * dist;
    const nextY = player.posY + player.dirY * dist;

    const padding = 0.18;
    const checkX = dist > 0 ? (player.dirX > 0 ? nextX + padding : nextX - padding) : (player.dirX > 0 ? nextX - padding : nextX + padding);
    const checkY = dist > 0 ? (player.dirY > 0 ? nextY + padding : nextY - padding) : (player.dirY > 0 ? nextY - padding : nextY + padding);

    if (canStepTo(checkX, player.posY)) {
      player.posX = nextX;
    }
    if (canStepTo(player.posX, checkY)) {
      player.posY = nextY;
    }
  }

  /**
   * Desplazamiento lateral (Strafe) perpendicular a la dirección de la mirada
   * Vector normal a la derecha: (-dirY, dirX)
   */
  function strafePlayer(dist) {
    const strafeDirX = -player.dirY;
    const strafeDirY = player.dirX;

    const nextX = player.posX + strafeDirX * dist;
    const nextY = player.posY + strafeDirY * dist;

    const padding = 0.18;
    const checkX = dist > 0 ? (strafeDirX > 0 ? nextX + padding : nextX - padding) : (strafeDirX > 0 ? nextX - padding : nextX + padding);
    const checkY = dist > 0 ? (strafeDirY > 0 ? nextY + padding : nextY - padding) : (strafeDirY > 0 ? nextY - padding : nextY + padding);

    if (canStepTo(checkX, player.posY)) {
      player.posX = nextX;
    }
    if (canStepTo(player.posX, checkY)) {
      player.posY = nextY;
    }
  }

  // ==========================================
  // ACTUALIZACIÓN DEL HUD Y BRÚJULA 360° CONTINUA
  // ==========================================
  function renderCompassBar(deg) {
    if (!compassCtx || !compassCanvas) return;
    const ctx = compassCtx;
    const w = compassCanvas.width;
    const h = compassCanvas.height;
    const centerX = w / 2;
    const pxPerDegree = 1.1; // Cobertura de ~180° dentro de la ventana de 220px

    ctx.clearRect(0, 0, w, h);

    // Definición de rumbos cardinales e intercardinales
    const marks = [
      { angle: 0,   label: 'N',  isCardinal: true,  color: '#ff4757' },
      { angle: 45,  label: 'NE', isCardinal: false, color: '#8d98af' },
      { angle: 90,  label: 'E',  isCardinal: true,  color: '#e5a93b' },
      { angle: 135, label: 'SE', isCardinal: false, color: '#8d98af' },
      { angle: 180, label: 'S',  isCardinal: true,  color: '#e5a93b' },
      { angle: 225, label: 'SO', isCardinal: false, color: '#8d98af' },
      { angle: 270, label: 'O',  isCardinal: true,  color: '#e5a93b' },
      { angle: 315, label: 'NO', isCardinal: false, color: '#8d98af' }
    ];

    // Marcas de división secundarias cada 15°
    for (let a = 0; a < 360; a += 15) {
      if (a % 45 === 0) continue;
      let diff = ((a - deg + 540) % 360) - 180;
      let x = centerX + diff * pxPerDegree;
      if (x >= 0 && x <= w) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.fillRect(Math.round(x), h - 7, 1, 4);
      }
    }

    // Dibujar etiquetas de texto y marcas cardinales
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      let diff = ((m.angle - deg + 540) % 360) - 180;
      let x = centerX + diff * pxPerDegree;

      if (x >= -25 && x <= w + 25) {
        // Marca vertical inferior
        ctx.fillStyle = m.color;
        const tickH = m.isCardinal ? 6 : 4;
        ctx.fillRect(Math.round(x) - 0.5, h - tickH - 2, m.isCardinal ? 2 : 1, tickH);

        // Rótulo del rumbo
        if (m.isCardinal) {
          ctx.font = "bold 10px 'Press Start 2P', monospace";
          ctx.fillText(m.label, x, 11);
        } else {
          ctx.font = "bold 11px 'Rajdhani', sans-serif";
          ctx.fillText(m.label, x, 12);
        }
      }
    }

    // Difuminado suave en los extremos izquierdo y derecho
    const gradL = ctx.createLinearGradient(0, 0, 30, 0);
    gradL.addColorStop(0, 'rgba(10, 12, 18, 0.95)');
    gradL.addColorStop(1, 'rgba(10, 12, 18, 0)');
    ctx.fillStyle = gradL;
    ctx.fillRect(0, 0, 30, h);

    const gradR = ctx.createLinearGradient(w - 30, 0, w, 0);
    gradR.addColorStop(0, 'rgba(10, 12, 18, 0)');
    gradR.addColorStop(1, 'rgba(10, 12, 18, 0.95)');
    ctx.fillStyle = gradR;
    ctx.fillRect(w - 30, 0, 30, h);
  }

  function updateHUD() {
    // Calcular ángulo en grados (0° = Norte, 90° = Este, 180° = Sur, 270° = Oeste)
    let rad = Math.atan2(player.dirX, -player.dirY);
    let deg = Math.round((rad * 180 / Math.PI + 360) % 360);

    let cardinal = 'Norte';
    if (deg >= 337.5 || deg < 22.5) cardinal = `Norte (${deg}°)`;
    else if (deg >= 22.5 && deg < 67.5) cardinal = `Noreste (${deg}°)`;
    else if (deg >= 67.5 && deg < 112.5) cardinal = `Este (${deg}°)`;
    else if (deg >= 112.5 && deg < 157.5) cardinal = `Sureste (${deg}°)`;
    else if (deg >= 157.5 && deg < 202.5) cardinal = `Sur (${deg}°)`;
    else if (deg >= 202.5 && deg < 247.5) cardinal = `Suroeste (${deg}°)`;
    else if (deg >= 247.5 && deg < 292.5) cardinal = `Oeste (${deg}°)`;
    else if (deg >= 292.5 && deg < 337.5) cardinal = `Noroeste (${deg}°)`;

    if (compassText) compassText.textContent = cardinal;

    // Renderizar cinta continua 360° en canvas
    renderCompassBar(deg);

    // Objetivo al que mira de frente
    const target = engine.facingTarget;
    if (target && facingTargetText) {
      facingTargetText.textContent = `${target.name} (${target.distance} m)`;
    }
  }

  // ==========================================
  // BUCLE PRINCIPAL (GAME LOOP)
  // ==========================================
  let lastTime = performance.now();

  function gameLoop(currentTime) {
    const dt = Math.min((currentTime - lastTime) / 1000, 0.1); // delta time en segundos
    lastTime = currentTime;

    const speedMult = isRunning ? 1.8 : 1.0;
    const moveStep = player.moveSpeedBase * speedMult * dt;

    // Desplazamiento lateral (A / D)
    if (keys.strafeLeft) {
      strafePlayer(-moveStep);
    }
    if (keys.strafeRight) {
      strafePlayer(moveStep);
    }

    // Avanzar (W / ▲)
    if (keys.moveForward) {
      movePlayer(moveStep);
    }

    // Retroceder (S / ▼)
    if (keys.moveBackward) {
      movePlayer(-moveStep);
    }

    // Comprobar umbral de portales / puertas conectadas a otros mapas
    checkPortalThreshold();

    // Renderizar escena 3D y minimapa
    engine.render(player);

    // Actualizar HUD
    updateHUD();

    requestAnimationFrame(gameLoop);
  }

  // Iniciar bucle
  requestAnimationFrame((time) => {
    lastTime = time;
    gameLoop(time);
  });
});

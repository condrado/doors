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
    moveSpeedBase: 3.0, // bloques por segundo (avance, retroceso y strafe)
    velX: 0, // velocidad real actual X (bloques/segundo con inercia suave)
    velY: 0, // velocidad real actual Y (bloques/segundo con inercia suave)
    // Pitch: desplazamiento vertical del horizonte en píxeles (0 = horizontal)
    pitchOffset: 0
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
  const hudFpsPill = document.getElementById('hudFpsPill');
  const fpsVal = document.getElementById('fpsVal');
  const fpsMs = document.getElementById('fpsMs');

  // Barra de acciones inferior
  const barStance = document.getElementById('barStance');
  const barStanceImg  = document.getElementById('barStanceImg');
  const barStanceText = document.getElementById('barStanceText');
  const barText = document.getElementById('barText');
  const barMinimapCanvas = document.getElementById('barMinimapCanvas');
  const barMinimapCtx = barMinimapCanvas ? barMinimapCanvas.getContext('2d') : null;
  const barFaceImg = document.getElementById('barFaceImg');
  const doorMenuOverlay = document.getElementById('doorMenuOverlay');

  // Menú contextual de puerta (inline en barText)
  let doorCtxPendingDoor = null;
  let isMenuOpen = false; // bloquea movimiento y giro mientras el menú está visible
  let barTextFeedbackTimeout = null;
  // true cuando el usuario suelta el pointer lock de forma deliberada (Ctrl+ESC o Ctrl+M)
  // evita que onPointerLockChange lo re-adquiera automáticamente
  let intentionalUnlock = false;

  function setBarMessage(html) {
    if (barText) barText.innerHTML = html;
  }

  function clearBarMessage() {
    if (barTextFeedbackTimeout) { clearTimeout(barTextFeedbackTimeout); barTextFeedbackTimeout = null; }
    if (barText) barText.innerHTML = '';
  }

  function showBarFeedback(html, ms = 2400) {
    if (barTextFeedbackTimeout) clearTimeout(barTextFeedbackTimeout);
    setBarMessage(html);
    barTextFeedbackTimeout = setTimeout(clearBarMessage, ms);
  }

  function setDoorMenuHtml(html) {
    if (doorMenuOverlay) {
      doorMenuOverlay.innerHTML = html;
      doorMenuOverlay.style.display = '';
    }
  }

  function clearDoorMenu() {
    if (doorMenuOverlay) {
      doorMenuOverlay.innerHTML = '';
      doorMenuOverlay.style.display = 'none';
    }
  }

  function closeDoorCtxMenu() {
    isMenuOpen = false;
    doorCtxPendingDoor = null;
    clearDoorMenu();
    // Intentar re-adquirir el lock directamente. Si el navegador lo acepta,
    // pointerlockchange disparará onPointerLockChange con isLocked=true → UI actualizada.
    requestLock();
    // Fallback: si en 350ms el lock no se re-adquirió (el navegador rechazó la
    // petición por venir de un keydown de ESC), mostrar "Haz clic para retomar el ratón".
    setTimeout(() => {
      if (!isMenuOpen) {
        const locked = document.pointerLockElement === canvas || document.mozPointerLockElement === canvas;
        if (!locked) {
          intentionalUnlock = true; // forzar UI de "unlocked" en onPointerLockChange
          onPointerLockChange();
        }
      }
    }, 350);
  }

  function openDoorFromMenu() {
    const pending = doorCtxPendingDoor;
    closeDoorCtxMenu();
    // Iniciar animación de estirar el brazo y abrir la puerta
    armState.reachAnim.active = true;
    armState.reachAnim.phase = 'reach';
    armState.reachAnim.progress = 0;
    armState.reachAnim.touchTriggered = false;
    armState.reachAnim.targetDoor = pending;
  }

  function knockFromMenu() {
    // Sonar los golpes pero mantener el menú abierto y el movimiento bloqueado
    playKnockSound();
    // PUM PUM PUM en la barra inferior
    showBarFeedback('<i class="ri-hand-line"></i> ¡PUM PUM PUM!', 1800);
    // Overlay: mantener "¿Qué quieres hacer?" con botones actualizados
    setDoorMenuHtml(`
      <div class="bar-door-prompt">
        <span class="bar-door-label">¿Qué quieres hacer?</span>
        <div class="bar-door-actions">
          <button class="bar-door-btn bar-door-open" id="barDoorOpenAfterKnock"><i class="ri-door-open-line"></i> Abrir</button>
          <button class="bar-door-btn bar-door-knock" id="barDoorKnockAgain"><i class="ri-hand-line"></i> Llamar</button>
          <button class="bar-door-btn bar-door-cancel" id="barDoorCancelAfterKnock">Cancelar</button>
        </div>
      </div>
    `);
    document.getElementById('barDoorOpenAfterKnock')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openDoorFromMenu();
    });
    document.getElementById('barDoorKnockAgain')?.addEventListener('click', (e) => {
      e.stopPropagation();
      knockFromMenu();
    });
    document.getElementById('barDoorCancelAfterKnock')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeDoorCtxMenu();
    });
    // isMenuOpen sigue en true → movimiento sigue bloqueado
  }

  function showDoorCtxMenu(targetDoor) {
    isMenuOpen = true;
    doorCtxPendingDoor = targetDoor;
    // Liberar el ratón para que el jugador pueda hacer clic en los botones
    releaseLock();

    const isOpen = targetDoor && targetDoor.action === 'close'; // puerta ya abierta
    const doorName = targetDoor && targetDoor.name ? targetDoor.name : 'Puerta';

    if (isOpen) {
      // Puerta abierta: solo Cerrar o Cancelar
      setDoorMenuHtml(`
        <div class="bar-door-prompt">
          <span class="bar-door-label">¿Qué quieres hacer?</span>
          <div class="bar-door-actions">
            <button class="bar-door-btn bar-door-open" id="barDoorClose"><i class="ri-door-closed-line"></i> Cerrar</button>
            <button class="bar-door-btn bar-door-cancel" id="barDoorCancel">Cancelar</button>
          </div>
        </div>
      `);
      document.getElementById('barDoorClose')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openDoorFromMenu();
      });
    } else {
      // Puerta cerrada: Abrir, Llamar o Cancelar
      setDoorMenuHtml(`
        <div class="bar-door-prompt">
          <span class="bar-door-label">¿Qué quieres hacer?</span>
          <div class="bar-door-actions">
            <button class="bar-door-btn bar-door-open" id="barDoorOpen"><i class="ri-door-open-line"></i> Abrir</button>
            <button class="bar-door-btn bar-door-knock" id="barDoorKnock"><i class="ri-hand-line"></i> Llamar</button>
            <button class="bar-door-btn bar-door-cancel" id="barDoorCancel">Cancelar</button>
          </div>
        </div>
      `);
      document.getElementById('barDoorOpen')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openDoorFromMenu();
      });
      document.getElementById('barDoorKnock')?.addEventListener('click', (e) => {
        e.stopPropagation();
        knockFromMenu();
      });
    }

    document.getElementById('barDoorCancel')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeDoorCtxMenu();
    });
  }

  // Gestión de ESC en capture phase (antes que el browser procese pointer lock / fullscreen)
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (ev.ctrlKey) {
        // Ctrl+ESC → soltar el ratón de forma intencional
        ev.preventDefault();
        intentionalUnlock = true;
        releaseLock();
        return;
      }
      if (isMenuOpen) {
        // ESC solo con acción en curso → cerrar menú (el browser no libera lock aquí
        // porque ya estaba libre cuando se abrió el menú)
        ev.preventDefault();
        ev.stopPropagation();
        closeDoorCtxMenu();
      }
      // ESC solo sin menú → el browser libera el pointer lock; onPointerLockChange
      // lo re-adquiere automáticamente (comportamiento transparente para el jugador)
    }
  }, true);

  // Clic en barStance alterna sprint (igual que Shift)
  if (barStance) {
    barStance.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSprint();
    });
  }


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

    // Indicador en la barra inferior
    if (barStance) {
      if (isRunning) {
        barStance.classList.add('sprinting');
        if (barStanceImg)  barStanceImg.src = '/src/assets/personaje-correr.png';
        if (barStanceText) barStanceText.textContent = 'CORRER';
      } else {
        barStance.classList.remove('sprinting');
        if (barStanceImg)  barStanceImg.src = '/src/assets/personaje-andar.png';
        if (barStanceText) barStanceText.textContent = 'ANDAR';
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
    // Ceilings: Set de "x,y" para lookup O(1)
    engine.ceilingsMap = new Map((mapData.ceilings || []).map(([x, y, s]) => [`${x},${y}`, s || 'blanca']));
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
      intentionalUnlock = true; // marcar como intencional para no re-adquirir
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
        btnFullscreen.title = 'Salir de pantalla completa (F)';
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

  canvas.addEventListener('click', () => {
    if (!isMenuOpen) requestLock();
  });

  // En pantalla completa, cualquier clic en el contenedor bloquea el ratón de nuevo
  if (viewportWrapper) {
    viewportWrapper.addEventListener('click', () => {
      if (isMenuOpen) return; // no re-bloquear mientras el menú está abierto
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

  // Genera un buffer de ruido blanco de la duración indicada
  function _noiseBuffer(ctx, secs) {
    const n = Math.ceil(ctx.sampleRate * secs);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Ruido filtrado genérico: source → biquad → gain → destination
  function _noiseLayer(ctx, buf, bpType, freq, Q, vol, start, dur, freqEnd) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = bpType;
    filt.frequency.setValueAtTime(freq, start);
    if (freqEnd) filt.frequency.exponentialRampToValueAtTime(freqEnd, start + dur);
    filt.Q.value = Q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(filt); filt.connect(g); g.connect(ctx.destination);
    src.start(start); src.stop(start + dur + 0.02);
    return src;
  }

  function playDoorOpenSound() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const nb = _noiseBuffer(ctx, 1.4);

      // Clic seco del pestillo: ruido corto lowpass (no bandpass agudo = no "bip")
      _noiseLayer(ctx, nb, 'lowpass', 600, 1, 0.30, now, 0.04);

      // Crujido de bisagra: ruido coloreado ancho, sin barrido — Q bajo para que
      // suene a fricción y no a filtro electrónico
      _noiseLayer(ctx, nb, 'lowpass', 420, 1, 0.22, now + 0.05, 0.55);

      // Componente aguda del crujido (madera/metal) — muy suave
      _noiseLayer(ctx, nb, 'bandpass', 1800, 2, 0.06, now + 0.07, 0.42);

      // Aire desplazado al abrir (muy suave, bajísima frecuencia)
      _noiseLayer(ctx, nb, 'lowpass', 120, 0.5, 0.03, now + 0.18, 0.50);

    } catch (e) { /* audio restringido */ }
  }

  function playDoorCloseSound() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const nb = _noiseBuffer(ctx, 1.2);

      // Crujido al cerrar: igual que al abrir, coloreado ancho
      _noiseLayer(ctx, nb, 'lowpass', 380, 1, 0.18, now, 0.40);
      _noiseLayer(ctx, nb, 'bandpass', 1600, 2, 0.05, now + 0.02, 0.35);

      // Golpe de madera contra el marco: sine bajo (65 Hz) decay rápido
      // + ruido lowpass de impacto
      const thud = ctx.createOscillator();
      const thudG = ctx.createGain();
      thud.type = 'sine';
      thud.frequency.setValueAtTime(65, now + 0.38);
      thud.frequency.exponentialRampToValueAtTime(28, now + 0.70);
      thudG.gain.setValueAtTime(0.0001, now + 0.38);
      thudG.gain.linearRampToValueAtTime(0.70, now + 0.383);
      thudG.gain.exponentialRampToValueAtTime(0.0001, now + 0.70);
      thud.connect(thudG); thudG.connect(ctx.destination);
      thud.start(now + 0.38); thud.stop(now + 0.71);

      _noiseLayer(ctx, nb, 'lowpass', 300, 1, 0.60, now + 0.38, 0.16);

      // Clic del pestillo encajando: ruido muy corto lowpass medio
      _noiseLayer(ctx, nb, 'lowpass', 500, 1, 0.28, now + 0.44, 0.04);

    } catch (e) { /* audio restringido */ }
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
    showBarFeedback(`<span style="color: ${color}; font-weight: 700; display: inline-flex; align-items: center; gap: 6px;"><i class="ri-door-open-line"></i> ${message}</span>`, 2400);
  }

  function playKnockSound() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      // Tres golpes de nudillo en madera: pum-pum-pum
      const knocks = [0, 0.18, 0.36];
      knocks.forEach(offset => {
        const now = ctx.currentTime + offset;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.08);
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.10);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.11);

        // Armónico de madera (cuerpo de la puerta)
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(320, now);
        osc2.frequency.exponentialRampToValueAtTime(140, now + 0.06);
        gain2.gain.setValueAtTime(0.2, now);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now);
        osc2.stop(now + 0.10);
      });
    } catch (e) {}
  }


  // ==========================================
  // ==========================================
  // SISTEMA DE BRAZOS EN PRIMERA PERSONA (VIEWMODEL RETRO PIXELADO)
  // ==========================================
  const armState = {
    walkPhase: 0,
    idlePhase: 0,
    bobAmp: 0,
    isMoving: false,
    isRunning: false,
    reachAnim: {
      active: false,
      phase: 'idle', // 'reach', 'retract'
      progress: 0,
      touchTriggered: false,
      targetDoor: null
    }
  };

  // Canvas secundario de baja resolución para rasterizar los brazos como píxel-art retro
  let armOffscreenCanvas = null;
  let armOffscreenCtx = null;

  /**
   * Dibuja un brazo orgánico continuo (sin diferenciación de mano redonda):
   * más fino en la base y engrosándose suavemente hacia la mano, con sombra continua
   * en la parte IZQUIERDA de ambos brazos tal como en las ilustraciones originales.
   */
  function drawChibiArm(ctx, isRight, rootX, rootY, handX, handY, reachT, scale) {
    ctx.save();

    const dx = handX - rootX;
    const dy = handY - rootY;
    const len = Math.hypot(dx, dy) || 1;
    const dirX = dx / len;
    const dirY = dy / len;
    const perpX = -dirY;
    const perpY = dirX;

    // Brazos más finos en la base y más gorditos gradualmente hacia la mano (sin exagerar)
    // Sin diferenciación de mano: silueta cónica continua y suave
    const baseR = 16 * scale;
    const tipR = 25 * scale;
    const midR = (baseR + tipR) * 0.5;

    // Curvatura suave lateral del brazo
    const sideCurve = isRight ? 12 : -12;
    const midX = (rootX + handX) * 0.5 + perpX * (sideCurve * scale);
    const midY = (rootY + handY) * 0.5 + perpY * (sideCurve * scale);

    const b1x = rootX - perpX * baseR;
    const b1y = rootY - perpY * baseR;
    const b2x = rootX + perpX * baseR;
    const b2y = rootY + perpY * baseR;

    const t1x = handX - perpX * tipR;
    const t1y = handY - perpY * tipR;
    const t2x = handX + perpX * tipR;
    const t2y = handY + perpY * tipR;

    const c1x = midX - perpX * midR;
    const c1y = midY - perpY * midR;
    const c2x = midX + perpX * midR;
    const c2y = midY + perpY * midR;

    const angle = Math.atan2(dirY, dirX);

    // 1. Trazado continuo del brazo (sin mano redonda separada, extremo redondeado natural)
    ctx.beginPath();
    ctx.moveTo(b1x, b1y);
    ctx.quadraticCurveTo(c1x, c1y, t1x, t1y);
    ctx.arc(handX, handY, tipR, angle - Math.PI * 0.5, angle + Math.PI * 0.5, false);
    ctx.quadraticCurveTo(c2x, c2y, b2x, b2y);
    ctx.closePath();

    // 2. Color plano amarillo de la piel (sin degradados)
    ctx.fillStyle = '#fae38e';
    ctx.fill();

    // 3. Sombra sólida continua y curva en la parte IZQUIERDA de AMBOS brazos (sin cortes rectos)
    // Color anterior (#ea9d60 / rgb(234, 157, 96)) con un 65% de transparencia (opacidad 0.35)
    ctx.save();
    ctx.clip(); // Recortar con la forma del brazo

    ctx.fillStyle = 'rgba(234, 157, 96, 0.35)'; // 65% de transparencia (opacidad 0.35)
    ctx.beginPath();
    // El extremo superior de la sombra nace suavemente en el perímetro curvo de la punta
    const sTx = handX - perpX * (tipR * 0.60) + dirX * (tipR * 0.78);
    const sTy = handY - perpY * (tipR * 0.60) + dirY * (tipR * 0.78);
    const sMx = midX - perpX * (midR * 0.20);
    const sMy = midY - perpY * (midR * 0.20);
    const sBx = rootX - perpX * (baseR * 0.20);
    const sBy = rootY - perpY * (baseR * 0.20);

    // Curva interna suave que fluye desde la punta redondeada hacia la base
    ctx.moveTo(sTx, sTy);
    ctx.quadraticCurveTo(sMx, sMy, sBx, sBy);
    // Cierra contorneando por el exterior izquierdo
    ctx.lineTo(rootX - perpX * (baseR * 3), rootY - perpY * (baseR * 3));
    ctx.lineTo(handX - perpX * (tipR * 3) + dirX * (tipR * 1.5), handY - perpY * (tipR * 3) + dirY * (tipR * 1.5));
    ctx.lineTo(sTx, sTy);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 4. Borde oscuro fino retro (1.6px retro)
    ctx.beginPath();
    ctx.moveTo(b1x, b1y);
    ctx.quadraticCurveTo(c1x, c1y, t1x, t1y);
    ctx.arc(handX, handY, tipR, angle - Math.PI * 0.5, angle + Math.PI * 0.5, false);
    ctx.quadraticCurveTo(c2x, c2y, b2x, b2y);
    ctx.closePath();
    ctx.strokeStyle = '#221a14';
    ctx.lineWidth = 1.6 * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Renderiza ambos brazos del jugador con balanceo y apertura de puertas,
   * rasterizado en baja resolución con escalado nearest-neighbor para un look 100% pixelado retro.
   */
  function renderPlayerArms(ctx, width, height, dt) {
    if (!ctx) return;

    // Tamaño de píxel retro (2x o más según resolución para coincidir con las texturas de la sala)
    const pixelSize = Math.max(2, Math.floor(width / 320));
    const lowW = Math.max(160, Math.floor(width / pixelSize));
    const lowH = Math.max(100, Math.floor(height / pixelSize));

    if (!armOffscreenCanvas) {
      armOffscreenCanvas = document.createElement('canvas');
      armOffscreenCtx = armOffscreenCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (armOffscreenCanvas.width !== lowW || armOffscreenCanvas.height !== lowH) {
      armOffscreenCanvas.width = lowW;
      armOffscreenCanvas.height = lowH;
    }

    const offCtx = armOffscreenCtx;
    offCtx.clearRect(0, 0, lowW, lowH);

    // Escala proporcional dentro del búfer de baja resolución
    const scale = Math.min(lowW / 320, lowH / 200);

    // 1. Ciclo de marcha o reposo (amplitud discreta y suave)
    if (armState.isMoving) {
      const freq = armState.isRunning ? 12.0 : 7.2;
      const targetAmp = (armState.isRunning ? 13 : 7) * scale;
      armState.walkPhase += dt * freq;
      armState.bobAmp = armState.bobAmp + (targetAmp - armState.bobAmp) * Math.min(1, dt * 10);
    } else {
      armState.idlePhase += dt * 2.2;
      armState.walkPhase *= Math.max(0, 1 - dt * 6.5);
      armState.bobAmp = (armState.bobAmp || 0) * Math.max(0, 1 - dt * 6.5);
    }

    // 2. Animación de estirar el brazo para interactuar con la puerta
    let reachT = 0;
    if (armState.reachAnim.active) {
      const reachSpeed = 4.2; // ~0.24s para alcanzar la puerta
      const retractSpeed = 4.5; // ~0.22s para volver

      if (armState.reachAnim.phase === 'reach') {
        armState.reachAnim.progress += dt * reachSpeed;
        if (armState.reachAnim.progress >= 1.0) {
          armState.reachAnim.progress = 1.0;
          armState.reachAnim.phase = 'retract';

          // Contacto exacto con la puerta al estirar el brazo: la puerta se abre en este instante
          if (!armState.reachAnim.touchTriggered) {
            armState.reachAnim.touchTriggered = true;
            executeDoorTouchInteraction();
          }
        }
      } else if (armState.reachAnim.phase === 'retract') {
        armState.reachAnim.progress -= dt * retractSpeed;
        if (armState.reachAnim.progress <= 0.0) {
          armState.reachAnim.progress = 0;
          armState.reachAnim.active = false;
          armState.reachAnim.phase = 'idle';
        }
      }

      const p = armState.reachAnim.progress;
      reachT = Math.sin(p * Math.PI * 0.5);
    }

    // 3. Posiciones de los brazos gorditos (asomando solo la mitad de antes)
    const walkBobL = Math.sin(armState.walkPhase) * (armState.bobAmp || 0);
    const walkSwayL = Math.cos(armState.walkPhase) * (3.5 * scale);

    const walkBobR = Math.sin(armState.walkPhase + Math.PI) * (armState.bobAmp || 0);
    const walkSwayR = -Math.cos(armState.walkPhase) * (3.5 * scale);

    const idleBobL = Math.sin(armState.idlePhase) * (1.5 * scale);
    const idleBobR = Math.sin(armState.idlePhase + 0.6) * (1.5 * scale);

    // Elevar brazos para que no queden detrás de la barra inferior (88px CSS)
    const barCssPx = 88;
    const viewportH = window.innerHeight || height;
    const armFloor = lowH * (1 - barCssPx / viewportH);

    // Brazo izquierdo (asomando solo la mitad en la esquina inferior izquierda)
    const rootLX = lowW * 0.12;
    const rootLY = armFloor * 1.14;
    const handLX = lowW * 0.26 + (armState.isMoving ? walkSwayL : 0) - (reachT * 10 * scale);
    const handLY = armFloor * 0.885 + (armState.isMoving ? walkBobL : idleBobL) + (reachT * 14 * scale);

    drawChibiArm(offCtx, false, rootLX, rootLY, handLX, handLY, 0, scale);

    // Brazo derecho (descanso a 0.885, estira hasta 0.52 al tocar la puerta)
    const rootRX = lowW * 0.88;
    const rootRY = armFloor * 1.14;

    const restHandRX = lowW * 0.74 + (armState.isMoving ? walkSwayR : 0);
    const restHandRY = armFloor * 0.885 + (armState.isMoving ? walkBobR : idleBobR);

    // Objetivo al estirar hacia la puerta: se desplaza al centro horizontalmente
    // pero mantiene la misma altura (sin subir, para no parecer un puñetazo)
    const targetHandRX = lowW * 0.50;
    const targetHandRY = restHandRY; // sin cambio vertical

    const handRX = restHandRX + (targetHandRX - restHandRX) * reachT;
    const handRY = restHandRY; // altura fija durante toda la animación

    const armScaleR = scale * (1.0 - reachT * 0.15); // perspectiva hacia el fondo

    drawChibiArm(offCtx, true, rootRX, rootRY, handRX, handRY, reachT, armScaleR);

    // 4. Dibujar en el canvas principal con interpolación desactivada (nearest-neighbor = píxeles duros retro)
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if ('mozImageSmoothingEnabled' in ctx) ctx.mozImageSmoothingEnabled = false;
    if ('webkitImageSmoothingEnabled' in ctx) ctx.webkitImageSmoothingEnabled = false;
    if ('msImageSmoothingEnabled' in ctx) ctx.msImageSmoothingEnabled = false;
    ctx.drawImage(armOffscreenCanvas, 0, 0, lowW, lowH, 0, 0, width, height);
    ctx.restore();
  }

  function tryInteractDoor() {
    if (armState.reachAnim.active) return;

    // Si el menú ya está abierto, ignorar clics en el canvas (solo botones / ESC lo cierran)
    if (isMenuOpen) return;

    // Verificar si hay puerta interactuable en rango
    const targetDoor = (typeof engine.getDoorInReach === 'function') ? engine.getDoorInReach(player, 1.5) : null;
    if (!targetDoor) {
      // Intento breve al aire si no hay puerta inmediata
      armState.reachAnim.active = true;
      armState.reachAnim.phase = 'reach';
      armState.reachAnim.progress = 0;
      armState.reachAnim.touchTriggered = true; // no disparará apertura
      armState.reachAnim.targetDoor = null;
      return;
    }

    // Hay puerta al alcance: mostrar menú contextual
    showDoorCtxMenu(targetDoor);
  }

  function executeDoorTouchInteraction() {
    let res = null;
    const target = armState.reachAnim.targetDoor;
    if (target && target.mapX !== undefined && target.mapY !== undefined) {
      if (target.action === 'close') {
        res = engine.closeDoor(target.mapX, target.mapY, player);
      } else {
        res = engine.openDoor(target.mapX, target.mapY);
      }
    } else {
      res = engine.interactDoor(player, 1.5);
    }
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

      player.velX = 0;
      player.velY = 0;

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
    if (isMenuOpen) return; // no cambiar mensaje mientras el menú está abierto
    const isLocked = (document.pointerLockElement === canvas || document.mozPointerLockElement === canvas);

    // Lock perdido sin intención (ESC del browser u otro evento externo).
    // Re-adquirir silenciosamente sin actualizar la UI: el jugador no debe notar nada.
    // Si requestLock tiene éxito, pointerlockchange vuelve a disparar con isLocked=true.
    if (!isLocked && !intentionalUnlock) {
      requestLock();
      return;
    }
    intentionalUnlock = false; // reset tras unlock intencional (Ctrl+M)

    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);

    if (btnMouseLook) {
      if (isLocked) {
        btnMouseLook.classList.add('active');
        if (iconMouseLook) iconMouseLook.className = 'ri-mouse-fill';
        if (textMouseLook) textMouseLook.textContent = 'Mirando (Ctrl+M)';
        btnMouseLook.title = 'Liberar ratón (Ctrl+M)';
      } else {
        btnMouseLook.classList.remove('active');
        if (iconMouseLook) iconMouseLook.className = 'ri-mouse-line';
        if (textMouseLook) textMouseLook.textContent = 'Mirar con el ratón';
        btnMouseLook.title = 'Haz clic o Ctrl+M para mirar con el ratón';
      }
    }

    // Mensajes de ayuda en la barra inferior
    if (!barTextFeedbackTimeout) {
      const panelsHidden = appContainer && appContainer.classList.contains('panels-hidden');
      const panelHint = panelsHidden ? 'mostrar paneles' : 'ocultar paneles';
      if (isFs) {
        setBarMessage(isLocked
          ? `Mueve el ratón para <strong>mirar</strong> • <strong>[Clic / Enter]</strong> interactuar con puertas • [Ctrl+M] liberar ratón`
          : `Haz clic para retomar el control del ratón • [F] salir pantalla completa`);
      } else {
        setBarMessage(isLocked
          ? `Mueve el ratón para <strong>mirar</strong> • <strong>[Clic / Enter]</strong> interactuar con puertas • [Ctrl+M] liberar ratón`
          : `Haz clic en la pantalla para retomar el control del ratón • <strong>[H]</strong> ${panelHint} • <strong>[F]</strong> pantalla completa`);
      }
    }
  }

  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('mozpointerlockchange', onPointerLockChange);

  // Girar la cámara al mover el ratón cuando está bloqueado
  window.addEventListener('mousemove', (e) => {
    if (isMenuOpen) return; // bloquear rotación mientras el menú está abierto
    if (document.pointerLockElement === canvas || document.mozPointerLockElement === canvas) {
      const movementX = e.movementX || e.mozMovementX || e.webkitMovementX || 0;
      const movementY = e.movementY || e.mozMovementY || e.webkitMovementY || 0;
      if (movementX !== 0) {
        rotatePlayer(movementX * mouseSensitivity);
      }
      if (movementY !== 0) {
        // Límite de pitch: ±60% de la altura de pantalla (evita girar 360°)
        // Negativo porque ratón arriba = movementY negativo = pitchOffset baja el horizonte = mirar arriba
        const maxPitch = canvas.height * 0.60;
        player.pitchOffset = Math.max(-maxPitch, Math.min(maxPitch, player.pitchOffset - movementY * mouseSensitivity * canvas.height * 0.5));
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

    // Ctrl+M → alternar pointer lock (Mirar con el ratón)
    if ((e.key === 'm' || e.key === 'M') && (e.ctrlKey || e.metaKey)) {
      toggleMouseLook();
      e.preventDefault();
      return;
    }

    switch (e.key.toLowerCase()) {
      case 'enter':
      case 'e':
      case ' ':
      case 'space':
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
      case 'g':
        if (engine) {
          engine.debugGuide = !engine.debugGuide;
        }
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
      player.pitchOffset = 0; // resetear pitch al volver al spawn
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
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    const oldDirX = player.dirX;
    const newDirX = player.dirX * cosA - player.dirY * sinA;
    const newDirY = oldDirX * sinA + player.dirY * cosA;

    // Re-normalizar vector de mirada a longitud unitaria exacta (evita deformación de cámara)
    const dirLen = Math.hypot(newDirX, newDirY) || 1.0;
    player.dirX = newDirX / dirLen;
    player.dirY = newDirY / dirLen;

    // Mantener plano de cámara rigurosamente ortogonal con su escala de FOV
    const planeLen = Math.hypot(player.planeX, player.planeY) || 0.66;
    player.planeX = -player.dirY * planeLen;
    player.planeY = player.dirX * planeLen;
  }

  // ==========================================
  // FÍSICAS DE COLISIÓN Y BODY BLOCK (MESAS Y MUROS)
  // ==========================================
  const PLAYER_RADIUS = 0.22;
  const MAX_SUB_STEP = 0.04;

  /**
   * Determina si una celda contiene una mesa (todas las variantes)
   */
  function isCellTable(cx, cy) {
    if (cy < 0 || cy >= engine.mapHeight || cx < 0 || cx >= engine.mapWidth) return false;
    const cell = engine.map && engine.map[cy] && engine.map[cy][cx];
    if (typeof cell === 'number' && (cell === 9 || (cell >= 15 && cell <= 21))) return true;
    if (typeof cell === 'string' && (cell === '9' || cell.startsWith('T'))) return true;
    if (Array.isArray(cell) && cell.some(c => (typeof c === 'string' && c.startsWith('T')) || (typeof c === 'number' && (c === 9 || (c >= 15 && c <= 21))))) return true;
    const segs = engine.getCellSegments(cx, cy);
    if (segs && segs.some(s => s.isTable)) return true;
    return false;
  }

  /**
   * Determina si una celda es un bloque sólido completo 1x1
   */
  function isCellSolidBlock(cx, cy) {
    if (cy < 0 || cy >= engine.mapHeight || cx < 0 || cx >= engine.mapWidth) return true;
    const cell = engine.map && engine.map[cy] && engine.map[cy][cx];
    if (cell === 1 || cell === 'corner_FULL_BOX') return true;
    if (Array.isArray(cell) && ['N', 'S', 'E', 'W'].every(k => cell.includes(k))) return true;
    return false;
  }

  /**
   * Calcula la profundidad máxima de penetración (>0 si hay colisión, 0 si la posición es válida)
   */
  function getPenetration(px, py, radius = PLAYER_RADIUS) {
    let maxPen = 0;

    // 1. Límites del mapa
    if (px - radius < 0) maxPen = Math.max(maxPen, radius - px);
    if (px + radius > engine.mapWidth) maxPen = Math.max(maxPen, (px + radius) - engine.mapWidth);
    if (py - radius < 0) maxPen = Math.max(maxPen, radius - py);
    if (py + radius > engine.mapHeight) maxPen = Math.max(maxPen, (py + radius) - engine.mapHeight);

    // Celdas circundantes que el círculo de colisión del jugador puede solapar
    const minCX = Math.max(0, Math.floor(px - radius));
    const maxCX = Math.min(engine.mapWidth - 1, Math.floor(px + radius));
    const minCY = Math.max(0, Math.floor(py - radius));
    const maxCY = Math.min(engine.mapHeight - 1, Math.floor(py + radius));

    for (let cy = minCY; cy <= maxCY; cy++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        // Bloque completo sólido: Mesa o Pared Bloque 1x1 (BODY BLOCK TOTAL)
        if (isCellTable(cx, cy) || isCellSolidBlock(cx, cy)) {
          const clX = Math.max(cx, Math.min(px, cx + 1.0));
          const clY = Math.max(cy, Math.min(py, cy + 1.0));
          const dist = Math.hypot(px - clX, py - clY);
          if (dist < radius) {
            maxPen = Math.max(maxPen, radius - dist);
          }
          continue;
        }

        // Segmentos finos de pared o puertas en esta celda
        const segments = engine.getCellSegments(cx, cy);
        if (!segments || segments.length === 0) continue;

        for (let s = 0; s < segments.length; s++) {
          const seg = segments[s];
          // Dintel superior y hojas abatidas de puertas abiertas permiten el paso
          if (seg.isLintelOnly || seg.isOpenDoor) continue;

          // Por si la celda contenía mesa y no fue capturada antes
          if (seg.isTable) {
            const clX = Math.max(cx, Math.min(px, cx + 1.0));
            const clY = Math.max(cy, Math.min(py, cy + 1.0));
            const dist = Math.hypot(px - clX, py - clY);
            if (dist < radius) {
              maxPen = Math.max(maxPen, radius - dist);
            }
            continue;
          }

          if (seg.axis === 'y') {
            const minX = seg.minX !== undefined ? seg.minX : cx;
            const maxX = seg.maxX !== undefined ? seg.maxX : (cx + 1.0);
            const clX = Math.max(minX, Math.min(px, maxX));
            const clY = seg.pos;
            const dist = Math.hypot(px - clX, py - clY);
            if (dist < radius) {
              maxPen = Math.max(maxPen, radius - dist);
            }
          } else if (seg.axis === 'x') {
            const minY = seg.minY !== undefined ? seg.minY : cy;
            const maxY = seg.maxY !== undefined ? seg.maxY : (cy + 1.0);
            const clX = seg.pos;
            const clY = Math.max(minY, Math.min(py, maxY));
            const dist = Math.hypot(px - clX, py - clY);
            if (dist < radius) {
              maxPen = Math.max(maxPen, radius - dist);
            }
          }
        }
      }
    }

    return maxPen;
  }

  /**
   * Comprobación booleana de transitabilidad
   */
  function canStepTo(targetX, targetY) {
    return getPenetration(targetX, targetY, PLAYER_RADIUS) <= 0;
  }

  /**
   * Resuelve colisiones circulares empujando suavemente al jugador hacia afuera de paredes, mesas y obstáculos.
   * Permite un deslizamiento continuo y fluido (Wall Sliding real) sin bloquear el movimiento lateral.
   */
  function resolvePosition(px, py, radius = PLAYER_RADIUS) {
    let curX = px;
    let curY = py;

    for (let iter = 0; iter < 3; iter++) {
      let maxPen = 0;

      // 1. Límites del mapa
      if (curX - radius < 0) {
        maxPen = Math.max(maxPen, radius - curX);
        curX = radius;
      }
      if (curX + radius > engine.mapWidth) {
        maxPen = Math.max(maxPen, (curX + radius) - engine.mapWidth);
        curX = engine.mapWidth - radius;
      }
      if (curY - radius < 0) {
        maxPen = Math.max(maxPen, radius - curY);
        curY = radius;
      }
      if (curY + radius > engine.mapHeight) {
        maxPen = Math.max(maxPen, (curY + radius) - engine.mapHeight);
        curY = engine.mapHeight - radius;
      }

      const minCX = Math.max(0, Math.floor(curX - radius));
      const maxCX = Math.min(engine.mapWidth - 1, Math.floor(curX + radius));
      const minCY = Math.max(0, Math.floor(curY - radius));
      const maxCY = Math.min(engine.mapHeight - 1, Math.floor(curY + radius));

      for (let cy = minCY; cy <= maxCY; cy++) {
        for (let cx = minCX; cx <= maxCX; cx++) {
          // Bloques sólidos y mesas completas
          if (isCellTable(cx, cy) || isCellSolidBlock(cx, cy)) {
            const clX = Math.max(cx, Math.min(curX, cx + 1.0));
            const clY = Math.max(cy, Math.min(curY, cy + 1.0));
            const dx = curX - clX;
            const dy = curY - clY;
            const dist = Math.hypot(dx, dy);
            if (dist < radius) {
              const pen = radius - dist;
              maxPen = Math.max(maxPen, pen);
              if (dist > 1e-5) {
                curX += (dx / dist) * pen;
                curY += (dy / dist) * pen;
              } else {
                curX += pen;
              }
            }
            continue;
          }

          const segments = engine.getCellSegments(cx, cy);
          if (!segments || segments.length === 0) continue;

          for (let s = 0; s < segments.length; s++) {
            const seg = segments[s];
            if (seg.isLintelOnly || seg.isOpenDoor) continue;

            if (seg.isTable) {
              const clX = Math.max(cx, Math.min(curX, cx + 1.0));
              const clY = Math.max(cy, Math.min(curY, cy + 1.0));
              const dx = curX - clX;
              const dy = curY - clY;
              const dist = Math.hypot(dx, dy);
              if (dist < radius) {
                const pen = radius - dist;
                maxPen = Math.max(maxPen, pen);
                if (dist > 1e-5) {
                  curX += (dx / dist) * pen;
                  curY += (dy / dist) * pen;
                } else {
                  curX += pen;
                }
              }
              continue;
            }

            if (seg.axis === 'y') {
              const minX = seg.minX !== undefined ? seg.minX : cx;
              const maxX = seg.maxX !== undefined ? seg.maxX : (cx + 1.0);
              const clX = Math.max(minX, Math.min(curX, maxX));
              const clY = seg.pos;
              const dx = curX - clX;
              const dy = curY - clY;
              const dist = Math.hypot(dx, dy);
              if (dist < radius) {
                const pen = radius - dist;
                maxPen = Math.max(maxPen, pen);
                if (dist > 1e-5) {
                  curX += (dx / dist) * pen;
                  curY += (dy / dist) * pen;
                } else {
                  curY += (dy >= 0 ? pen : -pen);
                }
              }
            } else if (seg.axis === 'x') {
              const minY = seg.minY !== undefined ? seg.minY : cy;
              const maxY = seg.maxY !== undefined ? seg.maxY : (cy + 1.0);
              const clX = seg.pos;
              const clY = Math.max(minY, Math.min(curY, maxY));
              const dx = curX - clX;
              const dy = curY - clY;
              const dist = Math.hypot(dx, dy);
              if (dist < radius) {
                const pen = radius - dist;
                maxPen = Math.max(maxPen, pen);
                if (dist > 1e-5) {
                  curX += (dx / dist) * pen;
                  curY += (dy / dist) * pen;
                } else {
                  curX += (dx >= 0 ? pen : -pen);
                }
              }
            }
          }
        }
      }

      if (maxPen < 1e-4) break;
    }

    return { x: curX, y: curY };
  }

  /**
   * Desplaza al jugador aplicando subdivisión de pasos (sub-stepping) y deslizamiento continuo (wall/body sliding).
   * Garantiza que, incluso corriendo a máxima velocidad con Shift, jamás se atraviese una pared ni se atasque al rozarla.
   */
  function stepPlayer(dx, dy) {
    const totalDist = Math.hypot(dx, dy);
    if (totalDist < 1e-7) return;

    // Subdividir el paso si la velocidad o el delta time son elevados (evita tunneling)
    const numSteps = Math.max(1, Math.ceil(totalDist / MAX_SUB_STEP));
    const stepX = dx / numSteps;
    const stepY = dy / numSteps;

    for (let i = 0; i < numSteps; i++) {
      const nextPos = resolvePosition(player.posX + stepX, player.posY + stepY, PLAYER_RADIUS);
      player.posX = nextPos.x;
      player.posY = nextPos.y;
    }
  }

  /**
   * Movimiento de avance / retroceso en la dirección de la mirada (dirX, dirY)
   */
  function movePlayer(dist) {
    stepPlayer(player.dirX * dist, player.dirY * dist);
  }

  /**
   * Desplazamiento lateral (Strafe) perpendicular a la dirección de la mirada
   * Vector normal a la derecha: (-dirY, dirX)
   */
  function strafePlayer(dist) {
    const strafeDirX = -player.dirY;
    const strafeDirY = player.dirX;
    stepPlayer(strafeDirX * dist, strafeDirY * dist);
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
  // ── Cara del personaje en la barra inferior ──────────────────────────────
  const FACE_IMGS = {
    f: '/src/assets/personaje-f.png',
    l: '/src/assets/personaje-l.png',
    r: '/src/assets/personaje-r.png',
  };
  // Tiempo que el personaje mantiene la mirada lateral antes de volver al frente (ms)
  const FACE_SIDE_HOLD_MS = 300;

  let facePrevAngle = Math.atan2(player.dirY, player.dirX);
  let faceLookOffset = 0;
  let faceCurrentVariant = 'f';
  let faceLastTurnTime = 0;      // última vez que hubo giro activo
  let faceLockedSide = null;     // 'l' | 'r' | null — variante bloqueada durante el hold

  function drawBarFace() {
    if (!barFaceImg) return;

    const curAngle = Math.atan2(player.dirY, player.dirX);
    let delta = curAngle - facePrevAngle;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    facePrevAngle = curAngle;

    const now = performance.now();

    // Umbral más alto (0.008) para ignorar micro-ajustes al andar recto
    const isTurning = Math.abs(delta) > 0.008;
    const turnDir   = delta > 0.008 ? 1 : delta < -0.008 ? -1 : 0;

    // Detectar el momento exacto en que se DEJA de girar (flanco descendente)
    if (isTurning) {
      // Girando activamente: acumular offset y refrescar el lado bloqueado
      faceLookOffset    += (turnDir - faceLookOffset) * 0.18;
      faceLastTurnTime   = now;
      faceLockedSide     = faceLookOffset > 0.3 ? 'r' : faceLookOffset < -0.3 ? 'l' : faceLockedSide;
    } else {
      // No girando: decaer el offset hacia 0 inmediatamente
      faceLookOffset += (0 - faceLookOffset) * 0.18;
    }

    let variant;

    if (isTurning && Math.abs(faceLookOffset) > 0.3) {
      // Giro activo y suficiente offset: mostrar lateral
      variant = faceLookOffset > 0 ? 'r' : 'l';
      faceLockedSide = variant;
    } else if (!isTurning && faceLockedSide) {
      // Parado de girar: hold de 1 segundo
      const elapsed = now - faceLastTurnTime;
      if (elapsed < FACE_SIDE_HOLD_MS) {
        variant = faceLockedSide;
      } else {
        // Hold terminado: frente y limpiar
        variant        = 'f';
        faceLockedSide = null;
        faceLookOffset = 0;
      }
    } else {
      variant = 'f';
    }

    if (variant !== faceCurrentVariant) {
      faceCurrentVariant = variant;
      barFaceImg.src = FACE_IMGS[variant];
    }
  }

  const TARGET_FPS = 60;
  const FRAME_INTERVAL = 1000 / TARGET_FPS; // 16.666 ms
  let lastTime = performance.now();
  let fpsFrameCount = 0;
  let fpsLastSampleTime = performance.now();
  let fpsFrameTimeSum = 0;

  function gameLoop(currentTime) {
    requestAnimationFrame(gameLoop);

    const elapsed = currentTime - lastTime;
    // Forzar límite estricto de 60 FPS: si el monitor tiene mayor tasa (75Hz, 120Hz, 144Hz), omitir ticks adicionales
    if (elapsed < FRAME_INTERVAL - 1.0) {
      return;
    }

    const dt = Math.min(elapsed / 1000, 0.1); // delta time en segundos
    lastTime = currentTime - (elapsed % FRAME_INTERVAL);

    // Medición de rendimiento FPS y tiempo de fotograma (muestra cada 250ms)
    fpsFrameCount++;
    fpsFrameTimeSum += elapsed;
    if (currentTime - fpsLastSampleTime >= 250) {
      const sampleElapsed = currentTime - fpsLastSampleTime;
      const currentFps = Math.min(60, Math.round((fpsFrameCount * 1000) / sampleElapsed));
      const avgMs = (fpsFrameTimeSum / fpsFrameCount).toFixed(1);

      if (fpsVal) fpsVal.textContent = currentFps;
      if (fpsMs) fpsMs.textContent = `${avgMs}ms`;

      if (hudFpsPill) {
        hudFpsPill.classList.remove('fps-good', 'fps-warn', 'fps-bad');
        if (currentFps >= 55) {
          hudFpsPill.classList.add('fps-good');
        } else if (currentFps >= 35) {
          hudFpsPill.classList.add('fps-warn');
        } else {
          hudFpsPill.classList.add('fps-bad');
        }
      }

      fpsFrameCount = 0;
      fpsFrameTimeSum = 0;
      fpsLastSampleTime = currentTime;
    }

    // Cálculo de movimiento fluido con aceleración, inercia y normalización diagonal
    let wishX = 0;
    let wishY = 0;

    if (!isMenuOpen) {
      if (keys.moveForward) {
        wishX += player.dirX;
        wishY += player.dirY;
      }
      if (keys.moveBackward) {
        wishX -= player.dirX;
        wishY -= player.dirY;
      }
      if (keys.strafeLeft) {
        wishX += player.dirY;
        wishY -= player.dirX;
      }
      if (keys.strafeRight) {
        wishX -= player.dirY;
        wishY += player.dirX;
      }
    }

    const wishLen = Math.hypot(wishX, wishY);
    let targetVelX = 0;
    let targetVelY = 0;

    if (wishLen > 1e-5) {
      const speedMult = isRunning ? 1.8 : 1.0;
      const targetSpeed = player.moveSpeedBase * speedMult;
      targetVelX = (wishX / wishLen) * targetSpeed;
      targetVelY = (wishY / wishLen) * targetSpeed;
    }

    // Amortiguación progresiva (aceleración reactiva de ~70ms y frenada suave de ~80ms)
    const accelRate = (wishLen > 1e-5) ? 14.0 : 12.0;
    const lerpFactor = Math.min(1.0, dt * accelRate);
    player.velX = (player.velX || 0) + (targetVelX - (player.velX || 0)) * lerpFactor;
    player.velY = (player.velY || 0) + (targetVelY - (player.velY || 0)) * lerpFactor;

    if (Math.hypot(player.velX, player.velY) < 1e-4) {
      player.velX = 0;
      player.velY = 0;
    }

    const moveDX = player.velX * dt;
    const moveDY = player.velY * dt;
    if (Math.hypot(moveDX, moveDY) > 1e-7) {
      stepPlayer(moveDX, moveDY);
    }

    // Estado del sistema de brazos según velocidad real
    const currentSpeed = Math.hypot(player.velX, player.velY);
    const isMoving = currentSpeed > 0.15;
    armState.isMoving = isMoving;
    armState.isRunning = isRunning;

    // Comprobar umbral de portales / puertas conectadas a otros mapas
    checkPortalThreshold();

    // Actualizar elevación vertical del jugador si pisa una celda con escalera
    const cx = Math.floor(player.posX);
    const cy = Math.floor(player.posY);
    let stairToken = null;
    const row = engine.map ? engine.map[cy] : null;
    const cell = row ? row[cx] : null;
    if (typeof cell === 'string' && cell.startsWith('STAIRS_')) stairToken = cell;
    else if (Array.isArray(cell)) stairToken = cell.find(c => typeof c === 'string' && c.startsWith('STAIRS_'));

    let targetElevation = 0;
    if (stairToken) {
      const parts = stairToken.split('_');
      const dir = parts[1] || 'UP';
      const orient = parts[2] || 'N';
      const level = parseInt(parts[3], 10) || 1;
      const baseH = (level - 1) * 1.0;
      const isUp = (dir === 'UP');
      const fx = player.posX - cx;
      const fy = player.posY - cy;

      let prog = 0.5;
      if (orient === 'N') prog = 1.0 - fy;
      else if (orient === 'S') prog = fy;
      else if (orient === 'E') prog = fx;
      else prog = 1.0 - fx;

      prog = Math.max(0, Math.min(0.999, prog));
      const stepIdx = Math.floor(prog * 3);
      if (isUp) {
        // Subir: de 0m a +3m
        const baseH = (level - 1) * 1.0;
        const stepFraction = (stepIdx + 1) / 3;
        targetElevation = baseH + stepFraction * 1.0;
      } else {
        // Bajar: bajo el suelo de 0m a -3m (N3: 0 a -1m entrada, N2: -1 a -2m, N1: -2 a -3m fondo)
        const startZ = - (3 - level) * 1.0;
        const stepFraction = (stepIdx + 1) / 3;
        targetElevation = startZ - stepFraction * 1.0;
      }
    }

    if (player.elevation === undefined) player.elevation = 0;
    const lerpRate = Math.min(1.0, dt * 10);
    player.elevation += (targetElevation - player.elevation) * lerpRate;

    // Renderizar escena 3D y minimapa principal
    engine.render(player);

    // Renderizar brazos chibi en primera persona (balanceo al andar/correr y animación al abrir puertas)
    renderPlayerArms(engine.ctx, canvas.width, canvas.height, dt);

    // Actualizar HUD
    updateHUD();

    // Renderizar minimapa en barra inferior
    if (barMinimapCtx && barMinimapCanvas && typeof engine.renderMinimap === 'function') {
      engine.renderMinimap(player, barMinimapCtx, barMinimapCanvas.width, barMinimapCanvas.height);
    }

    // Cara del personaje en barra inferior
    drawBarFace();
  }

  // Iniciar bucle
  requestAnimationFrame((time) => {
    lastTime = time;
    gameLoop(time);
  });
});

/**
 * Controlador Principal del Juego (Bucle, Entradas y Estado)
 * Incluye soporte de Mouse Look (Pointer Lock API) y Desplazamiento Lateral (Strafe).
 */

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('gameCanvas');
  const minimapCanvas = document.getElementById('minimapCanvas');

  // Inicializar motor Raycaster
  const engine = new RaycasterEngine(canvas, minimapCanvas);

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
  const compassStrip = document.getElementById('compassStrip');
  const mouseSensRange = document.getElementById('mouseSensRange');
  const textureModeSelect = document.getElementById('textureModeSelect');
  const levelPill = document.getElementById('levelPill');
  const levelNameText = document.getElementById('levelNameText');
  const pointerLockOverlay = document.getElementById('pointerLockOverlay');
  const promptHud = document.getElementById('promptHud');

  // Guardar punto de spawn original para el botón de centrar
  let spawnX = player.posX;
  let spawnY = player.posY;

  // Comprobar si hay un nivel personalizado enviado desde el editor
  const urlParams = new URLSearchParams(window.location.search);
  const savedCustom = localStorage.getItem('customRaycasterMap');
  if (savedCustom && (urlParams.get('custom') === '1' || urlParams.has('custom'))) {
    try {
      const customData = JSON.parse(savedCustom);
      if (customData.map && Array.isArray(customData.map)) {
        engine.map = customData.map;
        engine.mapWidth = customData.map[0].length;
        engine.mapHeight = customData.map.length;

        if (customData.playerStart) {
          player.posX = customData.playerStart.x;
          player.posY = customData.playerStart.y;
          spawnX = player.posX;
          spawnY = player.posY;
        }

        if (levelPill && levelNameText) {
          levelPill.style.display = 'inline-block';
          levelNameText.textContent = `${customData.name || 'Nivel Editor'} (${engine.mapWidth}x${engine.mapHeight})`;
        }
      }
    } catch (err) {
      console.warn('No se pudo cargar el mapa personalizado:', err);
    }
  }

  // Botones táctiles / UI
  const btnStrafeLeft = document.getElementById('btnStrafeLeft');
  const btnStrafeRight = document.getElementById('btnStrafeRight');
  const btnForward = document.getElementById('btnForward');
  const btnBackward = document.getElementById('btnBackward');
  const btnCenter = document.getElementById('btnCenter');

  // ==========================================
  // PANTALLA COMPLETA & CAPTURA DE RATÓN
  // ==========================================
  const btnFullscreen = document.getElementById('btnFullscreen');
  const viewportWrapper = document.querySelector('.viewport-wrapper');

  function requestLock() {
    canvas.requestPointerLock = canvas.requestPointerLock || canvas.mozRequestPointerLock;
    if (canvas.requestPointerLock) {
      canvas.requestPointerLock();
    }
  }

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
        // Al entrar en pantalla completa, capturar y bloquear el cursor de inmediato
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
      btnFullscreen.innerHTML = isFs
        ? '<span class="fs-icon">🗗</span><span class="fs-label">Salir</span>'
        : '<span class="fs-icon">⛶</span><span class="fs-label">Pantalla Completa</span>';
      btnFullscreen.title = isFs ? 'Salir de pantalla completa (ESC / F)' : 'Pantalla Completa (F)';
    }

    if (isFs) {
      // Ratón atrapado y bloqueado dentro de pantalla completa
      requestLock();
    } else {
      // Al restaurarse la visión al estado normal y original, liberar el ratón
      if (document.exitPointerLock) {
        document.exitPointerLock();
      }
    }
    onPointerLockChange();
  }

  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  document.addEventListener('mozfullscreenchange', onFullscreenChange);

  if (pointerLockOverlay) {
    pointerLockOverlay.addEventListener('click', requestLock);
  }
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

  function onPointerLockChange() {
    const isLocked = (document.pointerLockElement === canvas || document.mozPointerLockElement === canvas);
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);

    if (pointerLockOverlay) {
      if (isLocked) {
        pointerLockOverlay.classList.add('hidden');
      } else {
        pointerLockOverlay.classList.remove('hidden');
      }
    }

    if (promptHud) {
      if (isFs) {
        promptHud.innerHTML = isLocked
          ? `Pantalla Completa • Mueve el ratón para <strong>mirar</strong> • <strong>[A][D]</strong> strafe • [ESC] o [F] salir`
          : `Haz clic para <strong>bloquear el ratón</strong> de nuevo • [ESC] o [F] salir de pantalla completa`;
      } else {
        promptHud.innerHTML = isLocked
          ? `Mueve el ratón para <strong>mirar</strong> • <strong>[A][D]</strong> movimiento lateral • [ESC] liberar ratón`
          : `Haz clic en la pantalla para <strong>apuntar con el ratón</strong> • <strong>[A][D]</strong> movimiento lateral • <strong>[F]</strong> pantalla completa`;
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
    switch (e.key.toLowerCase()) {
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
    });
  }

  // ==========================================
  // AJUSTES
  // ==========================================
  if (mouseSensRange) {
    mouseSensRange.addEventListener('input', (e) => {
      // De 1 a 5 -> mapear a rango [0.0010 - 0.0045]
      const val = parseFloat(e.target.value);
      mouseSensitivity = 0.0008 + (val / 5) * 0.0035;
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
  // ACTUALIZACIÓN DEL HUD Y BRÚJULA
  // ==========================================
  function updateHUD() {
    // Calcular ángulo en grados (0° = Norte, 90° = Este, 180° = Sur, 270° = Oeste)
    let rad = Math.atan2(player.dirX, -player.dirY);
    let deg = Math.round((rad * 180 / Math.PI + 360) % 360);

    let cardinal = 'Norte';
    if (deg >= 337.5 || deg < 22.5) cardinal = 'Norte (0°)';
    else if (deg >= 22.5 && deg < 67.5) cardinal = 'Noreste (45°)';
    else if (deg >= 67.5 && deg < 112.5) cardinal = 'Este (90°)';
    else if (deg >= 112.5 && deg < 157.5) cardinal = 'Sureste (135°)';
    else if (deg >= 157.5 && deg < 202.5) cardinal = 'Sur (180°)';
    else if (deg >= 202.5 && deg < 247.5) cardinal = 'Suroeste (225°)';
    else if (deg >= 247.5 && deg < 292.5) cardinal = 'Oeste (270°)';
    else if (deg >= 292.5 && deg < 337.5) cardinal = 'Noroeste (315°)';

    if (compassText) compassText.textContent = cardinal;

    // Desplazar cinta superior de la brújula
    if (compassStrip) {
      const offset = (deg % 360) * 0.55;
      compassStrip.style.transform = `translateX(${-offset}px)`;
    }

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

    // Desplazamiento lateral (A / D)
    if (keys.strafeLeft) {
      strafePlayer(-player.moveSpeedBase * dt);
    }
    if (keys.strafeRight) {
      strafePlayer(player.moveSpeedBase * dt);
    }

    // Avanzar (W / ▲)
    if (keys.moveForward) {
      movePlayer(player.moveSpeedBase * dt);
    }

    // Retroceder (S / ▼)
    if (keys.moveBackward) {
      movePlayer(-player.moveSpeedBase * dt);
    }

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

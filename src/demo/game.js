/**
 * Controlador Principal del Juego (Bucle, Entradas y Estado)
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
    rotSpeedBase: 2.2, // radianes por segundo
    moveSpeedBase: 3.0 // bloques por segundo
  };

  // Estado de las teclas / botones pulsados
  const keys = {
    turnLeft: false,  // A o Flecha Izq
    turnRight: false, // D o Flecha Der
    moveForward: false, // W o Flecha Arriba
    moveBackward: false // S o Flecha Abajo
  };

  // Multiplicador de velocidad de rotación (controlado por slider)
  let turnSpeedMultiplier = 1.0;

  // Elementos del DOM para el HUD
  const compassText = document.getElementById('compassText');
  const facingTargetText = document.getElementById('facingTargetText');
  const compassStrip = document.getElementById('compassStrip');
  const turnSpeedRange = document.getElementById('turnSpeedRange');
  const textureModeSelect = document.getElementById('textureModeSelect');
  const levelPill = document.getElementById('levelPill');
  const levelNameText = document.getElementById('levelNameText');

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
  const btnTurnLeft = document.getElementById('btnTurnLeft');
  const btnTurnRight = document.getElementById('btnTurnRight');
  const btnForward = document.getElementById('btnForward');
  const btnBackward = document.getElementById('btnBackward');
  const btnCenter = document.getElementById('btnCenter');

  // ==========================================
  // MANEJO DE TECLADO
  // ==========================================
  window.addEventListener('keydown', (e) => {
    switch (e.key.toLowerCase()) {
      case 'a':
      case 'arrowleft':
        keys.turnLeft = true;
        btnTurnLeft.classList.add('active');
        e.preventDefault();
        break;
      case 'd':
      case 'arrowright':
        keys.turnRight = true;
        btnTurnRight.classList.add('active');
        e.preventDefault();
        break;
      case 'w':
      case 'arrowup':
        keys.moveForward = true;
        btnForward.classList.add('active');
        e.preventDefault();
        break;
      case 's':
      case 'arrowdown':
        keys.moveBackward = true;
        btnBackward.classList.add('active');
        e.preventDefault();
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    switch (e.key.toLowerCase()) {
      case 'a':
      case 'arrowleft':
        keys.turnLeft = false;
        btnTurnLeft.classList.remove('active');
        break;
      case 'd':
      case 'arrowright':
        keys.turnRight = false;
        btnTurnRight.classList.remove('active');
        break;
      case 'w':
      case 'arrowup':
        keys.moveForward = false;
        btnForward.classList.remove('active');
        break;
      case 's':
      case 'arrowdown':
        keys.moveBackward = false;
        btnBackward.classList.remove('active');
        break;
    }
  });

  // ==========================================
  // MANEJO DE BOTONES EN PANTALLA (RATÓN Y TÁCTIL)
  // ==========================================
  function bindButton(btn, keyName) {
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

  bindButton(btnTurnLeft, 'turnLeft');
  bindButton(btnTurnRight, 'turnRight');
  bindButton(btnForward, 'moveForward');
  bindButton(btnBackward, 'moveBackward');

  // Botón para volver a colocar al jugador en el centro / spawn del mapa
  btnCenter.addEventListener('click', () => {
    player.posX = spawnX;
    player.posY = spawnY;
  });

  // ==========================================
  // AJUSTES
  // ==========================================
  if (turnSpeedRange) {
    turnSpeedRange.addEventListener('input', (e) => {
      turnSpeedMultiplier = parseFloat(e.target.value) / 3;
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

  function movePlayer(dist) {
    const nextX = player.posX + player.dirX * dist;
    const nextY = player.posY + player.dirY * dist;

    // Margen de colisión contra paredes (0.18 unidades)
    const padding = 0.18;
    const checkX = dist > 0 ? (player.dirX > 0 ? nextX + padding : nextX - padding) : (player.dirX > 0 ? nextX - padding : nextX + padding);
    const checkY = dist > 0 ? (player.dirY > 0 ? nextY + padding : nextY - padding) : (player.dirY > 0 ? nextY - padding : nextY + padding);

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

    compassText.textContent = cardinal;

    // Desplazar cinta superior de la brújula
    if (compassStrip) {
      const offset = (deg % 360) * 0.55;
      compassStrip.style.transform = `translateX(${-offset}px)`;
    }

    // Objetivo al que mira de frente
    const target = engine.facingTarget;
    if (target) {
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

    // Girar a la izquierda (A / ◀)
    if (keys.turnLeft) {
      const rot = -player.rotSpeedBase * turnSpeedMultiplier * dt;
      rotatePlayer(rot);
    }

    // Girar a la derecha (D / ▶)
    if (keys.turnRight) {
      const rot = player.rotSpeedBase * turnSpeedMultiplier * dt;
      rotatePlayer(rot);
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

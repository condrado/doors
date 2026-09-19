/**
 * Generadores procedurales de texturas (64x64 retro) para paredes, cantos y puertas.
 * Módulo compartido: lo usa el motor (raycaster.js) para renderizar la Demo 3D
 * y el Editor (editor.js) para dibujar las miniaturas del selector de estilos.
 * No depende de RaycasterEngine ni de ninguna instancia: cada función crea su propio
 * canvas y devuelve un Uint32Array de píxeles listo para usar como textura.
 */

function createCanvasCtx(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas.getContext('2d');
}

function addNoise(ctx, size, amount) {
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const noise = (Math.random() - 0.5) * amount;
    img.data[i] = Math.min(255, Math.max(0, img.data[i] + noise));
    img.data[i + 1] = Math.min(255, Math.max(0, img.data[i + 1] + noise));
    img.data[i + 2] = Math.min(255, Math.max(0, img.data[i + 2] + noise));
  }
  ctx.putImageData(img, 0, 0);
}

function toPixels(ctx, size) {
  return new Uint32Array(ctx.getImageData(0, 0, size, size).data.buffer);
}

// ============================================================
// PAREDES
// ============================================================

/** Castillo: muro de piedra/ladrillo dungeon (estilo original) */
function createStoneWallPixels(size) {
  const ctx = createCanvasCtx(size);
  ctx.fillStyle = '#484b54';
  ctx.fillRect(0, 0, size, size);

  const brickH = 16;
  const brickW = 32;
  for (let y = 0; y < size; y += brickH) {
    const row = Math.floor(y / brickH);
    const offsetX = (row % 2 === 0) ? 0 : brickW / 2;
    for (let x = -brickW; x < size + brickW; x += brickW) {
      const actualX = x + offsetX;
      const shade = 65 + Math.floor(Math.random() * 20);
      ctx.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade + 8})`;
      ctx.fillRect(actualX + 1, y + 1, brickW - 2, brickH - 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(actualX + 1, y + 1, brickW - 2, 2);
      ctx.fillRect(actualX + 1, y + 1, 2, brickH - 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(actualX + 1, y + brickH - 2, brickW - 2, 2);
      ctx.fillRect(actualX + brickW - 2, y + 1, 2, brickH - 2);
    }
    ctx.fillStyle = '#26282e';
    ctx.fillRect(0, y, size, 2);
  }
  addNoise(ctx, size, 18);
  return toPixels(ctx, size);
}

/** Blanca: panel liso y plano, sin ladrillos ni juntas */
function createWhiteWallPixels(size) {
  const ctx = createCanvasCtx(size);
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, '#eef0f3');
  grad.addColorStop(1, '#d9dce1');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  addNoise(ctx, size, 4);
  return toPixels(ctx, size);
}

/** Cristal: panel de vidrio liso y translúcido, sin bloques ni cruceta de plomo */
function createCrystalWallPixels(size) {
  const ctx = createCanvasCtx(size);
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#9fe0fb');
  grad.addColorStop(0.5, '#4aa8dd');
  grad.addColorStop(1, '#1c5f8f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Brillo diagonal suave (único detalle: un cristal es liso)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.beginPath();
  ctx.moveTo(size * 0.08, 0);
  ctx.lineTo(size * 0.38, 0);
  ctx.lineTo(0, size * 0.38);
  ctx.lineTo(0, size * 0.08);
  ctx.closePath();
  ctx.fill();

  return toPixels(ctx, size);
}

// ============================================================
// CANTOS / JAMBAS (deben acompañar visualmente a su pared/puerta)
// ============================================================

/** Castillo: marco/jamba metálica y remaches (estilo original) */
function createStoneCapPixels(size) {
  const ctx = createCanvasCtx(size);
  ctx.fillStyle = '#1c1f26';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#2f3542';
  ctx.fillRect(4, 0, 10, size);
  ctx.fillRect(size - 14, 0, 10, size);
  for (let y = 8; y < size; y += 16) {
    ctx.fillStyle = '#4b5366';
    ctx.fillRect(2, y, size - 4, 3);
    ctx.fillStyle = '#8395a7';
    ctx.fillRect(6, y - 1, 3, 3);
    ctx.fillRect(size - 9, y - 1, 3, 3);
  }
  return toPixels(ctx, size);
}

/** Blanca: jamba lisa clara a juego con la pared/puerta blanca */
function createWhiteCapPixels(size) {
  const ctx = createCanvasCtx(size);
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, '#e6e8ec');
  grad.addColorStop(1, '#cfd2d8');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return toPixels(ctx, size);
}

/** Negra: jamba lisa oscura a juego con la puerta negra */
function createBlackCapPixels(size) {
  const ctx = createCanvasCtx(size);
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, '#1c1e24');
  grad.addColorStop(1, '#08090b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return toPixels(ctx, size);
}

/** Cristal: jamba lisa de vidrio a juego con la pared/puerta de cristal */
function createCrystalCapPixels(size) {
  const ctx = createCanvasCtx(size);
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, '#7fd3f7');
  grad.addColorStop(1, '#1c5f8f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return toPixels(ctx, size);
}

// ============================================================
// VENTANA (sin variantes de estilo)
// ============================================================

function createWindowPixels(size) {
  const ctx = createCanvasCtx(size);
  ctx.fillStyle = '#1e222a';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#2f3640';
  ctx.fillRect(4, 4, size - 8, size - 8);

  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#54a0ff');
  grad.addColorStop(0.35, '#70a1ff');
  grad.addColorStop(0.7, '#2e86de');
  grad.addColorStop(1, '#1e3799');
  ctx.fillStyle = grad;
  ctx.fillRect(7, 7, size - 14, size - 14);

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

  const mid = Math.floor(size / 2);
  ctx.fillStyle = '#151922';
  ctx.fillRect(mid - 2, 6, 4, size - 12);
  ctx.fillRect(6, mid - 2, size - 12, 4);

  ctx.fillStyle = '#8395a7';
  ctx.fillRect(mid - 1, mid - 1, 2, 2);

  addNoise(ctx, size, 10);
  return toPixels(ctx, size);
}

// ============================================================
// PUERTAS (cada una recibe doorConfig: { color, rune } para el emblema direccional)
// ============================================================

function drawDoorRuneEmblem(ctx, size, doorConfig) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 12, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = doorConfig.color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 10, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = doorConfig.color;
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(doorConfig.rune, size / 2, size / 2);
}

/** Castillo: puerta de madera noble reforzada con hierro (estilo original) */
function createWoodDoorPixels(size, doorConfig) {
  const ctx = createCanvasCtx(size);
  ctx.fillStyle = '#20242a';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#14171c';
  ctx.fillRect(4, 4, size - 8, size - 8);

  const woodColors = ['#6d3e18', '#78461c', '#633714', '#71401a'];
  const plankWidth = 14;
  for (let x = 6; x < size - 6; x += plankWidth) {
    ctx.fillStyle = woodColors[Math.floor(x / plankWidth) % woodColors.length];
    ctx.fillRect(x, 6, Math.min(plankWidth - 2, size - 6 - x), size - 12);
    ctx.fillStyle = '#2a1608';
    ctx.fillRect(x + plankWidth - 2, 6, 2, size - 12);
  }

  ctx.fillStyle = '#2d3436';
  ctx.fillRect(4, 14, size - 8, 6);
  ctx.fillRect(4, size - 20, size - 8, 6);

  ctx.fillStyle = '#7f8c8d';
  [10, 24, 40, 54].forEach(px => {
    ctx.fillRect(px, 16, 3, 3);
    ctx.fillRect(px, size - 18, 3, 3);
  });

  ctx.fillStyle = '#d4af37';
  ctx.beginPath();
  ctx.arc(size - 14, size / 2, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.fillRect(size - 15, size / 2 + 1, 2, 4);

  drawDoorRuneEmblem(ctx, size, doorConfig);
  return toPixels(ctx, size);
}

/** Blanca: puerta lisa lacada en blanco, sin paneles, solo picaporte */
function createWhiteDoorPixels(size, doorConfig) {
  const ctx = createCanvasCtx(size);
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, '#f2f3f5');
  grad.addColorStop(1, '#dcdfe4');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Picaporte
  ctx.fillStyle = '#c3c6cc';
  ctx.beginPath();
  ctx.arc(size - 14, size / 2, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5b5f68';
  ctx.fillRect(size - 15, size / 2 + 1, 2, 4);

  drawDoorRuneEmblem(ctx, size, doorConfig);
  return toPixels(ctx, size);
}

/** Negra: puerta lisa negra mate, sin tablones, solo picaporte */
function createBlackDoorPixels(size, doorConfig) {
  const ctx = createCanvasCtx(size);
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, '#1b1d22');
  grad.addColorStop(1, '#0a0b0e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Picaporte
  ctx.fillStyle = '#5a5e68';
  ctx.beginPath();
  ctx.arc(size - 14, size / 2, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.fillRect(size - 15, size / 2 + 1, 2, 4);

  drawDoorRuneEmblem(ctx, size, doorConfig);
  return toPixels(ctx, size);
}

/** Cristal: puerta lisa de vidrio translúcido, sin marco de plomo, solo picaporte */
function createCrystalDoorPixels(size, doorConfig) {
  const ctx = createCanvasCtx(size);
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#a8e2fb');
  grad.addColorStop(0.5, '#5fb8e8');
  grad.addColorStop(1, '#1c5f8f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Brillo diagonal suave (único detalle: un cristal es liso)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.beginPath();
  ctx.moveTo(size * 0.1, 0);
  ctx.lineTo(size * 0.4, 0);
  ctx.lineTo(0, size * 0.4);
  ctx.lineTo(0, size * 0.1);
  ctx.closePath();
  ctx.fill();

  // Picaporte
  ctx.fillStyle = '#eaf7ff';
  ctx.beginPath();
  ctx.arc(size - 14, size / 2, 4, 0, Math.PI * 2);
  ctx.fill();

  drawDoorRuneEmblem(ctx, size, doorConfig);
  return toPixels(ctx, size);
}

// ============================================================
// REGISTRO DE ESTILOS DISPONIBLES
// ============================================================

const WALL_STYLES = {
  castillo: { label: 'Castillo', wall: createStoneWallPixels, cap: createStoneCapPixels },
  blanca: { label: 'Blanca', wall: createWhiteWallPixels, cap: createWhiteCapPixels },
  cristal: { label: 'Cristal', wall: createCrystalWallPixels, cap: createCrystalCapPixels }
};

const DOOR_STYLES = {
  castillo: { label: 'Castillo', door: createWoodDoorPixels, cap: createStoneCapPixels },
  blanca: { label: 'Blanca', door: createWhiteDoorPixels, cap: createWhiteCapPixels },
  negra: { label: 'Negra', door: createBlackDoorPixels, cap: createBlackCapPixels },
  cristal: { label: 'Cristal', door: createCrystalDoorPixels, cap: createCrystalCapPixels }
};

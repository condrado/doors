/**
 * Generadores procedurales de texturas para paredes (5x15 -> 64x192 px nativas),
 * cantos (64x192 px) y puertas (64x64 px).
 * Módulo compartido: lo usa el motor (raycaster.js) para renderizar la Demo 3D
 * y el Editor (editor.js) para dibujar las miniaturas del selector de estilos.
 * No depende de RaycasterEngine ni de ninguna instancia: cada función crea su propio
 * canvas y devuelve un Uint32Array de píxeles listo para usar como textura con .width y .height.
 */

function createCanvasCtx(w, h = w) {
  const canvas = (typeof document !== 'undefined')
    ? document.createElement('canvas')
    : { width: w, height: h, getContext: () => null };
  canvas.width = w;
  canvas.height = h;
  return canvas.getContext ? canvas.getContext('2d') : null;
}

function addNoise(ctx, w, h = w, amount = 10) {
  if (!ctx) return;
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const noise = (Math.random() - 0.5) * amount;
    img.data[i] = Math.min(255, Math.max(0, img.data[i] + noise));
    img.data[i + 1] = Math.min(255, Math.max(0, img.data[i + 1] + noise));
    img.data[i + 2] = Math.min(255, Math.max(0, img.data[i + 2] + noise));
  }
  ctx.putImageData(img, 0, 0);
}

function toPixels(ctx, w, h = w) {
  if (!ctx) {
    const arr = new Uint32Array(w * h);
    arr.width = w;
    arr.height = h;
    return arr;
  }
  const arr = new Uint32Array(ctx.getImageData(0, 0, w, h).data.buffer);
  arr.width = w;
  arr.height = h;
  return arr;
}

// ============================================================
// PAREDES (Proporción nativa 5:15 -> ancho 64px, alto 192px)
// ============================================================

/** Castillo: muro de piedra/ladrillo dungeon continuo en 192px (12 filas de 16px) */
function createStoneWallPixels(w = 64, h = 192) {
  const ctx = createCanvasCtx(w, h);
  if (!ctx) return toPixels(null, w, h);

  ctx.fillStyle = '#484b54';
  ctx.fillRect(0, 0, w, h);

  const brickH = 16;
  const brickW = 32;
  for (let y = 0; y < h; y += brickH) {
    const row = Math.floor(y / brickH);
    const offsetX = (row % 2 === 0) ? 0 : brickW / 2;
    for (let x = -brickW; x < w + brickW; x += brickW) {
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
    ctx.fillRect(0, y, w, 2);
  }
  addNoise(ctx, w, h, 18);
  return toPixels(ctx, w, h);
}

/** Blanca: panel liso con un único gradiente continuo de techo a suelo (sin bandas repetidas) */
function createWhiteWallPixels(w = 64, h = 192) {
  const ctx = createCanvasCtx(w, h);
  if (!ctx) return toPixels(null, w, h);

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#eef0f3');
  grad.addColorStop(1, '#d9dce1');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  addNoise(ctx, w, h, 4);
  return toPixels(ctx, w, h);
}

/** Cristal: panel de vidrio liso y translúcido continuo en toda la altura de la pared */
function createCrystalWallPixels(w = 64, h = 192) {
  const ctx = createCanvasCtx(w, h);
  if (!ctx) return toPixels(null, w, h);

  // Panel de vidrio translúcido con tinte cian/celeste suave (~32% a ~48% opacidad)
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, 'rgba(159, 224, 251, 0.32)');
  grad.addColorStop(0.5, 'rgba(74, 168, 221, 0.38)');
  grad.addColorStop(1, 'rgba(28, 95, 143, 0.48)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Montantes/perfiles verticales laterales del panel de vidrio
  ctx.fillStyle = 'rgba(180, 230, 255, 0.55)';
  ctx.fillRect(0, 0, 2, h);
  ctx.fillRect(w - 2, 0, 2, h);

  // Bisel superior e inferior
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.fillRect(0, 0, w, 1);
  ctx.fillStyle = 'rgba(28, 95, 143, 0.6)';
  ctx.fillRect(0, h - 2, w, 2);

  // Destello diagonal superior intenso y reflectante
  const glareGrad1 = ctx.createLinearGradient(0, 0, w * 0.4, h * 0.4);
  glareGrad1.addColorStop(0, 'rgba(255, 255, 255, 0.70)');
  glareGrad1.addColorStop(1, 'rgba(255, 255, 255, 0.15)');
  ctx.fillStyle = glareGrad1;
  ctx.beginPath();
  ctx.moveTo(w * 0.08, 0);
  ctx.lineTo(w * 0.42, 0);
  ctx.lineTo(0, h * 0.42);
  ctx.lineTo(0, h * 0.08);
  ctx.closePath();
  ctx.fill();

  // Segundo reflejo diagonal inferior
  const glareGrad2 = ctx.createLinearGradient(0, h * 0.45, w * 0.85, h);
  glareGrad2.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
  glareGrad2.addColorStop(1, 'rgba(255, 255, 255, 0.10)');
  ctx.fillStyle = glareGrad2;
  ctx.beginPath();
  ctx.moveTo(w * 0.50, 0);
  ctx.lineTo(w * 0.85, 0);
  ctx.lineTo(0, h * 0.85);
  ctx.lineTo(0, h * 0.50);
  ctx.closePath();
  ctx.fill();

  return toPixels(ctx, w, h);
}

// ============================================================
// CANTOS / JAMBAS (64x192 px continuos para acompañar a paredes y vanos)
// ============================================================

/** Castillo: marco/jamba metálica continua con remaches (64x192 px) */
function createStoneCapPixels(w = 64, h = 192) {
  const ctx = createCanvasCtx(w, h);
  if (!ctx) return toPixels(null, w, h);

  ctx.fillStyle = '#1c1f26';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#2f3542';
  ctx.fillRect(4, 0, 10, h);
  ctx.fillRect(w - 14, 0, 10, h);
  for (let y = 8; y < h; y += 16) {
    ctx.fillStyle = '#4b5366';
    ctx.fillRect(2, y, w - 4, 3);
    ctx.fillStyle = '#8395a7';
    ctx.fillRect(6, y - 1, 3, 3);
    ctx.fillRect(w - 9, y - 1, 3, 3);
  }
  return toPixels(ctx, w, h);
}

/** Blanca: jamba lisa clara continua a juego con la pared blanca (64x192 px) */
function createWhiteCapPixels(w = 64, h = 192) {
  const ctx = createCanvasCtx(w, h);
  if (!ctx) return toPixels(null, w, h);

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#e6e8ec');
  grad.addColorStop(1, '#cfd2d8');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  return toPixels(ctx, w, h);
}

/** Negra: jamba lisa oscura continua a juego con la puerta negra (64x192 px) */
function createBlackCapPixels(w = 64, h = 192) {
  const ctx = createCanvasCtx(w, h);
  if (!ctx) return toPixels(null, w, h);

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#1c1e24');
  grad.addColorStop(1, '#08090b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  return toPixels(ctx, w, h);
}

/** Cristal: jamba lisa de vidrio translúcido continua (64x192 px) */
function createCrystalCapPixels(w = 64, h = 192) {
  const ctx = createCanvasCtx(w, h);
  if (!ctx) return toPixels(null, w, h);

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(127, 211, 247, 0.40)');
  grad.addColorStop(1, 'rgba(28, 95, 143, 0.52)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Perfiles sutiles de borde
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.fillRect(0, 0, 2, h);
  ctx.fillRect(w - 2, 0, 2, h);
  return toPixels(ctx, w, h);
}

// ============================================================
// VENTANA (Pared completa 64x192 con dintel, hueco central y antepecho)
// ============================================================

function createWindowPixels(w = 64, h = 192) {
  const ctx = createCanvasCtx(w, h);
  if (!ctx) return toPixels(null, w, h);

  // 1. Muro de fondo de piedra en toda la altura
  ctx.fillStyle = '#484b54';
  ctx.fillRect(0, 0, w, h);

  const brickH = 16;
  const brickW = 32;
  for (let y = 0; y < h; y += brickH) {
    const row = Math.floor(y / brickH);
    const offsetX = (row % 2 === 0) ? 0 : brickW / 2;
    for (let x = -brickW; x < w + brickW; x += brickW) {
      const actualX = x + offsetX;
      const shade = 65 + Math.floor(Math.random() * 20);
      ctx.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade + 8})`;
      ctx.fillRect(actualX + 1, y + 1, brickW - 2, brickH - 2);
    }
    ctx.fillStyle = '#26282e';
    ctx.fillRect(0, y, w, 2);
  }

  // Proporciones arquitectónicas del vano:
  // Dintel superior: de 0 a 51px (0 a 0.8m)
  // Hueco de la ventana: de 51px a 141px (0.8m a 2.2m)
  // Antepecho inferior: de 141px a 192px (2.2m a 3.0m)
  const winTop = 51;
  const winBottom = 141;
  const winHeight = winBottom - winTop;

  // Marco de la ventana
  ctx.fillStyle = '#1e222a';
  ctx.fillRect(4, winTop, w - 8, winHeight);
  ctx.fillStyle = '#2f3640';
  ctx.fillRect(8, winTop + 4, w - 16, winHeight - 8);

  // Cristal de la ventana
  const grad = ctx.createLinearGradient(0, winTop, w, winBottom);
  grad.addColorStop(0, '#54a0ff');
  grad.addColorStop(0.35, '#70a1ff');
  grad.addColorStop(0.7, '#2e86de');
  grad.addColorStop(1, '#1e3799');
  ctx.fillStyle = grad;
  ctx.fillRect(11, winTop + 7, w - 22, winHeight - 14);

  // Destellos de cristal
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.beginPath();
  ctx.moveTo(16, winTop + 7);
  ctx.lineTo(28, winTop + 7);
  ctx.lineTo(11, winTop + 24);
  ctx.lineTo(11, winTop + 12);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(34, winTop + 7);
  ctx.lineTo(44, winTop + 7);
  ctx.lineTo(11, winTop + 40);
  ctx.lineTo(11, winTop + 30);
  ctx.closePath();
  ctx.fill();

  // Parteluz y travesaño de hierro
  const midX = Math.floor(w / 2);
  const midY = Math.floor((winTop + winBottom) / 2);
  ctx.fillStyle = '#151922';
  ctx.fillRect(midX - 2, winTop + 6, 4, winHeight - 12);
  ctx.fillRect(10, midY - 2, w - 20, 4);

  ctx.fillStyle = '#8395a7';
  ctx.fillRect(midX - 1, midY - 1, 2, 2);

  addNoise(ctx, w, h, 10);
  return toPixels(ctx, w, h);
}

// ============================================================
// PUERTAS (Proporción nativa 5:10 -> ancho 64px, alto 128px)
// Idénticas a sus paredes, sin marcos y con solo el picaporte (sin círculo de orientación)
// ============================================================

/** Castillo: pared de piedra continua como la pared pero con picaporte, sin marco ni nada (64x128 px) */
function createWoodDoorPixels(w = 64, h = 128) {
  const ctx = createCanvasCtx(w, h);
  if (!ctx) return toPixels(null, w, h);

  // Muro de piedra idéntico a la pared de castillo de borde a borde (sin marco)
  ctx.fillStyle = '#484b54';
  ctx.fillRect(0, 0, w, h);

  const brickH = 16;
  const brickW = 32;
  for (let y = 0; y < h; y += brickH) {
    const row = Math.floor(y / brickH);
    const offsetX = (row % 2 === 0) ? 0 : brickW / 2;
    for (let x = -brickW; x < w + brickW; x += brickW) {
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
    ctx.fillRect(0, y, w, 2);
  }
  addNoise(ctx, w, h, 18);

  // Picaporte dorado a media altura
  const handleY = Math.floor(h / 2);
  ctx.fillStyle = '#d4af37';
  ctx.beginPath();
  ctx.arc(w - 14, handleY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.fillRect(w - 15, handleY + 1, 2, 4);

  return toPixels(ctx, w, h);
}

/** Blanca: puerta lisa como la pared blanca, sin marcos, solo picaporte (64x128 px) */
function createWhiteDoorPixels(w = 64, h = 128) {
  const ctx = createCanvasCtx(w, h);
  if (!ctx) return toPixels(null, w, h);

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#eef0f3');
  grad.addColorStop(1, '#d9dce1');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  addNoise(ctx, w, h, 4);

  // Picaporte a media altura
  const handleY = Math.floor(h / 2);
  ctx.fillStyle = '#c3c6cc';
  ctx.beginPath();
  ctx.arc(w - 14, handleY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5b5f68';
  ctx.fillRect(w - 15, handleY + 1, 2, 4);

  return toPixels(ctx, w, h);
}

/** Negra: puerta lisa negra mate como la pared, sin paneles ni marcos, solo picaporte (64x128 px) */
function createBlackDoorPixels(w = 64, h = 128) {
  const ctx = createCanvasCtx(w, h);
  if (!ctx) return toPixels(null, w, h);

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#1b1d22');
  grad.addColorStop(1, '#0a0b0e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Picaporte a media altura
  const handleY = Math.floor(h / 2);
  ctx.fillStyle = '#5a5e68';
  ctx.beginPath();
  ctx.arc(w - 14, handleY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.fillRect(w - 15, handleY + 1, 2, 4);

  return toPixels(ctx, w, h);
}

/** Cristal: exactamente como la pared de cristal pero con picaporte, sin marco ni nada (64x128 px) */
function createCrystalDoorPixels(w = 64, h = 128) {
  const ctx = createCanvasCtx(w, h);
  if (!ctx) return toPixels(null, w, h);

  // Panel de vidrio translúcido idéntico a la pared de cristal de borde a borde (sin marco)
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, 'rgba(159, 224, 251, 0.32)');
  grad.addColorStop(0.5, 'rgba(74, 168, 221, 0.38)');
  grad.addColorStop(1, 'rgba(28, 95, 143, 0.48)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Destello diagonal reflectante continuo idéntico a la pared
  const glareGrad = ctx.createLinearGradient(0, 0, w * 0.42, h * 0.42);
  glareGrad.addColorStop(0, 'rgba(255, 255, 255, 0.70)');
  glareGrad.addColorStop(1, 'rgba(255, 255, 255, 0.15)');
  ctx.fillStyle = glareGrad;
  ctx.beginPath();
  ctx.moveTo(w * 0.08, 0);
  ctx.lineTo(w * 0.42, 0);
  ctx.lineTo(0, h * 0.42);
  ctx.lineTo(0, h * 0.08);
  ctx.closePath();
  ctx.fill();

  // Picaporte sólido plateado a media altura
  const handleY = Math.floor(h / 2);
  ctx.fillStyle = '#f0f8ff';
  ctx.beginPath();
  ctx.arc(w - 14, handleY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#112233';
  ctx.fillRect(w - 15, handleY + 1, 2, 4);

  return toPixels(ctx, w, h);
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createCanvasCtx,
    addNoise,
    toPixels,
    createStoneWallPixels,
    createWhiteWallPixels,
    createCrystalWallPixels,
    createStoneCapPixels,
    createWhiteCapPixels,
    createBlackCapPixels,
    createCrystalCapPixels,
    createWindowPixels,
    createWoodDoorPixels,
    createWhiteDoorPixels,
    createBlackDoorPixels,
    createCrystalDoorPixels,
    WALL_STYLES,
    DOOR_STYLES
  };
}

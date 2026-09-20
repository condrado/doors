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
  return canvas.getContext ? canvas.getContext('2d', { willReadFrequently: true }) : null;
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
    arr.hasTransparency = false;
    return arr;
  }
  const arr = new Uint32Array(ctx.getImageData(0, 0, w, h).data.buffer);
  arr.width = w;
  arr.height = h;
  let hasTrans = false;
  for (let i = 0; i < arr.length; i++) {
    if (((arr[i] >> 24) & 0xFF) < 250) {
      hasTrans = true;
      break;
    }
  }
  arr.hasTransparency = hasTrans;
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
// REGISTRO DE ESTILOS DISPONIBLES & TEXTURAS PERSONALIZADAS
// ============================================================

/**
 * Convierte un Data URL o Image en un Uint32Array con width y height
 */
function dataUrlToPixels(dataUrl, targetW = 64, targetH = 192, onLoadedCallback = null, fallbackFn = null) {
  if (typeof document === 'undefined') {
    const arr = new Uint32Array(targetW * targetH);
    arr.width = targetW;
    arr.height = targetH;
    arr.hasTransparency = false;
    return arr;
  }
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  
  if (!dataUrl) {
    if (typeof fallbackFn === 'function') return fallbackFn();
    ctx.fillStyle = '#4a5568';
    ctx.fillRect(0, 0, targetW, targetH);
    return toPixels(ctx, targetW, targetH);
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    ctx.clearRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);
    const pixels = toPixels(ctx, targetW, targetH);
    if (typeof onLoadedCallback === 'function') {
      onLoadedCallback(pixels);
    }
  };
  img.onerror = () => {
    if (typeof fallbackFn === 'function') {
      const fb = fallbackFn();
      if (typeof onLoadedCallback === 'function') {
        onLoadedCallback(fb);
      }
    }
  };
  img.src = dataUrl;
  if (img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, 0, 0, targetW, targetH);
    return toPixels(ctx, targetW, targetH);
  }
  
  if (typeof fallbackFn === 'function') {
    return fallbackFn();
  }
  // Retorno síncrono si la imagen aún no cargó completamente
  ctx.fillStyle = '#3b4252';
  ctx.fillRect(0, 0, targetW, targetH);
  return toPixels(ctx, targetW, targetH);
}

/**
 * Genera automáticamente un canto/jamba coherente (64x192) a partir de una textura de pared
 */
function createCapFromWallImage(wallDataUrl, w = 64, h = 192) {
  if (typeof document === 'undefined') return toPixels(null, w, h);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (wallDataUrl) {
    const img = new Image();
    img.src = wallDataUrl;
    if (img.complete && img.naturalWidth > 0) {
      // Dibujar la pared oscurecida
      ctx.drawImage(img, 0, 0, w, h);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = '#2d3748';
      ctx.fillRect(0, 0, w, h);
    }
  } else {
    ctx.fillStyle = '#2d3748';
    ctx.fillRect(0, 0, w, h);
  }

  // Marco/jamba estructurada en los laterales
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, 0, 8, h);
  ctx.fillRect(w - 8, 0, 8, h);

  // Remaches / perfiles cada 16px
  for (let y = 8; y < h; y += 16) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fillRect(3, y, 4, 3);
    ctx.fillRect(w - 7, y, 4, 3);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(2, y + 3, 6, 1);
    ctx.fillRect(w - 8, y + 3, 6, 1);
  }

  return toPixels(ctx, w, h);
}

const WALL_STYLES = {};
const DOOR_STYLES = {};

// Mapeo de generadores procedurales de respaldo (para visualización offline o generadores matemáticos)
const PROCEDURAL_GENERATORS = {
  walls: {
    castillo: { wall: createStoneWallPixels, cap: createStoneCapPixels },
    blanca: { wall: createWhiteWallPixels, cap: createWhiteCapPixels },
    negra: { wall: createBlackCapPixels, cap: createBlackCapPixels },
    cristal: { wall: createCrystalWallPixels, cap: createCrystalCapPixels }
  },
  doors: {
    castillo: { door: createWoodDoorPixels, cap: createStoneCapPixels },
    blanca: { door: createWhiteDoorPixels, cap: createWhiteCapPixels },
    negra: { door: createBlackDoorPixels, cap: createBlackCapPixels },
    cristal: { door: createCrystalDoorPixels, cap: createCrystalCapPixels }
  }
};

/**
 * Carga e inicializa WALL_STYLES y DOOR_STYLES a partir de un objeto manifest (e.g. textures.json)
 */
function loadStylesFromManifest(manifest) {
  if (!manifest) return;
  const baseDir = manifest.baseDir || '/src/engine/textures/';

  if (manifest.walls) {
    Object.entries(manifest.walls).forEach(([key, item]) => {
      const proc = PROCEDURAL_GENERATORS.walls[key] || {};
      const isTrans = (item.hasTransparency !== undefined)
        ? item.hasTransparency
        : (/^(cristal|glass|trans|reja|enrejado)/i.test(key));
      const capFile = item.capFile || ('caps/' + key + '.png');
      WALL_STYLES[key] = {
        label: item.label || key,
        file: item.file,
        pngUrl: item.file ? (baseDir + item.file) : null,
        capFile: capFile,
        capPngUrl: baseDir + capFile,
        wall: proc.wall || createStoneWallPixels,
        cap: proc.cap || createStoneCapPixels,
        hasTransparency: isTrans,
        isCustom: false
      };
    });
  }

  if (manifest.doors) {
    Object.entries(manifest.doors).forEach(([key, item]) => {
      const proc = PROCEDURAL_GENERATORS.doors[key] || {};
      const isTrans = (item.hasTransparency !== undefined)
        ? item.hasTransparency
        : (/^(cristal|glass|trans|reja|enrejado)/i.test(key));
      const capFile = item.capFile || ('caps/' + key + '.png');
      DOOR_STYLES[key] = {
        label: item.label || key,
        file: item.file,
        pngUrl: item.file ? (baseDir + item.file) : null,
        capFile: capFile,
        capPngUrl: baseDir + capFile,
        door: proc.door || createWoodDoorPixels,
        cap: proc.cap || createStoneCapPixels,
        hasTransparency: isTrans,
        isCustom: false
      };
    });
  }
}

// Manifest de respaldo para garantizar disponibilidad inmediata síncrona
const DEFAULT_MANIFEST_FALLBACK = {
  version: 1,
  baseDir: '/src/engine/textures/',
  walls: {
    castillo: { label: 'Castillo', file: 'walls/castillo.png', capFile: 'caps/castillo.png', hasTransparency: false },
    blanca: { label: 'Blanca', file: 'walls/blanca.png', capFile: 'caps/blanca.png', hasTransparency: false },
    negra: { label: 'Negra', file: 'walls/negra.png', capFile: 'caps/negra.png', hasTransparency: false },
    cristal: { label: 'Cristal', file: 'walls/cristal.png', capFile: 'caps/cristal.png', hasTransparency: true },
    'cristal-c': { label: 'Cristal C', file: 'walls/cristal-c.png', capFile: 'caps/cristal-c.png', hasTransparency: true }
  },
  doors: {
    castillo: { label: 'Castillo', file: 'doors/castillo.png', capFile: 'caps/castillo.png', hasTransparency: false },
    blanca: { label: 'Blanca', file: 'doors/blanca.png', capFile: 'caps/blanca.png', hasTransparency: false },
    negra: { label: 'Negra', file: 'doors/negra.png', capFile: 'caps/negra.png', hasTransparency: false },
    cristal: { label: 'Cristal', file: 'doors/cristal.png', capFile: 'caps/cristal.png', hasTransparency: true }
  },
  windows: {
    ventana: { label: 'Ventana', file: 'windows/ventana.png' }
  }
};

// Carga inicial síncrona
loadStylesFromManifest(DEFAULT_MANIFEST_FALLBACK);

// En navegador, sincronizar dinámicamente con el archivo textures.json
if (typeof window !== 'undefined' && typeof fetch === 'function') {
  fetch('/src/engine/textures/textures.json')
    .then(r => r.ok ? r.json() : null)
    .then(manifest => {
      if (manifest) loadStylesFromManifest(manifest);
    })
    .catch(() => {});
}

/**
 * Registra o actualiza dinámicamente un estilo de pared en WALL_STYLES
 */
function registerWallStyle(key, styleDef) {
  let cachedWallPixels = null;
  let cachedCapPixels = null;
  // Priorizar archivo físico en disco sobre dataUrl inline para permitir edición directa de PNGs
  const wallUrl = styleDef.pngUrl || (styleDef.file ? ('/src/engine/textures/' + styleDef.file) : null) || styleDef.dataUrl;
  const capUrl = styleDef.capPngUrl || (styleDef.capFile ? ('/src/engine/textures/' + styleDef.capFile) : null) || styleDef.capDataUrl || ('/src/engine/textures/caps/' + key + '.png');

  const onWallLoaded = (pixels) => {
    cachedWallPixels = pixels;
    if (WALL_STYLES[key]) {
      WALL_STYLES[key].hasTransparency = pixels.hasTransparency;
    }
    if (styleDef) {
      styleDef.hasTransparency = pixels.hasTransparency;
    }
    if (typeof window !== 'undefined' && window.activeRaycasterEngine && window.activeRaycasterEngine.textures) {
      if (window.activeRaycasterEngine.textures[1]) {
        window.activeRaycasterEngine.textures[1][key] = pixels;
      }
    }
  };

  const onCapLoaded = (pixels) => {
    cachedCapPixels = pixels;
    if (typeof window !== 'undefined' && window.activeRaycasterEngine && window.activeRaycasterEngine.textures) {
      if (window.activeRaycasterEngine.textures[10]) {
        window.activeRaycasterEngine.textures[10][key] = pixels;
      }
    }
  };

  if (wallUrl && typeof Image !== 'undefined') {
    dataUrlToPixels(wallUrl, 64, 192, onWallLoaded);
  }
  if (capUrl && typeof Image !== 'undefined') {
    dataUrlToPixels(capUrl, 64, 192, onCapLoaded, () => createCapFromWallImage(wallUrl, 64, 192));
  }

  const initialTrans = (styleDef.hasTransparency !== undefined)
    ? styleDef.hasTransparency
    : (/^(cristal|glass|trans|reja|enrejado)/i.test(key));

  WALL_STYLES[key] = {
    label: styleDef.label || key,
    isCustom: true,
    dataUrl: styleDef.dataUrl || null,
    capDataUrl: styleDef.capDataUrl || null,
    pngUrl: wallUrl,
    capPngUrl: capUrl,
    file: styleDef.file || (wallUrl && wallUrl.startsWith('/src/engine/textures/') ? wallUrl.replace('/src/engine/textures/', '').split('?')[0] : null),
    capFile: styleDef.capFile || ('caps/' + key + '.png'),
    hasTransparency: initialTrans,
    wall: (w = 64, h = 192) => {
      if (typeof styleDef.wall === 'function') return styleDef.wall(w, h);
      if (cachedWallPixels) return cachedWallPixels;
      return dataUrlToPixels(wallUrl, w, h, onWallLoaded);
    },
    cap: (w = 64, h = 192) => {
      if (typeof styleDef.cap === 'function') return styleDef.cap(w, h);
      if (cachedCapPixels) return cachedCapPixels;
      if (capUrl) {
        return dataUrlToPixels(capUrl, w, h, onCapLoaded, () => createCapFromWallImage(wallUrl, w, h));
      }
      return createCapFromWallImage(wallUrl, w, h);
    }
  };
}

/**
 * Registra o actualiza dinámicamente un estilo de puerta en DOOR_STYLES
 */
function registerDoorStyle(key, styleDef) {
  let cachedDoorPixels = null;
  let cachedCapPixels = null;
  // Priorizar archivo físico en disco sobre dataUrl inline
  const doorUrl = styleDef.pngUrl || (styleDef.file ? ('/src/engine/textures/' + styleDef.file) : null) || styleDef.dataUrl;
  const capUrl = styleDef.capPngUrl || (styleDef.capFile ? ('/src/engine/textures/' + styleDef.capFile) : null) || styleDef.capDataUrl || ('/src/engine/textures/caps/' + key + '.png');

  const onDoorLoaded = (pixels) => {
    cachedDoorPixels = pixels;
    if (DOOR_STYLES[key]) {
      DOOR_STYLES[key].hasTransparency = pixels.hasTransparency;
    }
    if (styleDef) {
      styleDef.hasTransparency = pixels.hasTransparency;
    }
    if (typeof window !== 'undefined' && window.activeRaycasterEngine && window.activeRaycasterEngine.textures) {
      [2, 3, 4, 5].forEach(type => {
        if (window.activeRaycasterEngine.textures[type]) {
          window.activeRaycasterEngine.textures[type][key] = pixels;
        }
      });
    }
  };

  const onCapLoaded = (pixels) => {
    cachedCapPixels = pixels;
    if (typeof window !== 'undefined' && window.activeRaycasterEngine && window.activeRaycasterEngine.textures) {
      if (window.activeRaycasterEngine.textures[11]) {
        window.activeRaycasterEngine.textures[11][key] = pixels;
      }
    }
  };

  if (doorUrl && typeof Image !== 'undefined') {
    dataUrlToPixels(doorUrl, 64, 128, onDoorLoaded);
  }
  if (capUrl && typeof Image !== 'undefined') {
    dataUrlToPixels(capUrl, 64, 192, onCapLoaded, () => createWhiteCapPixels(64, 192));
  }

  const initialTrans = (styleDef.hasTransparency !== undefined)
    ? styleDef.hasTransparency
    : (/^(cristal|glass|trans|reja|enrejado)/i.test(key));

  DOOR_STYLES[key] = {
    label: styleDef.label || key,
    isCustom: true,
    dataUrl: styleDef.dataUrl || null,
    capDataUrl: styleDef.capDataUrl || null,
    pngUrl: doorUrl,
    capPngUrl: capUrl,
    file: styleDef.file || (doorUrl && doorUrl.startsWith('/src/engine/textures/') ? doorUrl.replace('/src/engine/textures/', '').split('?')[0] : null),
    capFile: styleDef.capFile || ('caps/' + key + '.png'),
    hasTransparency: initialTrans,
    door: (w = 64, h = 128) => {
      if (typeof styleDef.door === 'function') return styleDef.door(w, h);
      if (cachedDoorPixels) return cachedDoorPixels;
      return dataUrlToPixels(doorUrl, w, h, onDoorLoaded);
    },
    cap: (w = 64, h = 192) => {
      if (typeof styleDef.cap === 'function') return styleDef.cap(w, h);
      if (cachedCapPixels) return cachedCapPixels;
      if (capUrl) {
        return dataUrlToPixels(capUrl, w, h, onCapLoaded, () => createWhiteCapPixels(w, h));
      }
      return createWhiteCapPixels(w, h);
    }
  };
}

/**
 * Elimina un estilo personalizado
 */
function removeCustomStyle(kind, key) {
  if (kind === 'wall' || kind === 'lintel') {
    if (WALL_STYLES[key] && WALL_STYLES[key].isCustom) {
      delete WALL_STYLES[key];
      return true;
    }
  } else if (kind === 'door') {
    if (DOOR_STYLES[key] && DOOR_STYLES[key].isCustom) {
      delete DOOR_STYLES[key];
      return true;
    }
  }
  return false;
}

/**
 * Carga en lote estilos personalizados almacenados en un proyecto
 */
function loadCustomStyles(customStyles) {
  if (!customStyles) return;
  if (customStyles.walls) {
    Object.entries(customStyles.walls).forEach(([k, def]) => registerWallStyle(k, def));
  }
  if (customStyles.doors) {
    Object.entries(customStyles.doors).forEach(([k, def]) => registerDoorStyle(k, def));
  }
}

/**
 * Exporta todas las texturas base procedurales convertidas a Data URLs (formato PNG)
 */
function exportBaseTexturesAsPngDataUrls() {
  if (typeof document === 'undefined') return {};
  const result = {};

  function pixelsToPngDataUrl(pixels, w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(w, h);
    new Uint32Array(imgData.data.buffer).set(pixels);
    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL('image/png');
  }

  // Paredes (64x192)
  result['src/engine/textures/walls/castillo.png'] = pixelsToPngDataUrl(createStoneWallPixels(64, 192), 64, 192);
  result['src/engine/textures/walls/blanca.png'] = pixelsToPngDataUrl(createWhiteWallPixels(64, 192), 64, 192);
  result['src/engine/textures/walls/negra.png'] = pixelsToPngDataUrl(createBlackCapPixels(64, 192), 64, 192);
  result['src/engine/textures/walls/cristal.png'] = pixelsToPngDataUrl(createCrystalWallPixels(64, 192), 64, 192);

  // Puertas (64x128)
  result['src/engine/textures/doors/castillo.png'] = pixelsToPngDataUrl(createWoodDoorPixels(64, 128), 64, 128);
  result['src/engine/textures/doors/blanca.png'] = pixelsToPngDataUrl(createWhiteDoorPixels(64, 128), 64, 128);
  result['src/engine/textures/doors/negra.png'] = pixelsToPngDataUrl(createBlackDoorPixels(64, 128), 64, 128);
  result['src/engine/textures/doors/cristal.png'] = pixelsToPngDataUrl(createCrystalDoorPixels(64, 128), 64, 128);

  // Ventana (64x192)
  result['src/engine/textures/windows/ventana.png'] = pixelsToPngDataUrl(createWindowPixels(64, 192), 64, 192);

  // Cantos / Jambas (64x192)
  result['src/engine/textures/caps/castillo.png'] = pixelsToPngDataUrl(createStoneCapPixels(64, 192), 64, 192);
  result['src/engine/textures/caps/blanca.png'] = pixelsToPngDataUrl(createWhiteCapPixels(64, 192), 64, 192);
  result['src/engine/textures/caps/negra.png'] = pixelsToPngDataUrl(createBlackCapPixels(64, 192), 64, 192);
  result['src/engine/textures/caps/cristal.png'] = pixelsToPngDataUrl(createCrystalCapPixels(64, 192), 64, 192);

  return result;
}

if (typeof window !== 'undefined') {
  window.WALL_STYLES = WALL_STYLES;
  window.DOOR_STYLES = DOOR_STYLES;
  window.loadStylesFromManifest = loadStylesFromManifest;
  window.registerWallStyle = registerWallStyle;
  window.registerDoorStyle = registerDoorStyle;
  window.removeCustomStyle = removeCustomStyle;
  window.loadCustomStyles = loadCustomStyles;
  window.exportBaseTexturesAsPngDataUrls = exportBaseTexturesAsPngDataUrls;
}

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
    DOOR_STYLES,
    loadStylesFromManifest,
    registerWallStyle,
    registerDoorStyle,
    removeCustomStyle,
    loadCustomStyles,
    exportBaseTexturesAsPngDataUrls
  };
}


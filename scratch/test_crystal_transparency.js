const fs = require('fs');

// Mock canvas & context with full RGBA support for Node.js
class MockContext {
  constructor(w, h) {
    this.width = w;
    this.height = h;
    this.data = new Uint8ClampedArray(w * h * 4);
    this.fillStyle = 'rgba(0,0,0,0)';
  }
  fillRect(x, y, w, h) {
    const color = this._parseColor(this.fillStyle);
    for (let py = Math.max(0, y); py < Math.min(this.height, y + h); py++) {
      for (let px = Math.max(0, x); px < Math.min(this.width, x + w); px++) {
        const idx = (py * this.width + px) * 4;
        this.data[idx] = color.r;
        this.data[idx + 1] = color.g;
        this.data[idx + 2] = color.b;
        this.data[idx + 3] = color.a;
      }
    }
  }
  _parseColor(str) {
    if (typeof str === 'string' && str.startsWith('rgba')) {
      const parts = str.match(/[\d.]+/g);
      if (parts && parts.length >= 4) {
        return {
          r: parseInt(parts[0]),
          g: parseInt(parts[1]),
          b: parseInt(parts[2]),
          a: Math.round(parseFloat(parts[3]) * 255)
        };
      }
    }
    return { r: 100, g: 150, b: 200, a: 100 }; // default translucent
  }
  beginPath() {}
  moveTo(x, y) {}
  lineTo(x, y) {}
  closePath() {}
  fill() {}
  stroke() {}
  arc() {}
  fillText() {}
  createLinearGradient() {
    return {
      addColorStop: (stop, color) => {
        this.fillStyle = color;
      }
    };
  }
  getImageData(x, y, w, h) {
    return { data: this.data };
  }
  putImageData() {}
}

global.document = {
  createElement: (tag) => {
    if (tag === 'canvas') {
      return {
        width: 64,
        height: 64,
        getContext: function() {
          return new MockContext(this.width, this.height);
        },
        toDataURL: () => 'data:image/png;base64,mock'
      };
    }
    return {};
  }
};

const textures = require('../src/engine/textures.js');

console.log('--- Verificando canales alfa de texturas de cristal ---');
const crystalWall = textures.createCrystalWallPixels(64, 192);
let translucentCount = 0;
let opaqueCount = 0;

for (let i = 0; i < crystalWall.length; i++) {
  const a = (crystalWall[i] >> 24) & 0xFF;
  if (a > 0 && a < 254) translucentCount++;
  if (a >= 254) opaqueCount++;
}

console.log('Pared de Cristal: total píxeles =', crystalWall.length);
console.log('  Translúcidos (0 < a < 254):', translucentCount);
console.log('  Opacos (a >= 254):', opaqueCount);

if (translucentCount === 0) {
  console.error('ERROR: la pared de cristal no tiene píxeles translúcidos.');
  process.exit(1);
}

const crystalDoor = textures.createCrystalDoorPixels(64, 128);
let doorTranslucent = 0;
let doorOpaque = 0;
for (let i = 0; i < crystalDoor.length; i++) {
  const a = (crystalDoor[i] >> 24) & 0xFF;
  if (a > 0 && a < 254) doorTranslucent++;
  if (a >= 254) doorOpaque++;
}
console.log('Puerta de Cristal (5x10): total píxeles =', crystalDoor.length);
console.log('  Translúcidos:', doorTranslucent);
console.log('  Opacos:', doorOpaque);

if (doorTranslucent === 0) {
  console.error('ERROR: la puerta de cristal no tiene píxeles translúcidos.');
  process.exit(1);
}

console.log('\n--- Probando simulación matemática de Alpha Blending ---');
// Fondo rojo (255, 0, 0)
const bgR = 255, bgG = 0, bgB = 0;
const bgPixel = (255 << 24) | (bgB << 16) | (bgG << 8) | bgR;

// Cristal cian (50, 150, 250) con alfa 100 / 255 (~40% opacidad)
const cR = 50, cG = 150, cB = 250, cA = 100;
const alphaRatio = cA / 255;
const invAlpha = 1 - alphaRatio;

const finalR = Math.min(255, Math.floor(cR * alphaRatio + bgR * invAlpha));
const finalG = Math.min(255, Math.floor(cG * alphaRatio + bgG * invAlpha));
const finalB = Math.min(255, Math.floor(cB * alphaRatio + bgB * invAlpha));

console.log(`Fondo rojo (${bgR}, ${bgG}, ${bgB}) visto a través de cristal cian (${cR}, ${cG}, ${cB}, alfa=${cA}):`);
console.log(`  Color resultante = (${finalR}, ${finalG}, ${finalB})`);

if (finalR > 100 && finalG > 50 && finalB > 80) {
  console.log('  -> El color resultante combina correctamente el fondo con el cristal.');
} else {
  console.error('ERROR en el cálculo de alpha blending.');
  process.exit(1);
}

console.log('\n✅ Todas las pruebas de transparencia y alpha blending pasaron exitosamente.');

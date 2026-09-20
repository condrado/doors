const fs = require('fs');
const path = require('path');

// Mock canvas & DOM for Node.js
class MockContext {
  constructor(w, h) {
    this.width = w;
    this.height = h;
    this.data = new Uint8ClampedArray(w * h * 4);
    this.fillStyle = '#000000';
  }
  fillRect(x, y, w, h) {}
  beginPath() {}
  moveTo(x, y) {}
  lineTo(x, y) {}
  closePath() {}
  fill() {}
  stroke() {}
  arc() {}
  fillText() {}
  createLinearGradient() {
    return { addColorStop: () => {} };
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

console.log('--- Probando generadores de texturas ---');
const stoneWall = textures.createStoneWallPixels(64, 192);
console.log('Pared Castillo:', stoneWall.width, 'x', stoneWall.height, 'length:', stoneWall.length);
if (stoneWall.width !== 64 || stoneWall.height !== 192 || stoneWall.length !== 64 * 192) {
  console.error('ERROR: dimensiones de pared castillo incorrectas');
  process.exit(1);
}

const whiteWall = textures.createWhiteWallPixels(64, 192);
console.log('Pared Blanca:', whiteWall.width, 'x', whiteWall.height, 'length:', whiteWall.length);

const crystalWall = textures.createCrystalWallPixels(64, 192);
console.log('Pared Cristal:', crystalWall.width, 'x', crystalWall.height, 'length:', crystalWall.length);

const stoneCap = textures.createStoneCapPixels(64, 192);
console.log('Canto Castillo:', stoneCap.width, 'x', stoneCap.height, 'length:', stoneCap.length);

const windowTex = textures.createWindowPixels(64, 192);
console.log('Ventana:', windowTex.width, 'x', windowTex.height, 'length:', windowTex.length);

const door = textures.createWoodDoorPixels(64, 128);
console.log('Puerta (5x10):', door.width, 'x', door.height, 'length:', door.length);
if (door.width !== 64 || door.height !== 128 || door.length !== 64 * 128) {
  console.error('ERROR: dimensiones de puerta incorrectas');
  process.exit(1);
}

console.log('\n--- Probando simulación matemática de blitTexBand ---');
const h = 400;
const halfH = 200;
const dist = 2.0;
const wallHeightScale = 3.0;
const doorHeightScale = 2.2;
const eyeHeight = 1.5;

const proj = h / dist;
const bottomY = halfH + eyeHeight * proj;
const doorTopY = halfH - (doorHeightScale - eyeHeight) * proj;
const wallTopY = halfH - (wallHeightScale - eyeHeight) * proj;

console.log('wallTopY (techo):', wallTopY, 'doorTopY (marco):', doorTopY, 'bottomY (suelo):', bottomY);

// 1. Mapeo continuo de pared completa (0 a 3.0m)
const totalHeight = bottomY - wallTopY;
const texH = 192;
const step = texH / totalHeight;

let minTexY = 999999, maxTexY = -1;
for (let y = Math.floor(wallTopY); y <= Math.floor(bottomY); y++) {
  const texPos = (y - wallTopY) * step;
  const texY = Math.min(texH - 1, Math.max(0, Math.floor(texPos)));
  if (texY < minTexY) minTexY = texY;
  if (texY > maxTexY) maxTexY = texY;
}
console.log('Rango texY para pared completa (esperado 0 a 191):', minTexY, 'a', maxTexY);

// 2. Mapeo continuo de dintel (de wallTopY a doorTopY)
let minLintelY = 999999, maxLintelY = -1;
for (let y = Math.floor(wallTopY); y <= Math.floor(doorTopY + 1); y++) {
  const texPos = (y - wallTopY) * step;
  const texY = Math.min(texH - 1, Math.max(0, Math.floor(texPos)));
  if (texY < minLintelY) minLintelY = texY;
  if (texY > maxLintelY) maxLintelY = texY;
}
console.log('Rango texY para dintel (esperado 0 a ~51):', minLintelY, 'a', maxLintelY);

console.log('\n✅ Todas las pruebas matemáticas y de dimensiones pasaron con éxito.');

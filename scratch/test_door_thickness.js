const fs = require('fs');
const path = require('path');

class MockContext {
  constructor(w, h) {
    this.width = w;
    this.height = h;
    this.data = new Uint8ClampedArray(w * h * 4);
    this.fillStyle = '#000000';
  }
  fillRect() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  closePath() {}
  fill() {}
  stroke() {}
  arc() {}
  fillText() {}
  drawImage() {}
  createLinearGradient() {
    return { addColorStop: () => {} };
  }
  getImageData() {
    return { data: this.data };
  }
  createImageData(w, h) {
    return { data: new Uint8ClampedArray(w * h * 4) };
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
global.Image = class {
  constructor() {
    setTimeout(() => { if (this.onload) this.onload(); }, 1);
  }
};

const textures = require('../src/engine/textures.js');
global.WALL_STYLES = textures.WALL_STYLES;
global.DOOR_STYLES = textures.DOOR_STYLES;
global.createWindowPixels = textures.createWindowPixels;

const { RaycasterEngine } = require('../src/engine/raycaster.js');

const canvas = { width: 320, height: 240, getContext: () => new MockContext(320, 240) };
const raycaster = new RaycasterEngine(canvas);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

console.log('\n--- 1. Puerta Norte Cerrada DN (Hoja a 1/10 = 0.10m enrasada con pared de 0.10m) ---');
{
  const faces = raycaster.generateCellFaces(['DN'], 0, 0);

  // Caras de la hoja: nyA = 0.00, nyB = 0.10
  const leafFaceFront = faces.find(f => f.axis === 'y' && Math.abs(f.pos - 0.10) < 1e-4 && !f.isLintelOnly);
  const leafFaceBack = faces.find(f => f.axis === 'y' && Math.abs(f.pos - 0.00) < 1e-4 && !f.isLintelOnly);
  assert(!!leafFaceFront, 'Cara frontal de hoja en Y = 0.10');
  assert(!!leafFaceBack, 'Cara trasera de hoja en Y = 0.00');

  // Grosor de la hoja = 0.10 m (1/10 de celda)
  const leafThickness = (leafFaceFront && leafFaceBack) ? (leafFaceFront.pos - leafFaceBack.pos) : 0;
  assert(Math.abs(leafThickness - 0.10) < 1e-4, `Grosor de la hoja es exactamente 0.10 m (1/10 celda): ${leafThickness}`);

  // Dintel superior cubre el vano de pared de 0.10 m (Y = 0.0 a 0.10)
  const lintelFront = faces.find(f => f.axis === 'y' && Math.abs(f.pos - 0.10) < 1e-4 && f.isLintelOnly);
  const lintelBack = faces.find(f => f.axis === 'y' && Math.abs(f.pos - 0.00) < 1e-4 && f.isLintelOnly);
  assert(!!lintelFront && !!lintelBack, 'Dintel superior cubre de Y = 0.0 a 0.10 (0.10 m de grosor de pared)');
}

console.log('\n--- 2. Puerta Este Cerrada DE ---');
{
  const faces = raycaster.generateCellFaces(['DE'], 0, 0);

  // Caras de la hoja: exA = 0.90, exB = 1.00
  const leafFaceFront = faces.find(f => f.axis === 'x' && Math.abs(f.pos - 0.90) < 1e-4 && !f.isLintelOnly);
  const leafFaceBack = faces.find(f => f.axis === 'x' && Math.abs(f.pos - 1.00) < 1e-4 && !f.isLintelOnly);
  assert(!!leafFaceFront && !!leafFaceBack, 'Caras de la hoja en X = 0.90 y X = 1.00 (0.10 m de grosor enrasada con muro Este)');

  // Dintel superior
  const lintelFront = faces.find(f => f.axis === 'x' && Math.abs(f.pos - 0.90) < 1e-4 && f.isLintelOnly);
  const lintelBack = faces.find(f => f.axis === 'x' && Math.abs(f.pos - 1.00) < 1e-4 && f.isLintelOnly);
  assert(!!lintelFront && !!lintelBack, 'Dintel Este cubre X = 0.90 a 1.00 (0.10 m de grosor)');
}

console.log('\n--- 3. Puerta Abierta ODN (Hoja abatida a 1/10 = 0.10m) ---');
{
  const faces = raycaster.generateCellFaces(['ODN'], 0, 0);

  // Hoja abatida contra pared oeste: odwxA = 0.0, odwxB = 0.10
  const openLeafFront = faces.find(f => f.axis === 'x' && Math.abs(f.pos - 0.10) < 1e-4 && f.isOpenDoor);
  const openLeafBack = faces.find(f => f.axis === 'x' && Math.abs(f.pos - 0.00) < 1e-4 && f.isOpenDoor);
  assert(!!openLeafFront && !!openLeafBack, 'Hoja abierta mide 0.10 m de saliente (X = 0.00 a 0.10)');

  // Cantos de la hoja abierta abarcan minX: 0.0, maxX: 0.10
  const openCap = faces.find(f => f.axis === 'y' && f.isCap && f.isOpenDoor);
  assert(openCap && Math.abs(openCap.minX - 0.0) < 1e-4 && Math.abs(openCap.maxX - 0.10) < 1e-4, 'Canto de hoja abierta mide 0.10 m (0.00 a 0.10)');
}

console.log('\n--- 4. Comprobación de bloqueo de jugador en el vano ---');
{
  // Jugador dentro del vano de la puerta Norte (posY = 0.10)
  const blockingPlayer = { posX: 0.5, posY: 0.10 };
  assert(raycaster.isPlayerBlockingDoor(0, 0, blockingPlayer, 'ODN'), 'Jugador dentro del vano (Y=0.10) bloquea cierre');

  // Jugador ya salido del vano en la sala (posY = 0.55)
  const clearPlayer = { posX: 0.5, posY: 0.55 };
  assert(!raycaster.isPlayerBlockingDoor(0, 0, clearPlayer, 'ODN'), 'Jugador fuera del vano (Y=0.55) NO bloquea cierre');
}

console.log(`\n=============================`);
console.log(`Total: ${passed + failed} | Aprobadas: ${passed} | Fallidas: ${failed}`);
if (failed > 0) process.exit(1);
console.log('🎉 Todas las pruebas de grosor de puertas 1/10 PASARON con éxito.\n');

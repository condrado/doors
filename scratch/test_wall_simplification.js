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
  drawImage() {}
  createLinearGradient() {
    return { addColorStop: () => {} };
  }
  getImageData(x, y, w, h) {
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

console.log('\n--- 1. Caso T: Eje Vertical CV primero, luego Pared Norte N ---');
{
  raycaster.wallStyleMap = { '0,0': { 'CV': 'castillo', 'N': 'blanca' } };
  const faces = raycaster.generateCellFaces(['CV', 'N'], 0, 0);

  // Pared N en Y = 0 debe ser continua (0 a 1) y estilo blanca
  const northFace = faces.find(f => f.axis === 'y' && Math.abs(f.pos - 0) < 1e-4 && Math.abs(f.minX - 0) < 1e-4 && Math.abs(f.maxX - 1) < 1e-4);
  assert(!!northFace, 'Pared Norte es continua de 0 a 1 en Y = 0');
  assert(northFace && northFace.style === 'blanca', 'Pared Norte tiene estilo blanca');
  assert(northFace && !northFace.isCap, 'Pared Norte NO es un canto');

  // No debe haber NINGÚN canto de CV en Y = 0
  const cvCapNorth = faces.find(f => f.axis === 'y' && Math.abs(f.pos - 0) < 1e-4 && f.isCap);
  assert(!cvCapNorth, 'NO se genera canto de CV en Y = 0 (la pared N lo tapa)');

  // Las caras laterales de CV deben empezar en Y = 0.20 (no en 0)
  const cvWestFace = faces.find(f => f.axis === 'x' && Math.abs(f.pos - 0.40) < 1e-4);
  assert(cvWestFace && Math.abs(cvWestFace.minY - 0.20) < 1e-4 && Math.abs(cvWestFace.maxY - 1.0) < 1e-4, 'Cara Oeste de CV empieza en Y = 0.20 y termina en 1.0');
  assert(cvWestFace && cvWestFace.style === 'castillo', 'Cara de CV conserva estilo castillo');
}

console.log('\n--- 2. Caso T inverso: Pared Norte N primero, luego Eje Vertical CV ---');
{
  raycaster.wallStyleMap = { '0,0': { 'N': 'blanca', 'CV': 'castillo' } };
  const faces = raycaster.generateCellFaces(['N', 'CV'], 0, 0);

  // CV genera canto en Y = 0
  const cvCapNorth = faces.find(f => f.axis === 'y' && Math.abs(f.pos - 0) < 1e-4 && f.isCap);
  assert(!!cvCapNorth && Math.abs(cvCapNorth.minX - 0.40) < 1e-4 && Math.abs(cvCapNorth.maxX - 0.60) < 1e-4, 'CV genera canto en Y = 0 (0.40 a 0.60)');

  // N queda dividida a los lados de CV
  const nLeft = faces.find(f => f.axis === 'y' && Math.abs(f.pos - 0) < 1e-4 && Math.abs(f.minX - 0) < 1e-4 && Math.abs(f.maxX - 0.40) < 1e-4);
  const nRight = faces.find(f => f.axis === 'y' && Math.abs(f.pos - 0) < 1e-4 && Math.abs(f.minX - 0.60) < 1e-4 && Math.abs(f.maxX - 1.0) < 1e-4);
  assert(!!nLeft && !!nRight, 'Pared N queda dividida a los lados de CV (0..0.40 y 0.60..1.0)');

  // Cara Oeste de CV expuesta a la sala
  const cvWestFace = faces.find(f => f.axis === 'x' && Math.abs(f.pos - 0.40) < 1e-4);
  assert(cvWestFace && Math.abs(cvWestFace.minY - 0.20) < 1e-4 && Math.abs(cvWestFace.maxY - 1.0) < 1e-4, 'Cara Oeste de CV expuesta a la sala desde Y = 0.20 hasta 1.0');
}

console.log('\n--- 3. Caso Esquina L: Pared N y Pared W ---');
{
  raycaster.wallStyleMap = { '0,0': { 'N': 'blanca', 'W': 'castillo' } };
  const faces = raycaster.generateCellFaces(['N', 'W'], 0, 0);

  // W fue puesta después de N, por lo que W posee el rincón [0..0.20, 0..0.20]
  const wOuter = faces.find(f => f.axis === 'x' && Math.abs(f.pos - 0) < 1e-4 && Math.abs(f.minY - 0) < 1e-4 && Math.abs(f.maxY - 1.0) < 1e-4);
  assert(!!wOuter, 'Cara exterior Oeste es continua de 0 a 1.0');

  // En la unión interior (X = 0.20, Y = 0.20) no hay cara interna que divida el rincón
  const internalFace = faces.find(f => f.axis === 'x' && Math.abs(f.pos - 0.20) < 1e-4 && f.minY < 0.20 && f.maxY <= 0.20);
  assert(!internalFace, 'No hay cara interna separando N y W en el rincón');
}

console.log('\n--- 4. Caso T interior: Semieje CN primero, luego Eje Horizontal CH ---');
{
  raycaster.wallStyleMap = { '0,0': { 'CN': 'castillo', 'CH': 'blanca' } };
  const faces = raycaster.generateCellFaces(['CN', 'CH'], 0, 0);

  const cnCapInside = faces.find(f => f.axis === 'y' && Math.abs(f.pos - 0.60) < 1e-4 && f.style === 'castillo');
  assert(!cnCapInside, 'CN no genera canto dentro ni al sur de CH');
}

console.log('\n--- 5. Caso Rincón 1x1: RNW ---');
{
  raycaster.wallStyleMap = { '0,0': { 'RNW': 'negra' } };
  const faces = raycaster.generateCellFaces(['RNW'], 0, 0);

  assert(faces.length === 4, `RNW genera exactamente 4 caras (generadas: ${faces.length})`);
  const hasNorth = faces.some(f => f.axis === 'y' && Math.abs(f.pos - 0) < 1e-4 && Math.abs(f.maxX - 0.20) < 1e-4);
  const hasSouth = faces.some(f => f.axis === 'y' && Math.abs(f.pos - 0.20) < 1e-4 && Math.abs(f.maxX - 0.20) < 1e-4);
  const hasWest = faces.some(f => f.axis === 'x' && Math.abs(f.pos - 0) < 1e-4 && Math.abs(f.maxY - 0.20) < 1e-4);
  const hasEast = faces.some(f => f.axis === 'x' && Math.abs(f.pos - 0.20) < 1e-4 && Math.abs(f.maxY - 0.20) < 1e-4);
  assert(hasNorth && hasSouth && hasWest && hasEast, 'RNW genera un cubo de 0.20 x 0.20 en la esquina NO');
  assert(faces.every(f => f.style === 'negra'), 'Todas las caras de RNW tienen estilo negra');
}

console.log('\n--- 6. Retrocompatibilidad con corner_NW ---');
{
  const faces = raycaster.generateCellFaces(['corner_NW'], 0, 0);
  assert(faces.length > 0, 'corner_NW se expande y genera caras correctamente');
}

console.log(`\n=============================`);
console.log(`Total: ${passed + failed} | Aprobadas: ${passed} | Fallidas: ${failed}`);
if (failed > 0) process.exit(1);
console.log('🎉 Todas las pruebas de simplificación de paredes PASARON con éxito.\n');

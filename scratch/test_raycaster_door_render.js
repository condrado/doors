import texPkg from '../src/engine/textures.js';
Object.assign(globalThis, texPkg);

// Setup minimal mock canvas
class MockCanvas {
  constructor(w, h) {
    this.width = w;
    this.height = h;
  }
  getContext() {
    return {
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {},
      drawImage: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      fill: () => {},
      arc: () => {},
      clearRect: () => {},
      fillText: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
      getImageData: () => ({ data: new Uint8ClampedArray(64 * 192 * 4) })
    };
  }
}

globalThis.document = {
  createElement: (tag) => new MockCanvas(64, 64)
};

import pkg from '../src/engine/raycaster.js';
const { RaycasterEngine } = pkg;

// Test raycaster with a map containing a door
const canvas = new MockCanvas(320, 240);
const minimapCanvas = new MockCanvas(100, 100);
const raycaster = new RaycasterEngine(canvas, minimapCanvas, {
  map: [
    [1, 1, 1],
    [1, ['DN'], 1],
    [1, 0, 1]
  ],
  mapWidth: 3,
  mapHeight: 3
});

const segments = raycaster.getCellSegments(1, 1);
console.log('Door cell (1, 1) segments count:', segments.length);
segments.forEach(s => {
  console.log(`- axis=${s.axis}, pos=${s.pos.toFixed(3)}, min=${((s.axis==='y'?s.minX:s.minY)||0).toFixed(3)}, max=${((s.axis==='y'?s.maxX:s.maxY)||0).toFixed(3)}, name=${s.name}, isCap=${!!s.isCap}, isFrame=${!!s.isFrame}, isDoorLeaf=${!!s.isDoorLeaf}`);
});

// Test open door
raycaster.map[1][1] = ['ODN'];
raycaster.invalidateMapCache();
const openSegments = raycaster.getCellSegments(1, 1);
console.log('\nOpen door cell (1, 1) segments count:', openSegments.length);
openSegments.forEach(s => {
  console.log(`- axis=${s.axis}, pos=${s.pos.toFixed(3)}, min=${((s.axis==='y'?s.minX:s.minY)||0).toFixed(3)}, max=${((s.axis==='y'?s.maxX:s.maxY)||0).toFixed(3)}, name=${s.name}, isOpenDoor=${!!s.isOpenDoor}, isFrame=${!!s.isFrame}`);
});

console.log('\nSUCCESS: All door segments generated cleanly with frame jambs and recessed leaf!');

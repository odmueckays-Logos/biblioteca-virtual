// Texturas procedurales generadas en canvas (sin archivos de imagen).
// Cada material tiene un mapa de color (sRGB) y un mapa de superficie lineal:
//   R = altura (bumpMap) · G = rugosidad (roughnessMap) · B = metal (metalnessMap)
import * as THREE from 'three';
import { clamp, createNoise2D, mulberry32 } from '../core/math.js';

export function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  return { canvas, ctx };
}

export function canvasTexture(canvas, { srgb = true, repeat = true, anisotropy = 8 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// Ruido periódico: se repite exactamente cada `px` × `py` celdas (texturas sin costuras).
function tileNoise(seed) {
  const rand = mulberry32(seed);
  const vals = new Float32Array(65536);
  for (let i = 0; i < vals.length; i++) vals[i] = rand();
  const hash = (x, y) => vals[((x & 255) << 8) | (y & 255)];
  function noise(x, y, px, py) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const x0 = ((xi % px) + px) % px;
    const y0 = ((yi % py) + py) % py;
    const x1 = (x0 + 1) % px;
    const y1 = (y0 + 1) % py;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash(x0, y0);
    const b = hash(x1, y0);
    const c = hash(x0, y1);
    const d = hash(x1, y1);
    return a + (b - a) * u + (c + (d - c) * u - a - (b - a) * u) * v;
  }
  function fbm(x, y, px, py, octaves = 4, gain = 0.5) {
    let amp = 0.5;
    let sum = 0;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * f, y * f, px * f, py * f);
      norm += amp;
      amp *= gain;
      f *= 2;
    }
    return sum / norm;
  }
  return { noise, fbm };
}

function finish(color, surface, opts = {}) {
  return {
    map: canvasTexture(color.canvas, { srgb: true, ...opts }),
    surface: canvasTexture(surface.canvas, { srgb: false, ...opts }),
  };
}

// ---------------------------------------------------------------- Madera del estante
export function woodTexture({ w = 1024, h = 512, seed = 11, dark = [38, 25, 16], light = [92, 64, 40] } = {}) {
  const color = makeCanvas(w, h);
  const surface = makeCanvas(w, h);
  const cImg = color.ctx.createImageData(w, h);
  const sImg = surface.ctx.createImageData(w, h);
  const n = tileNoise(seed);
  const n2 = tileNoise(seed + 101);
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const warp = n.fbm(u * 2, v * 4, 2, 4, 3) - 0.5;
      const rings = v * 38 + warp * 1.1 + (n2.fbm(u * 4, v * 16, 4, 16, 2) - 0.5) * 0.5;
      const ring = Math.pow(Math.abs(Math.sin(rings * Math.PI)), 8);
      const fiber = n.fbm(u * 24, v * 256, 24, 256, 2);
      const streak = n2.fbm(u * 4, v * 64, 4, 64, 4);
      const pore = fiber > 0.78 ? (fiber - 0.78) * 3 : 0;
      let t = 0.32 + streak * 0.5 - ring * 0.14 - pore * 0.3 + (warp + 0.5) * 0.1;
      t = clamp(t, 0, 1);
      const i = (y * w + x) * 4;
      const warm = 1 + (n2.noise(u * 5, v * 5, 5, 5) - 0.5) * 0.12;
      cImg.data[i] = clamp((dark[0] + (light[0] - dark[0]) * t) * warm, 0, 255);
      cImg.data[i + 1] = clamp(dark[1] + (light[1] - dark[1]) * t, 0, 255);
      cImg.data[i + 2] = clamp((dark[2] + (light[2] - dark[2]) * t) / warm, 0, 255);
      cImg.data[i + 3] = 255;
      sImg.data[i] = clamp(150 + streak * 60 - ring * 70 - pore * 120, 0, 255);
      sImg.data[i + 1] = clamp(150 + ring * 40 + pore * 60 - streak * 30, 0, 255);
      sImg.data[i + 2] = 0;
      sImg.data[i + 3] = 255;
    }
  }
  color.ctx.putImageData(cImg, 0, 0);
  surface.ctx.putImageData(sImg, 0, 0);
  return finish(color, surface);
}

// ---------------------------------------------------------------- Piso de tablones
// Tablones a lo largo de V (profundidad de la sala). Cubre 2.4 × 2.4 m.
export function floorTexture({ size = 1024, seed = 23, planks = 14 } = {}) {
  const color = makeCanvas(size, size);
  const surface = makeCanvas(size, size);
  const cImg = color.ctx.createImageData(size, size);
  const sImg = surface.ctx.createImageData(size, size);
  const n = tileNoise(seed);
  const rand = mulberry32(seed);
  const plankW = size / planks;
  // Juntas de cabeza por tablón (posiciones en V, periódicas).
  const joints = [];
  const tones = [];
  for (let p = 0; p < planks; p++) {
    const list = [];
    let pos = rand();
    const count = 1 + Math.floor(rand() * 2);
    for (let k = 0; k < count; k++) {
      list.push(pos % 1);
      pos += 0.35 + rand() * 0.4;
    }
    joints.push(list.sort((a, b) => a - b));
    tones.push([]);
    for (let k = 0; k < count; k++) tones[p].push(0.75 + rand() * 0.45);
  }
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const p = Math.floor(x / plankW);
      const px = (x - p * plankW) / plankW; // 0..1 dentro del tablón
      const js = joints[p];
      let seg = 0;
      let jointDist = 1;
      for (let k = 0; k < js.length; k++) {
        const d = Math.abs(v - js[k]);
        jointDist = Math.min(jointDist, d, 1 - d);
        if (v >= js[k]) seg = k + 1;
      }
      seg = seg % js.length;
      const tone = tones[p][seg];
      const grainWarp = n.fbm(u * 4 + p * 0.37, v * 2, 4, 2, 3);
      const grain = Math.pow(Math.abs(Math.sin((px * 3.2 + grainWarp * 4 + p * 1.7) * Math.PI)), 3);
      const fibers = n.fbm(u * 64, v * 8, 64, 8, 3);
      const wear = n.fbm(u * 6, v * 6, 6, 6, 4);
      let t = 0.32 * tone + fibers * 0.3 - grain * 0.12 + (wear - 0.5) * 0.22;
      const edge = Math.min(px, 1 - px) * plankW;
      const gap = edge < 1.3 ? 1 : 0;
      const joint = jointDist * size < 1.2 ? 1 : 0;
      const bevel = clamp(edge / 4, 0, 1);
      t *= 0.72 + 0.28 * bevel;
      if (gap || joint) t = 0.02;
      t = clamp(t, 0, 1);
      const i = (y * size + x) * 4;
      cImg.data[i] = 36 + t * 118;
      cImg.data[i + 1] = 22 + t * 78;
      cImg.data[i + 2] = 13 + t * 46;
      cImg.data[i + 3] = 255;
      sImg.data[i] = gap || joint ? 0 : clamp(120 + bevel * 60 + fibers * 40 - grain * 30, 0, 255);
      sImg.data[i + 1] = clamp(90 + (1 - wear) * 90 + grain * 25 + (gap ? 120 : 0), 0, 255);
      sImg.data[i + 2] = 0;
      sImg.data[i + 3] = 255;
    }
  }
  color.ctx.putImageData(cImg, 0, 0);
  surface.ctx.putImageData(sImg, 0, 0);
  return finish(color, surface);
}

// ---------------------------------------------------------------- Muro de sillería
// Bloques de arenisca con juntas. Cubre 2.4 × 2.4 m.
export function stoneTexture({ size = 1024, seed = 5 } = {}) {
  const color = makeCanvas(size, size);
  const surface = makeCanvas(size, size);
  const cImg = color.ctx.createImageData(size, size);
  const sImg = surface.ctx.createImageData(size, size);
  const n = tileNoise(seed);
  const rand = mulberry32(seed);

  const rows = 8;
  const rowEdges = [0];
  let acc = 0;
  const raw = [];
  for (let r = 0; r < rows; r++) raw.push(0.8 + rand() * 0.4);
  const total = raw.reduce((a, b) => a + b, 0);
  for (let r = 0; r < rows; r++) {
    acc += raw[r] / total;
    rowEdges.push(acc);
  }
  const rowBlocks = [];
  for (let r = 0; r < rows; r++) {
    const first = rand();
    const edges = [first];
    let x = first + 0.14 + rand() * 0.16;
    while (x < first + 0.88) {
      edges.push(x % 1);
      x += 0.14 + rand() * 0.16;
    }
    edges.sort((a, b) => a - b);
    rowBlocks.push(edges.map((e) => ({ start: e, tint: 0.84 + rand() * 0.26, hue: rand() })));
  }
  const mortar = 3.2 / size;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    let r = 0;
    while (r < rows - 1 && v >= rowEdges[r + 1]) r++;
    const y0 = rowEdges[r];
    const y1 = rowEdges[r + 1];
    const dy = Math.min(v - y0, y1 - v);
    const blocks = rowBlocks[r];
    for (let x = 0; x < size; x++) {
      const u = x / size;
      let b = blocks.length - 1;
      for (let k = 0; k < blocks.length; k++) if (u >= blocks[k].start) b = k;
      const start = blocks[b].start;
      const end = b + 1 < blocks.length ? blocks[b + 1].start : blocks[0].start + 1;
      const uu = u < start ? u + 1 : u;
      const dx = Math.min(uu - start, end - uu);
      const rough = (n.fbm(u * 24, v * 24, 24, 24, 3) - 0.5) * 0.006;
      const d = Math.min(dx, dy) + rough;
      const isMortar = d < mortar;
      const edgeRound = clamp((d - mortar) / 0.012, 0, 1);
      const mott = n.fbm(u * 8 + b * 3.1, v * 8 + r * 2.3, 8, 8, 4);
      const speck = n.noise(u * 300, v * 300, 300, 300);
      const blk = blocks[b];
      const stain = n.fbm(u * 3 + 7.1, v * 3 + 2.3, 3, 3, 4);
      let t = blk.tint * (0.84 + mott * 0.24) - (speck > 0.92 ? 0.08 : 0) - Math.max(0, stain - 0.55) * 0.5;
      t *= 0.93 + 0.07 * edgeRound;
      const i = (y * size + x) * 4;
      if (isMortar) {
        const m = 0.8 + mott * 0.15;
        cImg.data[i] = 150 * m;
        cImg.data[i + 1] = 142 * m;
        cImg.data[i + 2] = 128 * m;
        sImg.data[i] = 40;
        sImg.data[i + 1] = 250;
      } else {
        const warm = (blk.hue - 0.5) * 0.08;
        cImg.data[i] = clamp(176 * t * (1 + warm), 0, 255);
        cImg.data[i + 1] = clamp(165 * t, 0, 255);
        cImg.data[i + 2] = clamp(145 * t * (1 - warm), 0, 255);
        sImg.data[i] = clamp(110 + edgeRound * 70 + mott * 60 - (speck > 0.92 ? 50 : 0), 0, 255);
        sImg.data[i + 1] = clamp(220 + mott * 30, 0, 255);
      }
      sImg.data[i + 2] = 0;
      cImg.data[i + 3] = 255;
      sImg.data[i + 3] = 255;
    }
  }
  color.ctx.putImageData(cImg, 0, 0);
  surface.ctx.putImageData(sImg, 0, 0);
  return finish(color, surface);
}

// ---------------------------------------------------------------- Yeso (techo y paños)
export function plasterTexture({ size = 512, seed = 31 } = {}) {
  const color = makeCanvas(size, size);
  const surface = makeCanvas(size, size);
  const cImg = color.ctx.createImageData(size, size);
  const sImg = surface.ctx.createImageData(size, size);
  const n = tileNoise(seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const m = n.fbm(u * 4, v * 4, 4, 4, 5);
      const f = n.noise(u * 128, v * 128, 128, 128);
      const t = 0.82 + (m - 0.5) * 0.22 + (f - 0.5) * 0.04;
      const i = (y * size + x) * 4;
      cImg.data[i] = 214 * t;
      cImg.data[i + 1] = 202 * t;
      cImg.data[i + 2] = 182 * t;
      cImg.data[i + 3] = 255;
      sImg.data[i] = 128 + (f - 0.5) * 60 + (m - 0.5) * 40;
      sImg.data[i + 1] = 235;
      sImg.data[i + 2] = 0;
      sImg.data[i + 3] = 255;
    }
  }
  color.ctx.putImageData(cImg, 0, 0);
  surface.ctx.putImageData(sImg, 0, 0);
  return finish(color, surface);
}

// ---------------------------------------------------------------- Cuero y pergamino (grises, se tiñen)
export function leatherGrain({ size = 512, seed = 41 } = {}) {
  const color = makeCanvas(size, size);
  const surface = makeCanvas(size, size);
  const cImg = color.ctx.createImageData(size, size);
  const sImg = surface.ctx.createImageData(size, size);
  const n = tileNoise(seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const pebble = n.fbm(u * 96, v * 96, 96, 96, 2);
      const crease = Math.pow(1 - Math.abs(n.fbm(u * 6, v * 10, 6, 10, 3) - 0.5) * 2, 18);
      const scuff = n.fbm(u * 5, v * 5, 5, 5, 4);
      const t = 0.8 + (pebble - 0.5) * 0.28 - crease * 0.18 + (scuff - 0.5) * 0.3;
      const i = (y * size + x) * 4;
      const g = clamp(t * 255, 0, 255);
      cImg.data[i] = g;
      cImg.data[i + 1] = g;
      cImg.data[i + 2] = g;
      cImg.data[i + 3] = 255;
      sImg.data[i] = clamp(140 + (pebble - 0.5) * 160 - crease * 90, 0, 255);
      sImg.data[i + 1] = clamp(150 + (scuff - 0.5) * 120 + crease * 40, 0, 255);
      sImg.data[i + 2] = 0;
      sImg.data[i + 3] = 255;
    }
  }
  color.ctx.putImageData(cImg, 0, 0);
  surface.ctx.putImageData(sImg, 0, 0);
  return { color: color.canvas, surface: surface.canvas };
}

// Canto de las hojas (líneas finas de papel), para el bloque de páginas.
export function paperEdgeTexture({ w = 512, h = 256, seed = 53 } = {}) {
  const color = makeCanvas(w, h);
  const cImg = color.ctx.createImageData(w, h);
  const n = tileNoise(seed);
  const rand = mulberry32(seed);
  const lines = new Float32Array(h);
  for (let y = 0; y < h; y++) lines[y] = rand();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      const dirt = n.fbm(u * 6, v * 3, 6, 3, 4);
      const t = 0.78 + (lines[y] - 0.5) * 0.16 - (dirt - 0.4) * 0.32;
      const i = (y * w + x) * 4;
      cImg.data[i] = clamp(236 * t, 0, 255);
      cImg.data[i + 1] = clamp(222 * t, 0, 255);
      cImg.data[i + 2] = clamp(190 * t, 0, 255);
      cImg.data[i + 3] = 255;
    }
  }
  color.ctx.putImageData(cImg, 0, 0);
  return canvasTexture(color.canvas, { srgb: true });
}

// Ruido de valor no periódico para quien lo necesite (dibujos de páginas, etc.).
export const valueNoise = createNoise2D;

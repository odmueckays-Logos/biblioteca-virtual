// Libros decorativos: atlas de lomos (pergamino, cuero, etiquetas, dorados) y
// geometría de libro cerrado. Todos se fusionan en pocas mallas.
//
// Marco local "R" de un libro (el mismo que usa el libro interactivo):
//   x: desde el lomo hacia el corte delantero · y: alto (origen al centro)
//   z: grosor (tapa delantera en +z). En el estante se rota +90° en Y,
//   así el lomo mira al usuario y la tapa delantera queda a la derecha.
import * as THREE from 'three';
import { clamp, mulberry32 } from '../core/math.js';
import { canvasTexture, makeCanvas } from './textures.js';

export const BOARD = 0.0042; // grosor de tapa
export const SQUARE = 0.0035; // cuánto sobresalen las tapas del bloque de hojas
export const JOINT = 0.004; // distancia del lomo al canto del bloque

const TITLES = [
  ['FLORA', 'PERUVIANA'], ['HISTORIA', 'NATURAL'], ['BOTANICA'], ['PLANTAS', 'ANDINAS'], ['HERBARIO'],
  ['CRONICA'], ['DICCIONARIO'], ['VIAGES'], ['OBRAS'], ['TRATADO'], ['MEMORIAS'], ['GEOGRAFIA'],
  ['MINERALES'], ['ACTAS'], ['ANALES'], ['ORDENANZAS'], ['MISCELANEA'], ['ESTUDIOS'], ['RELACION'],
  ['NOTICIAS'], ['COMPENDIO'], ['ELEMENTOS'], ['MATERIA', 'MEDICA'], ['CLIMAS'], ['ZOOLOGIA'],
  ['ARTE DE LA', 'LENGUA'], ['VOCABULARIO'], ['AGRICULTURA'], ['CARTAS'], ['SINODOS'], ['CATALOGO'],
];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

const VELLUM = [[204, 188, 150], [194, 176, 136], [182, 163, 124], [212, 197, 160], [170, 150, 112], [190, 173, 134]];
const LEATHER = [[92, 58, 36], [74, 44, 28], [104, 70, 44], [62, 40, 30], [84, 34, 26], [48, 44, 36], [110, 84, 56]];
const LABELS = [[26, 22, 20], [30, 40, 32], [70, 24, 20], [36, 32, 48], [22, 30, 26]];
const GOLD = '#b8924a';

// Estilo aleatorio (pero repetible) para un lomo.
export function randomSpineStyle(rand) {
  const kind = rand() < 0.62 ? 'vellum' : 'leather';
  const base = kind === 'vellum' ? VELLUM[Math.floor(rand() * VELLUM.length)] : LEATHER[Math.floor(rand() * LEATHER.length)];
  const jitter = 0.9 + rand() * 0.18;
  return {
    kind,
    base: base.map((c) => clamp(c * jitter, 0, 255)),
    title: TITLES[Math.floor(rand() * TITLES.length)],
    volume: rand() < 0.4 ? ROMAN[Math.floor(rand() * ROMAN.length)] : null,
    label: rand() < (kind === 'vellum' ? 0.8 : 0.65) ? LABELS[Math.floor(rand() * LABELS.length)] : null,
    label2: rand() < 0.35,
    bands: kind === 'leather' ? 4 + Math.floor(rand() * 2) : rand() < 0.3 ? 3 : 0,
    shelfmark: rand() < 0.55,
    wear: 0.3 + rand() * 0.7,
    seed: Math.floor(rand() * 1e9),
  };
}

const rgb = (c, k = 1) => `rgb(${clamp(c[0] * k, 0, 255) | 0},${clamp(c[1] * k, 0, 255) | 0},${clamp(c[2] * k, 0, 255) | 0})`;

// Dibuja un lomo en (x, y, w, h) sobre el canvas de color y el de superficie.
export function drawSpine(cc, sc, x, y, w, h, style) {
  const rand = mulberry32(style.seed);
  const s = w / 128; // escala relativa a una celda de 128 px de ancho
  cc.save();
  sc.save();
  cc.beginPath();
  cc.rect(x, y, w, h);
  cc.clip();
  sc.beginPath();
  sc.rect(x, y, w, h);
  sc.clip();

  const rough = style.kind === 'vellum' ? 165 : 132;
  cc.fillStyle = rgb(style.base);
  cc.fillRect(x, y, w, h);
  sc.fillStyle = `rgb(128,${rough},0)`;
  sc.fillRect(x, y, w, h);

  // Manchas y moteado.
  for (let i = 0; i < 46; i++) {
    const r = (8 + rand() * 40) * s;
    const px = x + rand() * w;
    const py = y + rand() * h;
    const g = cc.createRadialGradient(px, py, 0, px, py, r);
    const dark = rand() < 0.7;
    const a = (style.kind === 'vellum' ? 0.16 : 0.1) * (0.4 + rand()) * style.wear;
    g.addColorStop(0, dark ? `rgba(60,40,20,${a})` : `rgba(255,245,220,${a * 0.8})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    cc.fillStyle = g;
    cc.fillRect(px - r, py - r, r * 2, r * 2);
  }

  // Pliegues verticales del pergamino.
  if (style.kind === 'vellum') {
    for (let i = 0; i < 7; i++) {
      const px = x + rand() * w;
      const len = h * (0.2 + rand() * 0.7);
      const py = y + rand() * (h - len);
      cc.strokeStyle = `rgba(70,50,30,${0.08 + rand() * 0.1})`;
      cc.lineWidth = (0.8 + rand() * 1.4) * s;
      cc.beginPath();
      cc.moveTo(px, py);
      cc.bezierCurveTo(px + (rand() - 0.5) * 6 * s, py + len * 0.3, px + (rand() - 0.5) * 6 * s, py + len * 0.6, px + (rand() - 0.5) * 4 * s, py + len);
      cc.stroke();
      sc.strokeStyle = 'rgb(90,175,0)';
      sc.lineWidth = 2 * s;
      sc.stroke(new Path2D(`M${px} ${py} L${px} ${py + len}`));
    }
  }

  // Sombra en los bordes del lomo y suciedad arriba/abajo.
  const edge = cc.createLinearGradient(x, 0, x + w, 0);
  edge.addColorStop(0, 'rgba(20,12,6,0.42)');
  edge.addColorStop(0.18, 'rgba(20,12,6,0.0)');
  edge.addColorStop(0.82, 'rgba(20,12,6,0.0)');
  edge.addColorStop(1, 'rgba(20,12,6,0.42)');
  cc.fillStyle = edge;
  cc.fillRect(x, y, w, h);
  const ends = cc.createLinearGradient(0, y, 0, y + h);
  ends.addColorStop(0, `rgba(30,18,8,${0.45 * style.wear})`);
  ends.addColorStop(0.07, 'rgba(30,18,8,0)');
  ends.addColorStop(0.93, 'rgba(30,18,8,0)');
  ends.addColorStop(1, `rgba(30,18,8,${0.55 * style.wear})`);
  cc.fillStyle = ends;
  cc.fillRect(x, y, w, h);

  // Nervios en relieve.
  const bandYs = [];
  if (style.bands > 0) {
    const top = y + h * 0.1;
    const span = h * 0.78;
    for (let i = 0; i < style.bands; i++) bandYs.push(top + (span * (i + 0.5)) / style.bands);
    for (const by of bandYs) {
      const bh = 7 * s;
      const g = cc.createLinearGradient(0, by - bh, 0, by + bh);
      g.addColorStop(0, 'rgba(0,0,0,0.35)');
      g.addColorStop(0.35, 'rgba(255,235,200,0.16)');
      g.addColorStop(0.65, 'rgba(0,0,0,0.05)');
      g.addColorStop(1, 'rgba(0,0,0,0.4)');
      cc.fillStyle = g;
      cc.fillRect(x, by - bh, w, bh * 2);
      sc.fillStyle = 'rgb(235,120,0)';
      sc.fillRect(x, by - bh * 0.6, w, bh * 1.2);
      if (style.kind === 'leather') {
        cc.fillStyle = GOLD;
        sc.fillStyle = 'rgb(150,80,255)';
        for (const off of [-bh * 1.35, bh * 1.35]) {
          cc.fillRect(x + 3 * s, by + off - 0.9 * s, w - 6 * s, 1.8 * s);
          sc.fillRect(x + 3 * s, by + off - 0.9 * s, w - 6 * s, 1.8 * s);
        }
      }
    }
  }

  // Etiqueta con título dorado.
  const labelY = bandYs.length >= 2 ? (bandYs[0] + bandYs[1]) / 2 : y + h * (0.2 + rand() * 0.06);
  if (style.label) {
    const lh = (bandYs.length >= 2 ? (bandYs[1] - bandYs[0]) * 0.62 : h * (0.1 + rand() * 0.04));
    const lx = x + 9 * s;
    const lw = w - 18 * s;
    cc.fillStyle = rgb(style.label);
    cc.fillRect(lx, labelY - lh / 2, lw, lh);
    cc.fillStyle = 'rgba(255,255,255,0.05)';
    cc.fillRect(lx, labelY - lh / 2, lw, lh * 0.3);
    sc.fillStyle = 'rgb(150,120,0)';
    sc.fillRect(lx, labelY - lh / 2, lw, lh);
    cc.strokeStyle = GOLD;
    cc.lineWidth = 1.6 * s;
    cc.strokeRect(lx + 3 * s, labelY - lh / 2 + 3 * s, lw - 6 * s, lh - 6 * s);
    sc.strokeStyle = 'rgb(170,80,255)';
    sc.lineWidth = 1.6 * s;
    sc.strokeRect(lx + 3 * s, labelY - lh / 2 + 3 * s, lw - 6 * s, lh - 6 * s);

    const lines = style.title;
    const fontSize = Math.min((lh * 0.62) / lines.length, 15 * s);
    cc.font = `600 ${fontSize}px "EB Garamond", Georgia, serif`;
    sc.font = cc.font;
    cc.textAlign = sc.textAlign = 'center';
    cc.textBaseline = sc.textBaseline = 'middle';
    cc.fillStyle = GOLD;
    sc.fillStyle = 'rgb(170,70,255)';
    lines.forEach((line, i) => {
      const ty = labelY + (i - (lines.length - 1) / 2) * fontSize * 1.05;
      const measured = cc.measureText(line).width;
      const sx = Math.min(1, (lw - 10 * s) / measured);
      for (const ctx of [cc, sc]) {
        ctx.save();
        ctx.translate(x + w / 2, ty);
        ctx.scale(sx, 1);
        ctx.fillText(line, 0, 0);
        ctx.restore();
      }
    });
  } else if (style.kind === 'vellum') {
    // Título manuscrito en tinta sobre el pergamino.
    cc.save();
    cc.translate(x + w / 2, y + h * 0.42);
    cc.rotate(-Math.PI / 2);
    cc.font = `italic ${16 * s}px "IM Fell English", Georgia, serif`;
    cc.textAlign = 'center';
    cc.textBaseline = 'middle';
    cc.fillStyle = 'rgba(52,34,22,0.78)';
    cc.fillText(style.title.join(' '), 0, 0);
    cc.restore();
  }

  if (style.label2 && style.volume) {
    const vy = bandYs.length >= 3 ? (bandYs[1] + bandYs[2]) / 2 : y + h * 0.36;
    const vh = 26 * s;
    cc.fillStyle = rgb(style.label || [30, 26, 22], 1.1);
    cc.fillRect(x + 16 * s, vy - vh / 2, w - 32 * s, vh);
    cc.font = `600 ${13 * s}px "EB Garamond", Georgia, serif`;
    cc.textAlign = 'center';
    cc.textBaseline = 'middle';
    cc.fillStyle = GOLD;
    cc.fillText(style.volume, x + w / 2, vy + 1 * s);
    sc.fillStyle = 'rgb(170,70,255)';
    sc.fillRect(x + w / 2 - 8 * s, vy - 5 * s, 16 * s, 10 * s);
  }

  // Tejuelo de biblioteca (papel blanco con signatura).
  if (style.shelfmark) {
    const my = y + h * (0.86 + rand() * 0.04);
    const mh = 30 * s;
    const mw = w - 30 * s;
    cc.fillStyle = 'rgb(232,224,204)';
    cc.fillRect(x + 15 * s, my - mh / 2, mw, mh);
    cc.fillStyle = 'rgba(80,60,40,0.18)';
    cc.fillRect(x + 15 * s, my + mh * 0.2, mw, mh * 0.3);
    cc.font = `${12 * s}px "EB Garamond", Georgia, serif`;
    cc.textAlign = 'center';
    cc.textBaseline = 'middle';
    cc.fillStyle = 'rgba(30,24,20,0.85)';
    const random = `${String.fromCharCode(65 + Math.floor(rand() * 8))}-${100 + Math.floor(rand() * 800)}`;
    cc.fillText(style.shelfmarkText || random, x + w / 2, my);
    sc.fillStyle = 'rgb(140,200,0)';
    sc.fillRect(x + 15 * s, my - mh / 2, mw, mh);
  }

  // Cabezada gastada: borde superior irregular.
  cc.fillStyle = `rgba(35,22,12,${0.5 * style.wear})`;
  cc.beginPath();
  cc.moveTo(x, y);
  for (let i = 0; i <= 8; i++) cc.lineTo(x + (w * i) / 8, y + rand() * 7 * s * style.wear);
  cc.lineTo(x + w, y);
  cc.closePath();
  cc.fill();

  cc.restore();
  sc.restore();
}

// Título del lomo en renglones cortos (el lomo es angosto).
export function spineTitle(titulo) {
  const t = titulo.toUpperCase();
  const words = t.split(/\s+/).filter(Boolean);
  if (t.length <= 11 || words.length === 1) return [t];
  const lines = Math.min(words.length, t.length > 24 ? 3 : 2);
  const target = t.length / lines;
  const out = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (line && test.length > target * 1.15 && out.length < lines - 1) {
      out.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  out.push(line);
  return out;
}

// Atlas de lomos: 32 × 4 celdas de 128 × 512 px. Cuando se llena, los libros
// que faltan repiten lomos ya dibujados (con tantos distintos no se nota).
export class SpineAtlas {
  constructor(cols = 32, rows = 4, cellW = 128, cellH = 512) {
    this.cols = cols;
    this.rows = rows;
    this.cellW = cellW;
    this.cellH = cellH;
    this.color = makeCanvas(cols * cellW, rows * cellH);
    this.surface = makeCanvas(cols * cellW, rows * cellH);
    this.count = 0;
  }

  get capacity() {
    return this.cols * this.rows;
  }

  // Cuántas celdas tienen un lomo dibujado.
  get used() {
    return Math.min(this.count, this.capacity);
  }

  // Vuelve a empezar (al reconstruir la biblioteca se redibuja igual).
  reset() {
    this.count = 0;
  }

  add(style) {
    if (this.count >= this.capacity) {
      return { ...this.cell(style.seed % this.capacity), index: style.seed % this.capacity };
    }
    const i = this.count++;
    const cx = i % this.cols;
    const cy = Math.floor(i / this.cols);
    drawSpine(this.color.ctx, this.surface.ctx, cx * this.cellW, cy * this.cellH, this.cellW, this.cellH, style);
    // UV con el origen abajo a la izquierda (flipY de la textura).
    const pad = 1 / (this.cols * this.cellW);
    return {
      u0: cx / this.cols + pad,
      u1: (cx + 1) / this.cols - pad,
      v0: 1 - (cy + 1) / this.rows,
      v1: 1 - cy / this.rows,
      index: i,
    };
  }

  cell(i) {
    const cx = i % this.cols;
    const cy = Math.floor(i / this.cols);
    const pad = 1 / (this.cols * this.cellW);
    return { u0: cx / this.cols + pad, u1: (cx + 1) / this.cols - pad, v0: 1 - (cy + 1) / this.rows, v1: 1 - cy / this.rows };
  }

  textures() {
    const map = canvasTexture(this.color.canvas, { srgb: true, repeat: false, anisotropy: 8 });
    const surface = canvasTexture(this.surface.canvas, { srgb: false, repeat: false, anisotropy: 8 });
    return { map, surface };
  }
}

// ------------------------------------------------------------------ geometría
// Acumula cuadriláteros en varias capas; cada capa se convierte en una geometría.
class GeoBuilder {
  constructor(layers = 1) {
    this.layers = Array.from({ length: layers }, () => ({ pos: [], nrm: [], uv: [], idx: [] }));
  }
  // Cuadrilátero a-b-c-d (antihorario visto desde la normal).
  quad(a, b, c, d, n, uvs, layer = 0) {
    const L = this.layers[layer];
    const base = L.pos.length / 3;
    for (const p of [a, b, c, d]) L.pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) L.nrm.push(n[0], n[1], n[2]);
    for (const t of uvs) L.uv.push(t[0], t[1]);
    L.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build(layer = 0) {
    const L = this.layers[layer];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(L.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(L.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(L.uv, 2));
    g.setIndex(L.idx);
    return g;
  }
}

// Libro cerrado en el marco R. Devuelve { covers } (tapas y lomo, atlas) y { pages } (cantos).
export function closedBookGeometry({ T, H, W, bulge = null }, cell) {
  const b = new GeoBuilder(2);
  const b2 = BOARD;
  const sq = SQUARE;
  const yb = -H / 2 - sq;
  const yt = H / 2 + sq;
  const bg = bulge ?? Math.min(0.016, 0.22 * (T + 2 * b2));
  const lerpU = (u) => cell.u0 + (cell.u1 - cell.u0) * u;
  const lerpV = (v) => cell.v0 + (cell.v1 - cell.v0) * v;
  // Zona lisa del atlas para las tapas.
  const plain = (u, v) => [lerpU(0.35 + u * 0.3), lerpV(0.52 + v * 0.1)];

  // Lomo: media elipse entre las dos tapas.
  const seg = 14;
  const rz = T / 2 + b2;
  const outer = [];
  for (let i = 0; i <= seg; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / seg;
    const px = JOINT - (bg + b2 * 0.5) * Math.cos(a);
    const pz = rz * Math.sin(a);
    const nx = -Math.cos(a) / (bg + b2 * 0.5);
    const nz = Math.sin(a) / rz;
    const nl = Math.hypot(nx, nz);
    outer.push({ px, pz, nx: nx / nl, nz: nz / nl, u: i / seg });
  }
  for (let i = 0; i < seg; i++) {
    const p = outer[i];
    const q = outer[i + 1];
    b.quad(
      [p.px, yb, p.pz], [q.px, yb, q.pz], [q.px, yt, q.pz], [p.px, yt, p.pz],
      [(p.nx + q.nx) / 2, 0, (p.nz + q.nz) / 2],
      [[lerpU(p.u), lerpV(0)], [lerpU(q.u), lerpV(0)], [lerpU(q.u), lerpV(1)], [lerpU(p.u), lerpV(1)]],
    );
  }
  // Tapa del lomo (arriba), rellena hacia el bloque.
  for (let i = 0; i < seg; i++) {
    const p = outer[i];
    const q = outer[i + 1];
    b.quad([p.px, yt, p.pz], [q.px, yt, q.pz], [JOINT, yt, q.pz * 0.8], [JOINT, yt, p.pz * 0.8], [0, 1, 0],
      [plain(0, 0), plain(1, 0), plain(1, 1), plain(0, 1)]);
  }

  // Tapas (lado exterior y canto superior).
  const x0 = JOINT;
  const x1 = W + sq;
  for (const side of [-1, 1]) {
    const zOut = side * (T / 2 + b2);
    const zIn = side * (T / 2);
    if (side > 0) {
      b.quad([x0, yb, zOut], [x1, yb, zOut], [x1, yt, zOut], [x0, yt, zOut], [0, 0, 1], [plain(0, 0), plain(1, 0), plain(1, 1), plain(0, 1)]);
    } else {
      b.quad([x1, yb, zOut], [x0, yb, zOut], [x0, yt, zOut], [x1, yt, zOut], [0, 0, -1], [plain(0, 0), plain(1, 0), plain(1, 1), plain(0, 1)]);
    }
    const za = Math.min(zOut, zIn);
    const zb = Math.max(zOut, zIn);
    b.quad([x0, yt, zb], [x1, yt, zb], [x1, yt, za], [x0, yt, za], [0, 1, 0], [plain(0, 0), plain(1, 0), plain(1, 1), plain(0, 1)]);
    b.quad([x1, yb, zb], [x1, yb, za], [x1, yt, za], [x1, yt, zb], [1, 0, 0], [plain(0, 0), plain(1, 0), plain(1, 1), plain(0, 1)]);
  }

  // Bloque de hojas: canto superior y delantero.
  const ph = H / 2 - 0.0005;
  b.quad([x0, ph, T / 2], [W, ph, T / 2], [W, ph, -T / 2], [x0, ph, -T / 2], [0, 1, 0],
    [[0, T / 0.05], [W / 0.3, T / 0.05], [W / 0.3, 0], [0, 0]], 1);
  b.quad([W, -H / 2, T / 2], [W, -H / 2, -T / 2], [W, ph, -T / 2], [W, ph, T / 2], [1, 0, 0],
    [[0, 0], [T / 0.05, 0], [T / 0.05, H / 0.3], [0, H / 0.3]], 1);

  return { covers: b.build(0), pages: b.build(1) };
}

// Caja de libro simple para las estanterías lejanas (instanciada).
// Cara +z = lomo con la celda completa; el resto usa una zona lisa.
export function farBookGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const uv = g.getAttribute('uv');
  const normal = g.getAttribute('normal');
  for (let i = 0; i < uv.count; i++) {
    if (normal.getZ(i) > 0.5) continue;
    uv.setXY(i, 0.35 + uv.getX(i) * 0.3, 0.52 + uv.getY(i) * 0.1);
  }
  g.translate(0, 0.5, -0.5); // origen: base, lomo al frente
  return g;
}

export { GeoBuilder };

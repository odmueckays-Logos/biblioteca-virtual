// Libro interactivo 3D: tapas con bisagra, lomo flexible, pilas de hojas con
// curvatura hacia el lomo y una hoja que se dobla al pasar la página.
//
// Marco raíz (marco R): x desde el lomo hacia el corte delantero, y hacia arriba,
// z hacia la tapa delantera. El lomo (bisagra) está en x = 0, z = 0.
// Las dos mitades giran alrededor del eje Y en el lomo:
//   - mitad trasera (tapa trasera + hojas sin leer): ángulo `fold`
//   - mitad delantera (tapa delantera + hojas leídas): ángulo `fold + open`
import * as THREE from 'three';
import { clamp, hashString, mulberry32, smoothstep } from '../core/math.js';
import { BOARD, SQUARE, JOINT, drawSpine, spineTitle } from '../scene/books.js';
import { canvasTexture, makeCanvas } from '../scene/textures.js';
import { contarCaras } from './pageRenderer.js';

const NX = 36;
const NY = 8;

// Rotación en el plano XZ por un ángulo `a` (equivale a rotation.y = -a).
const rotXZ = (x, z, a) => [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)];

// Escribe un texto en uno o dos renglones (en los contextos dados), achicando la
// letra hasta que quepa en el ancho. `font(size)` da la fuente para un tamaño.
function fittedText(ctxs, text, x, y, maxWidth, size, font, { spacing = 0, twoLines = false, minSize = size * 0.45 } = {}) {
  const measure = ctxs[0];
  const fits = (lines, s) => {
    measure.font = font(s);
    measure.letterSpacing = `${spacing * (s / size)}px`;
    return lines.every((l) => measure.measureText(l).width <= maxWidth);
  };
  let lines = [text];
  let s = size;
  while (s > minSize && !fits(lines, s)) s -= 2;
  const words = text.split(/\s+/);
  if (twoLines && s < size * 0.72 && words.length > 1) {
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const pair = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
      const diff = Math.abs(pair[0].length - pair[1].length);
      if (!best || diff < best.diff) best = { pair, diff };
    }
    lines = best.pair;
    s = size * 0.8;
    while (s > minSize && !fits(lines, s)) s -= 2;
  }
  for (const ctx of ctxs) {
    ctx.font = font(s);
    ctx.letterSpacing = `${spacing * (s / size)}px`;
    lines.forEach((line, i) => ctx.fillText(line, x, y + (i - (lines.length - 1) / 2) * s * 1.1));
    ctx.letterSpacing = '0px';
  }
}

// ------------------------------------------------------------------ texturas de tapa
function coverTextures(content, leather) {
  const W = 1024;
  const H = 1400;
  const color = makeCanvas(W, H);
  const surface = makeCanvas(W, H);
  const c = color.ctx;
  const s = surface.ctx;
  const { kind, base, label } = content.cover;
  const rand = mulberry32(hashString(content.id));
  const gold = '#bf9b52';
  const coleccion = content.cat?.nombre || 'Biblioteca';

  c.fillStyle = `rgb(${base.join(',')})`;
  c.fillRect(0, 0, W, H);
  s.fillStyle = kind === 'vellum' ? 'rgb(128,170,0)' : 'rgb(128,140,0)';
  s.fillRect(0, 0, W, H);

  // Grano del cuero / pergamino.
  c.save();
  c.globalCompositeOperation = 'multiply';
  c.globalAlpha = kind === 'vellum' ? 0.35 : 0.9;
  for (let y = 0; y < H; y += 512) for (let x = 0; x < W; x += 512) c.drawImage(leather.color, x, y);
  c.restore();
  s.save();
  s.globalAlpha = 0.6;
  for (let y = 0; y < H; y += 512) for (let x = 0; x < W; x += 512) s.drawImage(leather.surface, x, y);
  s.restore();

  // Manchas y desgaste en bordes y esquinas.
  for (let i = 0; i < 70; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const r = 20 + rand() * 120;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    const dark = rand() < 0.65;
    g.addColorStop(0, dark ? `rgba(30,18,10,${0.05 + rand() * 0.08})` : `rgba(255,240,210,${0.03 + rand() * 0.05})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const edge = c.createLinearGradient(0, 0, W, 0);
  edge.addColorStop(0, 'rgba(20,12,6,0.35)');
  edge.addColorStop(0.08, 'rgba(20,12,6,0)');
  edge.addColorStop(0.94, 'rgba(255,235,200,0)');
  edge.addColorStop(1, kind === 'vellum' ? 'rgba(80,60,30,0.25)' : 'rgba(255,230,190,0.14)');
  c.fillStyle = edge;
  c.fillRect(0, 0, W, H);
  for (const [cx, cy] of [[W, 0], [W, H]]) {
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, 160);
    g.addColorStop(0, kind === 'vellum' ? 'rgba(90,60,30,0.3)' : 'rgba(230,200,160,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(cx - 160, cy - 160, 320, 320);
  }

  const tool = (x, y, w, h, lw, goldLine) => {
    c.strokeStyle = goldLine ? gold : 'rgba(10,6,3,0.45)';
    c.lineWidth = lw;
    c.strokeRect(x, y, w, h);
    if (!goldLine) {
      c.strokeStyle = 'rgba(255,235,200,0.12)';
      c.lineWidth = lw * 0.5;
      c.strokeRect(x + lw, y + lw, w, h);
    }
    s.strokeStyle = goldLine ? 'rgb(170,70,255)' : 'rgb(40,150,0)';
    s.lineWidth = lw;
    s.strokeRect(x, y, w, h);
  };

  if (kind === 'vellum') {
    tool(70, 70, W - 140, H - 140, 5, false);
    c.save();
    c.textAlign = 'center';
    c.fillStyle = 'rgba(52,32,20,0.85)';
    fittedText([c], content.titulo, W / 2, H * 0.36, W - 260, 150, (z) => `italic ${z}px "IM Fell English", Georgia, serif`, { twoLines: true });
    fittedText([c], coleccion, W / 2, H * 0.46, W - 260, 54, (z) => `${z}px "IM Fell English", Georgia, serif`);
    c.font = 'italic 46px "EB Garamond", Georgia, serif';
    c.fillText(`Tomo ${content.tomo}`, W / 2, H * 0.8);
    c.restore();
    // Etiqueta pegada.
    c.fillStyle = `rgb(${label.join(',')})`;
    c.fillRect(W / 2 - 170, H * 0.56, 340, 110);
    c.strokeStyle = gold;
    c.lineWidth = 4;
    c.strokeRect(W / 2 - 158, H * 0.56 + 12, 316, 86);
    c.fillStyle = gold;
    c.textAlign = 'center';
    fittedText([c], (content.especie || content.titulo).split(' ')[0].toUpperCase(), W / 2, H * 0.56 + 70, 290, 44, (z) => `600 ${z}px "EB Garamond", Georgia, serif`);
    s.fillStyle = 'rgb(160,90,255)';
    s.fillRect(W / 2 - 158, H * 0.56 + 12, 316, 86);
  } else {
    tool(56, 56, W - 112, H - 112, 7, false);
    tool(92, 92, W - 184, H - 184, 4, false);
    tool(118, 118, W - 236, H - 236, 3, true);
    // Florones en las esquinas.
    for (const [x, y] of [[118, 118], [W - 118, 118], [118, H - 118], [W - 118, H - 118]]) {
      c.fillStyle = gold;
      s.fillStyle = 'rgb(170,70,255)';
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        for (const ctx of [c, s]) {
          ctx.beginPath();
          ctx.ellipse(x + Math.cos(a) * 16, y + Math.sin(a) * 16, 11, 5, a, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    // Rombo central dorado.
    const cx = W / 2;
    const cy = H * 0.56;
    for (const ctx of [c, s]) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.strokeStyle = ctx === c ? gold : 'rgb(170,70,255)';
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(0, -190);
      ctx.lineTo(130, 0);
      ctx.lineTo(0, 190);
      ctx.lineTo(-130, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, -150);
      ctx.lineTo(100, 0);
      ctx.lineTo(0, 150);
      ctx.lineTo(-100, 0);
      ctx.closePath();
      ctx.stroke();
      for (let k = 0; k < 4; k++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(30, -30, 60, -20, 70, -60);
        ctx.bezierCurveTo(40, -50, 20, -40, 0, 0);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    c.fillStyle = gold;
    s.fillStyle = 'rgb(170,70,255)';
    c.textAlign = s.textAlign = 'center';
    fittedText([c, s], content.titulo.toUpperCase(), W / 2, H * 0.24, W - 330, 62, (z) => `600 ${z}px "EB Garamond", Georgia, serif`, { spacing: 10, twoLines: true });
    fittedText([c, s], coleccion.toUpperCase(), W / 2, H * 0.3, W - 330, 40, (z) => `${z}px "IM Fell English", Georgia, serif`, { spacing: 6 });
    fittedText([c, s], `TOMO ${content.tomo}`, W / 2, H * 0.86, W - 330, 44, (z) => `600 ${z}px "EB Garamond", Georgia, serif`, { spacing: 6 });
  }

  return {
    map: canvasTexture(color.canvas, { srgb: true, repeat: false }),
    surface: canvasTexture(surface.canvas, { srgb: false, repeat: false }),
  };
}

// Lomo: en el estante basta una textura pequeña (se ve de lejos); en la mano,
// una grande.
function spineTextures(content, detail) {
  const w = detail ? 256 : 128;
  const color = makeCanvas(w, w * 4);
  const surface = makeCanvas(w, w * 4);
  drawSpine(color.ctx, surface.ctx, 0, 0, w, w * 4, {
    kind: content.cover.kind,
    base: content.cover.base,
    title: spineTitle(content.titulo),
    volume: content.tomo,
    label: content.cover.label,
    label2: true,
    bands: content.cover.kind === 'leather' ? 5 : 3,
    shelfmark: true,
    shelfmarkText: content.signatura,
    wear: 0.55,
    seed: hashString(content.id) % 100000,
  });
  return {
    map: canvasTexture(color.canvas, { srgb: true, repeat: false }),
    surface: canvasTexture(surface.canvas, { srgb: false, repeat: false }),
  };
}

// Copia de una caja con sus caras reagrupadas: `groups[i]` son las caras que
// usan el material i.
function groupFaces(box, groups) {
  const src = box.index.array;
  const faces = box.groups.map((g) => Array.from(src.slice(g.start, g.start + g.count)));
  const g = box.clone();
  g.clearGroups();
  const index = [];
  groups.forEach((list, materialIndex) => {
    const start = index.length;
    for (const f of list) index.push(...faces[f]);
    g.addGroup(start, index.length - start, materialIndex);
  });
  g.setIndex(index);
  return g;
}

// ------------------------------------------------------------------ geometría dinámica
class DynamicGeometry {
  constructor(vertexCount) {
    this.geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3);
    this.normal = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3);
    this.uv = new THREE.BufferAttribute(new Float32Array(vertexCount * 2), 2);
    this.position.setUsage(THREE.DynamicDrawUsage);
    this.normal.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.position);
    this.geometry.setAttribute('normal', this.normal);
    this.geometry.setAttribute('uv', this.uv);
  }
  commit() {
    this.position.needsUpdate = true;
    this.normal.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }
}

// Índices de una rejilla (cols × rows), con orientación elegida.
function gridIndex(out, start, cols, rows, flip) {
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = start + j * (cols + 1) + i;
      const b = a + 1;
      const c = a + cols + 2;
      const d = a + cols + 1;
      if (flip) out.push(a, c, b, a, d, c);
      else out.push(a, b, c, a, c, d);
    }
  }
}

// Pila de hojas: superficie visible curvada + cantos (cabeza, pie y delantero).
class Stack {
  constructor(book, side, pageMat, edgeMat) {
    this.book = book;
    this.side = side; // 'right' (mitad trasera) | 'left' (mitad delantera)
    const surf = (NX + 1) * (NY + 1);
    const fore = (NY + 1) * 2;
    const headTail = (NX + 1) * 2 * 2;
    this.dyn = new DynamicGeometry(surf + fore + headTail);
    const idx = [];
    const flip = side === 'left';
    gridIndex(idx, 0, NX, NY, flip);
    const surfCount = idx.length;
    // Canto delantero (x = W): columnas j, filas base/superficie.
    const foreStart = surf;
    for (let j = 0; j < NY; j++) {
      const a = foreStart + j * 2;
      const b = a + 2;
      if (side === 'right') idx.push(a, b, b + 1, a, b + 1, a + 1);
      else idx.push(a, b + 1, b, a, a + 1, b + 1);
    }
    const headStart = foreStart + fore;
    for (let k = 0; k < 2; k++) {
      const start = headStart + k * (NX + 1) * 2;
      const top = k === 0; // cabeza (y = +H/2)
      for (let i = 0; i < NX; i++) {
        const a = start + i * 2;
        const b = a + 2;
        const ccw = (side === 'right') === top;
        if (ccw) idx.push(a, a + 1, b + 1, a, b + 1, b);
        else idx.push(a, b + 1, a + 1, a, b, b + 1);
      }
    }
    this.dyn.geometry.setIndex(idx);
    this.dyn.geometry.addGroup(0, surfCount, 0);
    this.dyn.geometry.addGroup(surfCount, idx.length - surfCount, 1);
    this.mesh = new THREE.Mesh(this.dyn.geometry, [pageMat, edgeMat]);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }

  update(t, openness) {
    const { W, H, T } = this.book.dims;
    const pos = this.dyn.position;
    const nrm = this.dyn.normal;
    const uv = this.dyn.uv;
    const right = this.side === 'right';
    const base = right ? -T / 2 : T / 2;
    const dir = right ? 1 : -1;
    const x0 = 0.0015;
    const h = (u) => this.book.profile(u, t, openness);
    let v = 0;
    for (let j = 0; j <= NY; j++) {
      const y = -H / 2 + (H * j) / NY;
      for (let i = 0; i <= NX; i++) {
        const u = i / NX;
        const x = x0 + (W - x0) * u;
        const hh = h(u);
        const du = 1 / NX;
        const slope = (h(Math.min(1, u + du)) - h(Math.max(0, u - du))) / ((W - x0) * 2 * du);
        pos.setXYZ(v, x, y, base + dir * Math.max(hh, 0.0004));
        const nl = Math.hypot(slope, 1);
        nrm.setXYZ(v, (-slope * dir) / nl * dir, 0, dir / nl);
        uv.setXY(v, right ? u : 1 - u, j / NY);
        v++;
      }
    }
    // Canto delantero.
    const hFore = Math.max(h(1), 0.0004);
    for (let j = 0; j <= NY; j++) {
      const y = -H / 2 + (H * j) / NY;
      for (let k = 0; k < 2; k++) {
        const z = base + dir * (k === 0 ? 0 : hFore);
        pos.setXYZ(v, W, y, z);
        nrm.setXYZ(v, 1, 0, 0);
        uv.setXY(v, j / NY * (H / 0.3), (k === 0 ? 0 : hFore) / 0.05);
        v++;
      }
    }
    // Cabeza y pie.
    for (const top of [true, false]) {
      const y = top ? H / 2 : -H / 2;
      for (let i = 0; i <= NX; i++) {
        const u = i / NX;
        const x = x0 + (W - x0) * u;
        const hh = Math.max(h(u), 0.0004);
        for (let k = 0; k < 2; k++) {
          const z = base + dir * (k === 0 ? 0 : hh);
          pos.setXYZ(v, x, y, z);
          nrm.setXYZ(v, 0, top ? 1 : -1, 0);
          uv.setXY(v, u * (W / 0.3), (k === 0 ? 0 : hh) / 0.05);
          v++;
        }
      }
    }
    this.dyn.commit();
  }
}

// Lomo flexible entre las dos tapas.
class Spine {
  constructor(book, material, innerMaterial) {
    this.book = book;
    this.seg = 18;
    const perRow = this.seg + 1;
    this.dyn = new DynamicGeometry(perRow * 4);
    const outer = [];
    const inner = [];
    // Superficie exterior (filas 0 y 1) e interior (2 y 3).
    for (let i = 0; i < this.seg; i++) {
      const a = i;
      const b = i + 1;
      const c = perRow + i + 1;
      const d = perRow + i;
      outer.push(a, b, c, a, c, d);
      const a2 = 2 * perRow + i;
      const b2 = a2 + 1;
      const c2 = 3 * perRow + i + 1;
      const d2 = 3 * perRow + i;
      inner.push(a2, c2, b2, a2, d2, c2);
    }
    this.dyn.geometry.setIndex([...outer, ...inner]);
    this.dyn.geometry.addGroup(0, outer.length, 0);
    this.dyn.geometry.addGroup(outer.length, inner.length, 1);
    this.mesh = new THREE.Mesh(this.dyn.geometry, [material, innerMaterial]);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this._pts = [];
  }

  update(foldA, frontA) {
    const { T, H } = this.book.dims;
    const yb = -H / 2 - SQUARE;
    const yt = H / 2 + SQUARE;
    const A = rotXZ(JOINT, -T / 2 - BOARD / 2, foldA);
    const B = rotXZ(JOINT, T / 2 + BOARD / 2, frontA);
    const mid = (foldA + frontA) / 2;
    const out = rotXZ(-1, 0, mid);
    const openAmt = clamp((frontA - foldA) / Math.PI, 0, 1);
    const bulge = this.book.bulge * (1 - 0.45 * openAmt) + 0.004 * openAmt;
    const C = [(A[0] + B[0]) / 2 + out[0] * bulge * 2, (A[1] + B[1]) / 2 + out[1] * bulge * 2];
    const pos = this.dyn.position;
    const nrm = this.dyn.normal;
    const uv = this.dyn.uv;
    const perRow = this.seg + 1;
    for (let i = 0; i <= this.seg; i++) {
      const t = i / this.seg;
      const u = 1 - t;
      const px = u * u * A[0] + 2 * u * t * C[0] + t * t * B[0];
      const pz = u * u * A[1] + 2 * u * t * C[1] + t * t * B[1];
      const dx = 2 * u * (C[0] - A[0]) + 2 * t * (B[0] - C[0]);
      const dz = 2 * u * (C[1] - A[1]) + 2 * t * (B[1] - C[1]);
      const l = Math.hypot(dx, dz) || 1;
      // Normal hacia afuera (a la izquierda del avance A→B).
      let nx = dz / l;
      let nz = -dx / l;
      if (nx * out[0] + nz * out[1] < 0) {
        nx = -nx;
        nz = -nz;
      }
      const ox = px + nx * BOARD * 0.5;
      const oz = pz + nz * BOARD * 0.5;
      const ix = px - nx * BOARD * 0.5;
      const iz = pz - nz * BOARD * 0.5;
      pos.setXYZ(i, ox, yb, oz);
      pos.setXYZ(perRow + i, ox, yt, oz);
      pos.setXYZ(2 * perRow + i, ix, yb, iz);
      pos.setXYZ(3 * perRow + i, ix, yt, iz);
      for (const r of [0, 1]) nrm.setXYZ(r * perRow + i, nx, 0, nz);
      for (const r of [2, 3]) nrm.setXYZ(r * perRow + i, -nx, 0, -nz);
      uv.setXY(i, t, 0);
      uv.setXY(perRow + i, t, 1);
      uv.setXY(2 * perRow + i, t, 0);
      uv.setXY(3 * perRow + i, t, 1);
    }
    this.dyn.commit();
  }
}

// Hoja que se pasa: una rejilla doble cara que gira y se curva.
class Leaf {
  constructor(book, frontMat, backMat) {
    this.book = book;
    const count = (NX + 1) * (NY + 1);
    this.dyn = new DynamicGeometry(count);
    const idx = [];
    gridIndex(idx, 0, NX, NY, false);
    this.dyn.geometry.setIndex(idx);
    // Cara trasera: misma posición, UV espejada.
    this.backGeometry = new THREE.BufferGeometry();
    this.backGeometry.setAttribute('position', this.dyn.position);
    this.backGeometry.setAttribute('normal', this.dyn.normal);
    const backUv = new THREE.BufferAttribute(new Float32Array(count * 2), 2);
    this.backGeometry.setAttribute('uv', backUv);
    this.backGeometry.setIndex(idx);
    let v = 0;
    for (let j = 0; j <= NY; j++) {
      for (let i = 0; i <= NX; i++) {
        this.dyn.uv.setXY(v, i / NX, j / NY);
        backUv.setXY(v, 1 - i / NX, j / NY);
        v++;
      }
    }
    frontMat.side = THREE.FrontSide;
    backMat.side = THREE.BackSide;
    this.front = new THREE.Mesh(this.dyn.geometry, frontMat);
    this.back = new THREE.Mesh(this.backGeometry, backMat);
    for (const m of [this.front, this.back]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.visible = false;
    }
    this._angles = new Float32Array(NX + 1);
    this._cx = new Float32Array(NX + 1);
    this._cz = new Float32Array(NX + 1);
  }

  set visible(v) {
    this.front.visible = v;
    this.back.visible = v;
  }

  // p: 0 (sobre la pila derecha) → 1 (sobre la izquierda). lift: levantar la esquina.
  update(p, foldA, frontA, tR, tL, openness, lift = 0) {
    const { W, H, T } = this.book.dims;
    const q = smoothstep(0, 1, p);
    const eps = 0.0007;
    const hR = (u) => this.book.profile(u, tR, openness);
    const hL = (u) => this.book.profile(u, tL, openness);
    const angle = foldA + (frontA - foldA) * q;
    const bend = 1.15 * Math.sin(Math.PI * 2 * p) * 0.5 + lift;
    // Pivote en el lomo, interpolado entre la superficie derecha e izquierda.
    const PR = rotXZ(0, -T / 2 + hR(0) + eps, foldA);
    const PL = rotXZ(0, T / 2 - hL(0) - eps, frontA);
    const px = PR[0] + (PL[0] - PR[0]) * q;
    const pz = PR[1] + (PL[1] - PR[1]) * q;
    const pos = this.dyn.position;
    const nrm = this.dyn.normal;
    let v = 0;
    for (let j = 0; j <= NY; j++) {
      const y = -H / 2 + (H * j) / NY;
      const yn = (j / NY) * 2 - 1;
      // La esquina superior se adelanta un poco (curvatura diagonal).
      const diag = 1 + 0.22 * yn;
      let cx = 0;
      let cz = 0;
      const ds = W / NX;
      for (let i = 0; i <= NX; i++) {
        const s = i / NX;
        const a = angle + bend * diag * Math.pow(s, 1.6);
        if (i > 0) {
          const am = (this._angles[i - 1] + a) / 2;
          cx += Math.cos(am) * ds;
          cz += Math.sin(am) * ds;
        }
        this._angles[i] = a;
        const nx = -Math.sin(a);
        const nz = Math.cos(a);
        const offR = hR(s) - hR(0);
        const offL = -(hL(s) - hL(0));
        const off = offR + (offL - offR) * q;
        pos.setXYZ(v, px + cx + nx * off, y, pz + cz + nz * off);
        nrm.setXYZ(v, nx, 0, nz);
        v++;
      }
    }
    this.dyn.commit();
  }
}

// ------------------------------------------------------------------ libro
export class InteractiveBook {
  constructor(content, dims, shared) {
    this.content = content;
    this.dims = dims; // { T, H, W }
    this.bulge = 0.011;
    this.root = new THREE.Group();
    this.root.name = `libro-${content.id}`;

    const leatherTint = new THREE.Color(`rgb(${content.cover.base.join(',')})`);
    this.shared = shared;
    this.leatherTint = leatherTint;
    // En el estante solo se ve el lomo: la tapa con sus dorados y el lomo grande
    // se dibujan al tomar el libro (cargarDetalle) y se liberan al devolverlo.
    this.lowSpine = spineTextures(content, false);
    this.detail = null;

    const mat = (opts) => new THREE.MeshStandardMaterial({ roughness: 1, metalness: 1, ...opts });
    const low = this.lowSpine;
    this.materials = {
      front: mat({ map: shared.leatherMap, color: leatherTint.clone().multiplyScalar(1.6), bumpMap: shared.leatherSurface, bumpScale: 1.1, roughnessMap: shared.leatherSurface, metalnessMap: shared.leatherSurface, emissive: 0xffffff, emissiveMap: shared.leatherMap, emissiveIntensity: 0 }),
      spine: mat({ map: low.map, bumpMap: low.surface, bumpScale: 1.1, roughnessMap: low.surface, metalnessMap: low.surface, emissive: 0xffffff, emissiveMap: low.map, emissiveIntensity: 0 }),
      leather: new THREE.MeshStandardMaterial({ map: shared.leatherMap, color: leatherTint.clone().multiplyScalar(1.6), bumpMap: shared.leatherSurface, bumpScale: 0.8, roughness: 0.62, emissive: leatherTint, emissiveIntensity: 0 }),
      pastedown: new THREE.MeshStandardMaterial({ color: 0xd9cdb0, roughness: 0.9 }),
      edge: shared.pageEdge,
      rightPage: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93 }),
      leftPage: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93 }),
      leafFront: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93 }),
      leafBack: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93 }),
    };
    if (content.cover.kind === 'vellum') {
      this.materials.leather.color.set(0xd8c8a2);
      this.materials.front.color.set(0xd8c8a2);
    }
    const M = this.materials;
    const { T, H, W } = dims;

    this.back = new THREE.Group();
    this.front = new THREE.Group();
    this.root.add(this.back, this.front);

    const boardW = W + SQUARE - JOINT;
    const boardGeo = new THREE.BoxGeometry(boardW, H + 2 * SQUARE, BOARD);
    boardGeo.translate(JOINT + boardW / 2, 0, 0);
    // Caras de BoxGeometry: +x, -x, +y, -y, +z, -z. Se agrupan por material para
    // dibujar cada tapa con 2 o 3 llamadas en vez de 6.
    this.backCover = new THREE.Mesh(groupFaces(boardGeo, [[0, 1, 2, 3, 5], [4]]), [M.leather, M.pastedown]);
    this.backCover.position.z = -T / 2 - BOARD / 2;
    this.frontCover = new THREE.Mesh(groupFaces(boardGeo, [[0, 1, 2, 3], [4], [5]]), [M.leather, M.front, M.pastedown]);
    this.frontCover.position.z = T / 2 + BOARD / 2;
    boardGeo.dispose();
    for (const m of [this.backCover, this.frontCover]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    this.back.add(this.backCover);
    this.front.add(this.frontCover);

    this.rightStack = new Stack(this, 'right', M.rightPage, M.edge);
    this.leftStack = new Stack(this, 'left', M.leftPage, M.edge);
    this.back.add(this.rightStack.mesh);
    this.front.add(this.leftStack.mesh);

    this.spine = new Spine(this, M.spine, new THREE.MeshStandardMaterial({ color: 0x2a1c14, roughness: 0.95, side: THREE.DoubleSide }));
    this.root.add(this.spine.mesh);

    this.leaf = new Leaf(this, M.leafFront, M.leafBack);
    this.root.add(this.leaf.front, this.leaf.back);

    // Caja invisible para detectar la mirada.
    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(W + 0.03, H + 0.02, T + 2 * BOARD + 0.012),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hit.position.set(W / 2 - 0.01, 0, 0);
    hit.userData.book = this;
    this.hitbox = hit;
    this.root.add(hit);

    // Estado.
    this.state = { fold: 0, open: 0, fraction: 0, openness: 0, turn: null };
    this.spread = 0;
    // Dobles páginas: salen de la maquetación del contenido (guardas incluidas).
    this.maxSpread = contarCaras(content) / 2 - 1;
    this.glow = 0;
    this.apply();
    this.modoEstante(true);
  }

  // Tapa y lomo con todo su detalle, para cuando el libro está en la mano.
  cargarDetalle() {
    if (this.detail) return;
    const cover = coverTextures(this.content, this.shared.leather);
    const spine = spineTextures(this.content, true);
    this.detail = { cover, spine };
    const M = this.materials;
    Object.assign(M.front, { map: cover.map, bumpMap: cover.surface, roughnessMap: cover.surface, metalnessMap: cover.surface, emissiveMap: cover.map });
    M.front.color.set(0xffffff);
    Object.assign(M.spine, { map: spine.map, bumpMap: spine.surface, roughnessMap: spine.surface, metalnessMap: spine.surface, emissiveMap: spine.map });
  }

  liberarDetalle() {
    if (!this.detail) return;
    const M = this.materials;
    const { leatherMap, leatherSurface } = this.shared;
    Object.assign(M.front, { map: leatherMap, bumpMap: leatherSurface, roughnessMap: leatherSurface, metalnessMap: leatherSurface, emissiveMap: leatherMap });
    if (this.content.cover.kind === 'vellum') M.front.color.set(0xd8c8a2);
    else M.front.color.copy(this.leatherTint).multiplyScalar(1.6);
    const low = this.lowSpine;
    Object.assign(M.spine, { map: low.map, bumpMap: low.surface, roughnessMap: low.surface, metalnessMap: low.surface, emissiveMap: low.map });
    for (const t of [this.detail.cover.map, this.detail.cover.surface, this.detail.spine.map, this.detail.spine.surface]) t.dispose();
    this.detail = null;
  }

  // En el estante el libro está cerrado: las páginas, las guardas y el interior
  // del lomo quedan tapados y no se dibujan, y las mallas se descartan cuando no
  // están a la vista. En la mano cambian de forma a cada momento y se dibuja todo.
  modoEstante(on) {
    const M = this.materials;
    M.rightPage.visible = !on;
    M.leftPage.visible = !on;
    M.pastedown.visible = !on;
    this.spine.mesh.material[1].visible = !on;
    for (const m of [this.rightStack.mesh, this.leftStack.mesh, this.spine.mesh]) m.frustumCulled = on;
  }

  // Libera todo lo que es propio de este libro (al reconstruir la biblioteca).
  dispose() {
    this.liberarDetalle();
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    this.leaf.backGeometry.dispose();
    for (const m of Object.values(this.materials)) {
      if (m !== this.shared.pageEdge) m.dispose();
    }
    this.spine.mesh.material[1].dispose();
    this.hitbox.material.dispose();
    this.lowSpine.map.dispose();
    this.lowSpine.surface.dispose();
  }

  // Altura de la superficie de una pila (desde la tapa) en la posición u (0 lomo → 1 corte).
  profile(u, t, openness) {
    const g0 = 0.5;
    const gw = 0.13;
    const prof = 1 - (1 - g0) * (1 - smoothstep(0, gw, u)) * openness;
    const dome = 0.0028 * openness * Math.sin(Math.PI * Math.pow(u, 0.8)) * clamp(t / 0.004, 0, 1);
    return t * prof + dome;
  }

  stackFraction(spread) {
    return 0.06 + 0.88 * (spread / this.maxSpread);
  }

  apply() {
    const s = this.state;
    const { T } = this.dims;
    const foldA = s.fold;
    const frontA = s.fold + s.open;
    this.back.rotation.y = -foldA;
    this.front.rotation.y = -frontA;
    const tL = T * s.fraction;
    const tR = T - tL;
    this.rightStack.update(tR, s.openness);
    this.leftStack.update(tL, s.openness);
    this.spine.update(foldA, frontA);
    if (s.turn) {
      this.leaf.visible = true;
      this.leaf.update(s.turn.p, foldA, frontA, tR, tL, s.openness, s.turn.lift || 0);
    } else {
      this.leaf.visible = false;
    }
  }

  setGlow(v) {
    this.glow = v;
    this.materials.front.emissiveIntensity = v * 0.1;
    this.materials.spine.emissiveIntensity = v * 0.1;
    this.materials.leather.emissiveIntensity = v * 0.12;
  }

  // Asigna las texturas de la doble página actual.
  showSpread(pages, spread) {
    this.spread = spread;
    const book = this.content;
    this.materials.leftPage.map = pages.texture(book, spread * 2);
    this.materials.rightPage.map = pages.texture(book, spread * 2 + 1);
    this.materials.pastedown.map = pages.texture(book, 0);
    this.materials.pastedown.color.set(0xffffff);
    for (const m of [this.materials.leftPage, this.materials.rightPage, this.materials.pastedown]) m.needsUpdate = true;
    this.state.fraction = this.stackFraction(spread);
    this.apply();
  }

  // Puntos útiles en coordenadas del libro (marco R) para colocar las manos.
  frontCoverEdge(yFrac = 0, target = new THREE.Vector3()) {
    const { W, H, T } = this.dims;
    target.set(W + SQUARE, yFrac * (H / 2), T / 2 + BOARD);
    return this.front.localToWorld(target);
  }
}

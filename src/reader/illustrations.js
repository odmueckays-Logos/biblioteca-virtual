// Láminas botánicas procedurales: trazos de tinta con grosor variable y aguadas
// de acuarela en modo multiplicar, para que se integren con el papel.
import { createNoise2D, hashString, mulberry32 } from '../core/math.js';

const INK = 'rgba(38, 26, 18, 0.9)';
const INK_SOFT = 'rgba(38, 26, 18, 0.55)';

// ------------------------------------------------------------------ primitivas
function taperedStroke(ctx, pts, w0, w1, color = INK) {
  if (pts.length < 2) return;
  const left = [];
  const right = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    const t = i / (pts.length - 1);
    const w = (w0 + (w1 - w0) * t) / 2;
    left.push([p[0] - dy * w, p[1] + dx * w]);
    right.push([p[0] + dy * w, p[1] - dx * w]);
  }
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (const p of left) ctx.lineTo(p[0], p[1]);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function bezierPoints(p0, p1, p2, p3, n = 24) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return pts;
}

function pointAt(pts, t) {
  const i = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
  const f = t * (pts.length - 1) - i;
  const a = pts[i];
  const b = pts[i + 1];
  return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

// Aguada: relleno translúcido con el borde algo más cargado de pigmento.
function wash(ctx, path, color, alpha, rand) {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  for (let k = 0; k < 2; k++) {
    ctx.save();
    ctx.translate((rand() - 0.5) * 2.5, (rand() - 0.5) * 2.5);
    ctx.globalAlpha = alpha * (k === 0 ? 1 : 0.45);
    ctx.fillStyle = color;
    ctx.fill(path);
    ctx.restore();
  }
  ctx.globalAlpha = alpha * 0.5;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;
  ctx.stroke(path);
  ctx.restore();
}

function hatchInside(ctx, path, bbox, angle, spacing, color, width = 1) {
  ctx.save();
  ctx.clip(path);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  const [x, y, w, h] = bbox;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.hypot(w, h);
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.beginPath();
  for (let s = -r; s < r; s += spacing) {
    ctx.moveTo(-r, s);
    ctx.lineTo(r, s);
  }
  ctx.stroke();
  ctx.restore();
}

// Hoja con forma paramétrica. Devuelve el Path2D del contorno.
function leafPath(x, y, angle, len, wid, shape = 'elliptic', serrate = 0) {
  const path = new Path2D();
  const steps = 26;
  const pts = [];
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i <= steps; i++) {
      const t = side < 0 ? i / steps : 1 - i / steps;
      let prof;
      if (shape === 'lanceolate') prof = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 1.1);
      else if (shape === 'obovate') prof = Math.sin(Math.PI * Math.pow(t, 1.45));
      else if (shape === 'ovate') prof = Math.sin(Math.PI * Math.pow(t, 0.7));
      else prof = Math.sin(Math.PI * t);
      let w = (wid / 2) * prof;
      if (serrate > 0 && t > 0.12 && t < 0.95) w *= 1 - serrate * (i % 2);
      const lx = t * len;
      const ly = side * w;
      pts.push([x + Math.cos(angle) * lx - Math.sin(angle) * ly, y + Math.sin(angle) * lx + Math.cos(angle) * ly]);
    }
  }
  path.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts) path.lineTo(p[0], p[1]);
  path.closePath();
  return path;
}

function drawLeaf(ctx, rand, { x, y, angle, len, wid, shape, color, under = false, serrate = 0, veins = 4 }) {
  const path = leafPath(x, y, angle, len, wid, shape, serrate);
  wash(ctx, path, under ? '#cfc9b4' : color, under ? 0.55 : 0.62, rand);
  if (under) hatchInside(ctx, path, [x - len, y - len, len * 2, len * 2], angle + 0.6, 4, 'rgba(60,50,40,0.18)');
  else hatchInside(ctx, path, [x - len, y - len, len * 2, len * 2], angle + 1.9, 5.5, 'rgba(30,40,20,0.14)');
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  ctx.stroke(path);
  // Nervio central y secundarios.
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = INK_SOFT;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + ca * len * 0.94, y + sa * len * 0.94);
  for (let v = 1; v <= veins; v++) {
    const t = v / (veins + 1);
    const bx = x + ca * len * t;
    const by = y + sa * len * t;
    for (const side of [-1, 1]) {
      const va = angle + side * 0.75;
      const vl = wid * 0.38 * Math.sin(Math.PI * t);
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx + Math.cos(va) * vl * 0.6, by + Math.sin(va) * vl * 0.6, bx + Math.cos(va - side * 0.35) * vl + ca * vl * 0.3, by + Math.sin(va - side * 0.35) * vl + sa * vl * 0.3);
    }
  }
  ctx.stroke();
  ctx.restore();
}

// ------------------------------------------------------------------ especies
function cantuta(ctx, w, h, rand) {
  // Rama principal y rama arqueada con flores colgantes.
  const main = bezierPoints([w * 0.3, h * 0.98], [w * 0.28, h * 0.7], [w * 0.42, h * 0.45], [w * 0.4, h * 0.08]);
  const arch = bezierPoints([w * 0.36, h * 0.52], [w * 0.52, h * 0.34], [w * 0.72, h * 0.3], [w * 0.86, h * 0.4]);
  const twig = bezierPoints([w * 0.39, h * 0.3], [w * 0.3, h * 0.2], [w * 0.2, h * 0.18], [w * 0.12, h * 0.24]);
  taperedStroke(ctx, main, 13, 3);
  taperedStroke(ctx, arch, 8, 2.5);
  taperedStroke(ctx, twig, 6, 2);

  for (const [branch, count, from, to] of [[main, 12, 0.18, 0.95], [arch, 9, 0.15, 0.9], [twig, 6, 0.2, 0.95]]) {
    for (let i = 0; i < count; i++) {
      const t = from + ((to - from) * i) / count + rand() * 0.02;
      const { p, angle } = pointAt(branch, t);
      const side = i % 2 === 0 ? 1 : -1;
      drawLeaf(ctx, rand, {
        x: p[0], y: p[1], angle: angle + side * (0.7 + rand() * 0.4),
        len: 52 + rand() * 26, wid: 22 + rand() * 8, shape: 'obovate', color: '#6f7f3f', under: rand() < 0.15, veins: 3,
      });
    }
  }

  // Flores tubulares.
  const clusters = [[arch, 1.0, 6], [main, 1.0, 4], [twig, 1.0, 3]];
  for (const [branch, t, n] of clusters) {
    const { p } = pointAt(branch, t);
    for (let i = 0; i < n; i++) {
      const spread = (i - (n - 1) / 2) * 0.28 + (rand() - 0.5) * 0.12;
      const len = 150 + rand() * 60;
      const ang = Math.PI / 2 + spread;
      const x0 = p[0] + Math.cos(ang) * 10;
      const y0 = p[1] + Math.sin(ang) * 10;
      const bend = (rand() - 0.5) * 30;
      const spine = bezierPoints([x0, y0], [x0 + Math.cos(ang) * len * 0.33 + bend, y0 + Math.sin(ang) * len * 0.33],
        [x0 + Math.cos(ang) * len * 0.66 + bend, y0 + Math.sin(ang) * len * 0.66], [x0 + Math.cos(ang) * len + bend * 0.5, y0 + Math.sin(ang) * len], 20);
      const left = [];
      const right = [];
      spine.forEach((q, k) => {
        const tt = k / (spine.length - 1);
        const a = pointAt(spine, Math.min(0.999, tt)).angle;
        const r = 4 + Math.pow(tt, 2.2) * 16;
        left.push([q[0] - Math.sin(a) * r, q[1] + Math.cos(a) * r]);
        right.push([q[0] + Math.sin(a) * r, q[1] - Math.cos(a) * r]);
      });
      const tube = new Path2D();
      tube.moveTo(left[0][0], left[0][1]);
      left.forEach((q) => tube.lineTo(q[0], q[1]));
      // Lóbulos en la boca.
      const end = spine[spine.length - 1];
      const endA = pointAt(spine, 0.999).angle;
      for (let l = 0; l <= 5; l++) {
        const la = endA + Math.PI / 2 - (Math.PI * l) / 5;
        const r = 24 + (l % 2) * 5;
        tube.lineTo(end[0] + Math.cos(la) * r + Math.cos(endA) * 8, end[1] + Math.sin(la) * r + Math.sin(endA) * 8);
      }
      for (let k = right.length - 1; k >= 0; k--) tube.lineTo(right[k][0], right[k][1]);
      tube.closePath();
      wash(ctx, tube, rand() < 0.5 ? '#b3263e' : '#c43a62', 0.72, rand);
      ctx.save();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = INK;
      ctx.stroke(tube);
      ctx.restore();
      hatchInside(ctx, tube, [x0 - 60, y0 - 20, 120, len + 60], ang + 1.2, 6, 'rgba(60,10,20,0.16)');
      // Cáliz verde y estambres.
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgba(100,120,60,0.8)';
      ctx.beginPath();
      ctx.ellipse(x0, y0 + 6, 6, 11, ang - Math.PI / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = INK_SOFT;
      ctx.lineWidth = 1;
      for (let s = 0; s < 4; s++) {
        const sa = endA + (s - 1.5) * 0.12;
        const sl = 28 + rand() * 14;
        ctx.beginPath();
        ctx.moveTo(end[0], end[1]);
        ctx.lineTo(end[0] + Math.cos(sa) * sl, end[1] + Math.sin(sa) * sl);
        ctx.stroke();
        ctx.fillStyle = '#c9a33a';
        ctx.beginPath();
        ctx.arc(end[0] + Math.cos(sa) * sl, end[1] + Math.sin(sa) * sl, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function quenua(ctx, w, h, rand) {
  // Tronco retorcido con corteza en láminas.
  const trunk = bezierPoints([w * 0.5, h * 0.99], [w * 0.62, h * 0.72], [w * 0.36, h * 0.55], [w * 0.46, h * 0.36], 40);
  const branchA = bezierPoints([w * 0.46, h * 0.4], [w * 0.4, h * 0.26], [w * 0.26, h * 0.2], [w * 0.2, h * 0.1], 30);
  const branchB = bezierPoints([w * 0.47, h * 0.42], [w * 0.6, h * 0.3], [w * 0.72, h * 0.25], [w * 0.82, h * 0.14], 30);
  const drawLimb = (pts, w0, w1) => {
    const outline = [];
    const inner = [];
    pts.forEach((p, i) => {
      const t = i / (pts.length - 1);
      const a = pointAt(pts, Math.min(0.999, t)).angle;
      const r = (w0 + (w1 - w0) * t) / 2;
      outline.push([p[0] - Math.sin(a) * r, p[1] + Math.cos(a) * r]);
      inner.push([p[0] + Math.sin(a) * r, p[1] - Math.cos(a) * r]);
    });
    const path = new Path2D();
    path.moveTo(outline[0][0], outline[0][1]);
    outline.forEach((q) => path.lineTo(q[0], q[1]));
    for (let k = inner.length - 1; k >= 0; k--) path.lineTo(inner[k][0], inner[k][1]);
    path.closePath();
    wash(ctx, path, '#b8612f', 0.62, rand);
    // Láminas de corteza.
    ctx.save();
    ctx.clip(path);
    for (let i = 0; i < pts.length * 5; i++) {
      const t = rand();
      const { p, angle } = pointAt(pts, t);
      const r = (w0 + (w1 - w0) * t) / 2;
      const off = (rand() - 0.5) * r * 1.8;
      const fx = p[0] - Math.sin(angle) * off;
      const fy = p[1] + Math.cos(angle) * off;
      const fl = 14 + rand() * 26;
      ctx.beginPath();
      ctx.ellipse(fx, fy, fl, 5 + rand() * 5, angle + (rand() - 0.5) * 0.5, 0, Math.PI * (0.8 + rand() * 0.4));
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = rand() < 0.5 ? 'rgba(217,140,80,0.35)' : 'rgba(140,60,30,0.28)';
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(50,25,15,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK;
    ctx.stroke(path);
    ctx.restore();
  };
  drawLimb(trunk, 120, 58);
  drawLimb(branchA, 50, 14);
  drawLimb(branchB, 54, 14);

  // Rosetas de hojas compuestas en las puntas.
  const rosette = (cx, cy, n, scale) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand() * 0.3;
      const len = (70 + rand() * 30) * scale;
      const ex = cx + Math.cos(a) * len;
      const ey = cy + Math.sin(a) * len;
      ctx.strokeStyle = INK_SOFT;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      const pairs = 3;
      for (let k = 1; k <= pairs; k++) {
        const t = 0.35 + (k / pairs) * 0.6;
        const px = cx + Math.cos(a) * len * t;
        const py = cy + Math.sin(a) * len * t;
        for (const side of [-1, 1]) {
          drawLeaf(ctx, rand, { x: px, y: py, angle: a + side * 0.9, len: 24 * scale, wid: 11 * scale, shape: 'obovate', color: '#3f5a35', veins: 1 });
        }
      }
      drawLeaf(ctx, rand, { x: ex, y: ey, angle: a, len: 26 * scale, wid: 12 * scale, shape: 'obovate', color: '#3f5a35', veins: 1 });
    }
    // Racimo colgante de flores diminutas.
    ctx.strokeStyle = INK_SOFT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    const rx = cx + (rand() - 0.5) * 30;
    ctx.quadraticCurveTo(cx + 10, cy + 60, rx, cy + 110);
    ctx.stroke();
    for (let k = 0; k < 9; k++) {
      const t = 0.3 + k * 0.08;
      ctx.fillStyle = 'rgba(110,70,40,0.7)';
      ctx.beginPath();
      ctx.arc(cx + (rx - cx) * t + (rand() - 0.5) * 8, cy + 110 * t, 3 + rand() * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  rosette(w * 0.2, h * 0.1, 7, 1);
  rosette(w * 0.82, h * 0.14, 7, 1);
  rosette(w * 0.33, h * 0.22, 5, 0.8);
  rosette(w * 0.68, h * 0.26, 5, 0.8);
}

function quishuar(ctx, w, h, rand) {
  const stem = bezierPoints([w * 0.52, h * 0.99], [w * 0.47, h * 0.7], [w * 0.56, h * 0.42], [w * 0.5, h * 0.18], 40);
  taperedStroke(ctx, stem, 16, 5);
  const nodes = 6;
  for (let i = 0; i < nodes; i++) {
    const t = 0.16 + (i / nodes) * 0.72;
    const { p, angle } = pointAt(stem, t);
    const len = 150 - i * 10 + rand() * 20;
    for (const side of [-1, 1]) {
      drawLeaf(ctx, rand, {
        x: p[0], y: p[1], angle: angle + side * (1.05 + rand() * 0.3) + Math.PI,
        len, wid: len * 0.26, shape: 'lanceolate', color: '#3d5234', under: rand() < 0.35, veins: 6,
      });
    }
  }
  // Cabezuelas anaranjadas.
  const top = pointAt(stem, 0.999).p;
  const heads = [[0, -40], [-70, -10], [70, -16], [-40, -95], [45, -90]];
  for (const [dx, dy] of heads) {
    const hx = top[0] + dx;
    const hy = top[1] + dy;
    ctx.strokeStyle = INK_SOFT;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(top[0], top[1] + 20);
    ctx.quadraticCurveTo((top[0] + hx) / 2, hy + 30, hx, hy);
    ctx.stroke();
    const r = 26 + rand() * 8;
    const ball = new Path2D();
    ball.arc(hx, hy, r, 0, Math.PI * 2);
    wash(ctx, ball, '#d9822b', 0.7, rand);
    for (let k = 0; k < 34; k++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * r;
      ctx.beginPath();
      ctx.arc(hx + Math.cos(a) * d, hy + Math.sin(a) * d, 3 + rand() * 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(90,40,10,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = INK;
    ctx.stroke(ball);
  }
}

function muna(ctx, w, h, rand) {
  const stems = [
    bezierPoints([w * 0.48, h * 0.9], [w * 0.44, h * 0.65], [w * 0.36, h * 0.4], [w * 0.3, h * 0.08], 36),
    bezierPoints([w * 0.5, h * 0.9], [w * 0.52, h * 0.62], [w * 0.55, h * 0.36], [w * 0.52, h * 0.05], 36),
    bezierPoints([w * 0.52, h * 0.9], [w * 0.6, h * 0.68], [w * 0.7, h * 0.46], [w * 0.76, h * 0.16], 36),
  ];
  // Raíces finas.
  ctx.strokeStyle = INK_SOFT;
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 16; i++) {
    const a = Math.PI / 2 + (rand() - 0.5) * 1.6;
    const l = 30 + rand() * 50;
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.9);
    ctx.quadraticCurveTo(w * 0.5 + Math.cos(a) * l * 0.5 + (rand() - 0.5) * 20, h * 0.9 + Math.sin(a) * l * 0.5, w * 0.5 + Math.cos(a) * l, h * 0.9 + Math.sin(a) * l);
    ctx.stroke();
  }
  for (const s of stems) {
    taperedStroke(ctx, s, 7, 2.5);
    const nodes = 9;
    for (let i = 0; i < nodes; i++) {
      const t = 0.08 + (i / nodes) * 0.88;
      const { p, angle } = pointAt(s, t);
      const size = 92 - i * 6.5 + rand() * 8;
      for (const side of [-1, 1]) {
        drawLeaf(ctx, rand, {
          x: p[0], y: p[1], angle: angle + Math.PI + side * (1.0 + rand() * 0.25),
          len: size, wid: size * 0.7, shape: 'ovate', color: '#6f8a4f', serrate: 0.12, veins: 3,
        });
      }
      // Verticilos de flores blancas en los nudos superiores.
      if (i >= 5) {
        for (let k = 0; k < 7; k++) {
          const a = rand() * Math.PI * 2;
          const d = 8 + rand() * 12;
          const fx = p[0] + Math.cos(a) * d;
          const fy = p[1] + Math.sin(a) * d;
          ctx.fillStyle = 'rgba(250,246,236,0.95)';
          ctx.strokeStyle = INK_SOFT;
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          for (let l = 0; l < 4; l++) {
            const la = (l / 4) * Math.PI * 2 + a;
            ctx.moveTo(fx, fy);
            ctx.arc(fx + Math.cos(la) * 3, fy + Math.sin(la) * 3, 3, 0, Math.PI * 2);
          }
          ctx.fill();
          ctx.stroke();
        }
      }
    }
  }
}

// Planta genérica para los libros sin imagen: tallos, hojas y flores con formas y
// colores elegidos a partir del libro, así cada uno tiene su propio dibujo.
const VERDES = ['#6f7f3f', '#3f5a35', '#3d5234', '#6f8a4f', '#58703f', '#4c6a44'];
const FLORES = ['#b3263e', '#d9822b', '#e3c23c', '#8a5bb0', '#f4efe2', '#c43a62', '#4a6fb0', '#e07a5f'];

function flowerCluster(ctx, rand, [x, y], color, size) {
  const n = 3 + Math.floor(rand() * 5);
  const petals = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (rand() - 0.5) * 2.4;
    const d = size * (0.4 + rand() * 1.1);
    const fx = x + Math.cos(a) * d;
    const fy = y + Math.sin(a) * d;
    ctx.strokeStyle = INK_SOFT;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo((x + fx) / 2 + (rand() - 0.5) * 12, (y + fy) / 2 + 8, fx, fy);
    ctx.stroke();
    const r = size * (0.32 + rand() * 0.18);
    const rot = rand() * Math.PI;
    for (let p = 0; p < petals; p++) {
      const pa = rot + (p / petals) * Math.PI * 2;
      const petal = new Path2D();
      petal.ellipse(fx + Math.cos(pa) * r * 0.62, fy + Math.sin(pa) * r * 0.62, r * 0.62, r * 0.3, pa, 0, Math.PI * 2);
      wash(ctx, petal, color, 0.7, rand);
      ctx.lineWidth = 1;
      ctx.strokeStyle = INK;
      ctx.stroke(petal);
    }
    ctx.fillStyle = '#c9a33a';
    ctx.beginPath();
    ctx.arc(fx, fy, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }
}

function generica(ctx, w, h, rand) {
  const shape = ['elliptic', 'lanceolate', 'obovate', 'ovate'][Math.floor(rand() * 4)];
  const green = VERDES[Math.floor(rand() * VERDES.length)];
  const flower = rand() < 0.8 ? FLORES[Math.floor(rand() * FLORES.length)] : null;
  const stems = 1 + Math.floor(rand() * 3);
  const opposite = rand() < 0.5;
  const serrate = rand() < 0.3 ? 0.1 : 0;
  const leafScale = 0.75 + rand() * 0.5;
  const base = [w * (0.46 + rand() * 0.08), h * 0.95];
  for (let s = 0; s < stems; s++) {
    const spread = stems === 1 ? 0 : (s / (stems - 1) - 0.5) * (0.36 + rand() * 0.16);
    const top = [w * (0.5 + spread + (rand() - 0.5) * 0.08), h * (0.1 + rand() * 0.14)];
    const stem = bezierPoints(
      base,
      [base[0] + (rand() - 0.5) * w * 0.12, h * 0.72],
      [top[0] + (rand() - 0.5) * w * 0.18, h * 0.42],
      top,
      36,
    );
    taperedStroke(ctx, stem, 11 - s * 2, 2.5);
    const nodes = 6 + Math.floor(rand() * 5);
    for (let i = 0; i < nodes; i++) {
      const t = 0.12 + (i / nodes) * 0.8;
      const { p, angle } = pointAt(stem, t);
      const len = (118 - i * 7) * leafScale * (0.8 + rand() * 0.35);
      const sides = opposite ? [-1, 1] : [i % 2 ? 1 : -1];
      for (const side of sides) {
        drawLeaf(ctx, rand, {
          x: p[0], y: p[1], angle: angle + side * (0.75 + rand() * 0.45),
          len, wid: len * (shape === 'lanceolate' ? 0.28 : 0.5), shape, color: green,
          under: rand() < 0.18, serrate, veins: 3 + Math.floor(rand() * 3),
        });
      }
    }
    if (flower) flowerCluster(ctx, rand, pointAt(stem, 0.999).p, flower, 34 + rand() * 18);
  }
}

const SPECIES = { cantuta, quenua, quishuar, muna };

// Los dibujos se trazan en un lienzo virtual de 900 × 1100 y se escalan a la caja,
// así una viñeta pequeña es la misma lámina en miniatura (sin recortes).
const PLATE_W = 900;
const PLATE_H = 1100;

// `species` es uno de los dibujos incluidos o, para cualquier otro valor, una
// planta genérica que depende de ese texto.
export function drawPlate(ctx, x, y, w, h, species, seed = 1) {
  const draw = SPECIES[species];
  // La planta genérica sale entera del azar: usa siempre la misma semilla para
  // que la portadilla, la lámina y el boceto muestren la misma planta.
  const rand = mulberry32(draw ? seed : hashString(String(species)));
  const k = Math.min(w / PLATE_W, h / PLATE_H);
  ctx.save();
  ctx.translate(x + (w - PLATE_W * k) / 2, y + (h - PLATE_H * k) / 2);
  ctx.scale(k, k);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  (draw || generica)(ctx, PLATE_W, PLATE_H, rand);
  ctx.restore();
}

// Imagen subida como lámina: se ajusta a la caja sin deformarse y se imprime
// sobre el papel (multiplicar), con un tono algo envejecido y un filete de tinta.
export function drawImagePlate(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const k = Math.min(w / iw, h / ih);
  const dw = iw * k;
  const dh = ih * k;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.filter = 'sepia(0.28) saturate(0.85) contrast(0.96)';
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = 'rgba(40,27,18,0.55)';
  ctx.lineWidth = Math.max(1, w / 400);
  ctx.strokeRect(dx - 0.5, dy - 0.5, dw + 1, dh + 1);
  ctx.restore();
}

// Silueta de cerro con la franja de altitud donde vive la especie.
export function drawAltitude(ctx, x, y, w, h, min, max, color = '#6d8a52') {
  const rand = mulberry32(min + max);
  const top = 5200;
  const toY = (alt) => y + h - (alt / top) * h;
  // Perfil de cerro con dos cumbres, hombros y quebradas irregulares.
  const ridge = [];
  const noise = createNoise2D(min + 7);
  for (let i = 0; i <= 90; i++) {
    const t = i / 90;
    const px = x + w * 0.1 + t * w * 0.88;
    const main = Math.exp(-Math.pow((t - 0.56) / 0.26, 2));
    const second = 0.72 * Math.exp(-Math.pow((t - 0.3) / 0.14, 2));
    const shape = Math.max(main, second) * (0.9 + 0.1 * Math.sin(t * 9));
    const alt = top * 0.95 * shape + (noise.fbm(t * 9, 0.5, 3) - 0.5) * 520 + (rand() - 0.5) * 60;
    ridge.push([px, toY(Math.max(0, alt))]);
  }
  const mountain = new Path2D();
  mountain.moveTo(x + w * 0.1, y + h);
  ridge.forEach((p) => mountain.lineTo(p[0], p[1]));
  mountain.lineTo(x + w * 0.98, y + h);
  mountain.closePath();

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgba(160,140,110,0.25)';
  ctx.fill(mountain);
  ctx.restore();
  hatchInside(ctx, mountain, [x, y, w, h], -0.6, 7, 'rgba(40,30,20,0.22)');

  // Franja de altitud.
  ctx.save();
  ctx.clip(mountain);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(x, toY(max), w, toY(min) - toY(max));
  ctx.restore();

  // Nieve en la cumbre.
  ctx.save();
  ctx.clip(mountain);
  ctx.fillStyle = 'rgba(250,248,240,0.9)';
  ctx.fillRect(x, y, w, toY(4800) - y);
  ctx.restore();

  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.stroke(mountain);

  // Eje de altitudes.
  ctx.font = '26px "EB Garamond", Georgia, serif';
  ctx.fillStyle = 'rgba(40,28,20,0.85)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(40,28,20,0.6)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.08, y + h);
  ctx.lineTo(x + w * 0.08, toY(top));
  ctx.stroke();
  for (let alt = 0; alt <= 5000; alt += 1000) {
    const ty = toY(alt);
    ctx.beginPath();
    ctx.moveTo(x + w * 0.08 - 8, ty);
    ctx.lineTo(x + w * 0.08, ty);
    ctx.stroke();
    ctx.fillText(`${alt === 0 ? '0' : alt.toLocaleString('es')}`, x + w * 0.08 - 14, ty);
  }
  // Líneas guía y rótulo de la franja.
  ctx.setLineDash([6, 6]);
  for (const alt of [min, max]) {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.08, toY(alt));
    ctx.lineTo(x + w * 0.98, toY(alt));
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

// Papel marmolado para las guardas.
export function drawMarble(ctx, w, h, colors, seed = 3) {
  const lowW = Math.ceil(w / 2);
  const lowH = Math.ceil(h / 2);
  const low = document.createElement('canvas');
  low.width = lowW;
  low.height = lowH;
  const lctx = low.getContext('2d');
  const img = lctx.createImageData(lowW, lowH);
  const noise = createNoise2D(seed);
  const parsed = colors.map((c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]);
  for (let y = 0; y < lowH; y++) {
    for (let x = 0; x < lowW; x++) {
      const u = x / lowW;
      const v = y / lowH;
      // Vetas peinadas: bandas finas deformadas por ruido y un peine sinusoidal.
      const swirl = noise.fbm(u * 2.2, v * 2.2, 4);
      const warp = swirl * 9 + noise.fbm(u * 7, v * 7, 3) * 2.4 + Math.sin(u * 38 + swirl * 14) * 0.35;
      const s = v * 22 + warp;
      const band = ((Math.floor(s) % parsed.length) + parsed.length) % parsed.length;
      const fr = s - Math.floor(s);
      const vein = fr < 0.06 ? 0.62 : fr > 0.94 ? 0.8 : 1;
      const c = parsed[band];
      const shade = (0.85 + noise.noise(u * 60, v * 60) * 0.2) * vein;
      const i = (y * lowW + x) * 4;
      img.data[i] = c[0] * shade;
      img.data[i + 1] = c[1] * shade;
      img.data[i + 2] = c[2] * shade;
      img.data[i + 3] = 255;
    }
  }
  lctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(low, 0, 0, w, h);
}

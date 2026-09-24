// Estante de una categoría: bajo y ancho, de dos tablas, inspirado en la
// referencia. Se construye con tablas de madera (UV en metros para que la veta no
// se estire), lleva el nombre de la categoría en la placa y se llena de libros
// decorativos entre los libros de verdad, que van donde dice el bibliotecario
// automático (src/datos/organizar.js).
//
// Los estantes se acoplan: uno al lado de otro o encima. El que va encima de otro
// no lleva zócalo sino una moldura de unión, y el que tiene otro encima cambia su
// cornisa por una tapa plana. La altura total no cambia (SHELF_STACK), así los
// cuerpos apilados quedan a plomo.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/math.js';
import { canvasTexture, makeCanvas } from './textures.js';
import { closedBookGeometry, randomSpineStyle, BOARD, SQUARE } from './books.js';

export const SHELF = {
  width: 2.5,
  height: 1.3,
  depth: 0.46,
  frontZ: -2.05, // cara delantera de los montantes
  post: 0.075,
  plinth: 0.12,
  bottomBoard: 0.035,
  middleBoard: 0.045,
  lowerOpening: 0.47,
  upperOpening: 0.485,
  rail: 0.085,
  top: 0.055,
  topOverhang: 0.035,
};

// Distancia entre los centros de dos columnas vecinas (deja 1,1 m de muro entre
// ellas, donde va la ventana).
export const SHELF_PITCH = 3.6;

// Caja con UV proporcionales al tamaño real; la veta sigue el lado más largo.
function board(w, h, d, x, y, z, texScale = 1 / 1.2) {
  const g = new THREE.BoxGeometry(w, h, d);
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i) + x;
    const py = pos.getY(i) + y;
    const pz = pos.getZ(i) + z;
    const ax = Math.abs(nrm.getX(i));
    const ay = Math.abs(nrm.getY(i));
    let a;
    let b;
    let la;
    let lb;
    if (ax > 0.5) {
      a = pz; b = py; la = d; lb = h;
    } else if (ay > 0.5) {
      a = px; b = pz; la = w; lb = d;
    } else {
      a = px; b = py; la = w; lb = h;
    }
    // La veta (U de la textura) sigue el lado más largo de la cara.
    if (la >= lb) uv.setXY(i, a * texScale, b * texScale);
    else uv.setXY(i, b * texScale, a * texScale + 0.37);
  }
  g.translate(x, y, z);
  return g;
}

// Placa de latón con el nombre de la categoría. El ancho se ajusta al texto.
const PLAQUE_H = 0.055;
const PX_PER_M = 96 / PLAQUE_H;
function plaqueTexture(text) {
  const measure = makeCanvas(8, 8).ctx;
  measure.font = '600 44px "EB Garamond", Georgia, serif';
  measure.letterSpacing = '3px';
  const textW = measure.measureText(text).width;
  const width = Math.min(2048, Math.max(512, Math.ceil(textW + 90)));
  const { canvas, ctx } = makeCanvas(width, 96);
  const g = ctx.createLinearGradient(0, 0, 0, 96);
  g.addColorStop(0, '#6d5a33');
  g.addColorStop(0.5, '#8c7443');
  g.addColorStop(1, '#5a4829');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, 96);
  ctx.strokeStyle = 'rgba(30,20,10,0.6)';
  ctx.lineWidth = 3;
  ctx.strokeRect(8, 8, width - 16, 80);
  ctx.font = '600 44px "EB Garamond", Georgia, serif';
  ctx.letterSpacing = '3px';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(28,18,8,0.85)';
  ctx.fillText(text, width / 2, 50);
  ctx.fillStyle = 'rgba(255,230,170,0.18)';
  ctx.fillText(text, width / 2, 48);
  return { texture: canvasTexture(canvas, { srgb: true, repeat: false }), width: width / PX_PER_M };
}

// Altura de un cuerpo: lo que sube la pared por cada estante apilado.
export function stackHeight() {
  const S = SHELF;
  return S.plinth + S.bottomBoard + S.lowerOpening + S.middleBoard + S.upperOpening + S.rail + S.top;
}
export const SHELF_STACK = stackHeight();

export function shelfLevels() {
  const S = SHELF;
  const y0 = S.plinth;
  const yLowerFloor = y0 + S.bottomBoard;
  const yLowerTop = yLowerFloor + S.lowerOpening;
  const yUpperFloor = yLowerTop + S.middleBoard;
  const yUpperTop = yUpperFloor + S.upperOpening;
  const yRailTop = yUpperTop + S.rail;
  const yTop = yRailTop + S.top;
  return { y0, yLowerFloor, yLowerTop, yUpperFloor, yUpperTop, yRailTop, yTop, zF: S.frontZ, zB: S.frontZ - S.depth };
}

// Un estante completo, centrado en x = 0 (quien lo usa lo coloca en su sitio).
// `placements`: [{ id, fila: 'arriba' | 'abajo-izq' | 'abajo-der', at }] con las
// medidas `dims` de los libros de verdad. Devuelve el grupo, los huecos de esos
// libros (posición local) y una caja invisible del frente para la mirada.
export function buildBookcase({
  woodMat, woodDarkMat, spineAtlas, atlasMaterial, paperEdgeMaterial, placements, dims, rotulo, seed = 2024,
  apilado = false, conEncima = false,
}) {
  const S = SHELF;
  const group = new THREE.Group();
  group.name = `estante-${rotulo}`;
  const disposables = [];

  const L = shelfLevels();
  const { y0, yLowerFloor, yLowerTop, yUpperFloor, yUpperTop, yRailTop } = L;
  const zF = S.frontZ;
  const zB = zF - S.depth;
  const zC = zF - S.depth / 2;
  const halfW = S.width / 2;
  const innerW = S.width - 2 * S.post;

  const parts = [];
  const darkParts = [];

  if (apilado) {
    // Cuerpo apilado: descansa sobre el de abajo, con una moldura que tapa la junta.
    parts.push(board(S.width - 0.05, S.plinth - 0.028, S.depth - 0.05, 0, (S.plinth - 0.028) / 2, zC));
    parts.push(board(S.width + 0.026, 0.028, S.depth + 0.016, 0, S.plinth - 0.014, zC + 0.008));
  } else {
    // Zócalo con pequeña moldura.
    parts.push(board(S.width - 0.02, S.plinth - 0.02, S.depth - 0.03, 0, (S.plinth - 0.02) / 2, zC - 0.01));
    parts.push(board(S.width + 0.012, 0.022, S.depth - 0.012, 0, S.plinth - 0.011, zC));
  }
  // Montantes laterales.
  for (const side of [-1, 1]) {
    const x = side * (halfW - S.post / 2);
    parts.push(board(S.post, yRailTop - y0, S.depth, x, y0 + (yRailTop - y0) / 2, zC));
    // Panel lateral rehundido (cara exterior).
    parts.push(board(0.012, yRailTop - y0 - 0.16, S.depth - 0.12, side * (halfW + 0.004), y0 + (yRailTop - y0) / 2, zC));
  }
  // Tablas: fondo, intermedia, travesaño y tapa.
  parts.push(board(innerW, S.bottomBoard, S.depth - 0.01, 0, y0 + S.bottomBoard / 2, zC + 0.005));
  parts.push(board(innerW, S.middleBoard, S.depth - 0.012, 0, yLowerTop + S.middleBoard / 2, zC + 0.006));
  parts.push(board(0.012, S.middleBoard + 0.004, S.depth - 0.03, 0, yLowerTop + S.middleBoard / 2, zC));
  parts.push(board(innerW, S.rail, 0.03, 0, yUpperTop + S.rail / 2, zF - 0.015));
  parts.push(board(innerW, 0.02, S.depth - 0.03, 0, yUpperTop + 0.01, zC));
  if (conEncima) {
    // Con otro cuerpo encima, la cornisa sobra: una tapa plana hace de suelo del de arriba.
    parts.push(board(S.width + 0.01, S.top, S.depth + 0.006, 0, yRailTop + S.top / 2, zC));
  } else {
    // Tapa gruesa con vuelo y canto en dos pasos (moldura).
    parts.push(board(S.width + S.topOverhang * 2, S.top * 0.62, S.depth + S.topOverhang, 0, yRailTop + S.top * 0.69, zC + S.topOverhang / 2));
    parts.push(board(S.width + S.topOverhang * 1.3, S.top * 0.38, S.depth + S.topOverhang * 0.65, 0, yRailTop + S.top * 0.19, zC + S.topOverhang * 0.33));
  }
  // Listón bajo el travesaño.
  parts.push(board(innerW, 0.014, 0.016, 0, yUpperTop + 0.007, zF + 0.002));
  // Divisor central del nivel inferior.
  parts.push(board(0.05, S.lowerOpening, S.depth - 0.01, 0, yLowerFloor + S.lowerOpening / 2, zC + 0.005));
  // Fondo del estante: tablas verticales oscuras.
  const planks = 9;
  for (let i = 0; i < planks; i++) {
    const pw = innerW / planks;
    darkParts.push(board(pw - 0.002, yUpperTop - yLowerFloor + S.middleBoard, 0.018, -innerW / 2 + pw * (i + 0.5), yLowerFloor + (yUpperTop - yLowerFloor) / 2, zB + 0.009));
  }

  const frame = new THREE.Mesh(mergeGeometries(parts), woodMat);
  frame.castShadow = true;
  frame.receiveShadow = true;
  group.add(frame);
  const back = new THREE.Mesh(mergeGeometries(darkParts), woodDarkMat);
  back.receiveShadow = true;
  group.add(back);
  for (const g of [...parts, ...darkParts]) g.dispose();
  disposables.push(frame.geometry, back.geometry);

  // Placa en el travesaño con el nombre de la categoría. Brilla un poco cuando se
  // mira el estante desde el de al lado (para ir hasta él).
  const plaqueTex = plaqueTexture(rotulo.toUpperCase());
  const plaqueMat = new THREE.MeshStandardMaterial({
    map: plaqueTex.texture, metalness: 0.55, roughness: 0.42, emissive: 0xffffff, emissiveMap: plaqueTex.texture, emissiveIntensity: 0,
  });
  const plaqueW = Math.min(innerW - 0.1, plaqueTex.width);
  const plaque = new THREE.Mesh(new THREE.BoxGeometry(plaqueW, PLAQUE_H, 0.006), plaqueMat);
  plaque.position.set(0, yUpperTop + S.rail / 2, zF + 0.004);
  plaque.castShadow = true;
  group.add(plaque);
  disposables.push(plaque.geometry, plaqueMat, plaqueTex.texture);

  // ------------------------------------------------------------ libros
  const rand = mulberry32(seed);
  const bookGeos = [];
  const pageGeos = [];
  const slots = [];
  const spineInset = 0.018; // lomo algo metido respecto al frente

  const rows = [
    { name: 'arriba', x0: -innerW / 2, x1: innerW / 2, y: yUpperFloor, maxH: S.upperOpening - 0.03, minH: 0.27 },
    { name: 'abajo-izq', x0: -innerW / 2, x1: -0.025, y: yLowerFloor, maxH: S.lowerOpening - 0.03, minH: 0.26 },
    { name: 'abajo-der', x0: 0.025, x1: innerW / 2, y: yLowerFloor, maxH: S.lowerOpening - 0.03, minH: 0.26 },
  ];

  const matrix = new THREE.Matrix4();
  const rot = new THREE.Matrix4().makeRotationY(Math.PI / 2);
  const tmp = new THREE.Matrix4();
  const real = dims.T + 2 * BOARD; // grosor de un libro de verdad
  const realGap = 0.006;

  for (const row of rows) {
    const specs = placements.filter((p) => p.fila === row.name).sort((a, b) => a.at - b.at);
    const width = row.x1 - row.x0;
    let heightTrend = row.minH + rand() * (row.maxH - row.minH);

    // Llena de libros decorativos el tramo [x, hasta).
    const fill = (from, to) => {
      let x = from;
      while (x < to - 0.012) {
        if (rand() < 0.18) heightTrend = row.minH + rand() * (row.maxH - row.minH);
        const H = Math.min(row.maxH, Math.max(row.minH * 0.85, heightTrend + (rand() - 0.5) * 0.05));
        let T = 0.016 + Math.pow(rand(), 1.6) * 0.05;
        const W = Math.min(0.34, H * (0.62 + rand() * 0.12));
        // El último libro del tramo se ajusta al hueco que queda.
        if (x + T + 2 * BOARD > to - 0.002) T = to - 0.002 - x - 2 * BOARD;
        if (T < 0.012) break;
        const total = T + 2 * BOARD;
        if (rand() < 0.04 && x + total + 0.03 < to) x += 0.008 + rand() * 0.02; // pequeño hueco

        const style = randomSpineStyle(rand);
        const cell = spineAtlas.add(style);
        const geo = closedBookGeometry({ T, H, W }, cell);
        const cx = x + total / 2;
        const lean = (rand() - 0.5) * 0.02;
        const push = rand() * 0.012 + (rand() < 0.1 ? 0.025 : 0);
        matrix.makeTranslation(cx, row.y + H / 2 + SQUARE, zF - spineInset - 0.012 - push);
        tmp.makeRotationZ(lean);
        matrix.multiply(tmp).multiply(rot);
        geo.covers.applyMatrix4(matrix);
        geo.pages.applyMatrix4(matrix);
        bookGeos.push(geo.covers);
        pageGeos.push(geo.pages);
        x += total + 0.0015;
      }
      return x;
    };

    // Cada libro de verdad va cerca de su posición `at`, sin dejar nunca de
    // reservar sitio para los que faltan.
    let x = row.x0 + 0.004;
    specs.forEach((spec, k) => {
      const remaining = specs.length - k;
      const latest = row.x1 - 0.004 - remaining * (real + realGap);
      const target = Math.min(latest, Math.max(x, row.x0 + spec.at * width - real / 2));
      if (target - x > 0.014) x = Math.min(fill(x, target), target);
      const cx = x + real / 2 + 0.002;
      slots.push({ id: spec.id, fila: row.name, position: new THREE.Vector3(cx, row.y + dims.H / 2 + SQUARE, zF - spineInset - 0.012) });
      x += real + realGap;
    });
    fill(x, row.x1 - 0.004);
  }

  if (bookGeos.length) {
    const books = new THREE.Mesh(mergeGeometries(bookGeos), atlasMaterial);
    books.castShadow = true;
    books.receiveShadow = true;
    books.name = 'libros-decorativos';
    group.add(books);
    const edges = new THREE.Mesh(mergeGeometries(pageGeos), paperEdgeMaterial);
    edges.receiveShadow = true;
    group.add(edges);
    disposables.push(books.geometry, edges.geometry);
  }
  for (const g of [...bookGeos, ...pageGeos]) g.dispose();

  // Frente del estante para la mirada (invisible).
  const hitbox = new THREE.Mesh(
    new THREE.BoxGeometry(S.width, L.yTop, 0.06),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hitbox.position.set(0, L.yTop / 2, zF + 0.04);
  group.add(hitbox);
  disposables.push(hitbox.geometry, hitbox.material);

  return {
    group,
    slots,
    hitbox,
    plaque,
    levels: L,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

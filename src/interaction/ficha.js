// Ficha de catálogo: al mirar un libro que se puede abrir, aparece junto a él una
// tarjeta de papel con su nombre y una descripción breve, como las fichas de los
// antiguos ficheros de biblioteca. Al mirar el estante de al lado aparece otra
// tarjeta, el cartel del estante, con su categoría y cuántos libros tiene.
//
// No son etiquetas de página web: son objetos de la escena, con su papel, su
// sombra y su sitio junto al estante. Se giran hacia el usuario para leerlas.
import * as THREE from 'three';
import { clamp, createNoise2D, damp, ease, hashString, mulberry32 } from '../core/math.js';
import { SHELF, SHELF_STACK } from '../scene/bookshelf.js';

const W = 900; // píxeles del lienzo (incluye el margen de la sombra)
const H = 560;
const PAD = 34; // margen para la sombra
const CARD_W = 0.52; // metros de ancho del plano
const CARD_H = (CARD_W * H) / W;

const INK = 'rgba(38, 26, 17, 0.94)';
const INK_DIM = 'rgba(64, 48, 33, 0.78)';
const RED = 'rgba(122, 36, 24, 0.9)';
const SERIF = '"EB Garamond", Georgia, serif';
const FELL = '"IM Fell English", "EB Garamond", Georgia, serif';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Reparte un texto en varias líneas que quepan en un ancho dado. Si no cabe
// entero, la última línea termina en puntos suspensivos.
function wrap(ctx, text, maxWidth, maxLines) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = words[i];
      if (lines.length === maxLines) {
        let last = lines[maxLines - 1];
        while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, last.lastIndexOf(' ') > 0 ? last.lastIndexOf(' ') : -1);
        lines[maxLines - 1] = `${last.replace(/[,;:.]$/, '')}…`;
        return lines;
      }
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

function letterSpaced(ctx, text, x, y, spacing) {
  let cursor = x;
  for (const ch of text) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + spacing;
  }
  return cursor - spacing;
}

// Escribe un título achicando la letra hasta que quepa.
function fitTitle(ctx, text, x, y, maxWidth, size, font, spacing) {
  let s = size;
  for (; s > size * 0.55; s -= 2) {
    ctx.font = font(s);
    if (ctx.measureText(text).width + spacing * text.length <= maxWidth) break;
  }
  return letterSpaced(ctx, text, x, y, spacing * (s / size));
}

// Papel de la ficha: tono cálido, moteado, fibras y bordes algo gastados. Se
// generan unas pocas variantes una vez y cada ficha copia una de ellas.
const PAPELES = [];
function papel(seed) {
  const k = seed % 3;
  if (PAPELES[k]) return PAPELES[k];
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const x = PAD;
  const y = PAD;
  const w = W - 2 * PAD;
  const h = H - 2 * PAD;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = '#e8ddc2';
  roundRect(ctx, x, y, w, h, 7);
  ctx.fill();
  ctx.restore();

  // Moteado y fibras del papel.
  const noise = createNoise2D(311 + k * 97);
  const img = ctx.getImageData(x, y, w, h);
  for (let py = 0; py < h; py += 1) {
    for (let px = 0; px < w; px += 1) {
      const m = noise.fbm(px / w * 4, py / h * 5, 4);
      const f = noise.noise(px / w * 150, py / h * 220);
      const t = 1 + (m - 0.5) * 0.09 + (f - 0.5) * 0.05;
      const i = (py * w + px) * 4;
      img.data[i] *= t;
      img.data[i + 1] *= t;
      img.data[i + 2] *= t * 0.995;
    }
  }
  ctx.putImageData(img, x, y);

  // Manchitas de óxido y sombra en los bordes.
  const rand = mulberry32(k * 131 + 11);
  for (let i = 0; i < 18; i++) {
    const cx = x + rand() * w;
    const cy = y + rand() * h;
    const r = 3 + rand() * 9;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(150, 110, 60, ${0.05 + rand() * 0.07})`);
    g.addColorStop(1, 'rgba(150, 110, 60, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.save();
  roundRect(ctx, x, y, w, h, 7);
  ctx.clip();
  const edge = ctx.createLinearGradient(x, y, x, y + h);
  edge.addColorStop(0, 'rgba(90, 66, 38, 0.16)');
  edge.addColorStop(0.12, 'rgba(90, 66, 38, 0)');
  edge.addColorStop(0.88, 'rgba(90, 66, 38, 0)');
  edge.addColorStop(1, 'rgba(90, 66, 38, 0.2)');
  ctx.fillStyle = edge;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  PAPELES[k] = canvas;
  return canvas;
}

function nuevaTarjeta(seed) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(papel(seed), 0, 0);
  ctx.textBaseline = 'alphabetic';
  return { canvas, ctx };
}

function toTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

const LEFT = PAD + 46;
const RIGHT = W - PAD - 46;

// Ficha de un libro como textura.
function drawFicha(book) {
  return toTexture(dibujarFicha(book));
}

// Ficha de un libro en un canvas (lo usa también la vista previa del editor).
export function dibujarFicha(book) {
  const { canvas, ctx } = nuevaTarjeta(hashString(book.id));
  const width = RIGHT - LEFT;

  // Signatura, como en un fichero de verdad.
  ctx.fillStyle = INK_DIM;
  ctx.font = `28px ${SERIF}`;
  ctx.textAlign = 'right';
  ctx.fillText(book.signatura || '', RIGHT, PAD + 54);
  ctx.textAlign = 'left';

  // Nombre común.
  ctx.fillStyle = INK;
  fitTitle(ctx, book.titulo, LEFT, PAD + 84, width - 150, 66, (s) => `${s}px ${FELL}`, 1.5);

  // Nombre científico y familia (o, si no hay, la categoría).
  const sub = book.especie || book.cat.nombre;
  ctx.fillStyle = RED;
  ctx.font = `italic 36px ${SERIF}`;
  const subAncho = ctx.measureText(sub).width;
  ctx.fillText(sub, LEFT, PAD + 130);
  if (book.especie && book.familia) {
    ctx.fillStyle = INK_DIM;
    ctx.font = `28px ${SERIF}`;
    ctx.fillText(`· ${book.familia}`, LEFT + subAncho + 12, PAD + 130);
  }

  // Filete.
  ctx.strokeStyle = 'rgba(70, 50, 32, 0.4)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(LEFT, PAD + 152);
  ctx.lineTo(RIGHT, PAD + 152);
  ctx.stroke();

  // Descripción breve.
  ctx.fillStyle = INK;
  ctx.font = `38px ${SERIF}`;
  wrap(ctx, book.ficha || '', width, 3).forEach((linea, i) => ctx.fillText(linea, LEFT, PAD + 208 + i * 50));

  // Altitud (o la categoría), abajo a la izquierda.
  ctx.fillStyle = INK_DIM;
  ctx.font = `28px ${FELL}`;
  const pie = book.altitud ? `${book.altitud.min}–${book.altitud.max} m` : book.especie ? book.cat.nombre : `Tomo ${book.tomo}`;
  letterSpaced(ctx, pie, LEFT, H - PAD - 52, 1.2);

  // Aviso de que se puede tomar.
  ctx.fillStyle = 'rgba(96, 74, 50, 0.72)';
  ctx.font = `italic 29px ${SERIF}`;
  const aviso = 'clic para tomarlo';
  ctx.fillText(aviso, RIGHT - ctx.measureText(aviso).width, H - PAD - 52);
  return canvas;
}

// Cartel de un estante (se ve desde el estante vecino: al lado, encima o debajo).
function drawCartel(estante, rumbo) {
  return toTexture(dibujarCartel(estante, rumbo));
}

// `rumbo` dice dónde está ese estante respecto al actual: { x: -1 | 0 | 1,
// y: -1 | 0 | 1 }. También acepta un número (el lado), como antes.
export function dibujarCartel(estante, rumbo = 1) {
  const r = typeof rumbo === 'number' ? { x: rumbo, y: 0 } : { x: 0, y: 0, ...rumbo };
  const { canvas, ctx } = nuevaTarjeta(hashString(estante.rotulo) + 1);
  const width = RIGHT - LEFT;
  const cat = estante.categoria;

  ctx.fillStyle = INK_DIM;
  ctx.font = `28px ${FELL}`;
  ctx.textAlign = 'right';
  ctx.fillText(`ESTANTE ${estante.indice + 1}`, RIGHT, PAD + 54);
  ctx.textAlign = 'left';

  ctx.fillStyle = INK;
  fitTitle(ctx, estante.rotulo, LEFT, PAD + 108, width, 62, (s) => `${s}px ${FELL}`, 1.2);

  const n = estante.libros.length;
  const cuantos = n === 0 ? 'Sin libros todavía' : n === 1 ? '1 libro' : `${n} libros`;
  ctx.fillStyle = RED;
  ctx.font = `italic 40px ${SERIF}`;
  ctx.fillText(estante.partes > 1 ? `${cuantos} · parte ${estante.parte} de ${estante.partes}` : cuantos, LEFT, PAD + 160);

  ctx.strokeStyle = 'rgba(70, 50, 32, 0.4)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(LEFT, PAD + 186);
  ctx.lineTo(RIGHT, PAD + 186);
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.font = `40px ${SERIF}`;
  const texto = cat.descripcion || (n ? estante.libros.slice(0, 4).map((l) => l.titulo).join(', ') + (n > 4 ? '…' : '') : '');
  wrap(ctx, texto, width, 3).forEach((linea, i) => ctx.fillText(linea, LEFT, PAD + 242 + i * 52));

  ctx.fillStyle = 'rgba(96, 74, 50, 0.8)';
  ctx.font = `italic 33px ${SERIF}`;
  const aviso = r.y > 0 ? 'clic para subir ↑' : r.y < 0 ? 'clic para bajar ↓' : r.x < 0 ? '← clic para ir' : 'clic para ir →';
  const x = r.y === 0 && r.x < 0 ? LEFT : RIGHT - ctx.measureText(aviso).width;
  ctx.fillText(aviso, x, H - PAD - 52);
  return canvas;
}

export class Ficha {
  constructor(scene) {
    // Papel de verdad: recibe la luz de la sala, pero lleva algo de emisión propia
    // para que siga leyéndose dentro del estante, que está en sombra. Poca: con
    // más, al sol el papel pasaba de largo el umbral del resplandor y su propio
    // halo se comía el texto.
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(CARD_W, CARD_H),
      new THREE.MeshStandardMaterial({
        roughness: 0.95,
        metalness: 0,
        emissive: 0xffffff,
        emissiveIntensity: 0.26,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    this.mesh.name = 'ficha';
    this.mesh.visible = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
    this.textures = new Map();
    this.target = null; // lo que se está mostrando (libro o estante)
    this.t = 0; // 0 oculta, 1 visible
    this._pos = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.03, 0, -0.012));
  }

  texture(key, draw) {
    if (!this.textures.has(key)) this.textures.set(key, draw());
    return this.textures.get(key);
  }

  // Dibuja de antemano las fichas de unos libros (los del estante donde se empieza).
  async prepare(books, yieldTask) {
    for (const book of books) {
      this.texture(`libro:${book.content.id}:${book.content.version}`, () => drawFicha(book.content));
      if (yieldTask) await yieldTask();
    }
  }

  setTexture(texture) {
    this.mesh.material.map = texture;
    this.mesh.material.emissiveMap = texture;
    this.mesh.material.needsUpdate = true;
    this.mesh.visible = true;
  }

  show(book) {
    this.target = book ? { book } : null;
    if (!book) return;
    const c = book.content;
    this.setTexture(this.texture(`libro:${c.id}:${c.version}`, () => drawFicha(c)));
    // Aparece desde el libro y se coloca a su lado, hacia el centro del estante.
    this.place();
    this._pos.copy(this._target);
    this._pos.y -= 0.03;
  }

  // `estante` es el vecino; `rumbo` dice hacia dónde queda ({ x, y }).
  showShelf(estante, rumbo) {
    const r = typeof rumbo === 'number' ? { x: rumbo, y: 0 } : rumbo;
    this.target = { estante, rumbo: r };
    this.setTexture(this.texture(`estante:${estante.indice}:${estante.rotulo}:${estante.libros.length}:${r.x}:${r.y}`, () => drawCartel(estante, r)));
    this.place();
    this._pos.copy(this._target);
    this._pos.y -= 0.03;
  }

  hide() {
    this.target = null;
  }

  // Sitio de la tarjeta.
  place() {
    const t = this.target;
    if (t.book) {
      // Al lado del libro, hacia el centro de su estante y un poco por delante
      // (por delante también de la luz que realza el libro, para que no la
      // deslumbre). A la altura del libro, pero sin bajar tanto en el nivel de
      // abajo que quede volando sobre el suelo.
      const book = t.book;
      const side = book.shelfPosition.x > book.estanteX ? -1 : 1;
      this._target.set(
        book.shelfPosition.x + side * (CARD_W / 2 + 0.055),
        Math.max(book.shelfPosition.y + 0.04, 0.52),
        book.shelfPosition.z + 0.3,
      );
    } else {
      // Estante de al lado: en el pasillo, junto a su esquina más cercana, así
      // queda a mitad de camino y se lee sin tener que acercarse. Estante de
      // encima o de debajo: delante de él, flotando en el aire del pasillo.
      // El de encima o el de debajo: colgado de su borde más cercano, casi pegado
      // a su frente. Si se pusiera en medio del pasillo quedaría a un palmo de la
      // cara, enorme, y taparía el estante entero.
      const base = t.estante.y || 0;
      if (t.rumbo.y > 0) this._target.set(t.estante.x, base + 0.28, SHELF.frontZ + 0.18);
      else if (t.rumbo.y < 0) this._target.set(t.estante.x, base + SHELF_STACK - 0.28, SHELF.frontZ + 0.18);
      else this._target.set(t.estante.x - t.rumbo.x * (SHELF.width / 2 + 0.02), base + 1.02, SHELF.frontZ + 0.55);
    }
    return this._target;
  }

  // El cartel del estante se ve desde más lejos que una ficha: es más grande.
  get escala() {
    return this.target && this.target.estante ? 1.5 : 1;
  }

  update(dt, camera) {
    const visible = !!this.target;
    this.t = damp(this.t, visible ? 1 : 0, 9, dt);
    if (this.t < 0.004) {
      this.mesh.visible = false;
      return;
    }
    if (this.target) this.place();
    this._pos.lerp(this._target, 1 - Math.exp(-12 * dt));
    const e = ease.outCubic(Math.min(1, this.t));
    if (this.target) this._escala = this.escala;
    this.mesh.visible = true;
    this.mesh.position.copy(this._pos);
    this.mesh.position.y += (1 - e) * -0.012;
    // Tamaño aparente parejo: subido a la escalera el estante queda a un brazo de
    // distancia, y una tarjeta del tamaño de siempre taparía media pantalla.
    const cerca = clamp(this._pos.distanceTo(camera.position) / 1.5, 0.45, 1);
    this.mesh.scale.setScalar((0.965 + 0.035 * e) * (this._escala || 1) * cerca);
    // Mirando al usuario, con una pequeña inclinación para que no parezca un cartel.
    camera.getWorldQuaternion(this._quat);
    this.mesh.quaternion.copy(this._quat).multiply(this._tilt);
    this.mesh.material.opacity = e;
  }

  // Libera las tarjetas dibujadas (al reconstruir la biblioteca).
  clear() {
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
    this.target = null;
    this.t = 0;
    this.mesh.visible = false;
  }
}

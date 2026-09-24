// Maquetación de las páginas en canvas: papel envejecido, encabezados,
// capitulares, texto justificado, láminas y guardas marmoladas.
//
// Cada libro se compone a partir de sus datos, tenga lo que tenga: guarda,
// portadilla, lámina, una o varias páginas por sección, notas de campo y guarda
// final. Una sección corta se compone con letra grande; si no cabe en una
// página, sigue en las siguientes con letra de lectura.
import * as THREE from 'three';
import { createNoise2D, hashString, mulberry32 } from '../core/math.js';
import { drawAltitude, drawImagePlate, drawMarble, drawPlate } from './illustrations.js';
import { urlImagen } from '../datos/fuente.js';

export const PAGE_W = 1100;
export const PAGE_H = 1540;

const INK = 'rgba(40, 27, 18, 0.93)';
const RED = 'rgba(122, 36, 24, 0.92)';
const SERIF = '"EB Garamond", Georgia, serif';
const FELL = '"IM Fell English", "EB Garamond", Georgia, serif';

const LEAD = 1.42; // interlineado
const TAMANOS = [50, 48, 46, 44, 42]; // para que una sección quepa en una página
const TAMANO_LECTURA = 42; // secciones largas, repartidas en varias páginas
const ALTO_ALTITUD = 640;
const ALTO_VINETA = 380;
const ALTO_ORNAMENTO = 130;

let paperBase = null;

// Cede el control entre tareas pesadas sin depender de requestAnimationFrame.
const yieldTask = () => new Promise((resolve) => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => resolve();
  channel.port2.postMessage(0);
});

// Lienzo compartido solo para medir textos.
const medidor = document.createElement('canvas').getContext('2d');

// Papel base compartido: tono, moteado, fibras y manchas de humedad.
function getPaperBase() {
  if (paperBase) return paperBase;
  const low = document.createElement('canvas');
  low.width = PAGE_W / 2;
  low.height = PAGE_H / 2;
  const lctx = low.getContext('2d');
  const img = lctx.createImageData(low.width, low.height);
  const noise = createNoise2D(404);
  for (let y = 0; y < low.height; y++) {
    for (let x = 0; x < low.width; x++) {
      const u = x / low.width;
      const v = y / low.height;
      const m = noise.fbm(u * 5, v * 7, 5);
      const f = noise.noise(u * 180, v * 260);
      const t = 0.93 + (m - 0.5) * 0.12 + (f - 0.5) * 0.035;
      const i = (y * low.width + x) * 4;
      img.data[i] = 240 * t;
      img.data[i + 1] = 228 * t;
      img.data[i + 2] = 200 * t;
      img.data[i + 3] = 255;
    }
  }
  lctx.putImageData(img, 0, 0);

  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(low, 0, 0, PAGE_W, PAGE_H);

  const rand = mulberry32(77);
  // Manchas de óxido (foxing).
  for (let i = 0; i < 60; i++) {
    const x = rand() * PAGE_W;
    const y = rand() * PAGE_H;
    const r = 2 + Math.pow(rand(), 3) * 18;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(150, 100, 50, ${0.08 + rand() * 0.14})`);
    g.addColorStop(1, 'rgba(150, 100, 50, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Borde más oscuro por el paso del tiempo.
  const edge = ctx.createRadialGradient(PAGE_W / 2, PAGE_H / 2, PAGE_H * 0.35, PAGE_W / 2, PAGE_H / 2, PAGE_H * 0.78);
  edge.addColorStop(0, 'rgba(120, 85, 40, 0)');
  edge.addColorStop(1, 'rgba(120, 85, 40, 0.24)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  // Mancha de humedad tenue.
  const wx = PAGE_W * (0.6 + rand() * 0.3);
  const wy = PAGE_H * (0.75 + rand() * 0.2);
  const wr = PAGE_W * 0.3;
  const wg = ctx.createRadialGradient(wx, wy, wr * 0.55, wx, wy, wr);
  wg.addColorStop(0, 'rgba(160, 120, 70, 0.012)');
  wg.addColorStop(0.9, 'rgba(140, 100, 60, 0.035)');
  wg.addColorStop(1, 'rgba(140, 100, 60, 0)');
  ctx.fillStyle = wg;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  paperBase = canvas;
  return canvas;
}

function newPage(isRight) {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d');
  // Reflejo horizontal para que las páginas izquierdas no sean idénticas a las derechas.
  if (!isRight) {
    ctx.save();
    ctx.translate(PAGE_W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(getPaperBase(), 0, 0);
    ctx.restore();
  } else {
    ctx.drawImage(getPaperBase(), 0, 0);
  }
  // Sombra suave hacia el lomo.
  const g = isRight ? ctx.createLinearGradient(0, 0, PAGE_W * 0.14, 0) : ctx.createLinearGradient(PAGE_W, 0, PAGE_W * 0.86, 0);
  g.addColorStop(0, 'rgba(70, 45, 20, 0.22)');
  g.addColorStop(1, 'rgba(70, 45, 20, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  return { canvas, ctx };
}

function margins(isRight) {
  const inner = PAGE_W * 0.13;
  const outer = PAGE_W * 0.11;
  return { left: isRight ? inner : outer, right: isRight ? outer : inner, top: PAGE_H * 0.1, bottom: PAGE_H * 0.1 };
}

// Ancho útil del texto (igual en páginas pares e impares).
const ANCHO_TEXTO = PAGE_W - PAGE_W * 0.13 - PAGE_W * 0.11;
const TOP = PAGE_H * 0.1;
const BOTTOM = PAGE_H * 0.1;
// Cajas de texto: primera página de una sección (bajo el encabezado) y siguientes.
const CAJA_PRIMERA = { y: TOP + 192, h: PAGE_H - BOTTOM - (TOP + 182) - 30 };
const CAJA_SIGUIENTE = { y: TOP + 40, h: PAGE_H - BOTTOM - (TOP + 40) - 30 };

// Escribe una línea achicando la letra si no cabe en el ancho dado.
function fitText(ctx, text, x, y, maxWidth, size, font, { minSize = size * 0.5, spacing = 0 } = {}) {
  let s = size;
  for (; s > minSize; s -= 2) {
    ctx.font = font(s);
    ctx.letterSpacing = `${spacing * (s / size)}px`;
    if (ctx.measureText(text).width <= maxWidth) break;
  }
  ctx.fillText(text, x, y);
  ctx.letterSpacing = '0px';
  return s;
}

function runningHead(ctx, text, m) {
  ctx.save();
  ctx.fillStyle = 'rgba(40,27,18,0.75)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const cx = m.left + (PAGE_W - m.left - m.right) / 2;
  fitText(ctx, text.toUpperCase(), cx, m.top - 34, PAGE_W - m.left - m.right, 30, (s) => `${s}px ${FELL}`, { spacing: 6 });
  ctx.strokeStyle = 'rgba(40,27,18,0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(m.left, m.top - 14);
  ctx.lineTo(PAGE_W - m.right, m.top - 14);
  ctx.stroke();
  ctx.restore();
}

function pageNumber(ctx, n, m) {
  ctx.save();
  ctx.font = `32px ${SERIF}`;
  ctx.fillStyle = 'rgba(40,27,18,0.7)';
  ctx.textAlign = 'center';
  ctx.fillText(`— ${n} —`, m.left + (PAGE_W - m.left - m.right) / 2, PAGE_H - m.bottom + 70);
  ctx.restore();
}

function ornament(ctx, cx, cy, scale = 1, color = 'rgba(40,27,18,0.7)') {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-120, 0);
  ctx.bezierCurveTo(-80, -18, -40, 18, -14, 0);
  ctx.moveTo(120, 0);
  ctx.bezierCurveTo(80, -18, 40, 18, 14, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.bezierCurveTo(12, -6, 12, 6, 0, 14);
  ctx.bezierCurveTo(-12, 6, -12, -6, 0, -14);
  ctx.fill();
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(s * 128, 0, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function heading(ctx, text, m, y) {
  ctx.save();
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  const cx = m.left + (PAGE_W - m.left - m.right) / 2;
  fitText(ctx, text, cx, y, PAGE_W - m.left - m.right, 64, (s) => `${s}px ${FELL}`);
  ornament(ctx, cx, y + 40, 0.75);
  ctx.restore();
  return y + 92;
}

// ------------------------------------------------------------------ texto
// Parte los párrafos en líneas (con capitular en el primero). No dibuja nada:
// así se puede decidir antes en qué página va cada línea.
function componerLineas(texts, size, dropCap) {
  const ctx = medidor;
  const lineH = size * LEAD;
  ctx.font = `${size}px ${SERIF}`;
  const space = ctx.measureText(' ').width;
  const lines = [];
  let cap = null;
  texts.forEach((text, pi) => {
    const words = text.split(/\s+/).filter(Boolean);
    if (!words.length) return;
    let capLines = 0;
    let capWidth = 0;
    if (dropCap && pi === 0) {
      const letter = words[0][0];
      words[0] = words[0].slice(1);
      if (!words[0]) words.shift();
      const capSize = lineH * 2 + size * 0.78;
      ctx.font = `${capSize}px ${FELL}`;
      capWidth = ctx.measureText(letter).width + 14;
      ctx.font = `${size}px ${SERIF}`;
      cap = { letter, size: capSize };
      capLines = 3;
    }
    const indent = pi > 0 ? size * 1.4 : 0;
    let lineIndex = 0;
    let i = 0;
    while (i < words.length || (lineIndex === 0 && capLines)) {
      const offset = lineIndex < capLines ? capWidth : lineIndex === 0 ? indent : 0;
      const maxW = ANCHO_TEXTO - offset;
      const items = [];
      let width = 0;
      while (i < words.length) {
        let ww = ctx.measureText(words[i]).width;
        // Una palabra más larga que el renglón (una URL, por ejemplo) se corta.
        if (!items.length && ww > maxW) {
          let cut = words[i].length - 1;
          while (cut > 1 && ctx.measureText(words[i].slice(0, cut)).width > maxW) cut--;
          words.splice(i + 1, 0, words[i].slice(cut));
          words[i] = words[i].slice(0, cut);
          ww = ctx.measureText(words[i]).width;
        }
        const next = items.length ? width + space + ww : ww;
        if (next > maxW && items.length) break;
        items.push({ word: words[i], w: ww });
        width = next;
        i++;
      }
      lines.push({ items, width, maxW, offset, para: pi, first: lineIndex === 0, last: i >= words.length, space });
      lineIndex++;
      if (i >= words.length) break;
    }
  });
  return { lines, cap, size, lineH };
}

// Coloca las líneas en páginas. Devuelve [{ lineas: [{ line, y }], fin }].
function paginar(comp, primera, siguiente) {
  const { lines, size, lineH } = comp;
  const paginas = [];
  let caja = primera;
  let pagina = { lineas: [], caja };
  let y = caja.y + size;
  const limite = () => caja.y + caja.h;
  lines.forEach((line, k) => {
    // No dejar sola la primera línea de un párrafo al pie de la página.
    const huerfana = line.first && !line.last && y + lineH > limite();
    if ((y > limite() || huerfana) && pagina.lineas.length) {
      pagina.fin = y - size;
      paginas.push(pagina);
      caja = siguiente;
      pagina = { lineas: [], caja };
      y = caja.y + size;
    }
    pagina.lineas.push({ line, y });
    y += lineH;
    if (line.last && k < lines.length - 1) y += size * 0.35;
  });
  pagina.fin = y - size;
  paginas.push(pagina);
  return paginas;
}

function dibujarLineas(ctx, pagina, comp, x, capitular, seed) {
  const { size, lineH } = comp;
  const rand = mulberry32(seed);
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  if (capitular && comp.cap && pagina.lineas.length) {
    ctx.font = `${comp.cap.size}px ${FELL}`;
    ctx.fillStyle = RED;
    ctx.fillText(comp.cap.letter, x, pagina.lineas[0].y + lineH * 2 - 2);
  }
  ctx.font = `${size}px ${SERIF}`;
  ctx.fillStyle = INK;
  for (const { line, y } of pagina.lineas) {
    const gaps = line.items.length - 1;
    const extra = !line.last && gaps > 0 ? (line.maxW - line.width) / gaps : 0;
    let cx = x + line.offset;
    for (const item of line.items) {
      const jitter = (rand() - 0.5) * 0.8;
      ctx.globalAlpha = 0.9 + rand() * 0.1;
      ctx.fillText(item.word, cx, y + jitter);
      cx += item.w + line.space + extra;
    }
  }
  ctx.restore();
}

// ------------------------------------------------------------------ maquetación
const esHabitat = (titulo) => /h[aá]bitat|distribuci|d[oó]nde (vive|crece)|altitud/i.test(titulo);

// Plan de todas las caras del libro. Cara 0 y la última son guardas; las demás,
// páginas. Siempre hay un número par de caras (la última queda a la derecha).
export function maquetar(book) {
  if (book._maqueta) return book._maqueta;
  // Las láminas del libro, cada una en la página que le dio el bibliotecario. Las
  // que pidieron página propia van al principio, detrás del frontispicio; las de
  // una sección se colocan más abajo, al llegar a ella.
  const laminas = book.imagenes || [];
  const enTodas = laminas.find((i) => i.en === 'todas') || null;
  const unaEn = (en) => laminas.find((i) => i.en === en) || null;
  const propias = laminas.filter((i) => i.en === 'lamina');
  const caras = [
    { tipo: 'guarda' },
    { tipo: 'portada', imagen: (unaEn('portadilla') || enTodas)?.ruta || '' },
    { tipo: 'lamina', imagen: (propias[0] || enTodas)?.ruta || '' },
  ];
  for (const otra of propias.slice(1)) caras.push({ tipo: 'lamina', imagen: otra.ruta });
  const secciones = book.secciones;
  let conAltitud = book.altitud ? secciones.findIndex((s) => esHabitat(s.titulo)) : -1;
  if (book.altitud && conAltitud < 0 && secciones.length) conAltitud = 0;
  // La viñeta de la lámina va hacia el final del libro, donde haya sitio.
  const vinetaDesde = Math.floor(secciones.length * 0.6);
  let vineta = false;

  secciones.forEach((seccion, si) => {
    const extraFija = si === conAltitud ? ALTO_ALTITUD : 0;
    // ¿Cabe en una página con letra grande?
    let comp = null;
    let paginas = null;
    for (const size of TAMANOS) {
      const c = componerLineas(seccion.parrafos, size, true);
      const p = paginar(c, { y: CAJA_PRIMERA.y, h: CAJA_PRIMERA.h - extraFija }, CAJA_SIGUIENTE);
      if (p.length === 1) {
        comp = c;
        paginas = p;
        break;
      }
    }
    if (!comp) {
      comp = componerLineas(seccion.parrafos, TAMANO_LECTURA, true);
      paginas = paginar(comp, CAJA_PRIMERA, CAJA_SIGUIENTE);
    }
    paginas.forEach((pagina, pi) => {
      caras.push({ tipo: 'texto', titulo: pi === 0 ? seccion.titulo : null, seccion: si, comp, pagina, capitular: pi === 0, extras: [] });
    });

    // Al pie de la sección, si hay sitio (en la caja completa de la página: la
    // reservada para el cerro de altitudes también cuenta): el cerro, la lámina
    // que se puso en esta sección, o un adorno.
    const ultima = caras[caras.length - 1];
    const caja = paginas.length === 1 ? CAJA_PRIMERA : CAJA_SIGUIENTE;
    const libre = () => caja.y + caja.h - ultima.pagina.fin;
    const suya = unaEn(`seccion:${si}`);
    const conCerro = si === conAltitud;
    if (conCerro) {
      if (libre() >= ALTO_ALTITUD) ultima.extras.push({ tipo: 'altitud', y: Math.max(ultima.pagina.fin + 40, PAGE_H - BOTTOM - ALTO_ALTITUD) });
      else caras.push({ tipo: 'altitud' });
    }
    if (suya) {
      // Cabe al pie del texto o, si no, va en una página propia detrás: la lámina
      // no se mueve de sección ni desaparece.
      if (!conCerro && libre() >= ALTO_VINETA) ultima.extras.push({ tipo: 'vineta', y: Math.max(ultima.pagina.fin + 40, PAGE_H - BOTTOM - ALTO_VINETA + 20), imagen: suya.ruta });
      else caras.push({ tipo: 'lamina', imagen: suya.ruta, pie: seccion.titulo });
    } else if (conCerro) {
      /* el cerro ya ocupa el pie de esta sección */
    } else if (enTodas && !vineta && si >= vinetaDesde && libre() >= ALTO_VINETA) {
      vineta = true;
      ultima.extras.push({ tipo: 'vineta', y: Math.max(ultima.pagina.fin + 40, PAGE_H - BOTTOM - ALTO_VINETA + 20), imagen: enTodas.ruta });
    } else if (si === secciones.length - 1 && libre() >= ALTO_ORNAMENTO) {
      ultima.extras.push({ tipo: 'ornamento', y: Math.max(ultima.pagina.fin + 40, PAGE_H - BOTTOM - ALTO_ORNAMENTO) });
    }
  });
  if (book.altitud && !secciones.length) caras.push({ tipo: 'altitud' });

  // Notas de campo: renglones a mano, repartidos en las páginas que hagan falta.
  // El boceto del margen va en la primera.
  const enNotas = unaEn('notas');
  if (book.notas.length) {
    const renglones = renglonesNotas(book.notas);
    const porPagina = 7;
    for (let i = 0; i < renglones.length || i === 0; i += porPagina) {
      caras.push({
        tipo: 'notas',
        renglones: renglones.slice(i, i + porPagina),
        primera: i === 0,
        imagen: i === 0 ? (enNotas || enTodas)?.ruta || '' : '',
      });
    }
  } else if (enNotas) {
    // Sin notas de campo no hay dónde ponerla: se queda con una página propia.
    caras.push({ tipo: 'lamina', imagen: enNotas.ruta });
  }
  if (caras.length % 2 === 0) caras.push({ tipo: 'blanca' });
  caras.push({ tipo: 'guarda' });
  book._maqueta = caras;
  return caras;
}

// Cada nota ocupa uno o más renglones; entre notas queda un renglón libre.
function renglonesNotas(notas) {
  medidor.font = `italic 44px ${FELL}`;
  const ancho = PAGE_W - PAGE_W * 0.24 - 60;
  const out = [];
  notas.forEach((nota, n) => {
    const words = `· ${nota}`.split(/\s+/);
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (medidor.measureText(test).width > ancho && line) {
        out.push(line);
        line = `  ${w}`;
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
    if (n < notas.length - 1) out.push('');
  });
  return out;
}

export function contarCaras(book) {
  return maquetar(book).length;
}

// ------------------------------------------------------------------ caras
// Lámina del libro: la imagen subida o, si no hay, el dibujo procedural.
function lamina(ctx, book, img, x, y, w, h, seed) {
  if (img) drawImagePlate(ctx, img, x, y, w, h);
  else drawPlate(ctx, x, y, w, h, book.lamina || `generica:${book.id}`, seed);
}

function endpaper(book) {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d');
  drawMarble(ctx, PAGE_W, PAGE_H, book.cover.marble, hashString(book.id) % 997);
  // Ex libris.
  const w = 330;
  const h = 210;
  const x = PAGE_W / 2 - w / 2;
  const y = PAGE_H * 0.36;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x + 6, y + 8, w, h);
  ctx.fillStyle = '#efe5cc';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(40,27,18,0.7)';
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 14, y + 14, w - 28, h - 28);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 22, y + 22, w - 44, h - 44);
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.font = `italic 34px ${SERIF}`;
  ctx.fillText('Ex libris', PAGE_W / 2, y + 78);
  fitText(ctx, book.biblioteca?.nombre || 'Biblioteca', PAGE_W / 2, y + 128, w - 60, 36, (s) => `${s}px ${FELL}`);
  ornament(ctx, PAGE_W / 2, y + 162, 0.6);
  return canvas;
}

// Título grande de la portadilla: en una línea si cabe con letra grande; si no,
// en dos líneas partidas cerca de la mitad.
function drawTitle(ctx, text, cx, y, maxWidth) {
  const font = (s) => `${s}px ${FELL}`;
  for (let s = 150; s >= 96; s -= 6) {
    ctx.font = font(s);
    if (ctx.measureText(text).width <= maxWidth) {
      ctx.fillText(text, cx, y);
      return;
    }
  }
  const words = text.split(/\s+/);
  let best = [text, ''];
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const diff = Math.abs(a.length - b.length);
    if (diff < bestDiff) {
      best = [a, b];
      bestDiff = diff;
    }
  }
  let s = 110;
  for (; s > 56; s -= 4) {
    ctx.font = font(s);
    if (Math.max(ctx.measureText(best[0]).width, ctx.measureText(best[1]).width) <= maxWidth) break;
  }
  const lines = best.filter(Boolean);
  lines.forEach((line, i) => fitText(ctx, line, cx, y - 60 + i * s * 1.05, maxWidth, s, font));
}

function titlePage(book, img) {
  const { canvas, ctx } = newPage(true);
  const m = margins(true);
  const cx = m.left + (PAGE_W - m.left - m.right) / 2;
  const ancho = PAGE_W - m.left - m.right;
  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  fitText(ctx, book.cat.nombre.toUpperCase(), cx, PAGE_H * 0.17, ancho, 34, (s) => `${s}px ${FELL}`, { spacing: 8 });
  ctx.font = `28px ${SERIF}`;
  ctx.fillText(`TOMO ${book.tomo}`, cx, PAGE_H * 0.21);
  ornament(ctx, cx, PAGE_H * 0.26, 1);

  ctx.fillStyle = RED;
  drawTitle(ctx, book.titulo, cx, PAGE_H * 0.42, ancho);
  ctx.fillStyle = INK;
  if (book.especie) fitText(ctx, book.especie, cx, PAGE_H * 0.5, ancho, 58, (s) => `italic ${s}px ${SERIF}`);
  if (book.autor) {
    ctx.font = `36px ${SERIF}`;
    ctx.fillText(book.autor, cx, PAGE_H * 0.54);
  }
  if (book.familia) fitText(ctx, `FAMILIA ${book.familia.toUpperCase()}`, cx, PAGE_H * 0.6, ancho, 32, (s) => `${s}px ${FELL}`, { spacing: 5 });

  lamina(ctx, book, img, cx - 110, PAGE_H * 0.64, 220, 260, 7);

  ctx.fillStyle = INK;
  const pie = book.muestra ? `${book.cat.nombre} · contenido de muestra` : book.cat.nombre;
  fitText(ctx, pie, cx, PAGE_H * 0.86, ancho, 32, (s) => `italic ${s}px ${SERIF}`);
  fitText(ctx, `${(book.biblioteca?.nombre || 'Biblioteca virtual').toUpperCase()} · MMXXVI`, cx, PAGE_H * 0.9, ancho, 28, (s) => `${s}px ${FELL}`, { spacing: 4 });
  return canvas;
}

function platePage(book, img, face, cara = null) {
  const isRight = face % 2 === 1;
  const { canvas, ctx } = newPage(isRight);
  const m = margins(isRight);
  const x = m.left;
  const y = m.top;
  const w = PAGE_W - m.left - m.right;
  const h = PAGE_H - m.top - m.bottom - 90;
  ctx.strokeStyle = 'rgba(40,27,18,0.75)';
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, w, h);
  ctx.lineWidth = 1.2;
  ctx.strokeRect(x + 12, y + 12, w - 24, h - 24);
  lamina(ctx, book, img, x + 40, y + 40, w - 80, h - 80, 11);
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  const nombre = book.especie ? `${book.especie} ${book.autor}`.trim() : book.titulo;
  const nota = cara?.pie ? ` · ${cara.pie}` : img || book.lamina ? '' : ' · lámina decorativa';
  const pie = `Lám. ${book.tomo}. ${nombre}${nota}`;
  fitText(ctx, pie, x + w / 2, y + h + 58, w, 36, (s) => `italic ${s}px ${SERIF}`);
  pageNumber(ctx, face, m);
  return canvas;
}

function drawAltitudeBlock(ctx, book, m, y) {
  const w = PAGE_W - m.left - m.right;
  drawAltitude(ctx, m.left, y, w, 520, book.altitud.min, book.altitud.max);
  ctx.font = `italic 32px ${SERIF}`;
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  const fmt = (n) => n.toLocaleString('es');
  ctx.fillText(`Altitud aproximada: ${fmt(book.altitud.min)} – ${fmt(book.altitud.max)} m`, m.left + w / 2, y + 580);
}

function textPage(book, cara, face, imagenes) {
  const isRight = face % 2 === 1;
  const { canvas, ctx } = newPage(isRight);
  const m = margins(isRight);
  runningHead(ctx, isRight ? book.titulo : book.cat.nombre, m);
  if (cara.titulo) heading(ctx, cara.titulo, m, m.top + 90);
  dibujarLineas(ctx, cara.pagina, cara.comp, m.left, cara.capitular, hashString(`${book.id}:${face}`));
  for (const extra of cara.extras) {
    const w = PAGE_W - m.left - m.right;
    if (extra.tipo === 'altitud') drawAltitudeBlock(ctx, book, m, extra.y);
    else if (extra.tipo === 'vineta') lamina(ctx, book, laminaDe(imagenes, extra.imagen), m.left + w / 2 - 130, extra.y, 260, 300, 41);
    else if (extra.tipo === 'ornamento') ornament(ctx, m.left + w / 2, extra.y + 50, 1.1);
  }
  pageNumber(ctx, face, m);
  return canvas;
}

// Página solo con el cerro de altitudes (cuando no cupo junto al texto).
function altitudePage(book, face) {
  const isRight = face % 2 === 1;
  const { canvas, ctx } = newPage(isRight);
  const m = margins(isRight);
  runningHead(ctx, isRight ? book.titulo : book.cat.nombre, m);
  const y = heading(ctx, 'Altitud', m, m.top + 90);
  drawAltitudeBlock(ctx, book, m, y + 120);
  pageNumber(ctx, face, m);
  return canvas;
}

function notesPage(book, cara, face, img) {
  const isRight = face % 2 === 1;
  const { canvas, ctx } = newPage(isRight);
  const m = margins(isRight);
  runningHead(ctx, isRight ? book.titulo : book.cat.nombre, m);
  const y = heading(ctx, cara.primera ? 'Notas de campo' : 'Notas de campo (cont.)', m, m.top + 90);
  const rand = mulberry32(hashString(book.id) + face);
  const left = m.left + 10;
  const width = PAGE_W - m.left - m.right - 20;
  // Renglones tenues.
  ctx.strokeStyle = 'rgba(90,110,140,0.18)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 9; i++) {
    const ly = y + 60 + i * 64;
    ctx.beginPath();
    ctx.moveTo(left, ly);
    ctx.lineTo(left + width, ly);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(58, 38, 28, 0.88)';
  ctx.textAlign = 'left';
  cara.renglones.forEach((line, i) => {
    if (!line) return;
    ctx.save();
    ctx.translate(left + 6 + rand() * 10, y + 52 + i * 64);
    ctx.rotate((rand() - 0.5) * 0.02);
    ctx.font = `italic 44px ${FELL}`;
    ctx.fillText(line, 0, 0);
    ctx.restore();
  });
  if (cara.primera) {
    // Pequeño boceto.
    ctx.save();
    ctx.globalAlpha = 0.85;
    lamina(ctx, book, img, PAGE_W - m.right - 300, PAGE_H - m.bottom - 520, 250, 330, 23);
    ctx.restore();
    if (book.muestra) colophon(ctx, m);
  }
  pageNumber(ctx, face, m);
  return canvas;
}

function colophon(ctx, m) {
  ctx.font = `italic 28px ${SERIF}`;
  ctx.fillStyle = 'rgba(40,27,18,0.72)';
  ctx.textAlign = 'left';
  const lines = ['Textos de muestra para el prototipo.', 'Verifique los datos con fuentes', 'especializadas antes de publicar.'];
  lines.forEach((l, i) => ctx.fillText(l, m.left, PAGE_H - m.bottom - 90 + i * 36));
}

function blankPage(book, face) {
  const isRight = face % 2 === 1;
  const { canvas, ctx } = newPage(isRight);
  const m = margins(isRight);
  ornament(ctx, m.left + (PAGE_W - m.left - m.right) / 2, PAGE_H * 0.46, 0.8, 'rgba(40,27,18,0.35)');
  if (book.muestra && !book.notas.length) colophon(ctx, m);
  return canvas;
}

// La lámina que va en un sitio, ya cargada (null si no hay o no se pudo cargar).
const laminaDe = (imagenes, ruta) => (ruta && imagenes ? imagenes.get(ruta) || null : null);

// Dibuja una cara del libro en un canvas (lo usa también la vista previa del
// editor). `imagenes` es el mapa ruta → imagen que devuelve cargarImagenes().
export function dibujarCara(book, face, imagenes = null) {
  return drawFace(book, face, imagenes);
}

// ¿En qué cara quedó esta lámina? La vista previa del editor salta a esa página
// en cuanto se elige el sitio. -1 si no está en ninguna.
export function caraDeLamina(book, ruta) {
  if (!ruta) return -1;
  return maquetar(book).findIndex((c) => c.imagen === ruta || (c.extras || []).some((e) => e.imagen === ruta));
}

function drawFace(book, face, imagenes) {
  const caras = maquetar(book);
  const cara = caras[face];
  if (!cara) return newPage(face % 2 === 1).canvas;
  switch (cara.tipo) {
    case 'guarda':
      return endpaper(book);
    case 'portada':
      return titlePage(book, laminaDe(imagenes, cara.imagen));
    case 'lamina':
      return platePage(book, laminaDe(imagenes, cara.imagen), face, cara);
    case 'texto':
      return textPage(book, cara, face, imagenes);
    case 'altitud':
      return altitudePage(book, face);
    case 'notas':
      return notesPage(book, cara, face, laminaDe(imagenes, cara.imagen));
    default:
      return blankPage(book, face);
  }
}

// Carga una imagen para dibujarla en las páginas (null si no se pudo).
const imagenes = new Map();
export function cargarImagen(ruta) {
  const url = urlImagen(ruta);
  if (!url) return Promise.resolve(null);
  if (!imagenes.has(url)) {
    const img = new Image();
    // Las imágenes de otra dirección (base de datos) necesitan CORS para poder
    // usarse como textura.
    if (/^https?:/.test(url)) img.crossOrigin = 'anonymous';
    img.src = url;
    imagenes.set(url, img.decode().then(() => img).catch((err) => {
      console.warn(`No se pudo cargar la imagen ${url}:`, err.message || err);
      imagenes.delete(url);
      return null;
    }));
  }
  return imagenes.get(url);
}

// Todas las láminas de un libro: mapa de la ruta guardada a la imagen cargada.
export async function cargarImagenes(book) {
  const rutas = [...new Set((book.imagenes || []).map((i) => i.ruta).filter(Boolean))];
  const cargadas = await Promise.all(rutas.map((ruta) => cargarImagen(ruta)));
  return new Map(rutas.map((ruta, i) => [ruta, cargadas[i]]));
}

// Caché de texturas. Se generan las páginas cercanas a la que se lee y se
// liberan las lejanas: un libro largo no llena la memoria de la tarjeta gráfica.
export class PageLibrary {
  constructor(renderer) {
    this.renderer = renderer;
    this.cache = new Map();
    this.images = new Map();
    this.anisotropy = Math.min(12, renderer.capabilities.getMaxAnisotropy());
  }

  key(book, face) {
    return `${book.id}:${book.version}:${face}`;
  }

  faces(book) {
    return contarCaras(book);
  }

  texture(book, face) {
    const key = this.key(book, face);
    if (this.cache.has(key)) return this.cache.get(key);
    // La guarda final repite la del principio.
    const last = this.faces(book) - 1;
    const first = this.cache.get(this.key(book, 0));
    const canvas = face === last && first ? first.image : drawFace(book, face, this.images.get(book.id) || null);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    this.cache.set(key, tex);
    return tex;
  }

  // Prepara las primeras caras (y las láminas del libro) antes de abrirlo.
  async prepare(book) {
    this.images.set(book.id, await cargarImagenes(book));
    await this.around(book, 0);
  }

  // Deja listas las caras de la doble página `spread` y de sus vecinas, y
  // libera las que quedaron lejos.
  async around(book, spread) {
    const last = this.faces(book) - 1;
    const lo = Math.max(0, (spread - 1) * 2);
    const hi = Math.min(last, (spread + 1) * 2 + 1);
    for (const face of [0, ...Array.from({ length: hi - lo + 1 }, (_, i) => lo + i), last]) {
      if (this.cache.has(this.key(book, face))) continue;
      const tex = this.texture(book, face);
      this.renderer.initTexture(tex);
      await yieldTask();
    }
    const keep = (face) => face === 0 || face === last || (face >= (spread - 2) * 2 && face <= (spread + 2) * 2 + 1);
    const prefix = `${book.id}:${book.version}:`;
    for (const [key, tex] of this.cache) {
      if (!key.startsWith(prefix)) continue;
      const face = Number(key.slice(prefix.length));
      if (!keep(face)) {
        tex.dispose();
        this.cache.delete(key);
      }
    }
  }

  release(book) {
    for (const [key, tex] of this.cache) {
      if (key.startsWith(`${book.id}:`)) {
        tex.dispose();
        this.cache.delete(key);
      }
    }
    this.images.delete(book.id);
  }
}

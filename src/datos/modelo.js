// Modelo de datos de la biblioteca. Este formato es el contrato entre la escena y
// el lugar donde se guarda el contenido: hoy un archivo del proyecto
// (datos/biblioteca.json), mañana una base de datos. Mientras la fuente entregue
// categorías y libros con estos campos, la biblioteca se arma y se ordena sola.
//
// Categoría
//   id           identificador único sin espacios ("arboles-nativos")
//   nombre       lo que se lee en la placa del estante
//   codigo       letra de las signaturas (A, B, C…); si falta se asigna sola
//   descripcion  opcional: aparece en el cartel del estante
//   orden        opcional: posición del estante en la sala (si falta, alfabético)
//   columna      opcional: en qué columna de la pared va su estante (0 = la primera)
//   nivel        opcional: 0 = al nivel del piso, 1 = encima del de abajo, 2…
//
// Biblioteca
//   nombre, lema
//   disposicion  { niveles, modo }: hasta cuántos estantes se apilan en una
//                columna y cómo se reparten solos los que no tienen sitio fijo
//                ("columnas" = apilar primero; "filas" = extenderse primero)
//
// Libro
//   id, categoria (id de su categoría), titulo              obligatorios
//   ficha        descripción breve (2 o 3 líneas) que aparece al mirarlo
//   especie, autor, familia   nombre científico, su autor y la familia
//   altitud      { min, max } en metros: dibuja el cerro con la franja
//   secciones    [{ titulo, texto }]: cada una empieza en página nueva y cada
//                línea del texto es un párrafo
//   notas        ["…"]: notas de campo, en la última página
//   imagenes     [{ ruta, en }]: las láminas subidas y la página de cada una.
//                `en` es "portadilla", "lamina" (página propia), "seccion:<n>",
//                "notas" o "todas" (repartida, como en el formato viejo)
//   imagen       formato viejo: una sola lámina, repartida por todo el libro
//   lamina       dibujo incluido (cantuta, quenua, quishuar o muna)
//   portada      { tipo: "cuero" | "pergamino", color: "#rrggbb", etiqueta?, marmol? }
//   signatura    código de ubicación; si falta se calcula (A-101, A-102…)
//   orden        opcional: fuerza la posición dentro de su categoría
//   muestra      true si es contenido de ejemplo sin verificar
//   creado, actualizado   fechas ISO; las pone quien guarda
//
// Todo lo que no es obligatorio puede faltar: aquí se completan los valores por
// defecto y se calculan los derivados que usa la escena (colores de la tapa,
// párrafos, tomo…).
import { hashString, mulberry32 } from '../core/math.js';

export const FORMATO = 1;

export const LIMITES = {
  titulo: 60,
  ficha: 140, // lo que cabe en tres líneas de la ficha de catálogo
  tituloSeccion: 40,
  altitud: 7000,
  niveles: 3, // estantes apilados en una columna (más arriba ya no se alcanza)
  columnas: 40,
};

// Disposición de la pared de estantes. `niveles` es cuántos se pueden apilar;
// `modo` dice por dónde se van llenando los huecos libres.
export const DISPOSICION = { niveles: 2, modo: 'columnas' };
export const MODOS = [
  { id: 'columnas', nombre: 'Apilar primero', ayuda: 'Se llena una columna de abajo arriba y recién entonces se abre otra al lado.' },
  { id: 'filas', nombre: 'Extender primero', ayuda: 'Se ocupa toda la fila de abajo y recién entonces se empieza a apilar.' },
];

// Colores de encuadernación con aspecto de época.
export const COLORES_CUERO = ['#5c1e1a', '#583a22', '#2c3a2a', '#3e2a1e', '#6a4a2c', '#2e3444', '#4a2436', '#1f2b26', '#70522f', '#3a3228'];
export const COLORES_PERGAMINO = ['#d8c8a4', '#cdb892', '#c2ae88', '#e0d0ae', '#b8a47e'];
const ETIQUETAS = ['#1a1614', '#1e2a20', '#461a14', '#242030', '#161e1a'];
const MARMOLES = [
  ['#7a2a24', '#d9b36a', '#2d3a4a'],
  ['#4e6b4a', '#caa66a', '#6e3b25'],
  ['#b5652c', '#e8d9b0', '#3d4a3a'],
  ['#56704f', '#e2d3a8', '#8a4a3a'],
  ['#2f4a6b', '#d8c59a', '#8c3b2e'],
  ['#6b4e2f', '#e3d2a4', '#34503f'],
  ['#5a2f4a', '#d9bf8c', '#3a5566'],
  ['#3d5a5a', '#e0caa0', '#7a3a2a'],
];

export const SECCIONES_SUGERIDAS = ['Descripción', 'Hábitat', 'Usos y saberes', 'Curiosidades', 'Conservación'];

// ------------------------------------------------------------------ utilidades
export function slug(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

// Identificador que no choca con los que ya existen: queñua, queñua-2…
export function idUnico(base, usados) {
  const raiz = slug(base) || 'libro';
  let id = raiz;
  for (let n = 2; usados.has(id); n++) id = `${raiz}-${n}`;
  return id;
}

export function romano(n) {
  const tabla = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let resto = Math.max(1, Math.floor(n));
  let out = '';
  for (const [valor, letra] of tabla) {
    while (resto >= valor) {
      out += letra;
      resto -= valor;
    }
  }
  return out;
}

export function hexARgb(hex) {
  const h = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbAHex(rgb) {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

// Cada línea no vacía del texto es un párrafo.
export function parrafos(texto) {
  return String(texto || '')
    .split(/\r?\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const texto = (v) => (typeof v === 'string' ? v.trim() : '');
const numero = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const entero = (v, max) => {
  const n = numero(v);
  if (n === null) return null;
  return Math.min(max, Math.max(0, Math.round(n)));
};

export const comparador = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

// Primera frase útil de un texto, recortada para la ficha.
export function resumir(cadena, max = LIMITES.ficha) {
  const limpio = String(cadena || '').replace(/\s+/g, ' ').trim();
  if (limpio.length <= max) return limpio;
  const corte = limpio.slice(0, max - 1);
  return `${corte.slice(0, Math.max(corte.lastIndexOf(' '), max * 0.6)).replace(/[,;:.\s]+$/, '')}…`;
}

// ------------------------------------------------------------------ normalizar
export function normalizarCategoria(c) {
  return {
    id: texto(c.id) || slug(c.nombre) || 'categoria',
    nombre: texto(c.nombre) || 'Sin nombre',
    codigo: texto(c.codigo).toUpperCase().slice(0, 3),
    descripcion: texto(c.descripcion),
    orden: numero(c.orden),
    // Sitio elegido en la pared. Si falta uno de los dos, lo pone el bibliotecario
    // automático (ver src/datos/organizar.js).
    columna: entero(c.columna, LIMITES.columnas - 1),
    nivel: entero(c.nivel, LIMITES.niveles - 1),
  };
}

// Cómo se arma la pared de estantes.
export function normalizarDisposicion(d) {
  const niveles = entero(d?.niveles, LIMITES.niveles);
  return {
    niveles: Math.min(LIMITES.niveles, Math.max(1, niveles ?? DISPOSICION.niveles)),
    modo: MODOS.some((m) => m.id === d?.modo) ? d.modo : DISPOSICION.modo,
  };
}

// ------------------------------------------------------------------ láminas
// Sitios donde puede ir una lámina. Todos admiten una sola; «lámina a página
// completa» admite tantas como quiera el bibliotecario, una detrás de otra.
export const SITIOS_LAMINA = ['portadilla', 'lamina', 'notas', 'todas'];

function sitioLamina(en, secciones) {
  const s = texto(en);
  const m = /^seccion:(\d+)$/.exec(s);
  // Si la sección ya no existe (la borraron), la lámina no se pierde: se va a una
  // página propia.
  if (m) return Number(m[1]) < secciones ? `seccion:${Number(m[1])}` : 'lamina';
  return SITIOS_LAMINA.includes(s) ? s : 'lamina';
}

// Láminas del libro, cada una con su sitio. Entiende también el formato viejo
// (un solo campo `imagen`), que se reparte por el libro como se hacía antes.
export function laminasDe(l, secciones = (l.secciones || []).length) {
  const lista = Array.isArray(l.imagenes) ? l.imagenes : [];
  const ocupados = new Set();
  const out = [];
  for (const i of lista) {
    const ruta = texto(typeof i === 'string' ? i : i?.ruta);
    if (!ruta) continue;
    let en = sitioLamina(typeof i === 'string' ? '' : i?.en, secciones);
    // Cada sitio lleva una lámina; si hay dos, la segunda se va a página propia.
    if (en !== 'lamina' && ocupados.has(en)) en = 'lamina';
    if (en !== 'lamina') ocupados.add(en);
    out.push({ ruta, en });
  }
  if (!out.length && texto(l.imagen)) out.push({ ruta: texto(l.imagen), en: 'todas' });
  return out;
}

// Los sitios en palabras del bibliotecario, en el orden en que salen en el libro.
export function sitiosLamina(secciones = []) {
  return [
    { valor: 'portadilla', nombre: 'Portadilla, junto al título' },
    { valor: 'lamina', nombre: 'Lámina a página completa' },
    ...secciones.map((s, i) => ({ valor: `seccion:${i}`, nombre: `En «${texto(s?.titulo) || `sección ${i + 1}`}»` })),
    { valor: 'notas', nombre: 'Notas de campo' },
    { valor: 'todas', nombre: 'Repartida por todo el libro' },
  ];
}

// Tapa: la que se eligió o, si falta, una de época elegida según el id (así un
// libro nuevo siempre tiene la misma).
function tapa(libro) {
  const p = libro.portada || {};
  const rand = mulberry32(hashString(libro.id || libro.titulo || 'libro'));
  const tipo = p.tipo === 'pergamino' || p.tipo === 'cuero' ? p.tipo : rand() < 0.62 ? 'cuero' : 'pergamino';
  const paleta = tipo === 'cuero' ? COLORES_CUERO : COLORES_PERGAMINO;
  const base = hexARgb(p.color) || hexARgb(paleta[Math.floor(rand() * paleta.length)]);
  const etiqueta = hexARgb(p.etiqueta) || hexARgb(ETIQUETAS[Math.floor(rand() * ETIQUETAS.length)]);
  const marmol = Array.isArray(p.marmol) && p.marmol.length >= 2 && p.marmol.every((c) => hexARgb(c))
    ? p.marmol
    : MARMOLES[Math.floor(rand() * MARMOLES.length)];
  return { kind: tipo === 'cuero' ? 'leather' : 'vellum', base, label: etiqueta, marble: marmol };
}

// Libro tal como lo usa la escena. `cat` es su categoría ya normalizada.
export function normalizarLibro(l, cat) {
  const secciones = (Array.isArray(l.secciones) ? l.secciones : [])
    .map((s) => ({ titulo: texto(s.titulo) || 'Sin título', parrafos: parrafos(s.texto) }))
    .filter((s) => s.parrafos.length);
  const min = numero(l.altitud?.min);
  const max = numero(l.altitud?.max);
  const libro = {
    id: texto(l.id),
    categoria: texto(l.categoria),
    titulo: texto(l.titulo) || 'Sin título',
    especie: texto(l.especie),
    autor: texto(l.autor),
    familia: texto(l.familia),
    ficha: texto(l.ficha),
    signaturaGuardada: texto(l.signatura),
    altitud: min !== null && max !== null && max > min ? { min, max } : null,
    secciones,
    notas: (Array.isArray(l.notas) ? l.notas : []).map(texto).filter(Boolean),
    imagenes: laminasDe(l, secciones.length),
    lamina: texto(l.lamina),
    orden: numero(l.orden),
    muestra: !!l.muestra,
    actualizado: texto(l.actualizado),
    cat,
  };
  if (!libro.ficha) libro.ficha = resumir(secciones[0]?.parrafos[0] || '');
  libro.cover = tapa({ ...l, id: libro.id });
  // Cambia cuando cambia el contenido: sirve para no reutilizar texturas viejas.
  libro.version = hashString(JSON.stringify(l)).toString(36);
  return libro;
}

// ------------------------------------------------------------------ validar
// Devuelve una lista de problemas en palabras del usuario (vacía si está bien).
export function validarLibro(l, categorias) {
  const errores = [];
  const titulo = texto(l.titulo);
  if (!titulo) errores.push('El libro necesita un título.');
  else if (titulo.length > LIMITES.titulo) errores.push(`El título es muy largo (máximo ${LIMITES.titulo} letras).`);
  if (!categorias.some((c) => c.id === l.categoria)) errores.push('Elige la categoría (el estante) del libro.');
  if (texto(l.ficha).length > LIMITES.ficha) errores.push(`La ficha tiene más de ${LIMITES.ficha} letras: no cabría en la tarjeta.`);
  const min = numero(l.altitud?.min);
  const max = numero(l.altitud?.max);
  if ((min === null) !== (max === null)) errores.push('Para la altitud escribe el mínimo y el máximo, o deja los dos vacíos.');
  else if (min !== null && (min < 0 || max > LIMITES.altitud || min >= max)) errores.push(`La altitud debe ir de menor a mayor, entre 0 y ${LIMITES.altitud} m.`);
  (l.secciones || []).forEach((s, i) => {
    const t = texto(s.titulo);
    if (!t) errores.push(`La sección ${i + 1} no tiene título.`);
    else if (t.length > LIMITES.tituloSeccion) errores.push(`El título de la sección ${i + 1} es muy largo.`);
    if (!parrafos(s.texto).length) errores.push(`La sección ${i + 1}${t ? ` («${t}»)` : ''} está vacía.`);
  });
  const sitios = new Set();
  (Array.isArray(l.imagenes) ? l.imagenes : []).forEach((i, n) => {
    if (!texto(i?.ruta)) errores.push(`La lámina ${n + 1} se quedó sin imagen: elige una o quítala.`);
    const en = texto(i?.en);
    if (!en || en === 'lamina') return;
    if (sitios.has(en)) errores.push('Hay dos láminas en la misma página: elige otra página para una de las dos.');
    sitios.add(en);
  });
  if (l.portada?.color && !hexARgb(l.portada.color)) errores.push('El color de la tapa no es válido.');
  return errores;
}

export function validarCategoria(c, categorias, niveles = DISPOSICION.niveles) {
  const errores = [];
  const nombre = texto(c.nombre);
  if (!nombre) errores.push('La categoría necesita un nombre.');
  else if (nombre.length > 40) errores.push('El nombre es muy largo para la placa (máximo 40 letras).');
  const codigo = texto(c.codigo).toUpperCase();
  if (codigo && !/^[A-Z]{1,3}$/.test(codigo)) errores.push('El código son 1 a 3 letras, sin tildes (A, B, MED…).');
  if (codigo && categorias.some((o) => o.id !== c.id && texto(o.codigo).toUpperCase() === codigo)) errores.push(`El código ${codigo} ya lo usa otra categoría.`);
  if (categorias.some((o) => o.id !== c.id && comparador.compare(texto(o.nombre), nombre) === 0)) errores.push('Ya hay una categoría con ese nombre.');
  const columna = numero(c.columna);
  const nivel = numero(c.nivel);
  if ((columna === null) !== (nivel === null)) errores.push('Para fijar el sitio del estante hacen falta la columna y el nivel; deja los dos vacíos para que se acomode solo.');
  if (columna !== null && (columna < 0 || columna >= LIMITES.columnas)) errores.push(`La columna debe estar entre 1 y ${LIMITES.columnas}.`);
  if (nivel !== null && (nivel < 0 || nivel >= niveles)) errores.push(`Ese nivel no existe: la pared tiene ${niveles === 1 ? 'un solo nivel' : `${niveles} niveles`}.`);
  return errores;
}

// ------------------------------------------------------------------ guardar
// Completa lo que pone el sistema al guardar: id, signatura y fechas. Se usa
// antes de mandar el registro a la fuente (archivo local o base de datos).
export function prepararLibro(l, datos) {
  const ahora = new Date().toISOString();
  const libro = structuredClone(l);
  libro.titulo = texto(libro.titulo);
  libro.ficha = texto(libro.ficha);
  if (!libro.id) libro.id = idUnico(libro.titulo, new Set(datos.libros.map((o) => o.id)));
  if (!texto(libro.signatura)) libro.signatura = siguienteSignatura(libro, datos);
  libro.secciones = (libro.secciones || []).map((s) => ({ titulo: texto(s.titulo), texto: parrafos(s.texto).join('\n') }));
  libro.notas = (libro.notas || []).map(texto).filter(Boolean);
  libro.imagenes = laminasDe(libro, libro.secciones.length);
  delete libro.imagen; // el formato viejo: ahora cada lámina lleva su sitio
  const min = numero(libro.altitud?.min);
  const max = numero(libro.altitud?.max);
  libro.altitud = min !== null && max !== null ? { min, max } : null;
  libro.creado = libro.creado || ahora;
  libro.actualizado = ahora;
  return libro;
}

export function prepararCategoria(c, datos) {
  const cat = structuredClone(c);
  cat.nombre = texto(cat.nombre);
  cat.descripcion = texto(cat.descripcion);
  if (!cat.id) cat.id = idUnico(cat.nombre, new Set(datos.categorias.map((o) => o.id)));
  cat.codigo = texto(cat.codigo).toUpperCase() || codigoLibre(datos.categorias);
  cat.orden = numero(cat.orden);
  cat.columna = entero(cat.columna, LIMITES.columnas - 1);
  cat.nivel = entero(cat.nivel, LIMITES.niveles - 1);
  // El sitio fijo son las dos cosas: si falta una, el estante se acomoda solo.
  if (cat.columna === null || cat.nivel === null) {
    cat.columna = null;
    cat.nivel = null;
  }
  return cat;
}

// Primera letra que no usa ninguna categoría.
export function codigoLibre(categorias, excepto = null) {
  const usados = new Set(categorias.filter((c) => c.id !== excepto).map((c) => texto(c.codigo).toUpperCase()));
  for (let i = 0; i < 26; i++) {
    const letra = String.fromCharCode(65 + i);
    if (!usados.has(letra)) return letra;
  }
  for (let i = 0; ; i++) {
    const codigo = `${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26) % 26)}`;
    if (!usados.has(codigo)) return codigo;
  }
}

// Signatura nueva: el código de la categoría y el primer número libre desde 101.
export function siguienteSignatura(libro, datos) {
  const cat = datos.categorias.find((c) => c.id === libro.categoria);
  const codigo = texto(cat?.codigo).toUpperCase() || 'X';
  const usados = new Set(
    datos.libros
      .filter((o) => o.id !== libro.id && texto(o.signatura).toUpperCase().startsWith(`${codigo}-`))
      .map((o) => Number(texto(o.signatura).split('-')[1])),
  );
  let n = 101;
  while (usados.has(n)) n++;
  return `${codigo}-${n}`;
}

export function datosVacios() {
  return { formato: FORMATO, biblioteca: { nombre: 'Biblioteca', disposicion: { ...DISPOSICION } }, categorias: [], libros: [] };
}

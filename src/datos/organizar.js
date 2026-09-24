// El bibliotecario automático: reparte los libros en estantes y los estantes en
// la pared.
//
// - Cada categoría tiene su propio estante, con su nombre en la placa. Los
//   estantes se acoplan unos con otros formando una pared de columnas: uno al
//   lado de otro, o encima. Cada categoría puede elegir su sitio (`columna` y
//   `nivel`); a las que no lo eligen se les da el primer hueco libre, apilando o
//   extendiendo según `biblioteca.disposicion.modo`.
// - Dentro de un estante los libros van en orden alfabético (o en el `orden` que
//   se les haya dado): primero el nivel de arriba, de izquierda a derecha, y luego
//   el de abajo. Entre ellos quedan libros decorativos, como en una biblioteca real.
// - Si una categoría no cabe en un estante, sigue en el siguiente («· II»).
// - El tomo y la signatura que falten se calculan aquí.
import { comparador, codigoLibre, normalizarCategoria, normalizarDisposicion, normalizarLibro, romano } from './modelo.js';
import { hashString, mulberry32 } from '../core/math.js';

// Cuántos libros de verdad caben en cada nivel de un estante (dejando sitio para
// algunos decorativos entre ellos).
export const NIVELES = [
  { fila: 'arriba', max: 24 },
  { fila: 'abajo-izq', max: 12 },
  { fila: 'abajo-der', max: 12 },
];
export const LIBROS_POR_ESTANTE = NIVELES.reduce((s, n) => s + n.max, 0);

const SIN_CATEGORIA = { id: '_sin-categoria', nombre: 'Sin clasificar', codigo: 'Z', descripcion: 'Libros cuya categoría ya no existe.' };

const porOrden = (a, b) => (a.orden ?? Infinity) - (b.orden ?? Infinity);

// Nombre de cada nivel, para hablarle al usuario.
export function nombreNivel(nivel, niveles = nivel + 1) {
  if (niveles <= 1) return 'nivel único';
  if (nivel === 0) return 'nivel del piso';
  if (nivel === niveles - 1) return 'nivel de arriba';
  return `nivel ${nivel + 1}`;
}

// Recibe los datos tal como se guardan y devuelve la biblioteca lista para armar:
// { biblioteca, categorias, libros, estantes }.
export function organizar(guardados) {
  const biblioteca = { nombre: 'Biblioteca', ...(guardados.biblioteca || {}) };
  biblioteca.disposicion = normalizarDisposicion(biblioteca.disposicion);
  const categorias = (guardados.categorias || []).map(normalizarCategoria);
  // Códigos de signatura para las categorías que no tienen.
  for (const cat of categorias) {
    if (!cat.codigo) cat.codigo = codigoLibre(categorias, cat.id);
  }
  categorias.sort((a, b) => porOrden(a, b) || comparador.compare(a.nombre, b.nombre));

  const porId = new Map(categorias.map((c) => [c.id, c]));
  const huerfanos = (guardados.libros || []).some((l) => !porId.has(l.categoria));
  if (huerfanos) {
    const cat = normalizarCategoria(SIN_CATEGORIA);
    categorias.push(cat);
    porId.set(cat.id, cat);
  }

  const libros = [];
  const estantes = [];
  for (const cat of categorias) {
    const propios = (guardados.libros || [])
      .filter((l) => (porId.has(l.categoria) ? l.categoria : SIN_CATEGORIA.id) === cat.id)
      .map((l) => normalizarLibro(l, cat))
      .sort((a, b) => porOrden(a, b) || comparador.compare(a.titulo, b.titulo));

    // Tomo y signatura (la signatura guardada manda; si no hay, la siguiente libre).
    const usadas = new Set(propios.map((l) => l.signaturaGuardada.toUpperCase()).filter(Boolean));
    let siguiente = 101;
    propios.forEach((libro, i) => {
      libro.tomo = romano(i + 1);
      libro.posicion = i;
      libro.biblioteca = biblioteca;
      if (libro.signaturaGuardada) {
        libro.signatura = libro.signaturaGuardada;
      } else {
        while (usadas.has(`${cat.codigo}-${siguiente}`)) siguiente++;
        libro.signatura = `${cat.codigo}-${siguiente}`;
        usadas.add(libro.signatura);
      }
    });
    cat.cantidad = propios.length;
    libros.push(...propios);

    const partes = Math.max(1, Math.ceil(propios.length / LIBROS_POR_ESTANTE));
    for (let p = 0; p < partes; p++) {
      const grupo = propios.slice(p * LIBROS_POR_ESTANTE, (p + 1) * LIBROS_POR_ESTANTE);
      const estante = {
        indice: estantes.length,
        categoria: cat,
        parte: p + 1,
        partes,
        rotulo: partes > 1 ? `${cat.nombre} · ${romano(p + 1)}` : cat.nombre,
        libros: grupo,
        ubicaciones: repartir(grupo, hashString(`${cat.id}:${p}`)),
      };
      for (const libro of grupo) libro.estante = estante.indice;
      estantes.push(estante);
    }
  }

  // Una biblioteca sin categorías todavía muestra un estante vacío.
  if (!estantes.length) {
    const cat = normalizarCategoria({ id: '_vacia', nombre: 'Biblioteca vacía', codigo: 'A' });
    cat.cantidad = 0;
    categorias.push(cat);
    estantes.push({ indice: 0, categoria: cat, parte: 1, partes: 1, rotulo: cat.nombre, libros: [], ubicaciones: [] });
  }

  // Cada estante a su sitio en la pared y, ya colocados, se numeran de izquierda
  // a derecha y de abajo arriba (así «estante 1» es el primero que se ve).
  const rejilla = acomodar(estantes, biblioteca.disposicion);
  estantes.sort((a, b) => a.columna - b.columna || a.nivel - b.nivel);
  estantes.forEach((estante, i) => {
    estante.indice = i;
    for (const libro of estante.libros) libro.estante = i;
  });

  return {
    biblioteca,
    categorias,
    libros,
    estantes,
    rejilla,
  };
}

// ------------------------------------------------------------------ la pared
// Coloca cada estante en su columna y su nivel. Manda lo que eligió la categoría;
// lo que quede sin elegir se acomoda solo, sin dejar estantes en el aire.
function acomodar(estantes, disposicion) {
  const { niveles, modo } = disposicion;
  const ocupadas = new Map();
  const clave = (c, n) => `${c}:${n}`;
  const libre = (c, n) => c >= 0 && n >= 0 && n < niveles && !ocupadas.has(clave(c, n));
  const poner = (estante, c, n) => {
    estante.columna = c;
    estante.nivel = n;
    ocupadas.set(clave(c, n), estante);
  };

  // 1 · Sitios elegidos a mano. Si dos categorías piden el mismo, se queda la
  //     primera y la otra pasa al reparto automático (el editor lo avisa).
  for (const estante of estantes) {
    const { columna, nivel } = estante.categoria;
    if (estante.parte > 1 || columna === null || nivel === null) continue;
    if (libre(columna, nivel)) {
      poner(estante, columna, nivel);
      estante.fijo = true;
    } else {
      estante.desplazado = true;
    }
  }

  // 2 · El resto, al primer hueco libre. Cuando una categoría ocupa más de un
  //     estante, el siguiente se queda pegado al anterior si puede.
  const recorrido = modo === 'filas' ? porFilas(estantes.length, niveles) : porColumnas(niveles);
  let k = 0;
  for (const estante of estantes) {
    if (estante.columna !== undefined) continue;
    const previa = estante.parte > 1
      ? estantes.find((o) => o.categoria === estante.categoria && o.parte === estante.parte - 1)
      : null;
    if (previa && libre(previa.columna, previa.nivel + 1)) {
      poner(estante, previa.columna, previa.nivel + 1);
      continue;
    }
    let sitio = recorrido(k++);
    while (!libre(sitio.c, sitio.n)) sitio = recorrido(k++);
    poner(estante, sitio.c, sitio.n);
  }

  // 3 · Ningún estante puede quedar flotando: si el hueco de abajo está libre, baja.
  //     (Le pasa al que eligió un sitio encima de otro que después se movió.)
  for (const estante of [...estantes].sort((a, b) => a.columna - b.columna || a.nivel - b.nivel)) {
    while (estante.nivel > 0 && libre(estante.columna, estante.nivel - 1)) {
      ocupadas.delete(clave(estante.columna, estante.nivel));
      poner(estante, estante.columna, estante.nivel - 1);
      if (estante.fijo) estante.bajado = true;
    }
  }

  // 4 · Columnas vacías fuera: la pared no deja huecos de sala por el medio.
  const usadas = [...new Set(estantes.map((e) => e.columna))].sort((a, b) => a - b);
  const nueva = new Map(usadas.map((c, i) => [c, i]));
  for (const estante of estantes) estante.columna = nueva.get(estante.columna);

  return { columnas: usadas.length, niveles, modo };
}

// Orden en que se van probando los huecos libres.
const porColumnas = (niveles) => (k) => ({ c: Math.floor(k / niveles), n: k % niveles });
function porFilas(total, niveles) {
  const ancho = Math.max(1, Math.ceil(total / niveles));
  return (k) => (k < ancho * niveles
    ? { c: k % ancho, n: Math.floor(k / ancho) }
    : { c: ancho + Math.floor((k - ancho * niveles) / niveles), n: (k - ancho * niveles) % niveles });
}

// Huecos donde cabe un estante: al lado de la pared o encima de otro (nunca en
// el aire). `excluir` es el estante que se está moviendo, si hay uno.
export function huecosLibres(org, excluir = null) {
  const { columnas, niveles } = org.rejilla;
  const ocupadas = new Map();
  for (const e of org.estantes) if (e !== excluir) ocupadas.set(`${e.columna}:${e.nivel}`, e);
  const huecos = [];
  for (let c = 0; c <= columnas; c++) {
    for (let n = 0; n < niveles; n++) {
      if (ocupadas.has(`${c}:${n}`)) continue;
      if (n > 0 && !ocupadas.has(`${c}:${n - 1}`)) break; // quedaría flotando
      huecos.push({ columna: c, nivel: n, nuevaColumna: c === columnas });
    }
  }
  return huecos;
}

// Reparte los libros de un estante en sus niveles. Arriba va la mitad (es el
// nivel más cómodo); abajo, el resto, primero a la izquierda del divisor.
// `at` es la posición a lo largo del nivel (0 = izquierda, 1 = derecha).
function repartir(libros, seed) {
  const rand = mulberry32(seed);
  const n = libros.length;
  const arriba = Math.min(NIVELES[0].max, Math.ceil(n / 2));
  const resto = n - arriba;
  const izq = Math.min(NIVELES[1].max, Math.ceil(resto / 2));
  const cuentas = [arriba, izq, resto - izq];
  const ubicaciones = [];
  let k = 0;
  NIVELES.forEach((nivel, fila) => {
    const m = cuentas[fila];
    for (let i = 0; i < m; i++) {
      // Repartidos a lo largo del nivel, con un pequeño desorden.
      const at = (i + 0.5 + (rand() - 0.5) * 0.5) / m;
      ubicaciones.push({ libro: libros[k++], fila: nivel.fila, at: Math.min(0.97, Math.max(0.03, at)) });
    }
  });
  return ubicaciones;
}

// Primera signatura libre en una categoría, contando también las calculadas.
export function signaturaLibre(org, categoriaId, excluir = null) {
  const cat = org.categorias.find((c) => c.id === categoriaId);
  const codigo = cat?.codigo || 'X';
  const usados = new Set(
    org.libros
      .filter((l) => l.id !== excluir && l.signatura.toUpperCase().startsWith(`${codigo}-`))
      .map((l) => Number(l.signatura.split('-')[1])),
  );
  let n = 101;
  while (usados.has(n)) n++;
  return `${codigo}-${n}`;
}

// Dónde quedó un estante en la pared, en palabras.
export function describirSitio(org, estante) {
  if (!estante) return '';
  const { columnas, niveles } = org.rejilla;
  const columna = `columna ${estante.columna + 1} de ${columnas}`;
  if (niveles <= 1 || !org.estantes.some((e) => e.nivel > 0)) return columna;
  const debajo = org.estantes.find((e) => e.columna === estante.columna && e.nivel === estante.nivel - 1);
  const encima = debajo ? `, encima de «${debajo.rotulo}»` : '';
  return `${columna} · ${nombreNivel(estante.nivel, niveles)}${encima}`;
}

// Descripción de dónde quedó un libro, para el editor.
export function describirUbicacion(org, id) {
  const libro = org.libros.find((l) => l.id === id);
  if (!libro) return '';
  const estante = org.estantes[libro.estante];
  const ubic = estante.ubicaciones.find((u) => u.libro === libro);
  const nivel = ubic.fila === 'arriba' ? 'tabla de arriba' : ubic.fila === 'abajo-izq' ? 'tabla de abajo, a la izquierda' : 'tabla de abajo, a la derecha';
  return `Estante ${estante.indice + 1} de ${org.estantes.length} (${estante.rotulo}) · ${describirSitio(org, estante)} · ${nivel} · tomo ${libro.tomo} · ${libro.signatura}`;
}

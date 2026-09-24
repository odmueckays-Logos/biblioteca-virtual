// Prueba del bibliotecario automático: cómo quedan acoplados los estantes en la
// pared y dónde va cada lámina de un libro. Se ejecuta con
// `node tools/probar-disposicion.mjs` (no necesita la app: src/datos/ es
// JavaScript puro, sin Three.js).
import { huecosLibres, organizar } from '../src/datos/organizar.js';
import { laminasDe, prepararLibro, sitiosLamina, validarLibro } from '../src/datos/modelo.js';

let fallos = 0;
function comprobar(titulo, real, esperado) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  if (a === b) {
    console.log(`  ok · ${titulo}`);
  } else {
    console.log(`  MAL · ${titulo}\n       esperado: ${b}\n       obtenido: ${a}`);
    fallos++;
  }
}

// Datos de prueba: categorías con nombres A, B, C… y libros de relleno.
function datos({ cats, niveles = 2, modo = 'columnas', libros = {} }) {
  return {
    biblioteca: { nombre: 'Prueba', disposicion: { niveles, modo } },
    categorias: cats.map((c, i) => ({ id: c.id, nombre: c.id.toUpperCase(), codigo: String.fromCharCode(65 + i), orden: i + 1, columna: c.columna ?? null, nivel: c.nivel ?? null })),
    libros: Object.entries(libros).flatMap(([cat, n]) => Array.from({ length: n }, (_, k) => ({ id: `${cat}-${k}`, categoria: cat, titulo: `Libro ${String(k).padStart(3, '0')}` }))),
  };
}

// Sitio de cada estante: "rotulo@columna,nivel".
const pared = (org) => org.estantes.map((e) => `${e.rotulo}@${e.columna},${e.nivel}`);

const tres = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

console.log('Disposición de la pared');
comprobar('apilar primero: se llena la columna y luego se abre otra',
  pared(organizar(datos({ cats: tres }))),
  ['A@0,0', 'B@0,1', 'C@1,0']);

comprobar('extender primero: se ocupa la fila de abajo',
  pared(organizar(datos({ cats: tres, modo: 'filas' }))),
  ['A@0,0', 'C@0,1', 'B@1,0']);

comprobar('un solo nivel: todos en fila',
  pared(organizar(datos({ cats: tres, niveles: 1 }))),
  ['A@0,0', 'B@1,0', 'C@2,0']);

comprobar('tres niveles: una sola columna',
  pared(organizar(datos({ cats: tres, niveles: 3 }))),
  ['A@0,0', 'B@0,1', 'C@0,2']);

comprobar('sitio elegido: C encima de A, B donde toque',
  pared(organizar(datos({ cats: [{ id: 'a', columna: 0, nivel: 0 }, { id: 'b' }, { id: 'c', columna: 0, nivel: 1 }] }))),
  ['A@0,0', 'C@0,1', 'B@1,0']);

comprobar('nada flota: un estante sin nada debajo baja al piso',
  pared(organizar(datos({ cats: [{ id: 'a', columna: 1, nivel: 1 }], niveles: 3 }))),
  ['A@0,0']);

comprobar('el que se queda sin apoyo baja y queda avisado',
  organizar(datos({ cats: [{ id: 'a' }, { id: 'b', columna: 1, nivel: 1 }], niveles: 2 })).estantes.map((e) => `${e.rotulo}@${e.columna},${e.nivel}${e.bajado ? ' (bajó)' : ''}`),
  ['A@0,0', 'B@1,0 (bajó)']);

comprobar('dos categorías piden el mismo hueco: la segunda se corre',
  pared(organizar(datos({ cats: [{ id: 'a', columna: 0, nivel: 0 }, { id: 'b', columna: 0, nivel: 0 }] }))),
  ['A@0,0', 'B@0,1']);

comprobar('columnas vacías fuera: la pared no deja huecos por el medio',
  pared(organizar(datos({ cats: [{ id: 'a' }, { id: 'b', columna: 7, nivel: 0 }], niveles: 1 }))),
  ['A@0,0', 'B@1,0']);

comprobar('nivel que ya no existe: se acomoda solo',
  pared(organizar(datos({ cats: [{ id: 'a' }, { id: 'b', columna: 0, nivel: 1 }], niveles: 1 }))),
  ['A@0,0', 'B@1,0']);

// Una categoría de 60 libros no cabe en un estante (48): sigue en otro, encima.
comprobar('categoría en dos estantes: la segunda parte queda pegada',
  pared(organizar(datos({ cats: [{ id: 'a' }, { id: 'b' }], libros: { a: 60 } }))),
  ['A · I@0,0', 'A · II@0,1', 'B@1,0']);

// Huecos que se ofrecen en el editor.
const org = organizar(datos({ cats: tres }));
comprobar('huecos libres: encima de C y una columna nueva',
  huecosLibres(org).map((x) => `${x.columna},${x.nivel}${x.nuevaColumna ? ' (nueva)' : ''}`),
  ['1,1', '2,0 (nueva)']);

comprobar('sin niveles libres solo se ofrece la columna nueva',
  huecosLibres(organizar(datos({ cats: tres, niveles: 1 }))).map((x) => `${x.columna},${x.nivel}`),
  ['3,0']);

// La numeración de los estantes sigue a la pared: izquierda a derecha, abajo arriba.
comprobar('los estantes se numeran por columna y nivel',
  organizar(datos({ cats: tres })).estantes.map((e) => `${e.indice}:${e.rotulo}`),
  ['0:A', '1:B', '2:C']);

// Los libros saben en qué estante están, después de ordenar la pared.
const conLibros = organizar(datos({ cats: tres, libros: { a: 2, c: 1 } }));
comprobar('cada libro apunta a su estante',
  conLibros.libros.map((l) => `${l.titulo}→${conLibros.estantes[l.estante].rotulo}`),
  ['Libro 000→A', 'Libro 001→A', 'Libro 000→C']);

// ----------------------------------------------------------------- láminas
// Cada lámina se queda en la página donde la puso el bibliotecario.
const conSecciones = [{ titulo: 'Descripción', texto: 'x' }, { titulo: 'Hábitat', texto: 'y' }];

comprobar('el formato viejo (una imagen sola) se reparte por el libro',
  laminasDe({ imagen: 'datos/imagenes/a.png', secciones: conSecciones }),
  [{ ruta: 'datos/imagenes/a.png', en: 'todas' }]);

comprobar('cada lámina se queda en la página elegida',
  laminasDe({ imagenes: [{ ruta: 'a.png', en: 'portadilla' }, { ruta: 'b.png', en: 'seccion:1' }], secciones: conSecciones }),
  [{ ruta: 'a.png', en: 'portadilla' }, { ruta: 'b.png', en: 'seccion:1' }]);

comprobar('si la sección ya no existe, la lámina se va a una página propia',
  laminasDe({ imagenes: [{ ruta: 'a.png', en: 'seccion:7' }], secciones: conSecciones }),
  [{ ruta: 'a.png', en: 'lamina' }]);

comprobar('dos láminas en la misma página: la segunda se va a página propia',
  laminasDe({ imagenes: [{ ruta: 'a.png', en: 'notas' }, { ruta: 'b.png', en: 'notas' }], secciones: conSecciones }),
  [{ ruta: 'a.png', en: 'notas' }, { ruta: 'b.png', en: 'lamina' }]);

comprobar('las láminas sin imagen no cuentan',
  laminasDe({ imagenes: [{ ruta: '  ', en: 'portadilla' }, { ruta: 'b.png', en: 'portadilla' }], secciones: conSecciones }),
  [{ ruta: 'b.png', en: 'portadilla' }]);

comprobar('y el editor avisa si se repite la página',
  validarLibro({ titulo: 'T', categoria: 'a', imagenes: [{ ruta: 'a.png', en: 'notas' }, { ruta: 'b.png', en: 'notas' }] }, [{ id: 'a' }]),
  ['Hay dos láminas en la misma página: elige otra página para una de las dos.']);

comprobar('las páginas que se ofrecen siguen el orden del libro',
  sitiosLamina(conSecciones).map((o) => o.valor),
  ['portadilla', 'lamina', 'seccion:0', 'seccion:1', 'notas', 'todas']);

const preparado = prepararLibro(
  { id: 'l', categoria: 'a', titulo: 'T', signatura: 'A-101', imagen: 'vieja.png', secciones: conSecciones },
  { libros: [], categorias: [{ id: 'a', codigo: 'A' }] },
);
comprobar('al guardar, la imagen del formato viejo pasa a la lista',
  [preparado.imagenes, 'imagen' in preparado],
  [[{ ruta: 'vieja.png', en: 'todas' }], false]);

console.log(fallos ? `\n${fallos} prueba(s) mal` : '\nTodo bien');
process.exit(fallos ? 1 : 0);

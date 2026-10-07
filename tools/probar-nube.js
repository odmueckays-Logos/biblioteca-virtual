// Pruebas de la biblioteca compartida, sin abrir la app y sin internet: se
// levanta una nube de mentira (tools/nube-falsa.js) y se ejercita el almacén
// contra ella, que es el camino real de todos los cambios.
//
//   npm run probar-nube
//
// Lo que se comprueba es lo que prometimos: que la nube se siembra sola la
// primera vez, que lo que guarda uno le llega a los demás, que las fotos van al
// depósito compartido, que sin conexión no se puede editar (y se dice), y que el
// archivo local queda como caché para ver la biblioteca sin internet.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');

const { crearNubeFalsa } = require('./nube-falsa');
const { Almacen } = require('../electron/almacen');
const { Nube } = require('../electron/nube');

const MUESTRA = path.join(__dirname, '..', 'datos', 'muestra.json');
let hechas = 0;

async function prueba(nombre, fn) {
  await fn();
  hechas++;
  console.log(`  ok · ${nombre}`);
}

function carpetaNueva() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'biblioteca-nube-'));
}

async function main() {
  const falsa = await crearNubeFalsa();
  const carpeta = carpetaNueva();
  const nube = new Nube({ url: falsa.url, clave: 'clave-de-prueba' });
  const almacen = new Almacen(carpeta, MUESTRA, nube);

  await prueba('la nube vacía se siembra con lo que haya en la computadora', async () => {
    assert.equal(falsa.base.libros.length, 0);
    await almacen.arrancar(100000); // sin sondeo automático: aquí se llama a mano
    const muestra = JSON.parse(fs.readFileSync(MUESTRA, 'utf8'));
    assert.equal(falsa.base.libros.length, muestra.libros.length);
    assert.equal(falsa.base.categorias.length, muestra.categorias.length);
    assert.ok(nube.conectada);
  });

  await prueba('la segunda biblioteca que entra no pisa lo que ya hay', async () => {
    const otra = new Almacen(carpetaNueva(), MUESTRA, new Nube({ url: falsa.url, clave: 'otra' }));
    const antes = falsa.base.biblioteca.version;
    await otra.arrancar(100000);
    assert.equal(falsa.base.biblioteca.version, antes, 'no debería haber escrito nada');
    assert.equal(otra.leer().libros.length, falsa.base.libros.length);
    otra.cerrar();
  });

  await prueba('lo que guarda uno queda en la nube para todos', async () => {
    const libro = { ...almacen.leer().libros.find((l) => l.id === 'ceibo') };
    libro.ficha = 'Cambiado desde otra computadora.';
    await almacen.guardarLibro(libro);
    assert.equal(falsa.base.libros.find((l) => l.id === 'ceibo').ficha, 'Cambiado desde otra computadora.');
  });

  await prueba('la altitud va y vuelve entera (dos columnas en la base)', async () => {
    const fila = falsa.base.libros.find((l) => l.id === 'ceibo');
    assert.equal(fila.altitud_min, 300);
    assert.equal(fila.altitud_max, 1500);
    assert.equal(fila.altitud, undefined);
    const vuelta = (await nube.leer()).libros.find((l) => l.id === 'ceibo');
    assert.deepEqual(vuelta.altitud, { min: 300, max: 1500 });
  });

  await prueba('el cambio de otra persona llega solo y queda en la caché', async () => {
    await fetch(`${falsa.url}/__otro-usuario`, { method: 'POST' });
    let aviso = 0;
    almacen.alCambiar(() => { aviso++; });
    assert.ok(await almacen.sincronizar(), 'debería haber traído el cambio');
    assert.equal(aviso, 1, 'y haber avisado una sola vez');
    assert.ok(almacen.leer().libros.some((l) => l.titulo.includes('(editado por otro)')));
    assert.ok(fs.existsSync(path.join(carpeta, 'biblioteca.json')), 'la caché es el archivo de siempre');
  });

  await prueba('sin novedades no se baja nada', async () => {
    const antes = falsa.base.peticiones.length;
    assert.equal(await almacen.sincronizar(), false);
    assert.equal(falsa.base.peticiones.length - antes, 1, 'una sola consulta, la de la versión');
  });

  await prueba('las fotos suben al depósito compartido, no al disco', async () => {
    const ruta = await almacen.subirImagen('flor del cerro.JPG', Buffer.from([1, 2, 3, 4, 5]));
    assert.ok(ruta.startsWith(`${falsa.url}/storage/v1/object/public/laminas/`), ruta);
    assert.equal(falsa.base.subidas.length, 1);
    assert.equal(falsa.base.subidas[0].tipo, 'image/jpeg');
    assert.ok(!fs.existsSync(path.join(carpeta, 'imagenes')), 'no se guarda copia local');
  });

  await prueba('borrar un libro lo borra para todos', async () => {
    await almacen.eliminarLibro('bototillo');
    assert.ok(!falsa.base.libros.some((l) => l.id === 'bototillo'));
    assert.ok(!almacen.leer().libros.some((l) => l.id === 'bototillo'));
  });

  await prueba('una categoría con libros no se puede borrar (tampoco en la nube)', async () => {
    const antes = falsa.base.categorias.length;
    await assert.rejects(() => almacen.eliminarCategoria('bosque-seco-ecuatorial'), /todavía tiene/);
    assert.equal(falsa.base.categorias.length, antes);
  });

  await prueba('sin conexión se puede mirar pero no editar, y se dice por qué', async () => {
    falsa.cerrar();
    assert.equal(await almacen.sincronizar(), false, 'no rompe: se queda con la caché');
    assert.equal(nube.conectada, false);
    const libro = { ...almacen.leer().libros[0], ficha: 'A ver si cuela.' };
    await assert.rejects(() => almacen.guardarLibro(libro), /Sin conexión/);
    await assert.rejects(() => almacen.subirImagen('x.jpg', Buffer.from([1])), /Sin conexión/);
    // Y la biblioteca sigue viéndose entera, que es lo que importa.
    assert.ok(almacen.leer().libros.length > 5);
  });

  await prueba('un cambio rechazado por la nube no se guarda a medias', async () => {
    const guardado = almacen.leer().libros.find((l) => l.id === 'ceibo');
    assert.equal(guardado.ficha, 'Cambiado desde otra computadora.', 'el intento anterior no dejó rastro');
  });

  almacen.cerrar();
  fs.rmSync(carpeta, { recursive: true, force: true });
  console.log(`\n${hechas} pruebas, todo bien`);
}

main().catch((err) => {
  console.error('\nFALLÓ:', err.message);
  process.exit(1);
});

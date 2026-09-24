// Fuente de datos: de dónde sale el contenido de la biblioteca.
//
// La escena y el editor solo hablan con una fuente, nunca con un archivo o una
// base de datos directamente. Toda fuente cumple esta interfaz:
//
//   cargar()                → { formato, biblioteca, categorias, libros } (como se guardan)
//   guardarBiblioteca(datos) → nombre, lema y disposición de la pared
//   guardarLibro(libro)     → el libro guardado
//   eliminarLibro(id)
//   guardarCategoria(cat)   → la categoría guardada
//   eliminarCategoria(id)   (falla si todavía tiene libros)
//   subirImagen(archivo)    → ruta o URL para el campo `imagen` del libro
//   alCambiar(fn)           → llama a fn cuando el contenido cambia; devuelve
//                             una función para dejar de escuchar
//   editable                → true si se puede escribir
//
// Hoy hay dos: el archivo local del proyecto (app de escritorio, lectura y
// escritura) y el mismo archivo servido por HTTP (navegador, solo lectura). Para
// conectar una base de datos basta con escribir otra clase con estos métodos y
// devolverla en crearFuente(); ver «Conectar una base de datos» en el README.

const ARCHIVO = 'datos/biblioteca.json';

// Archivo local a través de la app de escritorio (electron/almacen.js).
class FuenteArchivoLocal {
  constructor(almacen) {
    this.almacen = almacen;
    this.editable = true;
    this.nombre = 'archivo local (datos/biblioteca.json)';
  }

  cargar() {
    return this.almacen.leer();
  }

  guardarBiblioteca(biblioteca) {
    return this.almacen.guardarBiblioteca(biblioteca);
  }

  guardarLibro(libro) {
    return this.almacen.guardarLibro(libro);
  }

  eliminarLibro(id) {
    return this.almacen.eliminarLibro(id);
  }

  guardarCategoria(categoria) {
    return this.almacen.guardarCategoria(categoria);
  }

  eliminarCategoria(id) {
    return this.almacen.eliminarCategoria(id);
  }

  async subirImagen(archivo) {
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    return this.almacen.subirImagen(archivo.name, bytes);
  }

  alCambiar(fn) {
    return this.almacen.alCambiar(fn);
  }
}

// El mismo archivo leído por HTTP (servidor de desarrollo): solo lectura.
class FuenteSoloLectura {
  constructor(url) {
    this.url = url;
    this.editable = false;
    this.nombre = `${url} (solo lectura)`;
  }

  async cargar() {
    const res = await fetch(this.url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`No se pudo leer ${this.url} (${res.status})`);
    return res.json();
  }

  alCambiar() {
    return () => {};
  }
}
for (const metodo of ['guardarBiblioteca', 'guardarLibro', 'eliminarLibro', 'guardarCategoria', 'eliminarCategoria', 'subirImagen']) {
  FuenteSoloLectura.prototype[metodo] = () => Promise.reject(new Error('Para editar hay que abrir la app de escritorio (npm start).'));
}

export function crearFuente() {
  if (window.almacen) return new FuenteArchivoLocal(window.almacen);
  return new FuenteSoloLectura(ARCHIVO);
}

// Convierte la ruta guardada en `imagen` en una dirección que se pueda cargar.
// Las rutas relativas son archivos del proyecto (datos/imagenes/…); las URL
// completas (https://…) vendrán de la base de datos.
export function urlImagen(ruta) {
  if (!ruta) return '';
  if (/^(https?:|data:|blob:)/.test(ruta)) return ruta;
  return ruta.replace(/^\/+/, '');
}

// Almacén: guarda el contenido de la biblioteca en datos/biblioteca.json y las
// imágenes en datos/imagenes/. Guarda registro por registro, comprueba lo mínimo
// que comprobaría una base de datos (identificadores únicos, que la categoría
// exista…) y avisa cuando el contenido cambia, también si alguien edita el
// archivo a mano.
//
// Si hay nube configurada (electron/nube.js), la biblioteca de verdad está allá
// y este archivo pasa a ser dos cosas: la **caché** con la que la sala se ve
// aunque no haya internet, y el **respaldo** de la última versión que se vio.
// Entonces el orden de cada cambio es: primero a la nube, y solo si la nube lo
// acepta, al archivo. Así nadie se queda con una edición que los demás no
// tienen. Sin conexión no se puede editar, y se dice con todas las letras.
//
// Las reglas de negocio (signaturas, validaciones con mensajes, orden) viven en
// src/datos/, del lado de la app: así valen igual con el archivo que con la nube.
const fs = require('node:fs');
const path = require('node:path');

const EXTENSIONES = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const TIPOS = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

class Almacen {
  // `muestra` es de dónde sale el contenido inicial la primera vez. Normalmente
  // está en la misma carpeta, pero en la app instalada los archivos del programa
  // son de solo lectura: entonces el contenido se guarda en la carpeta del usuario
  // y la muestra se lee de los archivos del programa.
  constructor(carpeta, muestra = null, nube = null) {
    this.carpeta = carpeta;
    this.archivo = path.join(carpeta, 'biblioteca.json');
    this.muestra = muestra || path.join(carpeta, 'muestra.json');
    this.imagenes = path.join(carpeta, 'imagenes');
    this.oyentes = new Set();
    this.oyentesEstado = new Set();
    this.ultimoEscrito = '';
    this.vigilando = null;
    this.nube = nube;
    this.sondeo = null;
  }

  get enNube() {
    return !!this.nube && this.nube.configurada;
  }

  // Lo que ven las ventanas: si hay nube, si está conectada y qué pasó.
  get estado() {
    return this.enNube ? this.nube.estado : { configurada: false, conectada: false, mensaje: 'biblioteca local', version: null };
  }

  // Si no hay archivo (primera vez, o se borró), se parte del contenido de muestra.
  asegurar() {
    if (fs.existsSync(this.archivo)) return;
    fs.mkdirSync(this.carpeta, { recursive: true });
    if (fs.existsSync(this.muestra)) fs.copyFileSync(this.muestra, this.archivo);
    else fs.writeFileSync(this.archivo, `${JSON.stringify({ formato: 1, biblioteca: { nombre: 'Biblioteca' }, categorias: [], libros: [] }, null, 2)}\n`);
  }

  leer() {
    this.asegurar();
    const texto = fs.readFileSync(this.archivo, 'utf8');
    let datos;
    try {
      datos = JSON.parse(texto);
    } catch (err) {
      throw new Error(`datos/biblioteca.json no es un JSON válido: ${err.message}`);
    }
    datos.categorias = Array.isArray(datos.categorias) ? datos.categorias : [];
    datos.libros = Array.isArray(datos.libros) ? datos.libros : [];
    return datos;
  }

  // Escritura atómica: primero a un archivo temporal y luego se reemplaza, así un
  // corte no deja el archivo a medias. La versión anterior queda en .bak.
  escribirArchivo(datos) {
    const texto = `${JSON.stringify(datos, null, 2)}\n`;
    const tmp = `${this.archivo}.tmp`;
    fs.mkdirSync(this.carpeta, { recursive: true });
    fs.writeFileSync(tmp, texto);
    if (fs.existsSync(this.archivo)) fs.copyFileSync(this.archivo, `${this.archivo}.bak`);
    fs.renameSync(tmp, this.archivo);
    this.ultimoEscrito = texto;
  }

  escribir(datos) {
    this.escribirArchivo(datos);
    this.avisar();
  }

  // ------------------------------------------------------------------- la nube

  // Arranca la sincronización: siembra la nube si está vacía, se trae lo que haya
  // y deja preguntando por la versión cada pocos segundos. Si no hay internet no
  // falla: se queda con la caché y lo sigue intentando.
  async arrancar(cada = 10000) {
    if (!this.enNube) return false;
    this.asegurar();
    try {
      if (await this.nube.sembrarSiVacia(this.leer())) this.avisarEstado();
    } catch (err) {
      this.nube.marcar(false, err.message);
    }
    await this.sincronizar(true);
    clearInterval(this.sondeo);
    this.sondeo = setInterval(() => this.sincronizar().catch(() => {}), cada);
    this.sondeo.unref?.();
    return true;
  }

  // Se trae de la nube lo que haya cambiado. Pregunta primero por el número de
  // versión —un entero, la consulta más barata que hay— y solo si cambió se baja
  // la biblioteca entera.
  async sincronizar(forzar = false) {
    if (!this.enNube) return false;
    const estabaConectada = this.nube.conectada;
    try {
      const version = await this.nube.consultarVersion();
      if (!estabaConectada) this.avisarEstado();
      if (!forzar && version !== null && version === this.versionLocal && fs.existsSync(this.archivo)) return false;
      const datos = await this.nube.leer();
      this.versionLocal = this.nube.version;
      if (`${JSON.stringify(datos, null, 2)}\n` === this.ultimoEscrito) return false; // ya era lo que teníamos
      this.escribirArchivo(datos);
      this.avisar();
      return true;
    } catch (err) {
      this.nube.marcar(false, err.message);
      if (estabaConectada) this.avisarEstado();
      return false;
    }
  }

  // Editar sin conexión no se permite a propósito: quedaría un cambio que los
  // demás nunca verían, y la siguiente sincronización lo borraría sin avisar.
  exigirConexion() {
    if (!this.enNube) return;
    if (!this.nube.conectada) {
      throw new Error(`Sin conexión con la nube, así que ahora no se puede editar: el cambio no les llegaría a los demás. (${this.nube.mensaje})`);
    }
  }

  // Nombre, lema y disposición de la pared (los campos que no son de un registro).
  async guardarBiblioteca(biblioteca) {
    if (!biblioteca || typeof biblioteca !== 'object') throw new Error('No hay nada que guardar.');
    this.exigirConexion();
    const datos = this.leer();
    datos.biblioteca = { ...(datos.biblioteca || {}), ...biblioteca };
    if (this.enNube) await this.nube.guardarBiblioteca(datos.biblioteca);
    this.escribir(datos);
    return datos.biblioteca;
  }

  // Las rutas de las láminas de un libro (la lista nueva y el campo viejo).
  static rutasDe(libro) {
    const lista = Array.isArray(libro?.imagenes) ? libro.imagenes : [];
    const rutas = lista.map((i) => (typeof i === 'string' ? i : i?.ruta)).filter((r) => typeof r === 'string' && r);
    if (typeof libro?.imagen === 'string' && libro.imagen) rutas.push(libro.imagen);
    return [...new Set(rutas)];
  }

  async guardarLibro(libro) {
    if (!libro || typeof libro.id !== 'string' || !libro.id) throw new Error('Falta el identificador del libro.');
    if (typeof libro.titulo !== 'string' || !libro.titulo.trim()) throw new Error('El libro necesita un título.');
    this.exigirConexion();
    const datos = this.leer();
    if (!datos.categorias.some((c) => c.id === libro.categoria)) throw new Error('La categoría del libro no existe.');
    const i = datos.libros.findIndex((l) => l.id === libro.id);
    const antes = i >= 0 ? Almacen.rutasDe(datos.libros[i]) : [];
    if (i >= 0) datos.libros[i] = libro;
    else datos.libros.push(libro);
    if (this.enNube) await this.nube.guardarLibro(libro);
    this.escribir(datos);
    // Las láminas que el libro ya no usa se borran del disco si no las usa nadie.
    const ahora = new Set(Almacen.rutasDe(libro));
    for (const ruta of antes) if (!ahora.has(ruta)) this.borrarImagenSiSobra(ruta, datos);
    return libro;
  }

  async eliminarLibro(id) {
    this.exigirConexion();
    const datos = this.leer();
    const libro = datos.libros.find((l) => l.id === id);
    if (!libro) throw new Error('Ese libro ya no existe.');
    datos.libros = datos.libros.filter((l) => l.id !== id);
    if (this.enNube) await this.nube.eliminarLibro(id);
    this.escribir(datos);
    for (const ruta of Almacen.rutasDe(libro)) this.borrarImagenSiSobra(ruta, datos);
  }

  async guardarCategoria(cat) {
    if (!cat || typeof cat.id !== 'string' || !cat.id) throw new Error('Falta el identificador de la categoría.');
    if (typeof cat.nombre !== 'string' || !cat.nombre.trim()) throw new Error('La categoría necesita un nombre.');
    this.exigirConexion();
    const datos = this.leer();
    const i = datos.categorias.findIndex((c) => c.id === cat.id);
    if (i >= 0) datos.categorias[i] = cat;
    else datos.categorias.push(cat);
    if (this.enNube) await this.nube.guardarCategoria(cat);
    this.escribir(datos);
    return cat;
  }

  async eliminarCategoria(id) {
    this.exigirConexion();
    const datos = this.leer();
    const libros = datos.libros.filter((l) => l.categoria === id).length;
    if (libros) throw new Error(`La categoría todavía tiene ${libros === 1 ? '1 libro' : `${libros} libros`}: muévelos o elimínalos antes.`);
    datos.categorias = datos.categorias.filter((c) => c.id !== id);
    if (this.enNube) await this.nube.eliminarCategoria(id);
    this.escribir(datos);
  }

  // Guarda una imagen subida y devuelve la ruta que va en la lámina del libro.
  // Con nube, la foto sube al depósito público y la ruta es su URL: así la ven
  // todos. Sin nube se queda en datos/imagenes/, que es solo de esta máquina.
  async subirImagen(nombre, bytes) {
    const ext = path.extname(String(nombre || '')).toLowerCase();
    if (!EXTENSIONES.has(ext)) throw new Error('La imagen debe ser JPG, PNG, WEBP o GIF.');
    if (!bytes || !bytes.length) throw new Error('La imagen está vacía.');
    if (bytes.length > 15 * 1024 * 1024) throw new Error('La imagen pesa demasiado (máximo 15 MB).');
    const base = path.basename(String(nombre), ext)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'imagen';
    const archivo = `${base}-${Date.now().toString(36)}${ext === '.jpeg' ? '.jpg' : ext}`;
    if (this.enNube) {
      this.exigirConexion();
      return this.nube.subirImagen(archivo, bytes, TIPOS[ext] || 'application/octet-stream');
    }
    fs.mkdirSync(this.imagenes, { recursive: true });
    fs.writeFileSync(path.join(this.imagenes, archivo), Buffer.from(bytes));
    return `datos/imagenes/${archivo}`;
  }

  // Cuando un libro cambia de láminas (o se elimina), las que suelta se borran si
  // ningún otro libro las usa. Solo se tocan imágenes que subió la app, dentro
  // de datos/imagenes/.
  borrarImagenSiSobra(ruta, datos) {
    if (!/^datos\/imagenes\/[^/\\]+$/.test(ruta)) return;
    if (datos.libros.some((l) => Almacen.rutasDe(l).includes(ruta))) return;
    const archivo = path.join(this.imagenes, path.basename(ruta));
    try {
      fs.unlinkSync(archivo);
    } catch {
      /* ya no estaba, o está en uso: no pasa nada */
    }
  }

  alCambiar(fn) {
    this.oyentes.add(fn);
    return () => this.oyentes.delete(fn);
  }

  avisar() {
    for (const fn of this.oyentes) fn();
  }

  // Lo mismo para el estado de la nube (conectada o no), que las ventanas
  // muestran en un rincón.
  alCambiarEstado(fn) {
    this.oyentesEstado.add(fn);
    return () => this.oyentesEstado.delete(fn);
  }

  avisarEstado() {
    for (const fn of this.oyentesEstado) fn(this.estado);
  }

  // Avisa también si el archivo se edita a mano (o lo cambia otro programa).
  vigilar() {
    if (this.vigilando) return;
    this.asegurar();
    let espera = null;
    this.vigilando = fs.watch(this.carpeta, (_evento, nombre) => {
      if (nombre !== 'biblioteca.json') return;
      clearTimeout(espera);
      espera = setTimeout(() => {
        try {
          const texto = fs.readFileSync(this.archivo, 'utf8');
          if (texto === this.ultimoEscrito) return; // es lo que se acaba de guardar
          JSON.parse(texto);
          this.ultimoEscrito = texto;
          this.avisar();
        } catch {
          /* archivo a medio escribir o con un error: se espera al siguiente cambio */
        }
      }, 300);
    });
  }

  cerrar() {
    if (this.vigilando) this.vigilando.close();
    this.vigilando = null;
    clearInterval(this.sondeo);
    this.sondeo = null;
  }
}

module.exports = { Almacen };

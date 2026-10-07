// La biblioteca en la nube.
//
// Habla con una base PostgreSQL de Supabase por HTTP (PostgREST) y con su
// depósito de archivos. No hace falta ninguna librería: son peticiones `fetch`
// con dos cabeceras. El esquema, los permisos y los respaldos están en
// datos/esquema.sql, que se pega una sola vez en el panel de Supabase.
//
// Vive en el proceso principal, no en las ventanas, por tres razones: las dos
// ventanas (escena y editor) se sincronizan por el mismo camino, el archivo
// local sigue siendo la caché —así la biblioteca se ve aunque no haya
// internet— y nada de esto depende de que haya una ventana abierta.
//
// Cómo se entera todo el mundo de un cambio: la tabla `biblioteca` tiene un
// número de versión que sube con cada edición (lo hace un disparador en la base,
// no el programa). Preguntar por ese número es la consulta más barata posible,
// así que se pregunta cada pocos segundos; cuando cambia, se recarga entera.
// Es más simple y más robusto que mantener un socket abierto, y para una
// biblioteca que se edita de vez en cuando, unos segundos de retraso no se
// notan.

const TIEMPO = 12000; // ms antes de dar una petición por perdida

// Un libro de la biblioteca, tal como va en la base.
function aFila(libro) {
  const { altitud, imagen, imagenes, ...resto } = libro;
  return {
    ...resto,
    altitud_min: altitud && Number.isFinite(altitud.min) ? altitud.min : null,
    altitud_max: altitud && Number.isFinite(altitud.max) ? altitud.max : null,
    // El campo viejo (una sola imagen) se guarda ya convertido en lista.
    imagenes: Array.isArray(imagenes) && imagenes.length
      ? imagenes
      : imagen ? [{ ruta: imagen, en: 'todas' }] : [],
    portada: libro.portada || {},
    secciones: libro.secciones || [],
    notas: libro.notas || [],
  };
}

// Y de vuelta, tal como lo espera la app.
function aLibro(fila) {
  const { altitud_min: min, altitud_max: max, ...resto } = fila;
  const libro = { ...resto };
  if (Number.isFinite(min) && Number.isFinite(max)) libro.altitud = { min, max };
  return libro;
}

class Nube {
  constructor({ url, clave, bucket = 'laminas' } = {}) {
    this.url = String(url || '').replace(/\/+$/, '');
    this.clave = String(clave || '');
    this.bucket = bucket;
    this.conectada = false;
    this.mensaje = this.configurada ? 'sin conectar todavía' : 'no configurada';
    this.version = null;
  }

  get configurada() {
    return !!this.url && !!this.clave;
  }

  get estado() {
    return { configurada: this.configurada, conectada: this.conectada, mensaje: this.mensaje, version: this.version };
  }

  async pedir(camino, opciones = {}) {
    if (!this.configurada) throw new Error('La nube no está configurada.');
    const res = await fetch(`${this.url}${camino}`, {
      ...opciones,
      signal: AbortSignal.timeout(TIEMPO),
      headers: {
        apikey: this.clave,
        authorization: `Bearer ${this.clave}`,
        ...(opciones.body && !(opciones.body instanceof Uint8Array) ? { 'content-type': 'application/json' } : {}),
        ...opciones.headers,
      },
    }).catch((err) => {
      // Sin internet, servidor caído o demasiado lento: todo llega aquí.
      throw new Error(err.name === 'TimeoutError' ? 'La nube no contestó a tiempo.' : 'No se pudo llegar a la nube.');
    });
    if (!res.ok) {
      const texto = await res.text().catch(() => '');
      let detalle = texto.slice(0, 300);
      try {
        const json = JSON.parse(texto);
        detalle = json.message || json.error || json.msg || detalle;
      } catch { /* no era JSON: se usa el texto tal cual */ }
      throw new Error(`La nube rechazó la operación (${res.status}): ${detalle}`);
    }
    if (res.status === 204) return null;
    const texto = await res.text();
    return texto ? JSON.parse(texto) : null;
  }

  rest(tabla, consulta = '', opciones = {}) {
    return this.pedir(`/rest/v1/${tabla}${consulta}`, opciones);
  }

  // El número de versión de la biblioteca: sube con cada cambio de cualquiera.
  // Es lo que se consulta cada pocos segundos.
  async consultarVersion() {
    const filas = await this.rest('biblioteca', '?select=version&id=eq.1');
    const version = filas && filas[0] ? Number(filas[0].version) : null;
    this.marcar(true);
    this.version = version;
    return version;
  }

  // La biblioteca entera, con la misma forma que datos/biblioteca.json.
  async leer() {
    const [cabecera, categorias, libros] = await Promise.all([
      this.rest('biblioteca', '?select=*&id=eq.1'),
      this.rest('categorias', '?select=*&order=orden.nullslast,nombre'),
      this.rest('libros', '?select=*&order=orden.nullslast,titulo'),
    ]);
    const b = (cabecera && cabecera[0]) || {};
    this.version = Number(b.version) || null;
    this.marcar(true);
    return {
      formato: 1,
      biblioteca: {
        nombre: b.nombre || 'Biblioteca del Cerro',
        lema: b.lema || '',
        disposicion: { niveles: b.niveles ?? 2, modo: b.modo || 'columnas' },
      },
      categorias: (categorias || []).map((c) => ({ ...c })),
      libros: (libros || []).map(aLibro),
    };
  }

  async guardarBiblioteca(biblioteca) {
    const d = biblioteca.disposicion || {};
    await this.rest('biblioteca', '?id=eq.1', {
      method: 'PATCH',
      body: JSON.stringify({
        nombre: biblioteca.nombre,
        lema: biblioteca.lema || '',
        niveles: d.niveles ?? 2,
        modo: d.modo || 'columnas',
      }),
    });
  }

  // La fecha de modificación la pone quien edita (prepararLibro), no esta capa:
  // si la cambiáramos aquí, lo guardado en la nube y lo guardado en la copia
  // local se diferenciarían en unos milisegundos, y la siguiente sincronización
  // creería que alguien tocó el libro y reordenaría la sala por nada.
  async guardarLibro(libro) {
    await this.rest('libros', '', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(aFila(libro)),
    });
  }

  async eliminarLibro(id) {
    await this.rest('libros', `?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async guardarCategoria(categoria) {
    await this.rest('categorias', '', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(categoria),
    });
  }

  async eliminarCategoria(id) {
    await this.rest('categorias', `?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  // Una foto al depósito público. Devuelve la URL con la que la verán todos.
  async subirImagen(nombre, bytes, tipo = 'image/jpeg') {
    const camino = `/storage/v1/object/${this.bucket}/${encodeURIComponent(nombre)}`;
    await this.pedir(camino, {
      method: 'POST',
      headers: { 'content-type': tipo, 'x-upsert': 'true', 'cache-control': '31536000' },
      body: bytes,
    });
    return `${this.url}/storage/v1/object/public/${this.bucket}/${encodeURIComponent(nombre)}`;
  }

  // La primera vez, la nube está vacía: se sube lo que haya en el archivo local
  // (la muestra, si es una instalación nueva). Solo siembra si no hay nada, así
  // que ejecutarlo de más no pisa el trabajo de nadie.
  async sembrarSiVacia(datos) {
    const categorias = await this.rest('categorias', '?select=id&limit=1');
    if (categorias && categorias.length) return false;
    if (!datos || !datos.categorias?.length) return false;
    await this.guardarBiblioteca(datos.biblioteca || {});
    await this.rest('categorias', '', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(datos.categorias),
    });
    await this.rest('libros', '', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(datos.libros.map(aFila)),
    });
    return true;
  }

  marcar(conectada, mensaje = '') {
    this.conectada = conectada;
    this.mensaje = mensaje || (conectada ? 'conectada' : 'sin conexión');
  }
}

module.exports = { Nube, aFila, aLibro };

// Una nube de mentira para las pruebas: lo justo de PostgREST y del depósito de
// archivos de Supabase para ejercitar electron/nube.js sin un proyecto de verdad
// y sin internet. Guarda todo en memoria.
//
//   node tools/nube-falsa.js [puerto]        la levanta a mano, para mirar
//   require('./nube-falsa').crearNubeFalsa() la usa tools/probar-nube.js
//
// Además de la API entiende dos rutas propias:
//   GET  /__estado        qué tiene dentro
//   POST /__otro-usuario  cambia un libro, como si lo editara otra persona
const http = require('node:http');

function crearNubeFalsa({ puerto = 0, siembra = null } = {}) {
  const base = {
    biblioteca: { id: 1, nombre: 'Biblioteca del Cerro', lema: '', niveles: 2, modo: 'columnas', version: 1 },
    categorias: siembra ? siembra.categorias : [],
    libros: siembra ? siembra.libros : [],
    subidas: [],
    peticiones: [],
  };

  const cuerpo = (req) => new Promise((res) => {
    const trozos = [];
    req.on('data', (t) => trozos.push(t));
    req.on('end', () => res(Buffer.concat(trozos)));
  });

  const responder = (res, codigo, datos) => {
    res.writeHead(codigo, { 'content-type': 'application/json' });
    res.end(datos === undefined ? '' : JSON.stringify(datos));
  };

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    const ruta = url.pathname;
    base.peticiones.push(`${req.method} ${ruta}`);

    if (ruta === '/__estado') {
      return responder(res, 200, {
        version: base.biblioteca.version,
        categorias: base.categorias.length,
        libros: base.libros.length,
        subidas: base.subidas,
        titulos: base.libros.map((l) => l.titulo),
      });
    }
    if (ruta === '/__otro-usuario') {
      if (!base.libros.length) return responder(res, 409, { message: 'no hay libros' });
      base.libros[0] = { ...base.libros[0], titulo: `${base.libros[0].titulo} (editado por otro)` };
      base.biblioteca.version += 1;
      return responder(res, 200, { ok: true, version: base.biblioteca.version });
    }

    // Toda petición a la API tiene que traer la clave, como en Supabase.
    if (!req.headers.apikey) return responder(res, 401, { message: 'No API key found in request' });

    if (ruta.startsWith('/storage/v1/object/')) {
      const bytes = await cuerpo(req);
      base.subidas.push({ nombre: ruta.replace('/storage/v1/object/', ''), bytes: bytes.length, tipo: req.headers['content-type'] });
      return responder(res, 200, { Key: ruta });
    }

    const m = /^\/rest\/v1\/(\w+)$/.exec(ruta);
    if (!m) return responder(res, 404, { message: `ruta desconocida: ${ruta}` });
    const tabla = m[1];

    if (req.method === 'GET') {
      if (tabla === 'biblioteca') return responder(res, 200, [base.biblioteca]);
      if (!base[tabla]) return responder(res, 404, { message: `tabla desconocida: ${tabla}` });
      const limite = Number(url.searchParams.get('limit') || 0);
      return responder(res, 200, limite ? base[tabla].slice(0, limite) : base[tabla]);
    }

    if (req.method === 'POST') {
      if (!(req.headers.prefer || '').includes('merge-duplicates')) {
        return responder(res, 400, { message: 'falta Prefer: resolution=merge-duplicates' });
      }
      const datos = JSON.parse((await cuerpo(req)).toString() || 'null');
      for (const fila of Array.isArray(datos) ? datos : [datos]) {
        const i = base[tabla].findIndex((x) => x.id === fila.id);
        if (i >= 0) base[tabla][i] = { ...base[tabla][i], ...fila };
        else base[tabla].push(fila);
      }
      base.biblioteca.version += 1;
      return responder(res, 201, undefined);
    }

    if (req.method === 'PATCH') {
      const datos = JSON.parse((await cuerpo(req)).toString() || 'null');
      if (tabla === 'biblioteca') Object.assign(base.biblioteca, datos);
      base.biblioteca.version += 1;
      return responder(res, 204, undefined);
    }

    if (req.method === 'DELETE') {
      const m2 = /id=eq\.([^&]+)/.exec(url.search || '');
      const id = m2 ? decodeURIComponent(m2[1]) : null;
      base[tabla] = base[tabla].filter((x) => x.id !== id);
      base.biblioteca.version += 1;
      return responder(res, 204, undefined);
    }

    return responder(res, 405, { message: 'método no permitido' });
  });

  return new Promise((listo) => {
    servidor.listen(puerto, '127.0.0.1', () => {
      listo({ servidor, base, url: `http://127.0.0.1:${servidor.address().port}`, cerrar: () => servidor.close() });
    });
  });
}

module.exports = { crearNubeFalsa };

if (require.main === module) {
  crearNubeFalsa({ puerto: Number(process.argv[2] || 54321) }).then(({ url }) => {
    console.log(`nube de mentira en ${url}`);
  });
}

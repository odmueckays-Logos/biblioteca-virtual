// Proceso principal de Electron: una ventana sin menús que carga la escena y,
// con Ctrl+E, la ventana del modo bibliotecario (editor.html).
// La carpeta del proyecto se sirve por el protocolo app:// para que los módulos ES,
// las fuentes y los modelos .glb se carguen igual que en un servidor web.
// El contenido se guarda en datos/ a través del almacén local (almacen.js).
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Almacen } = require('./almacen');

const ROOT = path.join(__dirname, '..');
const DEBUG = process.argv.includes('--debug');
const argumento = (nombre) => process.argv.find((a) => a.startsWith(`${nombre}=`))?.slice(nombre.length + 1);
// Carpeta del contenido: datos/ del proyecto, u otra con `--datos=carpeta`
// (sirve para probar sin tocar el contenido de verdad).
const DATOS = argumento('--datos') ? path.resolve(argumento('--datos')) : path.join(ROOT, 'datos');
const almacen = new Almacen(DATOS);
let biblioteca = null;
let editor = null;

const webPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  spellcheck: false,
  preload: path.join(__dirname, 'preload.js'),
};

// Cada petición de las ventanas al almacén. Los errores vuelven como texto para
// que el editor pueda mostrarlos tal cual.
function atender(canal, fn) {
  ipcMain.handle(canal, async (_event, ...args) => {
    try {
      return { valor: await fn(...args) };
    } catch (err) {
      return { error: err.message || String(err) };
    }
  });
}

function prepararAlmacen() {
  atender('biblioteca:leer', () => almacen.leer());
  atender('biblioteca:guardar-biblioteca', (biblioteca) => almacen.guardarBiblioteca(biblioteca));
  atender('biblioteca:guardar-libro', (libro) => almacen.guardarLibro(libro));
  atender('biblioteca:eliminar-libro', (id) => almacen.eliminarLibro(id));
  atender('biblioteca:guardar-categoria', (cat) => almacen.guardarCategoria(cat));
  atender('biblioteca:eliminar-categoria', (id) => almacen.eliminarCategoria(id));
  atender('biblioteca:subir-imagen', (nombre, bytes) => almacen.subirImagen(nombre, bytes));
  atender('biblioteca:abrir-editor', () => {
    abrirEditor();
    return true;
  });
  // Todas las ventanas se enteran cuando cambia el contenido.
  almacen.alCambiar(() => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('biblioteca:cambio');
  });
  almacen.vigilar();
}

// Modo bibliotecario: una ventana aparte con el formulario para agregar y
// editar libros y categorías.
function abrirEditor() {
  if (editor && !editor.isDestroyed()) {
    if (editor.isMinimized()) editor.restore();
    editor.focus();
    return editor;
  }
  editor = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Biblioteca · Modo bibliotecario',
    backgroundColor: '#1a130d',
    autoHideMenuBar: true,
    webPreferences,
  });
  editor.once('ready-to-show', () => editor.show());
  reenviarConsola(editor, 'editor');
  editor.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      editor.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
  // Si quedan cambios sin guardar, preguntar antes de cerrar.
  editor.webContents.on('will-prevent-unload', (event) => {
    const respuesta = dialog.showMessageBoxSync(editor, {
      type: 'question',
      buttons: ['Seguir editando', 'Cerrar sin guardar'],
      defaultId: 0,
      cancelId: 0,
      title: 'Cambios sin guardar',
      message: 'Hay cambios sin guardar en el modo bibliotecario.',
      detail: 'Si cierras ahora, se pierden.',
    });
    if (respuesta === 1) event.preventDefault();
  });
  editor.on('closed', () => {
    editor = null;
  });
  editor.loadURL(`app://bundle/editor.html${process.argv.includes('--probar-editor') ? '?prueba' : ''}`);
  return editor;
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

// Sirve los archivos del proyecto; lo que está bajo datos/ sale de la carpeta del
// contenido (que puede estar en otro sitio).
function serveProjectFiles() {
  protocol.handle('app', (request) => {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    const base = pathname.startsWith('/datos/') ? DATOS : ROOT;
    const rel = pathname.startsWith('/datos/') ? pathname.slice('/datos/'.length) : pathname;
    const filePath = path.normalize(path.join(base, rel));
    if (!filePath.startsWith(base)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

const LEVELS = ['debug', 'info', 'warning', 'error'];

// Reenvía la consola de una ventana a la terminal para detectar errores.
function reenviarConsola(win, nombre) {
  win.webContents.on('console-message', (event) => {
    const level = typeof event.level === 'number' ? LEVELS[event.level] : event.level;
    const line = `[${nombre}:${level}] ${event.message}`;
    if (level === 'error') console.error(line);
    else console.log(line);
  });
}

// Permisos del navegador, una sola vez para toda la aplicación. Las dos ventanas
// comparten la sesión, así que la política tiene que saber quién pregunta: solo la
// escena captura el mouse y se pone a pantalla completa, y todo lo demás (cámara,
// micrófono, notificaciones...) se deniega, porque la app funciona sin conexión.
//
// Ojo: la política es de la sesión, no de la ventana. Cuando cada ventana ponía la
// suya, la última en abrirse le quitaba el permiso a la otra: al entrar al modo
// bibliotecario la escena perdía el permiso de capturar el mouse y, al volver, ya no
// lo recuperaba nunca —el mouse se salía de la ventana por más clics que se dieran.
function prepararPermisos() {
  const permitido = (wc, permiso) =>
    (permiso === 'pointerLock' || permiso === 'fullscreen') &&
    !!biblioteca &&
    !biblioteca.isDestroyed() &&
    wc === biblioteca.webContents;
  session.defaultSession.setPermissionRequestHandler((wc, permiso, callback) => callback(permitido(wc, permiso)));
  session.defaultSession.setPermissionCheckHandler((wc, permiso) => permitido(wc, permiso));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Biblioteca Virtual',
    backgroundColor: '#070504',
    autoHideMenuBar: true,
    webPreferences: { ...webPreferences, backgroundThrottling: false },
  });
  biblioteca = win;
  // Sin la biblioteca no tiene sentido dejar el editor abierto.
  win.on('closed', () => {
    biblioteca = null;
    if (editor && !editor.isDestroyed()) editor.close();
  });

  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'F12') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    } else if ((input.control || input.meta) && input.key.toLowerCase() === 'e') {
      // Ctrl+E: modo bibliotecario (si está a pantalla completa, se sale para verlo).
      if (win.isFullScreen()) win.setFullScreen(false);
      abrirEditor();
      event.preventDefault();
    }
  });

  reenviarConsola(win, 'escena');

  // Desarrollo: `electron . --capture=ruta.png` guarda una captura de la ventana y
  // cierra. Con `--tecla=o` se pulsa antes esa tecla (para fotografiar el panel
  // de opciones, por ejemplo).
  const capture = process.argv.find((a) => a.startsWith('--capture='));
  if (capture) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        // `--js="..."` corre algo en la página antes de la foto (para encuadrar).
        const js = argumento('--js');
        if (js) {
          await win.webContents.executeJavaScript(js).catch((err) => console.error('[captura] el --js falló:', err.message));
          await new Promise((r) => setTimeout(r, 1600));
        }
        const tecla = argumento('--tecla');
        if (tecla) {
          win.webContents.sendInputEvent({ type: 'keyDown', keyCode: tecla });
          win.webContents.sendInputEvent({ type: 'char', keyCode: tecla });
          win.webContents.sendInputEvent({ type: 'keyUp', keyCode: tecla });
          await new Promise((r) => setTimeout(r, 900));
        }
        const image = await win.webContents.capturePage();
        require('node:fs').writeFileSync(capture.slice('--capture='.length), image.toPNG());
        console.log('[captura] guardada');
        app.quit();
      }, Number(process.env.CAPTURE_DELAY || 15000));
    });
  }

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[escena:error] el proceso de render terminó: ${details.reason}`);
  });

  // Desarrollo: comprueba que el mouse queda capturado dentro de la ventana.
  if (process.argv.includes('--probar-puntero')) probarPuntero(win);
  // Desarrollo: mide cuánto cuesta cada efecto en esta computadora.
  if (process.argv.includes('--medir')) medir(win);

  const DEMO = process.argv.includes('--demo');
  const PRUEBA = process.argv.includes('--probar-puntero') || process.argv.includes('--probar-editor')
    || process.argv.includes('--medir') || !!capture;
  win.loadURL(`app://bundle/index.html${DEMO ? '?debug&demo' : DEBUG || PRUEBA ? '?debug' : ''}`);
}

// Desarrollo: `electron . --probar-puntero` comprueba con clics y movimientos reales
// que el mouse queda capturado dentro de la ventana y que la mirada llega a sus
// topes sin que el puntero se escape. Imprime el resultado y cierra.
async function probarPuntero(win) {
  const wc = win.webContents;
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const estado = () => wc.executeJavaScript('window.__biblioteca.puntero()');
  wc.once('did-finish-load', async () => {
    await esperar(Number(process.env.PRUEBA_DELAY || 9000));
    const [w, h] = win.getContentSize();
    const x0 = Math.round(w * 0.12);
    const y0 = Math.round(h * 0.85); // suelo: un clic aquí no toma ningún libro
    wc.sendInputEvent({ type: 'mouseMove', x: x0, y: y0 });
    wc.sendInputEvent({ type: 'mouseDown', x: x0, y: y0, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: x0, y: y0, button: 'left', clickCount: 1 });
    await esperar(400);
    const trasClic = await estado();
    const trasClicQue = await wc.executeJavaScript("(() => { const a = window.__biblioteca; return a.sequence.state + '/' + (a.gaze.hovered ? a.gaze.hovered.content.id : a.gaze.hoveredShelf ? 'estante ' + a.gaze.hoveredShelf.rotulo : 'nada'); })()");
    console.log(`[puntero] capturado tras el clic: ${trasClic.capturado} · ${trasClicQue}`);

    // Movimientos: con el mouse capturado solo cuenta el desplazamiento (movementX/Y).
    // Se despachan dentro de la página para controlar exactamente cuánto se mueve.
    const empujar = async (dx, dy, veces) => {
      await wc.executeJavaScript(`(() => {
        for (let i = 0; i < ${veces}; i++) {
          window.dispatchEvent(new PointerEvent('pointermove', { movementX: ${dx}, movementY: ${dy} }));
        }
      })()`);
      await esperar(120);
      const e = await estado();
      const m = await wc.executeJavaScript('window.__biblioteca.look.pointer.toArray()');
      const q = await wc.executeJavaScript("(() => { const a = window.__biblioteca; return a.sequence.state + '/' + (a.gaze.hovered ? a.gaze.hovered.content.id : a.gaze.hoveredShelf ? 'estante ' + a.gaze.hoveredShelf.rotulo : 'nada'); })()");
      return `x=${e.x.toFixed(0)}/${e.ancho} y=${e.y.toFixed(0)}/${e.alto} mirada=(${m.map((v) => v.toFixed(2)).join(', ')}) capturado=${e.capturado} · ${q}`;
    };
    console.log(`[puntero] mucho a la derecha y abajo: ${await empujar(45, 12, 90)}`);
    console.log(`[puntero] mucho a la izquierda y arriba: ${await empujar(-45, -12, 180)}`);
    console.log(`[puntero] un poco a la derecha y abajo: ${await empujar(20, 20, 10)}`);

    // Esc suelta el mouse (lo hace el navegador). Lo importante es que la app lo
    // vuelva a capturar sola, sin que el mouse llegue a salirse de la ventana.
    const clic = async () => {
      const x = Math.round(w / 2);
      const y = Math.round(h * 0.9);
      wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    };
    const tecla = (keyCode) => {
      wc.sendInputEvent({ type: 'keyDown', keyCode });
      wc.sendInputEvent({ type: 'keyUp', keyCode });
    };
    tecla('Escape');
    await esperar(300);
    console.log(`[puntero] después de Esc: capturado=${(await estado()).capturado}`);
    await esperar(1500);
    console.log(`[puntero] 1,5 s después, sin tocar nada: capturado=${(await estado()).capturado}`);
    await clic();
    await esperar(600);
    console.log(`[puntero] después de un clic: capturado=${(await estado()).capturado}`);
    // Y otra vez, pero haciendo clic enseguida (Chromium no deja recapturar tan
    // rápido: si la app no reintenta, el mouse se queda suelto).
    tecla('Escape');
    await esperar(150);
    await clic();
    await esperar(400);
    console.log(`[puntero] clic inmediato tras Esc: capturado=${(await estado()).capturado}`);
    await esperar(2500);
    console.log(`[puntero] y 2,5 s más tarde: capturado=${(await estado()).capturado}`);

    // Pantalla completa: el mouse no debería soltarse al cambiar de tamaño.
    tecla('F11');
    await esperar(1200);
    console.log(`[puntero] en pantalla completa: capturado=${(await estado()).capturado}`);
    tecla('F11');
    await esperar(1200);
    console.log(`[puntero] al salir de pantalla completa: capturado=${(await estado()).capturado}`);

    // Modo bibliotecario: al abrir la otra ventana el navegador suelta el mouse,
    // porque la escena pierde el foco. Al cerrarla hay que volver a tenerlo dentro
    // de la escena sin ir a cazarlo por el escritorio.
    await clic();
    await esperar(700);
    console.log(`[puntero] antes del modo bibliotecario: capturado=${(await estado()).capturado}`);
    const bibliotecario = abrirEditor();
    await esperar(3000);
    console.log(`[puntero] con el editor abierto: capturado=${(await estado()).capturado} · foco de la escena=${win.isFocused()}`);
    bibliotecario.close();
    await esperar(1200);
    const alVolver = await estado();
    const conFoco = await wc.executeJavaScript('document.hasFocus()');
    console.log(`[puntero] al cerrar el editor: capturado=${alVolver.capturado} · ventana con foco=${win.isFocused()} · documento con foco=${conFoco}`);
    wc.sendInputEvent({ type: 'mouseMove', x: Math.round(w / 2), y: Math.round(h * 0.6) });
    await esperar(900);
    console.log(`[puntero] al mover el mouse por la escena: capturado=${(await estado()).capturado}`);
    await clic();
    await esperar(900);
    console.log(`[puntero] y tras un clic: capturado=${(await estado()).capturado}`);

    // Panel de imagen: con la tecla O se abre y el mouse queda libre para poder
    // elegir; al cerrarlo vuelve a la escena.
    tecla('o');
    await esperar(700);
    const abierto = await wc.executeJavaScript("!!document.querySelector('.opciones.visible')");
    console.log(`[puntero] panel de imagen abierto: ${abierto} · mouse libre: ${!(await estado()).capturado}`);
    const elegido = await wc.executeJavaScript("(() => { const b = [...document.querySelectorAll('.opciones-calidad .opcion')].find((x) => x.textContent === 'Baja'); b.click(); return window.__biblioteca.ajustes; })()");
    console.log(`[puntero] al elegir «Baja»: nitidez ${elegido.resolucion} · bordes ${elegido.suavizado} · tope ${elegido.cuadros} cuadros`);
    const recordado = await wc.executeJavaScript("JSON.parse(localStorage.getItem('biblioteca:imagen') || 'null')?.calidad");
    console.log(`[puntero] queda guardado para la próxima vez: ${recordado}`);
    tecla('o');
    await esperar(1000);
    console.log(`[puntero] al cerrar el panel: capturado=${(await estado()).capturado}`);
    // La prueba no deja preferencias puestas.
    await wc.executeJavaScript("localStorage.removeItem('biblioteca:imagen')");
    app.quit();
  });
}

// Desarrollo: `electron . --medir` mide los cuadros por segundo con la escena
// quieta, apagando y encendiendo cada cosa, e imprime una tabla. Sirve para saber
// qué cuesta caro en esta computadora antes de elegir los valores por defecto.
async function medir(win) {
  const wc = win.webContents;
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const ALTA = { resolucion: 1.5, suavizado: 'msaa4', gtao: true, bokeh: true, bloom: true, sombras: 2048, cuadros: 0 };
  const casos = [
    ['alta (todo)', {}],
    ['alta, sombras cada cuadro', {}, true],
    ['sin sombra de rincón (gtao)', { gtao: false }],
    ['sin desenfoque (bokeh)', { bokeh: false }],
    ['sin resplandor (bloom)', { bloom: false }],
    ['sin sombras', { sombras: 0 }],
    ['sin ningún efecto', { gtao: false, bokeh: false, bloom: false }],
    ['bordes msaa2', { suavizado: 'msaa2' }],
    ['bordes fxaa', { suavizado: 'fxaa' }],
    ['nitidez 1x', { resolucion: 1 }],
    ['nitidez 0,85x', { resolucion: 0.85 }],
    ['nitidez 0,7x', { resolucion: 0.7 }],
    ['calidad media', 'media'],
    ['calidad baja', 'baja'],
    ['calidad mínima', 'minima'],
  ];
  wc.once('did-finish-load', async () => {
    await esperar(Number(process.env.PRUEBA_DELAY || 10000));
    const info = await wc.executeJavaScript("(() => { const r = window.__biblioteca.renderer; const gl = r.getContext(); const d = gl.getExtension('WEBGL_debug_renderer_info'); return { gpu: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'desconocida', dpr: window.devicePixelRatio, w: window.innerWidth, h: window.innerHeight, libros: window.__biblioteca.books.length }; })()");
    console.log(`[medir] ${info.gpu}`);
    console.log(`[medir] ventana ${info.w}×${info.h} · densidad ${info.dpr} · ${info.libros} libros`);
    for (const [nombre, cambio, sombrasSiempre] of casos) {
      const ajustes = typeof cambio === 'string'
        ? `(await import('./src/core/renderer.js')).CALIDADES['${cambio}']`
        : JSON.stringify({ ...ALTA, ...cambio });
      const r = await wc.executeJavaScript(`(async () => {
        window.__biblioteca.sombrasSiempre(${!!sombrasSiempre});
        return window.__biblioteca.medir(${ajustes}, 3);
      })()`);
      console.log(`[medir] ${nombre.padEnd(28)} ${r.fps.toFixed(0).padStart(4)} fps · ${r.llamadas} llamadas · ${r.pixeles}×`);
    }

    // Y con un libro en la mano, que es el momento más pesado: páginas grandes,
    // brazos y todo cerca de la cámara.
    await wc.executeJavaScript(`(async () => {
      const api = window.__biblioteca;
      api.aplicar(${JSON.stringify(ALTA)});
      await api.tomar(api.books[0].content.id);
    })()`);
    await esperar(1500);
    for (const [nombre, cambio] of [['leyendo, alta', {}], ['leyendo, sin gtao', { gtao: false }], ['leyendo, nitidez 1x', { resolucion: 1 }], ['leyendo, bordes fxaa', { suavizado: 'fxaa' }]]) {
      const r = await wc.executeJavaScript(`window.__biblioteca.medir(${JSON.stringify({ ...ALTA, ...cambio })}, 3)`);
      console.log(`[medir] ${nombre.padEnd(28)} ${r.fps.toFixed(0).padStart(4)} fps · ${r.llamadas} llamadas · ${r.pixeles}×`);
    }
    app.quit();
  });
}

// Desarrollo: `electron . --probar-editor --datos=<copia> --capturas=<carpeta>`
// recorre el flujo completo del bibliotecario sobre una copia del contenido: crea
// una categoría y un libro con imagen desde el editor, espera a que la biblioteca
// se reordene, camina hasta el estante nuevo, toma el libro y pasa páginas.
// Guarda capturas de las dos ventanas e imprime lo que va pasando.
async function probarEditor() {
  const fs = require('node:fs');
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const carpeta = argumento('--capturas') || require('node:os').tmpdir();
  fs.mkdirSync(carpeta, { recursive: true });
  const log = (texto) => console.log(`[prueba] ${texto}`);
  const escena = (js) => biblioteca.webContents.executeJavaScript(js);
  const edit = (js) => editor.webContents.executeJavaScript(js);
  // La ventana tapada deja de pintarse, así que se pone delante un momento antes
  // de la foto; si no, la captura sale con lo que había hace dos pasos.
  const captura = async (win, nombre) => {
    win.focus();
    await esperar(500);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(carpeta, `${nombre}.png`), img.toPNG());
  };
  const hasta = async (fn, ms = 30000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await fn().catch(() => false)) return true;
      await esperar(250);
    }
    return false;
  };

  await hasta(() => escena('!!(window.__biblioteca && window.__biblioteca.gaze.enabled)'), 60000);
  await hasta(() => edit('!!window.__editor'), 30000);
  await esperar(1500);
  log(`biblioteca lista: ${await escena('window.__biblioteca.mundo.shelves.length')} estantes`);
  log(`pared: ${await escena("window.__biblioteca.pared().map((e) => e.rotulo + ' (col ' + (e.columna + 1) + ', nivel ' + (e.nivel + 1) + ')').join(' · ')")}`);
  await captura(biblioteca, 'e2e-01-inicio');

  // 1 · Categoría nueva desde el editor.
  await edit(`(async () => {
    const e = window.__editor;
    e.seleccionar('categoria', null, { preguntar: false });
    Object.assign(e.borrador, { nombre: 'Cultivos andinos', descripcion: 'Plantas que se siembran en las chacras de los Andes desde hace siglos.' });
    await e.guardarCategoria();
  })()`);
  await captura(editor, 'e2e-02-editor-categoria');
  const cuatro = await hasta(() => escena("window.__biblioteca.mundo.shelves.some((s) => s.categoria.id === 'cultivos-andinos')"));
  log(`la biblioteca se reordenó con la categoría nueva: ${cuatro} (${await escena('window.__biblioteca.mundo.shelves.length')} estantes)`);

  // 2 · Libro nuevo, con imagen y un texto largo que ocupa varias páginas.
  await edit(`(async () => {
    const e = window.__editor;
    e.seleccionar('libro', null, { preguntar: false });
    const largo = [
      'La quinua es una planta herbácea anual que puede superar el metro y medio de altura. Su tallo es erguido y sus hojas, de forma parecida a una pata de ganso, cambian de color a medida que la planta madura.',
      'Las flores son pequeñas y se agrupan en panojas densas en el extremo del tallo. Según la variedad, las panojas pueden ser verdes, amarillas, anaranjadas, rojas o moradas, lo que da a los campos un aspecto muy colorido.',
      'Los granos son redondos y aplanados, de unos dos milímetros. Están cubiertos por saponinas, sustancias de sabor amargo que protegen a la planta de las aves y que se eliminan lavando el grano antes de cocinarlo.',
      'Es un cultivo muy resistente: soporta heladas, sequías y suelos pobres o salinos, por eso se cultiva desde el nivel del mar hasta cerca de los cuatro mil metros de altitud.',
      'En los Andes se conocen cientos de variedades locales, conservadas por las familias campesinas generación tras generación, cada una adaptada a su propio valle y clima.',
    ].join('\\n');
    Object.assign(e.borrador, {
      categoria: 'cultivos-andinos',
      titulo: 'Quinua',
      especie: 'Chenopodium quinoa',
      autor: 'Willd.',
      familia: 'Amaranthaceae',
      ficha: 'Grano andino de panojas coloridas. Resiste heladas y sequías, y se cultiva desde hace miles de años en el altiplano.',
      altitud: { min: 2500, max: 4000 },
      secciones: [
        { titulo: 'Descripción', texto: largo },
        { titulo: 'Hábitat', texto: 'Se cultiva en chacras del altiplano y los valles andinos, sobre todo alrededor del lago Titicaca.' },
        { titulo: 'Usos y saberes', texto: 'Se come en sopas, guisos y bebidas. Las hojas tiernas también se comen como verdura.' },
      ],
      notas: ['Panojas rojas y amarillas en la misma chacra.', 'Granos todavía amargos: hay que lavarlos.'],
    });
    const c = document.createElement('canvas');
    c.width = 1000;
    c.height = 1300;
    const x = c.getContext('2d');
    x.fillStyle = '#f4efe2';
    x.fillRect(0, 0, 1000, 1300);
    x.strokeStyle = '#4b6b35';
    x.lineWidth = 14;
    x.beginPath();
    x.moveTo(500, 1260);
    x.bezierCurveTo(520, 900, 470, 600, 500, 380);
    x.stroke();
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 150;
      x.fillStyle = ['#b3263e', '#d9822b', '#e3c23c'][i % 3];
      x.beginPath();
      x.arc(500 + Math.cos(a) * r * 0.7, 260 + Math.sin(a) * r, 18 + Math.random() * 10, 0, Math.PI * 2);
      x.fill();
    }
    for (let i = 0; i < 8; i++) {
      x.fillStyle = '#5f8a42';
      x.beginPath();
      x.ellipse(500 + (i % 2 ? 90 : -90), 1150 - i * 95, 95, 38, (i % 2 ? -0.5 : 0.5), 0, Math.PI * 2);
      x.fill();
    }
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    await e.elegirImagen(new File([blob], 'quinua.png', { type: 'image/png' }));
    // Una segunda lámina, para comprobar que cada una va donde se le dice.
    const g = document.createElement('canvas');
    g.width = 900;
    g.height = 700;
    const y = g.getContext('2d');
    y.fillStyle = '#e9e2cf';
    y.fillRect(0, 0, 900, 700);
    y.fillStyle = '#7a6a4a';
    for (let i = 0; i < 40; i++) {
      y.beginPath();
      y.ellipse(80 + Math.random() * 740, 620 - Math.random() * 520, 40, 12, Math.random() * 3, 0, Math.PI * 2);
      y.fill();
    }
    await e.elegirImagen(new File([await new Promise((r) => g.toBlob(r, 'image/png'))], 'chacra.png', { type: 'image/png' }));
    // Y una tercera, un boceto a línea.
    const t = document.createElement('canvas');
    t.width = 700;
    t.height = 700;
    const z = t.getContext('2d');
    z.fillStyle = '#f2ecdc';
    z.fillRect(0, 0, 700, 700);
    z.strokeStyle = '#3e4e2c';
    z.lineWidth = 9;
    for (let i = 0; i < 6; i++) {
      z.beginPath();
      z.moveTo(350, 640);
      z.quadraticCurveTo(350 + (i - 2.5) * 120, 380, 350 + (i - 2.5) * 190, 120);
      z.stroke();
    }
    await e.elegirImagen(new File([await new Promise((r) => t.toBlob(r, 'image/png'))], 'hojas.png', { type: 'image/png' }));
    // Una en la portadilla, otra en «Hábitat» (que ya tiene el cerro de altitudes,
    // así que se irá a página propia) y otra al pie de «Usos y saberes».
    e.ponerLamina(0, 'portadilla');
    e.ponerLamina(1, 'seccion:1');
    e.ponerLamina(2, 'seccion:2');
    await new Promise((r) => setTimeout(r, 800));
    return [e.borrador.imagenes.map((i) => i.en).join(' / '), [0, 1, 2].map((n) => e.paginaDeLamina(n)).join(', ')];
  })()`).then((r) => log(`láminas elegidas: ${r[0]} · caras ${r[1]}`));
  // La foto del formulario se toma con las láminas a la vista.
  await edit("(() => { const l = [...document.querySelectorAll('legend')].find((x) => x.textContent === 'Láminas'); if (l) l.parentElement.scrollIntoView({ block: 'center' }); })()");
  await captura(editor, 'e2e-03-editor-libro');
  await edit('window.__editor.guardarLibro()');
  await esperar(1200);
  await captura(editor, 'e2e-04-editor-guardado');
  const guardado = await edit("window.__editor.datos.libros.find((l) => l.id === 'quinua')");
  const rutas = (guardado?.imagenes || []).map((i) => i.ruta);
  const enDisco = (ruta) => fs.existsSync(path.join(DATOS, ruta.replace(/^datos[/]/, '')));
  log(`libro guardado: ${guardado ? `${guardado.titulo} · ${guardado.signatura}` : 'NO'}`);
  log(`láminas guardadas: ${(guardado?.imagenes || []).map((i) => `${i.en} → ${i.ruta}`).join(' · ') || 'ninguna'}`);
  log(`imágenes en disco: ${rutas.length ? rutas.every(enDisco) : false} (${rutas.length})`);

  // 3 · La biblioteca lo pone en su estante.
  const llego = await hasta(() => escena("window.__biblioteca.books.some((b) => b.content.id === 'quinua')"));
  log(`el libro está en la biblioteca: ${llego}`);
  const i = await escena("window.__biblioteca.mundo.shelves.findIndex((s) => s.categoria.id === 'cultivos-andinos')");
  await escena(`window.__biblioteca.irA(${i})`);
  await hasta(() => escena(`window.__biblioteca.station === ${i} && window.__biblioteca.sequence.state === 'idle'`), 20000);
  await esperar(800);
  await captura(biblioteca, 'e2e-05-estante-nuevo');
  await escena(`(() => {
    const api = window.__biblioteca;
    const p = api.bookPosition('quinua');
    p.z += 0.012;
    api.aimAt(p);
  })()`);
  await esperar(1500);
  log(`mirando: ${await escena('window.__biblioteca.gaze.hovered && window.__biblioteca.gaze.hovered.content.id')}`);
  await captura(biblioteca, 'e2e-06-ficha');

  // 4 · Tomarlo y leerlo (si el estante está apilado, la escalera se empuja sola).
  await escena("window.__biblioteca.tomar('quinua')");
  const leyendo = await hasta(() => escena("window.__biblioteca.sequence.state === 'reading'"), 40000);
  log(`lectura: ${leyendo} · dobles páginas: ${await escena('window.__biblioteca.sequence.book.maxSpread + 1')}`);
  await esperar(500);
  await captura(biblioteca, 'e2e-07-portadilla');
  for (let k = 1; k <= 3; k++) {
    await escena('window.__biblioteca.sequence.turn(1)');
    await hasta(() => escena("window.__biblioteca.sequence.state === 'reading'"), 10000);
    await esperar(400);
    await captura(biblioteca, `e2e-08-pagina-${k}`);
  }

  // 5 · Cambios mientras se lee: la biblioteca espera a que se devuelva el libro.
  const guardarDesdeEditor = (js) => edit(`(async () => { const e = window.__editor; ${js}; })()`);
  await guardarDesdeEditor(`e.seleccionar('libro', 'quenua', { preguntar: false }); e.borrador.ficha = 'Ficha editada en la prueba.'; await e.guardarLibro()`);
  await esperar(1500);
  log(`con el libro en la mano no se reordena: ${await escena("window.__biblioteca.books.find((b) => b.content.id === 'quenua').content.ficha !== 'Ficha editada en la prueba.'")}`);
  await escena('window.__biblioteca.sequence.close()');
  const editada = await hasta(() => escena("window.__biblioteca.sequence.state === 'idle' && window.__biblioteca.books.find((b) => b.content.id === 'quenua')?.content.ficha === 'Ficha editada en la prueba.'"), 40000);
  log(`al devolverlo, la ficha editada ya está en la biblioteca: ${editada}`);

  // 6 · Mover un libro de categoría: cambia de estante y de signatura.
  await guardarDesdeEditor(`e.seleccionar('libro', 'cantuta', { preguntar: false }); e.borrador.categoria = 'cultivos-andinos'; e.borrador.signatura = ''; await e.guardarLibro()`);
  await hasta(() => escena("window.__biblioteca.books.find((b) => b.content.id === 'cantuta')?.content.cat.id === 'cultivos-andinos'"), 20000);
  log(`cantuta movida: ${await escena("(() => { const b = window.__biblioteca.books.find((x) => x.content.id === 'cantuta'); return b.content.cat.nombre + ' · ' + b.content.signatura; })()")}`);

  // 7 · Una categoría con libros no se puede borrar.
  const aviso = await edit(`(async () => {
    try {
      await (await import('./src/datos/fuente.js')).crearFuente().eliminarCategoria('cultivos-andinos');
      return 'se borró (no debía)';
    } catch (err) {
      return err.message;
    }
  })()`);
  log(`borrar categoría con libros: ${aviso}`);

  // 8 · Eliminar un libro: sale de la biblioteca y su imagen se borra.
  const rutasImagen = rutas.map((ruta) => path.join(DATOS, ruta.replace(/^datos[/]/, '')));
  await edit("(async () => { await (await import('./src/datos/fuente.js')).crearFuente().eliminarLibro('quinua'); })()");
  await hasta(() => escena("!window.__biblioteca.books.some((b) => b.content.id === 'quinua')"), 20000);
  log(`quinua eliminada de la biblioteca · láminas borradas: ${rutasImagen.every((r) => !fs.existsSync(r))} (${rutasImagen.length})`);

  // 9 · Editar el archivo a mano: la app lo nota y se reordena.
  const archivo = path.join(DATOS, 'biblioteca.json');
  const json = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  json.libros.find((l) => l.id === 'cantuta').categoria = 'arbustos-y-flores';
  json.libros.find((l) => l.id === 'cantuta').signatura = '';
  fs.writeFileSync(archivo, JSON.stringify(json, null, 2));
  const aMano = await hasta(() => escena("window.__biblioteca.books.find((b) => b.content.id === 'cantuta')?.content.cat.id === 'arbustos-y-flores'"), 20000);
  log(`cambio hecho a mano en el archivo, visto por la biblioteca: ${aMano}`);
  await edit(`(async () => { await (await import('./src/datos/fuente.js')).crearFuente().eliminarCategoria('cultivos-andinos'); })()`);
  await hasta(() => escena('window.__biblioteca.mundo.shelves.length === 3'), 20000);
  log(`categoría vacía eliminada: ${await escena('window.__biblioteca.mundo.shelves.length')} estantes, ${await escena('window.__biblioteca.books.length')} libros`);

  // 10 · Disposición: acoplar un estante encima de otro desde el editor.
  await edit(`(async () => {
    const e = window.__editor;
    e.seleccionar('disposicion', null, { preguntar: false });
    const org = e.org;
    const abajo = org.estantes.find((x) => x.categoria.id === 'arboles-nativos');
    e.mover('aromaticas-y-medicinales', abajo.columna, abajo.nivel + 1);
    await e.guardarDisposicion();
  })()`);
  await captura(editor, 'e2e-10-disposicion');
  const acoplado = await hasta(() => escena(`(() => {
    const p = window.__biblioteca.pared();
    const a = p.find((e) => e.rotulo === 'Aromáticas y medicinales');
    const b = p.find((e) => e.rotulo === 'Árboles nativos');
    return !!a && !!b && a.columna === b.columna && a.nivel === b.nivel + 1;
  })()`));
  log(`«Aromáticas y medicinales» acoplado encima de «Árboles nativos»: ${acoplado}`);
  log(`pared: ${await escena("window.__biblioteca.pared().map((e) => e.rotulo + ' (col ' + (e.columna + 1) + ', nivel ' + (e.nivel + 1) + ')').join(' · ')")}`);
  log(`hay escalera: ${await escena('!!window.__biblioteca.mundo.escalera')}`);

  // 11 · Subir por la escalera hasta ese estante y tomar un libro de arriba.
  // (Primero se espera a que termine el reordenamiento: mientras dura, un clic
  // para ir a otro estante no hace nada.)
  await hasta(() => escena("!window.__biblioteca.reordenando && window.__biblioteca.sequence.state === 'idle'"), 30000);
  const arriba = await escena("window.__biblioteca.mundo.shelves.findIndex((s) => s.categoria.id === 'aromaticas-y-medicinales')");
  await escena(`window.__biblioteca.irA(${arriba})`);
  await hasta(() => escena(`window.__biblioteca.station === ${arriba} && window.__biblioteca.sequence.state === 'idle' && window.__biblioteca.sequence.enEscalera`), 30000);
  await esperar(900);
  log(`subido al estante ${arriba + 1}: ojos a ${await escena('window.__biblioteca.look.eye.y.toFixed(2)')} m · en la escalera: ${await escena('window.__biblioteca.sequence.enEscalera')}`);
  await captura(biblioteca, 'e2e-11-estante-de-arriba');
  await escena(`(() => {
    const api = window.__biblioteca;
    const p = api.bookPosition('muna');
    p.z += 0.012;
    api.aimAt(p);
  })()`);
  await esperar(1200);
  await captura(biblioteca, 'e2e-12-ficha-arriba');
  await escena("window.__biblioteca.tomar('muna')");
  const leyendoArriba = await hasta(() => escena("window.__biblioteca.sequence.state === 'reading'"), 60000);
  log(`lectura desde la escalera: ${leyendoArriba}`);
  await esperar(500);
  await captura(biblioteca, 'e2e-13-leyendo-arriba');
  await escena('window.__biblioteca.sequence.close()');
  await hasta(() => escena("window.__biblioteca.sequence.state === 'idle'"), 40000);
  // Bajar y caminar a otra columna: se hacen las dos cosas seguidas.
  await escena('window.__biblioteca.irA(window.__biblioteca.vecinoEn(1, 0))');
  const abajo = await hasta(() => escena("window.__biblioteca.sequence.state === 'idle' && window.__biblioteca.look.eye.y < 1.6"), 30000);
  log(`bajó de la escalera y caminó a la columna de al lado: ${abajo}`);
  await captura(biblioteca, 'e2e-14-abajo');

  // 12 · Sin apilar: todos los estantes vuelven a la fila.
  await edit(`(async () => {
    const e = window.__editor;
    e.seleccionar('disposicion', null, { preguntar: false });
    e.borrador.disposicion.niveles = 1;
    await e.guardarDisposicion();
  })()`);
  const enFila = await hasta(() => escena('window.__biblioteca.pared().every((e) => e.nivel === 0)'), 30000);
  log(`con un solo nivel vuelven todos a la fila: ${enFila} · escalera: ${await escena('!!window.__biblioteca.mundo.escalera')}`);
  await hasta(() => escena("window.__biblioteca.gaze.enabled && window.__biblioteca.sequence.state === 'idle'"), 20000);
  await esperar(1200);
  await captura(biblioteca, 'e2e-15-en-fila');

  await captura(editor, 'e2e-09-editor-final');
  log('fin de la prueba');
  app.quit();
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  serveProjectFiles();
  prepararPermisos();
  prepararAlmacen();
  createWindow();
  // `npm run editor` abre también el modo bibliotecario.
  if (process.argv.includes('--editor') || process.argv.includes('--probar-editor')) abrirEditor();
  if (process.argv.includes('--probar-editor')) probarEditor().catch((err) => {
    console.error('[prueba] falló:', err);
    app.quit();
  });
});

// Al cerrar la biblioteca se cierra todo (también el editor).
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => almacen.cerrar());

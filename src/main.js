// Biblioteca virtual: arranque, carga, bucle y entrada del usuario.
//
// El contenido no está en el código: sale de una fuente de datos (hoy el archivo
// datos/biblioteca.json; mañana una base de datos). Con esos datos el
// bibliotecario automático reparte los libros en estantes, uno por categoría, y
// coloca esos estantes en la pared: uno al lado de otro o acoplado encima. Aquí se
// arma la sala con esa disposición, se camina de una columna a otra y se sube la
// escalera para llegar a los cuerpos de arriba. Si el contenido cambia (por
// ejemplo, desde el modo bibliotecario), la biblioteca se vuelve a ordenar sola.
import * as THREE from 'three';
import { CALIDADES, createRenderer } from './core/renderer.js';
import { cargarPreferencias, crearOpciones, guardarPreferencias } from './interaction/opciones.js';
import { LookController } from './core/look.js';
import { timeline } from './core/timeline.js';
import { clamp, damp, ease, lerp, smoothstep } from './core/math.js';
import {
  floorTexture, leatherGrain, paperEdgeTexture, plasterTexture, stoneTexture, woodTexture, canvasTexture,
} from './scene/textures.js';
import { SpineAtlas } from './scene/books.js';
import { buildBookcase, SHELF, SHELF_PITCH, SHELF_STACK } from './scene/bookshelf.js';
import { buildLadder } from './scene/escalera.js';
import { buildEnvironment, buildRoom } from './scene/room.js';
import { InteractiveBook } from './reader/openBook.js';
import { PageLibrary } from './reader/pageRenderer.js';
import { loadArms } from './hands/armRig.js';
import { Gaze } from './interaction/gaze.js';
import { Ficha } from './interaction/ficha.js';
import { BookSequence } from './interaction/sequence.js';
import { crearFuente } from './datos/fuente.js';
import { organizar } from './datos/organizar.js';
import { TEXTOS_UI } from './content/textos.js';

const DEBUG = new URLSearchParams(location.search).has('debug');
const $ = (sel) => document.querySelector(sel);
// Cede el control para que se pinte la barra de progreso (sin depender de requestAnimationFrame).
const nextFrame = () => new Promise((resolve) => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => resolve();
  channel.port2.postMessage(0);
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ui = {
  veil: $('#veil'),
  bar: $('.veil-progress span'),
  hint: $('#hint'),
  reticle: $('#reticle'),
  cursor: $('#cursor'),
  fade: $('#fundido'),
  hintTimer: 0,
  progress(v) {
    this.bar.style.width = `${Math.round(v * 100)}%`;
  },
  showHint(text, seconds = 6) {
    this.hint.textContent = text;
    this.hint.classList.add('visible');
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.hint.classList.remove('visible'), seconds * 1000);
  },
  hideHint() {
    clearTimeout(this.hintTimer);
    this.hint.classList.remove('visible');
  },
  // Fundido a oscuro mientras se reordenan los estantes.
  fadeOut(text) {
    this.fade.querySelector('span').textContent = text || '';
    this.fade.classList.add('visible');
  },
  fadeIn() {
    this.fade.classList.remove('visible');
  },
  current: 'loading',
  mode(m) {
    this.current = m;
    document.body.classList.toggle('hide-cursor', true);
    this.reticle.classList.toggle('visible', m === 'browse');
    this.cursor.classList.toggle('visible', m === 'reading');
  },
};

async function main() {
  // Cuánto tarda cada parte de la carga (se imprime al final: si algún día la
  // espera del principio se hace larga, aquí se ve por qué).
  const arranque = performance.now();
  const marcas = [];
  const marca = (nombre) => marcas.push(`${nombre} ${Math.round(performance.now() - arranque)} ms`);
  const canvas = $('#scene');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.03, 40);
  // Lo que el usuario eligió en el panel de imagen la vez pasada.
  const preferencias = cargarPreferencias();
  let calidad = preferencias.calidad;
  const rig = createRenderer(canvas, scene, camera, preferencias.ajustes);
  const { renderer } = rig;

  // Contenido: se pide primero, mientras cargan las fuentes.
  const fuente = crearFuente();
  const datosIniciales = fuente.cargar();

  // Fuentes (las usan los lomos, la placa y las páginas).
  await Promise.all([
    document.fonts.load('40px "EB Garamond"'),
    document.fonts.load('italic 40px "EB Garamond"'),
    document.fonts.load('600 40px "EB Garamond"'),
    document.fonts.load('40px "IM Fell English"'),
    document.fonts.load('italic 40px "IM Fell English"'),
  ]);
  let guardados;
  try {
    guardados = await datosIniciales;
  } catch (err) {
    throw new Error(`no se pudo leer el contenido (${err.message})`);
  }
  const sub = document.querySelector('.veil-sub');
  if (sub && guardados.biblioteca?.lema) sub.textContent = guardados.biblioteca.lema;
  ui.progress(0.08);
  marca('contenido y tipografías');
  await nextFrame();

  // Texturas procedurales.
  const wood = woodTexture({ seed: 11 });
  ui.progress(0.2);
  await nextFrame();
  const floor = floorTexture({ seed: 23 });
  ui.progress(0.3);
  await nextFrame();
  const stone = stoneTexture({ seed: 5 });
  ui.progress(0.4);
  await nextFrame();
  const plaster = plasterTexture({});
  const leather = leatherGrain({});
  const pageEdge = paperEdgeTexture({});
  ui.progress(0.48);
  await nextFrame();

  // Materiales compartidos.
  const woodMat = new THREE.MeshStandardMaterial({
    map: wood.map, bumpMap: wood.surface, bumpScale: 1.3, roughnessMap: wood.surface, roughness: 1, color: 0xc4ae9c,
  });
  const woodDarkMat = new THREE.MeshStandardMaterial({
    map: wood.map, bumpMap: wood.surface, bumpScale: 1, roughnessMap: wood.surface, roughness: 1, color: 0x6e5d50,
  });
  const atlas = new SpineAtlas();
  const atlasTex = atlas.textures();
  const atlasMaterial = new THREE.MeshStandardMaterial({
    map: atlasTex.map, bumpMap: atlasTex.surface, bumpScale: 1.2, roughnessMap: atlasTex.surface,
    metalnessMap: atlasTex.surface, roughness: 1, metalness: 1,
  });
  const paperEdgeMaterial = new THREE.MeshStandardMaterial({ map: pageEdge, roughness: 0.95, color: 0xe8dcc4 });
  const leatherMap = canvasTexture(leather.color, { srgb: true });
  const leatherSurface = canvasTexture(leather.surface, { srgb: false });
  const pageEdgeDouble = paperEdgeMaterial.clone();
  pageEdgeDouble.side = THREE.DoubleSide;
  const shared = { leather, leatherMap, leatherSurface, pageEdge: pageEdgeDouble };
  buildEnvironment(scene, renderer);

  // Libros de verdad: todos con las mismas medidas (las manos están ajustadas a ellas).
  const dims = { T: 0.042, H: 0.322, W: 0.23 };
  const bookQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);

  // ---------------------------------------------------------------- la biblioteca
  // Arma estantes, sala y libros a partir de los datos ya organizados.
  function construirMundo(org, progreso = () => {}) {
    atlas.reset();
    const { columnas } = org.rejilla;
    // Una columna cada SHELF_PITCH metros; los estantes apilados suben SHELF_STACK.
    const stations = Array.from({ length: columnas }, (_, c) => c * SHELF_PITCH);
    const niveles = Math.max(...org.estantes.map((e) => e.nivel)) + 1;
    const alto = niveles * SHELF_STACK;
    const shelves = org.estantes.map((estante, i) => {
      const bookcase = buildBookcase({
        woodMat,
        woodDarkMat,
        spineAtlas: atlas,
        atlasMaterial,
        paperEdgeMaterial,
        placements: estante.ubicaciones.map((u) => ({ id: u.libro.id, fila: u.fila, at: u.at })),
        dims,
        rotulo: estante.rotulo,
        seed: 2024 + i * 7919,
        apilado: estante.nivel > 0,
        conEncima: org.estantes.some((o) => o.columna === estante.columna && o.nivel === estante.nivel + 1),
      });
      const x = stations[estante.columna];
      const y = estante.nivel * SHELF_STACK;
      bookcase.group.position.set(x, y, 0);
      scene.add(bookcase.group);
      bookcase.hitbox.userData.estante = estante;
      Object.assign(estante, { x, y, bookcase, hitbox: bookcase.hitbox, plaque: bookcase.plaque, slots: bookcase.slots });
      progreso((i + 1) / org.estantes.length);
      return estante;
    });
    atlasTex.map.needsUpdate = true;
    atlasTex.surface.needsUpdate = true;

    const room = buildRoom({ stone, plaster, wood, floor, spineAtlas: atlas, atlasTextures: atlasTex, stations, alto });
    scene.add(room.group);
    for (const t of room.translucent) rig.addTranslucent(t);

    // La escalera rodante solo hace falta si hay estantes acoplados encima, y su
    // riel va solo por delante de esas columnas.
    const apiladas = [...new Set(org.estantes.filter((e) => e.nivel > 0).map((e) => e.columna))].sort((a, b) => a - b);
    const escalera = apiladas.length
      ? buildLadder({
        woodMat,
        woodDarkMat,
        alto,
        x0: stations[apiladas[0]],
        x1: stations[apiladas[apiladas.length - 1]],
        // Cada soporte del riel baja hasta la cornisa de su columna.
        apoyos: apiladas.map((c) => ({
          x: stations[c],
          alto: (Math.max(0, ...org.estantes.filter((e) => e.columna === c).map((e) => e.nivel)) + 1) * SHELF_STACK,
        })),
      })
      : null;
    if (escalera) scene.add(escalera.group);

    const books = [];
    for (const estante of shelves) {
      for (const u of estante.ubicaciones) {
        const slot = estante.slots.find((s) => s.id === u.libro.id);
        const book = new InteractiveBook(u.libro, dims, shared);
        book.estante = estante.indice;
        book.estanteX = estante.x;
        book.estanteY = estante.y;
        book.shelfPosition = slot.position.clone().add(new THREE.Vector3(estante.x, estante.y, 0));
        book.shelfQuaternion = bookQuat.clone();
        book.root.position.copy(book.shelfPosition);
        book.root.quaternion.copy(book.shelfQuaternion);
        book.onShelf = true;
        scene.add(book.root);
        books.push(book);
      }
    }
    return { org, shelves, stations, room, books, escalera, alto, niveles };
  }

  function desmontarMundo(m) {
    for (const book of m.books) {
      scene.remove(book.root);
      pages.release(book.content);
      book.dispose();
    }
    for (const shelf of m.shelves) {
      scene.remove(shelf.bookcase.group);
      shelf.bookcase.dispose();
    }
    if (m.escalera) {
      scene.remove(m.escalera.group);
      m.escalera.dispose();
    }
    scene.remove(m.room.group);
    for (const t of m.room.translucent) rig.removeTranslucent(t);
    m.room.dispose();
  }

  marca('texturas');
  ui.progress(0.52);
  await nextFrame();
  const pages = new PageLibrary(renderer);
  let mundo = construirMundo(organizar(guardados), (p) => ui.progress(0.52 + p * 0.26));
  marca('mundo');
  ui.progress(0.8);
  await nextFrame();

  // Brazos y manos (avatar realista recortado a los brazos).
  const skinTex = (file, srgb) => {
    const t = new THREE.TextureLoader().load(`assets/textures/${file}`);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  };
  const arms = await loadArms({
    textures: {
      color: skinTex('brazo-color.jpg', true),
      normal: skinTex('brazo-normal.jpg', false),
      roughness: skinTex('brazo-rugosidad.jpg', false),
    },
  });
  marca('brazos');
  ui.progress(0.88);

  // Cámara, cuerpo y luces que acompañan al usuario.
  const look = new LookController(camera);
  look.eye.set(0, 1.5, SHELF.frontZ + 1.7);
  const body = new THREE.Object3D();
  body.position.copy(look.eye);
  scene.add(body);

  const hoverLight = new THREE.PointLight(0xffd6a0, 0, 0.9, 2);
  scene.add(hoverLight);
  const readingLight = new THREE.SpotLight(0xfff0dc, 0, 3, 0.55, 0.9, 1.5);
  readingLight.position.set(-0.35, 0.45, 0.25);
  readingLight.castShadow = true;
  readingLight.shadow.mapSize.set(1024, 1024);
  readingLight.shadow.bias = -0.0004;
  readingLight.shadow.normalBias = 0.004;
  readingLight.shadow.radius = 4;
  readingLight.shadow.camera.near = 0.1;
  readingLight.shadow.camera.far = 2;
  body.add(readingLight);
  readingLight.target.position.set(0, -0.13, -0.5);
  body.add(readingLight.target);

  const ficha = new Ficha(scene);
  const gaze = new Gaze({ camera, reticle: ui.reticle, ficha, hoverLight });
  const sequence = new BookSequence({ scene, camera, look, arms, pages, rig, gaze, body, ui, readingLight });

  // ---------------------------------------------------------------- estantes
  // El usuario está frente a un estante (`station`). Puede ir a los acoplados al
  // lado (caminando) y a los de encima o debajo (por la escalera).
  let station = 0;

  // Dónde se pone el usuario para un estante: en el piso, a 1,7 m de la cara del
  // estante; en un cuerpo apilado, sobre el peldaño desde el que alcanza la tabla
  // de arriba, y por eso más cerca de la pared (la escalera está apoyada en ella).
  function puesto(estante) {
    if (!estante.nivel || !mundo.escalera) return { x: estante.x, y: 1.5, z: SHELF.frontZ + 1.7, escalera: false };
    const pie = mundo.escalera.peldanoDesde(estante.nivel * SHELF_STACK - 0.73);
    return { x: estante.x, y: pie + 1.5, z: mundo.escalera.zPie(pie) + 0.13, escalera: true, pie };
  }

  // Qué estantes hay alrededor del actual (para los límites de la cabeza).
  function vecindad(estante) {
    const hay = (dc, dn) => mundo.shelves.some((o) => o.columna === estante.columna + dc && o.nivel === estante.nivel + dn);
    const lado = (dc) => mundo.shelves.some((o) => o.columna === estante.columna + dc && Math.abs(o.nivel - estante.nivel) <= 1);
    return { izquierda: lado(-1), derecha: lado(1), arriba: hay(0, 1), abajo: hay(0, -1), escalera: estante.nivel > 0 };
  }

  // El estante vecino en una dirección: ← → cambian de columna (al nivel más
  // parecido), ↑ ↓ suben o bajan en la misma columna.
  function vecinoEn(dc, dn) {
    const e = mundo.shelves[station];
    if (!e) return -1;
    if (dn) return mundo.shelves.findIndex((o) => o.columna === e.columna && o.nivel === e.nivel + dn);
    const candidatos = mundo.shelves.filter((o) => o.columna === e.columna + dc);
    if (!candidatos.length) return -1;
    candidatos.sort((a, b) => Math.abs(a.nivel - e.nivel) - Math.abs(b.nivel - e.nivel));
    return candidatos[0].indice;
  }

  // `aparcar` solo al armar la biblioteca: el resto del tiempo la escalera se
  // queda donde se la dejó, y se la empuja cuando hace falta.
  function ponerEstacion(i, { aparcar = false } = {}) {
    station = i;
    gaze.station = i;
    const estante = mundo.shelves[i];
    const p = puesto(estante);
    look.eye.set(p.x, p.y, p.z);
    sequence.enEscalera = p.escalera;
    if (mundo.escalera) {
      if (p.escalera) mundo.escalera.setX(p.x);
      else if (aparcar) mundo.escalera.aparcar(p.x);
    }
    look.setSurroundings(vecindad(estante));
    mundo.room.follow(estante.x);
    mundo.room.setRig(estante.x);
  }
  gaze.setWorld(mundo.books, mundo.shelves);
  ponerEstacion(0, { aparcar: true });
  await ficha.prepare(mundo.books.filter((b) => b.estante === station), nextFrame);

  // Precompilar sombreadores para evitar tirones al empezar.
  look.update(0, 0);
  sequence.update(0, 0);
  marca('fichas');
  await renderer.compileAsync(scene, camera);
  marca('compilar sombreadores');
  ui.progress(1);

  // ---------------------------------------------------------------- entrada
  // El mouse se queda dentro de la ventana: se captura sobre el lienzo, como en un
  // juego, y a partir de ahí su posición se lleva a mano sumando el movimiento. Al
  // llegar a un borde se queda ahí en vez de salirse de la aplicación.
  const mouse = new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2);
  const raycaster = new THREE.Raycaster();
  const capturado = () => document.pointerLockElement === canvas;

  function aplicarPuntero() {
    ui.cursor.style.transform = `translate(${mouse.x}px, ${mouse.y}px)`;
    look.setPointer(mouse.x / window.innerWidth, mouse.y / window.innerHeight);
  }
  aplicarPuntero();

  window.addEventListener('pointermove', (e) => {
    // Al caminar o al subir la escalera, la mirada la llevan el paso y la subida;
    // con el panel de imagen abierto, el mouse es para el panel.
    if (sequence.state === 'walking' || sequence.state === 'climbing' || opcionesAbiertas) return;
    if (capturado()) {
      // Chromium en Windows a veces manda un salto enorme justo al capturar: se ignora.
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
      mouse.x = clamp(mouse.x + e.movementX, 0, window.innerWidth);
      mouse.y = clamp(mouse.y + e.movementY, 0, window.innerHeight);
    } else {
      mouse.set(e.clientX, e.clientY);
      // Si el usuario ya había pedido tener el mouse dentro y volvió a la ventana
      // —al cerrar el modo bibliotecario, o al volver de otro programa—, se
      // recupera en cuanto mueve el mouse por la escena, sin tener que hacer clic
      // ni ir a buscarlo por el escritorio.
      if (quiereCaptura && document.hasFocus() && performance.now() > insistirHasta) capturar();
    }
    aplicarPuntero();
  });
  window.addEventListener('resize', () => {
    mouse.x = clamp(mouse.x, 0, window.innerWidth);
    mouse.y = clamp(mouse.y, 0, window.innerHeight);
    aplicarPuntero();
  });

  // Capturar el mouse al primer clic (el navegador lo exige) y recuperarlo si se
  // suelta, por ejemplo al pulsar Esc o al cambiar de ventana.
  //
  // Ojo: después de un Esc, Chromium no deja volver a capturarlo durante cerca de
  // un segundo. Si en ese rato el usuario hace clic, la petición se rechaza sin
  // decir nada y el mouse se queda suelto: se sale de la ventana. Por eso, en
  // cuanto el usuario pide volver —con un clic—, se insiste unos segundos hasta
  // que el navegador acepta. Mientras no haga clic, el mouse sigue libre a
  // propósito: así puede usar la barra de la ventana o cambiar de programa.
  let reintento = 0;
  let insistirHasta = 0;
  let revision = 0;
  // Lo último que pidió el usuario: el mouse dentro (hizo clic en la escena) o
  // libre (pulsó Esc). Mientras lo quiera dentro, la escena lo recupera sola.
  let quiereCaptura = false;
  function pedirCaptura() {
    try {
      const r = canvas.requestPointerLock();
      if (r && r.catch) r.catch(() => {});
    } catch {
      /* el navegador lo avisa también con pointerlockerror */
    }
  }
  function insistir() {
    clearTimeout(reintento);
    if (capturado() || performance.now() > insistirHasta) return;
    reintento = setTimeout(() => {
      if (capturado() || performance.now() > insistirHasta) return;
      if (document.hasFocus()) pedirCaptura();
      insistir();
    }, 300);
  }
  function capturar() {
    quiereCaptura = true;
    clearTimeout(revision);
    if (capturado()) return;
    // Si la ventana todavía no tiene el foco (el clic que la trae al frente), el
    // navegador negará la captura: para eso está la insistencia.
    insistirHasta = performance.now() + 3000;
    pedirCaptura();
    insistir();
  }
  document.addEventListener('pointerlockchange', () => {
    if (capturado()) {
      insistirHasta = 0; // ya está: se deja de insistir
      clearTimeout(reintento);
      return;
    }
    // El mouse se acaba de soltar, y conviene saber por qué. Del Esc el navegador
    // no avisa —se lo queda él—, pero se nota en el foco: si la ventana sigue
    // teniéndolo, fue el usuario, y el mouse se queda libre hasta el siguiente
    // clic. Si el foco se fue a otra ventana —el modo bibliotecario, otro
    // programa—, el mouse sigue siendo de la escena y vuelve cuando vuelva el
    // usuario. Se mira un momento después porque el aviso del foco y el del mouse
    // no llegan siempre en el mismo orden.
    clearTimeout(revision);
    revision = setTimeout(() => {
      if (document.hasFocus()) quiereCaptura = false;
    }, 200);
  });
  document.addEventListener('pointerlockerror', insistir);
  canvas.addEventListener('pointerdown', capturar);

  // ---------------------------------------------------------------- opciones de imagen
  // Con la tecla O se abre el panel: mientras está abierto el mouse queda libre
  // para poder elegir, y al cerrarlo vuelve a la escena.
  let opcionesAbiertas = false;
  const opciones = crearOpciones({
    ajustes: rig.ajustes,
    calidad,
    alCambiar(parcial, nombre) {
      calidad = nombre;
      // En automática se empieza de nuevo por lo más bonito y se vuelve a medir.
      if (parcial) rig.aplicar(parcial);
      else {
        rig.aplicar(CALIDADES.alta);
        perf.bajadas = 0;
        perf.flojo = 0;
      }
      guardarPreferencias(calidad, rig.ajustes);
    },
    alCerrar() {
      opcionesAbiertas = false;
      capturar();
    },
  });
  function verOpciones() {
    if (opciones.abierto) {
      opciones.cerrar();
      return;
    }
    opcionesAbiertas = true;
    opciones.abrir();
    opciones.fps(perf.fps);
    document.exitPointerLock();
  }

  // Mientras se va a otro estante el puntero vuelve al centro, para llegar
  // mirando de frente.
  function recentrarPuntero() {
    const m0 = mouse.clone();
    const centro = new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2);
    return (t) => {
      mouse.lerpVectors(m0, centro, ease.inOutSine(t));
      aplicarPuntero();
    };
  }

  // Ir a otro estante. Si está al lado, unos pasos por la galería (y la luz de la
  // ventana pasa de una columna a la otra). Si está encima o debajo, la escalera.
  // Si está en otra columna y en otro nivel, las dos cosas: primero se baja.
  let shownShelvesHint = false;
  async function irA(i) {
    if (i < 0 || i >= mundo.shelves.length || i === station || sequence.state !== 'idle' || reconstruyendo) return;
    const desde = mundo.shelves[station];
    const hasta = mundo.shelves[i];
    ui.hideHint();

    // 1 · Bajar al piso si se cambia de columna estando subido a la escalera.
    if (hasta.columna !== desde.columna && desde.nivel > 0) {
      const foco = new THREE.Vector3(desde.x, 0.8, SHELF.frontZ);
      if (!await sequence.climbTo(1.5, SHELF.frontZ + 1.7, foco, recentrarPuntero())) return;
      sequence.enEscalera = false;
      const piso = mundo.shelves.find((o) => o.columna === desde.columna && o.nivel === 0);
      if (piso) look.setSurroundings(vecindad(piso));
    }

    // 2 · Caminar por la galería hasta su columna.
    if (Math.abs(hasta.x - look.eye.x) > 0.01) {
      const from = desde.x;
      const to = hasta.x;
      const destino = new THREE.Vector3(to, hasta.y + 0.95, SHELF.frontZ);
      const recentrar = recentrarPuntero();
      const ok = await sequence.walkTo(to, destino, (t) => {
        recentrar(t);
        // La luz de la ventana se atenúa a mitad de camino y ahí pasa a la otra.
        const fade = 0.25 + 0.75 * smoothstep(0, 0.6, Math.abs(t - 0.5) * 2);
        mundo.room.setRig(t < 0.5 ? from : to, fade);
      });
      if (!ok) return;
      mundo.room.setRig(to);
    }

    // 3 · Empujar la escalera hasta esa columna, si no está ahí, y subir (o bajar).
    const p = puesto(hasta);
    if (Math.abs(p.y - look.eye.y) > 0.01) {
      const foco = new THREE.Vector3(hasta.x, hasta.y + 0.95, SHELF.frontZ);
      if (mundo.escalera && p.escalera && Math.abs(mundo.escalera.x - hasta.x) > 0.05) {
        const desde = mundo.escalera.x;
        const ok = await sequence.walkTo(look.eye.x, foco, (t) => {
          mundo.escalera.setX(lerp(desde, hasta.x, ease.inOutSine(t)));
        }, { pasos: false, duracion: 0.5 + Math.abs(hasta.x - desde) * 0.12 });
        if (!ok) return;
        mundo.escalera.setX(hasta.x);
      }
      if (!await sequence.climbTo(p.y, p.z, foco, recentrarPuntero())) return;
    }
    ponerEstacion(i);

    // Si al llegar la escalera queda delante del estante, se la empuja a un lado.
    if (mundo.escalera && !p.escalera && Math.abs(mundo.escalera.x - p.x) < SHELF.width / 2) {
      const desdeX = mundo.escalera.x;
      const hastaX = mundo.escalera.aparcadero(p.x);
      if (Math.abs(hastaX - desdeX) > 0.05) {
        await sequence.walkTo(look.eye.x, new THREE.Vector3(hastaX, 1.1, SHELF.frontZ), (t) => {
          mundo.escalera.setX(lerp(desdeX, hastaX, ease.inOutSine(t)));
        }, { pasos: false, duracion: 0.75 });
      }
    }
  }

  // Tomar un libro. Subido a la escalera, primero se empuja hasta quedar frente a
  // él: la escalera rueda por el riel y el usuario va con ella.
  async function tomarLibro(book) {
    if (sequence.enEscalera && mundo.escalera && Math.abs(book.shelfPosition.x - look.eye.x) > 0.18) {
      const desde = look.eye.x;
      const hasta = book.shelfPosition.x;
      const ok = await sequence.walkTo(hasta, book.shelfPosition.clone(), (t) => {
        mundo.escalera.setX(lerp(desde, hasta, ease.inOutSine(t)));
      }, { pasos: false });
      if (!ok) return;
      mundo.escalera.setX(hasta);
    }
    await sequence.take(book);
    if (!shownReadingHint) {
      shownReadingHint = true;
      ui.showHint(TEXTOS_UI.lectura, 7);
    }
  }

  function pageUnderCursor() {
    const book = sequence.book;
    if (!book) return null;
    raycaster.setFromCamera(new THREE.Vector2((mouse.x / window.innerWidth) * 2 - 1, -(mouse.y / window.innerHeight) * 2 + 1), camera);
    const hit = raycaster.intersectObjects([book.rightStack.mesh, book.leftStack.mesh, book.backCover, book.frontCover], false)[0];
    if (!hit) return null;
    return hit.object === book.rightStack.mesh || hit.object === book.backCover ? 'right' : 'left';
  }

  let shownReadingHint = false;
  window.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (sequence.state === 'idle' && ui.current === 'browse') {
      if (gaze.hovered) {
        ui.hideHint();
        tomarLibro(gaze.hovered);
      } else if (gaze.hoveredShelf) {
        irA(gaze.hoveredShelf.indice);
      }
    } else if (sequence.state === 'taking' || sequence.state === 'closing') {
      timeline.timeScale = 2.4;
    } else if (sequence.state === 'reading') {
      const side = pageUnderCursor();
      if (side === 'right') sequence.turn(1);
      else if (side === 'left') sequence.turn(-1);
      else cerrarLibro();
    }
  });
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (sequence.state === 'reading') cerrarLibro();
  });

  // Al devolver el primer libro, se cuenta que hay más estantes.
  async function cerrarLibro() {
    ui.hideHint();
    await sequence.close();
    if (!shownShelvesHint && mundo.shelves.length > 1) {
      shownShelvesHint = true;
      // Si hay estantes acoplados encima, se cuenta también cómo subir.
      ui.showHint(mundo.shelves.some((s) => s.nivel > 0) ? TEXTOS_UI.apilados : TEXTOS_UI.estantes, 7);
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'o' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      verOpciones();
      return;
    }
    if (opcionesAbiertas) return;
    if (e.key === 'Escape' && sequence.state === 'reading') cerrarLibro();
    if (sequence.state === 'reading') {
      if (e.key === 'ArrowRight') sequence.turn(1);
      if (e.key === 'ArrowLeft') sequence.turn(-1);
    } else if (sequence.state === 'idle' && ui.current === 'browse') {
      if (e.key === 'ArrowRight') irA(vecinoEn(1, 0));
      if (e.key === 'ArrowLeft') irA(vecinoEn(-1, 0));
      if (e.key === 'ArrowUp') irA(vecinoEn(0, 1));
      if (e.key === 'ArrowDown') irA(vecinoEn(0, -1));
    }
    if (DEBUG && e.key.toLowerCase() === 'q') {
      const orden = ['alta', 'media', 'baja', 'minima'];
      calidad = orden[(orden.indexOf(calidad) + 1) % orden.length];
      rig.aplicar(CALIDADES[calidad]);
      opciones.poner(rig.ajustes, calidad);
      console.info('calidad', calidad);
    }
  });

  // ---------------------------------------------------------------- cambios en los datos
  // Cuando el contenido cambia, la biblioteca se reordena sola: se espera a que el
  // usuario no tenga un libro en la mano, se funde a oscuro y se rearma.
  let pendiente = false;
  let reconstruyendo = false;
  fuente.alCambiar(() => {
    pendiente = true;
  });

  async function reconstruir() {
    reconstruyendo = true;
    pendiente = false;
    let nuevos;
    try {
      nuevos = await fuente.cargar();
    } catch (err) {
      console.error('No se pudo recargar el contenido:', err);
      reconstruyendo = false;
      return;
    }
    const antes = mundo.shelves[station];
    gaze.enabled = false;
    gaze.clear();
    ui.fadeOut(TEXTOS_UI.reordenando);
    await wait(450);
    renderer.setAnimationLoop(null);
    desmontarMundo(mundo);
    ficha.clear();
    mundo = construirMundo(organizar(nuevos));
    // Se sigue frente a la misma categoría, si todavía existe.
    let i = mundo.shelves.findIndex((s) => s.categoria.id === antes.categoria.id && s.parte === antes.parte);
    if (i < 0) i = mundo.shelves.findIndex((s) => s.categoria.id === antes.categoria.id);
    if (i < 0) i = Math.min(station, mundo.shelves.length - 1);
    gaze.setWorld(mundo.books, mundo.shelves);
    rig.revisarSombras();
    cuadrosConSombra = 0;
    sombraX = Infinity;
    ponerEstacion(i, { aparcar: true });
    await ficha.prepare(mundo.books.filter((b) => b.estante === station), nextFrame);
    await renderer.compileAsync(scene, camera);
    renderer.setAnimationLoop(tick);
    gaze.enabled = true;
    ui.fadeIn();
    reconstruyendo = false;
    console.info(`Biblioteca reordenada: ${mundo.shelves.length} estantes en ${mundo.org.rejilla.columnas} columnas y ${mundo.niveles} ${mundo.niveles === 1 ? 'nivel' : 'niveles'}, ${mundo.books.length} libros`);
  }

  // ---------------------------------------------------------------- bucle
  const clock = new THREE.Timer();
  clock.connect(document);
  let elapsed = 0;
  // Medida continua: alimenta el panel de imagen y, en automática, decide si hay
  // que bajar la calidad. `cuadros` es el total desde que arrancó (para medir).
  const perf = { frames: 0, time: 0, fps: 0, cuadros: 0, flojo: 0, bajadas: 0, started: false };
  // Las sombras solo se vuelven a dibujar cuando algo se mueve: con la escena
  // quieta se ahorra un dibujado completo de todo por cuadro. Los primeros
  // cuadros se dibujan sí o sí (si el mapa no llega a crearse, la sala sale negra).
  let sombraX = Infinity;
  let cuadrosConSombra = 0;
  let proximoCuadro = 0;
  const focusRay = new THREE.Vector3();

  function autofocus(dt) {
    // Distancia aproximada a lo que se mira (estantes, muro del fondo o laterales).
    camera.getWorldDirection(focusRay);
    const p = camera.position;
    const ext = mundo.room.extent;
    let dist = 8;
    if (focusRay.z < -0.01) {
      const tShelf = (SHELF.frontZ - p.z) / focusRay.z;
      const y = p.y + focusRay.y * tShelf;
      const x = p.x + focusRay.x * tShelf;
      const onShelf = mundo.stations.some((s) => Math.abs(x - s) < SHELF.width / 2);
      if (y < mundo.alto + 0.05 && y > 0 && onShelf) dist = tShelf;
      else dist = Math.min(dist, (ext.z0 + 0.45 - p.z) / focusRay.z);
    }
    if (focusRay.y < -0.01) dist = Math.min(dist, -p.y / focusRay.y);
    if (Math.abs(focusRay.x) > 0.01) dist = Math.min(dist, ((focusRay.x > 0 ? ext.x1 - 0.42 : ext.x0 + 0.42) - p.x) / focusRay.x);
    rig.dof.focus = damp(rig.dof.focus, clamp(dist, 0.8, 9), 4, dt);
    rig.dof.aperture = 0.0011;
    rig.dof.maxblur = 0.0032;
  }

  function tick(time, forcedDt) {
    // Tope de cuadros por segundo: los que sobran se saltan enteros. La escena no
    // se atrasa, porque el reloj sigue corriendo y el salto siguiente es mayor.
    const tope = rig.ajustes.cuadros;
    if (forcedDt === undefined && tope) {
      // Se apunta al próximo cuadro y se avanza de tope en tope: si se pusiera
      // «han pasado X ms», con una pantalla de 144 Hz un tope de 60 daría 48.
      if (time < proximoCuadro) return;
      proximoCuadro = Math.max(time + 1, proximoCuadro + 1000 / tope);
    }
    if (forcedDt === undefined) clock.update(time);
    const dt = forcedDt ?? Math.min(clock.getDelta(), 0.05);
    elapsed += dt;
    timeline.update(dt);
    sequence.update(dt, elapsed);
    look.update(dt, elapsed);
    camera.updateMatrixWorld();
    gaze.update(dt);
    if (sequence.state === 'idle' || sequence.state === 'walking') autofocus(dt);
    mundo.room.follow(look.eye.x);
    mundo.room.update(elapsed);
    if (cuadrosConSombra < 3) {
      cuadrosConSombra++;
      if (cuadrosConSombra === 3) renderer.shadowMap.autoUpdate = false;
    } else if (sequence.state !== 'idle' || Math.abs(look.eye.x - sombraX) > 0.015) {
      renderer.shadowMap.needsUpdate = true;
      sombraX = look.eye.x;
    }
    if (pendiente && !reconstruyendo && sequence.state === 'idle') reconstruir();

    if (sequence.state === 'reading') {
      const side = pageUnderCursor();
      ui.cursor.classList.toggle('turn', !!side);
    } else {
      ui.cursor.classList.remove('turn');
    }

    rig.render(elapsed);

    // Cómo va: se mide todo el tiempo (el panel lo muestra) y, si el usuario dejó
    // la calidad en automática, se baja un escalón cuando dos medidas seguidas se
    // quedan cortas. Dos escalones como máximo: de ahí en adelante decide él.
    perf.frames++;
    perf.cuadros++;
    perf.time += dt;
    if (perf.time >= 1) {
      perf.fps = perf.frames / perf.time;
      perf.frames = 0;
      perf.time = 0;
      if (opcionesAbiertas) opciones.fps(perf.fps);
      if (perf.started && calidad === 'automatica' && perf.bajadas < 2) {
        perf.flojo = perf.fps < 42 ? perf.flojo + 1 : 0;
        if (perf.flojo >= 2) {
          perf.flojo = 0;
          perf.bajadas++;
          const siguiente = perf.bajadas === 1 ? 'media' : 'baja';
          rig.aplicar(CALIDADES[siguiente]);
          opciones.poner(rig.ajustes, 'automatica');
          if (!opcionesAbiertas) ui.showHint(TEXTOS_UI.bajada(siguiente), 6);
          console.info(`Rendimiento ${perf.fps.toFixed(0)} fps → calidad ${siguiente}`);
        }
      }
    }
  }
  renderer.setAnimationLoop(tick);

  // Revelar la escena.
  await nextFrame();
  await nextFrame();
  ui.veil.classList.add('gone');
  ui.mode('browse');
  gaze.enabled = true;
  setTimeout(() => {
    perf.started = !DEBUG;
    ui.showHint(TEXTOS_UI.inicio, 7);
  }, 1400);
  gaze.onFirstHover = () => setTimeout(() => ui.hideHint(), 2200);
  if (fuente.editable) {
    setTimeout(() => {
      if (sequence.state === 'idle' && !ui.hint.classList.contains('visible')) ui.showHint(TEXTOS_UI.editor, 5);
    }, 16000);
  }
  setTimeout(() => {
    if (sequence.state === 'idle' && !ui.hint.classList.contains('visible')) ui.showHint(TEXTOS_UI.imagen, 5);
  }, 26000);
  console.info(`Arranque: ${marcas.join(' · ')}`);
  console.info(`Biblioteca: ${mundo.shelves.length} estantes en ${mundo.org.rejilla.columnas} columnas y ${mundo.niveles} ${mundo.niveles === 1 ? 'nivel' : 'niveles'}, ${mundo.books.length} libros · fuente: ${fuente.nombre}`);

  if (DEBUG) {
    const bookById = (id) => mundo.books.find((b) => b.content.id === id);
    window.__biblioteca = {
      THREE, scene, camera, rig, renderer, arms, sequence, timeline, look, gaze, pages, fuente, opciones,
      get ajustes() {
        return rig.ajustes;
      },
      aplicar: (a) => rig.aplicar(a),
      // Para medir de verdad el ahorro de congelar las sombras.
      sombrasSiempre(v) {
        renderer.shadowMap.autoUpdate = !!v;
        if (v) cuadrosConSombra = 0;
      },
      // Cuadros por segundo con unos ajustes dados, ya asentados (lo usa --medir).
      async medir(ajustes = null, segundos = 3) {
        if (ajustes) rig.aplicar(ajustes);
        await wait(600);
        const c0 = perf.cuadros;
        const t0 = performance.now();
        await wait(segundos * 1000);
        const fps = (perf.cuadros - c0) / ((performance.now() - t0) / 1000);
        renderer.info.autoReset = false;
        renderer.info.reset();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const llamadas = renderer.info.render.calls;
        renderer.info.autoReset = true;
        return { fps, llamadas, pixeles: renderer.getPixelRatio() };
      },
      get mundo() {
        return mundo;
      },
      get books() {
        return mundo.books;
      },
      get station() {
        return station;
      },
      // true mientras la biblioteca se reordena (no se puede ir a otro estante).
      get reordenando() {
        return reconstruyendo || pendiente;
      },
      irA,
      vecinoEn,
      puesto: () => puesto(mundo.shelves[station]),
      // Sitio de cada estante en la pared (para revisar la disposición).
      pared: () => mundo.shelves.map((e) => ({ indice: e.indice, rotulo: e.rotulo, columna: e.columna, nivel: e.nivel, x: e.x, y: e.y })),
      // Estado del puntero: dónde está y si el mouse está capturado en la ventana.
      puntero: () => ({ x: mouse.x, y: mouse.y, capturado: capturado(), ancho: window.innerWidth, alto: window.innerHeight }),
      setLook(yawDeg, pitchDeg) {
        const { yawLeft, yawRight, up, down, rest } = look.limits;
        const yawRad = (yawDeg * Math.PI) / 180;
        const pitchRad = (pitchDeg * Math.PI) / 180;
        look.pointer.x = clamp(-yawRad / (yawRad > 0 ? yawLeft : yawRight), -1, 1);
        look.pointer.y = pitchRad >= rest ? clamp((pitchRad - rest) / (up - rest), 0, 1) : -clamp((rest - pitchRad) / (rest - down), 0, 1);
      },
      take(id) {
        return sequence.take(bookById(id));
      },
      // Como el clic: si hay que empujar la escalera hasta el libro, lo hace.
      tomar(id) {
        return tomarLibro(bookById(id));
      },
      // Orienta la mirada hacia un punto del mundo (invierte la curva del mouse).
      aimAt(point) {
        const d = point.clone().sub(camera.position);
        const yaw = Math.atan2(-d.x, -d.z);
        const pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
        const solve = (fn, target) => {
          let lo = -1;
          let hi = 1;
          for (let i = 0; i < 40; i++) {
            const mid = (lo + hi) / 2;
            if (fn(mid) < target) lo = mid;
            else hi = mid;
          }
          return (lo + hi) / 2;
        };
        look.pointer.x = solve((x) => {
          look.pointer.x = x;
          return -look.freeTarget().yaw;
        }, -yaw);
        look.pointer.y = solve((y) => {
          look.pointer.y = y;
          return look.freeTarget().pitch;
        }, pitch);
      },
      // Captura desde una cámara externa (sin postproceso) para revisar contactos.
      async shotFrom(name, from, at, fov = 40) {
        const cam = new THREE.PerspectiveCamera(fov, camera.aspect, 0.01, 30);
        cam.position.set(...from);
        cam.lookAt(new THREE.Vector3(...at));
        renderer.setRenderTarget(null);
        renderer.render(scene, cam);
        const url = renderer.domElement.toDataURL('image/png');
        const res = await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: url });
        return res.text();
      },
      bookPosition(id) {
        return bookById(id).shelfPosition.clone();
      },
      // Ejecuta una acción de la secuencia cuadro a cuadro y guarda capturas en los instantes dados.
      async run(action, marks, prefix, dt = 1 / 30) {
        const api = window.__biblioteca;
        let err = null;
        action().catch((e) => {
          err = e;
        });
        let t = 0;
        for (const m of marks) {
          const n = Math.round((m - t) / dt);
          for (let i = 0; i < n; i++) {
            tick(0, dt);
            if (i % 10 === 0) await new Promise((r) => setTimeout(r, 0));
          }
          t = m;
          await api.shot(`${prefix}-${String(Math.round(m * 10)).padStart(3, '0')}`, 0.0001);
        }
        return { state: sequence.state, err: err && String(err.stack || err) };
      },
      pause() {
        timeline.paused = true;
      },
      resume() {
        timeline.paused = false;
      },
      step(seconds) {
        timeline.advance(seconds);
      },
      // Avanza la simulación cuadro a cuadro (sirve aunque la ventana no dibuje).
      frames(count = 1, dt = 1 / 60) {
        for (let i = 0; i < count; i++) tick(0, dt);
      },
      // Renderiza un cuadro y lo guarda como PNG mediante el servidor de desarrollo.
      async shot(name = 'shot', dt = 1 / 60) {
        tick(0, dt);
        const url = renderer.domElement.toDataURL('image/png');
        const res = await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: url });
        return res.text();
      },
    };
    console.info('Modo debug: window.__biblioteca');

    // Demostración automática (verificación en la app de escritorio): mira un libro
    // del primer estante, lo toma, pasa una página y mide los cuadros por segundo.
    if (new URLSearchParams(location.search).has('demo')) {
      const api = window.__biblioteca;
      (async () => {
        await wait(1500);
        const first = mundo.books.find((b) => b.estante === station);
        if (!first) {
          console.info('demo: el estante no tiene libros');
          return;
        }
        const target = first.shelfPosition.clone();
        target.z += 0.012;
        api.aimAt(target);
        await wait(1500);
        // Llamadas de dibujo de un cuadro completo (todas las pasadas).
        renderer.info.autoReset = false;
        renderer.info.reset();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const calls = renderer.info.render.calls;
        renderer.info.autoReset = true;
        console.info(`demo: mirando ${gaze.hovered ? gaze.hovered.content.id : 'nada'} · ${calls} llamadas de dibujo por cuadro`);
        let frames = 0;
        const count = () => {
          frames++;
          if (sequence.state !== 'idle' || frames < 2) requestAnimationFrame(count);
        };
        const t0 = performance.now();
        requestAnimationFrame(count);
        await sequence.take(gaze.hovered || first);
        console.info(`demo: lectura lista (${((performance.now() - t0) / 1000).toFixed(1)} s, ${(frames / ((performance.now() - t0) / 1000)).toFixed(0)} fps)`);
        await wait(600);
        await sequence.turn(1);
        console.info('demo: página pasada');
      })();
    }
  }
}

main().catch((err) => {
  console.error(err);
  const sub = document.querySelector('.veil-sub');
  if (sub) sub.textContent = `Error al cargar: ${err.message}`;
});

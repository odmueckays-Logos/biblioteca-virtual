// Panel de opciones de imagen: lo que se puede bajar o apagar para que la
// biblioteca vaya suelta en una computadora justa.
//
// La idea es que nadie tenga que saber qué es la oclusión ambiental: cada fila
// dice qué se ve, y abajo se leen los cuadros por segundo, así se nota el efecto
// al instante. Lo elegido se guarda en el navegador y la próxima vez arranca
// igual.
import { CALIDADES, nombreCalidad } from '../core/renderer.js';

const CLAVE = 'biblioteca:imagen';

// Lo guardado la última vez: { calidad, ajustes }. Si no hay nada (o el
// navegador no deja guardar), se empieza en automática.
export function cargarPreferencias() {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE) || 'null');
    if (guardado && typeof guardado === 'object' && guardado.ajustes) {
      return { calidad: guardado.calidad || 'automatica', ajustes: { ...CALIDADES.alta, ...guardado.ajustes } };
    }
  } catch {
    /* sin memoria del navegador: se empieza de cero */
  }
  return { calidad: 'automatica', ajustes: { ...CALIDADES.alta } };
}

export function guardarPreferencias(calidad, ajustes) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ calidad, ajustes }));
  } catch {
    /* si no se puede guardar, al menos vale para esta vez */
  }
}

const h = (tag, attrs = {}, ...hijos) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of hijos.flat()) if (c || c === 0) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
};

// Cada fila es una pregunta con sus respuestas; la elegida queda marcada.
const FILAS = [
  {
    clave: 'resolucion',
    nombre: 'Nitidez',
    ayuda: 'Cuántos puntos se dibujan por cada punto de la pantalla. Bajarla es lo que más alivia a una tarjeta justa.',
    opciones: [
      { valor: 0.7, texto: 'Suave' },
      { valor: 0.85, texto: 'Media' },
      { valor: 1, texto: 'Nítida' },
      { valor: 1.5, texto: 'Máxima' },
    ],
  },
  {
    clave: 'suavizado',
    nombre: 'Bordes',
    ayuda: 'Cómo se disimulan los bordes de sierra de las molduras y los lomos.',
    opciones: [
      { valor: 'ninguno', texto: 'Sin suavizar' },
      { valor: 'fxaa', texto: 'Barato' },
      { valor: 'msaa2', texto: 'Bueno' },
      { valor: 'msaa4', texto: 'Mejor' },
    ],
  },
  {
    clave: 'sombras',
    nombre: 'Sombras',
    ayuda: 'Las que echan los estantes y las manos con la luz de la ventana.',
    opciones: [
      { valor: 0, texto: 'Ninguna' },
      { valor: 1024, texto: 'Blandas' },
      { valor: 2048, texto: 'Definidas' },
    ],
  },
  {
    clave: 'gtao',
    nombre: 'Sombra de rincón',
    ayuda: 'El oscurecido suave donde se juntan dos maderas. Se nota poco y cuesta caro.',
    opciones: [{ valor: false, texto: 'No' }, { valor: true, texto: 'Sí' }],
  },
  {
    clave: 'bokeh',
    nombre: 'Desenfoque',
    ayuda: 'Lo que está lejos se ve desenfocado, como en una foto.',
    opciones: [{ valor: false, texto: 'No' }, { valor: true, texto: 'Sí' }],
  },
  {
    clave: 'bloom',
    nombre: 'Resplandor',
    ayuda: 'El halo de la luz que entra por la ventana.',
    opciones: [{ valor: false, texto: 'No' }, { valor: true, texto: 'Sí' }],
  },
  {
    clave: 'cuadros',
    nombre: 'Cuadros por segundo',
    ayuda: 'Ponerle tope hace trabajar menos a la máquina, y calentar menos, sin que se note a simple vista.',
    opciones: [
      { valor: 30, texto: '30' },
      { valor: 60, texto: '60' },
      { valor: 0, texto: 'Los que dé' },
    ],
  },
];

const CALIDADES_UI = [
  { valor: 'automatica', texto: 'Automática' },
  { valor: 'alta', texto: 'Alta' },
  { valor: 'media', texto: 'Media' },
  { valor: 'baja', texto: 'Baja' },
  { valor: 'minima', texto: 'Mínima' },
];

// Crea el panel. `alCambiar(ajustes, calidad)` lo aplica y lo guarda.
export function crearOpciones({ ajustes, calidad, alCambiar, alCerrar }) {
  let actuales = { ...ajustes };
  let modo = calidad;

  const cuerpo = h('div', { class: 'opciones-filas' });
  const medida = h('span', { class: 'opciones-fps' }, '—');
  const calidadFila = h('div', { class: 'opciones-fila opciones-calidad' });
  const panel = h('div', { class: 'opciones', role: 'dialog', 'aria-label': 'Opciones de imagen' },
    h('div', { class: 'opciones-caja' },
      h('div', { class: 'opciones-titulo' }, 'Imagen'),
      calidadFila,
      cuerpo,
      h('div', { class: 'opciones-pie' },
        medida,
        h('button', { type: 'button', class: 'opciones-cerrar', onclick: () => cerrar() }, 'Volver a la biblioteca'))));

  function elegir(clave, valor) {
    actuales = { ...actuales, [clave]: valor };
    modo = nombreCalidad(actuales);
    alCambiar({ [clave]: valor }, modo);
    pintar();
  }

  function elegirCalidad(nombre) {
    modo = nombre;
    if (nombre !== 'automatica') actuales = { ...CALIDADES[nombre] };
    alCambiar(nombre === 'automatica' ? null : { ...actuales }, nombre);
    pintar();
  }

  function botones(opciones, valorActual, alPulsar) {
    return h('div', { class: 'opciones-botones' }, opciones.map((o) => h('button', {
      type: 'button',
      class: o.valor === valorActual ? 'opcion activa' : 'opcion',
      onclick: () => alPulsar(o.valor),
    }, o.texto)));
  }

  function pintar() {
    calidadFila.replaceChildren(
      h('span', { class: 'opciones-etiqueta' }, 'Calidad'),
      botones(CALIDADES_UI, modo, elegirCalidad),
      h('span', { class: 'opciones-ayuda' }, modo === 'automatica'
        ? 'La biblioteca mide sola cómo va y baja lo que haga falta.'
        : modo === 'personalizada'
          ? 'A tu medida: cambiaste algo de abajo.'
          : 'Todo de una vez; abajo se puede afinar.'),
    );
    cuerpo.replaceChildren(...FILAS.map((fila) => h('div', { class: 'opciones-fila' },
      h('span', { class: 'opciones-etiqueta' }, fila.nombre),
      botones(fila.opciones, actuales[fila.clave], (v) => elegir(fila.clave, v)),
      h('span', { class: 'opciones-ayuda' }, fila.ayuda))));
  }

  function abrir() {
    pintar();
    panel.classList.add('visible');
  }

  function cerrar() {
    if (!panel.classList.contains('visible')) return;
    panel.classList.remove('visible');
    alCerrar?.();
  }

  document.body.append(panel);

  return {
    el: panel,
    abrir,
    cerrar,
    get abierto() {
      return panel.classList.contains('visible');
    },
    alternar() {
      if (panel.classList.contains('visible')) cerrar();
      else abrir();
    },
    // Los cuadros por segundo medidos, para ver el efecto al instante.
    fps(v) {
      medida.textContent = v ? `${Math.round(v)} cuadros por segundo` : '—';
    },
    // Cuando la calidad automática cambia algo, el panel se entera.
    poner(nuevos, nombre) {
      actuales = { ...nuevos };
      modo = nombre;
      if (panel.classList.contains('visible')) pintar();
    },
  };
}

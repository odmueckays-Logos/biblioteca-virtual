// Modo bibliotecario: agregar, editar y ordenar los libros y las categorías.
//
// Usa la misma fuente de datos que la biblioteca (src/datos/fuente.js): hoy
// guarda en datos/biblioteca.json; cuando haya base de datos, guardará en ella
// sin cambiar nada de aquí. Al guardar, la biblioteca se reordena sola.
import { crearFuente, urlImagen } from '../datos/fuente.js';
import {
  describirSitio, describirUbicacion, huecosLibres, organizar, signaturaLibre,
} from '../datos/organizar.js';
import {
  COLORES_CUERO, COLORES_PERGAMINO, LIMITES, MODOS, SECCIONES_SUGERIDAS,
  codigoLibre, laminasDe, normalizarDisposicion, prepararCategoria, prepararLibro, sitiosLamina,
  validarCategoria, validarLibro,
} from '../datos/modelo.js';
import { SHELF_PITCH, SHELF_STACK } from '../scene/bookshelf.js';
import { caraDeLamina, cargarImagenes, contarCaras, dibujarCara } from '../reader/pageRenderer.js';
import { dibujarCartel, dibujarFicha } from '../interaction/ficha.js';

const $ = (sel) => document.querySelector(sel);

// Crea un elemento: h('div', { class: 'x', onclick: fn }, hijos…).
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Pone los hijos en un elemento (en lugar de los que tenía), sin los vacíos.
const poner = (el, ...hijos) => el.replaceChildren(...hijos.flat().filter((c) => c !== null && c !== undefined && c !== false));

const fuente = crearFuente();
let datos = null; // tal como se guardan
let org = null; // organizados (estantes, tomos, signaturas)
let sel = null; // { tipo: 'libro' | 'categoria' | 'disposicion', id } (id null = nuevo)
let moviendo = null; // id de la categoría que se está moviendo de hueco
let apoyos = []; // estantes que sostienen al que se está colocando (se fijan con él)
let borrador = null; // copia que se está editando
let original = ''; // para saber si hay cambios sin guardar
// Imágenes elegidas y todavía sin subir: clave «nueva:N» → { file, url }. En el
// borrador la lámina lleva esa clave como ruta hasta que se guarda.
const subidas = new Map();
let claveNueva = 0;
let mostrarLamina = ''; // ruta de la lámina que la vista previa tiene que enseñar
let errores = [];
let pliego = 0; // doble página de la vista previa
let guardando = false;

// ------------------------------------------------------------------ utilidades
function aviso(texto, tipo = '') {
  const el = $('#aviso');
  el.textContent = texto;
  el.className = `aviso visible ${tipo}`;
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => el.classList.remove('visible'), tipo === 'error' ? 7000 : 4500);
}

const hayCambios = () => !!borrador && JSON.stringify(borrador) !== original;

// Las imágenes elegidas y sin guardar se sueltan al cambiar de libro.
function olvidarSubidas() {
  for (const { url } of subidas.values()) URL.revokeObjectURL(url);
  subidas.clear();
  mostrarLamina = '';
}

function confirmarSalida() {
  return !hayCambios() || window.confirm('Hay cambios sin guardar. ¿Descartarlos?');
}

function marcarCambio() {
  const estado = $('#estado');
  if (estado) estado.textContent = hayCambios() ? 'Cambios sin guardar' : '';
  vistaPronto();
}

const nombreCategoria = (id) => datos.categorias.find((c) => c.id === id)?.nombre || 'Sin clasificar';

// ------------------------------------------------------------------ cargar
async function cargar() {
  datos = await fuente.cargar();
  org = organizar(datos);
  const { columnas, niveles } = org.rejilla;
  const forma = niveles > 1 && org.estantes.some((e) => e.nivel > 0)
    ? `${columnas} ${columnas === 1 ? 'columna' : 'columnas'}, hasta ${niveles} niveles`
    : `${columnas} ${columnas === 1 ? 'columna' : 'columnas'}`;
  $('#nombre-biblioteca').textContent = `${datos.biblioteca?.nombre || 'Biblioteca'} · ${datos.libros.length} libros en ${org.estantes.length} estantes · ${forma}`;
  const f = $('#fuente');
  f.textContent = fuente.editable ? `Guardando en ${fuente.nombre}` : `Solo lectura: ${fuente.nombre}`;
  f.classList.toggle('solo-lectura', !fuente.editable);
  renderLista();
}

// ------------------------------------------------------------------ catálogo
function renderLista() {
  const filtro = $('#buscar').value.trim().toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const coincide = (l) => !filtro || `${l.titulo} ${l.especie} ${l.signatura}`.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(filtro);
  const lista = $('#lista');
  lista.replaceChildren();
  for (const cat of org.categorias) {
    const libros = org.libros.filter((l) => l.cat.id === cat.id && coincide(l));
    if (filtro && !libros.length) continue;
    const esSinCategoria = cat.id.startsWith('_');
    lista.append(h('div', { class: 'cat' },
      h('button', {
        type: 'button',
        class: `cat-cabeza${sel?.tipo === 'categoria' && sel.id === cat.id ? ' activa' : ''}`,
        title: esSinCategoria ? '' : 'Editar la categoría',
        disabled: esSinCategoria,
        onclick: () => seleccionar('categoria', cat.id),
      }, cat.nombre, h('span', { class: 'cuenta' }, cat.cantidad)),
      libros.length
        ? libros.map((l) => h('button', {
          type: 'button',
          class: `libro-item${sel?.tipo === 'libro' && sel.id === l.id ? ' activo' : ''}`,
          onclick: () => seleccionar('libro', l.id),
        }, l.titulo, h('span', { class: 'sig' }, l.signatura)))
        : h('div', { class: 'vacio' }, 'Sin libros todavía'),
    ));
  }
}

// ------------------------------------------------------------------ selección
function seleccionar(tipo, id, { preguntar = true } = {}) {
  if (preguntar && !confirmarSalida()) return;
  olvidarSubidas();
  errores = [];
  apoyos = [];
  pliego = 0;
  sel = { tipo, id };
  if (tipo === 'libro') {
    const guardado = id ? datos.libros.find((l) => l.id === id) : null;
    borrador = guardado ? structuredClone(guardado) : nuevoLibro(null);
    // Todos los campos presentes, para que el formulario pueda enlazarlos.
    borrador.altitud ||= { min: null, max: null };
    borrador.portada ||= { tipo: '', color: '' };
    borrador.secciones ||= [];
    borrador.notas ||= [];
    // Las láminas, cada una con su página (del formato viejo sale una «repartida»).
    borrador.imagenes = laminasDe(borrador);
    delete borrador.imagen;
  } else if (tipo === 'categoria') {
    const guardada = id ? datos.categorias.find((c) => c.id === id) : null;
    borrador = guardada ? structuredClone(guardada) : {
      id: '', nombre: '', codigo: codigoLibre(datos.categorias), descripcion: '',
      orden: Math.max(0, ...datos.categorias.map((c) => Number(c.orden) || 0)) + 1,
      columna: null, nivel: null,
    };
    if (borrador.columna === undefined) borrador.columna = null;
    if (borrador.nivel === undefined) borrador.nivel = null;
  } else if (tipo === 'disposicion') {
    // El plan de la pared: la disposición y los sitios que se van cambiando.
    moviendo = null;
    borrador = { disposicion: normalizarDisposicion(datos.biblioteca?.disposicion), sitios: {} };
  } else {
    borrador = null;
  }
  if (borrador) original = JSON.stringify(borrador);
  renderLista();
  renderPanel();
  vistaPronto(0);
}

function nuevoLibro(categoria) {
  return {
    id: '',
    categoria: categoria || datos.categorias[0]?.id || '',
    titulo: '',
    especie: '',
    autor: '',
    familia: '',
    ficha: '',
    signatura: '',
    altitud: null,
    portada: { tipo: '', color: '' },
    imagenes: [],
    secciones: [{ titulo: 'Descripción', texto: '' }],
    notas: [],
  };
}

// ------------------------------------------------------------------ formularios
function campo(etiqueta, control, { ayuda = '', obligatorio = false, contador = null, clave = '' } = {}) {
  return h('label', { class: `campo${clave && errores.some((e) => e.clave === clave) ? ' error' : ''}` },
    h('span', { class: obligatorio ? 'obligatorio' : '' }, etiqueta),
    control,
    contador,
    ayuda ? h('span', { class: 'ayuda' }, ayuda) : null);
}

// Entrada de texto enlazada a una propiedad del borrador.
function entrada(obj, prop, attrs = {}) {
  return h('input', {
    type: 'text',
    value: obj[prop] ?? '',
    ...attrs,
    oninput: (e) => {
      obj[prop] = attrs.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value;
      marcarCambio();
    },
  });
}

// Menú enlazado a una propiedad del borrador.
function selector(obj, prop, opciones, alCambiar = null) {
  return h('select', {
    onchange: (e) => {
      const valor = opciones.find((o) => String(o.valor) === e.target.value)?.valor;
      obj[prop] = valor;
      if (alCambiar) alCambiar(valor);
      marcarCambio();
      renderPanel();
    },
  }, opciones.map((o) => h('option', { value: o.valor, selected: o.valor === obj[prop] }, o.texto)));
}

function areaTexto(obj, prop, attrs = {}, alCambiar = null) {
  return h('textarea', {
    ...attrs,
    oninput: (e) => {
      obj[prop] = e.target.value;
      if (alCambiar) alCambiar(e.target.value);
      marcarCambio();
    },
  }, obj[prop] ?? '');
}

function cajaErrores() {
  if (!errores.length) return null;
  return h('div', { class: 'errores', role: 'alert' },
    h('strong', {}, 'Antes de guardar, revisa esto:'),
    h('ul', {}, errores.map((e) => h('li', {}, e.texto))));
}

function acciones({ onGuardar, onEliminar, textoEliminar, eliminarDeshabilitado = false, tituloEliminar = '' }) {
  return h('div', { class: 'acciones' },
    h('button', { type: 'button', class: 'boton principal', id: 'guardar', onclick: onGuardar, disabled: !fuente.editable }, 'Guardar'),
    h('button', {
      type: 'button',
      class: 'boton',
      onclick: () => {
        if (hayCambios() && !window.confirm('¿Descartar los cambios?')) return;
        seleccionar(sel.tipo, sel.id, { preguntar: false });
      },
    }, 'Descartar cambios'),
    h('span', { class: 'estado', id: 'estado' }, hayCambios() ? 'Cambios sin guardar' : ''),
    h('span', { class: 'espacio' }),
    onEliminar ? h('button', { type: 'button', class: 'boton peligro', onclick: onEliminar, disabled: !fuente.editable || eliminarDeshabilitado, title: tituloEliminar }, textoEliminar) : null);
}

function renderPanel() {
  const panel = $('#panel');
  panel.replaceChildren();
  if (!sel || !borrador) {
    panel.append(h('div', { class: 'inicio' },
      h('h1', {}, 'Modo bibliotecario'),
      h('p', {}, 'Elige un libro o una categoría de la lista para editarlo, o crea uno nuevo.'),
      h('p', {}, 'Cada categoría es un estante de la biblioteca. Al guardar, los libros se ordenan solos en su estante y la biblioteca se actualiza sin cerrarla.'),
      h('p', {}, 'Los estantes se acoplan entre sí: uno al lado de otro o encima. En ', h('em', {}, 'Disposición de la pared'), ' eliges dónde va cada uno.'),
      !fuente.editable ? h('p', {}, h('strong', {}, 'Ahora estás en modo de solo lectura: para guardar, abre la app de escritorio (npm start) y pulsa Ctrl+E.')) : null));
    return;
  }
  if (sel.tipo === 'libro') formLibro(panel);
  else if (sel.tipo === 'disposicion') formDisposicion(panel);
  else formCategoria(panel);
}

// ------------------------------------------------------------------ libro
function formLibro(panel) {
  const b = borrador;
  const ubic = sel.id ? describirUbicacion(org, sel.id) : `Libro nuevo · irá al estante «${nombreCategoria(b.categoria)}»`;

  // Ficha de catálogo.
  const contador = h('span', { class: 'contador' });
  const contar = (texto) => {
    contador.textContent = `${texto.length} / ${LIMITES.ficha}`;
    contador.classList.toggle('pasado', texto.length > LIMITES.ficha);
  };
  contar(b.ficha || '');
  const ficha = h('fieldset', { class: 'grupo' }, h('legend', {}, 'Ficha de catálogo'),
    campo('Título', entrada(b, 'titulo', { maxlength: LIMITES.titulo, placeholder: 'Nombre común, p. ej. Queñua' }), { obligatorio: true, clave: 'titulo' }),
    campo('Categoría (estante)', h('select', {
      onchange: (e) => {
        const antes = datos.categorias.find((c) => c.id === b.categoria);
        b.categoria = e.target.value;
        // La signatura lleva la letra de la categoría: al cambiar de estante se vuelve a asignar.
        if (antes?.codigo && (b.signatura || '').toUpperCase().startsWith(`${antes.codigo.toUpperCase()}-`)) b.signatura = '';
        marcarCambio();
        renderPanel();
      },
    }, datos.categorias.length ? null : h('option', { value: '' }, '(primero crea una categoría)'),
    datos.categorias.slice().sort((x, y) => (x.orden ?? 99) - (y.orden ?? 99)).map((c) => h('option', { value: c.id, selected: c.id === b.categoria }, c.nombre))), { obligatorio: true, clave: 'categoria' }),
    h('div', { class: 'fila' },
      campo('Nombre científico', entrada(b, 'especie', { placeholder: 'Polylepis racemosa' })),
      campo('Autor del nombre', entrada(b, 'autor', { placeholder: 'Ruiz & Pav.' })),
      campo('Familia', entrada(b, 'familia', { placeholder: 'Rosaceae' }))),
    campo('Ficha (descripción breve)', areaTexto(b, 'ficha', { rows: 3, placeholder: 'Dos o tres líneas: es lo que se lee en la tarjeta al mirar el libro.' }, contar), {
      contador,
      clave: 'ficha',
      ayuda: 'Si la dejas vacía, se usa el comienzo de la primera sección.',
    }),
    h('div', { class: 'fila' },
      campo('Altitud mínima (m)', entrada(b.altitud, 'min', { type: 'number', min: 0, max: LIMITES.altitud, step: 50 }), { clave: 'altitud' }),
      campo('Altitud máxima (m)', entrada(b.altitud, 'max', { type: 'number', min: 0, max: LIMITES.altitud, step: 50 }), { clave: 'altitud', ayuda: 'Opcional: dibuja el cerro con la franja donde vive.' })));

  // Láminas: cada imagen con la página donde va.
  const input = h('input', {
    type: 'file',
    accept: 'image/jpeg,image/png,image/webp,image/gif',
    onchange: (e) => {
      elegirImagen(e.target.files[0]);
      e.target.value = ''; // para poder volver a elegir el mismo archivo
    },
  });
  const sitios = sitiosLamina(b.secciones);
  const ocupados = new Set((b.imagenes || []).map((i) => i.en).filter((en) => en !== 'lamina'));
  const filas = (b.imagenes || []).map((lam, n) => {
    const url = subidas.get(lam.ruta)?.url || urlImagen(lam.ruta);
    const opciones = sitios.map((o) => {
      // Cada página lleva una lámina; la de página completa, todas las que quiera.
      const tomada = o.valor !== 'lamina' && o.valor !== lam.en && ocupados.has(o.valor);
      return h('option', { value: o.valor, selected: o.valor === lam.en, disabled: tomada },
        tomada ? `${o.nombre} (ya ocupada)` : o.nombre);
    });
    return h('div', { class: 'lamina-fila' },
      h('div', { class: 'imagen-muestra chica', style: url ? `background-image:url("${url}")` : '' }, url ? '' : 'sin imagen'),
      h('label', { class: 'campo' },
        h('span', {}, `Lámina ${n + 1}: en qué página va`),
        h('select', {
          onchange: (e) => {
            lam.en = e.target.value;
            mostrarLamina = lam.ruta;
            marcarCambio();
            renderPanel();
            vistaPronto(0);
          },
        }, opciones),
        h('span', { class: 'ayuda' }, ayudaSitio(lam.en, b))),
      h('button', {
        type: 'button',
        class: 'boton peligro chico',
        onclick: () => quitarLamina(n),
      }, 'Quitar'));
  });
  const sinImagen = b.lamina ? `Sin láminas se usa el dibujo incluido («${b.lamina}»).` : 'Sin láminas se dibuja una planta decorativa.';
  const muestra = h('div', {
    class: `imagen-muestra${filas.length ? ' chica' : ''}`,
    ondragover: (e) => {
      e.preventDefault();
      muestra.classList.add('arrastrando');
    },
    ondragleave: () => muestra.classList.remove('arrastrando'),
    ondrop: (e) => {
      e.preventDefault();
      muestra.classList.remove('arrastrando');
      if (e.dataTransfer.files[0]) elegirImagen(e.dataTransfer.files[0]);
    },
  }, 'Arrastra aquí una imagen');
  const lamina = h('fieldset', { class: 'grupo' }, h('legend', {}, 'Láminas'),
    filas.length ? h('div', { class: 'laminas' }, filas) : null,
    h('div', { class: 'imagen' }, muestra,
      h('div', { class: 'imagen-acciones' },
        h('button', { type: 'button', class: 'boton', onclick: () => input.click() }, filas.length ? 'Añadir otra imagen…' : 'Elegir imagen…'),
        h('span', { class: 'ayuda' }, 'JPG, PNG o WEBP. Cada lámina va en la página que elijas, impresa sobre el papel; la vista previa salta a esa página. ', filas.length ? '' : sinImagen),
        input)));

  // Tapa.
  const tipo = b.portada.tipo || '';
  const paleta = tipo === 'pergamino' ? COLORES_PERGAMINO : COLORES_CUERO;
  const radio = (valor, texto) => h('label', {},
    h('input', {
      type: 'radio',
      name: 'tipo-tapa',
      checked: tipo === valor,
      onchange: () => {
        b.portada.tipo = valor;
        const nueva = valor === 'pergamino' ? COLORES_PERGAMINO : COLORES_CUERO;
        if (!nueva.includes(b.portada.color)) b.portada.color = '';
        delete b.portada.etiqueta;
        delete b.portada.marmol;
        marcarCambio();
        renderPanel();
      },
    }), texto);
  const tapa = h('fieldset', { class: 'grupo' }, h('legend', {}, 'Tapa'),
    h('div', { class: 'tapas' }, radio('', 'Automática'), radio('cuero', 'Cuero'), radio('pergamino', 'Pergamino')),
    tipo ? h('div', { class: 'colores' },
      h('button', { type: 'button', class: `color auto${!b.portada.color ? ' activo' : ''}`, title: 'Color automático', onclick: () => elegirColor('') }),
      paleta.map((c) => h('button', { type: 'button', class: `color${b.portada.color === c ? ' activo' : ''}`, style: `background:${c}`, title: c, onclick: () => elegirColor(c) })))
      : h('span', { class: 'ayuda' }, 'Se elige una de época según el libro.'));

  // Secciones.
  const secciones = h('fieldset', { class: 'grupo' }, h('legend', {}, 'Secciones (páginas del libro)'),
    h('p', { class: 'ayuda', style: 'margin:0 0 10px' }, 'Cada sección empieza en una página nueva. Cada renglón del texto es un párrafo; si no cabe en una página, sigue en la siguiente.'),
    b.secciones.map((s, i) => h('div', { class: `seccion${errores.some((e) => e.clave === `seccion-${i}`) ? ' error' : ''}` },
      h('div', { class: 'seccion-cabeza' },
        h('span', { class: 'numero' }, `${i + 1}.`),
        entrada(s, 'titulo', { placeholder: 'Título de la sección', maxlength: LIMITES.tituloSeccion }),
        h('button', { type: 'button', class: 'boton chico', title: 'Subir', disabled: i === 0, onclick: () => moverSeccion(i, -1) }, '↑'),
        h('button', { type: 'button', class: 'boton chico', title: 'Bajar', disabled: i === b.secciones.length - 1, onclick: () => moverSeccion(i, 1) }, '↓'),
        h('button', {
          type: 'button',
          class: 'boton chico peligro',
          title: 'Quitar sección',
          onclick: () => {
            if ((s.texto || '').trim() && !window.confirm(`¿Quitar la sección «${s.titulo || i + 1}»?`)) return;
            b.secciones.splice(i, 1);
            marcarCambio();
            renderPanel();
          },
        }, '✕')),
      areaTexto(s, 'texto', { rows: 5, placeholder: 'Texto de la sección…' }))),
    h('div', { class: 'sugerencias' },
      h('button', { type: 'button', class: 'boton', onclick: () => agregarSeccion('') }, '+ Agregar sección'),
      SECCIONES_SUGERIDAS.filter((t) => !b.secciones.some((s) => s.titulo === t)).length ? h('span', {}, 'o:') : null,
      SECCIONES_SUGERIDAS.filter((t) => !b.secciones.some((s) => s.titulo === t))
        .map((t) => h('button', { type: 'button', class: 'boton chico', onclick: () => agregarSeccion(t) }, t))));

  // Notas de campo.
  const notas = { texto: (b.notas || []).join('\n') };
  const notasGrupo = h('fieldset', { class: 'grupo' }, h('legend', {}, 'Notas de campo'),
    campo('Una nota por renglón (opcional)', areaTexto(notas, 'texto', { rows: 4, placeholder: 'Ladera soleada, junto al sendero.' }, (texto) => {
      b.notas = texto.split(/\r?\n/);
    }), { ayuda: 'Van escritas «a mano» en la última página, junto a un boceto de la lámina.' }));

  // Avanzado: signatura y posición.
  const auto = sel.id ? org.libros.find((l) => l.id === sel.id)?.signatura : signaturaLibre(org, b.categoria);
  const avanzado = h('details', { class: 'grupo avanzado', open: !!b.signatura || b.orden != null },
    h('summary', {}, 'Signatura y posición en el estante'),
    h('div', { class: 'fila' },
      campo('Signatura', entrada(b, 'signatura', { placeholder: `${auto || ''} (automática)`, maxlength: 12 }), { ayuda: 'Vacía = se asigna sola con la letra de la categoría.' }),
      campo('Posición en el estante', entrada(b, 'orden', { type: 'number', min: 1, step: 1, placeholder: 'alfabética' }), { ayuda: 'Vacía = orden alfabético.' })),
    sel.id ? h('p', { class: 'ayuda', style: 'margin:6px 0 0' }, `Identificador: ${sel.id}`) : null);

  poner(panel,
    h('h1', {}, b.titulo || (sel.id ? 'Sin título' : 'Libro nuevo')),
    h('p', { class: 'ubicacion' }, ubic),
    cajaErrores(),
    ficha, lamina, tapa, secciones, notasGrupo, avanzado,
    acciones({
      onGuardar: guardarLibro,
      onEliminar: sel.id ? eliminarLibro : null,
      textoEliminar: 'Eliminar libro',
    }),
  );

  function elegirColor(c) {
    b.portada.color = c;
    delete b.portada.etiqueta;
    delete b.portada.marmol;
    marcarCambio();
    renderPanel();
  }
}

function moverSeccion(i, d) {
  const s = borrador.secciones;
  [s[i], s[i + d]] = [s[i + d], s[i]];
  marcarCambio();
  renderPanel();
}

function agregarSeccion(titulo) {
  borrador.secciones.push({ titulo, texto: '' });
  marcarCambio();
  renderPanel();
  const textos = document.querySelectorAll('.seccion');
  const ultima = textos[textos.length - 1];
  ultima?.querySelector(titulo ? 'textarea' : 'input')?.focus();
}

// Una lámina en palabras: qué hace la página que se eligió.
function ayudaSitio(en, b) {
  if (en === 'portadilla') return 'Pequeña, debajo del título y el nombre científico.';
  if (en === 'notas') {
    return (b.notas || []).some((n) => (n || '').trim())
      ? 'Como boceto al margen de las notas de campo.'
      : 'Todavía no hay notas de campo: mientras no las haya, irá en una página propia.';
  }
  if (en === 'todas') return 'Como se hacía antes: en la portadilla, en la lámina y de viñeta.';
  if (en.startsWith('seccion:')) return 'Al pie de esa sección; si no cabe, en una página propia detrás.';
  return 'Una página entera para ella, con su pie «Lám.».';
}

function quitarLamina(n) {
  const [fuera] = borrador.imagenes.splice(n, 1);
  const pendiente = fuera && subidas.get(fuera.ruta);
  if (pendiente) {
    URL.revokeObjectURL(pendiente.url);
    subidas.delete(fuera.ruta);
  }
  marcarCambio();
  renderPanel();
  vistaPronto(0);
}

// La imagen se reduce a un tamaño cómodo (1600 px como máximo) antes de subirla.
async function elegirImagen(file) {
  if (!file || sel?.tipo !== 'libro' || !borrador) return;
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
    aviso('La imagen debe ser JPG, PNG, WEBP o GIF.', 'error');
    return;
  }
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    let final = file;
    if (k < 1 || file.size > 2.5e6) {
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k);
      c.height = Math.round(bmp.height * k);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88));
      final = new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
    }
    bmp.close();
    // Se sube al guardar; hasta entonces la lámina lleva una clave temporal y
    // empieza con una página propia, que nunca choca con otra.
    const clave = `nueva:${++claveNueva}`;
    subidas.set(clave, { file: final, url: URL.createObjectURL(final) });
    borrador.imagenes = borrador.imagenes || [];
    borrador.imagenes.push({ ruta: clave, en: 'lamina' });
    mostrarLamina = clave;
    marcarCambio();
    renderPanel();
    vistaPronto(0);
  } catch (err) {
    aviso(`No se pudo abrir la imagen: ${err.message}`, 'error');
  }
}

async function guardarLibro() {
  if (guardando) return;
  const b = borrador;
  // Limpiar lo que quedó vacío antes de validar.
  b.secciones = (b.secciones || []).filter((s) => (s.titulo || '').trim() || (s.texto || '').trim());
  b.notas = (b.notas || []).map((n) => n.trim()).filter(Boolean);
  b.imagenes = (b.imagenes || []).filter((i) => (i.ruta || '').trim());
  if (b.altitud && (b.altitud.min === null || b.altitud.min === '') && (b.altitud.max === null || b.altitud.max === '')) b.altitud = null;
  if (b.orden === '' || Number.isNaN(b.orden)) b.orden = null;
  const lista = validarLibro(b, datos.categorias);
  errores = lista.map((texto) => ({ texto, clave: claveError(texto) }));
  if (errores.length) {
    renderPanel();
    $('#panel').scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  guardando = true;
  $('#guardar').disabled = true;
  $('#estado').textContent = 'Guardando…';
  try {
    // Las láminas nuevas se suben ahora: hasta aquí solo estaban elegidas.
    for (const lam of b.imagenes) {
      const pendiente = subidas.get(lam.ruta);
      if (!pendiente) continue;
      const clave = lam.ruta;
      lam.ruta = await fuente.subirImagen(pendiente.file);
      URL.revokeObjectURL(pendiente.url);
      subidas.delete(clave);
    }
    // Signatura: la que ya tiene en su estante o la primera libre de su categoría.
    if (!(b.signatura || '').trim()) {
      const actual = sel.id && datos.libros.find((l) => l.id === sel.id)?.categoria === b.categoria ? org.libros.find((l) => l.id === sel.id)?.signatura : '';
      b.signatura = actual || signaturaLibre(org, b.categoria, sel.id);
    }
    const libro = prepararLibro(b, datos);
    await fuente.guardarLibro(libro);
    olvidarSubidas();
    await cargar();
    seleccionar('libro', libro.id, { preguntar: false });
    aviso(`Guardado. ${describirUbicacion(org, libro.id)}. La biblioteca ya lo tiene en su estante.`);
  } catch (err) {
    aviso(`No se pudo guardar: ${err.message}`, 'error');
    $('#estado').textContent = 'Cambios sin guardar';
    $('#guardar').disabled = false;
  } finally {
    guardando = false;
  }
}

async function eliminarLibro() {
  const titulo = borrador.titulo || sel.id;
  if (!window.confirm(`¿Eliminar «${titulo}» de la biblioteca? Esto no se puede deshacer.`)) return;
  try {
    await fuente.eliminarLibro(sel.id);
    borrador = null;
    sel = null;
    await cargar();
    renderPanel();
    renderVista();
    aviso(`«${titulo}» se quitó de la biblioteca.`);
  } catch (err) {
    aviso(`No se pudo eliminar: ${err.message}`, 'error');
  }
}

function claveError(texto) {
  if (/hueco|columna|nivel/i.test(texto)) return 'sitio';
  if (/nombre/i.test(texto)) return 'nombre';
  if (/código/i.test(texto)) return 'codigo';
  if (/título\b/i.test(texto) && !/sección/i.test(texto)) return 'titulo';
  if (/categoría/i.test(texto)) return 'categoria';
  if (/ficha/i.test(texto)) return 'ficha';
  if (/altitud/i.test(texto)) return 'altitud';
  const m = texto.match(/sección (\d+)/i);
  if (m) return `seccion-${Number(m[1]) - 1}`;
  return '';
}

// ------------------------------------------------------------------ categoría
function formCategoria(panel) {
  const c = borrador;
  const libros = sel.id ? org.libros.filter((l) => l.cat.id === sel.id) : [];
  const estante = sel.id ? org.estantes.find((e) => e.categoria.id === sel.id) : null;
  const grupo = h('fieldset', { class: 'grupo' }, h('legend', {}, 'Categoría (un estante de la biblioteca)'),
    campo('Nombre', entrada(c, 'nombre', { maxlength: 40, placeholder: 'Plantas medicinales' }), { obligatorio: true, clave: 'nombre', ayuda: 'Es lo que se lee en la placa del estante.' }),
    h('div', { class: 'fila' },
      campo('Código', entrada(c, 'codigo', { maxlength: 3, placeholder: 'A', style: 'text-transform:uppercase' }), { clave: 'codigo', ayuda: 'Letra de las signaturas (A-101, A-102…).' }),
      campo('Orden en la sala', entrada(c, 'orden', { type: 'number', min: 1, step: 1, placeholder: 'alfabético' }), { ayuda: '1 = el primer estante, donde se empieza.' })),
    campo('Descripción', areaTexto(c, 'descripcion', { rows: 3, placeholder: 'Una frase sobre lo que hay en este estante.' }), { ayuda: 'Aparece en el cartel al mirar el estante desde el de al lado.' }));

  // Sitio en la pared: al lado de otro estante o encima de él.
  const id = c.id || '_nueva';
  // La vista previa incluye los estantes que se fijan como apoyo de este.
  const otras = datos.categorias.filter((x) => x.id !== id).map((x) => {
    const apoyo = apoyos.find((a) => a.id === x.id);
    return apoyo ? { ...x, columna: apoyo.columna, nivel: apoyo.nivel } : x;
  });
  const vista = organizar({ ...datos, categorias: [...otras, { ...c, id }] });
  const suyo = vista.estantes.find((e) => e.categoria.id === id);
  const fijo = c.columna !== null && c.columna !== undefined && c.nivel !== null && c.nivel !== undefined;
  const sitio = h('fieldset', { class: 'grupo' }, h('legend', {}, 'Sitio en la pared'),
    h('p', { class: 'ayuda', style: 'margin:0 0 10px' }, 'Elige el hueco de este estante: al lado de otro, o encima de él. Si lo dejas automático, se acomoda solo.'),
    mapaPared(vista, {
      seleccion: id,
      alSoltar: (columna, nivel) => {
        apoyos = apoyosDe(vista, columna, nivel);
        c.columna = columna;
        c.nivel = nivel;
        marcarCambio();
        renderPanel();
      },
    }),
    h('div', { class: 'pared-acciones' },
      h('button', {
        type: 'button',
        class: 'boton',
        disabled: !fijo,
        onclick: () => {
          c.columna = null;
          c.nivel = null;
          apoyos = [];
          marcarCambio();
          renderPanel();
        },
      }, 'Que se acomode solo'),
      h('span', { class: 'ayuda' }, suyo
        ? `${fijo ? 'Sitio elegido' : 'Automático'}: ${describirSitio(vista, suyo)}${suyo.desplazado ? ' (el hueco que pediste ya estaba ocupado)' : ''}${suyo.bajado ? ' (el hueco que pediste quedó en el aire, así que bajó hasta apoyarse)' : ''}`
        : ''),
      apoyos.length
        ? h('span', { class: 'ayuda' }, `Al guardar, ${apoyos.length === 1 ? 'el estante' : 'los estantes'} de debajo (${apoyos.map((a) => `«${a.nombre}»`).join(', ')}) ${apoyos.length === 1 ? 'se queda' : 'se quedan'} en su sitio para sostener a este.`)
        : null,
      errores.some((e) => e.clave === 'sitio') ? h('span', { class: 'ayuda', style: 'color:var(--rojo)' }, 'Ese hueco no existe.') : null));
  const lista = sel.id ? h('fieldset', { class: 'grupo' }, h('legend', {}, `Libros en este estante (${libros.length})`),
    libros.length
      ? h('div', {}, libros.map((l) => h('button', { type: 'button', class: 'boton chico', style: 'margin:0 6px 6px 0', onclick: () => seleccionar('libro', l.id) }, `${l.signatura} · ${l.titulo}`)))
      : h('p', { class: 'ayuda', style: 'margin:0 0 8px' }, 'Todavía no tiene libros.'),
    h('div', { style: 'margin-top:8px' }, h('button', { type: 'button', class: 'boton', onclick: () => nuevoLibroEn(sel.id) }, '+ Nuevo libro en este estante'))) : null;

  poner(panel,
    h('h1', {}, c.nombre || (sel.id ? 'Sin nombre' : 'Nueva categoría')),
    h('p', { class: 'ubicacion' }, estante
      ? `Estante ${estante.indice + 1} de ${org.estantes.length} · ${describirSitio(org, estante)}${estante.partes > 1 ? ` · ocupa ${estante.partes} estantes` : ''}`
      : 'Categoría nueva · tendrá su propio estante'),
    cajaErrores(),
    grupo,
    sitio,
    lista,
    acciones({
      onGuardar: guardarCategoria,
      onEliminar: sel.id ? eliminarCategoria : null,
      textoEliminar: 'Eliminar categoría',
      eliminarDeshabilitado: libros.length > 0,
      tituloEliminar: libros.length ? 'Primero mueve o elimina sus libros' : '',
    }),
  );
}

function nuevoLibroEn(categoria) {
  if (!confirmarSalida()) return;
  seleccionar('libro', null, { preguntar: false });
  borrador.categoria = categoria;
  original = JSON.stringify(borrador);
  renderPanel();
  vistaPronto(0);
}

async function guardarCategoria() {
  if (guardando) return;
  const c = borrador;
  c.codigo = (c.codigo || '').trim().toUpperCase();
  if (c.orden === '' || Number.isNaN(c.orden)) c.orden = null;
  const lista = validarCategoria(c, datos.categorias, normalizarDisposicion(datos.biblioteca?.disposicion).niveles);
  errores = lista.map((texto) => ({ texto, clave: claveError(texto) }));
  if (errores.length) {
    renderPanel();
    return;
  }
  guardando = true;
  $('#guardar').disabled = true;
  try {
    const anterior = sel.id ? datos.categorias.find((x) => x.id === sel.id) : null;
    const cat = prepararCategoria(c, datos);
    await fuente.guardarCategoria(cat);
    // Los estantes sobre los que se apoya se quedan fijos donde están.
    for (const apoyo of apoyos) {
      const otra = datos.categorias.find((x) => x.id === apoyo.id);
      if (!otra || (Number(otra.columna) === apoyo.columna && Number(otra.nivel) === apoyo.nivel)) continue;
      await fuente.guardarCategoria(prepararCategoria({ ...otra, columna: apoyo.columna, nivel: apoyo.nivel }, datos));
    }
    // Si cambió el código, las signaturas de sus libros cambian de letra.
    if (anterior?.codigo && anterior.codigo.toUpperCase() !== cat.codigo) {
      const viejo = `${anterior.codigo.toUpperCase()}-`;
      for (const libro of datos.libros.filter((l) => l.categoria === cat.id && (l.signatura || '').toUpperCase().startsWith(viejo))) {
        await fuente.guardarLibro({ ...libro, signatura: `${cat.codigo}-${libro.signatura.slice(viejo.length)}` });
      }
    }
    await cargar();
    seleccionar('categoria', cat.id, { preguntar: false });
    const estante = org.estantes.find((e) => e.categoria.id === cat.id);
    aviso(`Guardado. «${cat.nombre}» es el estante ${estante ? estante.indice + 1 : '?'} de ${org.estantes.length}.`);
  } catch (err) {
    aviso(`No se pudo guardar: ${err.message}`, 'error');
    $('#guardar').disabled = false;
  } finally {
    guardando = false;
  }
}

async function eliminarCategoria() {
  const nombre = borrador.nombre;
  if (!window.confirm(`¿Eliminar la categoría «${nombre}» y su estante?`)) return;
  try {
    await fuente.eliminarCategoria(sel.id);
    borrador = null;
    sel = null;
    await cargar();
    renderPanel();
    renderVista();
    aviso(`La categoría «${nombre}» se eliminó.`);
  } catch (err) {
    aviso(`No se pudo eliminar: ${err.message}`, 'error');
  }
}

// ------------------------------------------------------------------ la pared
// Mapa de la pared de estantes, visto de frente: las columnas de izquierda a
// derecha y los niveles de abajo arriba, como en la sala. Cada celda es un
// estante acoplado o un hueco donde se puede poner uno (al lado o encima). No hay
// huecos en el aire: solo se ofrece lo que descansa en el piso o sobre otro.
function mapaPared(vista, { seleccion = null, moviendoId = null, alElegir = null, alSoltar = null } = {}) {
  const { columnas, niveles } = vista.rejilla;
  const huecos = huecosLibres(vista);
  const enCelda = (c, n) => vista.estantes.find((e) => e.columna === c && e.nivel === n);
  const libre = (c, n) => !enCelda(c, n) && huecos.some((x) => x.columna === c && x.nivel === n);
  // También se puede soltar encima de un estante que se acomoda solo: al elegir
  // este sitio a mano, aquel se corre al primer hueco libre.
  const admite = (e) => !!alSoltar && e && !e.fijo && e.parte === 1 && e.categoria.id !== (moviendoId || seleccion);

  const soltar = (c, n) => {
    if (alSoltar) alSoltar(c, n);
  };
  const celdaLibre = (c, n) => {
    const celda = h('button', {
      type: 'button',
      class: 'pared-celda libre',
      title: n > 0 ? 'Encima del estante de abajo' : 'En el piso, al lado',
      disabled: !alSoltar,
      onclick: () => soltar(c, n),
      ondragover: (e) => {
        e.preventDefault();
        celda.classList.add('encima');
      },
      ondragleave: () => celda.classList.remove('encima'),
      ondrop: (e) => {
        e.preventDefault();
        celda.classList.remove('encima');
        soltar(c, n);
      },
    }, alSoltar ? (n > 0 ? 'encima' : 'al lado') : 'libre');
    return celda;
  };
  const celdaEstante = (e, c, n) => {
    const soltable = admite(e);
    const celda = h('button', {
      type: 'button',
      class: `pared-celda estante${e.categoria.id === seleccion ? ' activa' : ''}${e.categoria.id === moviendoId ? ' moviendo' : ''}`,
      title: e.parte > 1
        ? 'Continuación de la categoría: va pegada a la anterior'
        : soltable ? 'Ponerlo aquí (este se acomodará solo en otro hueco)' : alElegir ? 'Clic para moverlo de sitio' : '',
      draggable: !!alElegir && e.parte === 1,
      ondragstart: () => alElegir && alElegir(e),
      ondragover: (ev) => {
        if (!soltable) return;
        ev.preventDefault();
        celda.classList.add('encima');
      },
      ondragleave: () => celda.classList.remove('encima'),
      ondrop: (ev) => {
        if (!soltable) return;
        ev.preventDefault();
        celda.classList.remove('encima');
        soltar(c, n);
      },
      onclick: () => (soltable ? soltar(c, n) : alElegir && alElegir(e)),
    },
    h('span', { class: 'pared-nombre' }, e.rotulo),
    h('span', { class: 'pared-cuenta' }, e.libros.length === 1 ? '1 libro' : `${e.libros.length} libros`),
    e.fijo ? h('span', { class: 'pared-fijo' }, 'sitio elegido') : null);
    return celda;
  };

  const cols = [];
  for (let c = 0; c <= columnas; c++) {
    const celdas = [];
    for (let n = niveles - 1; n >= 0; n--) {
      const e = enCelda(c, n);
      if (e) celdas.push(celdaEstante(e, c, n));
      else if (libre(c, n)) celdas.push(celdaLibre(c, n));
      else celdas.push(h('div', { class: 'pared-celda aire' }));
    }
    const nueva = c === columnas;
    if (nueva && !celdas.some((x) => x.classList.contains('libre'))) continue;
    cols.push(h('div', { class: `pared-col${nueva ? ' nueva' : ''}` }, celdas,
      h('div', { class: 'pared-piso' }, nueva ? 'columna nueva' : `columna ${c + 1}`)));
  }
  return h('div', { class: 'pared' }, cols);
}

// Los estantes que sostienen a un hueco: al elegir uno «encima de…», los de
// debajo se quedan donde están. Si no, el reparto automático podría llevárselos
// y el estante recién colocado se caería al piso.
function apoyosDe(vista, columna, nivel) {
  const lista = [];
  for (let n = 0; n < nivel; n++) {
    const debajo = vista.estantes.find((e) => e.columna === columna && e.nivel === n);
    if (debajo && debajo.parte === 1) lista.push({ id: debajo.categoria.id, nombre: debajo.rotulo, columna, nivel: n });
  }
  return lista;
}

// Los datos como quedarían con el plan de la pared que se está armando.
function datosConPlan(plan) {
  return {
    ...datos,
    biblioteca: { ...(datos.biblioteca || {}), disposicion: plan.disposicion },
    categorias: datos.categorias.map((c) => (c.id in plan.sitios
      ? { ...c, ...(plan.sitios[c.id] || { columna: null, nivel: null }) }
      : c)),
  };
}

function formDisposicion(panel) {
  const b = borrador;
  const vista = organizar(datosConPlan(b));
  const { columnas, niveles } = vista.rejilla;
  const apiladas = vista.estantes.filter((e) => e.nivel > 0).length;
  const largo = (columnas - 1) * SHELF_PITCH + 2.5 + 7;
  const modo = MODOS.find((m) => m.id === b.disposicion.modo);

  const ajustes = h('fieldset', { class: 'grupo' }, h('legend', {}, 'Cómo se acoplan los estantes'),
    h('div', { class: 'fila' },
      campo('Niveles que se pueden apilar', selector(b.disposicion, 'niveles', [
        { valor: 1, texto: '1 · todos en fila, sin apilar' },
        { valor: 2, texto: '2 · uno encima de otro' },
        { valor: 3, texto: '3 · tres de alto (hace falta la escalera)' },
      ]), { ayuda: 'Apilar acorta la sala: se ven más categorías desde el mismo sitio. A los estantes de arriba se llega con la escalera.' }),
      campo('Para los estantes sin sitio elegido', selector(b.disposicion, 'modo', MODOS.map((m) => ({ valor: m.id, texto: m.nombre }))), { ayuda: modo?.ayuda || '' })));

  const mapa = h('fieldset', { class: 'grupo' }, h('legend', {}, 'La pared'),
    h('p', { class: 'ayuda', style: 'margin:0 0 10px' }, moviendo
      ? `Moviendo «${datos.categorias.find((c) => c.id === moviendo)?.nombre || ''}»: elige el hueco donde ponerlo.`
      : 'Haz clic en un estante y después en el hueco donde lo quieres (también puedes arrastrarlo). Los huecos «al lado» abren sitio en el piso; los de «encima» lo apilan sobre el de abajo.'),
    mapaPared(vista, {
      moviendoId: moviendo,
      alElegir: (e) => {
        moviendo = moviendo === e.categoria.id ? null : e.categoria.id;
        renderPanel();
      },
      alSoltar: moviendo
        ? (c, n) => {
          for (const apoyo of apoyosDe(vista, c, n)) {
            if (!b.sitios[apoyo.id]) b.sitios[apoyo.id] = { columna: apoyo.columna, nivel: apoyo.nivel };
          }
          b.sitios[moviendo] = { columna: c, nivel: n };
          moviendo = null;
          marcarCambio();
          renderPanel();
        }
        : null,
    }),
    h('div', { class: 'pared-acciones' },
      moviendo
        ? h('button', {
          type: 'button',
          class: 'boton',
          onclick: () => {
            b.sitios[moviendo] = null;
            moviendo = null;
            marcarCambio();
            renderPanel();
          },
        }, 'Que este se acomode solo')
        : null,
      moviendo ? h('button', { type: 'button', class: 'boton', onclick: () => { moviendo = null; renderPanel(); } }, 'Cancelar') : null,
      h('button', {
        type: 'button',
        class: 'boton',
        onclick: () => {
          for (const c of datos.categorias) b.sitios[c.id] = null;
          moviendo = null;
          marcarCambio();
          renderPanel();
        },
      }, 'Acomodarlos todos solos'),
      h('span', { class: 'ayuda' }, `${vista.estantes.length} estantes · ${columnas} ${columnas === 1 ? 'columna' : 'columnas'}${apiladas ? ` · ${apiladas} apilados` : ''}`)));

  poner(panel,
    h('h1', {}, 'Disposición de la pared'),
    h('p', { class: 'ubicacion' }, `La sala medirá unos ${largo.toFixed(1)} m de largo y ${(niveles * SHELF_STACK + 1.05).toFixed(1)} m de alto`),
    cajaErrores(),
    ajustes,
    mapa,
    acciones({ onGuardar: guardarDisposicion }));
}

async function guardarDisposicion() {
  if (guardando) return;
  const b = borrador;
  guardando = true;
  $('#guardar').disabled = true;
  $('#estado').textContent = 'Guardando…';
  try {
    await fuente.guardarBiblioteca({ disposicion: b.disposicion });
    // Un sitio elegido fuera de los niveles que quedan ya no existe: ese estante
    // pasa a acomodarse solo.
    for (const cat of datos.categorias) {
      if (!(cat.id in b.sitios) && Number(cat.nivel) >= b.disposicion.niveles) b.sitios[cat.id] = null;
    }
    for (const [id, sitio] of Object.entries(b.sitios)) {
      const cat = datos.categorias.find((c) => c.id === id);
      if (!cat) continue;
      const nuevo = { ...cat, columna: sitio ? sitio.columna : null, nivel: sitio ? sitio.nivel : null };
      if (Number(cat.columna ?? -1) === Number(nuevo.columna ?? -1) && Number(cat.nivel ?? -1) === Number(nuevo.nivel ?? -1)) continue;
      await fuente.guardarCategoria(prepararCategoria(nuevo, datos));
    }
    await cargar();
    seleccionar('disposicion', null, { preguntar: false });
    const { columnas, niveles } = org.rejilla;
    aviso(`Disposición guardada: ${columnas} ${columnas === 1 ? 'columna' : 'columnas'} y hasta ${niveles} ${niveles === 1 ? 'nivel' : 'niveles'}. La biblioteca ya se acomodó.`);
  } catch (err) {
    aviso(`No se pudo guardar: ${err.message}`, 'error');
    $('#estado').textContent = 'Cambios sin guardar';
    $('#guardar').disabled = false;
  } finally {
    guardando = false;
  }
}

// ------------------------------------------------------------------ vista previa
// Muestra la ficha y las páginas tal como se verán en la biblioteca, con lo que
// se está escribiendo (sin guardar).
let vistaTimer = 0;
let vistaTurno = 0;
function vistaPronto(ms = 350) {
  clearTimeout(vistaTimer);
  vistaTimer = setTimeout(renderVista, ms);
}

async function renderVista() {
  const turno = ++vistaTurno;
  const vista = $('#vista');
  if (!sel || !borrador) {
    vista.replaceChildren(h('p', { class: 'nota' }, 'Aquí se verá la ficha y las páginas del libro que edites.'));
    return;
  }
  if (sel.tipo === 'disposicion') {
    const plan = organizar(datosConPlan(borrador));
    poner(vista,
      h('h2', {}, 'Cómo quedará la sala'),
      h('p', { class: 'nota' }, plan.estantes.some((e) => e.nivel > 0)
        ? 'Los estantes apilados se alcanzan con la escalera rodante: en la biblioteca se mira el estante de arriba y se hace clic para subir (o se usan las flechas ↑ ↓).'
        : 'Todos los estantes van en fila, en el piso: se camina de uno a otro con un clic o con las flechas ← →.'),
      h('ul', { class: 'pared-resumen' }, plan.estantes.map((e) => h('li', {},
        `${e.rotulo} — `, h('span', {}, describirSitio(plan, e) + (e.bajado ? ' (bajó: su hueco quedó en el aire)' : e.desplazado ? ' (su hueco estaba ocupado)' : ''))))),
      h('p', { class: 'nota' }, 'Guarda para que la biblioteca se acomode; si está abierta, se reordena sola.'));
    return;
  }
  if (sel.tipo === 'categoria') {
    const id = borrador.id || '_nueva';
    const prueba = organizar({ ...datos, categorias: [...datos.categorias.filter((c) => c.id !== id), { ...borrador, id }] });
    const estante = prueba.estantes.find((e) => e.categoria.id === id);
    const cartel = estante ? dibujarCartel(estante, 1) : null;
    if (cartel) cartel.className = 'ficha-previa';
    poner(vista,
      h('h2', {}, 'Cartel del estante'),
      cartel,
      h('p', { class: 'nota' }, 'Así se ve el cartel cuando se mira este estante desde el de al lado. Su nombre va también en la placa de latón.'),
    );
    return;
  }
  const id = borrador.id || '_nuevo';
  // Las láminas sin subir se ven desde su archivo local (blob:).
  const laminas = (borrador.imagenes || []).map((i) => ({ ...i, ruta: subidas.get(i.ruta)?.url || i.ruta }));
  const libroVista = { ...borrador, id, imagenes: laminas, notas: (borrador.notas || []).filter((n) => n.trim()) };
  const prueba = organizar({ ...datos, libros: [...datos.libros.filter((l) => l.id !== id), libroVista] });
  const libro = prueba.libros.find((l) => l.id === id);
  if (!libro) return;
  const imagenes = await cargarImagenes(libro);
  if (turno !== vistaTurno) return;
  const caras = contarCaras(libro);
  const total = caras / 2;
  // Al elegir la página de una lámina, la vista previa se va a verla.
  if (mostrarLamina) {
    const cara = caraDeLamina(libro, subidas.get(mostrarLamina)?.url || mostrarLamina);
    if (cara >= 0) pliego = Math.floor(cara / 2);
    mostrarLamina = '';
  }
  pliego = Math.max(0, Math.min(pliego, total - 1));
  const ficha = dibujarFicha(libro);
  ficha.className = 'ficha-previa';
  const izquierda = dibujarCara(libro, pliego * 2, imagenes);
  const derecha = dibujarCara(libro, pliego * 2 + 1, imagenes);
  poner(vista,
    h('h2', {}, 'Ficha'),
    ficha,
    h('h2', { style: 'margin-top:22px' }, 'Páginas'),
    h('div', { class: 'pliego' }, izquierda, derecha),
    h('div', { class: 'pliego-nav' },
      h('button', { type: 'button', class: 'boton chico', disabled: pliego === 0, onclick: () => { pliego--; renderVista(); } }, '‹ Anterior'),
      h('span', {}, `Doble página ${pliego + 1} de ${total}`),
      h('button', { type: 'button', class: 'boton chico', disabled: pliego >= total - 1, onclick: () => { pliego++; renderVista(); } }, 'Siguiente ›')),
    h('p', { class: 'nota' }, `Así se verá en la biblioteca. El libro tiene ${caras - 2} páginas (más las guardas); la vista previa se actualiza mientras escribes.`),
  );
}

// ------------------------------------------------------------------ arranque
$('#nuevo-libro').addEventListener('click', () => {
  if (!datos.categorias.length) {
    aviso('Primero crea una categoría: cada categoría es un estante.', 'error');
    return;
  }
  const cat = sel?.tipo === 'categoria' ? sel.id : sel?.tipo === 'libro' ? borrador?.categoria : null;
  if (cat) nuevoLibroEn(cat);
  else seleccionar('libro', null);
});
$('#nueva-categoria').addEventListener('click', () => seleccionar('categoria', null));
$('#disposicion').addEventListener('click', () => seleccionar('disposicion', null));
$('#buscar').addEventListener('input', renderLista);
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (sel?.tipo === 'libro') guardarLibro();
    else if (sel?.tipo === 'categoria') guardarCategoria();
    else if (sel?.tipo === 'disposicion') guardarDisposicion();
  }
});
// Avisar al cerrar la ventana con cambios sin guardar (la app pregunta).
window.addEventListener('beforeunload', (e) => {
  if (hayCambios()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Si el contenido cambia desde fuera (otra ventana, o el archivo editado a mano),
// se recarga la lista; lo que se está escribiendo no se pierde.
fuente.alCambiar(async () => {
  if (guardando) return;
  await cargar();
  if (!hayCambios() && sel?.tipo === 'disposicion') {
    seleccionar('disposicion', null, { preguntar: false });
    return;
  }
  if (!hayCambios() && sel?.id) {
    const existe = sel.tipo === 'libro' ? datos.libros.some((l) => l.id === sel.id) : datos.categorias.some((c) => c.id === sel.id);
    if (existe) seleccionar(sel.tipo, sel.id, { preguntar: false });
    else {
      sel = null;
      borrador = null;
      renderPanel();
      renderVista();
    }
  }
});

(async () => {
  await Promise.all([
    document.fonts.load('40px "EB Garamond"'),
    document.fonts.load('italic 40px "EB Garamond"'),
    document.fonts.load('600 40px "EB Garamond"'),
    document.fonts.load('40px "IM Fell English"'),
    document.fonts.load('italic 40px "IM Fell English"'),
  ]);
  try {
    await cargar();
  } catch (err) {
    $('#panel').replaceChildren(h('div', { class: 'inicio' }, h('h1', {}, 'No se pudo leer el contenido'), h('p', {}, err.message)));
    return;
  }
  renderPanel();
  renderVista();
  // Para pruebas automáticas y para la consola (F12).
  window.__editor = {
    seleccionar,
    guardarLibro,
    guardarCategoria,
    guardarDisposicion,
    // Mover un estante a un hueco (lo mismo que hace un clic en el mapa).
    mover(categoriaId, columna, nivel) {
      if (sel?.tipo !== 'disposicion') seleccionar('disposicion', null, { preguntar: false });
      borrador.sitios[categoriaId] = columna === null ? null : { columna, nivel };
      moviendo = null;
      marcarCambio();
      renderPanel();
    },
    get borrador() {
      return borrador;
    },
    get datos() {
      return datos;
    },
    get org() {
      return org;
    },
    renderPanel,
    elegirImagen,
    // Poner la lámina n en una página (lo mismo que elegirla en el desplegable).
    ponerLamina(n, en) {
      borrador.imagenes[n].en = en;
      mostrarLamina = borrador.imagenes[n].ruta;
      marcarCambio();
      renderPanel();
      return borrador.imagenes[n];
    },
    // ¿En qué cara del libro quedó la lámina n, con lo que hay escrito ahora?
    paginaDeLamina(n) {
      const lam = borrador.imagenes[n];
      if (!lam) return -1;
      const laminas = borrador.imagenes.map((i) => ({ ...i, ruta: subidas.get(i.ruta)?.url || i.ruta }));
      const id = borrador.id || '_nuevo';
      const prueba = organizar({ ...datos, libros: [...datos.libros.filter((l) => l.id !== id), { ...borrador, id, imagenes: laminas }] });
      const libro = prueba.libros.find((l) => l.id === id);
      return libro ? caraDeLamina(libro, subidas.get(lam.ruta)?.url || lam.ruta) : -1;
    },
  };
})();

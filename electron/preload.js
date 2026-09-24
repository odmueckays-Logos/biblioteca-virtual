// Puente entre las ventanas y el almacén local (electron/almacen.js). Las páginas
// no tienen acceso a Node ni a los archivos: solo a estas funciones, que usa
// src/datos/fuente.js.
const { contextBridge, ipcRenderer } = require('electron');

// Los errores del almacén llegan como texto en `error` para conservar el mensaje.
const pedir = async (canal, ...args) => {
  const res = await ipcRenderer.invoke(canal, ...args);
  if (res && res.error) throw new Error(res.error);
  return res ? res.valor : undefined;
};

contextBridge.exposeInMainWorld('almacen', {
  leer: () => pedir('biblioteca:leer'),
  guardarBiblioteca: (biblioteca) => pedir('biblioteca:guardar-biblioteca', biblioteca),
  guardarLibro: (libro) => pedir('biblioteca:guardar-libro', libro),
  eliminarLibro: (id) => pedir('biblioteca:eliminar-libro', id),
  guardarCategoria: (cat) => pedir('biblioteca:guardar-categoria', cat),
  eliminarCategoria: (id) => pedir('biblioteca:eliminar-categoria', id),
  subirImagen: (nombre, bytes) => pedir('biblioteca:subir-imagen', nombre, bytes),
  abrirEditor: () => pedir('biblioteca:abrir-editor'),
  alCambiar(fn) {
    const oyente = () => fn();
    ipcRenderer.on('biblioteca:cambio', oyente);
    return () => ipcRenderer.removeListener('biblioteca:cambio', oyente);
  },
});

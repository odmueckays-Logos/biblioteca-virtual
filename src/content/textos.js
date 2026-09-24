// Indicaciones breves que aparecen abajo y se desvanecen solas. El contenido de
// los libros ya no está aquí: sale de la fuente de datos (datos/biblioteca.json).
export const TEXTOS_UI = {
  inicio: 'Haz clic para empezar · Mueve el mouse para mirar · Clic en un libro para tomarlo',
  lectura: 'Clic en la página para pasarla · Clic derecho o clic fuera del libro para cerrarlo (Esc también, pero suelta el mouse)',
  estantes: 'Cada estante es una categoría · Mira el de al lado y haz clic para ir (o usa ← →)',
  apilados: 'Hay estantes acoplados encima · Mira el de al lado o el de arriba y haz clic para ir (o usa ← → ↑ ↓)',
  editor: 'Ctrl+E abre el modo bibliotecario para agregar y editar libros',
  imagen: 'La tecla O abre las opciones de imagen: si la biblioteca va pesada, ahí se aligera',
  bajada: (calidad) => `La imagen bajó a ${calidad} para que vaya suelta · con la tecla O se ajusta a mano`,
  reordenando: 'Ordenando los estantes…',
};

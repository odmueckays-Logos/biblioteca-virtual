# Biblioteca Virtual · prototipo

Experiencia en primera persona en una galería de estantes antiguos. Cada estante es una categoría. El usuario mira con el mouse, va de un estante a otro, toma un libro, lo lee dentro de sus páginas y lo devuelve a su sitio.

Es una app de escritorio hecha con Electron y Three.js:

- **El contenido no está en el código.** Sale de una fuente de datos: hoy es el archivo `datos/biblioteca.json` y mañana será una base de datos.
- **Se ordena sola.** Con esos datos, la biblioteca reparte los libros en su estante, les da tomo y signatura y arma la sala.
- **Los estantes se acoplan.** Van uno al lado de otro o **uno encima de otro**, formando una pared: así se ven varias categorías desde el mismo sitio y no hay que caminar toda la galería para buscar. A los de arriba se llega con la escalera rodante. Quién va dónde se elige en el modo bibliotecario, y lo que no se elija se acomoda solo.
- **Se edita desde la app.** El **modo bibliotecario** es una ventana aparte para agregar, editar y quitar libros y categorías. Al guardar, la biblioteca se reordena sin cerrarla.
- **Se adapta a la máquina.** Con la tecla **O** se elige la calidad de imagen, y si la computadora va justa la biblioteca lo nota sola y se aligera.

Todavía no usa base de datos, cuentas ni servicios externos: todo funciona sin conexión. Está preparada para conectarse a una base de datos (ver [Conectar una base de datos](#conectar-una-base-de-datos)).

## Cómo ejecutarla

Requisito: Node.js (ya instalado).

```bash
npm install      # solo la primera vez
npm start        # abre la biblioteca
npm run editor   # abre la biblioteca y el modo bibliotecario
```

- **F11:** pantalla completa.
- **Ctrl+E:** modo bibliotecario.
- **O:** opciones de imagen (calidad, nitidez, efectos y tope de cuadros).
- **F12:** herramientas de desarrollo.

## Un ejecutable para cualquier computadora

Para llevarla a una máquina que no tiene Node.js ni nada instalado:

```bash
npm run empaquetar
```

Deja dos archivos en `dist/`, de unos 118 MB cada uno (llevan dentro Electron, Node, Three.js, las tipografías y los modelos):

| Archivo | Para qué |
|---|---|
| `Biblioteca-Virtual-portable-0.1.0.exe` | Un solo archivo: se copia a un USB, doble clic y anda. No instala nada ni pide permisos de administrador. |
| `Biblioteca-Virtual-instalador-0.1.0.exe` | Instalación normal, con acceso directo y desinstalador. Tampoco necesita administrador. |

- **El contenido va aparte.** Dentro del programa los archivos son de solo lectura, así que la biblioteca vive en `%APPDATA%\Biblioteca Virtual\datos\`: ahí están `biblioteca.json`, su respaldo y las imágenes que suba el bibliotecario. La primera vez se crea a partir de la muestra que viaja dentro del programa, así que arranca con los cuatro libros de ejemplo. Para mudar una biblioteca de una computadora a otra, se copia esa carpeta.
- **Windows va a desconfiar** la primera vez: «Windows protegió su PC» → *Más información* → *Ejecutar de todas formas*. Es porque el ejecutable no está firmado con un certificado (cuestan dinero y hay que renovarlos), no porque el programa tenga nada raro.
- Lo de `dist/` no se sube al repositorio: se publica como *release* en GitHub.

## Controles

| Acción | Cómo |
|---|---|
| Empezar | Clic en la ventana: el mouse queda capturado y ya no se sale de la app |
| Mirar alrededor | Mover el mouse; al llegar al borde, la mirada se detiene en su tope |
| Ir a otro estante | Mirar el estante de al lado (su placa brilla y aparece su cartel) y hacer clic; o las flechas ← → |
| Subir o bajar de nivel | Mirar el estante de encima (o el de debajo) y hacer clic: se empuja la escalera y se sube; o las flechas ↑ ↓ |
| Tomar un libro | Mirar un libro interactivo (brilla, sobresale y aparece su ficha) y hacer clic |
| Acelerar una animación | Clic mientras ocurre |
| Pasar página | Clic en la página derecha (adelante) o izquierda (atrás), o flechas ← → |
| Cerrar y devolver | Clic derecho o clic fuera del libro (Esc también, pero suelta el mouse) |
| Soltar el mouse | Esc (o cambiar de ventana); un clic lo vuelve a capturar, aunque el navegador lo niegue al principio |
| Ajustar la imagen | **O**: se abre el panel y el mouse queda libre para elegir; al cerrarlo vuelve a la escena |

## Opciones de imagen

Se abren con la tecla **O**. Mientras el panel está abierto el mouse queda libre para poder elegir, y al cerrarlo vuelve a la escena. Abajo del todo se leen los cuadros por segundo del momento, así que el efecto de cada cambio se ve al instante. Lo elegido se recuerda para la próxima vez.

- **Calidad:** *automática* (la biblioteca mide sola y baja un escalón si va justa), *alta*, *media*, *baja* o *mínima*. Debajo se puede afinar cada cosa por separado; al hacerlo, la calidad pasa a ser *a tu medida*.
- **Nitidez:** cuántos puntos se dibujan por cada punto de la pantalla. Es lo que más alivia a una tarjeta justa.
- **Bordes:** el suavizado de las sierras. El de la tarjeta (*bueno* y *mejor*) es el más caro; *barato* casi no cuesta.
- **Sombras**, **sombra de rincón**, **desenfoque** y **resplandor:** cada efecto se puede apagar por su cuenta.
- **Cuadros por segundo:** ponerle tope (30 o 60) hace trabajar menos a la máquina y calentar menos, sin que se note a simple vista.

La calidad *media* no apaga ningún efecto: solo dibuja menos puntos y suaviza los bordes por lo barato. Es la primera que conviene probar si la biblioteca va pesada.

## Modo bibliotecario

Se abre con **Ctrl+E** desde la biblioteca, o con `npm run editor`.

- **Categorías.** Cada categoría es un estante con su nombre en la placa de latón. Se definen el nombre, la letra de las signaturas, la descripción que aparece en el cartel del estante y el orden en la sala. Una categoría con libros no se puede borrar: antes hay que moverlos o quitarlos.
- **Sitio en la pared.** En el formulario de la categoría hay un mapa de la pared: cada celda es un estante acoplado o un hueco libre. Al hacer clic en un hueco **«al lado»** se abre sitio en el piso; en uno **«encima»** el estante se apila sobre el de abajo (que queda fijo, para sostenerlo). El botón *Que se acomode solo* vuelve a dejarlo en manos del bibliotecario automático.
- **Disposición de la pared** (botón de la barra). El mismo mapa, con todos los estantes: se hace clic en uno y después en el hueco donde se lo quiere (o se arrastra). También se elige:
  - **cuántos niveles se pueden apilar** (1, 2 o 3; con 1 la biblioteca vuelve a ser una fila);
  - **qué hacer con los que no tienen sitio elegido**: *apilar primero* (se llena una columna y recién entonces se abre otra) o *extender primero* (se ocupa toda la fila de abajo y recién entonces se apila).

  A la derecha se ve cómo quedará la sala: cuánto medirá y dónde queda cada estante.
- **Libros.** Cada libro tiene:
  - título y categoría (obligatorios);
  - nombre científico, autor y familia;
  - la **ficha** (la descripción breve que aparece al mirarlo; máximo 140 letras, con contador);
  - rango de altitud;
  - las **láminas**: imágenes que se arrastran o se eligen (si son grandes, se reducen solas), y para cada una **en qué página va**: la portadilla, una página entera para ella, dentro de una sección, las notas de campo o repartida por todo el libro. La vista previa salta a esa página al elegirla;
  - el tipo y el color de la tapa;
  - las **secciones** (cada una empieza en una página nueva; se pueden reordenar);
  - las notas de campo.
- **Vista previa.** A la derecha se ve la ficha y las páginas del libro tal como quedarán, mientras se escribe.
- **Al guardar**, el libro queda en su estante (el editor dice en cuál, en qué columna, nivel y tabla, y con qué signatura) y la biblioteca, si está abierta, se reordena con un fundido breve. Si se tiene un libro en la mano, espera a que se devuelva.
- Avisa antes de perder cambios sin guardar (al cambiar de libro o al cerrar la ventana).

También se puede editar `datos/biblioteca.json` a mano: la app nota el cambio y se reordena.

## Cómo se ordena sola

Lo hace el bibliotecario automático (`src/datos/organizar.js`):

- **Un estante por categoría**, acoplado a los demás en una pared de columnas: cada columna puede llevar uno, dos o tres estantes apilados (`biblioteca.disposicion.niveles`).
- **El sitio se elige o se calcula.** Una categoría puede fijar el suyo (`columna` y `nivel`); a las demás se les da el primer hueco libre, apilando o extendiendo según `biblioteca.disposicion.modo`. Si dos piden el mismo hueco, la primera se queda con él y la otra pasa al reparto automático (el editor lo avisa).
- **Nada queda en el aire ni a medio camino.** Un estante sin nada debajo baja hasta apoyarse, y las columnas vacías se quitan: la pared no deja huecos por el medio.
- **La sala se arma alrededor.** Se alarga con cada columna (su ventana y su estantería de fondo, con el arco al final) y crece a lo alto con los estantes apilados. Si hay alguno encima, aparece la **escalera rodante** con su riel de latón por delante de esas columnas.
- **Dentro del estante**, los libros van en orden alfabético (o en el `orden` que se les dé): la mitad en la tabla de arriba, el resto abajo, de izquierda a derecha, con libros decorativos entre ellos.
- **Si una categoría no cabe** (más de 48 libros), sigue en otro estante: «Árboles nativos · II», pegado al anterior (encima, si hay sitio).
- **Tomo y signatura.** El tomo sale de la posición en la categoría. La signatura, si falta, se calcula con la letra de la categoría: A-101, A-102…
- **Libros sin categoría válida.** Si un libro apunta a una categoría que ya no existe, va a un estante «Sin clasificar»: no se pierde.

## Estructura

```
electron/main.js           ventanas (biblioteca y modo bibliotecario) y protocolo app://
electron/almacen.js        almacén local: lee y guarda datos/ (hace de base de datos)
electron/preload.js        puente seguro entre las ventanas y el almacén
index.html, src/styles.css capas mínimas: retícula, indicaciones y velos
editor.html, src/editor/   modo bibliotecario (formulario y vista previa)
datos/biblioteca.json      el contenido: categorías y libros
datos/imagenes/            imágenes subidas desde el editor
datos/muestra.json         contenido de muestra (para volver a empezar)
datos/esquema.sql          tablas para la futura base de datos
src/datos/modelo.js        formato de los datos, valores por defecto y validaciones
src/datos/organizar.js     reparte los libros en estantes y los estantes en la pared
src/datos/fuente.js        de dónde salen los datos (aquí se conecta la base de datos)
src/main.js                arranque, armado de la sala, recorrido, entrada y recarga
src/core/                  render y postproceso, mirada con el mouse, animaciones y utilidades
src/scene/                 texturas procedurales, sala-galería, estantes acoplables, escalera y lomos
src/hands/armRig.js        brazos realistas: codo por cinemática inversa y dedos articulados
src/interaction/           mirada, ficha y cartel del estante, coreografía tomar → leer → devolver y caminar
src/reader/                libro 3D, maquetación de páginas (con paginado) y láminas
src/content/textos.js      indicaciones de la interfaz
assets/models/brazos.glb   brazos y manos recortados del avatar (con su esqueleto)
assets/textures/           piel y ropa del avatar (color, relieve y rugosidad)
tools/dev-server.py        servidor local para probar en un navegador (solo lectura)
tools/probar-disposicion.mjs prueba del acoplamiento de estantes (`npm run probar`)
```

## El formato de los datos

`datos/biblioteca.json` tiene tres partes: `biblioteca` (nombre, lema y disposición de la pared), `categorias` y `libros`. El detalle de cada campo está al principio de `src/datos/modelo.js`. Lo esencial:

```json
{
  "biblioteca": {
    "nombre": "Biblioteca del Cerro",
    "lema": "Flora andina",
    "disposicion": { "niveles": 2, "modo": "columnas" }
  },
  "categorias": [
    { "id": "arboles-nativos", "nombre": "Árboles nativos", "codigo": "A", "orden": 1, "descripcion": "…", "columna": 0, "nivel": 0 }
  ],
  "libros": [
    {
      "id": "quenua",
      "categoria": "arboles-nativos",
      "titulo": "Queñua",
      "especie": "Polylepis racemosa",
      "ficha": "Árbol de tronco retorcido…",
      "altitud": { "min": 3000, "max": 4500 },
      "imagenes": [{ "ruta": "datos/imagenes/quenua.jpg", "en": "portadilla" }],
      "secciones": [{ "titulo": "Descripción", "texto": "Primer párrafo.\nSegundo párrafo." }],
      "notas": ["Bosquete en la quebrada."]
    }
  ]
}
```

- Solo son obligatorios `id`, `categoria` y `titulo`. Lo demás se completa solo: la tapa se elige según el libro; sin láminas se usa el dibujo incluido (`lamina`) o una planta decorativa; sin ficha se usa el comienzo del texto.
- **`imagenes`** son las láminas del libro. `en` dice en qué página va cada una: `"portadilla"`, `"lamina"` (una página entera, con su pie), `"seccion:<n>"` (al pie de esa sección; si no cabe, en una página propia detrás), `"notas"` o `"todas"` (repartida, como se hacía antes). Cada página lleva una lámina, menos `"lamina"`, que admite todas las que se quiera. Los archivos con el campo viejo `"imagen": "…"` se siguen leyendo: esa imagen pasa a `"todas"`.
- **`disposicion`**: `niveles` es cuántos estantes se pueden apilar (1 a 3) y `modo` es `"columnas"` (apilar primero) o `"filas"` (extender primero). Si falta, son 2 niveles apilando primero.
- **`columna` y `nivel`** fijan el sitio del estante de esa categoría (0 = la primera columna, 0 = el nivel del piso). Van juntos: si falta uno, el estante se acomoda solo. Son posiciones relativas, no coordenadas: si se deja un hueco de columnas por el medio, la pared se junta igual.
- **Para volver al contenido de muestra**, copia `datos/muestra.json` sobre `datos/biblioteca.json`. Si `biblioteca.json` no existe, la app lo crea a partir de la muestra.
- **Respaldo.** Cada vez que se guarda, la versión anterior queda en `datos/biblioteca.json.bak`.

> Los textos de muestra son generales. Verifícalos con fuentes especializadas antes de presentarlos.

## Conectar una base de datos

La escena y el editor no leen el archivo directamente: le piden los datos a una **fuente** (`src/datos/fuente.js`). Para pasar a una base de datos basta con escribir otra fuente con los mismos métodos:

| Método | Qué hace |
|---|---|
| `cargar()` | devuelve `{ biblioteca, categorias, libros }` con el formato de arriba |
| `guardarBiblioteca(datos)` | guarda nombre, lema y disposición de la pared |
| `guardarLibro(libro)` | crea o actualiza un libro (ya viene con id, signatura y fechas) |
| `eliminarLibro(id)` | quita un libro |
| `guardarCategoria(cat)` / `eliminarCategoria(id)` | lo mismo para categorías |
| `subirImagen(archivo)` | sube la imagen y devuelve su URL (va en `imagenes[].ruta`) |
| `alCambiar(fn)` | avisa cuando el contenido cambia (para que la biblioteca se reordene sola) |
| `editable` | `true` si se puede escribir |

Pasos:

1. **Crear las tablas.** Usa `datos/esquema.sql` (PostgreSQL; sirve tal cual en Supabase) y carga el contenido de `datos/biblioteca.json`.
2. **Escribir la fuente.** Una clase en `src/datos/`, por ejemplo `FuenteSupabase`, que convierta `altitud_min`/`altitud_max` en `altitud: { min, max }`. Hay que devolverla en `crearFuente()`.
3. **Avisar de los cambios.** Para `alCambiar`, usar las suscripciones en tiempo real de la base (en Supabase, *Realtime*). Así, lo que suba cualquier bibliotecario aparece solo en todas las bibliotecas abiertas.
4. **Guardar las imágenes.** Van a un almacenamiento público de la base y en `imagenes[].ruta` se guarda la URL completa (en la base, la tabla `laminas`). El servidor debe permitir CORS, porque las páginas usan la imagen como textura.
5. **Permitir la conexión.** En la CSP de `index.html` y `editor.html`, agregar el dominio de la base en `connect-src` y en `img-src`.
6. **Proteger la escritura.** Cuando haya cuentas, leer puede ser libre, pero guardar debe exigir sesión (hay un ejemplo de reglas al final de `esquema.sql`).

Las reglas (validaciones, signaturas, orden de los estantes) están en `src/datos/`, del lado de la app, y siguen valiendo igual con la base de datos.

## Decisiones de diseño

- **La biblioteca es la interfaz.** En la experiencia no hay menús:
  - para cambiar de categoría se mira el estante de al lado y se va caminando;
  - la ficha del libro y el cartel del estante son tarjetas de papel dentro de la escena.

  El modo bibliotecario sí es un formulario, en otra ventana: es el escritorio de quien administra, no la sala de lectura.
- **Una pared, no un pasillo interminable.** Si cada categoría abriera una columna nueva, buscar sería caminar: con diez categorías, diez estantes en fila. Por eso los estantes se acoplan también hacia arriba (`src/datos/organizar.js`): dos niveles bastan para ver el doble de categorías desde el mismo sitio, y quien ordena la biblioteca decide qué va con qué. El reparto automático no deja estantes flotando ni columnas vacías, así la pared siempre es una pared.
- **Caminar y subir.** Se va de una columna a otra caminando, con la cabeza vuelta hacia el destino y el paso marcado; a los estantes de arriba se sube por la escalera rodante, peldaño a peldaño y con el balanceo del que se agarra a los largueros. La luz de la ventana acompaña: el sol y sus sombras siguen al usuario y el haz de la ventana pasa de una columna a la otra a mitad de camino (`src/scene/room.js`).
- **La escalera es de verdad.** Cuelga de un riel de latón que corre por delante de las columnas apiladas, rueda hasta donde se la necesita y, al tomar un libro desde arriba, se empuja sola hasta quedar enfrente (`src/scene/escalera.js`). Subido a ella, el estante queda a un brazo de distancia: la cabeza mira más de frente, se gira más y las tarjetas se achican para no tapar media pantalla.
- **Libros ligeros en el estante.** En el estante, un libro solo lleva un lomo pequeño y no dibuja lo que está tapado (páginas, guardas, interior del lomo). La tapa con sus dorados y el lomo grande se dibujan al tomarlo y se liberan al devolverlo. Las páginas se generan cerca de la que se lee. Con 180 libros la biblioteca sigue por encima de 50 cuadros por segundo.
- **Maquetación automática, láminas a mano.** Cada sección empieza en una página nueva: si es corta va con letra grande; si no cabe, sigue en las páginas siguientes con letra de lectura. Donde queda sitio se ponen el cerro de altitudes y un ornamento. Las **láminas**, en cambio, no las coloca el programa: van donde las puso el bibliotecario, porque una foto suele ser de algo —de la flor, de la chacra, de la hoja— y solo él sabe al lado de qué texto tiene sentido. Si la que eligió para una sección no cabe al pie, no se mueve de sitio ni desaparece: se le da la página siguiente, con su pie diciendo de qué sección viene. Las imágenes subidas se imprimen sobre el papel, con un tono algo envejecido (`src/reader/pageRenderer.js`).
- **Manos reales.** Los brazos salen de un avatar de Microsoft Rocketbox: se recortan sus brazos y manos, y el codo se resuelve por cinemática inversa, de modo que hombro, codo y muñeca se mueven como en un brazo humano.
- **La muñeca no se quiebra.** La torsión la hace el antebrazo (pronación y supinación) y a la muñeca solo le queda flexionarse y desviarse, con topes humanos (`MAX_TWIST` y `MAX_WRIST` en `src/hands/armRig.js`). La mano se orienta siguiendo la línea del antebrazo.
- **Los dedos se doblan hacia la palma.** El eje de flexión de cada falange se calcula de la geometría del modelo como (dirección del hueso) × (normal de la palma), y se gira en positivo (`applyFingers` en `src/hands/armRig.js`).
- **Dónde se para el usuario.** El paso hacia el estante se calcula con el largo real del brazo: el hombro derecho queda casi enfrente del libro y a una distancia en la que se llega con el codo algo doblado. Funciona igual en cualquier estante y nivel (en el de abajo, además, se agacha).
- **Movimiento humano.** Las trayectorias usan un perfil de mínimo tirón, la mano se abre antes de agarrar, cada dedo entra con un retardo distinto, la vista se adelanta a la mano y el libro arrastra algo de inercia. El ritmo general se cambia con `RITMO` en `src/interaction/sequence.js`.
- **El mouse no se sale.** Se captura con el bloqueo de puntero (Pointer Lock), como en los juegos en primera persona (`src/main.js`, sección «entrada»). Esc lo suelta —lo hace el navegador, no se puede impedir— y entonces Chromium no deja volver a capturarlo durante casi un segundo: si el usuario hace clic en ese rato, la petición se rechaza en silencio y el mouse se queda fuera. Por eso, desde ese clic la app insiste unos segundos hasta que el navegador acepta. Mientras el usuario no haga clic, el mouse sigue libre a propósito, para poder usar la ventana o cambiar de programa. Por eso también la indicación de lectura ofrece primero el clic derecho: cerrar el libro así no suelta el mouse.
- **Al volver del modo bibliotecario, el mouse vuelve solo.** Abrir la otra ventana le quita el foco a la escena y el navegador suelta el mouse, que es lo correcto: en el editor hace falta. Al cerrarla, la escena lo recupera en cuanto el mouse se mueve por encima. Para saber si el usuario lo soltó a propósito o se lo quitó otra ventana, se mira el foco: del Esc el navegador no avisa —se lo queda él—, pero si la ventana conserva el foco es que fue el usuario, y entonces el mouse se queda libre hasta el siguiente clic. Los permisos del navegador (capturar el mouse, pantalla completa) son de la sesión, no de la ventana, y se ponen una sola vez para toda la app: cuando cada ventana ponía los suyos, abrir el modo bibliotecario le quitaba a la escena el permiso de capturar el mouse y ya no lo recuperaba nunca.
- **Lo que cuesta caro, medido.** `npm run medir` apaga y enciende cada cosa y mide los cuadros por segundo con la escena quieta y con un libro en la mano. En una AMD RX 6550M a 1536×794 (pantalla al 1,25) salió: todo encendido **93**, sin sombra de rincón 119, con bordes baratos 144 (el tope de la pantalla), a nitidez 1 también 144. O sea: lo caro es el suavizado de la tarjeta, la nitidez por encima de 1 y la sombra de rincón; las sombras del sol y el resplandor casi no pesan. Con esos números se arman las calidades del panel, y por eso *media* no apaga ningún efecto: solo dibuja menos puntos.
- **Lo borroso se calcula pequeño.** La sombra de rincón se calcula a **media resolución** y se estira: es una mancha suave, en la imagen no se distingue (se comparó píxel a píxel) y el ahorro fue de 75 a 93 cuadros por segundo. El desenfoque se probó igual y no ganaba nada. El resplandor también se probó, y ahí salió mal: calculado pequeño su halo se ensancha al estirarlo y **emborronaba los carteles de los estantes** hasta dejarlos ilegibles; como solo ahorraba un cuadro por segundo, se dejó entero. La lección: bajarle la resolución a un efecto no solo lo hace más barato, también lo hace más ancho.
- **El papel no debe brillar.** El cartel del estante es papel casi blanco con algo de luz propia para que se lea dentro del estante, que está en sombra. Con demasiada, al sol pasaba el umbral del resplandor y su propio halo se comía el texto: la emisión bajó a 0,26 y el umbral del resplandor subió a 1,5, de modo que resplandece la ventana y no el papel.
- **Las sombras se congelan.** Con la escena quieta no hay nada que mover, así que el mapa de sombras no se vuelve a dibujar: se marca para actualizar cuando alguien camina, sube, toma un libro o cambia la luz (`shadowMap.autoUpdate` en `src/main.js`). Los primeros cuadros se dibujan sí o sí: si el mapa no llega a crearse, la sala sale negra.
- **Tope de cuadros.** Poner tope no es dormir el bucle: se cuenta el próximo cuadro de tope en tope, porque con «han pasado 16 ms» y una pantalla de 144 Hz un tope de 60 daría 48.
- **Calidad automática.** Si dos medidas seguidas bajan de 42 cuadros por segundo, se baja un escalón (alta → media → baja) y se avisa con un cartel; de ahí en adelante decide el usuario en el panel (`CALIDADES` en `src/core/renderer.js`).
- **Los complementos de Three.js viajan al lado.** El postprocesado y el cargador de modelos viven en `node_modules/three/examples/jsm`, y el empaquetador descarta por su cuenta cualquier carpeta `examples` de `node_modules`: sin ellos la app se quedaba para siempre en la portada, sin un solo error en pantalla. Se copian aparte, a `resources/three-addons`, y el servidor de archivos los busca ahí cuando la app está empaquetada (`deDonde` en `electron/main.js`).
- **Los archivos se sirven con `fs`.** La app carga sus módulos, tipografías y modelos por el protocolo `app://`. Al empaquetarla, todo eso queda dentro de `app.asar`, que el cargador de red de Chromium no sabe abrir: la ventana salía negra con «archivo no encontrado». Se leen con `fs` (que sí entiende el asar) y se devuelven con su tipo de contenido a mano, porque un módulo servido como «datos sin más» el navegador no lo ejecuta.
- **Todo procedural.** Madera, piedra, cuero, papel, lomos, páginas e ilustraciones se generan en canvas al iniciar; las únicas imágenes son las que sube el bibliotecario.

## Herramientas de desarrollo

- `npm run empaquetar` arma los ejecutables de Windows en `dist/` (instalador y portátil).
- `npm run medir` (o `electron . --medir`) mide los cuadros por segundo apagando y encendiendo cada efecto, con la escena quieta y con un libro en la mano, e imprime una tabla con la tarjeta gráfica y el tamaño de la ventana.
- `npm run probar` comprueba el acoplamiento de los estantes (sitios elegidos, apilado automático, huecos libres) y las reglas de las láminas (qué página les toca) sin abrir la app.
- `npm run debug` abre la app con `window.__biblioteca` en la consola (F12). `__biblioteca.irA(2)` va al estante 3 (caminando o por la escalera); `__biblioteca.pared()` muestra en qué columna y nivel quedó cada uno; `__biblioteca.tomar('quenua')` toma un libro.
- `electron . --datos=carpeta` usa otra carpeta de contenido: sirve para probar sin tocar `datos/`.
- `electron . --demo` toma un libro del primer estante, pasa una página y mide los fps y las llamadas de dibujo.
- `electron . --probar-editor --datos=copia --capturas=carpeta` recorre el flujo del bibliotecario sobre una copia del contenido:
  - crea una categoría y un libro con tres láminas, cada una en una página distinta (portadilla, página propia y viñeta al pie de una sección);
  - espera a que la biblioteca se reordene;
  - va al estante nuevo, toma el libro y pasa páginas;
  - acopla un estante encima de otro, sube la escalera, lee desde arriba y vuelve a bajar;
  - deja la pared en un solo nivel y comprueba que todos vuelven a la fila;
  - guarda capturas.
- `electron . --probar-puntero` comprueba que el mouse queda capturado, que la mirada llega a sus topes, que tras un Esc la app lo recupera aunque el clic llegue enseguida, que al entrar y salir del modo bibliotecario vuelve a quedar dentro de la escena, y que el panel de imagen lo suelta al abrirse y lo recupera al cerrarse.
- `electron . --capture=foto.png` guarda una captura de la ventana y cierra; con `--tecla=o` pulsa antes esa tecla (sirve para fotografiar el panel de imagen). `CAPTURE_DELAY` cambia la espera.
- `electron . --capture=salida.png` guarda una captura de la ventana y cierra.
- `python tools/dev-server.py 5173` sirve el proyecto en `http://localhost:5173/?debug`. En el navegador, el contenido es de solo lectura: el editor (`/editor.html`) muestra la vista previa, pero para guardar hace falta la app de escritorio.
- Con el servidor en marcha:
  - `tools/preparar-brazos.html` vuelve a recortar los brazos del avatar (solo si cambias de avatar);
  - `tools/ver-brazos.html` muestra el modelo;
  - `tools/probar-brazos.html` prueba poses.

## Licencias de terceros

- Three.js: MIT.
- Fuentes EB Garamond e IM Fell English (Fontsource): OFL 1.1.
- Avatar de brazos y manos: Microsoft Rocketbox (`Business_Male_01`), MIT © Microsoft (ver `assets/models/LICENSE-rocketbox.md`). El archivo original está en `assets/models/_fuente/`.

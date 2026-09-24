// Escalera de biblioteca: corre sobre un riel de latón atornillado por encima de
// los estantes y sirve para llegar a los cuerpos apilados. Se desliza de una
// columna a otra (`setX`) y, cuando el usuario está subido, la escalera va con él.
//
// La geometría está en un marco local con el pie en el origen y el eje +Y a lo
// largo de los largueros; el grupo se inclina para que la cabeza quede apoyada en
// el riel, como una escalera de verdad.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SHELF } from './bookshelf.js';

export const ESCALERA = {
  inclinacion: 18 * (Math.PI / 180), // separación del pie respecto a la vertical
  ancho: 0.46, // entre largueros
  paso: 0.28, // entre peldaños
  rielDz: 0.1, // el riel, por delante de la cara del estante
  rielDy: 0.09, // justo por encima de la cornisa (deja libre la placa del estante)
};

// Caja con UV en metros (la veta sigue el lado más largo), como en bookshelf.js.
function board(w, h, d, x, y, z, texScale = 1 / 1.2) {
  const g = new THREE.BoxGeometry(w, h, d);
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i) + x;
    const py = pos.getY(i) + y;
    const pz = pos.getZ(i) + z;
    const ax = Math.abs(nrm.getX(i));
    const ay = Math.abs(nrm.getY(i));
    let a;
    let b;
    let la;
    let lb;
    if (ax > 0.5) {
      a = pz; b = py; la = d; lb = h;
    } else if (ay > 0.5) {
      a = px; b = pz; la = w; lb = d;
    } else {
      a = px; b = py; la = w; lb = h;
    }
    if (la >= lb) uv.setXY(i, a * texScale, b * texScale);
    else uv.setXY(i, b * texScale, a * texScale + 0.37);
  }
  g.translate(x, y, z);
  return g;
}

// `alto` es la altura de la pared de estantes; `x0`/`x1`, hasta dónde llega el riel.
export function buildLadder({ woodMat, woodDarkMat, alto, x0, x1, apoyos = [] }) {
  const group = new THREE.Group();
  group.name = 'escalera';
  const disposables = [];
  const E = ESCALERA;
  const rielY = alto + E.rielDy;
  const rielZ = SHELF.frontZ + E.rielDz;
  const tan = Math.tan(E.inclinacion);
  const largo = rielY / Math.cos(E.inclinacion) + 0.12; // sobresale un poco del riel
  const pieZ = rielZ + rielY * tan;

  const brass = new THREE.MeshStandardMaterial({ color: 0x8a7443, metalness: 0.85, roughness: 0.33 });
  disposables.push(brass);

  // ------------------------------------------------------------------ riel
  // El riel pasa de largo las columnas de los extremos: así la escalera alcanza
  // también los libros del borde y puede aparcarse en el hueco de al lado.
  const VUELO = 1.7;
  const riel = new THREE.Group();
  const tubo = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, x1 - x0 + 2 * VUELO, 12), brass);
  tubo.rotation.z = Math.PI / 2;
  tubo.position.set((x0 + x1) / 2, rielY, rielZ);
  tubo.castShadow = true;
  riel.add(tubo);
  disposables.push(tubo.geometry);
  // Soportes: uno sobre cada columna, atornillado a la cornisa de su estante más
  // alto. Cada columna puede tener distinta altura, así que el pie baja hasta la
  // suya (`apoyos`: { x, alto }).
  const soportes = [];
  for (const apoyo of apoyos) {
    const x = typeof apoyo === 'number' ? apoyo : apoyo.x;
    const suelo = typeof apoyo === 'number' ? alto : apoyo.alto;
    const altoSoporte = Math.max(0.12, rielY - suelo + 0.06);
    soportes.push(board(0.05, altoSoporte, E.rielDz + 0.06, x, rielY - altoSoporte / 2 + 0.03, rielZ - E.rielDz / 2 - 0.03, 1 / 0.6));
    soportes.push(board(0.07, 0.07, 0.07, x, rielY, rielZ, 1 / 0.6));
  }
  if (soportes.length) {
    const malla = new THREE.Mesh(mergeGeometries(soportes), brass);
    malla.castShadow = true;
    riel.add(malla);
    disposables.push(malla.geometry);
    for (const g of soportes) g.dispose();
  }
  group.add(riel);

  // ------------------------------------------------------------------ escalera
  // Todo lo que rueda va en un grupo que se mueve en x.
  const carro = new THREE.Group();
  carro.name = 'carro';
  group.add(carro);
  const cuerpo = new THREE.Group();
  cuerpo.rotation.x = -E.inclinacion;
  cuerpo.position.set(0, 0, pieZ);
  carro.add(cuerpo);

  const maderas = [];
  const oscuras = [];
  // Largueros, con el canto superior recortado.
  for (const s of [-1, 1]) {
    maderas.push(board(0.052, largo, 0.034, s * (E.ancho / 2), largo / 2, 0));
    maderas.push(board(0.03, 0.09, 0.05, s * (E.ancho / 2), largo - 0.05, 0.008)); // refuerzo de la cabeza
  }
  // Peldaños: tablas planas, la de abajo un poco más gruesa.
  const peldanos = [];
  for (let y = 0.19; y < largo - 0.3; y += E.paso) peldanos.push(y);
  peldanos.forEach((y, i) => {
    oscuras.push(board(E.ancho + 0.02, i === 0 ? 0.034 : 0.028, 0.085, 0, y, 0.026));
    // Travesaño fino detrás del peldaño (como los tirantes de las escaleras viejas).
    if (i % 2 === 1) maderas.push(board(E.ancho - 0.02, 0.018, 0.018, 0, y - 0.09, -0.012));
  });

  const madera = new THREE.Mesh(mergeGeometries(maderas), woodMat);
  madera.castShadow = true;
  madera.receiveShadow = true;
  cuerpo.add(madera);
  const escalones = new THREE.Mesh(mergeGeometries(oscuras), woodDarkMat || woodMat);
  escalones.castShadow = true;
  escalones.receiveShadow = true;
  cuerpo.add(escalones);
  disposables.push(madera.geometry, escalones.geometry);
  for (const g of [...maderas, ...oscuras]) g.dispose();

  // Herrajes: ruedas que cuelgan del riel arriba y ruedecillas abajo.
  const herrajes = [];
  for (const s of [-1, 1]) {
    const gancho = new THREE.CylinderGeometry(0.052, 0.052, 0.022, 14);
    gancho.rotateZ(Math.PI / 2);
    gancho.translate(s * (E.ancho / 2), rielY, rielZ);
    herrajes.push(gancho);
    const brazo = new THREE.BoxGeometry(0.026, 0.14, 0.03);
    brazo.translate(s * (E.ancho / 2), rielY - 0.07, rielZ + 0.035);
    herrajes.push(brazo);
    const rueda = new THREE.CylinderGeometry(0.038, 0.038, 0.026, 12);
    rueda.rotateZ(Math.PI / 2);
    rueda.translate(s * (E.ancho / 2), 0.038, pieZ - 0.01);
    herrajes.push(rueda);
  }
  const metal = new THREE.Mesh(mergeGeometries(herrajes), brass);
  metal.castShadow = true;
  carro.add(metal);
  disposables.push(metal.geometry);
  for (const g of herrajes) g.dispose();

  const limites = { x0: x0 - VUELO + 0.08, x1: x1 + VUELO - 0.08 };
  const estado = { x: 0 };
  // Aparcada, la escalera se deja en el hueco de muro de al lado, para que no
  // tape el frente de ningún estante.
  const aparcadero = (x) => (x - 1.57 >= limites.x0 ? x - 1.57 : x + 1.57);

  return {
    group,
    carro,
    rielY,
    rielZ,
    // Dónde queda el pie del que sube, a la altura `h` de la escalera.
    zPie(h) {
      return pieZ - h * tan;
    },
    // Primer peldaño a esa altura o más arriba (el pie no queda nunca en el aire).
    peldanoDesde(h) {
      const alturas = peldanos.map((y) => y * Math.cos(E.inclinacion));
      return alturas.find((y) => y >= h) ?? alturas[alturas.length - 1] ?? 0;
    },
    get x() {
      return estado.x;
    },
    // Dónde se la deja para que no tape el frente del estante.
    aparcadero,
    aparcar(x) {
      this.setX(aparcadero(x));
    },
    setX(x) {
      estado.x = Math.min(limites.x1, Math.max(limites.x0, x));
      carro.position.x = estado.x;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

// Sala: una galería de muros de sillería con ventanas y un arco, piso de tablones,
// vigas, estanterías de fondo llenas de libros (instanciados), luces, haz de luz
// y polvo. Se alarga sola según cuántas columnas de estantes haya: cada columna
// tiene su ventana a la izquierda y su estantería alta detrás, y el arco queda al
// final. Si los estantes se apilan, la sala crece también a lo alto: el techo, las
// vigas y las ventanas suben con la pared.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { createNoise2D, mulberry32 } from '../core/math.js';
import { canvasTexture, makeCanvas } from './textures.js';
import { farBookGeometry } from './books.js';

// Medidas respecto al centro de cada columna de estantes (x = s).
export const ROOM = {
  z0: -5.6, // muro del fondo (cara interior)
  z1: 2.2,
  height: 4.3, // altura mínima; crece si la pared de estantes es alta
  left: 3.4, // del centro de la primera columna al muro izquierdo
  right: 3.6, // del centro de la última columna al muro derecho
  window: { dx: -2.15, w: 1.2, y0: 2.05, bajo: 0.75 }, // una por columna, a su izquierda
  arch: { dx0: 1.75, dx1: 2.95, springY: 2.2 }, // tras la última columna
  hueco: 1.03, // muro libre entre dos columnas (ahí va la ventana)
};

// Alto de la sala y forma de la ventana para una pared de estantes de `alto`
// metros. Con estantes apilados la ventana se angosta para caber entre columnas.
export function roomShape(alto = 0) {
  const height = Math.max(ROOM.height, alto + 1.05);
  const apilado = alto > 1.6;
  return {
    height,
    window: {
      ...ROOM.window,
      w: apilado ? Math.min(ROOM.window.w, ROOM.hueco - 0.1) : ROOM.window.w,
      y1: height - ROOM.window.bajo,
    },
  };
}

export function roomExtent(stations) {
  return { x0: stations[0] - ROOM.left, x1: stations[stations.length - 1] + ROOM.right, z0: ROOM.z0, z1: ROOM.z1 };
}

// Proyección de caja: UV en metros según la orientación de cada cara.
function boxUV(geometry, scale = 1 / 2.4, offset = [0, 0]) {
  const pos = geometry.getAttribute('position');
  const nrm = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv') || new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nrm.getX(i));
    const ny = Math.abs(nrm.getY(i));
    let u;
    let v;
    if (nx > 0.5) {
      u = pos.getZ(i);
      v = pos.getY(i);
    } else if (ny > 0.5) {
      u = pos.getX(i);
      v = pos.getZ(i);
    } else {
      u = pos.getX(i);
      v = pos.getY(i);
    }
    uv.setXY(i, u * scale + offset[0], v * scale + offset[1]);
  }
  geometry.setAttribute('uv', uv);
  return geometry;
}

function box(w, h, d, x, y, z, scale) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return boxUV(g, scale);
}

function skyTexture() {
  const { canvas, ctx } = makeCanvas(256, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#dfe9f2');
  g.addColorStop(0.55, '#fbf4e6');
  g.addColorStop(1, '#fff0d4');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 512);
  const noise = createNoise2D(9);
  const img = ctx.getImageData(0, 0, 256, 512);
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 256; x++) {
      const c = noise.fbm(x / 70, y / 45, 4);
      const k = 1 + (c - 0.5) * 0.12;
      const i = (y * 256 + x) * 4;
      img.data[i] *= k;
      img.data[i + 1] *= k;
      img.data[i + 2] *= k * 1.01;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvasTexture(canvas, { srgb: true, repeat: false });
}

// Estantería de fondo: marco fusionado + libros como instancias.
function farBookcase({ width, height, depth, shelves, fill, seed, cap = true }) {
  const rand = mulberry32(seed);
  const parts = [];
  const post = 0.06;
  const board = 0.032;
  const base = 0.1;
  parts.push(box(width, base, depth, 0, base / 2, -depth / 2, 1 / 1.2));
  for (const s of [-1, 1]) parts.push(box(post, height, depth, s * (width / 2 - post / 2), height / 2, -depth / 2, 1 / 1.2));
  if (cap) parts.push(box(width + 0.08, 0.06, depth + 0.05, 0, height + 0.03, -depth / 2 + 0.025, 1 / 1.2));
  parts.push(box(width - 2 * post, height - base, 0.015, 0, base + (height - base) / 2, -depth + 0.008, 1 / 1.2));
  const inner = width - 2 * post;
  const spacing = (height - base - 0.02) / shelves;
  const books = [];
  for (let s = 0; s < shelves; s++) {
    const y = base + s * spacing;
    parts.push(box(inner, board, depth - 0.02, 0, y + board / 2, -depth / 2 + 0.01, 1 / 1.2));
    const floorY = y + board;
    const maxH = spacing - board - 0.025;
    let x = -inner / 2 + 0.005;
    let trend = maxH * (0.62 + rand() * 0.33);
    let skip = rand() > fill ? inner * (0.2 + rand() * 0.6) : 0;
    const skipAt = -inner / 2 + rand() * inner;
    while (x < inner / 2 - 0.02) {
      if (skip > 0 && x > skipAt) {
        x += skip;
        skip = 0;
        continue;
      }
      if (rand() < 0.15) trend = maxH * (0.6 + rand() * 0.36);
      const H = Math.min(maxH, trend + (rand() - 0.5) * 0.04);
      const T = 0.018 + Math.pow(rand(), 1.7) * 0.05;
      if (x + T > inner / 2 - 0.004) break;
      const W = Math.min(depth - 0.05, H * (0.6 + rand() * 0.2));
      books.push({ x: x + T / 2, y: floorY, z: -0.02 - rand() * 0.02, T, H, W, lean: (rand() - 0.5) * 0.02 });
      x += T + 0.0015 + (rand() < 0.03 ? 0.02 : 0);
    }
  }
  const frame = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  return { frame, books };
}

// Reflejos del entorno, niebla y fondo: se preparan una sola vez.
export function buildEnvironment(scene, renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
  scene.environmentIntensity = 0.32;
  scene.fog = new THREE.FogExp2(0x1d160f, 0.052);
  scene.background = new THREE.Color(0x0d0a07);
  pmrem.dispose();
}

let rectLightsReady = false;

// `stations`: la x del centro de cada columna, de izquierda a derecha. `alto`: la
// altura de la pared de estantes (una columna apilada necesita más sala).
export function buildRoom({ stone, plaster, wood, floor, spineAtlas, atlasTextures, stations, alto = 0 }) {
  if (!rectLightsReady) {
    RectAreaLightUniformsLib.init();
    rectLightsReady = true;
  }
  const { x0, x1 } = roomExtent(stations);
  const forma = roomShape(alto);
  const R = { ...ROOM, ...forma, x0, x1 };
  const last = stations[stations.length - 1];
  const group = new THREE.Group();
  group.name = 'sala';
  const translucent = [];
  const disposables = [];
  const keep = (thing) => {
    disposables.push(thing);
    return thing;
  };
  const add = (mesh) => {
    group.add(mesh);
    disposables.push(mesh.geometry);
    return mesh;
  };

  // ---------------------------------------------------------------- materiales
  const stoneMat = keep(new THREE.MeshStandardMaterial({
    map: stone.map,
    bumpMap: stone.surface,
    bumpScale: 2.2,
    roughnessMap: stone.surface,
    roughness: 1,
    metalness: 0,
    color: 0xcdc3b1,
  }));
  const plasterMat = keep(new THREE.MeshStandardMaterial({
    map: plaster.map,
    bumpMap: plaster.surface,
    bumpScale: 0.6,
    roughness: 0.95,
    color: 0xcfc3ad,
  }));
  const beamMat = keep(new THREE.MeshStandardMaterial({
    map: wood.map,
    bumpMap: wood.surface,
    bumpScale: 1.2,
    roughnessMap: wood.surface,
    roughness: 1,
    color: 0x7a6656,
  }));
  const caseMat = keep(new THREE.MeshStandardMaterial({
    map: wood.map,
    bumpMap: wood.surface,
    bumpScale: 1.0,
    roughnessMap: wood.surface,
    roughness: 0.95,
    color: 0xb59a86,
  }));
  const floorMat = keep(new THREE.MeshStandardMaterial({
    map: floor.map,
    bumpMap: floor.surface,
    bumpScale: 1.4,
    roughnessMap: floor.surface,
    roughness: 0.9,
    color: 0xffffff,
    vertexColors: true,
  }));

  // ---------------------------------------------------------------- piso
  const fw = R.x1 - R.x0;
  const fd = R.z1 - R.z0;
  const floorGeo = new THREE.PlaneGeometry(fw, fd, Math.ceil(fw * 8), 64);
  floorGeo.rotateX(-Math.PI / 2);
  floorGeo.translate((R.x0 + R.x1) / 2, 0, (R.z0 + R.z1) / 2);
  {
    const pos = floorGeo.getAttribute('position');
    const uv = floorGeo.getAttribute('uv');
    const colors = new Float32Array(pos.count * 3);
    const noise = createNoise2D(77);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      uv.setXY(i, x / 2.4, -z / 2.4);
      const macro = noise.fbm(x * 0.35, z * 0.35, 4);
      // Zonas más gastadas (claras) en el paso hacia cada estante y a lo largo de
      // la galería; más oscuras junto a los muros.
      let path = 0;
      for (const s of stations) path = Math.max(path, Math.exp(-Math.pow((x - s - 0.3) / 1.6, 2)) * 0.12);
      if (stations.length > 1) path = Math.max(path, Math.exp(-Math.pow((z + 0.35) / 1.4, 2)) * 0.09);
      const wallDist = Math.min(x - R.x0, R.x1 - x, z - R.z0, R.z1 - z);
      const nearWall = 1 - Math.exp(-wallDist * 1.6);
      const k = (0.78 + macro * 0.36 + path) * (0.55 + 0.45 * nearWall);
      colors[i * 3] = k * 1.02;
      colors[i * 3 + 1] = k;
      colors[i * 3 + 2] = k * 0.97;
    }
    floorGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  add(new THREE.Mesh(floorGeo, floorMat)).receiveShadow = true;

  // ---------------------------------------------------------------- muros
  const W = R.window;
  const winW = W.w;
  const winH = W.y1 - W.y0;
  const winCy = (W.y0 + W.y1) / 2;
  const windows = stations.map((s) => s + W.dx);
  const A = { x0: last + R.arch.dx0, x1: last + R.arch.dx1, springY: R.arch.springY };
  const archR = (A.x1 - A.x0) / 2;
  const archCx = (A.x0 + A.x1) / 2;
  const wallShape = new THREE.Shape();
  wallShape.moveTo(R.x0 - 0.4, 0);
  wallShape.lineTo(R.x1 + 0.4, 0);
  wallShape.lineTo(R.x1 + 0.4, R.height + 0.1);
  wallShape.lineTo(R.x0 - 0.4, R.height + 0.1);
  wallShape.closePath();
  for (const wx of windows) {
    const win = new THREE.Path();
    win.moveTo(wx - winW / 2, W.y0);
    win.lineTo(wx - winW / 2, W.y1);
    win.lineTo(wx + winW / 2, W.y1);
    win.lineTo(wx + winW / 2, W.y0);
    win.closePath();
    wallShape.holes.push(win);
  }
  const arch = new THREE.Path();
  arch.moveTo(A.x0, -0.01);
  arch.lineTo(A.x0, A.springY);
  arch.absarc(archCx, A.springY, archR, Math.PI, 0, true);
  arch.lineTo(A.x1, -0.01);
  arch.closePath();
  wallShape.holes.push(arch);
  const wallDepth = 0.6;
  const backGeo = new THREE.ExtrudeGeometry(wallShape, { depth: wallDepth, bevelEnabled: false, curveSegments: 24 });
  backGeo.translate(0, 0, R.z0 - wallDepth);
  boxUV(backGeo);
  add(new THREE.Mesh(backGeo, stoneMat)).receiveShadow = true;

  const sideParts = [];
  sideParts.push(box(0.4, R.height + 0.1, R.z1 - R.z0 + 0.8, R.x0 - 0.2, (R.height + 0.1) / 2, (R.z0 + R.z1) / 2));
  sideParts.push(box(0.4, R.height + 0.1, R.z1 - R.z0 + 0.8, R.x1 + 0.2, (R.height + 0.1) / 2, (R.z0 + R.z1) / 2));
  sideParts.push(box(R.x1 - R.x0 + 0.8, R.height + 0.1, 0.4, (R.x0 + R.x1) / 2, (R.height + 0.1) / 2, R.z1 + 0.2));
  add(new THREE.Mesh(mergeGeometries(sideParts), stoneMat)).receiveShadow = true;
  for (const g of sideParts) g.dispose();

  // Pasillo tras el arco (oscuro, con luz tenue al fondo).
  const corridorMat = keep(new THREE.MeshStandardMaterial({
    map: stone.map, bumpMap: stone.surface, bumpScale: 2, roughness: 0.95, color: 0x8a7c68, side: THREE.BackSide,
  }));
  add(new THREE.Mesh(box(A.x1 - A.x0 + 0.3, 3.2, 3.2, archCx, 1.6, R.z0 - wallDepth - 1.6), corridorMat)).receiveShadow = true;
  const corridorLight = new THREE.PointLight(0xffc98f, 1.6, 4.5, 2);
  corridorLight.position.set(archCx + 0.2, 2.1, R.z0 - wallDepth - 2.6);
  group.add(corridorLight);

  // Techo y vigas (las vigas cruzan el lado más corto de la sala).
  add(new THREE.Mesh(box(R.x1 - R.x0 + 0.8, 0.1, R.z1 - R.z0 + 0.8, (R.x0 + R.x1) / 2, R.height + 0.05, (R.z0 + R.z1) / 2, 1 / 2), plasterMat));
  const beams = [];
  if (R.x1 - R.x0 <= R.z1 - R.z0) {
    for (let z = R.z1 - 0.7; z > R.z0; z -= 1.3) beams.push(box(R.x1 - R.x0, 0.26, 0.2, (R.x0 + R.x1) / 2, R.height - 0.13, z, 1 / 1.2));
  } else {
    for (let x = R.x0 + 0.7; x < R.x1; x += 1.3) beams.push(box(0.2, 0.26, R.z1 - R.z0, x, R.height - 0.13, (R.z0 + R.z1) / 2, 1 / 1.2));
  }
  add(new THREE.Mesh(mergeGeometries(beams), beamMat));
  for (const g of beams) g.dispose();

  // ---------------------------------------------------------------- ventanas
  const sky = keep(skyTexture());
  const glassMat = keep(new THREE.MeshBasicMaterial({ map: sky, color: new THREE.Color(2.6, 2.5, 2.3), toneMapped: true, fog: false }));
  const frameMat = keep(new THREE.MeshStandardMaterial({ color: 0x2c2018, roughness: 0.8 }));
  const glassGeo = keep(new THREE.PlaneGeometry(winW, winH));
  const mullions = [];
  for (const wx of windows) {
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.position.set(wx, winCy, R.z0 - wallDepth + 0.12);
    group.add(glass);
    mullions.push(box(0.05, winH, 0.07, wx, winCy, R.z0 - wallDepth + 0.16));
    for (const f of [0.34, 0.68]) mullions.push(box(winW, 0.045, 0.07, wx, W.y0 + winH * f, R.z0 - wallDepth + 0.16));
    mullions.push(box(winW, 0.07, 0.1, wx, W.y0 + 0.035, R.z0 - wallDepth + 0.18));
  }
  add(new THREE.Mesh(mergeGeometries(mullions), frameMat));
  for (const g of mullions) g.dispose();

  // ---------------------------------------------------------------- estanterías de fondo
  // El frente de cada estantería mira hacia la sala; su fondo queda contra el muro.
  const casesDef = [];
  const altaH = Math.max(2.2, Math.min(3.15, R.height - 1.15));
  stations.forEach((s, i) => {
    // Alta, detrás de cada columna (se ve por encima y por los costados).
    casesDef.push({ width: 2.1, height: altaH, depth: 0.42, shelves: Math.round(altaH / 0.45), fill: 0.55, seed: 3 + i * 17, pos: [s - 0.35, 0, R.z0 + 0.42], rotY: 0 });
    // Baja, bajo cada ventana.
    casesDef.push({ width: 1.1, height: 1.35, depth: 0.4, shelves: 3, fill: 0.9, seed: 4 + i * 17, pos: [s - 2.2, 0, R.z0 + 0.4], rotY: 0 });
  });
  casesDef.push(
    // Media, junto al arco.
    { width: 0.85, height: 2.1, depth: 0.38, shelves: 5, fill: 0.85, seed: 5, pos: [last + 1.25, 0, R.z0 + 0.38], rotY: 0 },
    // Pared izquierda, larga.
    { width: 5.4, height: Math.min(R.height - 0.9, 3.3 + (R.height - 4.3) * 0.7), depth: 0.42, shelves: 8, fill: 0.95, seed: 6, pos: [R.x0 + 0.42, 0, -2.0], rotY: Math.PI / 2 },
    // Pared derecha, cerca del usuario.
    { width: 3.0, height: Math.min(R.height - 1.1, 3.0 + (R.height - 4.3) * 0.7), depth: 0.42, shelves: 7, fill: 0.95, seed: 7, pos: [R.x1 - 0.42, 0, 0.1], rotY: -Math.PI / 2 },
    { width: 1.6, height: 2.4, depth: 0.4, shelves: 6, fill: 0.9, seed: 8, pos: [R.x1 - 0.4, 0, -3.9], rotY: -Math.PI / 2 },
  );

  const frameGeos = [];
  const instances = [];
  const m = new THREE.Matrix4();
  const caseM = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const cells = Math.max(1, spineAtlas.used);
  const rand = mulberry32(99);
  for (const def of casesDef) {
    const bc = farBookcase(def);
    q.setFromAxisAngle(up, def.rotY);
    caseM.compose(new THREE.Vector3(...def.pos), q, new THREE.Vector3(1, 1, 1));
    bc.frame.applyMatrix4(caseM);
    frameGeos.push(bc.frame);
    for (const b of bc.books) {
      const lean = new THREE.Matrix4().makeRotationZ(b.lean);
      m.makeTranslation(b.x, b.y, b.z).multiply(lean).scale(new THREE.Vector3(b.T, b.H, b.W));
      instances.push({ matrix: caseM.clone().multiply(m), cell: Math.floor(rand() * cells), tint: 0.7 + rand() * 0.35 });
    }
  }
  const cases = add(new THREE.Mesh(mergeGeometries(frameGeos), caseMat));
  for (const g of frameGeos) g.dispose();
  cases.receiveShadow = true;
  cases.castShadow = true;

  // Libros lejanos: una sola malla instanciada que reutiliza el atlas de lomos.
  const farGeo = farBookGeometry();
  const cellAttr = new Float32Array(instances.length * 4);
  instances.forEach((inst, i) => {
    const c = spineAtlas.cell(inst.cell);
    cellAttr.set([c.u0, c.v0, c.u1, c.v1], i * 4);
  });
  farGeo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cellAttr, 4));
  const farMat = keep(new THREE.MeshStandardMaterial({
    map: atlasTextures.map,
    bumpMap: atlasTextures.surface,
    bumpScale: 0.8,
    roughnessMap: atlasTextures.surface,
    metalnessMap: atlasTextures.surface,
    roughness: 1,
    metalness: 1,
  }));
  farMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aCell;')
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        vec2 cellUv = mix(aCell.xy, aCell.zw, uv);
        #ifdef USE_MAP
          vMapUv = cellUv;
        #endif
        #ifdef USE_BUMPMAP
          vBumpMapUv = cellUv;
        #endif
        #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv = cellUv;
        #endif
        #ifdef USE_METALNESSMAP
          vMetalnessMapUv = cellUv;
        #endif`,
      );
  };
  const farBooks = new THREE.InstancedMesh(farGeo, farMat, instances.length);
  const tint = new THREE.Color();
  instances.forEach((inst, i) => {
    farBooks.setMatrixAt(i, inst.matrix);
    farBooks.setColorAt(i, tint.setScalar(inst.tint));
  });
  farBooks.instanceMatrix.needsUpdate = true;
  farBooks.receiveShadow = true;
  add(farBooks);
  disposables.push(farBooks);

  // ---------------------------------------------------------------- luces
  const hemi = new THREE.HemisphereLight(0xf3e4cf, 0x3a2a1e, 0.55);
  group.add(hemi);

  // El sol y el relleno acompañan al usuario por la galería: su dirección no
  // cambia, pero la zona con sombras nítidas queda siempre a su alrededor.
  const sun = new THREE.DirectionalLight(0xffe0b8, 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -2.0;
  sc.right = 2.0;
  sc.top = 1.6;
  sc.bottom = -1.6;
  sc.near = 1.0;
  sc.far = 10;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.012;
  sun.shadow.radius = 3;
  group.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(0xc9d4e3, 0.32);
  group.add(fill, fill.target);

  function follow(x) {
    sun.position.set(-2.4 + x, 4.3, 1.9);
    sun.target.position.set(0.15 + x, 0.55, -2.3);
    fill.position.set(3 + x, 2.5, 2);
    fill.target.position.set(x, 0.8, -2.2);
  }
  follow(stations[0]);

  // La ventana del estante actual ilumina la sala y deja entrar un haz de luz con
  // polvo. Al ir a otro estante, esa luz se atenúa un momento y pasa a su ventana.
  const rig = new THREE.Group();
  rig.name = 'luz-de-ventana';
  group.add(rig);
  const wx = W.dx;
  const windowLight = new THREE.RectAreaLight(0xfff1dc, 7, winW, winH);
  windowLight.position.set(wx, winCy, R.z0 + 0.02);
  windowLight.lookAt(wx + 0.6, winCy - 1.4, R.z0 + 3);
  rig.add(windowLight);

  // Haz de la ventana: luz real sobre el piso + tarjetas translúcidas + polvo.
  const beamFrom = new THREE.Vector3(wx, winCy + 0.1, R.z0 - 0.1);
  const beamTo = new THREE.Vector3(wx + 1.2, 0, R.z0 + 1.85);
  const spot = new THREE.SpotLight(0xfff0d8, 22, 7, 0.3, 0.75, 2);
  spot.position.copy(beamFrom);
  spot.target.position.copy(beamTo);
  rig.add(spot, spot.target);

  const shaft = buildShaft(beamFrom, beamTo, winW * 0.8, winH * 0.7);
  rig.add(shaft);
  translucent.push(shaft);
  disposables.push(shaft.geometry, shaft.material);

  const dust = buildDust(beamFrom, beamTo);
  rig.add(dust.points);
  translucent.push(dust.points);
  disposables.push(dust.points.geometry, dust.points.material);

  const base = { window: windowLight.intensity, spot: spot.intensity, shaft: shaft.material.uniforms.uIntensity.value };
  function setRig(x, fade = 1) {
    rig.position.x = x;
    windowLight.intensity = base.window * fade;
    spot.intensity = base.spot * fade;
    shaft.material.uniforms.uIntensity.value = base.shaft * fade;
    dust.uniforms.uFade.value = fade;
  }
  setRig(stations[0]);

  function update(time) {
    dust.uniforms.uTime.value = time;
    shaft.material.uniforms.uTime.value = time;
  }

  return {
    group,
    translucent,
    extent: { x0: R.x0, x1: R.x1, z0: R.z0, z1: R.z1 },
    lights: { sun, hemi, fill, spot, windowLight },
    update,
    follow,
    setRig,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

// ---------------------------------------------------------------- haz de luz
function buildShaft(from, to, width, height) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const length = dir.length();
  dir.normalize();
  const cards = 7;
  const geos = [];
  for (let i = 0; i < cards; i++) {
    const angle = (i / cards) * Math.PI;
    const g = new THREE.PlaneGeometry(1, 1, 1, 8);
    // Plano a lo largo del eje Y local (longitud), ancho en X; girado sobre el eje.
    g.translate(0, -0.5, 0);
    g.rotateY(angle);
    const pos = g.getAttribute('position');
    const along = new Float32Array(pos.count);
    for (let k = 0; k < pos.count; k++) along[k] = -pos.getY(k);
    g.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
    geos.push(g);
  }
  const geo = mergeGeometries(geos);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uIntensity: { value: 0.085 } },
    vertexShader: /* glsl */ `
      attribute float aAlong;
      varying float vAlong;
      varying vec2 vUv;
      varying float vFacing;
      void main() {
        vAlong = aAlong;
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vec3 n = normalize(mat3(modelMatrix) * normal);
        vec3 v = normalize(cameraPosition - world.xyz);
        vFacing = abs(dot(n, v));
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uIntensity;
      varying float vAlong;
      varying vec2 vUv;
      varying float vFacing;
      void main() {
        float across = 1.0 - pow(abs(vUv.x - 0.5) * 2.0, 2.0);
        float fadeIn = smoothstep(0.0, 0.08, vAlong);
        float fadeOut = 1.0 - smoothstep(0.55, 1.0, vAlong);
        float streak = 0.75 + 0.25 * sin(vUv.x * 23.0 + uTime * 0.21) * sin(vUv.x * 7.0 - uTime * 0.13);
        float a = across * fadeIn * fadeOut * streak * smoothstep(0.05, 0.45, vFacing);
        gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * a * uIntensity, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  // Orientar: eje -Y local hacia la dirección del haz; escala ancho/largo.
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
  mesh.quaternion.copy(q);
  mesh.position.copy(from);
  mesh.scale.set((width + height) / 2, length, (width + height) / 2);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return mesh;
}

function buildDust(from, to) {
  const count = 900;
  const rand = mulberry32(12);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    // Mitad cerca del haz, mitad delante del estante.
    if (i < count * 0.6) {
      const t = rand();
      positions[i * 3] = from.x + (to.x - from.x) * t + (rand() - 0.5) * 1.3;
      positions[i * 3 + 1] = from.y + (to.y - from.y) * t + (rand() - 0.5) * 1.0;
      positions[i * 3 + 2] = from.z + (to.z - from.z) * t + (rand() - 0.5) * 1.3;
    } else {
      positions[i * 3] = (rand() - 0.5) * 3.2;
      positions[i * 3 + 1] = 0.2 + rand() * 2.2;
      positions[i * 3 + 2] = -0.6 - rand() * 1.4;
    }
    seeds[i * 2] = rand();
    seeds[i * 2 + 1] = rand();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 2));
  const uniforms = {
    uTime: { value: 0 },
    uFrom: { value: from.clone() },
    uTo: { value: to.clone() },
    uPixel: { value: Math.min(window.devicePixelRatio || 1, 1.5) },
    uFade: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec2 aSeed;
      uniform float uTime;
      uniform vec3 uFrom;
      uniform vec3 uTo;
      uniform float uPixel;
      varying float vGlow;
      void main() {
        vec3 p = position;
        float t = uTime * (0.03 + aSeed.x * 0.04);
        p.x += sin(t * 6.2831 + aSeed.y * 40.0) * 0.12 + sin(uTime * 0.05 + aSeed.x * 9.0) * 0.05;
        p.y += sin(t * 4.0 + aSeed.x * 30.0) * 0.09 + mod(uTime * 0.004 * (aSeed.y + 0.2), 0.3);
        p.z += cos(t * 5.0 + aSeed.y * 20.0) * 0.1;
        vec3 axis = normalize(uTo - uFrom);
        vec3 rel = p - uFrom;
        float along = dot(rel, axis);
        float dist = length(rel - axis * along);
        float inBeam = (1.0 - smoothstep(0.25, 0.6, dist)) * step(0.0, along) * (1.0 - smoothstep(3.2, 4.4, along));
        vGlow = 0.12 + inBeam * 1.2;
        float twinkle = 0.6 + 0.4 * sin(uTime * (0.8 + aSeed.y) + aSeed.x * 50.0);
        vGlow *= twinkle;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uPixel * (1.4 + aSeed.y * 2.2) * (3.0 / max(0.4, -mv.z));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      varying float vGlow;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(c));
        gl_FragColor = vec4(vec3(1.0, 0.94, 0.84) * a * vGlow * 0.55 * uFade, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 6;
  return { points, uniforms };
}

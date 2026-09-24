// Coreografía: la mano toma el libro, lo acerca, lo abre, se leen las páginas
// y al cerrar lo devuelve al estante.
//
// Las manos y el libro se mueven entre "objetivos" definidos en un marco de
// referencia (el libro, una de sus mitades, el cuerpo o el mundo). Si el marco se
// mueve, lo que está sujeto a él lo acompaña: así el contacto se mantiene.
//
// El movimiento imita al de una persona: trayectorias de mínimo tirón (arranque y
// frenado suaves), los dedos se abren antes de agarrar y se cierran al llegar, cada
// dedo entra con un pequeño retardo, la vista se adelanta a la mano y el libro
// arrastra algo de inercia.
import * as THREE from 'three';
import { timeline } from '../core/timeline.js';
import { clamp, damp, ease, lerp, smoothstep } from '../core/math.js';
import { POSES, blendPoses } from '../hands/armRig.js';
import { BOARD, SQUARE } from '../scene/books.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// Ritmo general de la secuencia (1 = el afinado; súbelo para verlo más lento).
export const RITMO = 1;

// Retardo de cada dedo al cambiar de pose: el índice entra primero, el meñique al final.
const DEDO_RETARDO = { index: 0, middle: 0.06, ring: 0.12, pinky: 0.18, thumb: 0.04 };

function blendStaggered(a, b, t) {
  const part = (delay) => clamp((t - delay) / (1 - delay), 0, 1);
  const out = blendPoses(a, b, part(0));
  for (const k of ['index', 'middle', 'ring', 'pinky']) {
    const e = ease.inOutSine(part(DEDO_RETARDO[k]));
    out[k] = a[k].map((v, i) => lerp(v, b[k][i], e));
  }
  const et = ease.inOutSine(part(DEDO_RETARDO.thumb));
  for (const k of Object.keys(a.thumb)) out.thumb[k] = lerp(a.thumb[k], b.thumb[k], et);
  out.spread = lerp(a.spread, b.spread, ease.inOutSine(part(0.05)));
  return out;
}

// Orientación de la mano a partir de la dirección de los dedos y del dorso.
function handQuat(fingers, dorsal) {
  const z = fingers.clone().normalize().negate();
  const y = dorsal.clone().sub(z.clone().multiplyScalar(dorsal.dot(z))).normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

// Objetivo: posición y orientación locales a un marco (Object3D o null = mundo).
class Target {
  constructor(frame, pos, quat) {
    this.frame = frame;
    this.pos = pos.clone();
    this.quat = quat.clone();
    this.offset = null; // función opcional → Vector3 de desplazamiento en mundo
  }
  world(outPos, outQuat) {
    if (this.frame) {
      this.frame.updateWorldMatrix(true, false);
      outPos.copy(this.pos).applyMatrix4(this.frame.matrixWorld);
      this.frame.getWorldQuaternion(outQuat).multiply(this.quat);
    } else {
      outPos.copy(this.pos);
      outQuat.copy(this.quat);
    }
    if (this.offset) outPos.add(this.offset());
    return outPos;
  }
  shifted(delta) {
    const t = new Target(this.frame, this.pos.clone().add(delta), this.quat);
    t.pose = this.pose;
    return t;
  }
}

// Mueve un objeto (muñeca o libro) entre objetivos, con arco e inercia opcionales.
class Driver {
  constructor(object, onPose = null) {
    this.object = object;
    this.onPose = onPose;
    this.from = null;
    this.to = null;
    this.t = 1;
    this.rotT = 1;
    this.arc = V();
    this.poseFrom = POSES.relaxed;
    this.poseTo = POSES.relaxed;
    this.poseT = 1;
    this.lag = 0; // segundos de retraso (peso del objeto)
    this._pa = V();
    this._pb = V();
    this._qa = new THREE.Quaternion();
    this._qb = new THREE.Quaternion();
    this._pos = V();
    this._quat = new THREE.Quaternion();
    this._init = false;
    this.override = null;
  }

  set(target, pose) {
    this.from = target;
    this.to = target;
    this.t = 1;
    this.rotT = 1;
    if (pose) {
      this.poseFrom = pose;
      this.poseTo = pose;
      this.poseT = 1;
    }
  }

  currentPose() {
    return blendStaggered(this.poseFrom, this.poseTo, this.poseT);
  }

  // Perfil de mínimo tirón: la velocidad sube y baja como en un gesto humano.
  move(target, duration, { pose = null, arc = null, easing = ease.minJerk, rotEase = ease.inOutSine } = {}) {
    this.update(0);
    this.from = new Target(null, this.object.position, this.object.quaternion);
    this.to = target;
    this.arc.copy(arc || V());
    if (pose) {
      this.poseFrom = this.currentPose();
      this.poseTo = pose;
    }
    this.t = 0;
    this.rotT = 0;
    this.poseT = pose ? 0 : this.poseT;
    return timeline.tween(duration * RITMO, (_, raw) => {
      this.t = easing(raw);
      // La muñeca termina de girar un poco antes de llegar: se acomoda en el camino.
      this.rotT = rotEase(clamp(raw / 0.85, 0, 1));
      if (pose) this.poseT = raw;
    }, ease.linear);
  }

  pose(pose, duration) {
    this.poseFrom = this.currentPose();
    this.poseTo = pose;
    this.poseT = 0;
    return timeline.tween(duration * RITMO, (e) => {
      this.poseT = e;
    });
  }

  update(dt = 0) {
    if (!this.to) return;
    const pa = this.from.world(this._pa, this._qa);
    const pb = this.to.world(this._pb, this._qb);
    this._pos.lerpVectors(pa, pb, this.t);
    if (this.t > 0 && this.t < 1) this._pos.addScaledVector(this.arc, Math.sin(Math.PI * this.t));
    this._quat.slerpQuaternions(this._qa, this._qb, this.rotT);

    const obj = this.object;
    if (this.lag > 0 && this._init && dt > 0) {
      // Inercia: el objeto llega un instante después, como si pesara.
      const k = 1 / Math.max(this.lag, 1e-3);
      obj.position.copy(damp3(obj.position, this._pos, k, dt));
      obj.quaternion.slerp(this._quat, 1 - Math.exp(-k * dt));
    } else {
      obj.position.copy(this._pos);
      obj.quaternion.copy(this._quat);
    }
    this._init = true;
    if (this.override) this.override(obj);
    if (this.onPose) this.onPose(this.currentPose());
  }
}

// Avance a saltos: en cada peldaño se sube un tramo y se hace una pausa breve.
function escalonado(t, peldanos) {
  const k = clamp(t, 0, 1) * peldanos;
  const i = Math.floor(k);
  if (i >= peldanos) return 1;
  return (i + ease.inOutSine(clamp((k - i) * 1.45, 0, 1))) / peldanos;
}

const _tmp = V();
function damp3(current, target, lambda, dt) {
  const k = 1 - Math.exp(-lambda * dt);
  return _tmp.copy(current).lerp(target, k);
}

export class BookSequence {
  constructor({ scene, camera, look, arms, pages, rig, gaze, body, ui, readingLight }) {
    this.scene = scene;
    this.camera = camera;
    this.look = look;
    this.arms = arms;
    this.pages = pages;
    this.rig = rig;
    this.gaze = gaze;
    this.body = body;
    this.ui = ui;
    this.readingLight = readingLight;
    this.state = 'idle';
    this.book = null;

    // El tronco cuelga del cuerpo y gira un poco con la mirada; los brazos van en él.
    this.torso = new THREE.Object3D();
    this.torso.name = 'tronco';
    body.add(this.torso);
    this.torso.add(arms.root);
    arms.root.rotation.y = Math.PI;
    this.torso.updateMatrixWorld(true);
    const shoulders = arms.right.clavicle.getWorldPosition(V())
      .add(arms.left.clavicle.getWorldPosition(V())).multiplyScalar(0.5);
    this.torso.worldToLocal(shoulders);
    // Los hombros van donde están en una persona: un palmo por debajo de los ojos
    // y bastante por detrás. Si quedan pegados a la cámara, el brazo cruza la vista.
    arms.root.position.sub(shoulders).add(V(0, -0.28, 0.13));
    this.torso.updateMatrixWorld(true);
    // Hombro derecho respecto a los ojos y alcance del brazo: con esto se decide
    // dónde pararse para que el libro quede al alcance y de frente al hombro.
    this.shoulder = this.torso.worldToLocal(arms.right.upperArm.getWorldPosition(V()));
    this.armLength = arms.right.lenUpper + arms.right.lenFore;

    this.R = new Driver(arms.right.frame, (p) => arms.right.setPose(p));
    this.L = new Driver(arms.left.frame, (p) => arms.left.setPose(p));
    this.bookDriver = null;

    // Reposo: brazos colgando a los costados.
    this.restR = new Target(this.torso, V(0.24, -0.74, 0.03), handQuat(V(0.08, -1, 0.12), V(1, 0.1, 0)));
    this.restL = new Target(this.torso, V(-0.24, -0.74, 0.03), handQuat(V(-0.08, -1, 0.12), V(-1, 0.1, 0)));
    this.R.set(this.restR, POSES.relaxed);
    this.L.set(this.restL, POSES.relaxed);

    // Parámetros de vista animables.
    this.view = { focus: 0, lean: 0, dof: 0, light: 0, step: 0 };
    // Paso hacia el estante al tomar un libro (y regreso al terminar).
    this.leanDir = V(0, -0.06, -1.0);
    this.focusPoint = V();
    // Caminata de un estante a otro (null si no se camina) y subida por la
    // escalera (idem). `enEscalera` lo pone src/main.js al cambiar de estante.
    this.walk = null;
    this.climb = null;
    this.enEscalera = false;
    this.walkTarget = V();
    this.time = 0;
    this.torsoTarget = 0;
    this._v = V();
    this._pole = V();
    this._elbow = V();
  }

  animateView(to, duration, easing = ease.inOutCubic) {
    const from = { ...this.view };
    return timeline.tween(duration * RITMO, (e) => {
      for (const k of Object.keys(to)) this.view[k] = lerp(from[k], to[k], e);
    }, easing);
  }

  // Paso hacia el estante: avance con un leve balanceo, como al caminar.
  stepTo(value, duration) {
    const from = this.view.lean;
    return timeline.tween(duration * RITMO, (_, raw) => {
      this.view.lean = lerp(from, value, ease.inOutSine(raw));
      this.view.step = Math.sin(raw * Math.PI * 2) * (1 - raw) * Math.abs(value - from);
    }, ease.linear);
  }

  // ---------------------------------------------------------------- objetivos
  contact(arm, pose, quat, joint, point, frame) {
    const j = joint === 'palm' ? arm.palmInHand(pose, V()) : arm.jointInHand(joint, pose, V());
    const t = new Target(frame, point.clone().sub(j.applyQuaternion(quat)), quat);
    t.pose = pose;
    return t;
  }

  frameMatrix(target, halfAngle = 0) {
    const pos = V();
    const quat = new THREE.Quaternion();
    target.world(pos, quat);
    const m = new THREE.Matrix4().compose(pos, quat, V(1, 1, 1));
    if (halfAngle) m.multiply(new THREE.Matrix4().makeRotationY(-halfAngle));
    return m;
  }

  // Orientación de la mano: dorso indicado y dedos que siguen la línea del antebrazo.
  orientHand({ fingers, dorsal, point, frameMatrix, shoulder, weight }) {
    const inv = frameMatrix.clone().invert();
    const toShoulder = shoulder.clone().applyMatrix4(inv).sub(point).normalize();
    const f = fingers.clone().normalize().multiplyScalar(1 - weight).addScaledVector(toShoulder, -weight).normalize();
    return handQuat(f, dorsal);
  }

  shoulderWorld(side, lean) {
    const arm = this.arms[side];
    arm.clavicle.updateWorldMatrix(true, false);
    const p = arm.upperArm.getWorldPosition(V());
    return p.addScaledVector(this.leanDir, lean - this.view.lean);
  }

  buildTargets(book) {
    const { T, H, W } = book.dims;
    const { right, left } = this.arms;
    const root = book.root;
    const tg = {};
    const fold = 0.14;
    const openTo = Math.PI - 2 * fold;

    // Gancho del índice sobre el canto superior, junto al lomo (libro en el estante).
    // En el marco del libro: +X entra en el estante, +Y arriba, +Z hacia la derecha.
    const shelfM = this.frameMatrix(this.shelfTarget(book));
    const hookPoint = V(0.016, H / 2 + SQUARE + 0.004, 0.002);
    // La mano continúa la línea del antebrazo: los dedos entran hacia el estante,
    // la palma mira abajo y solo el índice se curva sobre el canto. Si los dedos
    // apuntaran hacia abajo, la muñeca tendría que quebrarse casi en ángulo recto.
    const hookQ = this.orientHand({
      fingers: V(0.9, -0.38, -0.05), dorsal: V(0.2, 1, 0.16), point: hookPoint, frameMatrix: shelfM, shoulder: this.shoulderWorld('right', 1), weight: 0.45,
    });
    tg.hook = this.contact(right, POSES.hook, hookQ, 'index-finger-tip', hookPoint, root);
    tg.hookApproach = tg.hook.shifted(V(-0.13, 0.07, 0.02));

    // Ya inclinado el libro, la mano lo sujeta por la cabecera. El punto de contacto
    // es la YEMA del índice sobre el canto, no los nudillos: si se fija el nudillo,
    // los dedos, al cerrarse, quedan dentro del bloque de hojas.
    const graspPoint = V(0.022, H / 2 + SQUARE + 0.002, 0.006);
    const graspQ = this.orientHand({
      fingers: V(0.92, -0.3, -0.04), dorsal: V(0.2, 1, 0.12), point: graspPoint, frameMatrix: shelfM, shoulder: this.shoulderWorld('right', 1), weight: 0.4,
    });
    tg.grasp = this.contact(right, POSES.grip, graspQ, 'index-finger-tip', graspPoint, root);
    tg.pinch = this.contact(right, POSES.pinch, graspQ, 'index-finger-tip', graspPoint, root);

    // Mano izquierda: palma en la tapa trasera, pulgar hacia el lomo.
    const presentM = this.frameMatrix(this.presentTarget(book));
    const leftPoint = V(0.045, -0.04, -T / 2 - BOARD - 0.006);
    const leftQ = this.orientHand({
      fingers: V(0.15, 1, 0), dorsal: V(0, 0, -1), point: leftPoint, frameMatrix: presentM, shoulder: this.shoulderWorld('left', 0), weight: 0.3,
    });
    tg.leftSpine = this.contact(left, POSES.flat, leftQ, 'palm', leftPoint, book.back);
    tg.leftSpineApproach = tg.leftSpine.shifted(V(0.03, -0.09, -0.06));

    // Mano derecha en el canto de la tapa (gira con ella al abrir): el pulgar se
    // apoya en la portada y los dedos pasan por detrás del canto, como al abrir
    // un libro de verdad. La mano entra de lado, con la muñeca en línea.
    const readClosedM = this.frameMatrix(this.readTarget(book, false));
    const coverPoint = V(W + SQUARE - 0.014, H * 0.04, T / 2 + BOARD + 0.003);
    const coverQ = this.orientHand({
      fingers: V(-0.9, 0.12, -0.3), dorsal: V(0, 1, 0.2), point: coverPoint, frameMatrix: readClosedM, shoulder: this.shoulderWorld('right', 0), weight: 0.3,
    });
    tg.cover = this.contact(right, POSES.pinch, coverQ, 'thumb-tip', coverPoint, book.front);
    tg.coverApproach = tg.cover.shifted(V(0.07, -0.04, 0.07));

    // Lectura: el pulgar descansa en el margen y el resto de la mano queda detrás.
    const readOpen = this.readTarget(book, true);
    const holdRPoint = V(W - 0.034, -H * 0.36, T / 2 - 0.004);
    const holdRQ = this.orientHand({
      fingers: V(-1, 0.3, -0.25), dorsal: V(0.2, 0, -1), point: holdRPoint, frameMatrix: this.frameMatrix(readOpen, fold), shoulder: this.shoulderWorld('right', 0), weight: 0.25,
    });
    tg.holdR = this.contact(right, POSES.flat, holdRQ, 'thumb-tip', holdRPoint, book.back);
    const holdLPoint = V(W - 0.034, -H * 0.36, -T / 2 + 0.018);
    const holdLQ = this.orientHand({
      fingers: V(-1, 0.3, 0.25), dorsal: V(0.2, 0, 1), point: holdLPoint, frameMatrix: this.frameMatrix(readOpen, fold + openTo), shoulder: this.shoulderWorld('left', 0), weight: 0.25,
    });
    tg.holdL = this.contact(left, POSES.flat, holdLQ, 'thumb-tip', holdLPoint, book.front);

    // El pulgar sigue la altura real de cada pila de hojas (cambia al pasar páginas).
    const zAxis = V();
    const shiftR = V();
    tg.holdR.offset = () => {
      const tR = T * (1 - book.state.fraction);
      const surface = -T / 2 + book.profile(0.85, tR, book.state.openness) + 0.003;
      zAxis.set(0, 0, 1).transformDirection(book.back.matrixWorld);
      return shiftR.copy(zAxis).multiplyScalar(surface - holdRPoint.z);
    };
    const shiftL = V();
    tg.holdL.offset = () => {
      const tL = T * book.state.fraction;
      const surface = T / 2 - book.profile(0.85, tL, book.state.openness) - 0.003;
      zAxis.set(0, 0, 1).transformDirection(book.front.matrixWorld);
      return shiftL.copy(zAxis).multiplyScalar(surface - holdLPoint.z);
    };
    return tg;
  }

  shelfTarget(book) {
    return new Target(null, book.shelfPosition, book.shelfQuaternion);
  }

  // Libro inclinado: gira sobre la arista inferior delantera (el pie del lomo).
  tiltTarget(book, angle) {
    const pivot = book.shelfPosition.clone();
    pivot.y -= book.dims.H / 2 + SQUARE;
    pivot.z += 0.012;
    const q = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), angle);
    const pos = book.shelfPosition.clone().sub(pivot).applyQuaternion(q).add(pivot);
    return new Target(null, pos, q.multiply(book.shelfQuaternion));
  }

  pulledTarget(book) {
    const pos = book.shelfPosition.clone().add(V(0, 0.03, book.dims.W + 0.08));
    const q = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), 0.05).multiply(book.shelfQuaternion);
    return new Target(null, pos, q);
  }

  // Frente al usuario, con el lomo hacia él.
  presentTarget(book) {
    const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI / 2);
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -0.12));
    return new Target(this.body, V(0.03, -0.32, -0.31), q);
  }

  // Posición de lectura: portada hacia el usuario. `open` centra el lomo.
  readTarget(book, open) {
    const q = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -0.32);
    const x = open ? 0 : -book.dims.W / 2;
    const t = new Target(this.body, V(x, -0.15, -0.37), q);
    // Respiración: el libro se mueve muy poco en las manos.
    t.offset = () => this._v.set(
      Math.sin(this.time * 0.9) * 0.0018,
      Math.sin(this.time * 1.3) * 0.0022 + Math.sin(this.time * 0.42) * 0.0016,
      Math.sin(this.time * 0.7) * 0.0015,
    );
    return t;
  }

  bookCenter(book, target = V()) {
    const s = book.state;
    const x = lerp(book.dims.W / 2, 0, clamp(s.open / Math.PI, 0, 1));
    return book.root.localToWorld(target.set(x, 0, 0));
  }

  // ---------------------------------------------------------------- caminar
  // Ir hasta otro estante: unos pasos de lado por la galería. La cabeza se vuelve
  // hacia el estante al que se va y se endereza al llegar. `onProgress(t)` recibe
  // el avance (0 → 1) en cada cuadro. Subido a la escalera no se camina: se
  // empuja y la escalera rueda (`pasos: false`).
  async walkTo(x, focus, onProgress = null, { pasos = true, duracion = null } = {}) {
    if (this.state !== 'idle') return false;
    this.state = 'walking';
    this.gaze.enabled = false;
    this.gaze.clear();
    const from = this.look.eye.x;
    const dist = Math.abs(x - from);
    const duration = duracion ?? (pasos ? 1.1 + dist * 0.45 : 0.7 + dist * 0.3);
    this.walk = { t: 0, dist, pasos };
    this.walkTarget.copy(focus);
    this.animateView({ focus: 0.8 }, duration * 0.35, ease.inOutSine)
      .then(() => timeline.wait(duration * 0.3 * RITMO))
      .then(() => this.animateView({ focus: 0 }, duration * 0.35, ease.inOutSine));
    await timeline.tween(duration * RITMO, (_, raw) => {
      this.look.eye.x = lerp(from, x, ease.inOutSine(raw));
      this.walk.t = raw;
      if (onProgress) onProgress(raw);
    }, ease.linear);
    this.walk = null;
    this.view.focus = 0;
    this.state = 'idle';
    timeline.timeScale = 1;
    this.gaze.enabled = true;
    return true;
  }

  // ---------------------------------------------------------------- subir
  // Subir (o bajar) la escalera hasta el estante de otro nivel: la vista asciende
  // peldaño a peldaño, con el balanceo del que se agarra a los largueros, y se
  // acerca a la pared porque la escalera está apoyada en ella.
  async climbTo(y, z, focus, onProgress = null) {
    if (this.state !== 'idle') return false;
    this.state = 'climbing';
    this.gaze.enabled = false;
    this.gaze.clear();
    const eye = this.look.eye;
    const desdeY = eye.y;
    const desdeZ = eye.z;
    const peldanos = Math.max(2, Math.round(Math.abs(y - desdeY) / 0.27));
    const duration = 0.8 + peldanos * 0.33;
    this.climb = { t: 0, peldanos };
    this.walkTarget.copy(focus);
    this.animateView({ focus: 0.75 }, duration * 0.3, ease.inOutSine)
      .then(() => timeline.wait(duration * 0.4 * RITMO))
      .then(() => this.animateView({ focus: 0 }, duration * 0.3, ease.inOutSine));
    await timeline.tween(duration * RITMO, (_, raw) => {
      const avance = ease.inOutSine(raw);
      eye.y = lerp(desdeY, y, escalonado(avance, peldanos));
      eye.z = lerp(desdeZ, z, avance);
      this.climb.t = raw;
      if (onProgress) onProgress(raw);
    }, ease.linear);
    this.climb = null;
    this.view.focus = 0;
    this.state = 'idle';
    this.gaze.enabled = true;
    return true;
  }

  // ---------------------------------------------------------------- tomar
  async take(book) {
    if (this.state !== 'idle') return;
    this.state = 'taking';
    this.book = book;
    book.onShelf = false;
    this.gaze.enabled = false;
    this.gaze.clear();
    this.ui.mode('sequence');

    // La tapa con sus dorados se dibuja ahora; en el estante no hacía falta. El
    // brillo de «mirado» se apaga despacio mientras la mano llega.
    book.cargarDetalle();
    book.modoEstante(false);
    const glow0 = book.glow;
    timeline.tween(0.5, (e) => book.setGlow(glow0 * (1 - e)));
    const prepared = this.pages.prepare(book.content);
    book.state.fraction = book.stackFraction(0);
    book.spread = 0;
    book.state.fold = 0;
    book.state.open = 0;
    book.state.openness = 0;
    book.apply();

    this.bookDriver = new Driver(book.root);
    this.bookDriver.set(new Target(null, book.root.position, book.root.quaternion));
    this.bookDriver.lag = 0.05;
    // Paso corto hasta quedar frente al libro, al alcance del brazo. Para los
    // estantes bajos, además, el cuerpo se agacha un poco.
    const eye = this.look.eye;
    // Para los libros bajos el cuerpo se agacha un poco; subido a la escalera no
    // se agacha nadie: el brazo baja solo (el alcance se calcula igual).
    const crouch = this.enEscalera ? 0 : clamp((eye.y - 0.45 - book.shelfPosition.y) * 0.8, 0, 0.5);
    // Uno se coloca de modo que el hombro quede casi enfrente del libro (si no, el
    // brazo cruza el cuerpo) y a la distancia justa para alcanzarlo con el codo algo
    // doblado. La distancia sale del largo real del brazo, no de un número fijo.
    const grab = V(0.03, book.dims.H / 2 + SQUARE, 0)
      .applyQuaternion(book.shelfQuaternion).add(book.shelfPosition);
    const sh = this.shoulder;
    const reach = this.armLength * 0.86 + 0.08; // + la mano
    const dx = 0.07; // el hombro, un poco por fuera del libro
    const dy = eye.y + 0.02 - crouch + sh.y - grab.y;
    const dz = Math.sqrt(Math.max(reach * reach - dx * dx - dy * dy, 0.09));
    this.leanDir.set(
      grab.x + dx - sh.x - eye.x,
      0.02 - crouch,
      grab.z + dz - sh.z - eye.z,
    );
    const tg = this.buildTargets(book);
    this.tg = tg;

    // 1 · La vista se adelanta a la mano y el cuerpo da un paso corto.
    this.animateView({ focus: 0.85, dof: 0.35 }, 0.9);
    this.stepTo(1, 1.5);
    await timeline.wait(0.45 * RITMO);
    // 2 · El brazo viaja con la mano abierta, lista para tomar.
    await Promise.all([
      this.bookDriver.move(this.shelfTarget(book), 0.5),
      this.R.move(tg.hookApproach, 1.35, { pose: POSES.reach, arc: V(0.04, 0.1, 0.02) }),
    ]);
    // 3 · Últimos centímetros y cierre del índice sobre el canto.
    await this.R.move(tg.hook, 0.55, { easing: ease.outCubic });
    await this.R.pose(POSES.hook, 0.35);
    await timeline.wait(0.12 * RITMO);
    // 4 · Inclinar el libro hacia afuera.
    await this.bookDriver.move(this.tiltTarget(book, 0.26), 0.8, { easing: ease.inOutSine });
    // 5 · La mano se acomoda sobre la cabecera y cierra los dedos alrededor del lomo.
    await this.R.move(tg.grasp, 0.55, { pose: POSES.grip, easing: ease.inOutSine });
    // 6 · Sacarlo del estante, ya sujeto.
    await this.bookDriver.move(this.pulledTarget(book), 1.15);
    await timeline.wait(0.1 * RITMO);
    // 7 · Acercarlo despacio; la mano izquierda sale a su encuentro. El cuerpo se
    // endereza después, cuando el libro ya viene con él: si retrocede antes, el
    // brazo se queda estirado y la mano se separa del libro.
    this.animateView({ dof: 0.7 }, 1.2);
    timeline.wait(0.55 * RITMO).then(() => this.stepTo(0, 1.9));
    timeline.wait(0.7 * RITMO).then(() => this.L.move(tg.leftSpineApproach, 1.1, { pose: POSES.reach, arc: V(-0.05, 0.04, 0) }));
    await this.bookDriver.move(this.presentTarget(book), 1.8, { arc: V(0, 0.04, 0) });
    // 8 · La izquierda sujeta el libro por detrás del lomo.
    await this.L.move(tg.leftSpine, 0.55, { pose: POSES.flat, easing: ease.outCubic });
    // 9 · Girarlo para ver la portada; la derecha va al borde de la tapa.
    this.R.move(tg.coverApproach, 0.8, { pose: POSES.open, arc: V(0.1, 0.07, 0.05) })
      .then(() => this.R.move(tg.cover, 0.45, { pose: POSES.pinch }));
    await Promise.all([
      this.bookDriver.move(this.readTarget(book, false), 1.25, { easing: ease.inOutSine }),
      this.animateView({ focus: 1, dof: 1, light: 1 }, 1.25),
    ]);
    await prepared;
    book.showSpread(this.pages, 0);
    await timeline.wait(0.15 * RITMO);
    // 10 · Abrir la tapa: la mano la acompaña en su giro.
    const fold = 0.14;
    const openTo = Math.PI - 2 * fold;
    book.state.turn = { p: 0 };
    book.materials.leafFront.map = book.materials.rightPage.map;
    book.materials.leafBack.map = book.materials.leftPage.map;
    book.materials.leafFront.needsUpdate = true;
    book.materials.leafBack.needsUpdate = true;
    // La derecha acompaña la tapa y la suelta a mitad de giro; luego rodea el libro
    // por fuera (no cruza por encima de las páginas) hasta el borde derecho.
    const opening = Promise.all([
      timeline.tween(1.6 * RITMO, (e) => {
        book.state.open = openTo * e;
        book.state.fold = fold * smoothstep(0.2, 1, e);
        book.state.openness = smoothstep(0.1, 0.9, e);
        book.apply();
      }, ease.inOutSine),
      this.bookDriver.move(this.readTarget(book, true), 1.6, { easing: ease.inOutSine }),
    ]);
    let settleR = null;
    let settleL = null;
    timeline.wait(0.62 * RITMO).then(() => {
      settleR = this.R.move(tg.holdR, 1.05, { pose: POSES.relaxed, arc: V(0.17, -0.13, -0.05) })
        .then(() => this.R.pose(POSES.flat, 0.35));
    });
    timeline.wait(1.0 * RITMO).then(() => {
      settleL = this.L.move(tg.holdL, 0.95, { pose: POSES.relaxed, arc: V(-0.06, -0.06, 0.08) })
        .then(() => this.L.pose(POSES.flat, 0.35));
    });
    await opening;
    book.state.turn = null;
    book.apply();
    // 11 · Esperar a que ambas manos terminen de acomodarse.
    await Promise.all([settleR, settleL]);
    this.state = 'reading';
    timeline.timeScale = 1;
    this.ui.mode('reading');
  }

  // ---------------------------------------------------------------- pasar página
  async turn(dir) {
    if (this.state !== 'reading') return;
    const book = this.book;
    const k = book.spread;
    const nk = k + dir;
    if (nk < 0 || nk > book.maxSpread) {
      await this.nudge(dir);
      return;
    }
    this.state = 'turning';
    const M = book.materials;
    const content = book.content;
    const tex = (face) => this.pages.texture(content, face);
    const f0 = book.stackFraction(k);
    const f1 = book.stackFraction(nk);
    const forward = dir > 0;
    const driver = forward ? this.R : this.L;
    const arm = forward ? this.arms.right : this.arms.left;
    const hold = forward ? this.tg.holdR : this.tg.holdL;

    M.leafFront.map = tex(forward ? 2 * k + 1 : 2 * k - 1);
    M.leafBack.map = tex(forward ? 2 * k + 2 : 2 * k);
    if (forward) M.rightPage.map = tex(2 * k + 3);
    else M.leftPage.map = tex(2 * k - 2);
    book.state.turn = { p: forward ? 0 : 1, lift: 0 };
    book.apply();

    // La mano sigue la esquina de la hoja al principio del giro.
    const corner = V();
    const thumbLocal = arm.jointInHand('thumb-tip', POSES.thumbLift, V());
    const holdPos = V();
    const holdQuat = new THREE.Quaternion();
    driver.override = (obj) => {
      const w = driver.follow || 0;
      if (w <= 0) return;
      const leaf = book.leaf.dyn.position;
      const idx = 1 * 37 + 36; // fila baja, borde exterior de la hoja
      corner.fromBufferAttribute(leaf, idx);
      book.root.localToWorld(corner);
      hold.world(holdPos, holdQuat);
      const tip = thumbLocal.clone().applyQuaternion(holdQuat);
      obj.position.lerp(corner.sub(tip), w);
    };
    driver.follow = 0;
    const poseA = driver.currentPose();

    await timeline.tween(1.35 * RITMO, (_, t) => {
      const liftT = smoothstep(0, 0.26, t);
      const flipT = clamp((t - 0.26) / 0.74, 0, 1);
      let p = 0.05 * liftT + 0.95 * ease.inOutSine(flipT);
      const lift = 0.55 * liftT * (1 - smoothstep(0.3, 0.62, t));
      if (!forward) p = 1 - p;
      book.state.turn.p = p;
      book.state.turn.lift = forward ? lift : -lift;
      const moved = forward ? p : 1 - p;
      book.state.fraction = lerp(f0, f1, smoothstep(0.25, 0.85, moved));
      book.apply();
      driver.follow = smoothstep(0, 0.16, t) * (1 - smoothstep(0.4, 0.66, t));
      const lifting = smoothstep(0, 0.2, t) * (1 - smoothstep(0.48, 0.82, t));
      driver.poseTo = POSES.thumbLift;
      driver.poseFrom = poseA;
      driver.poseT = lifting;
    }, ease.linear);

    driver.override = null;
    driver.poseFrom = POSES.flat;
    driver.poseTo = POSES.flat;
    driver.poseT = 1;
    if (forward) M.leftPage.map = tex(2 * nk);
    else M.rightPage.map = tex(2 * nk + 1);
    book.spread = nk;
    book.state.fraction = f1;
    book.state.turn = null;
    book.apply();
    this.state = 'reading';
    // Deja listas las páginas vecinas (y suelta las lejanas) mientras se lee.
    this.pages.around(content, nk);
  }

  // Al llegar al final (o al principio) el libro solo se mece un poco.
  async nudge(dir) {
    this.state = 'turning';
    const t = this.bookDriver.to;
    const base = t.pos.clone();
    await timeline.tween(0.45, (_, x) => {
      t.pos.copy(base).add(V(Math.sin(x * Math.PI) * 0.006 * dir, 0, 0));
    }, ease.linear);
    t.pos.copy(base);
    this.state = 'reading';
  }

  // ---------------------------------------------------------------- cerrar y devolver
  async close() {
    if (this.state !== 'reading') return;
    this.state = 'closing';
    this.ui.mode('sequence');
    const book = this.book;
    const tg = this.tg;
    const s = book.state;
    const open0 = s.open;
    const fold0 = s.fold;

    // Al cerrar, la mitad que gira es la izquierda: la mano que la sostiene la
    // acompaña en el giro (sigue sujeta a ella) y, cuando ya casi se junta con la
    // otra, sale por detrás de la tapa. La derecha sostiene el libro por debajo.
    const cerrando = Promise.all([
      timeline.tween(1.4 * RITMO, (e) => {
        s.open = lerp(open0, 0, e);
        s.fold = lerp(fold0, 0, e);
        s.openness = 1 - smoothstep(0.1, 0.9, e);
        book.apply();
      }, ease.inOutSine),
      this.bookDriver.move(this.readTarget(book, false), 1.4, { easing: ease.inOutSine }),
    ]);
    let saliendo = null;
    timeline.wait(0.8 * RITMO).then(() => {
      saliendo = this.L.move(tg.leftSpine, 0.75, { pose: POSES.flat, arc: V(-0.05, -0.02, -0.05) });
    });
    await cerrando;
    await saliendo;
    await timeline.wait(0.15 * RITMO);
    // Girarlo con el lomo hacia el usuario; la derecha toma el canto superior.
    await Promise.all([
      this.bookDriver.move(this.presentTarget(book), 1.15, { easing: ease.inOutSine }),
      this.R.move(tg.pinch, 1.1, { pose: POSES.pinch, arc: V(0.07, 0.12, 0.05) }),
      this.animateView({ light: 0, dof: 0.6 }, 1.15),
    ]);
    // La izquierda suelta.
    this.L.move(this.restL, 0.9, { pose: POSES.relaxed, arc: V(-0.05, -0.06, 0) });
    // Llevarlo frente a su hueco.
    this.stepTo(1, 1.5);
    await Promise.all([
      this.bookDriver.move(this.pulledTarget(book), 1.5, { arc: V(0, 0.05, 0) }),
      this.animateView({ focus: 0.85, dof: 0.35 }, 1.4),
    ]);
    // Empujarlo a su lugar.
    await Promise.all([
      this.bookDriver.move(this.shelfTarget(book), 0.9, { easing: ease.inOutSine }),
      this.R.pose(POSES.hook, 0.6),
    ]);
    await timeline.wait(0.12 * RITMO);
    // Soltar y retirar la mano.
    await this.R.move(tg.hookApproach, 0.5, { pose: POSES.open });
    this.stepTo(0, 1.5);
    await Promise.all([
      this.R.move(this.restR, 1.1, { pose: POSES.relaxed, arc: V(0.05, 0.06, 0) }),
      this.animateView({ focus: 0, dof: 0 }, 1.2),
    ]);

    this.pages.release(book.content);
    book.state.fraction = 0;
    book.apply();
    book.liberarDetalle();
    book.modoEstante(true);
    book.hover = 0;
    book.hoverVel.v = 0;
    book.setGlow(0);
    book.onShelf = true;
    this.book = null;
    this.bookDriver = null;
    this.state = 'idle';
    timeline.timeScale = 1;
    this.gaze.enabled = true;
    this.ui.mode('browse');
  }

  // ---------------------------------------------------------------- por cuadro
  update(dt, time) {
    this.time = time;
    const look = this.look;
    if (this.bookDriver) this.bookDriver.update(dt);
    if (this.book) this.book.root.updateMatrixWorld(true);
    this.R.update(dt);
    this.L.update(dt);

    // Cuerpo: paso hacia el estante y balanceo del propio paso.
    look.offset.copy(this.leanDir).multiplyScalar(this.view.lean);
    look.offset.y += this.view.step * 0.02;
    if (this.walk && this.walk.pasos) {
      // Al caminar la cabeza sube y baja con cada paso (unos 60 cm por paso).
      const steps = Math.max(2, Math.round(this.walk.dist / 0.6));
      const amp = Math.sin(Math.PI * this.walk.t);
      look.offset.y += (Math.abs(Math.sin(this.walk.t * steps * Math.PI)) - 0.5) * 0.02 * amp;
    }
    if (this.climb) {
      // Al subir, el cuerpo se balancea de un larguero al otro.
      const amp = Math.sin(Math.PI * this.climb.t);
      look.offset.x += Math.sin(this.climb.t * this.climb.peldanos * Math.PI) * 0.014 * amp;
      look.offset.z += Math.sin(this.climb.t * this.climb.peldanos * Math.PI + 1) * 0.008 * amp;
    }
    this.body.position.copy(look.eye).add(look.offset);
    // El tronco acompaña un poco a la mirada, con retraso.
    this.torsoTarget = this.state === 'reading' || this.state === 'turning' ? this.torsoTarget : look.yaw * 0.32;
    this.torso.rotation.y = damp(this.torso.rotation.y, this.torsoTarget, 2.2, dt);
    // Al alcanzar el estante el tronco se inclina hacia adelante.
    this.torso.rotation.x = damp(this.torso.rotation.x, this.view.lean * 0.16, 2.5, dt);
    this.body.updateMatrixWorld(true);

    look.focusWeight = this.view.focus;
    if (this.book) {
      this.bookCenter(this.book, this.focusPoint);
      look.focusPoint.copy(this.focusPoint);
    } else if (this.walk || this.climb) {
      look.focusPoint.copy(this.walkTarget);
    }
    look.breath = 1 - this.view.dof * 0.6;
    this.readingLight.intensity = this.view.light * 0.55;
    // Apagada, la luz de lectura no necesita recalcular su sombra en cada cuadro
    // (pero el mapa de sombra tiene que existir: se dibuja al menos una vez).
    const shadow = this.readingLight.shadow;
    shadow.autoUpdate = this.view.light > 0.001 || !shadow.map;

    // Temblor y respiración de las manos, y cinemática inversa de cada brazo.
    for (const side of ['right', 'left']) {
      const arm = this.arms[side];
      const t = time + (side === 'right' ? 0 : 3.1);
      arm.frame.position.x += Math.sin(t * 1.7) * 0.0009 + Math.sin(t * 9.3) * 0.0003;
      arm.frame.position.y += Math.sin(t * 1.3 + 1.2) * 0.0011 + Math.sin(t * 11.1) * 0.0003;
      arm.frame.position.z += Math.sin(t * 1.1 + 2.4) * 0.0008;
      arm.frame.updateMatrixWorld(true);
      // El codo cae hacia abajo y algo atrás. Cuanto más cerca del cuerpo está la
      // mano, más se pega el codo al costado; al estirarse hacia el estante, se abre.
      const far = clamp(
        arm.frame.getWorldPosition(this._v).distanceTo(arm.upperArm.getWorldPosition(this._elbow))
        / (arm.lenUpper + arm.lenFore), 0, 1,
      );
      this._pole.set(arm.sign * lerp(0.26, 0.46, far), lerp(-0.86, -0.6, far), lerp(0.08, 0.3, far));
      this.torso.localToWorld(this._pole);
      arm.solve(this._pole);
    }

    // Profundidad de campo: suave en el estante, marcada al leer.
    const dof = this.rig.dof;
    if (this.book && this.view.dof > 0.001) {
      const dist = this.camera.position.distanceTo(this.focusPoint);
      dof.focus = lerp(dof.focus, dist, 1 - Math.exp(-dt * 10));
      dof.aperture = lerp(0.0012, 0.009, this.view.dof * this.view.dof);
      dof.maxblur = lerp(0.0035, 0.011, this.view.dof);
    }
  }
}

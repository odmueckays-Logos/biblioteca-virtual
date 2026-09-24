// Brazos y manos realistas (avatar de Microsoft Rocketbox, MIT) con codo resuelto
// por cinemática inversa y dedos articulados.
//
// Marco de la mano (el mismo que usaba el prototipo anterior, para no cambiar la
// coreografía): origen en la muñeca, -Z hacia la punta de los dedos, +Y el dorso,
// +X hacia la derecha cuando la palma mira hacia abajo.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clamp, lerp } from '../core/math.js';

const FINGERS = ['index', 'middle', 'ring', 'pinky'];
// Biped de 3ds Max: Finger0 = pulgar, Finger1..4 = índice a meñique.
const CHAIN_INDEX = { thumb: 0, index: 1, middle: 2, ring: 3, pinky: 4 };

// Las poses describen flexión por articulación, igual que antes:
//   dedos: [nudillo base, media, distal] · thumb: { cmcFlex, cmcAbd, mcp, ip }
const f = (mcp, pip, dip) => [mcp, pip, dip];
export const POSES = {
  relaxed: {
    index: f(0.28, 0.4, 0.22), middle: f(0.34, 0.48, 0.26), ring: f(0.4, 0.54, 0.3), pinky: f(0.46, 0.58, 0.32),
    spread: 0.05, thumb: { cmcFlex: 0.12, cmcAbd: 0.2, mcp: 0.18, ip: 0.22 },
  },
  open: {
    index: f(0.04, 0.06, 0.04), middle: f(0.05, 0.08, 0.05), ring: f(0.07, 0.1, 0.06), pinky: f(0.09, 0.12, 0.07),
    spread: 0.16, thumb: { cmcFlex: -0.05, cmcAbd: 0.45, mcp: 0.04, ip: 0.05 },
  },
  // Mano abierta para recibir: se usa mientras el brazo viaja hacia el libro.
  reach: {
    index: f(0.16, 0.2, 0.12), middle: f(0.2, 0.26, 0.14), ring: f(0.24, 0.3, 0.16), pinky: f(0.28, 0.34, 0.18),
    spread: 0.12, thumb: { cmcFlex: 0.05, cmcAbd: 0.4, mcp: 0.1, ip: 0.12 },
  },
  // Gancho: el índice se estira y solo dobla la punta, como al enganchar el canto
  // de un libro; los demás dedos se recogen para no estorbar.
  hook: {
    index: f(0.26, 0.62, 1.15), middle: f(1.05, 1.4, 0.85), ring: f(1.12, 1.45, 0.86), pinky: f(1.18, 1.45, 0.86),
    spread: 0.02, thumb: { cmcFlex: 0.32, cmcAbd: 0.2, mcp: 0.45, ip: 0.5 },
  },
  grip: {
    index: f(1.0, 1.1, 0.6), middle: f(1.05, 1.15, 0.62), ring: f(1.1, 1.2, 0.64), pinky: f(1.12, 1.2, 0.64),
    spread: 0.02, thumb: { cmcFlex: 0.5, cmcAbd: 0.6, mcp: 0.3, ip: 0.35 },
  },
  pinch: {
    index: f(0.6, 0.8, 0.38), middle: f(0.75, 1.0, 0.52), ring: f(0.9, 1.15, 0.6), pinky: f(1.0, 1.2, 0.62),
    spread: 0.03, thumb: { cmcFlex: 0.45, cmcAbd: 0.5, mcp: 0.22, ip: 0.28 },
  },
  hold: {
    index: f(0.4, 0.45, 0.22), middle: f(0.45, 0.5, 0.24), ring: f(0.5, 0.56, 0.27), pinky: f(0.55, 0.6, 0.3),
    spread: 0.08, thumb: { cmcFlex: 0.18, cmcAbd: 0.3, mcp: 0.12, ip: 0.16 },
  },
  // Sostener el libro abierto: los dedos por detrás y el pulgar estirado sobre el
  // margen (si el pulgar se dobla, solo asoma la yema y parece un muñón).
  flat: {
    index: f(0.14, 0.2, 0.12), middle: f(0.16, 0.22, 0.12), ring: f(0.19, 0.25, 0.14), pinky: f(0.22, 0.28, 0.15),
    spread: 0.07, thumb: { cmcFlex: 0.08, cmcAbd: 0.7, mcp: 0.05, ip: 0.08 },
  },
  thumbLift: {
    index: f(0.4, 0.45, 0.22), middle: f(0.45, 0.5, 0.24), ring: f(0.5, 0.56, 0.27), pinky: f(0.55, 0.6, 0.3),
    spread: 0.08, thumb: { cmcFlex: 0.4, cmcAbd: 0.32, mcp: 0.45, ip: 0.55 },
  },
};

export function blendPoses(a, b, t) {
  const out = { spread: lerp(a.spread, b.spread, t), thumb: {} };
  for (const k of FINGERS) out[k] = a[k].map((v, i) => lerp(v, b[k][i], t));
  for (const k of Object.keys(a.thumb)) out.thumb[k] = lerp(a.thumb[k], b.thumb[k], t);
  return out;
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _qC = new THREE.Quaternion();
const _qD = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _vD = new THREE.Vector3();
const _m = new THREE.Matrix4();

// Límites del antebrazo y de la muñeca (radianes).
const MAX_TWIST = 2.0; // pronación/supinación
const MAX_WRIST = 0.95; // ~55° de flexión o desviación

// Descompone una rotación en giro alrededor de `axis` (torsión) y el resto.
function swingTwist(q, axis, out) {
  const d = axis.dot(_v2.set(q.x, q.y, q.z));
  out.set(axis.x * d, axis.y * d, axis.z * d, q.w);
  if (out.lengthSq() < 1e-12) out.set(0, 0, 0, 1);
  return out.normalize();
}

function setWorldQuaternion(bone, quat) {
  if (bone.parent) {
    bone.parent.getWorldQuaternion(_q2).invert();
    bone.quaternion.copy(_q2).multiply(quat);
  } else {
    bone.quaternion.copy(quat);
  }
}

// Gira un hueso en el espacio del mundo (sobre su posición actual).
function rotateWorld(bone, axis, angle) {
  bone.getWorldQuaternion(_q);
  _q2.setFromAxisAngle(axis, angle);
  setWorldQuaternion(bone, _q.premultiply(_q2));
  bone.updateMatrixWorld(true);
}

export class Arm {
  constructor(root, side) {
    this.side = side; // 'right' | 'left'
    this.sign = side === 'right' ? 1 : -1;
    const S = side === 'right' ? 'R' : 'L';
    const bone = (n) => root.getObjectByName(n);
    this.clavicle = bone(`Bip01_${S}_Clavicle`);
    this.upperArm = bone(`Bip01_${S}_UpperArm`);
    this.forearm = bone(`Bip01_${S}_Forearm`);
    this.hand = bone(`Bip01_${S}_Hand`);
    this.fingers = {};
    for (const [name, i] of Object.entries(CHAIN_INDEX)) {
      this.fingers[name] = [bone(`Bip01_${S}_Finger${i}`), bone(`Bip01_${S}_Finger${i}1`), bone(`Bip01_${S}_Finger${i}2`)];
    }

    // Reposo: guardamos rotaciones y ejes de flexión calculados de la geometría.
    root.updateMatrixWorld(true);
    this.rest = new Map();
    const store = (b) => this.rest.set(b, { q: b.quaternion.clone(), p: b.position.clone() });
    [this.clavicle, this.upperArm, this.forearm, this.hand].forEach(store);
    for (const chain of Object.values(this.fingers)) chain.forEach(store);

    // Marco de la mano en reposo: dedos hacia los nudillos, dorso perpendicular.
    const wrist = this.hand.getWorldPosition(new THREE.Vector3());
    const knuckleMid = this.fingers.middle[0].getWorldPosition(new THREE.Vector3());
    const knuckleIndex = this.fingers.index[0].getWorldPosition(new THREE.Vector3());
    const knucklePinky = this.fingers.pinky[0].getWorldPosition(new THREE.Vector3());
    const fingersDir = knuckleMid.clone().sub(wrist).normalize();
    const across = knucklePinky.clone().sub(knuckleIndex).normalize();
    const dorsal = new THREE.Vector3().crossVectors(across, fingersDir).normalize().multiplyScalar(this.sign);
    this.restPalmNormal = dorsal.clone().negate();
    const zAxis = fingersDir.clone().negate();
    const yAxis = dorsal.clone().sub(zAxis.clone().multiplyScalar(dorsal.dot(zAxis))).normalize();
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
    const frameQuat = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(xAxis, yAxis, zAxis));
    // Corrección entre el marco de la mano y la orientación real del hueso.
    this.frameToBone = frameQuat.clone().invert().multiply(this.hand.getWorldQuaternion(new THREE.Quaternion()));
    this.wristOffset = wrist.clone(); // se recalcula por cuadro

    // Ejes locales de flexión de cada articulación (curvar hacia la palma).
    this.flexAxis = new Map();
    for (const [name, chain] of Object.entries(this.fingers)) {
      chain.forEach((b, i) => {
        const child = chain[i + 1] || null;
        const dir = child
          ? child.getWorldPosition(new THREE.Vector3()).sub(b.getWorldPosition(new THREE.Vector3())).normalize()
          : b.getWorldPosition(new THREE.Vector3()).sub(chain[i - 1].getWorldPosition(new THREE.Vector3())).normalize();
        const axisWorld = new THREE.Vector3().crossVectors(dir, this.restPalmNormal).normalize();
        const local = axisWorld.clone().applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
        this.flexAxis.set(b, local);
        if (i === 0) {
          const abdWorld = this.restPalmNormal.clone();
          this.flexAxis.set(`${name}-abd`, abdWorld.clone().applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize());
        }
      });
    }

    // Longitudes del brazo (para la cinemática inversa).
    this.lenUpper = this.upperArm.getWorldPosition(new THREE.Vector3()).distanceTo(this.forearm.getWorldPosition(new THREE.Vector3()));
    this.lenFore = this.forearm.getWorldPosition(new THREE.Vector3()).distanceTo(this.hand.getWorldPosition(new THREE.Vector3()));

    // Objetivo que mueve la coreografía (marco de la mano, en el mundo).
    this.frame = new THREE.Object3D();
    this.frame.name = `objetivo-mano-${side}`;
    this.pose = blendPoses(POSES.relaxed, POSES.relaxed, 0);
    this.reachStretch = 0; // cuánto se estira el brazo (0..1) cuando no alcanza
  }

  setPose(pose) {
    this.pose = pose;
  }

  applyFingers() {
    for (const [name, chain] of Object.entries(this.fingers)) {
      const isThumb = name === 'thumb';
      const values = isThumb
        ? [this.pose.thumb.cmcFlex, this.pose.thumb.mcp, this.pose.thumb.ip]
        : this.pose[name];
      chain.forEach((bone, i) => {
        if (!bone) return;
        const rest = this.rest.get(bone);
        bone.quaternion.copy(rest.q);
        // El eje se calculó como (dirección del hueso) × (normal de la palma): girar
        // un ángulo positivo lleva el dedo hacia la palma. Con el signo cambiado los
        // dedos se doblaban al revés (hiperextendidos, como una deformidad).
        const axis = this.flexAxis.get(bone);
        if (axis) bone.quaternion.multiply(_q.setFromAxisAngle(axis, values[i]));
        if (i === 0) {
          const abd = this.flexAxis.get(`${name}-abd`);
          if (abd) {
            const amount = isThumb
              ? this.pose.thumb.cmcAbd
              : this.pose.spread * { index: -1, middle: -0.3, ring: 0.4, pinky: 1 }[name];
            bone.quaternion.multiply(_q.setFromAxisAngle(abd, amount * (isThumb ? 1 : 0.6)));
          }
        }
      });
    }
  }

  // Cinemática inversa de dos huesos: coloca la muñeca en el objetivo y dobla el codo
  // hacia el vector de referencia (el codo cae hacia abajo y afuera, como en la vida real).
  solve(poleTarget) {
    const frame = this.frame;
    frame.updateWorldMatrix(true, false);
    const target = frame.getWorldPosition(_v.clone());
    const wristQuat = frame.getWorldQuaternion(new THREE.Quaternion()).multiply(this.frameToBone);

    // Reposo del brazo antes de resolver.
    for (const b of [this.clavicle, this.upperArm, this.forearm]) {
      const rest = this.rest.get(b);
      b.quaternion.copy(rest.q);
    }
    this.clavicle.updateMatrixWorld(true);

    const a = this.upperArm.getWorldPosition(new THREE.Vector3());
    const reach = a.distanceTo(target);
    const maxReach = (this.lenUpper + this.lenFore) * 0.995;
    this.reachStretch = clamp((reach - maxReach) / 0.25, 0, 1);

    // Si el objetivo queda lejos, el hombro y el tronco ayudan un poco.
    if (this.reachStretch > 0) {
      const dir = target.clone().sub(a).normalize();
      const shoulderShift = dir.multiplyScalar(Math.min(reach - maxReach, 0.18));
      this.clavicle.parent.getWorldQuaternion(_q2);
      const local = shoulderShift.applyQuaternion(_q2.invert());
      const rest = this.rest.get(this.clavicle);
      this.clavicle.position.copy(rest.p).add(local);
      this.clavicle.updateMatrixWorld(true);
    } else {
      this.clavicle.position.copy(this.rest.get(this.clavicle).p);
      this.clavicle.updateMatrixWorld(true);
    }

    const shoulder = this.upperArm.getWorldPosition(new THREE.Vector3());
    const elbow = this.forearm.getWorldPosition(new THREE.Vector3());
    const wrist = this.hand.getWorldPosition(new THREE.Vector3());
    const lenAB = this.lenUpper;
    const lenBC = this.lenFore;
    const lenAT = clamp(shoulder.distanceTo(target), 1e-4, lenAB + lenBC - 1e-4);

    const ab = elbow.clone().sub(shoulder);
    const bc = wrist.clone().sub(elbow);
    const ac = wrist.clone().sub(shoulder);
    const at = target.clone().sub(shoulder);
    const angle = (u, v) => Math.acos(clamp(u.clone().normalize().dot(v.clone().normalize()), -1, 1));

    // 1 · Doblar el codo hasta que la distancia hombro-muñeca sea la del objetivo.
    const acAb1 = Math.acos(clamp((lenBC * lenBC - lenAB * lenAB - lenAT * lenAT) / (-2 * lenAB * lenAT), -1, 1));
    const baBc1 = Math.acos(clamp((lenAT * lenAT - lenAB * lenAB - lenBC * lenBC) / (-2 * lenAB * lenBC), -1, 1));
    let bendAxis = new THREE.Vector3().crossVectors(ac, ab);
    if (bendAxis.lengthSq() < 1e-10) bendAxis.crossVectors(at, poleTarget.clone().sub(shoulder));
    if (bendAxis.lengthSq() < 1e-10) bendAxis.set(0, 1, 0);
    bendAxis.normalize();
    rotateWorld(this.upperArm, bendAxis, acAb1 - angle(ac, ab));
    rotateWorld(this.forearm, bendAxis, baBc1 - angle(ab.clone().negate(), bc));

    // 2 · Girar todo el brazo para que la muñeca apunte al objetivo.
    const wrist2 = this.hand.getWorldPosition(new THREE.Vector3()).sub(shoulder);
    const swingAxis = new THREE.Vector3().crossVectors(wrist2, at);
    if (swingAxis.lengthSq() > 1e-10) rotateWorld(this.upperArm, swingAxis.normalize(), angle(wrist2, at));

    // 3 · Rodar el brazo alrededor de esa línea para que el codo caiga hacia el vector guía.
    const axisRoll = at.clone().normalize();
    const elbow3 = this.forearm.getWorldPosition(new THREE.Vector3()).sub(shoulder);
    const poleDir = poleTarget.clone().sub(shoulder);
    const projElbow = elbow3.clone().addScaledVector(axisRoll, -elbow3.dot(axisRoll));
    const projPole = poleDir.clone().addScaledVector(axisRoll, -poleDir.dot(axisRoll));
    if (projElbow.lengthSq() > 1e-10 && projPole.lengthSq() > 1e-10) {
      projElbow.normalize();
      projPole.normalize();
      const roll = Math.atan2(new THREE.Vector3().crossVectors(projElbow, projPole).dot(axisRoll), projElbow.dot(projPole));
      rotateWorld(this.upperArm, axisRoll, roll);
    }

    this.applyWrist(wristQuat);
    this.applyFingers();
  }

  // La muñeca no puede girar sin límite: la torsión la hace el antebrazo
  // (pronación y supinación) y a la muñeca solo le queda flexionarse y desviarse,
  // dentro de un rango humano. Sin esto la mano se dobla de forma imposible.
  applyWrist(wristQuat) {
    const elbow = this.forearm.getWorldPosition(_vA);
    const wrist = this.hand.getWorldPosition(_vB);
    const axis = _vC.copy(wrist).sub(elbow);
    if (axis.lengthSq() < 1e-10) {
      setWorldQuaternion(this.hand, wristQuat);
      this.hand.updateMatrixWorld(true);
      return;
    }
    axis.normalize();

    // Diferencia entre la orientación deseada y la que trae el brazo.
    const current = this.hand.getWorldQuaternion(_qA);
    const delta = _qB.copy(wristQuat).multiply(_qC.copy(current).invert());

    // Torsión alrededor del eje del antebrazo (el resto es flexión/desviación).
    const twist = swingTwist(delta, axis, _qD);
    let twistAngle = 2 * Math.atan2(
      Math.sign(_vD.set(twist.x, twist.y, twist.z).dot(axis)) * _vD.length(),
      twist.w,
    );
    if (twistAngle > Math.PI) twistAngle -= 2 * Math.PI;
    if (twistAngle < -Math.PI) twistAngle += 2 * Math.PI;
    rotateWorld(this.forearm, axis, clamp(twistAngle, -MAX_TWIST, MAX_TWIST));

    // Lo que falta lo hace la muñeca, limitada a un ángulo razonable.
    const after = this.hand.getWorldQuaternion(_qA);
    const rest = _qB.copy(wristQuat).multiply(_qC.copy(after).invert());
    rest.normalize();
    let angle = 2 * Math.acos(clamp(Math.abs(rest.w), -1, 1));
    const s = Math.sqrt(Math.max(1e-12, 1 - rest.w * rest.w));
    _vD.set(rest.x, rest.y, rest.z).divideScalar(s * (rest.w < 0 ? -1 : 1));
    if (angle > MAX_WRIST) angle = MAX_WRIST;
    _qD.setFromAxisAngle(_vD.normalize(), angle);
    setWorldQuaternion(this.hand, _qD.multiply(after));
    this.hand.updateMatrixWorld(true);
  }

  // Posición de una articulación en el marco de la mano (en metros), con una pose dada.
  jointInHand(jointName, pose, target = new THREE.Vector3()) {
    const saved = this.pose;
    if (pose) this.pose = pose;
    this.applyFingers();
    this.hand.updateMatrixWorld(true);
    const bone = this.resolveJoint(jointName);
    bone.getWorldPosition(target);
    target.sub(this.hand.getWorldPosition(_v));
    // Del mundo al marco de la mano: orientación del hueso corregida.
    this.hand.getWorldQuaternion(_q).multiply(_q2.copy(this.frameToBone).invert());
    target.applyQuaternion(_q.invert());
    this.pose = saved;
    this.applyFingers();
    return target;
  }

  resolveJoint(name) {
    if (name === 'palm') return this.fingers.middle[0];
    const map = {
      'index-finger-tip': [this.fingers.index[2], 1],
      'thumb-tip': [this.fingers.thumb[2], 1],
      'middle-finger-phalanx-proximal': [this.fingers.middle[0], 0],
    };
    return (map[name] || [this.fingers.index[2]])[0];
  }

  // Centro aproximado de la palma en el marco de la mano.
  palmInHand(pose, target = new THREE.Vector3()) {
    this.jointInHand('palm', pose, target);
    target.multiplyScalar(0.62);
    target.y -= 0.016;
    return target;
  }
}

export async function loadArms({ textures, scale = 0.01, path = 'assets/models/brazos.glb' }) {
  const gltf = await new GLTFLoader().loadAsync(path);
  const root = gltf.scene;
  root.scale.setScalar(scale);
  root.name = 'brazos';

  let mesh = null;
  root.traverse((o) => {
    if (o.isSkinnedMesh) mesh = o;
  });
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.material = new THREE.MeshPhysicalMaterial({
    map: textures.color,
    normalMap: textures.normal,
    roughnessMap: textures.roughness,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.85,
  });
  mesh.material.normalScale.set(0.9, -0.9);
  // Dispersión leve de la luz en la piel.
  mesh.material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
      reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.07, 0.022, 0.014);`,
    );
  };

  root.updateMatrixWorld(true);
  const right = new Arm(root, 'right');
  const left = new Arm(root, 'left');
  return { root, mesh, right, left };
}

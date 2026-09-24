// La cámara son los ojos: la posición del puntero indica hacia dónde mirar.
// El giro se suaviza como un movimiento de cabeza, con respiración muy leve.
//
// Quien mueve el puntero es `src/main.js`: con el mouse capturado en la ventana,
// la posición se lleva a mano sumando el movimiento del ratón.
import * as THREE from 'three';
import { clamp, lerp, smoothDamp } from './math.js';

const DEG = Math.PI / 180;

// Curva suave: precisa cerca del centro y más rápida hacia los bordes.
const shape = (n) => Math.sign(n) * (0.62 * Math.abs(n) + 0.38 * Math.pow(Math.abs(n), 3));

export class LookController {
  constructor(camera) {
    this.camera = camera;
    this.eye = new THREE.Vector3(0, 1.5, 0);
    this.offset = new THREE.Vector3(); // inclinación del cuerpo (acercarse al estante)
    // Los límites de la cabeza cambian según lo que haya alrededor del estante:
    // se gira más hacia el vecino y se mira más arriba si hay un estante encima
    // (ver `setSurroundings`).
    this.limits = { yawLeft: 50 * DEG, yawRight: 50 * DEG, up: 18 * DEG, down: -42 * DEG, rest: -15 * DEG };
    this.targetLimits = { yawLeft: 50 * DEG, yawRight: 50 * DEG, up: 18 * DEG, down: -42 * DEG, rest: -15 * DEG };

    this.pointer = new THREE.Vector2(0, 0); // -1..1
    this.hasPointer = false;
    this.yaw = 0;
    this.pitch = this.limits.rest;
    this.roll = 0;
    this.vYaw = { v: 0 };
    this.vPitch = { v: 0 };
    this.vRoll = { v: 0 };
    this.smoothTime = 0.2;

    // Mirada dirigida (secuencias y lectura): 0 = libre, 1 = mira `focusPoint`.
    this.focusWeight = 0;
    this.focusPoint = new THREE.Vector3(0, 1, -2);
    this.focusParallax = 3 * DEG;

    this.breath = 1;
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._dir = new THREE.Vector3();
  }

  // Posición del puntero en la ventana, de 0 a 1.
  setPointer(nx, ny) {
    this.pointer.set(nx * 2 - 1, -(ny * 2 - 1));
    this.hasPointer = true;
  }

  // Qué hay alrededor del estante que se tiene enfrente: vecinos a los lados,
  // estantes acoplados encima o debajo, y si se está subido a la escalera (ahí se
  // mira más abajo, porque el estante queda pegado, y se gira más la cabeza).
  setSurroundings({ izquierda = false, derecha = false, arriba = false, abajo = false, escalera = false } = {}) {
    const lateral = escalera ? 68 : 64;
    this.targetLimits.yawLeft = (izquierda ? lateral : 50) * DEG;
    this.targetLimits.yawRight = (derecha ? lateral : 50) * DEG;
    this.targetLimits.up = (arriba ? 40 : escalera ? 24 : 18) * DEG;
    this.targetLimits.down = (escalera ? -60 : abajo ? -48 : -42) * DEG;
    // Subido a la escalera se mira casi de frente: el estante está a un brazo de
    // distancia y los peldaños quedan por debajo de la vista.
    this.targetLimits.rest = (escalera ? -6 : -15) * DEG;
  }

  freeTarget() {
    const { yawLeft, yawRight, up, down, rest } = this.limits;
    const nx = clamp(this.pointer.x, -1, 1);
    const ny = clamp(this.pointer.y, -1, 1);
    const yaw = -shape(nx) * (nx < 0 ? yawLeft : yawRight);
    const pitch = ny >= 0 ? rest + shape(ny) * (up - rest) : rest + shape(ny) * (rest - down);
    return { yaw, pitch };
  }

  focusTarget() {
    const pos = this.camera.position;
    this._dir.copy(this.focusPoint).sub(pos);
    const yaw = Math.atan2(-this._dir.x, -this._dir.z);
    const pitch = Math.atan2(this._dir.y, Math.hypot(this._dir.x, this._dir.z));
    return {
      yaw: yaw - this.pointer.x * this.focusParallax,
      pitch: pitch + this.pointer.y * this.focusParallax * 0.7,
    };
  }

  update(dt, time) {
    for (const k of ['yawLeft', 'yawRight', 'up', 'down', 'rest']) this.limits[k] = lerp(this.limits[k], this.targetLimits[k], 1 - Math.exp(-3 * dt));
    const free = this.freeTarget();
    let targetYaw = free.yaw;
    let targetPitch = free.pitch;
    if (this.focusWeight > 0.0001) {
      const f = this.focusTarget();
      targetYaw = lerp(free.yaw, f.yaw, this.focusWeight);
      targetPitch = lerp(free.pitch, f.pitch, this.focusWeight);
    }

    const prevYaw = this.yaw;
    this.yaw = smoothDamp(this.yaw, targetYaw, this.vYaw, this.smoothTime, dt);
    this.pitch = smoothDamp(this.pitch, targetPitch, this.vPitch, this.smoothTime * 1.1, dt);

    // Inclinación mínima al girar rápido, como al mover la cabeza.
    const yawSpeed = dt > 0 ? (this.yaw - prevYaw) / dt : 0;
    const targetRoll = clamp(yawSpeed * 0.012, -1.2 * DEG, 1.2 * DEG);
    this.roll = smoothDamp(this.roll, targetRoll, this.vRoll, 0.35, dt);

    // Respiración y microbalanceo.
    const b = this.breath;
    const breathe = Math.sin(time * Math.PI * 2 * 0.21);
    const sway = Math.sin(time * 0.37) * 0.6 + Math.sin(time * 0.61 + 1.3) * 0.4;

    this.camera.position.set(
      this.eye.x + this.offset.x + sway * 0.0012 * b,
      this.eye.y + this.offset.y + breathe * 0.0026 * b,
      this.eye.z + this.offset.z,
    );
    this._euler.set(
      this.pitch + breathe * 0.1 * DEG * b,
      this.yaw + sway * 0.08 * DEG * b,
      this.roll,
    );
    this.camera.quaternion.setFromEuler(this._euler);
  }
}

// Animaciones con await, sin librerías. Todas avanzan con el mismo reloj,
// que se puede acelerar (clic durante una animación) o pausar (modo debug).
import { ease as easings } from './math.js';

class Timeline {
  constructor() {
    this.tweens = new Set();
    this.timeScale = 1;
    this.paused = false;
  }

  // Anima t de 0 a 1 durante `duration` segundos y llama a onUpdate(e, t).
  tween(duration, onUpdate, ease = easings.inOutCubic) {
    return new Promise((resolve) => {
      const tw = { elapsed: 0, duration: Math.max(0.0001, duration), onUpdate, ease, resolve };
      onUpdate(ease(0), 0);
      this.tweens.add(tw);
    });
  }

  wait(duration) {
    return this.tween(duration, () => {}, easings.linear);
  }

  update(dt) {
    if (this.paused) return;
    this.advance(dt * this.timeScale);
  }

  advance(dt) {
    for (const tw of [...this.tweens]) {
      tw.elapsed += dt;
      const t = Math.min(1, tw.elapsed / tw.duration);
      tw.onUpdate(tw.ease(t), t);
      if (t >= 1) {
        this.tweens.delete(tw);
        tw.resolve();
      }
    }
  }

  get busy() {
    return this.tweens.size > 0;
  }
}

export const timeline = new Timeline();

// La mirada: un rayo desde el centro de la vista. El libro observado sobresale
// un poco, se ilumina sutilmente y muestra su ficha de catálogo al lado.
//
// Solo se pueden tomar los libros del estante que se tiene enfrente. Si se mira
// un estante acoplado al lado, encima o debajo, su placa brilla y aparece su
// cartel: con un clic se va hasta él (caminando, o subiendo la escalera).
import * as THREE from 'three';
import { damp, smoothDamp } from '../core/math.js';

export class Gaze {
  constructor({ camera, reticle, ficha, hoverLight }) {
    this.camera = camera;
    this.reticle = reticle;
    this.ficha = ficha;
    this.hoverLight = hoverLight;
    this.enabled = false;
    this.books = [];
    this.shelves = [];
    this.station = 0; // estante que se tiene enfrente
    this.hovered = null; // libro
    this.hoveredShelf = null; // estante vecino
    this.candidate = null;
    this.lost = 0;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 8;
    this.center = new THREE.Vector2(0, 0);
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._axis = new THREE.Vector3(1, 0, 0);
    this.onFirstHover = null;
  }

  // Libros y estantes de la biblioteca (cambian al reconstruirla).
  setWorld(books, shelves) {
    this.books = books;
    this.shelves = shelves;
    for (const b of books) {
      b.hover = 0;
      b.hoverVel = { v: 0 };
    }
    for (const s of shelves) s.glow = 0;
    this.clear();
  }

  // El estante que se tiene enfrente.
  get actual() {
    return this.shelves[this.station] || null;
  }

  // Un estante es vecino si está acoplado al lado, encima o debajo del actual.
  vecino(estante) {
    const actual = this.actual;
    if (!actual || estante === actual) return false;
    return Math.abs(estante.columna - actual.columna) <= 1 && Math.abs(estante.nivel - actual.nivel) <= 1;
  }

  // Hacia dónde queda ese estante: x = -1 izquierda / 1 derecha, y = -1 abajo / 1 arriba.
  rumbo(estante) {
    const actual = this.actual;
    if (!actual) return { x: 0, y: 0 };
    return { x: Math.sign(estante.columna - actual.columna), y: Math.sign(estante.nivel - actual.nivel) };
  }

  update(dt) {
    let hit = null;
    if (this.enabled) {
      this.raycaster.setFromCamera(this.center, this.camera);
      const targets = [];
      for (const b of this.books) if (b.onShelf && b.estante === this.station) targets.push(b.hitbox);
      for (const s of this.shelves) if (this.vecino(s)) targets.push(s.hitbox);
      const hits = this.raycaster.intersectObjects(targets, false);
      if (hits.length) hit = hits[0].object.userData.book || hits[0].object.userData.estante;
    }
    if (hit) {
      this.candidate = hit;
      this.lost = 0;
    } else {
      this.lost += dt;
      if (this.lost > 0.14) this.candidate = null;
    }
    const current = this.hovered || this.hoveredShelf;
    if (this.candidate !== current) {
      const isShelf = this.candidate && this.candidate.hitbox && this.candidate.slots;
      this.hovered = this.candidate && !isShelf ? this.candidate : null;
      this.hoveredShelf = isShelf ? this.candidate : null;
      if (this.hovered) {
        this.ficha.show(this.hovered);
        if (this.onFirstHover) {
          this.onFirstHover();
          this.onFirstHover = null;
        }
      } else if (this.hoveredShelf) {
        this.ficha.showShelf(this.hoveredShelf, this.rumbo(this.hoveredShelf));
      } else {
        this.ficha.hide();
      }
    }
    this.reticle.classList.toggle('active', !!(this.hovered || this.hoveredShelf));

    let strongest = null;
    for (const book of this.books) {
      if (!book.onShelf) continue;
      const target = book === this.hovered ? 1 : 0;
      if (target === 0 && book.hover === 0) continue;
      book.hover = smoothDamp(book.hover, target, book.hoverVel, 0.13, dt);
      if (target === 0 && book.hover < 0.0005 && Math.abs(book.hoverVel.v) < 0.001) book.hover = 0;
      const h = Math.max(0, book.hover);
      // Sobresale hacia el usuario, se eleva apenas y se inclina.
      book.root.position.copy(book.shelfPosition);
      book.root.position.z += 0.026 * h;
      book.root.position.y += 0.003 * h;
      this._q.setFromAxisAngle(this._axis, 0.022 * h);
      book.root.quaternion.copy(book.shelfQuaternion).premultiply(this._q);
      book.setGlow(h);
      if (!strongest || h > strongest.hover) strongest = book;
    }

    // La placa del estante vecino brilla mientras se mira.
    for (const shelf of this.shelves) {
      const target = shelf === this.hoveredShelf ? 1 : 0;
      if (shelf.glow === target) continue;
      shelf.glow = damp(shelf.glow, target, 8, dt);
      if (Math.abs(shelf.glow - target) < 0.002) shelf.glow = target;
      shelf.plaque.material.emissiveIntensity = 0.35 * shelf.glow;
    }

    const light = this.hoverLight;
    if (strongest && strongest.hover > 0.001) {
      light.position.copy(strongest.root.position).add(this._v.set(0, 0.06, 0.24));
      light.intensity = 0.55 * strongest.hover;
    } else {
      light.intensity = 0;
    }

    this.ficha.update(dt, this.camera);
  }

  clear() {
    this.candidate = null;
    this.hovered = null;
    this.hoveredShelf = null;
    this.ficha.hide();
    this.reticle.classList.remove('active');
  }
}

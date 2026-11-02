// Efectos de partículas ligeros basados en sprites (aditivos) y mallas simples.
import * as THREE from 'three';

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const emojiCache = new Map();
export function emojiTexture(ch) {
  if (emojiCache.has(ch)) return emojiCache.get(ch);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = '96px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(ch, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  emojiCache.set(ch, t);
  return t;
}

const MAX_ITEMS = 700;

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.glow = glowTexture();
    this.enabled = true;
  }

  _sprite(tex, color, additive = true) {
    const m = new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    const s = new THREE.Sprite(m);
    this.scene.add(s);
    return s;
  }

  burst(pos, { color = 0xffffff, count = 18, speed = 4, size = 0.6, life = 0.9, gravity = -5, up = 1.5, additive = true } = {}) {
    if (!this.enabled) count = Math.ceil(count / 4);
    for (let i = 0; i < count && this.items.length < MAX_ITEMS; i++) {
      const s = this._sprite(this.glow, color, additive);
      s.position.copy(pos);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      v.y += up;
      const sz = size * (0.5 + Math.random() * 0.8);
      s.scale.setScalar(sz);
      this.items.push({ kind: 'p', s, vel: v, life, max: life, size: sz, gravity });
    }
  }

  emoji(pos, ch, count = 5, { size = 1, rise = 2.4, life = 1.5, spread = 1 } = {}) {
    for (let i = 0; i < count && this.items.length < MAX_ITEMS; i++) {
      const s = this._sprite(emojiTexture(ch), 0xffffff, false);
      s.position.set(pos.x + (Math.random() - 0.5) * spread, pos.y + Math.random() * 0.4, pos.z + (Math.random() - 0.5) * spread);
      const sz = size * (0.7 + Math.random() * 0.5);
      s.scale.setScalar(sz);
      this.items.push({ kind: 'p', s, vel: new THREE.Vector3((Math.random() - 0.5) * 0.8, rise * (0.6 + Math.random() * 0.6), (Math.random() - 0.5) * 0.8), life: life * (0.8 + Math.random() * 0.4), max: life, size: sz, gravity: 0, grow: true });
    }
  }

  ring(pos, color = 0xffffff, { maxR = 3, ms = 700, y = 0.15 } = {}) {
    const geo = new THREE.RingGeometry(0.85, 1, 48);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, y, pos.z);
    this.scene.add(m);
    this.items.push({ kind: 'ring', m, life: ms / 1000, max: ms / 1000, maxR });
  }

  beam(pos, color = 0xffffff, { height = 9, ms = 900, radius = 0.9 } = {}) {
    const geo = new THREE.CylinderGeometry(radius, radius, height, 24, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos.x, height / 2, pos.z);
    this.scene.add(m);
    this.items.push({ kind: 'beam', m, life: ms / 1000, max: ms / 1000, radius });
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      const k = Math.max(0, it.life / it.max);
      if (it.kind === 'p') {
        it.s.position.addScaledVector(it.vel, dt);
        it.vel.y += it.gravity * dt;
        it.s.material.opacity = Math.min(1, k * 1.6);
        it.s.scale.setScalar(it.grow ? it.size * (1.3 - k * 0.3) : it.size * (0.4 + k * 0.6));
      } else if (it.kind === 'ring') {
        const r = 0.3 + (1 - k) * it.maxR;
        it.m.scale.set(r, r, r);
        it.m.material.opacity = k;
      } else if (it.kind === 'beam') {
        const w = it.radius * (0.4 + k * 0.6);
        it.m.scale.set(w / it.radius, 1, w / it.radius);
        it.m.material.opacity = k * 0.8;
      }
      if (it.life <= 0) {
        const o = it.s || it.m;
        this.scene.remove(o);
        o.material.dispose();
        if (it.m) it.m.geometry.dispose();
        this.items.splice(i, 1);
      }
    }
  }
}

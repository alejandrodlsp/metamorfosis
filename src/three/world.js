// Mundo 3D: isla con circuito, corredores, cámara, animaciones y efectos.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CIRCUITS } from '../../shared/board.js';
import { CHAR_BY_ID } from '../../shared/characters.js';
import { portraitUrl, modelInfo } from '../assets.js';
import { FX } from './fx.js';
import { sfx } from '../audio.js';

const TILE_TOP = 0.2;
const BASE_Y = 0.32; // altura de los pies del corredor
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);
const easeOut = (t) => 1 - (1 - t) ** 3;
const hex = (c) => new THREE.Color(c);

function seeded(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function gradientTexture(top, bottom) {
  return canvasTexture(4, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, top);
    gr.addColorStop(1, bottom);
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
}

function labelTexture(text, sub, color) {
  return canvasTexture(320, 96, (g, w, h) => {
    g.fillStyle = color;
    roundRect(g, 4, 4, w - 8, h - 8, 26);
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(255,255,255,.85)';
    g.stroke();
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,.45)';
    g.shadowBlur = 4;
    g.font = '800 38px system-ui, sans-serif';
    g.fillText(text.length > 14 ? `${text.slice(0, 13)}…` : text, w / 2, sub ? 38 : h / 2);
    if (sub) {
      g.font = '600 24px system-ui, sans-serif';
      g.fillStyle = 'rgba(255,255,255,.9)';
      g.fillText(sub, w / 2, 71);
    }
  });
}

function numberTexture(n, special) {
  return canvasTexture(64, 64, (g) => {
    g.fillStyle = special ? 'rgba(20,10,40,.8)' : 'rgba(255,255,255,.72)';
    g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fill();
    g.fillStyle = special ? '#fff' : '#2b1b4d';
    g.font = '800 30px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(n), 32, 34);
  });
}

function checker(g, w, h, n, a, b) {
  const s = w / n;
  for (let y = 0; y < h / s; y++) for (let x = 0; x < n; x++) { g.fillStyle = (x + y) % 2 ? a : b; g.fillRect(x * s, y * s, s, s); }
}

// Decal del suelo de cada casilla especial (la X del lienzo = sentido de la carrera).
function decalTexture(sp, tileColor) {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = tileColor;
    g.fillRect(0, 0, w, h);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const arrow = (dir, col) => {
      g.save();
      g.translate(w / 2, h / 2);
      g.scale(dir, 1);
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(-85, -34); g.lineTo(10, -34); g.lineTo(10, -78); g.lineTo(88, 0); g.lineTo(10, 78); g.lineTo(10, 34); g.lineTo(-85, 34);
      g.closePath(); g.fill();
      g.restore();
    };
    switch (sp.type) {
      case 'arrow': {
        arrow(sp.delta > 0 ? 1 : -1, 'rgba(255,255,255,.95)');
        g.fillStyle = sp.delta > 0 ? '#0b6b66' : '#8a2d00';
        g.font = '800 70px system-ui';
        g.fillText(`${sp.delta > 0 ? '+' : ''}${sp.delta}`, w / 2 - 6, h / 2 + 4);
        break;
      }
      case 'trip':
        g.fillStyle = '#fff'; g.font = '150px system-ui'; g.fillText('⚠️', w / 2, h / 2 + 8);
        break;
      case 'portal':
        g.font = '130px system-ui'; g.fillText('🌀', w / 2, h / 2 - 10);
        g.fillStyle = '#fff'; g.font = '800 54px system-ui'; g.fillText(`→ ${sp.to}`, w / 2, h - 44);
        break;
      case 'mud':
        g.font = '120px system-ui'; g.fillText('🟤', w / 2, h / 2 - 8);
        g.fillStyle = '#fff'; g.font = '800 54px system-ui'; g.fillText('-2', w / 2, h - 44);
        break;
      case 'star':
        g.font = '140px system-ui'; g.fillText('⭐', w / 2, h / 2 + 8);
        break;
      case 'start':
        checker(g, w, h, 4, '#ffffff', '#52c26b');
        g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, h / 2 - 34, w, 68);
        g.fillStyle = '#fff'; g.font = '800 46px system-ui'; g.fillText('SALIDA', w / 2, h / 2 + 3);
        break;
      case 'finish':
        checker(g, w, h, 6, '#ffffff', '#1b1030');
        break;
      default:
    }
    g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,.18)'; g.strokeRect(0, 0, w, h);
  });
}

const TILE_COLORS = {
  normal: ['#fff3d6', '#f6e3b8'], start: ['#6fd37f'], finish: ['#ffffff'], star: ['#ffd447'],
  arrow: ['#55d6c9'], trip: ['#e94b4b'], portal: ['#a066f0'], mud: ['#a8743d'],
};

class RacerView {
  constructor(world, r) {
    this.world = world;
    this.id = r.id;
    this.charId = r.charId;
    this.color = r.color;
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.pivot = new THREE.Group();
    this.group.add(this.body);
    this.body.add(this.pivot);
    this.busy = 0;
    this.phase = Math.random() * 6;
    this.lying = false;
    const s = world.racerScale;
    this.scale = s;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62 * s, 0.7 * s, 0.2, 32), new THREE.MeshStandardMaterial({ color: r.color, roughness: 0.4, emissive: r.color, emissiveIntensity: 0.25 }));
    base.position.y = 0.1;
    base.castShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.66 * s, 0.05 * s, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.2;
    this.group.add(base, ring);
    this.base = base;

    const info = modelInfo(r.charId);
    if (info) this.loadModel(info);
    else this.buildStandee(r);

    const sub = CHAR_BY_ID[r.charId]?.name || '';
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(r.name, sub, r.color), transparent: true, depthTest: false }));
    this.label.scale.set(3.0 * s, 0.9 * s, 1);
    this.label.position.y = 2.85 * s;
    this.label.renderOrder = 10;
    this.group.add(this.label);

    this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.28 * s, 0.6 * s, 4), new THREE.MeshBasicMaterial({ color: 0xffe14d }));
    this.marker.rotation.x = Math.PI;
    this.marker.visible = false;
    this.group.add(this.marker);

    this.statusSprite = null;
  }

  buildStandee(r) {
    const s = this.scale;
    const w = 1.75 * s;
    const h = 2.2 * s;
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.16 * s, h + 0.16 * s), new THREE.MeshBasicMaterial({ color: r.color, side: THREE.DoubleSide }));
    frame.position.set(0, 0.2 + h / 2 + 0.08 * s, -0.01);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, alphaTest: 0.05 });
    const card = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    card.position.set(0, 0.2 + h / 2 + 0.08 * s, 0.005);
    new THREE.TextureLoader().load(portraitUrl(r.charId), (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      mat.map = tex;
      mat.needsUpdate = true;
    }, undefined, () => {
      const c = CHAR_BY_ID[r.charId];
      mat.map = canvasTexture(128, 160, (g, cw, ch) => {
        g.fillStyle = c?.color || '#777'; g.fillRect(0, 0, cw, ch);
        g.font = '80px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(c?.glyph || '?', cw / 2, ch / 2);
      });
      mat.needsUpdate = true;
    });
    this.pivot.add(frame, card);
    this.standee = this.pivot;
  }

  loadModel(info) {
    new GLTFLoader().load(info.url, (gltf) => {
      gltf.scene.scale.setScalar(info.scale * this.scale);
      gltf.scene.position.y = 0.2;
      gltf.scene.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.pivot.add(gltf.scene);
      this.isModel = true;
    }, undefined, () => { this.isModel = false; });
    // Mientras carga (o si falla) se muestra la ficha.
    this.buildStandee({ charId: this.charId, color: this.color });
  }

  setActive(on) { this.marker.visible = on; }

  setStatusEmoji(ch) {
    if (this.statusSprite) { this.group.remove(this.statusSprite); this.statusSprite = null; }
    if (!ch) return;
    this.statusSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.world.emoji(ch), transparent: true, depthTest: false }));
    this.statusSprite.scale.set(0.9 * this.scale, 0.9 * this.scale, 1);
    this.statusSprite.position.set(0.9 * this.scale, 2.2 * this.scale, 0.2);
    this.statusSprite.renderOrder = 11;
    this.group.add(this.statusSprite);
  }
}

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 600);
    this.camera.position.set(0, 30, 40);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = 1.38;
    this.controls.minPolarAngle = 0.25;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 110;
    this.controls.autoRotateSpeed = 0.6;

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8c7fb0, 1.05);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.0);
    this.sun.position.set(25, 45, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 5, far: 140 });
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.hemi, this.sun);

    this.fx = new FX(this.scene);
    this.tweens = [];
    this.timeScale = 1;
    this.racers = new Map();
    this.vis = {};
    this.floaters = [];
    this.props = [];
    this.tileMeshes = [];
    this.clouds = [];
    this.circuitId = null;
    this.mode = 'showcase';
    this.followId = null;
    this.followOn = true;
    this.shake = 0;
    this.emojiCache = new Map();
    this.time = 0;
    this.onHover = null;
    this.podiumMeshes = [];
    this.last = performance.now();

    this.ray = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    canvas.addEventListener('pointermove', (e) => this.pointer(e));
    canvas.addEventListener('pointerleave', () => this.onHover?.(null));
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.flushTweens(); });
    this.resize();
    this.setCircuit('normal');
    requestAnimationFrame((t) => this.loop(t));
  }

  get floatLayer() { return document.getElementById('floaters'); }

  emoji(ch) {
    if (!this.emojiCache.has(ch)) {
      this.emojiCache.set(ch, canvasTexture(128, 128, (g) => { g.font = '96px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, 64, 70); }));
    }
    return this.emojiCache.get(ch);
  }

  setQuality({ shadows = true, particles = true } = {}) {
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    this.fx.enabled = particles;
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ tweens
  tween(ms, fn, ease = easeInOut) {
    return new Promise((resolve) => {
      if (document.hidden) { fn(1); resolve(); return; }
      this.tweens.push({ start: performance.now(), dur: Math.max(1, ms * this.timeScale), fn, ease, resolve });
    });
  }

  flushTweens() {
    for (const tw of this.tweens.splice(0)) { tw.fn(1); tw.resolve(); }
  }

  sleep(ms) { return this.tween(ms, () => {}); }

  // ------------------------------------------------------------------ tablero
  setCircuit(id) {
    if (this.circuitId === id) return;
    this.circuitId = id;
    const c = CIRCUITS[id];
    this.circuit = c;
    if (this.board) {
      this.scene.remove(this.board);
      this.board.traverse((o) => { o.geometry?.dispose?.(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map?.dispose?.(); m.dispose(); }); } });
    }
    for (const v of this.racers.values()) this.scene.remove(v.group);
    this.racers.clear();
    this.vis = {};
    this.props = [];
    this.tileMeshes = [];
    this.clouds = [];
    this.podiumMeshes = [];
    if (this.stars) { this.scene.remove(this.stars); this.stars = null; }

    const g = new THREE.Group();
    this.board = g;
    this.scene.add(g);
    this.applyTheme(c.theme, id);

    const curve = new THREE.CatmullRomCurve3(c.layout.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
    const L = c.length;
    this.tiles = [];
    for (let i = 0; i <= L; i++) {
      const u = i / L;
      this.tiles.push({ p: curve.getPointAt(u), t: curve.getTangentAt(u).setY(0).normalize() });
    }
    const spacing = curve.getLength() / L;
    this.tileSize = Math.min(2.7, spacing * 0.86);
    this.racerScale = Math.max(0.78, Math.min(1.15, this.tileSize / 2.1));

    this.buildTiles(g);
    this.buildIsland(g);
    this.buildDecor(g, id);
    this.buildGates(g);
    this.fitBoard(true);
  }

  applyTheme(theme, id) {
    this.scene.background = gradientTexture(theme.sky[0], theme.sky[1]);
    this.scene.fog = new THREE.Fog(hex(theme.sky[1]), 110, 320);
    const wild = id === 'wild';
    this.hemi.color.set(wild ? 0xcdb8ff : 0xffffff);
    this.hemi.groundColor.set(wild ? 0x5b3a96 : 0x8c7fb0);
    this.sun.color.set(wild ? 0xffb3e6 : 0xfff2d6);
    this.sun.intensity = wild ? 1.7 : 2.0;
  }

  tilePos(i) {
    const t = this.tiles[Math.max(0, Math.min(this.circuit.length, i))];
    return new THREE.Vector3(t.p.x, TILE_TOP, t.p.z);
  }

  buildTiles(g) {
    const c = this.circuit;
    const ts = this.tileSize;
    const geo = new RoundedBoxGeometry(ts, 0.4, ts, 3, 0.1);
    const decalGeo = new THREE.PlaneGeometry(ts * 0.92, ts * 0.92);
    const numGeo = new THREE.PlaneGeometry(1, 1);
    this.starMeshes = {};
    for (let i = 0; i <= c.length; i++) {
      const sp = c.spaces[i];
      const { p, t } = this.tiles[i];
      const cols = TILE_COLORS[sp.type] || TILE_COLORS.normal;
      const color = cols[i % cols.length];
      const tile = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.55 }));
      tile.position.set(p.x, 0, p.z);
      tile.rotation.y = Math.atan2(-t.z, t.x);
      tile.castShadow = true;
      tile.receiveShadow = true;
      tile.userData.index = i;
      g.add(tile);
      this.tileMeshes.push(tile);
      if (sp.type !== 'normal') {
        const d = new THREE.Mesh(decalGeo, new THREE.MeshBasicMaterial({ map: decalTexture(sp, color), transparent: false }));
        d.rotation.x = -Math.PI / 2;
        d.position.y = 0.202;
        tile.add(d);
      }
      // número de casilla
      const n = new THREE.Sprite(new THREE.SpriteMaterial({ map: numberTexture(i, sp.type !== 'normal'), transparent: true, depthWrite: false }));
      n.scale.set(0.8, 0.8, 1);
      const side = new THREE.Vector3(-t.z, 0, t.x);
      n.position.set(p.x + side.x * (ts * 0.56 + 0.1), 0.55, p.z + side.z * (ts * 0.56 + 0.1));
      g.add(n);
      this.addProp(g, sp, i);
    }
  }

  addProp(g, sp, i) {
    const { p, t } = this.tiles[i];
    if (sp.type === 'star') {
      const shape = new THREE.Shape();
      for (let k = 0; k < 10; k++) {
        const r = k % 2 ? 0.28 : 0.7;
        const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
        k === 0 ? shape.moveTo(Math.cos(a) * r, Math.sin(a) * r) : shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      const star = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2 }), new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffa800, emissiveIntensity: 0.7, metalness: 0.4, roughness: 0.3 }));
      star.position.set(p.x, 1.55, p.z);
      star.castShadow = true;
      g.add(star);
      this.starMeshes[i] = star;
      this.props.push({ kind: 'star', m: star, y: 1.55, phase: i });
    } else if (sp.type === 'portal') {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.12, 12, 40), new THREE.MeshStandardMaterial({ color: 0xb388ff, emissive: 0x8a4dff, emissiveIntensity: 1.1 }));
      ring.position.set(p.x, 1.25, p.z);
      ring.rotation.y = Math.atan2(-t.z, t.x) + Math.PI / 2;
      g.add(ring);
      this.props.push({ kind: 'portal', m: ring });
    } else if (sp.type === 'trip') {
      const mat = new THREE.MeshStandardMaterial({ color: 0x5a1a1a, roughness: 0.6 });
      for (let k = 0; k < 3; k++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.6, 6), mat);
        const a = (k / 3) * Math.PI * 2;
        spike.position.set(p.x + Math.cos(a) * 0.55, 0.5, p.z + Math.sin(a) * 0.55);
        g.add(spike);
      }
    } else if (sp.type === 'mud') {
      const mat = new THREE.MeshStandardMaterial({ color: 0x5b3a1a, roughness: 1 });
      for (let k = 0; k < 4; k++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.22 + (k % 2) * 0.08, 10, 8), mat);
        b.scale.y = 0.4;
        b.position.set(p.x + (k - 1.5) * 0.35, 0.28, p.z + ((k * 37) % 5 - 2) * 0.18);
        g.add(b);
      }
    }
  }

  buildIsland(g) {
    const xs = this.tiles.map((t) => t.p.x);
    const zs = this.tiles.map((t) => t.p.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    this.center = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    this.rx = (maxX - minX) / 2 + 8;
    this.rz = (maxZ - minZ) / 2 + 8;
    const wild = this.circuitId === 'wild';
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1.4, 64), new THREE.MeshStandardMaterial({ color: this.circuit.theme.ground, roughness: 0.95 }));
    top.scale.set(this.rx, 1, this.rz);
    top.position.set(this.center.x, -0.7, this.center.z);
    top.receiveShadow = true;
    g.add(top);
    const rock = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.12, 1, 14, 1), new THREE.MeshStandardMaterial({ color: wild ? 0x3b2a63 : 0x7a5a3a, roughness: 1, flatShading: true }));
    rock.scale.set(this.rx * 0.98, 14, this.rz * 0.98);
    rock.position.set(this.center.x, -8.2, this.center.z);
    g.add(rock);
  }

  buildDecor(g, id) {
    const rnd = seeded(id === 'wild' ? 77 : 33);
    const wild = id === 'wild';
    const pts = this.tiles.map((t) => t.p);
    const treeMat = new THREE.MeshStandardMaterial({ color: wild ? 0x7d4fd1 : 0x2f9e57, roughness: 0.9, flatShading: true });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a4a2a, roughness: 1 });
    const crystalMat = new THREE.MeshStandardMaterial({ color: 0x8ad8ff, emissive: 0x3b9cff, emissiveIntensity: 0.9, flatShading: true, transparent: true, opacity: 0.92 });
    const stoneMat = new THREE.MeshStandardMaterial({ color: wild ? 0x5a4a80 : 0x9a9a9a, flatShading: true, roughness: 1 });
    let placed = 0;
    for (let tries = 0; tries < 400 && placed < 46; tries++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd());
      const x = this.center.x + Math.cos(a) * (this.rx - 1.5) * r;
      const z = this.center.z + Math.sin(a) * (this.rz - 1.5) * r;
      if (pts.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 3.8 ** 2)) continue;
      placed++;
      const k = rnd();
      const s = 0.8 + rnd() * 1.1;
      const grp = new THREE.Group();
      if (wild) {
        if (k < 0.45) {
          const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.8, 0), crystalMat);
          cr.scale.set(0.6, 1.8, 0.6); cr.position.y = 1.2 * s; grp.add(cr);
          grp.scale.setScalar(s);
          this.props.push({ kind: 'bob', m: cr, y: cr.position.y, phase: rnd() * 6 });
        } else if (k < 0.8) {
          const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.7, 8), new THREE.MeshStandardMaterial({ color: 0xf0e6ff }));
          stem.position.y = 0.35;
          const cap = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: k < 0.6 ? 0xff5db1 : 0x59e0ff, roughness: 0.6 }));
          cap.position.y = 0.7;
          grp.add(stem, cap); grp.scale.setScalar(s * 1.3);
        } else {
          const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7), stoneMat);
          rock.position.y = 0.4; rock.scale.set(1, 0.7, 1); grp.add(rock); grp.scale.setScalar(s);
        }
      } else if (k < 0.6) {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.8, 8), trunkMat);
        trunk.position.y = 0.4; grp.add(trunk);
        for (let j = 0; j < 3; j++) {
          const cone = new THREE.Mesh(new THREE.ConeGeometry(0.9 - j * 0.2, 1.1, 8), treeMat);
          cone.position.y = 1.1 + j * 0.65; cone.castShadow = true; grp.add(cone);
        }
        grp.scale.setScalar(s);
      } else if (k < 0.85) {
        const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 0), new THREE.MeshStandardMaterial({ color: 0x4cc46a, flatShading: true }));
        bush.position.y = 0.5; bush.castShadow = true; grp.add(bush); grp.scale.setScalar(s);
      } else {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6), stoneMat);
        rock.position.y = 0.3; grp.add(rock); grp.scale.setScalar(s);
      }
      grp.position.set(x, 0, z);
      grp.rotation.y = rnd() * 6;
      grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
      g.add(grp);
    }
    // nubes
    const cloudMat = new THREE.MeshBasicMaterial({ color: wild ? 0xffc4f0 : 0xffffff, transparent: true, opacity: 0.85, fog: false });
    for (let i = 0; i < 8; i++) {
      const c = new THREE.Group();
      for (let j = 0; j < 4; j++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(2 + rnd() * 1.6, 12, 8), cloudMat);
        s.position.set(j * 2.4 - 3.5, rnd(), rnd() * 2);
        s.scale.y = 0.6;
        c.add(s);
      }
      c.userData = { r: this.rx + 14 + rnd() * 24, a: rnd() * 6.28, y: 8 + rnd() * 16, sp: 0.01 + rnd() * 0.02 };
      this.clouds.push(c);
      g.add(c);
    }
    if (wild) {
      const n = 400;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const u = rnd() * Math.PI * 2, v = Math.acos(rnd() * 0.9 + 0.05), R = 260;
        arr.set([R * Math.sin(v) * Math.cos(u), R * Math.cos(v) * 0.9 + 20, R * Math.sin(v) * Math.sin(u)], i * 3);
      }
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      this.stars = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, fog: false }));
      this.scene.add(this.stars);
    }
  }

  buildGates(g) {
    const mk = (i, text, bannerColor) => {
      const { p, t } = this.tiles[i];
      const grp = new THREE.Group();
      const side = new THREE.Vector3(-t.z, 0, t.x);
      const half = this.tileSize * 0.8;
      const poleMat = new THREE.MeshStandardMaterial({ color: 0xf4f0ff, roughness: 0.5 });
      for (const sgn of [-1, 1]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 3.2, 10), poleMat);
        pole.position.set(side.x * half * sgn, 1.6, side.z * half * sgn);
        pole.castShadow = true;
        grp.add(pole);
      }
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 + 0.4, 1), new THREE.MeshBasicMaterial({
        map: canvasTexture(512, 128, (cg, w, h) => {
          if (text === 'META') { checker(cg, w, h, 16, '#fff', '#1b1030'); } else { cg.fillStyle = bannerColor; cg.fillRect(0, 0, w, h); }
          cg.fillStyle = 'rgba(0,0,0,.55)'; cg.fillRect(0, h / 2 - 34, w, 68);
          cg.fillStyle = '#fff'; cg.font = '800 56px system-ui'; cg.textAlign = 'center'; cg.textBaseline = 'middle'; cg.fillText(text, w / 2, h / 2 + 3);
        }), side: THREE.DoubleSide,
      }));
      banner.position.set(0, 3.2, 0);
      banner.rotation.y = Math.atan2(-side.z, side.x);
      grp.add(banner);
      grp.position.set(p.x, TILE_TOP, p.z);
      g.add(grp);
      return grp;
    };
    mk(0, 'SALIDA', '#2d9d5b');
    mk(this.circuit.length, 'META', '#000');
  }

  fitBoard(instant = false) {
    const R = Math.max(this.rx, this.rz);
    const aspect = this.camera.aspect;
    const k = aspect < 1.3 ? 1.5 : 1;
    const target = this.center.clone();
    const pos = new THREE.Vector3(this.center.x + R * 0.15, R * 1.05 * k, this.center.z + R * 1.2 * k);
    this.controls.maxDistance = R * 4;
    if (instant) {
      this.controls.target.copy(target);
      this.camera.position.copy(pos);
      return Promise.resolve();
    }
    const t0 = this.controls.target.clone();
    const p0 = this.camera.position.clone();
    return this.tween(900, (k2) => {
      this.controls.target.lerpVectors(t0, target, k2);
      this.camera.position.lerpVectors(p0, pos, k2);
    });
  }

  setMode(mode) {
    this.mode = mode;
    this.controls.autoRotate = mode === 'showcase';
    if (mode === 'showcase') this.followId = null;
  }

  // ------------------------------------------------------------------ corredores
  ensureRacer(r) {
    let v = this.racers.get(r.id);
    if (!v) {
      v = new RacerView(this, r);
      this.racers.set(r.id, v);
      this.scene.add(v.group);
    }
    return v;
  }

  slotTarget(id) {
    const tile = this.vis[id];
    const same = [...this.racers.keys()].filter((k) => this.vis[k] === tile && this.racers.get(k).group.visible && !this.racers.get(k).gone);
    const n = same.length;
    const base = this.tilePos(tile);
    base.y = BASE_Y - 0.12;
    if (n <= 1) return base;
    const i = same.indexOf(id);
    const a = (i / n) * Math.PI * 2 + 0.6;
    const rad = Math.min(0.6 + n * 0.12, 1) * this.tileSize * 0.42;
    base.x += Math.cos(a) * rad;
    base.z += Math.sin(a) * rad * 0.8;
    return base;
  }

  podiumPos(place) {
    const L = this.circuit.length;
    const { p, t } = this.tiles[L];
    const side = new THREE.Vector3(-t.z, 0, t.x);
    const h = place === 1 ? 1.3 : 0.8;
    const pos = new THREE.Vector3(p.x + t.x * 3.6 + side.x * (place === 1 ? 0 : 2.4), h + TILE_TOP, p.z + t.z * 3.6 + side.z * (place === 1 ? 0 : 2.4));
    return { pos, h };
  }

  ensurePodium(place) {
    if (this.podiumMeshes[place]) return;
    const { pos, h } = this.podiumPos(place);
    const b = new THREE.Mesh(new THREE.BoxGeometry(2, h, 2), new THREE.MeshStandardMaterial({ color: place === 1 ? 0xffd23f : 0xd0d6e0, roughness: 0.4, metalness: 0.4 }));
    b.position.set(pos.x, h / 2, pos.z);
    b.castShadow = true;
    this.board.add(b);
    this.podiumMeshes[place] = b;
  }

  resetRace() {
    for (const v of this.racers.values()) this.scene.remove(v.group);
    this.racers.clear();
    this.vis = {};
    for (const m of this.podiumMeshes) if (m) this.board.remove(m);
    this.podiumMeshes = [];
    for (const m of Object.values(this.starMeshes)) m.visible = true;
  }

  /** Sincronización instantánea con el estado del servidor. */
  syncRacers(race) {
    const ids = new Set(race.racers ? Object.keys(race.racers) : []);
    for (const [id, v] of this.racers) if (!ids.has(id)) { this.scene.remove(v.group); this.racers.delete(id); }
    for (const r of Object.values(race.racers)) {
      const v = this.ensureRacer(r);
      v.gone = r.eliminated;
      if (r.eliminated) { v.group.visible = false; continue; }
      v.group.visible = true;
      v.group.scale.setScalar(1);
      if (r.finished) {
        if (r.place <= 2) { this.ensurePodium(r.place); const { pos } = this.podiumPos(r.place); v.group.position.copy(pos); v.group.position.y = pos.y; }
        v.podium = true;
        continue;
      }
      this.vis[r.id] = r.pos;
    }
    for (const r of Object.values(race.racers)) {
      const v = this.racers.get(r.id);
      if (!v || r.eliminated || r.finished) continue;
      if (!v.busy) v.group.position.copy(this.slotTarget(r.id));
      this.setLying(v, r.tripped, true);
      v.setStatusEmoji(r.tripped ? '💫' : r.mods?.length ? '🐌' : null);
    }
    for (const [pos, m] of Object.entries(this.starMeshes)) m.visible = race.starsClaimed?.[pos] == null;
  }

  layoutRacers() {
    for (const id of this.racers.keys()) {
      const v = this.racers.get(id);
      if (v.busy || v.podium || v.gone || !v.group.visible) continue;
      const to = this.slotTarget(id);
      const from = v.group.position.clone();
      if (from.distanceTo(to) < 0.02) continue;
      v.busy++;
      this.tween(280, (k) => v.group.position.lerpVectors(from, to, k)).then(() => { v.busy--; });
    }
  }

  setActive(id) {
    for (const [k, v] of this.racers) v.setActive(k === id);
    if (id && this.followOn && this.mode === 'race') this.followId = id;
  }

  setLying(v, on, instant = false) {
    if (v.lying === on) return Promise.resolve();
    v.lying = on;
    const to = on ? 1.35 : 0;
    const from = v.body.rotation.z;
    if (instant) { v.body.rotation.z = to; return Promise.resolve(); }
    return this.tween(380, (k) => { v.body.rotation.z = from + (to - from) * k; }, easeOut);
  }

  hop(v, to, ms, height = 0.9) {
    const from = v.group.position.clone();
    return this.tween(ms, (k) => {
      v.group.position.lerpVectors(from, to, k);
      v.group.position.y += Math.sin(k * Math.PI) * height;
    }, (t) => t);
  }

  async moveRacer(id, from, to, { type = 'MAIN', dir = 1 } = {}) {
    const v = this.racers.get(id);
    if (!v) return;
    v.busy++;
    try {
      if (type === 'TELEPORT') {
        sfx.teleport();
        const c0 = v.group.position.clone();
        this.fx.beam(c0, 0xb388ff, { ms: 700 });
        this.fx.burst(c0.clone().setY(1.5), { color: 0xd1b3ff, count: 26, speed: 3 });
        await this.tween(360, (k) => { v.group.scale.setScalar(1 - k * 0.98); v.body.rotation.y = k * 6; }, (t) => t);
        this.vis[id] = to;
        v.group.position.copy(this.slotTarget(id));
        const c1 = v.group.position.clone();
        this.fx.beam(c1, 0xb388ff, { ms: 700 });
        this.fx.ring(c1, 0xd1b3ff, { maxR: 2.8 });
        await this.tween(360, (k) => { v.group.scale.setScalar(0.02 + k * 0.98); v.body.rotation.y = (1 - k) * 6; }, (t) => t);
        v.body.rotation.y = 0;
      } else {
        const step = dir > 0 ? 1 : -1;
        const color = type === 'EXTRA' ? 0xff9f1c : 0xffffff;
        for (let i = from + step; step > 0 ? i <= to : i >= to; i += step) {
          this.vis[id] = i;
          const last = i === to;
          const target = last ? this.slotTarget(id) : this.tilePos(i).setY(BASE_Y - 0.12);
          sfx.hop();
          await this.hop(v, target, 190, type === 'EXTRA' ? 0.6 : 0.9);
          this.fx.burst(target.clone().setY(0.4), { color, count: 3, speed: 1.2, size: 0.45, life: 0.4, up: 0.5, gravity: 0 });
        }
      }
    } finally {
      v.busy--;
    }
    this.layoutRacers();
  }

  async swapRacers(a, b, posA, posB) {
    const va = this.racers.get(a);
    const vb = this.racers.get(b);
    if (!va || !vb) return;
    sfx.teleport();
    va.busy++; vb.busy++;
    for (const v of [va, vb]) { this.fx.beam(v.group.position, 0xffa94d, { ms: 800 }); this.fx.burst(v.group.position.clone().setY(1.5), { color: 0xffc27a, count: 22 }); }
    await this.tween(360, (k) => { for (const v of [va, vb]) { v.group.scale.setScalar(1 - k * 0.98); v.body.rotation.y = k * 6; } }, (t) => t);
    this.vis[a] = posA;
    this.vis[b] = posB;
    va.group.position.copy(this.slotTarget(a));
    vb.group.position.copy(this.slotTarget(b));
    for (const v of [va, vb]) this.fx.ring(v.group.position, 0xffc27a, { maxR: 2.8 });
    await this.tween(360, (k) => { for (const v of [va, vb]) { v.group.scale.setScalar(0.02 + k * 0.98); v.body.rotation.y = (1 - k) * 6; } }, (t) => t);
    va.body.rotation.y = 0; vb.body.rotation.y = 0;
    va.busy--; vb.busy--;
    this.layoutRacers();
  }

  async trip(id) {
    const v = this.racers.get(id);
    if (!v) return;
    sfx.trip();
    const p = v.group.position.clone().setY(1.3);
    this.fx.emoji(p, '💫', 4, { size: 0.9 });
    this.fx.burst(p, { color: 0xffe066, count: 14, speed: 3 });
    v.setStatusEmoji('💫');
    this.shake = 0.25;
    await this.setLying(v, true);
  }

  async recover(id) {
    const v = this.racers.get(id);
    if (!v) return;
    v.setStatusEmoji(null);
    await this.setLying(v, false);
  }

  async eliminate(id) {
    const v = this.racers.get(id);
    if (!v) return;
    sfx.elim();
    v.busy++;
    const p = v.group.position.clone().setY(1.4);
    this.fx.burst(p, { color: 0xff3b3b, count: 40, speed: 6, size: 0.8 });
    this.fx.emoji(p, '💀', 3, { size: 1.2 });
    this.fx.ring(v.group.position, 0xff3b3b, { maxR: 4 });
    this.shake = 0.6;
    await this.tween(900, (k) => { v.group.scale.setScalar(1 - k); v.body.rotation.y = k * 12; });
    v.group.visible = false;
    v.gone = true;
    v.busy--;
    this.layoutRacers();
  }

  async finishRacer(id, place) {
    const v = this.racers.get(id);
    if (!v) return;
    sfx.finish();
    v.busy++;
    const L = this.circuit.length;
    this.vis[id] = L;
    const end = this.tilePos(L).setY(BASE_Y - 0.12);
    if (v.group.position.distanceTo(end) > 0.3) await this.hop(v, end, 260);
    this.confetti(end.clone().setY(2));
    if (place <= 2) {
      this.ensurePodium(place);
      const { pos } = this.podiumPos(place);
      pos.y += 0.0;
      await this.hop(v, pos, 700, 2.2);
      for (let i = 0; i < 2; i++) await this.hop(v, pos.clone(), 320, 0.9);
      v.podium = true;
    }
    v.busy--;
    this.layoutRacers();
  }

  claimStar(pos) {
    const m = this.starMeshes[pos];
    sfx.star();
    if (m) {
      const p = m.position.clone();
      this.fx.burst(p, { color: 0xffe066, count: 30, speed: 5, size: 0.7 });
      this.fx.emoji(p, '⭐', 4, { size: 0.9 });
      m.visible = false;
    }
  }

  tileFlash(pos, color = 0xffffff) {
    this.fx.ring(this.tilePos(pos), color, { maxR: this.tileSize * 1.6, ms: 600 });
  }

  confetti(pos) {
    for (const color of [0xff4d6d, 0xffd23f, 0x3d8bff, 0x2fd27a, 0xa45cff, 0xffffff]) {
      this.fx.burst(pos, { color, count: 14, speed: 7, size: 0.5, life: 1.8, gravity: -6, up: 4 });
    }
  }

  racerPoint(id, y = 1.4) {
    const v = this.racers.get(id);
    return v ? v.group.position.clone().setY(y) : this.center.clone();
  }

  abilityFx(racerId, anim, targets = []) {
    const P = this.racerPoint(racerId);
    const T = targets.map((t) => this.racerPoint(t));
    const fx = this.fx;
    sfx.ability();
    switch (anim) {
      case 'sparkle': fx.burst(P, { color: 0xffe066, count: 28, speed: 3.5 }); fx.emoji(P, '✨', 4); break;
      case 'dash': fx.ring(P, 0x5ad7ff, { maxR: 3 }); fx.burst(P, { color: 0x9be7ff, count: 16, speed: 5, gravity: 0, up: 0 }); break;
      case 'pulse': fx.ring(P, 0xffd23f, { maxR: 3.5 }); fx.ring(P, 0xffffff, { maxR: 2.2, ms: 500 }); break;
      case 'curse': fx.burst(P, { color: 0x9b5de5, count: 24, speed: 2.5, gravity: 1, size: 0.9 }); T.forEach((t) => { fx.burst(t, { color: 0x6a1bb1, count: 20, speed: 2, gravity: 1 }); fx.emoji(t, '☠️', 2); }); break;
      case 'trap': fx.burst(P, { color: 0x9aff5a, count: 20, speed: 3 }); T.forEach((t) => fx.burst(t, { color: 0xffe066, count: 16, speed: 3 })); break;
      case 'attack': T.forEach((t) => { fx.burst(t, { color: 0xff4d4d, count: 26, speed: 6 }); fx.emoji(t, '💥', 2, { size: 1.3 }); }); sfx.zap(); this.shake = 0.35; break;
      case 'teleport': fx.beam(P, 0xb388ff, { ms: 900 }); T.forEach((t) => fx.beam(t, 0xb388ff, { ms: 900 })); break;
      case 'shield': fx.ring(P, 0x59d2ff, { maxR: 2.6 }); fx.emoji(P, '🛡️', 2); break;
      case 'bite': T.forEach((t) => { fx.emoji(t, '🦷', 3, { size: 1.2 }); fx.burst(t, { color: 0xff2b2b, count: 22, speed: 5 }); }); this.shake = 0.4; break;
      case 'gold': fx.emoji(P, '🪙', 6, { size: 0.8 }); fx.burst(P, { color: 0xffd23f, count: 18 }); break;
      case 'confetti': this.confetti(P); break;
      case 'hearts': fx.emoji(P, '💖', 6, { size: 0.9 }); T.forEach((t) => fx.emoji(t, '💖', 3, { size: 0.8 })); break;
      case 'zzz': fx.emoji(P, '💤', 4, { size: 1.1, rise: 1.4 }); break;
      case 'swirl': fx.ring(P, 0xb388ff, { maxR: 3 }); fx.ring(P, 0x7cf3ff, { maxR: 2, ms: 900 }); fx.burst(P, { color: 0xc9a7ff, count: 20, speed: 3 }); break;
      default: fx.burst(P, { color: 0xffffff, count: 18 });
    }
  }

  floatText(id, text, color = '#fff') {
    const el = document.createElement('div');
    el.className = 'floater';
    el.textContent = text;
    el.style.color = color;
    this.floatLayer.append(el);
    const base = this.racerPoint(id, 3.4);
    this.floaters.push({ el, base, t: 0, life: 1.6 });
  }

  // ------------------------------------------------------------------ interacción
  pointer(e) {
    if (!this.onHover || !this.tileMeshes.length) return;
    const now = performance.now();
    if (now - (this._lastPointer || 0) < 60) return;
    this._lastPointer = now;
    this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    this.ray.setFromCamera(this.mouse, this.camera);
    const hit = this.ray.intersectObjects(this.tileMeshes, false)[0];
    this.onHover(hit ? hit.object.userData.index : null, e.clientX, e.clientY);
  }

  // ------------------------------------------------------------------ bucle
  loop(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;

    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      const k = Math.min(1, (now - tw.start) / tw.dur);
      tw.fn(tw.ease(k));
      if (k >= 1) { this.tweens.splice(i, 1); tw.resolve(); }
    }

    const cam = this.camera.position;
    for (const [, v] of this.racers) {
      if (!v.group.visible) continue;
      v.pivot.rotation.y = Math.atan2(cam.x - v.group.position.x, cam.z - v.group.position.z);
      if (!v.busy) v.body.position.y = Math.sin(this.time * 2.2 + v.phase) * 0.05;
      if (v.marker.visible) {
        v.marker.position.y = (3.55 + Math.sin(this.time * 5) * 0.18) * v.scale;
        v.marker.rotation.y += dt * 3;
      }
    }

    for (const p of this.props) {
      if (p.kind === 'star') { p.m.rotation.y += dt * 1.8; p.m.position.y = p.y + Math.sin(this.time * 2 + p.phase) * 0.15; }
      else if (p.kind === 'portal') { p.m.rotation.z += dt * 2; }
      else if (p.kind === 'bob') { p.m.position.y = p.y + Math.sin(this.time + p.phase) * 0.25; p.m.rotation.y += dt * 0.5; }
    }
    for (const c of this.clouds) {
      const d = c.userData;
      d.a += d.sp * dt;
      c.position.set(this.center.x + Math.cos(d.a) * d.r, d.y, this.center.z + Math.sin(d.a) * d.r * 0.8);
    }

    // seguimiento de cámara
    if (this.followId && this.followOn && this.mode === 'race') {
      const v = this.racers.get(this.followId);
      if (v) {
        const tgt = new THREE.Vector3(v.group.position.x, 0.5, v.group.position.z);
        const delta = tgt.clone().sub(this.controls.target).multiplyScalar(1 - Math.exp(-dt * 1.8));
        this.controls.target.add(delta);
        this.camera.position.add(delta);
      }
    }
    this.controls.update();
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.5;
      this.shake = Math.max(0, this.shake - dt * 1.2);
    }
    this.fx.update(dt);
    this.updateFloaters(dt);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame((t) => this.loop(t));
  }

  updateFloaters(dt) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      const p = f.base.clone().add(new THREE.Vector3(0, f.t * 1.2, 0)).project(this.camera);
      f.el.style.transform = `translate(${(p.x * 0.5 + 0.5) * w}px, ${(-p.y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`;
      f.el.style.opacity = String(Math.min(1, (f.life - f.t) * 2));
      if (f.t > f.life) { f.el.remove(); this.floaters.splice(i, 1); }
    }
  }
}

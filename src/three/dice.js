// Dado 3D en su propio mini-renderizador.
import * as THREE from 'three';

const FACES = [2, 5, 1, 6, 3, 4]; // +x, -x, +y, -y, +z, -z (opuestas suman 7)
const NORMALS = {
  2: new THREE.Vector3(1, 0, 0), 5: new THREE.Vector3(-1, 0, 0),
  1: new THREE.Vector3(0, 1, 0), 6: new THREE.Vector3(0, -1, 0),
  3: new THREE.Vector3(0, 0, 1), 4: new THREE.Vector3(0, 0, -1),
};
const PIPS = {
  1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], 6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

function faceTexture(n, pip) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#fffaf0';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#e6d9bd';
  g.lineWidth = 8;
  g.strokeRect(4, 4, 120, 120);
  g.fillStyle = pip;
  for (const [x, y] of PIPS[n]) {
    g.beginPath();
    g.arc(32 + x * 32, 32 + y * 32, 11, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class DiceView {
  constructor(container, size = 150) {
    this.size = size;
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(size, size);
    this.renderer.domElement.className = 'dice-canvas';
    container.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    this.camera.position.set(0, 2.6, 3.6);
    this.camera.lookAt(0, 0.2, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6666aa, 1.4));
    const dl = new THREE.DirectionalLight(0xffffff, 1.6);
    dl.position.set(3, 6, 4);
    this.scene.add(dl);
    this.cube = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), []);
    this.scene.add(this.cube);
    this.camDir = this.camera.position.clone().normalize();
    this.setColor('#3d8bff');
    this.show(1);
    this.busy = false;
  }

  setColor(hex) {
    if (this.hex === hex) return;
    this.hex = hex;
    this.cube.material = FACES.map((n) => new THREE.MeshStandardMaterial({ map: faceTexture(n, hex), roughness: 0.35 }));
  }

  orientation(value, yaw = 0) {
    const q = new THREE.Quaternion().setFromUnitVectors(NORMALS[value], this.camDir);
    const roll = new THREE.Quaternion().setFromAxisAngle(this.camDir, yaw);
    return roll.multiply(q);
  }

  show(value) {
    this.cube.quaternion.copy(this.orientation(value, 0.25));
    this.cube.position.set(0, 0.2, 0);
    this.renderer.render(this.scene, this.camera);
  }

  roll(value, hex, ms = 1100) {
    this.setColor(hex);
    const target = this.orientation(value, Math.random() * Math.PI * 2);
    const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const spins = 5 + Math.random() * 3;
    const start = performance.now();
    this.busy = true;
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; this.busy = false; this.show(value); resolve(); };
      if (document.hidden) return finish();
      setTimeout(finish, ms + 400);
      const frame = (now) => {
        if (done) return;
        const t = Math.min(1, (now - start) / ms);
        const e = 1 - (1 - t) ** 3;
        const spin = new THREE.Quaternion().setFromAxisAngle(axis, spins * Math.PI * 2 * (1 - e));
        this.cube.quaternion.copy(target).premultiply(spin);
        this.cube.position.y = 0.2 + Math.abs(Math.sin(t * Math.PI * 3.2)) * 1.2 * (1 - t);
        this.renderer.render(this.scene, this.camera);
        if (t < 1) requestAnimationFrame(frame);
        else finish();
      };
      requestAnimationFrame(frame);
    });
  }
}

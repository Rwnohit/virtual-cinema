/**
 * Simple avatars for the other people in the room.
 *
 * Deliberately cheap: a capsule body, a head, a small wedge that shows which
 * way they are looking, a floating name tag and a ring that lights up while
 * they talk. Everything shares as few materials as possible.
 */

import * as THREE_DEFAULT from 'three';

const HEAD_Y = 1.5;
const BODY_Y = 0.85;

export class AvatarManager {
  constructor({ scene, three, camera } = {}) {
    this.THREE = three || THREE_DEFAULT;
    this.scene = scene || null;
    this.camera = camera || null;
    /** @type {Map<string, {group:any, ring:any, material:any, label:any, dispose:Function}>} */
    this.avatars = new Map();
    this.group = new this.THREE.Group();
    this.group.name = 'net-avatars';
    if (this.scene) this.scene.add(this.group);
    this._sharedGeo = null;
  }

  attach(scene, camera) {
    if (camera) this.camera = camera;
    if (!scene || scene === this.scene) return;
    this.scene = scene;
    scene.add(this.group);
  }

  _geometries() {
    if (this._sharedGeo) return this._sharedGeo;
    const T = this.THREE;
    const body = T.CapsuleGeometry
      ? new T.CapsuleGeometry(0.26, 0.7, 4, 12)
      : new T.CylinderGeometry(0.26, 0.26, 1.0, 12);
    this._sharedGeo = {
      body,
      head: new T.SphereGeometry(0.21, 20, 14),
      nose: new T.ConeGeometry(0.07, 0.18, 8),
      ring: new T.TorusGeometry(0.42, 0.035, 8, 28),
    };
    return this._sharedGeo;
  }

  add(peer) {
    if (this.avatars.has(peer.id)) return this.avatars.get(peer.id);
    const T = this.THREE;
    const geo = this._geometries();
    const color = new T.Color(peer.color || '#8ab4ff');

    const group = new T.Group();
    group.name = `avatar-${peer.id}`;

    const skin = new T.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.05 });

    const body = new T.Mesh(geo.body, skin);
    body.position.y = BODY_Y;
    body.castShadow = true;
    group.add(body);

    const head = new T.Mesh(geo.head, skin);
    head.position.y = HEAD_Y;
    head.castShadow = true;
    group.add(head);

    // Points along -Z, the same direction a Three.js camera looks at.
    const nose = new T.Mesh(geo.nose, skin);
    nose.position.set(0, HEAD_Y, -0.2);
    nose.rotation.x = -Math.PI / 2;
    group.add(nose);

    const ringMat = new T.MeshBasicMaterial({ color, transparent: true, opacity: 0 });
    const ring = new T.Mesh(geo.ring, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    group.add(ring);

    const label = makeLabel(T, peer.name, peer.color);
    label.position.y = HEAD_Y + 0.45;
    group.add(label);

    group.position.set(peer.position[0], peer.position[1] - 1.6, peer.position[2]);
    this.group.add(group);

    const entry = {
      group,
      ring,
      ringMat,
      label,
      material: skin,
      name: peer.name,
      dispose() {
        skin.dispose();
        ringMat.dispose();
        label.material.map?.dispose();
        label.material.dispose();
      },
    };
    this.avatars.set(peer.id, entry);
    return entry;
  }

  remove(id) {
    const entry = this.avatars.get(id);
    if (!entry) return;
    this.group.remove(entry.group);
    entry.dispose();
    this.avatars.delete(id);
  }

  clear() {
    for (const id of [...this.avatars.keys()]) this.remove(id);
  }

  /** Called once per frame with the interpolated peer store. */
  update(peers, dt = 0.016, elapsed = 0) {
    // add or drop avatars so the scene always matches the peer list
    for (const peer of peers.list()) {
      if (!this.avatars.has(peer.id)) this.add(peer);
    }
    for (const id of [...this.avatars.keys()]) {
      if (!peers.get(id)) this.remove(id);
    }

    for (const peer of peers.list()) {
      const entry = this.avatars.get(peer.id);
      if (!entry) continue;

      if (entry.name !== peer.name) {
        entry.name = peer.name;
        retitle(this.THREE, entry.label, peer.name, peer.color);
      }

      // The reported position is eye height, the model stands on the floor.
      entry.group.position.set(peer.position[0], peer.position[1] - 1.6, peer.position[2]);

      // Only yaw: nobody wants to watch a neighbour lying sideways.
      const yaw = yawFromQuaternion(peer.quaternion);
      entry.group.rotation.y = damp(entry.group.rotation.y, yaw, 12, dt);

      const target = peer.speaking ? 0.9 : 0.0;
      entry.ringMat.opacity += (target - entry.ringMat.opacity) * Math.min(1, dt * 8);
      const pulse = peer.speaking ? 1 + Math.sin(elapsed * 8) * 0.06 : 1;
      entry.ring.scale.setScalar(pulse);

      if (this.camera) entry.label.quaternion.copy(this.camera.quaternion);
    }
  }

  dispose() {
    this.clear();
    this.group.parent?.remove(this.group);
    if (this._sharedGeo) {
      for (const g of Object.values(this._sharedGeo)) g.dispose();
      this._sharedGeo = null;
    }
  }
}

/* ------------------------------------------------------------------ labels */

function drawLabel(canvas, name, color) {
  const ctx = canvas.getContext('2d');
  const dpr = 2;
  canvas.width = 256 * dpr;
  canvas.height = 64 * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, 256, 64);

  ctx.fillStyle = 'rgba(10, 12, 16, 0.72)';
  roundRect(ctx, 8, 14, 240, 36, 18);
  ctx.fill();
  ctx.strokeStyle = color || '#8ab4ff';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = '600 20px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillStyle = '#f4f6fb';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(name || 'Guest').slice(0, 18), 128, 33);
  return canvas;
}

function makeLabel(T, name, color) {
  const canvas = drawLabel(document.createElement('canvas'), name, color);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace ?? texture.colorSpace;
  texture.anisotropy = 4;
  const material = new T.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  const mesh = new T.Mesh(new T.PlaneGeometry(0.9, 0.225), material);
  mesh.renderOrder = 10;
  mesh.userData.canvas = canvas;
  return mesh;
}

function retitle(T, label, name, color) {
  drawLabel(label.userData.canvas, name, color);
  label.material.map.needsUpdate = true;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* -------------------------------------------------------------------- math */

function yawFromQuaternion(q) {
  const [x, y, z, w] = q;
  // forward vector of the quaternion applied to (0,0,-1)
  const fx = -2 * (x * z + w * y);
  const fz = -(1 - 2 * (x * x + y * y));
  return Math.atan2(fx, fz);
}

function damp(current, target, lambda, dt) {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-lambda * dt));
}

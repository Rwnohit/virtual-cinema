/**
 * Remote peer store with a small interpolation buffer.
 *
 * The network gives us 15 poses per second, the renderer wants 60. We keep a
 * short history per peer and read it back 120 ms in the past, so avatars glide
 * instead of teleporting. Plain JS on purpose, no Three.js in here.
 */

import { INTERP_DELAY_MS } from './protocol.js';

const BUFFER_MS = 1000;

export class PeerStore {
  constructor() {
    /** @type {Map<string, RemotePeer>} */
    this.peers = new Map();
    /** seatId -> peerId, mirrored from the server */
    this.seats = {};
  }

  get size() {
    return this.peers.size;
  }

  list() {
    return [...this.peers.values()];
  }

  get(id) {
    return this.peers.get(id);
  }

  upsert(wire) {
    if (!wire?.id) return null;
    let peer = this.peers.get(wire.id);
    if (!peer) {
      peer = new RemotePeer(wire);
      this.peers.set(wire.id, peer);
    } else {
      peer.name = wire.name ?? peer.name;
      peer.color = wire.color ?? peer.color;
      peer.seat = wire.seat ?? peer.seat;
    }
    if (wire.p) peer.push(wire.p, wire.q || [0, 0, 0, 1], performance.now());
    return peer;
  }

  remove(id) {
    const peer = this.peers.get(id);
    this.peers.delete(id);
    return peer;
  }

  clear() {
    this.peers.clear();
    this.seats = {};
  }

  applySnapshot(poses) {
    const now = performance.now();
    for (const pose of poses) {
      const peer = this.peers.get(pose.id);
      if (!peer) continue;
      peer.seat = pose.seat ?? null;
      peer.speaking = !!pose.speaking;
      peer.push(pose.p, pose.q, now);
    }
  }

  setSeats(seats) {
    this.seats = seats || {};
  }

  /** Advance every peer to the interpolated pose for this frame. */
  update(nowMs = performance.now()) {
    const renderTime = nowMs - INTERP_DELAY_MS;
    for (const peer of this.peers.values()) peer.sampleAt(renderTime);
  }
}

export class RemotePeer {
  constructor(wire) {
    this.id = wire.id;
    this.name = wire.name || 'Guest';
    this.color = wire.color || '#8ab4ff';
    this.seat = wire.seat ?? null;
    this.speaking = !!wire.speaking;

    /** @type {{t:number,p:number[],q:number[]}[]} */
    this.buffer = [];
    /** Interpolated values, read by the avatar and by the spatial audio. */
    this.position = wire.p ? [...wire.p] : [0, 1.6, 0];
    this.quaternion = wire.q ? [...wire.q] : [0, 0, 0, 1];
    this.joinedAt = performance.now();
  }

  push(p, q, t) {
    if (!Array.isArray(p)) return;
    const last = this.buffer[this.buffer.length - 1];
    if (last && t <= last.t) t = last.t + 1; // keep the timeline strictly rising
    this.buffer.push({ t, p: [p[0], p[1], p[2]], q: normalize(q) });
    const cutoff = t - BUFFER_MS;
    while (this.buffer.length > 2 && this.buffer[0].t < cutoff) this.buffer.shift();
  }

  sampleAt(renderTime) {
    const buf = this.buffer;
    if (!buf.length) return;

    if (buf.length === 1 || renderTime <= buf[0].t) {
      copy3(this.position, buf[0].p);
      copy4(this.quaternion, buf[0].q);
      return;
    }

    const newest = buf[buf.length - 1];
    if (renderTime >= newest.t) {
      // Ran out of samples (packet loss or the peer stopped moving): hold still
      // rather than extrapolating into walls.
      copy3(this.position, newest.p);
      copy4(this.quaternion, newest.q);
      return;
    }

    for (let i = buf.length - 2; i >= 0; i -= 1) {
      const a = buf[i];
      const b = buf[i + 1];
      if (renderTime >= a.t && renderTime <= b.t) {
        const alpha = (renderTime - a.t) / Math.max(1, b.t - a.t);
        lerp3(this.position, a.p, b.p, alpha);
        slerp(this.quaternion, a.q, b.q, alpha);
        return;
      }
    }
  }
}

/* --------------------------------------------------------------- math bits */

function copy3(out, v) {
  out[0] = v[0];
  out[1] = v[1];
  out[2] = v[2];
}

function copy4(out, v) {
  out[0] = v[0];
  out[1] = v[1];
  out[2] = v[2];
  out[3] = v[3];
}

function lerp3(out, a, b, t) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

function normalize(q) {
  if (!Array.isArray(q) || q.length < 4) return [0, 0, 0, 1];
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

/** Shortest arc quaternion interpolation, same maths as THREE.Quaternion.slerp. */
function slerp(out, a, b, t) {
  let [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  let cos = ax * bx + ay * by + az * bz + aw * bw;

  if (cos < 0) {
    cos = -cos;
    ax = -ax;
    ay = -ay;
    az = -az;
    aw = -aw;
  }

  if (cos > 0.9995) {
    out[0] = ax + (bx - ax) * t;
    out[1] = ay + (by - ay) * t;
    out[2] = az + (bz - az) * t;
    out[3] = aw + (bw - aw) * t;
  } else {
    const theta = Math.acos(cos);
    const sin = Math.sin(theta);
    const wa = Math.sin((1 - t) * theta) / sin;
    const wb = Math.sin(t * theta) / sin;
    out[0] = ax * wa + bx * wb;
    out[1] = ay * wa + by * wb;
    out[2] = az * wa + bz * wb;
    out[3] = aw * wa + bw * wb;
  }

  const len = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
  out[0] /= len;
  out[1] /= len;
  out[2] /= len;
  out[3] /= len;
}

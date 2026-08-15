/**
 * Adapter between the rest of the app and the network layer.
 *
 * The local player lives in src/player/state.js and the seats in
 * src/scene/seats.js, both owned by other people. We never import them
 * statically and we never write to them: we read whatever shape they expose,
 * and if anything is missing we fall back to the camera. That way networking
 * cannot break the scene, and the scene can change freely.
 *
 * Preferred shapes, all optional:
 *   getPlayerState() / getState() / playerState / state / default
 *   -> { position, quaternion | rotation | yaw, seat | seatId | currentSeat }
 */

const EYE_HEIGHT = 1.6;

async function tryImport(relativePath) {
  try {
    const url = new URL(relativePath, import.meta.url).href;
    return await import(/* @vite-ignore */ url);
  } catch {
    return null;
  }
}

function unwrap(mod) {
  if (!mod) return null;
  const candidates = [
    // peek first when it exists: it hands back the live object without
    // allocating a snapshot 60 times per second.
    mod.peekPlayerState,
    mod.getPlayerState,
    mod.getLocalState,
    mod.getState,
    mod.playerState,
    mod.localState,
    mod.state,
    mod.player,
    mod.default,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'function') {
      try {
        const value = candidate();
        if (value && typeof value === 'object') return candidate;
      } catch {
        /* not the getter we hoped for */
      }
    } else if (candidate && typeof candidate === 'object') {
      return () => candidate;
    }
  }
  return null;
}

function readVec(v) {
  if (!v) return null;
  if (Array.isArray(v) && v.length >= 3) {
    return [Number(v[0]), Number(v[1]), Number(v[2])];
  }
  if (typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number') {
    return [v.x, v.y, v.z];
  }
  return null;
}

function quatFromYaw(yaw) {
  const half = yaw / 2;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

function readQuat(source) {
  if (!source) return null;
  const q = source.quaternion;
  if (q && typeof q.w === 'number') return [q.x, q.y, q.z, q.w];
  if (Array.isArray(q) && q.length >= 4) return [q[0], q[1], q[2], q[3]];
  if (typeof source.yaw === 'number') return quatFromYaw(source.yaw);
  const r = source.rotation;
  if (r && typeof r.y === 'number') return quatFromYaw(r.y);
  if (typeof source.heading === 'number') return quatFromYaw(source.heading);
  return null;
}

function readSeat(source) {
  if (!source) return null;
  const raw = source.seat ?? source.seatId ?? source.currentSeat ?? source.seatIndex ?? null;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return raw.id ?? raw.seatId ?? raw.index ?? null;
  return String(raw);
}

/**
 * @returns {Promise<() => {p:number[], q:number[], seat:string|null}>}
 */
export async function createLocalStateReader({ getLocalState, camera, player } = {}) {
  let getter = typeof getLocalState === 'function' ? getLocalState : null;

  // 1. the handle main.js already built for us, whatever shape it has
  if (!getter && player) getter = unwrapHandle(player);

  // 2. the state module, when the player module publishes one
  if (!getter) {
    const mod = await tryImport('../player/state.js');
    getter = unwrap(mod);
  }

  // 3. anything the app parked on window
  if (!getter && typeof window !== 'undefined') {
    const global = window.__player || window.__cinema?.handles?.player || null;
    if (global) getter = unwrapHandle(global);
  }

  const pos = [0, EYE_HEIGHT, 0];
  const quat = [0, 0, 0, 1];

  return function readLocalState(activeCamera = camera) {
    let source = null;
    try {
      source = getter ? getter() : null;
    } catch {
      source = null;
    }

    // The camera wins: it is what the player actually sees and hears from, and
    // it is already in world space. The state module is the fallback.
    const fromState = activeCamera?.getWorldPosition
      ? null
      : readVec(source?.position ?? source?.pos ?? source?.p);
    const fromQuat = activeCamera?.getWorldQuaternion ? null : readQuat(source);

    if (fromState) {
      pos[0] = fromState[0];
      pos[1] = fromState[1];
      pos[2] = fromState[2];
    } else if (activeCamera?.getWorldPosition) {
      activeCamera.updateMatrixWorld?.();
      const wp = activeCamera.getWorldPosition(_scratchVec(activeCamera));
      pos[0] = wp.x;
      pos[1] = wp.y;
      pos[2] = wp.z;
    }

    if (fromQuat) {
      quat[0] = fromQuat[0];
      quat[1] = fromQuat[1];
      quat[2] = fromQuat[2];
      quat[3] = fromQuat[3];
    } else if (activeCamera?.getWorldQuaternion) {
      const wq = activeCamera.getWorldQuaternion(_scratchQuat(activeCamera));
      quat[0] = wq.x;
      quat[1] = wq.y;
      quat[2] = wq.z;
      quat[3] = wq.w;
    }

    return { p: pos, q: quat, seat: readSeat(source) };
  };
}

/* Reuse one object per camera instead of allocating every frame. */
const scratch = new WeakMap();
function _scratchVec(camera) {
  let s = scratch.get(camera);
  if (!s) {
    s = { vec: camera.position.clone(), quat: camera.quaternion.clone() };
    scratch.set(camera, s);
  }
  return s.vec;
}
function _scratchQuat(camera) {
  let s = scratch.get(camera);
  if (!s) {
    s = { vec: camera.position.clone(), quat: camera.quaternion.clone() };
    scratch.set(camera, s);
  }
  return s.quat;
}

/* ------------------------------------------------------------------ seats */

/**
 * Optional helper around src/scene/seats.js, used only to place an avatar on a
 * seat when we know the seat id but the pose has not arrived yet.
 */
export async function createSeatLookup(explicitSeats) {
  let seats = explicitSeats || null;

  if (!seats) {
    const mod = await tryImport('../scene/seats.js');
    const candidates = [mod?.getSeats, mod?.seats, mod?.SEATS, mod?.default];
    for (const candidate of candidates) {
      const value = typeof candidate === 'function' ? safeCall(candidate) : candidate;
      if (Array.isArray(value) && value.length) {
        seats = value;
        break;
      }
    }
  }

  seats = asSeatArray(seats);

  const byId = new Map();
  if (Array.isArray(seats)) {
    seats.forEach((seat, index) => {
      const id = String(seat?.id ?? seat?.seatId ?? seat?.name ?? index);
      // Eye level is what we want: it is where a head sits and where a voice
      // comes from. Fall back to the floor anchor plus a head height.
      const eye = readVec(seat?.eyePosition) || readVec(seat?.eye);
      const floor =
        readVec(seat?.position) ||
        readVec(seat?.pos) ||
        readVec(seat?.object3d?.position) ||
        readVec(seat?.mesh?.position);
      const position = eye || (floor ? [floor[0], floor[1] + EYE_HEIGHT, floor[2]] : null);
      if (position) byId.set(id, position);
    });
  }

  return {
    size: byId.size,
    /** Eye level position of a seat, or null when the seat is unknown. */
    position(seatId) {
      if (seatId === null || seatId === undefined) return null;
      return byId.get(String(seatId)) || null;
    },
  };
}

/** The scene may hand us the raw array, or a handle that holds one. */
function asSeatArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return null;
  for (const key of ['seatData', 'SEATS', 'seats', 'data', 'list', 'all']) {
    if (Array.isArray(value[key])) return value[key];
  }
  if (typeof value.getSeats === 'function') {
    const out = safeCall(() => value.getSeats());
    if (Array.isArray(out)) return out;
  }
  return null;
}

/** Same idea as unwrap(), but for an object handle instead of a module. */
function unwrapHandle(handle) {
  if (!handle || typeof handle !== 'object') return null;
  for (const key of ['peekPlayerState', 'getState', 'getPlayerState', 'snapshot']) {
    if (typeof handle[key] === 'function') {
      const value = safeCall(() => handle[key]());
      if (value && typeof value === 'object') return () => handle[key]();
    }
  }
  if (handle.state && typeof handle.state === 'object') return () => handle.state;
  // The handle itself may carry the seat and the pose directly.
  if ('seat' in handle || 'seatId' in handle || 'position' in handle) return () => handle;
  return null;
}

function safeCall(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

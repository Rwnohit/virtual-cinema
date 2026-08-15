/**
 * Player state API.
 *
 * This is the single place other modules (audio, networking) read the local
 * player from. It deliberately has NO three.js import and no DOM access, so it
 * can be imported from anywhere (including a worker) without pulling in the
 * renderer.
 *
 * Everything is plain numbers so it can be JSON-serialised straight onto the
 * wire by the networking module.
 */

const listeners = new Set();
const seatListeners = new Set();

/** @typedef {{x:number,y:number,z:number}} Vec3 */

const state = {
  /** Eye/camera position in world units. */
  position: { x: 0, y: 0, z: 0 },
  /** Euler angles in radians, YXZ order (x = pitch, y = yaw, z = roll). */
  rotation: { x: 0, y: 0, z: 0 },
  /** Same orientation as a quaternion, for spatial audio listeners. */
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
  /** Unit vector the player is looking at. */
  forward: { x: 0, y: 0, z: -1 },
  /** Unit "up" vector, needed by the WebAudio listener. */
  up: { x: 0, y: 1, z: 0 },
  /** Id of the occupied seat, or null when standing. */
  seatId: null,
  seated: false,
  /** True while the player is actually walking (useful for footstep audio). */
  moving: false,
  /** Timestamp of the last transform update, in ms. */
  updatedAt: 0,
};

const now = () =>
  typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now();

function copyVec3(target, source) {
  if (!source) return false;
  const x = Number(source.x ?? 0);
  const y = Number(source.y ?? 0);
  const z = Number(source.z ?? 0);
  if (target.x === x && target.y === y && target.z === z) return false;
  target.x = x;
  target.y = y;
  target.z = z;
  return true;
}

function snapshot() {
  return {
    position: { ...state.position },
    rotation: { ...state.rotation },
    quaternion: { ...state.quaternion },
    forward: { ...state.forward },
    up: { ...state.up },
    seatId: state.seatId,
    seated: state.seated,
    moving: state.moving,
    updatedAt: state.updatedAt,
  };
}

function emit() {
  if (!listeners.size) return;
  const snap = snapshot();
  for (const entry of listeners) {
    if (entry.throttleMs > 0 && snap.updatedAt - entry.lastSent < entry.throttleMs) {
      continue;
    }
    entry.lastSent = snap.updatedAt;
    try {
      entry.fn(snap);
    } catch (err) {
      console.error('[player/state] listener failed', err);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/** A defensive copy of the whole state. Safe to keep around or serialise. */
export function getPlayerState() {
  return snapshot();
}

/**
 * The live internal state object, without allocating. Read only, never mutate
 * it. Meant for per-frame consumers such as the audio listener.
 */
export function peekPlayerState() {
  return state;
}

/** @returns {Vec3} */
export function getPlayerPosition() {
  return { ...state.position };
}

/** @returns {Vec3} Euler angles in radians (YXZ). */
export function getPlayerRotation() {
  return { ...state.rotation };
}

export function getPlayerQuaternion() {
  return { ...state.quaternion };
}

/**
 * Where the player's head is and where it is looking.
 *
 * This is what the audio module needs to place the WebAudio listener, and what
 * networking sends to the other clients. Plain numbers, no Three.js.
 *
 * @returns {{position:Vec3, direction:Vec3, forward:Vec3, up:Vec3, quaternion:object, rotation:Vec3, seatId:string|null, seated:boolean}}
 */
export function getPlayerHead() {
  return {
    position: { ...state.position },
    direction: { ...state.forward },
    forward: { ...state.forward },
    up: { ...state.up },
    quaternion: { ...state.quaternion },
    rotation: { ...state.rotation },
    seatId: state.seatId,
    seated: state.seated,
  };
}

/** @returns {string|null} */
export function getPlayerSeatId() {
  return state.seatId;
}

export function isPlayerSeated() {
  return state.seated;
}

/* -------------------------------------------------------------------------- */
/* Writing (called by the player controller only)                              */
/* -------------------------------------------------------------------------- */

/**
 * Push a new transform. Called once per frame by the player controller.
 * @param {{position?:Vec3, rotation?:Vec3, quaternion?:object, forward?:Vec3, up?:Vec3, moving?:boolean}} next
 */
export function updatePlayerTransform(next = {}) {
  let changed = false;

  changed = copyVec3(state.position, next.position) || changed;
  changed = copyVec3(state.rotation, next.rotation) || changed;
  changed = copyVec3(state.forward, next.forward) || changed;
  changed = copyVec3(state.up, next.up) || changed;

  if (next.quaternion) {
    const q = next.quaternion;
    const w = Number(q.w ?? 1);
    if (copyVec3(state.quaternion, q) || state.quaternion.w !== w) {
      state.quaternion.w = w;
      changed = true;
    }
  }

  if (typeof next.moving === 'boolean' && next.moving !== state.moving) {
    state.moving = next.moving;
    changed = true;
  }

  if (!changed) return false;

  state.updatedAt = now();
  emit();
  return true;
}

/**
 * Sit down on / stand up from a seat.
 * @param {string|null} seatId Pass null to stand up.
 */
export function setPlayerSeat(seatId) {
  const next = seatId == null ? null : String(seatId);
  if (next === state.seatId) return false;

  const previous = state.seatId;
  state.seatId = next;
  state.seated = next !== null;
  state.updatedAt = now();

  for (const fn of seatListeners) {
    try {
      fn({ seatId: next, previousSeatId: previous, seated: state.seated });
    } catch (err) {
      console.error('[player/state] seat listener failed', err);
    }
  }
  emit();
  return true;
}

/** Back to the initial values. Mainly for tests and for leaving the room. */
export function resetPlayerState() {
  state.position.x = state.position.y = state.position.z = 0;
  state.rotation.x = state.rotation.y = state.rotation.z = 0;
  state.quaternion.x = state.quaternion.y = state.quaternion.z = 0;
  state.quaternion.w = 1;
  state.forward.x = 0;
  state.forward.y = 0;
  state.forward.z = -1;
  state.up.x = 0;
  state.up.y = 1;
  state.up.z = 0;
  state.moving = false;
  state.updatedAt = now();
  setPlayerSeat(null);
  emit();
}

/* -------------------------------------------------------------------------- */
/* Subscribing                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Listen to transform changes.
 *
 * Networking should pass a throttle (e.g. 50ms → 20 updates/sec); audio can
 * leave it at 0 and get every frame.
 *
 * @param {(snapshot: ReturnType<typeof getPlayerState>) => void} fn
 * @param {{throttleMs?:number, immediate?:boolean}} [options]
 * @returns {() => void} unsubscribe
 */
export function subscribePlayerState(fn, options = {}) {
  if (typeof fn !== 'function') {
    throw new TypeError('subscribePlayerState expects a function');
  }
  const entry = {
    fn,
    throttleMs: Number(options.throttleMs) || 0,
    lastSent: -Infinity,
  };
  listeners.add(entry);
  if (options.immediate !== false) {
    entry.lastSent = state.updatedAt;
    fn(snapshot());
  }
  return () => listeners.delete(entry);
}

/**
 * Listen to sit / stand events only.
 * @param {(event:{seatId:string|null, previousSeatId:string|null, seated:boolean}) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribePlayerSeat(fn) {
  if (typeof fn !== 'function') {
    throw new TypeError('subscribePlayerSeat expects a function');
  }
  seatListeners.add(fn);
  return () => seatListeners.delete(fn);
}

export default {
  getPlayerState,
  peekPlayerState,
  getPlayerHead,
  getPlayerPosition,
  getPlayerRotation,
  getPlayerQuaternion,
  getPlayerSeatId,
  isPlayerSeated,
  updatePlayerTransform,
  setPlayerSeat,
  resetPlayerState,
  subscribePlayerState,
  subscribePlayerSeat,
};

/**
 * Multiplayer entry point (module contract in README.md).
 *
 *   src/net/index.js  createNet({ url, scene, camera, player, media, seats })
 *                     -> { update(delta), resize(), dispose() }
 *
 * main.js already boots us with everything the other modules produced, so this
 * file only reads: the camera for the pose, the player handle for the seat, the
 * seat data for the fallback placement. Nothing outside src/net is mutated.
 *
 * If the server is down the call still resolves, the hall is simply empty and
 * the client keeps retrying in the background. Nothing here ever throws at boot.
 */

import { NetClient } from './client.js';
import { PeerStore } from './peers.js';
import { AvatarManager } from './avatars.js';
import { VoiceMesh } from './voice.js';
import { createLocalStateReader, createSeatLookup } from './local-state.js';
import { updateListener, unlockAudioOnGesture, getAudioContext } from './audio.js';
import { createHud } from './ui.js';
import { createShowSync } from './show.js';
import { createStageSync } from './stage.js';

/** Both exist in every browser, but not when a test imports us from Node. */
const requestFrame = (fn) =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : 0;
const cancelFrame = (id) => {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
};

/** A handle that keeps main.js happy when networking cannot start at all. */
const NOOP_HANDLE = {
  offline: true,
  count: 1,
  update() {},
  resize() {},
  dispose() {},
  on: () => () => {},
  isSeatTaken: () => false,
  occupiedSeats: () => ({}),
};

/**
 * The factory main.js looks for.
 * Everything is optional, missing pieces just reduce what we can show.
 */
export async function createNet(context = {}) {
  try {
    return await createNetwork({
      ...context,
      // The scene module exposes the raw seat table under a few names.
      seats: context.seats ?? context.seatData ?? context.SEATS ?? null,
      // `context.room` is the ROOM MODULE - the dock, the lights, the ceremony -
      // because main.js keeps every module on one object. Spreading that in as
      // "which room to join" sent everybody into a room literally named
      // "[object Object]" and made ?room= do nothing at all. The name is the
      // viewer's to choose, so it is left to resolveRoom() and the query.
      room: typeof context.roomName === 'string' ? context.roomName : null,
      // Read before the line above renames it: `context.room` is the module.
      roomHandle: context.room ?? null,
    });
  } catch (err) {
    console.warn('[net] multiplayer disabled:', err?.message || err);
    return NOOP_HANDLE;
  }
}

export async function createNetwork(options = {}) {
  const {
    url = null,
    room = null,
    name = null,
    color = null,
    scene = null,
    camera = null,
    player = null,
    media = null,
    // NOT `room`: that name is already taken by which hall to join. This is
    // the room MODULE - the curtain, the lights, the seats.
    roomHandle = null,
    three = null,
    seats = null,
    getLocalState = null,
    hud = true,
    voice = true,
    autoUpdate = true,
    deferJoin = false,
    tuning = {},
  } = options;

  const client = new NetClient({ url, room, name, color });
  const peers = new PeerStore();
  const avatars = new AvatarManager({ scene, camera, three });
  const seatLookup = await createSeatLookup(seats);
  const readLocalState = await createLocalStateReader({ getLocalState, camera, player });
  const voiceMesh = voice ? new VoiceMesh({ client, peers, tuning, onChange: syncHud }) : null;

  let activeScene = scene;
  let activeCamera = camera;
  let hudView = null;
  let rafId = 0;
  let externallyDriven = false;
  let disposed = false;
  let lastFrame = performance.now();
  let elapsed = 0;
  let lastSeat = null;
  let frame = 0;
  let ownsListener = true;
  /** Assigned at the bottom. Declared here so attach() can hand it back. */
  let api = null;

  /* ------------------------------------------------------------- wiring */

  client.on('welcome', (msg) => {
    peers.clear();
    for (const wire of msg.peers || []) peers.upsert(wire);
    peers.setSeats(msg.seats || {});
    emit('peers', peers.list());
    syncHud();
  });

  client.on('peer:join', (wire) => {
    peers.upsert(wire);
    emit('peers', peers.list());
    syncHud();
  });

  client.on('peer:leave', (id) => {
    peers.remove(id);
    avatars.remove(id);
    emit('peers', peers.list());
    syncHud();
  });

  client.on('snapshot', (msg) => peers.applySnapshot(msg.peers || []));

  client.on('seats', (map) => {
    peers.setSeats(map);
    emit('seats', map);
  });

  client.on('seat:denied', (msg) => emit('seat:denied', msg));

  client.on('reset', () => {
    peers.clear();
    avatars.clear();
    lastSeat = null;
    syncHud();
  });

  client.on('status', ({ status }) => {
    hudView?.setStatus(status);
    emit('status', status);
  });

  /* ----------------------------------------------------------- listeners */

  const listeners = new Map();
  function on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type)?.delete(fn);
  }
  function emit(type, payload) {
    for (const fn of listeners.get(type) || []) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[net] "${type}" listener threw`, err);
      }
    }
  }

  /* ---------------------------------------------------------------- HUD */

  function syncHud() {
    if (!hudView) return;
    hudView.setPeerCount(peers.size);
    hudView.setVoice({
      micEnabled: !!voiceMesh?.micEnabled,
      muted: !!voiceMesh?.muted,
      error: voiceMesh?.error,
    });
  }

  async function toggleMic() {
    if (!voiceMesh) return;
    if (!voiceMesh.micEnabled) {
      try {
        await voiceMesh.enableMic();
      } catch {
        /* the HUD already shows the refusal */
      }
    } else {
      voiceMesh.toggleMuted();
    }
    syncHud();
  }

  if (hud && typeof document !== 'undefined') {
    hudView = createHud({ onToggleMic: toggleMic });
    hudView.setStatus(client.status);
    syncHud();
  }

  unlockAudioOnGesture();

  /**
   * The media module attaches a THREE.AudioListener to the camera and three.js
   * then drives the Web Audio listener itself. Two writers would fight over the
   * same parameters, so we only take over when nobody else is doing it.
   */
  function detectListenerOwner() {
    if (media?.listener) return false;
    const children = activeCamera?.children;
    if (!Array.isArray(children)) return true;
    return !children.some((child) => child?.isAudioListener === true || child?.type === 'AudioListener');
  }

  /* --------------------------------------------------------------- frame */

  function tick(delta) {
    if (disposed) return;
    const now = performance.now();
    const dt = typeof delta === 'number' ? delta : Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    elapsed += dt;
    frame += 1;

    // 1. our own pose goes out (throttled inside the client)
    const local = readLocalState(activeCamera);
    client.sendState(local.p, local.q, voiceMesh?.speaking || false);

    // 2. seat changes are announced so nobody sits on top of anyone
    const seat = local.seat ?? null;
    if (seat !== lastSeat) {
      lastSeat = seat;
      client.claimSeat(seat);
    }

    // 3. everyone else moves smoothly towards where they were 120 ms ago
    peers.update(now);
    for (const peer of peers.list()) {
      if (peer.buffer.length) continue;
      const seatPos = seatLookup.position(peer.seat);
      if (seatPos) {
        peer.position[0] = seatPos[0];
        peer.position[1] = seatPos[1];
        peer.position[2] = seatPos[2];
      }
    }

    // 4. avatars follow, voices follow, listener sits on the camera
    avatars.update(peers, dt, elapsed);
    if (frame % 30 === 1) ownsListener = detectListenerOwner();
    if (ownsListener && activeCamera) updateListener(activeCamera);
    voiceMesh?.update();
  }

  function loop() {
    if (disposed || externallyDriven) return;
    rafId = requestFrame(loop);
    tick();
  }

  /* -------------------------------------------------------------- attach */

  function attach({ scene: nextScene, camera: nextCamera } = {}) {
    if (nextScene) activeScene = nextScene;
    if (nextCamera) activeCamera = nextCamera;
    avatars.attach(activeScene, activeCamera);
    ownsListener = detectListenerOwner();
    return api;
  }

  attach({ scene: activeScene, camera: activeCamera });

  // Late binding for hosts that build the scene after networking starts.
  if (!activeScene && typeof window !== 'undefined') {
    window.addEventListener('cinema:ready', (event) => attach(event.detail || {}), { once: true });
  }

  /**
   * One screening per hall, shared by everyone standing in it. See show.js.
   *
   * Built before the socket opens, because the very first message a hall sends
   * is the welcome, and the film we are meant to be watching is in it.
   */
  const showSync = createShowSync({
    client,
    media,
    // Announced rather than drawn: this module has no panel of its own, and the
    // room does. A plain window event keeps the two from having to be built in
    // a particular order, which they are not.
    onNotice: (detail) => {
      emit('show:notice', detail);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cinema:notice', { detail }));
      }
    },
  });

  /** The room around the film, shared the same way the film is. See stage.js. */
  const stageSync = createStageSync({ client, room: roomHandle });

  // Deferred when there is a menu of halls in front of the viewer: connecting
  // before they have chosen would drop them into a hall they never picked, and
  // everyone already inside it would watch a stranger appear and vanish.
  if (!deferJoin) client.connect();
  if (autoUpdate) rafId = requestFrame(loop);

  /* ----------------------------------------------------------------- api */

  api = {
    client,
    peers,
    avatars,
    voice: voiceMesh,

    get id() {
      return client.id;
    },
    get status() {
      return client.status;
    },
    /** Which hall this browser is in. The menu picks it, `?room=` overrides. */
    get room() {
      return client.room;
    },
    /** Walk into a hall, under a name. This is what the opening menu calls. */
    join: (room, name) => client.join(room, name),
    /** The screening this hall is running, and where it is. See show.js. */
    show: showSync,
    /** The room it is running in: curtain, lights, seats. See stage.js. */
    stage: stageSync,
    get count() {
      return peers.size + 1;
    },

    attach,
    on,

    /** Called by the main render loop, the internal one then stands down. */
    update(delta) {
      if (!externallyDriven) {
        externallyDriven = true;
        cancelFrame(rafId);
      }
      tick(delta);
    },

    resize() {},

    setName: (value) => client.setName(value),
    claimSeat: (seatId) => client.claimSeat(seatId),

    /** Seat occupancy, handy for greying out taken seats in the picker. */
    seatOwner: (seatId) => peers.seats[String(seatId)] || null,
    isSeatTaken: (seatId) => {
      const owner = peers.seats[String(seatId)];
      return !!owner && owner !== client.id;
    },
    occupiedSeats: () => ({ ...peers.seats }),

    enableMic: () => voiceMesh?.enableMic(),
    disableMic: () => voiceMesh?.disableMic(),
    setMuted: (muted) => voiceMesh?.setMuted(muted),
    toggleMic,

    audioContext: () => getAudioContext(),

    dispose() {
      disposed = true;
      cancelFrame(rafId);
      showSync.dispose();
      stageSync.dispose();
      hudView?.dispose();
      voiceMesh?.dispose();
      avatars.dispose();
      client.close();
      listeners.clear();
    },
  };

  if (typeof window !== 'undefined') window.__net = api;
  return api;
}

export default createNet;
export { NetClient } from './client.js';
export { PeerStore } from './peers.js';
export { AvatarManager } from './avatars.js';
export { VoiceMesh } from './voice.js';

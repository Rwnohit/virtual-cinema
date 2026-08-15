/**
 * Headless self check for the networking module. Node only, no browser.
 *
 *   node src/net/self-check.mjs
 *
 * It answers two questions:
 *   1. does createNet() survive a boot with no server and no browser APIs
 *   2. does a voice end up on the correct side, at the correct volume
 *
 * Web Audio does the actual HRTF work inside the browser, so what we verify
 * here is the wiring: the listener really carries the camera pose, each panner
 * really carries its peer position, and the distance model really attenuates.
 */

import * as THREE from 'three';

/* ------------------------------------------------------- browser pretence */

const noop = () => {};
const ctx2d = () =>
  new Proxy(
    {},
    {
      get: (target, key) => (key in target ? target[key] : noop),
      set: (target, key, value) => ((target[key] = value), true),
    },
  );

function element(tag) {
  return {
    tagName: tag,
    style: {},
    dataset: {},
    width: 0,
    height: 0,
    srcObject: null,
    getContext: ctx2d,
    setAttribute: noop,
    appendChild: noop,
    removeChild: noop,
    remove: noop,
    addEventListener: noop,
    querySelector: () => element('div'),
    play: () => Promise.resolve(),
  };
}

class FakeParam {
  constructor(value = 0) {
    this.value = value;
  }
  setTargetAtTime(value) {
    this.value = value;
    return this;
  }
  setValueAtTime(value) {
    this.value = value;
    return this;
  }
}

class FakeNode {
  connect() {
    return this;
  }
  disconnect() {}
}

class FakePanner extends FakeNode {
  constructor() {
    super();
    this.panningModel = '';
    this.distanceModel = '';
    this.refDistance = 1;
    this.maxDistance = 10000;
    this.rolloffFactor = 1;
    this.coneInnerAngle = 360;
    this.coneOuterAngle = 360;
    this.coneOuterGain = 0;
    this.positionX = new FakeParam();
    this.positionY = new FakeParam();
    this.positionZ = new FakeParam();
    this.orientationX = new FakeParam();
    this.orientationY = new FakeParam();
    this.orientationZ = new FakeParam();
  }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'running';
    this.destination = new FakeNode();
    this.listener = {
      positionX: new FakeParam(),
      positionY: new FakeParam(),
      positionZ: new FakeParam(),
      forwardX: new FakeParam(),
      forwardY: new FakeParam(),
      forwardZ: new FakeParam(-1),
      upX: new FakeParam(),
      upY: new FakeParam(1),
      upZ: new FakeParam(),
    };
  }
  createPanner() {
    return new FakePanner();
  }
  createGain() {
    const node = new FakeNode();
    node.gain = new FakeParam(1);
    return node;
  }
  createAnalyser() {
    const node = new FakeNode();
    node.fftSize = 512;
    node.frequencyBinCount = 256;
    node.smoothingTimeConstant = 0;
    node.getByteFrequencyData = noop;
    return node;
  }
  createMediaStreamSource() {
    return new FakeNode();
  }
  resume() {
    return Promise.resolve();
  }
}

const listeners = new Map();
globalThis.window = {
  AudioContext: FakeAudioContext,
  location: { protocol: 'http:', hostname: 'localhost', port: '5173', search: '' },
  localStorage: { getItem: () => null, setItem: noop },
  addEventListener: (type, fn) => listeners.set(type, fn),
  removeEventListener: (type) => listeners.delete(type),
  devicePixelRatio: 1,
};
globalThis.AudioContext = FakeAudioContext;
globalThis.document = {
  createElement: element,
  head: element('head'),
  body: element('body'),
  getElementById: () => null,
  addEventListener: noop,
};
globalThis.location = globalThis.window.location;
globalThis.localStorage = globalThis.window.localStorage;
// navigator is read only in recent Node versions, so patch it in place.
Object.defineProperty(globalThis, 'navigator', {
  value: { mediaDevices: { getUserMedia: () => Promise.reject(new Error('headless')) } },
  configurable: true,
});
// No WebSocket on purpose: this is exactly the "server is not running" case.

/* ------------------------------------------------------------------ tests */

const failures = [];
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(label);
}

const { createNet } = await import('./index.js');
const { createVoiceSink, updateListener, getAudioContext } = await import('./audio.js');

/* 1. boot with no server -------------------------------------------------- */

const camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 200);
const scene = new THREE.Scene();
// Sitting in the middle of the hall, looking at the screen (towards -Z).
camera.position.set(0, 1.55, 6);
camera.lookAt(0, 1.55, -8);
camera.updateMatrixWorld(true);

const net = await createNet({
  scene,
  camera,
  url: 'ws://127.0.0.1:8787',
  seats: [
    { id: 'C7', position: { x: 0, y: 0, z: 6 }, eyePosition: { x: 0, y: 1.55, z: 6 } },
    { id: 'C8', position: { x: 1.2, y: 0, z: 6 }, eyePosition: { x: 1.2, y: 1.55, z: 6 } },
  ],
  hud: false,
  autoUpdate: false,
});

check('createNet returns a handle without a server', !!net && typeof net.update === 'function');
check('the page is not blocked, we are simply alone', net.count === 1, `count=${net.count}`);

net.peers.upsert({ id: 'zz', name: 'Nikos', color: '#4d96ff', p: [1.2, 1.55, 6], q: [0, 0, 0, 1] });
net.update(0.016);
net.update(0.016);
check('a neighbour gets an avatar in the scene', net.avatars.avatars.size === 1);
check('the avatar stands on the floor under their eyes', Math.abs(net.avatars.avatars.get('zz').group.position.y - (1.55 - 1.6)) < 0.001);
check('seat occupancy is readable for the seat picker', net.isSeatTaken('C7') === false);
check('update() never throws while offline', true);

/* 2. voice direction and distance ---------------------------------------- */

const context = getAudioContext();
check('an audio context is available', !!context);

updateListener(camera);
const L = context.listener;
check(
  'the listener sits exactly on the camera',
  Math.abs(L.positionX.value - 0) < 1e-6 && Math.abs(L.positionZ.value - 6) < 1e-6,
  `x=${L.positionX.value} z=${L.positionZ.value.toFixed(2)}`,
);
check(
  'the listener looks where the camera looks',
  Math.abs(L.forwardZ.value + 1) < 1e-3 && Math.abs(L.forwardX.value) < 1e-3,
  `fwd=(${L.forwardX.value.toFixed(2)}, ${L.forwardZ.value.toFixed(2)})`,
);

const stream = {};
const near = createVoiceSink(stream);
const far = createVoiceSink(stream);

check('voices use HRTF', near.panner.panningModel === 'HRTF');
check('volume falls off with distance', near.panner.distanceModel === 'inverse' && near.panner.rolloffFactor > 1);

// Left neighbour, right neighbour, and someone far away up front.
const seatLeft = [-1.2, 1.55, 6];
const seatRight = [1.2, 1.55, 6];
const seatFar = [0, 1.55, -6];

// The listener basis: right = forward x up, with forward = -Z and up = +Y.
const forward = new THREE.Vector3(L.forwardX.value, L.forwardY.value, L.forwardZ.value);
const up = new THREE.Vector3(L.upX.value, L.upY.value, L.upZ.value);
const right = new THREE.Vector3().crossVectors(forward, up).normalize();
const origin = new THREE.Vector3(L.positionX.value, L.positionY.value, L.positionZ.value);

function sideOf(position) {
  near.setPose(position, [0, 0, 0, 1]);
  const p = new THREE.Vector3(near.panner.positionX.value, near.panner.positionY.value, near.panner.positionZ.value);
  return p.sub(origin).dot(right);
}

check('the panner is placed on the peer, not on us', sideOf(seatRight) !== 0);
check('someone on your right is heard on the right', sideOf(seatRight) > 0.5, `dot=${sideOf(seatRight).toFixed(2)}`);
check('someone on your left is heard on the left', sideOf(seatLeft) < -0.5, `dot=${sideOf(seatLeft).toFixed(2)}`);

function gainAt(position) {
  far.setPose(position, [0, 0, 0, 1]);
  const p = new THREE.Vector3(far.panner.positionX.value, far.panner.positionY.value, far.panner.positionZ.value);
  const d = Math.max(far.panner.refDistance, p.distanceTo(origin));
  // The inverse distance model the browser applies, spelled out.
  return far.panner.refDistance / (far.panner.refDistance + far.panner.rolloffFactor * (d - far.panner.refDistance));
}

const gainNear = gainAt(seatRight);
const gainFar = gainAt(seatFar);
check('the closer they sit the louder they are', gainNear > gainFar * 2, `near=${gainNear.toFixed(2)} far=${gainFar.toFixed(2)}`);
check('nobody is heard past the back wall', gainAt([0, 1.55, 6 + far.panner.maxDistance]) < 0.06);

near.dispose();
far.dispose();
net.dispose();

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);

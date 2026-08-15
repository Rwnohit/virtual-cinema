/**
 * Web Audio plumbing for spatial voice.
 *
 * Every remote voice stream goes through its own PannerNode with HRTF, so a
 * neighbour on your left is heard on your left, and volume falls off with
 * distance. The listener follows the local camera every frame.
 *
 * We reuse THREE.AudioContext when it exists, so the movie soundtrack and the
 * voices live in the same context and share one listener.
 */

import * as THREE from 'three';
import { VOICE } from './protocol.js';

let ctx = null;

export function getAudioContext() {
  if (ctx) return ctx;
  try {
    if (THREE?.AudioContext?.getContext) {
      ctx = THREE.AudioContext.getContext();
    }
  } catch {
    /* fall through to our own context */
  }
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

/** Browsers keep audio suspended until the user interacts with the page. */
export function unlockAudioOnGesture() {
  const events = ['pointerdown', 'keydown', 'touchend'];
  const resume = () => {
    const context = getAudioContext();
    if (context && context.state === 'suspended') context.resume().catch(() => {});
    if (context && context.state === 'running') {
      for (const type of events) window.removeEventListener(type, resume);
    }
  };
  for (const type of events) window.addEventListener(type, resume, { passive: true });
  return resume;
}

function setParam(param, value, context, smooth = 0.04) {
  if (!param) return false;
  try {
    param.setTargetAtTime(value, context.currentTime, smooth);
  } catch {
    param.value = value;
  }
  return true;
}

/* ---------------------------------------------------------------- listener */

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();

/** Move the audio listener onto the camera. Call once per frame. */
export function updateListener(camera) {
  const context = getAudioContext();
  if (!context || !camera) return;
  const listener = context.listener;

  camera.updateMatrixWorld?.();
  camera.matrixWorld.decompose(_pos, _quat, _scale);
  _fwd.set(0, 0, -1).applyQuaternion(_quat);
  _up.set(0, 1, 0).applyQuaternion(_quat);

  if (listener.positionX) {
    setParam(listener.positionX, _pos.x, context, 0.02);
    setParam(listener.positionY, _pos.y, context, 0.02);
    setParam(listener.positionZ, _pos.z, context, 0.02);
    setParam(listener.forwardX, _fwd.x, context, 0.02);
    setParam(listener.forwardY, _fwd.y, context, 0.02);
    setParam(listener.forwardZ, _fwd.z, context, 0.02);
    setParam(listener.upX, _up.x, context, 0.02);
    setParam(listener.upY, _up.y, context, 0.02);
    setParam(listener.upZ, _up.z, context, 0.02);
  } else {
    // Safari and older Chrome
    listener.setPosition(_pos.x, _pos.y, _pos.z);
    listener.setOrientation(_fwd.x, _fwd.y, _fwd.z, _up.x, _up.y, _up.z);
  }
}

/* ------------------------------------------------------------- voice sinks */

/**
 * Wire one remote MediaStream into the 3D scene.
 * Returns a handle with setPose(position, quaternion) and dispose().
 */
export function createVoiceSink(stream, tuning = {}) {
  const context = getAudioContext();
  if (!context) return null;

  const cfg = { ...VOICE, ...tuning };

  // Chrome will not pull audio out of a WebRTC stream unless the stream is also
  // attached to a media element. It stays muted, it only keeps the pipe open.
  const el = document.createElement('audio');
  el.srcObject = stream;
  el.muted = true;
  el.autoplay = true;
  el.setAttribute('playsinline', '');
  el.style.display = 'none';
  document.body.appendChild(el);
  el.play?.().catch(() => {});

  const source = context.createMediaStreamSource(stream);

  const panner = context.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = cfg.refDistance;
  panner.maxDistance = cfg.maxDistance;
  panner.rolloffFactor = cfg.rolloffFactor;
  // A voice is directional: quieter when someone faces away from you.
  panner.coneInnerAngle = cfg.innerAngle;
  panner.coneOuterAngle = cfg.outerAngle;
  panner.coneOuterGain = cfg.outerGain;

  const gain = context.createGain();
  gain.gain.value = 1;

  source.connect(panner);
  panner.connect(gain);
  gain.connect(context.destination);

  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.6;
  panner.connect(analyser);
  const bins = new Uint8Array(analyser.frequencyBinCount);

  return {
    panner,
    gain,
    element: el,

    setPose(position, quaternion) {
      if (panner.positionX) {
        setParam(panner.positionX, position[0], context);
        setParam(panner.positionY, position[1], context);
        setParam(panner.positionZ, position[2], context);
      } else {
        panner.setPosition(position[0], position[1], position[2]);
      }

      if (!quaternion) return;
      _quat.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
      _fwd.set(0, 0, -1).applyQuaternion(_quat);
      if (panner.orientationX) {
        setParam(panner.orientationX, _fwd.x, context);
        setParam(panner.orientationY, _fwd.y, context);
        setParam(panner.orientationZ, _fwd.z, context);
      } else {
        panner.setOrientation(_fwd.x, _fwd.y, _fwd.z);
      }
    },

    setVolume(v) {
      setParam(gain.gain, Math.max(0, Math.min(2, v)), context, 0.08);
    },

    /** 0..1, handy for a talking indicator driven by what we actually hear. */
    level() {
      analyser.getByteFrequencyData(bins);
      let sum = 0;
      for (let i = 0; i < bins.length; i += 1) sum += bins[i];
      return sum / bins.length / 255;
    },

    dispose() {
      try {
        source.disconnect();
        panner.disconnect();
        gain.disconnect();
        analyser.disconnect();
      } catch {
        /* already gone */
      }
      el.srcObject = null;
      el.remove();
    },
  };
}

/** Local mic level meter, used to broadcast a "speaking" flag. */
export function createMicMeter(stream) {
  const context = getAudioContext();
  if (!context) return null;
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.5;
  source.connect(analyser);
  const bins = new Uint8Array(analyser.frequencyBinCount);

  let speaking = false;
  let lastChange = 0;

  return {
    /** Hysteresis plus a hold time, so one cough does not strobe the ring. */
    poll(now = performance.now()) {
      analyser.getByteFrequencyData(bins);
      let sum = 0;
      for (let i = 2; i < bins.length; i += 1) sum += bins[i];
      const level = sum / (bins.length - 2) / 255;

      if (!speaking && level > 0.06) {
        speaking = true;
        lastChange = now;
      } else if (speaking && level < 0.03 && now - lastChange > 350) {
        speaking = false;
        lastChange = now;
      }
      return { level, speaking };
    },
    dispose() {
      try {
        source.disconnect();
        analyser.disconnect();
      } catch {
        /* already gone */
      }
    },
  };
}

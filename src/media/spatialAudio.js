/**
 * Spatial soundtrack for the movie.
 *
 *   <video> -> MediaElementSource -> movieGain -> movieTrim ┬─ lfeSend .. desk's sub
 *                                                          │
 *                                                          └─ movieTone (X-curve)
 *                                                   -> screenTrim -> screenHigh (x2)
 *                                                        ├─ dry -> split -> L/R PositionalAudio
 *                                                        │                 (HRTF) -> movieOut
 *                                                        └─ preDelay -> Convolver -> wet
 *                                                                            -> movieOut
 *   movieOut -> the desk's master, or the listener when there is no desk.
 *
 * The direct sound is panned from the two sides of the screen, so the image
 * feels as wide as it looks, while the reverb tail stays undirected: that is
 * how a real hall behaves, and it stops the tail from collapsing into a point
 * when you walk to the side seats.
 *
 * WHY screenHigh exists. The sound mixer feeds a mono LFE channel from lfeSend,
 * because under about 80 Hz the head is far smaller than half a wavelength and
 * the ear genuinely cannot place the sound. That licence only holds if the low
 * band LEAVES the screen channels when it joins the sub: a crossover splits the
 * signal, it does not copy it. Without this pair of high pass sections the bass
 * was in the room twice, once panned and once mono and louder, and the mono
 * copy buried the panning. Measured: 8.7 dB of left/right swing on a 90 degree
 * head turn became 0.7 dB on the IMAX preset. The crossover is off (10 Hz)
 * until something actually takes the LFE tap, so the film keeps its full range
 * when this module is used without a desk.
 *
 * WHY screenTrim exists. A cinema is calibrated at the reference seat, not at
 * the speaker: the 85 dB(C) arrives where the audience is. The inverse distance
 * law takes about 4 dB off between a 23 metre screen and the middle of the
 * stalls, so the screen channels get it back here. A panned source you cannot
 * hear over an unpannable one is not panned.
 *
 * movieTrim and movieTone are the sound mixer's handles on the film, and they
 * are deliberately separate from movieGain: this module writes movieGain every
 * time the volume or the mute changes, so anything the user sets has to live
 * downstream of it or it would be wiped on the next click.
 *
 * The two faders are independent in the way that matters: the desk's bass
 * control lives on its own gain inside the desk, so pulling the sub out leaves
 * the film exactly as it was, and neither control is wired through the other.
 * lfeSend does sit after movieTrim, because the sub is reproducing the film:
 * turning the film down and still hearing it rumble would be a fault, not a
 * feature. movieGain is upstream of both, so the mute button mutes everything.
 *
 * The AudioListener is shared with the rest of the app, so this module never
 * touches the master volume: the movie level lives on its own gain node.
 */

import * as THREE from 'three'
import { clamp, createEmitter } from './util.js'
import {
  createImpulseResponse,
  loadImpulseResponse,
  REVERB_PRESETS,
  DEFAULT_REVERB_PRESET,
} from './reverb.js'
import { t } from '../i18n/index.js'

/**
 * three.js marks the listener with type === 'AudioListener' and no isXxx flag,
 * so both are checked here.
 */
function isListener(object) {
  return !!object && (object.isAudioListener === true || object.type === 'AudioListener')
}

/**
 * Reuse the listener the app already has. Two THREE.AudioListener objects share
 * the one Web Audio listener underneath and keep overwriting each other's
 * position, which breaks every panner in the room, voice chat included.
 */
export function resolveListener(camera, provided, scene) {
  if (isListener(provided)) return provided

  let found = null
  for (const root of [camera, scene]) {
    if (found || !root || typeof root.traverse !== 'function') continue
    root.traverse((object) => {
      if (!found && isListener(object)) found = object
    })
  }
  if (found) {
    // An orphan listener never gets its matrix updated, so the room would
    // sound the same wherever the viewer stands. Hang it on the camera.
    if (!found.parent && camera && typeof camera.add === 'function') camera.add(found)
    return found
  }

  const listener = new THREE.AudioListener()
  if (camera && typeof camera.add === 'function') camera.add(listener)
  return listener
}

/**
 * @param {object} options
 * @param {HTMLVideoElement} options.video
 * @param {import('three').Object3D} options.screenMesh anchor for the panners
 * @param {{width:number,height:number,depthAxis:string,center:object}} options.size
 * @param {import('three').Camera} [options.camera]
 * @param {THREE.AudioListener} [options.listener]
 * @param {string} [options.preset='cinema']
 * @param {number} [options.mix] reverb amount 0..1 (defaults to the preset)
 * @param {number} [options.volume=0.85]
 */
export function createSpatialMovieAudio(options = {}) {
  const { size } = options
  let screenMesh = options.screenMesh
  if (!screenMesh) throw new Error('[media] createSpatialMovieAudio: screenMesh is missing.')

  const emitter = createEmitter()
  const listener = resolveListener(options.camera, options.listener, options.scene)
  const context = listener.context

  const presetName = REVERB_PRESETS[options.preset] ? options.preset : DEFAULT_REVERB_PRESET
  const state = {
    volume: clamp(options.volume ?? 0.85, 0, 1),
    muted: false,
    mix: clamp(options.mix ?? REVERB_PRESETS[presetName].mix, 0, 1),
    preset: presetName,
    /** Tail length in seconds. See setReverbTail(). */
    tail: options.reverbTail ?? REVERB_PRESETS[presetName].seconds,
    enabled: true,
    spatial: false,
    video: options.video || null,
    // 0 means "nobody is taking the LFE", so the screen channels keep the bass.
    crossover: 0,
    disposed: false,
  }

  /**
   * Make up gain for the screen channels, see the note at the top. Applied
   * where the distance model cannot wipe it and where the LFE cannot see it.
   */
  const SCREEN_TRIM = options.screenTrim ?? 1.6

  /** Where the high pass parks when there is no sub to hand the bass to. */
  const CROSSOVER_OFF = 10

  // Read live, never copied: the media module measures the screen again every
  // time the film moves to another one, and mutates this very object.
  // 0.45 puts the two sources just inside the edges of the picture, which is
  // where the left and right screen channels physically hang in a real house.
  const spread = clamp(options.spread ?? 0.45, 0, 0.5)
  const screenWidth = () => Math.max(size?.width || 8, 1)
  const screenCenter = () => size?.center || { x: 0, y: 0, z: 0 }
  const screenAxis = () => size?.depthAxis || 'z'

  // --- nodes -------------------------------------------------------------
  const movieGain = context.createGain()
  movieGain.gain.value = state.volume

  // The user's fader for the film, untouched by applyVolume().
  const movieTrim = context.createGain()
  movieTrim.gain.value = 1

  // The desk's LFE tap: its own node so the desk can take the sub away again
  // without touching a single node the film needs to play.
  const lfeSend = context.createGain()
  lfeSend.gain.value = 1

  // The X-curve, off by default. SMPTE ST 202 asks a cinema B-chain to be flat
  // from about 63 Hz to 2 kHz and then fall at 3 dB per octave, 6 dB above
  // 10 kHz. That soft top is a large part of why film sound in an auditorium
  // does not sound like the same file on headphones. One shelf approximates it;
  // the sound mixer drives the gain.
  const movieTone = context.createBiquadFilter()
  movieTone.type = 'highshelf'
  movieTone.frequency.value = 2200
  movieTone.gain.value = 0

  const screenTrim = context.createGain()
  screenTrim.gain.value = SCREEN_TRIM

  // The other half of the crossover. Two second order sections, Q 0.7071, so
  // the slope matches the 24 dB/octave low pass on the LFE side and the two
  // halves add back up to one film instead of one and a bit.
  const screenHighA = context.createBiquadFilter()
  screenHighA.type = 'highpass'
  screenHighA.frequency.value = CROSSOVER_OFF
  screenHighA.Q.value = 0.7071

  const screenHighB = context.createBiquadFilter()
  screenHighB.type = 'highpass'
  screenHighB.frequency.value = CROSSOVER_OFF
  screenHighB.Q.value = 0.7071

  const dryGain = context.createGain()
  dryGain.gain.value = 1 - state.mix * 0.5 // reverb should add, not swallow

  // Force a stereo bus, so a mono soundtrack still reaches both screen sides.
  const stereoBus = context.createGain()
  stereoBus.channelCount = 2
  stereoBus.channelCountMode = 'explicit'
  stereoBus.channelInterpretation = 'speakers'

  const splitter = context.createChannelSplitter(2)
  const preDelay = context.createDelay(0.5)
  preDelay.delayTime.value = 0.018

  const convolver = context.createConvolver()
  convolver.buffer = createImpulseResponse(context, { preset: state.preset })

  // Fabric, carpet and upholstery eat the top end long before the low end, so
  // the little tail a cinema does have comes back dark. Without this the room
  // sounds like a tiled corridor.
  const wetTone = context.createBiquadFilter()
  wetTone.type = 'lowpass'
  wetTone.frequency.value = 3600

  // The bottom is the one band a cinema does hold: measured rooms decay around
  // 0.40-0.70 s in the bass against 0.28-0.45 s in the top. So the cut sits low
  // enough to leave that in, and everything under it belongs to the LFE send,
  // which is mono and undirected the way real bass is.
  const wetLowCut = context.createBiquadFilter()
  wetLowCut.type = 'highpass'
  wetLowCut.frequency.value = 110

  const wetGain = context.createGain()
  wetGain.gain.value = state.mix

  /**
   * Everything the film makes leaves through here. The two panners and the
   * reverb used to hang straight off listener.getInput(), which put the film
   * outside every fader the sound mixer has: the "overall volume" slider moved
   * the room around the film instead of moving the film. One bus fixes both.
   */
  const movieOut = context.createGain()
  movieOut.gain.value = 1
  let outputTarget = listener.getInput()
  movieOut.connect(outputTarget)

  movieGain.connect(movieTrim)
  movieTrim.connect(lfeSend)
  movieTrim.connect(movieTone)
  movieTone.connect(screenTrim)
  screenTrim.connect(screenHighA)
  screenHighA.connect(screenHighB)

  screenHighB.connect(dryGain)
  dryGain.connect(stereoBus)
  stereoBus.connect(splitter)

  screenHighB.connect(preDelay)
  preDelay.connect(convolver)
  convolver.connect(wetTone)
  wetTone.connect(wetLowCut)
  wetLowCut.connect(wetGain)
  wetGain.connect(movieOut)

  // --- positional sources at the two sides of the screen ------------------
  /**
   * Put a panner on one side of whatever screen we are anchored to. Called
   * again on every move, because a 23 metre hall screen and a television in a
   * living room are not the same instrument: the distance model has to follow.
   */
  function tune(node, offset) {
    const width = screenWidth()
    const center = screenCenter()

    node.setRefDistance(options.refDistance ?? Math.max(width * 0.6, 3))
    node.setRolloffFactor(options.rolloffFactor ?? 0.7)
    node.setMaxDistance(options.maxDistance ?? width * 10)

    const dx = width * spread * offset
    if (screenAxis() === 'x') node.position.set(center.x, center.y, center.z + dx)
    else node.position.set(center.x + dx, center.y, center.z)
  }

  function placeAt(offset) {
    const node = new THREE.PositionalAudio(listener)
    node.name = offset < 0 ? 'MovieAudioLeft' : 'MovieAudioRight'
    node.setDistanceModel('inverse')
    node.panner.panningModel = 'HRTF'
    node.setVolume(1)
    // three wires every Audio straight to the listener's input. Take it off
    // there and onto our own bus, or the film would arrive at the speakers
    // twice: once through the mixer and once around it.
    try {
      node.gain.disconnect(listener.getInput())
    } catch {
      /* three may already have changed how it wires up */
    }
    node.gain.connect(movieOut)
    tune(node, offset)
    screenMesh.add(node)
    return node
  }

  const left = placeAt(-1)
  const right = placeAt(1)

  /**
   * Follow the film to another screen. The graph is untouched, so nothing so
   * much as clicks: the two panners simply hang off the new screen instead.
   * @param {import('three').Object3D} next
   */
  function setScreenMesh(next) {
    if (state.disposed || !next || next === screenMesh) return screenMesh
    for (const node of [left, right]) screenMesh.remove(node)
    screenMesh = next
    tune(left, -1)
    tune(right, 1)
    for (const node of [left, right]) screenMesh.add(node)
    return screenMesh
  }

  const leftGain = context.createGain()
  const rightGain = context.createGain()
  splitter.connect(leftGain, 0)
  splitter.connect(rightGain, 1)
  left.setNodeSource(leftGain)
  right.setNodeSource(rightGain)

  // --- element wiring ----------------------------------------------------
  let elementSource = null

  function applyVolume() {
    const level = state.muted ? 0 : state.volume
    if (state.spatial && state.enabled) {
      movieGain.gain.setTargetAtTime(level, context.currentTime, 0.02)
      if (state.video) state.video.muted = false
    } else if (state.video) {
      // No Web Audio path: drive the element itself.
      state.video.volume = level
      state.video.muted = state.muted
    }
  }

  /**
   * How wet the room gets, and how much of the dry film it costs.
   *
   * Both curves are deliberately flat at the bottom and steep at the top. The
   * fader used to stop at 0.6 because past that it stopped doing anything you
   * could hear, and simply raising the ceiling would have made every saved
   * setting - and all five presets - suddenly much wetter than the person who
   * saved them meant. So the first half of the travel is left exactly as it
   * was to within a rounding error (at the cinema preset's 0.11 the wet gain
   * moves by 0.002) and the new room is all in the last third: at the top the
   * tail comes back at nearly two and a half times the film, over a dry signal
   * ducked to a third. That is not a cinema any more. It is not meant to be.
   */
  const WET_TOP = 1.6
  const DRY_DUCK_TOP = 0.15

  function applyMix() {
    const mix = state.mix
    wetGain.gain.setTargetAtTime(mix * (1 + WET_TOP * mix * mix), context.currentTime, 0.05)
    dryGain.gain.setTargetAtTime(1 - mix * 0.5 - DRY_DUCK_TOP * mix * mix * mix, context.currentTime, 0.05)
  }

  /**
   * Hand the low band over to a sub. Everything below `hz` leaves the screen
   * channels, so whoever is feeding on lfeSend has to be putting it back or the
   * film goes thin. 0 gives the bass back to the panners.
   *
   * @param {number} hz crossover point, or 0 to switch bass management off
   * @returns {number} what is actually set
   */
  function setBassCrossover(hz) {
    if (state.disposed) return state.crossover
    const value = Number(hz) > 0 ? clamp(Number(hz), 30, 220) : 0
    state.crossover = value
    const corner = value || CROSSOVER_OFF
    for (const node of [screenHighA, screenHighB]) {
      node.frequency.setTargetAtTime(corner, context.currentTime, 0.08)
    }
    return state.crossover
  }

  /**
   * Send the film somewhere other than straight at the listener, which is what
   * the sound mixer does so its master fader has the film in it too.
   * @param {AudioNode|null} node null puts it back on the listener
   */
  function setOutput(node) {
    if (state.disposed) return outputTarget
    const next = node && typeof node.connect === 'function' ? node : listener.getInput()
    if (next === outputTarget) return outputTarget
    try {
      movieOut.disconnect(outputTarget)
    } catch {
      /* already detached */
    }
    outputTarget = next
    movieOut.connect(outputTarget)
    return outputTarget
  }

  function attach(videoElement) {
    if (state.disposed || !videoElement) return false
    if (state.video === videoElement && elementSource) return true

    state.video = videoElement
    if (elementSource) {
      try {
        elementSource.disconnect()
      } catch {
        /* already detached */
      }
      elementSource = null
    }

    try {
      // The element is routed into Web Audio, so its own volume stays at 1
      // and everything is controlled from movieGain.
      videoElement.volume = 1
      elementSource = context.createMediaElementSource(videoElement)
      elementSource.connect(movieGain)
      state.spatial = true
      applyVolume()
      emitter.emit('spatial', { enabled: true })
      return true
    } catch (err) {
      state.spatial = false
      applyVolume()
      emitter.emit('degraded', {
        reason: 'audiograph',
        message: t('err.noSpatial'),
        error: err,
      })
      return false
    }
  }

  /**
   * Point volume control at an element that must NOT go through Web Audio:
   * a cross origin file without CORS headers would come out silent.
   */
  function setFallbackElement(videoElement) {
    state.video = videoElement || null
    state.spatial = false
    applyVolume()
    emitter.emit('spatial', { enabled: false })
  }

  /** Called when videoScreen swaps the element. */
  function detach() {
    if (elementSource) {
      try {
        elementSource.disconnect()
      } catch {
        /* already detached */
      }
      elementSource = null
    }
    state.spatial = false
    emitter.emit('spatial', { enabled: false })
  }

  async function resume() {
    if (context.state === 'suspended') {
      try {
        await context.resume()
      } catch {
        /* the next user gesture will retry */
      }
    }
    return context.state
  }

  function setReverbMix(value) {
    state.mix = clamp(Number(value) || 0, 0, 1)
    applyMix()
    emitter.emit('reverb', { preset: state.preset, mix: state.mix })
  }

  function setReverbPreset(name) {
    const preset = REVERB_PRESETS[name]
    if (!preset) return
    state.preset = name
    state.tail = preset.seconds
    convolver.buffer = createImpulseResponse(context, { preset: name })
    setReverbMix(preset.mix)
  }

  /**
   * How long the tail lasts, in seconds.
   *
   * The other half of "make it sound like a bigger room", and the half a mix
   * fader cannot do: turning up a 0.6 second tail gives you more of a small
   * room, never a large one. The envelope is (1-t)^decay over the whole
   * buffer, so it is scale free - a buffer twice as long really is a tail
   * twice as long, with the same shape - and the preset's own darkening and
   * early reflections are kept.
   *
   * Rebuilding means generating a few hundred thousand samples of shaped
   * noise. Cheap, but not sixty times a second while somebody drags a slider,
   * hence the wait: only the value they stop on is ever built.
   */
  let tailTimer = null
  function setReverbTail(seconds) {
    const next = clamp(Number(seconds) || 0, 0.15, 3.5)
    state.tail = next
    clearTimeout(tailTimer)
    tailTimer = setTimeout(() => {
      if (state.disposed) return
      convolver.buffer = createImpulseResponse(context, { preset: state.preset, seconds: next })
      emitter.emit('reverb', { preset: state.preset, mix: state.mix, tail: next })
    }, 120)
    return next
  }

  async function setImpulseResponseUrl(url) {
    try {
      convolver.buffer = await loadImpulseResponse(context, url)
      emitter.emit('reverb', { preset: 'custom', mix: state.mix })
    } catch (err) {
      emitter.emit('error', { message: t('err.reverb'), error: err })
    }
  }

  function setEnabled(on) {
    state.enabled = !!on
    applyVolume()
  }

  function dispose() {
    if (state.disposed) return
    state.disposed = true

    detach()
    for (const node of [left, right]) {
      try {
        node.disconnect()
        node.gain.disconnect()
      } catch {
        /* already disconnected */
      }
      screenMesh.remove(node)
    }
    const nodes = [movieGain, lfeSend, movieTrim, movieTone, screenTrim, screenHighA, screenHighB, dryGain, stereoBus, splitter, preDelay, convolver, wetTone, wetLowCut, wetGain, movieOut, leftGain, rightGain]
    for (const node of nodes) {
      try {
        node.disconnect()
      } catch {
        /* already disconnected */
      }
    }
    emitter.clear()
  }

  if (state.video) attach(state.video)
  applyMix()

  return {
    listener,
    context,
    get isSpatial() {
      return state.spatial
    },
    get volume() {
      return state.volume
    },
    get muted() {
      return state.muted
    },
    get reverbMix() {
      return state.mix
    },
    get reverbPreset() {
      return state.preset
    },
    get bassCrossover() {
      return state.crossover
    },
    // lfeSend is the tap for the sub: it is the film at playback level, before
    // the desk's own film fader, so the two faders cannot silence each other.
    // movieTrim is that film fader, movieTone the X-curve shelf, and movieOut
    // the single point where everything the film makes leaves this module.
    // movieBus is kept pointing at movieTrim for older callers.
    nodes: {
      movieGain,
      lfeSend,
      movieTrim,
      movieTone,
      movieBus: movieTrim,
      screenTrim,
      screenHighA,
      screenHighB,
      movieOut,
      dryGain,
      convolver,
      wetGain,
      preDelay,
      left,
      right,
    },
    get screenMesh() {
      return screenMesh
    },
    setScreenMesh,
    attach,
    detach,
    setFallbackElement,
    resume,
    setVolume(value) {
      state.volume = clamp(Number(value) || 0, 0, 1)
      applyVolume()
      emitter.emit('volume', { volume: state.volume, muted: state.muted })
    },
    setMuted(value) {
      state.muted = !!value
      applyVolume()
      emitter.emit('volume', { volume: state.volume, muted: state.muted })
    },
    setReverbMix,
    setReverbPreset,
    setReverbTail,
    get reverbTail() {
      return state.tail
    },
    setImpulseResponseUrl,
    setBassCrossover,
    setOutput,
    setEnabled,
    dispose,
    on: emitter.on,
    off: emitter.off,
  }
}

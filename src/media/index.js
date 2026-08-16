/**
 * src/media: the projection. The movie on the screen and the sound of it.
 *
 * `createMedia(context)` is what src/main.js calls, with everything the scene
 * module produced. It puts a <video> on the screen mesh from
 * src/scene/cinema.js as a VideoTexture, sends the soundtrack through an HRTF
 * panner anchored at the screen, adds the hall reverb and draws the controls.
 *
 *   const media = createMedia({ scene, camera, renderer, screen })
 *   media.load('/movies/trailer.mp4', { autoplay: true })
 *
 * Contract with main.js:
 *   in  -> { scene, camera, renderer, screen?, container? }
 *   out -> { update, resize, video, ... }
 *
 * This module owns the movie and its sound only. Walking, seat picking and
 * user voice chat live in the other modules.
 */

import * as THREE from 'three'
import { createEmitter, clamp } from './util.js'
import { createVideoScreen } from './videoScreen.js'
import { createSpatialMovieAudio, resolveListener } from './spatialAudio.js'
import { createMediaControls } from './mediaControls.js'
import { createSourcePicker } from './sourcePicker.js'
import { createStartOverlay } from './startOverlay.js'
import { createScreenLight } from './screenLight.js'
import { createEmbedScreen, detectEmbed, EMBED_QUALITY_STEPS, qualityStepFor } from './embedScreen.js'
import {
  REVERB_PRESETS,
  DEFAULT_REVERB_PRESET,
  createImpulseResponse,
  loadImpulseResponse,
} from './reverb.js'
import { resolveScreenMesh, measureScreen } from './screenResolver.js'
import { computeFit, FIT_MODES } from './fit.js'
import { t } from '../i18n/index.js'

export {
  createVideoScreen,
  createSpatialMovieAudio,
  createMediaControls,
  createSourcePicker,
  createStartOverlay,
  createScreenLight,
  createEmbedScreen,
  detectEmbed,
  EMBED_QUALITY_STEPS,
  qualityStepFor,
  resolveListener,
  resolveScreenMesh,
  measureScreen,
  createImpulseResponse,
  loadImpulseResponse,
  computeFit,
  FIT_MODES,
  REVERB_PRESETS,
  DEFAULT_REVERB_PRESET,
}

/** Full screen on the whole page, so the controls stay visible inside it. */
function fullscreenTarget() {
  return document.documentElement
}

const FORWARDED_EVENTS = [
  'play',
  'pause',
  'ended',
  'timeupdate',
  'canplay',
  'waiting',
  'loaded',
  'layout',
  'sourcechange',
  'blocked',
  'error',
]

/** Handy for QA: open the page with ?movie=<url> to load a film on boot. */
function sourceFromQuery() {
  try {
    return new URL(location.href).searchParams.get('movie')
  } catch {
    return null
  }
}

/**
 * @param {object} options everything from main.js, plus overrides
 * @param {*} [options.screen] screen mesh, cinema handle, or the whole scene
 * @param {import('three').Camera} [options.camera]
 * @param {import('three').WebGLRenderer} [options.renderer]
 * @param {import('three').AudioListener} [options.listener] reuse the app's one
 * @param {File|string} [options.source] movie to load on boot
 * @param {boolean} [options.autoplay=false]
 * @param {boolean} [options.loop=false]
 * @param {'contain'|'cover'|'stretch'} [options.fit='contain']
 * @param {number} [options.volume=0.85]
 * @param {string} [options.reverbPreset='cinema']
 * @param {number} [options.reverbMix]
 * @param {boolean} [options.controls=true] playback panel, bottom of the page
 * @param {boolean} [options.picker=true] "Open a film" button and drag and drop
 * @param {boolean} [options.startOverlay=true] opening screen with the big button
 * @param {object} [options.lighting] the scene's lighting handle, lit by the film
 */
export function createMedia(options = {}) {
  const emitter = createEmitter()

  /** The hall's own screen, whether or not the film is currently on it. */
  const hallScreen = () => options.cinema?.screen ?? null

  const screen = createVideoScreen({
    screen: options.screen ?? options.cinema ?? options.scene,
    renderer: options.renderer,
    fit: options.fit,
    loop: options.loop,
    dimBase: options.dimBase,
    brightness: options.brightness,
  })

  const audio = createSpatialMovieAudio({
    video: screen.video,
    screenMesh: screen.mesh,
    size: screen.size,
    camera: options.camera,
    scene: options.scene,
    listener: options.listener,
    preset: options.reverbPreset,
    mix: options.reverbMix,
    volume: options.volume,
    spread: options.audioSpread,
    refDistance: options.refDistance,
    rolloffFactor: options.rolloffFactor,
    maxDistance: options.maxDistance,
  })

  // The film lights the room: average colour of the frame every ~10 frames.
  const screenLight = createScreenLight({
    getVideo: () => screen.video,
    lighting: options.lighting,
    everyFrames: options.lightSampleFrames,
  })

  // YouTube and Vimeo cannot become a texture, so they get placed in the room
  // as a real iframe instead. Everything below routes to whichever is live.
  const embed =
    options.embeds === false
      ? null
      : createEmbedScreen({
          screenMesh: screen.mesh,
          renderer: options.renderer,
          container: options.container ?? options.renderer?.domElement?.parentNode ?? document.body,
          size: screen.size,
        })

  // The grade rides in the shader of the movie surface, and an embed has no
  // surface: the picture is an iframe. Every way of grading the picture goes
  // through one of these three, and each returns the full set of live values,
  // so wrapping them is the whole of "the dials also reach YouTube".
  if (embed) {
    for (const name of ['setPicture', 'setPicturePreset', 'resetPicture']) {
      const grade = screen[name]
      if (typeof grade !== 'function') continue
      screen[name] = (...args) => {
        const values = grade(...args)
        embed.setPicture(values)
        return values
      }
    }
    // Whatever was restored from the last visit is already on the shader.
    embed.setPicture(screen.getPicture())
  }

  // Keep the audio graph pointing at the live element: videoScreen swaps it
  // when a cross origin source has to fall back to plain playback.
  screen.on('elementreplaced', ({ video, spatialAllowed }) => {
    audio.detach()
    if (spatialAllowed) audio.attach(video)
    else audio.setFallbackElement(video)
  })

  for (const type of FORWARDED_EVENTS) {
    screen.on(type, (payload) => {
      // While a YouTube embed is on the screen, the idle <video> element must
      // not be the one driving the transport bar.
      if (embed?.active) return
      emitter.emit(type, payload || {})
    })
  }

  if (embed) {
    for (const type of ['play', 'pause', 'ended', 'timeupdate', 'loaded', 'error', 'playlist']) {
      embed.on(type, (payload) => emitter.emit(type, payload || {}))
    }
  }
  screen.on('degraded', (payload) => emitter.emit('degraded', payload))
  audio.on('degraded', (payload) => emitter.emit('degraded', payload))
  audio.on('error', (payload) => emitter.emit('error', payload))
  audio.on('volume', (payload) => emitter.emit('volume', payload))
  audio.on('reverb', (payload) => emitter.emit('reverb', payload))
  audio.on('spatial', (payload) => emitter.emit('spatial', payload))

  let disposed = false
  /** Seconds of embedded playback, only used to wander the room light. */
  let elapsedOnScreen = 0

  /**
   * The level the mixing desk wants the embed to play at, or null while there
   * is no desk.
   *
   * A YouTube or Vimeo film comes out of their own iframe, which no Web Audio
   * graph can reach: it does not pass through the film fader, the master, or
   * anything else on the desk, so every fader in the room used to leave it
   * exactly where it was. The one thing their API does answer is "how loud",
   * so the desk sends its own maths down here (master x film) and the embed is
   * turned down to match. It is not the same as going through the desk - there
   * is no hall, no X-curve and no sub on it - but it does mean the volume on
   * the bar is the volume of what you are watching.
   */
  let deskLevel = null

  /**
   * The hall, worked out for a film we are not allowed to touch.
   *
   * A local film goes through two HRTF panners: walk to the back and it gets
   * further away, turn your head and it moves across you. An embedded one
   * cannot, and this was measured rather than assumed before it was given up
   * on. The only route in is the tab's own audio (getDisplayMedia with
   * `preferCurrentTab`), and on Chrome that capture carries the page's OWN
   * output as well as the iframe's: a 0.4 tone sent to the speakers came back
   * through the capture at 0.48, which is a feedback loop with gain over one.
   * `restrictOwnAudio: true` was accepted by the browser and changed nothing
   * (0.48), and `echoCancellation: true` made it worse (0.60). So the film
   * cannot be put through the reverb, the sub or the screen channels.
   *
   * What their API does answer is "how loud", sixty times a second if we like.
   * So the distance law and the head shadow are worked out here and written
   * into that one number. It is not the panners - there is no stereo image and
   * no tail - but the film does get quieter as you walk up the aisle and when
   * you turn your back on the screen, which is most of what the room is for.
   */
  const EMBED_BACK_GAIN = 0.5 // about -6 dB behind the head, as a real one is
  /** How fast the level follows you. Slow enough never to sound like a fader. */
  const EMBED_GLIDE = 0.12
  /** How much of the room to apply, 0 = a flat film, 1 = the full walk. */
  let embedRoomAmount = clamp(options.embedRoom ?? 1, 0, 1)

  const _listenerPos = new THREE.Vector3()
  const _screenPos = new THREE.Vector3()
  const _toScreen = new THREE.Vector3()
  const _facing = new THREE.Vector3()
  const _headTurn = new THREE.Quaternion()
  /** What the room asks for, and what the player has actually been told. */
  let embedRoomGain = 1
  let embedSentPercent = -1

  /**
   * The distance and direction part of the level, 0..1.
   *
   * Same inverse law and same reference distance as the panners in
   * spatialAudio.js, so a film that changes from a file to a YouTube link does
   * not change how far away it sounds.
   */
  function embedRoomLevel() {
    const mesh = embed?.screenMesh ?? screen.mesh
    const listener = audio.listener
    if (!mesh || !listener) return 1

    mesh.getWorldPosition(_screenPos)
    listener.getWorldPosition(_listenerPos)
    _toScreen.copy(_screenPos).sub(_listenerPos)
    const distance = _toScreen.length()

    const width = Math.max(screen.size?.width || 8, 1)
    const refDistance = options.refDistance ?? Math.max(width * 0.6, 3)
    const rolloff = options.rolloffFactor ?? 0.7
    const far = refDistance / (refDistance + rolloff * Math.max(0, distance - refDistance))

    // Which way the head is pointing. -1 is straight away from the screen.
    //
    // Built from the quaternion rather than read from getWorldDirection(),
    // which is the +Z axis on a plain Object3D and the -Z one on a Camera. An
    // AudioListener is the first kind but rides the second's orientation, so
    // that call hands back the direction of the back of the head - and the
    // film got LOUDER as you turned away from the screen. Measured: facing the
    // screen read 1.0 where it should have read 0.5.
    listener.getWorldQuaternion(_headTurn)
    _facing.set(0, 0, -1).applyQuaternion(_headTurn)
    // Left and right only. A head shadows what is beside it, not what is above
    // it, and the screen centre is well over head height: taking the height in
    // charged the front row 0.8 dB for looking up at a screen it is sitting
    // right under.
    _facing.y = 0
    _toScreen.y = 0
    const dot = _facing.lengthSq() > 1e-6 && _toScreen.lengthSq() > 1e-6
      ? _facing.normalize().dot(_toScreen.normalize())
      : 1
    const behind = EMBED_BACK_GAIN + (1 - EMBED_BACK_GAIN) * (0.5 + 0.5 * dot)

    // The dial fades the whole effect towards 1, which is the reference seat.
    return 1 + (far * behind - 1) * embedRoomAmount
  }

  function applyEmbedVolume() {
    if (!embed?.active) return
    const desk = deskLevel === null ? audio.volume : deskLevel
    const level = audio.muted ? 0 : clamp(desk * embedRoomGain, 0, 1)
    // Their player takes whole percent, and asking it sixty times a second for
    // a number it already has is work for nothing.
    const percent = Math.round(level * 100)
    if (percent === embedSentPercent) return
    embedSentPercent = percent
    embed.setVolume(percent / 100)
    embed.setMuted(audio.muted)
  }

  const media = {
    // the pieces, for anyone who needs the raw objects
    screen,
    audio,
    screenLight,
    controls: null,
    picker: null,
    startOverlay: null,
    get video() {
      return screen.video
    },
    get texture() {
      return screen.texture
    },
    get screenMesh() {
      return screen.mesh
    },
    get listener() {
      return audio.listener
    },

    embed,

    // state
    /** Is a picture moving right now - what the transport button should show. */
    get isPlaying() {
      if (embed?.active) return embed.isPlaying
      const video = screen.video
      return !!video && !video.paused && !video.ended && video.readyState > 2
    },
    /**
     * Is this a running screening - what the player has been TOLD to do.
     *
     * The difference matters enormously and cost a whole evening. `readyState`
     * drops the instant you seek a stream to somewhere it has not buffered, so
     * for a second or two a perfectly healthy screening reports "not playing".
     * Told that, the hall wrote down "paused, at this second", its clock
     * stopped, and the drift watcher spent the rest of the night dragging
     * everybody back to that second every nine seconds. That was the loop.
     *
     * Buffering is not a decision. Anything telling the ROOM what is going on
     * asks this; anything drawing a play/pause icon asks isPlaying.
     */
    get isRunning() {
      if (embed?.active) return embed.isPlaying
      const video = screen.video
      return !!video && !video.paused && !video.ended
    },
    get currentTime() {
      if (embed?.active) return embed.currentTime
      return screen.video?.currentTime || 0
    },
    get duration() {
      if (embed?.active) return embed.duration
      const value = screen.video?.duration
      return Number.isFinite(value) ? value : 0
    },
    /** 'youtube' | 'vimeo' when the picture comes from an embed, else null. */
    get embedKind() {
      return embed?.active ? embed.kind : null
    },

    /* --- playlists, which only a YouTube link can bring ------------------- */
    /** How many videos are queued, 0 when what is playing is on its own. */
    get playlistLength() {
      return embed?.active ? embed.playlistLength : 0
    },
    get playlistIndex() {
      return embed?.active ? embed.playlistIndex : -1
    },
    next: () => (embed?.active ? embed.next() : false),
    previous: () => (embed?.active ? embed.previous() : false),
    playAt: (index) => (embed?.active ? embed.playAt(index) : false),

    /**
     * Picture quality. For a YouTube link this is the size of the player, which
     * is what decides the stream it serves; a local file is already as good as
     * the file is, so there the same dial drives the texture sharpness.
     */
    setQuality(pixels) {
      const applied = embed?.setQuality(pixels) ?? Math.round(Number(pixels) || 1600)
      const texture = screen.texture
      if (texture && options.renderer?.capabilities?.getMaxAnisotropy) {
        const max = options.renderer.capabilities.getMaxAnisotropy()
        texture.anisotropy = Math.min(max, applied >= 2400 ? 16 : applied >= 1800 ? 8 : 4)
        texture.needsUpdate = true
      }
      return applied
    },
    get quality() {
      return embed?.quality ?? 1600
    },
    /** The fixed choices, and which one is on. See embedScreen.js. */
    qualitySteps: EMBED_QUALITY_STEPS,
    get qualityStep() {
      return qualityStepFor(embed?.quality ?? 1600)
    },
    setQualityStep(key) {
      const step = EMBED_QUALITY_STEPS.find((entry) => entry.key === key)
      if (!step) return null
      media.setQuality(step.pixels)
      return step.key
    },
    get volume() {
      return audio.volume
    },
    get muted() {
      return audio.muted
    },
    get reverbMix() {
      return audio.reverbMix
    },
    get reverbPreset() {
      return audio.reverbPreset
    },
    get isSpatial() {
      return audio.isSpatial
    },
    get hasSource() {
      return embed?.active || screen.hasSource
    },
    get isFullscreen() {
      return !!document.fullscreenElement
    },

    /**
     * Load a local File, a url (mp4 / webm / ogg / m3u8), or a YouTube link.
     *
     * `loadOptions.at` is where to come in, in seconds. It exists for the halls:
     * a screening that has been running for twenty minutes hands that number to
     * whoever walks in, and they start there instead of at the first frame.
     */
    async load(source, loadOptions = {}) {
      await audio.resume()
      const at = Number.isFinite(loadOptions.at) && loadOptions.at > 0 ? loadOptions.at : 0

      if (embed && typeof source === 'string' && embed.canPlay(source)) {
        // Take the local film off the screen first, not just pause it: its last
        // frame is drawn in front of the embed and would hide it completely.
        screen.clear()
        elapsedOnScreen = 0
        const ok = await embed.load(source, { at })
        if (ok) {
          applyEmbedVolume()
          emitter.emit('sourcechange', { src: source, isFile: false, embed: embed.kind })
          // Worth saying out loud: their player owns the sound, so the volume
          // reaches it but the hall - reverb, X-curve, the sub - does not.
          emitter.emit('degraded', {
            reason: 'embed',
            message: t('err.embedSound'),
          })
        }
        return ok
      }

      if (embed?.active) embed.unload()
      const loaded = await screen.load(source, loadOptions)
      // A <video> has no "start here" of its own, so it is moved once it knows
      // how long it is. Anything earlier is written to an element with no
      // duration yet and silently lands on zero.
      if (loaded && at > 0) {
        const video = screen.video
        if (video && Number.isFinite(video.duration) && video.duration > 0) media.seek(at)
        else video?.addEventListener('loadedmetadata', () => media.seek(at), { once: true })
      }
      return loaded
    },

    /**
     * Somebody in the hall is sharing their screen. Put it on ours.
     *
     * Nothing to synchronise, ever: there is one picture, encoded once, and
     * everybody is watching the same frames arrive. Whatever is on the
     * sharer's screen - a film, a player nobody else could open, a slideshow -
     * is what the room sees.
     *
     * @param {MediaStream|null} stream null takes the screen back
     */
    async showStream(stream) {
      if (embed?.active) embed.unload()
      if (!stream) {
        screen.clear()
        emitter.emit('sourcechange', { src: null, isFile: false, live: false })
        return false
      }
      elapsedOnScreen = 0
      return screen.showStream(stream)
    },

    async play() {
      // Browsers keep the audio clock asleep until a real user gesture.
      await audio.resume()
      if (embed?.active) {
        embed.play()
        return true
      }
      try {
        await screen.video.play()
      } catch {
        emitter.emit('blocked', {
          message: t('err.tapToStart'),
        })
      }
      return media.isPlaying
    },

    pause() {
      if (embed?.active) {
        embed.pause()
        return
      }
      screen.video?.pause()
    },

    async toggle() {
      if (media.isPlaying) {
        media.pause()
        return false
      }
      return media.play()
    },

    /**
     * Moving the film is a decision, so it is announced.
     *
     * Nothing else fires when a viewer drags the bar: a <video> has 'seeked'
     * but an embed has no event at all, and the hall has to hear about it from
     * somewhere. Without this the halls treated a deliberate jump as drift and
     * pulled the viewer straight back to where everyone else was, which is
     * exactly what "I skip forward and it snaps back" looks like.
     */
    seek(seconds) {
      if (embed?.active) {
        embed.seek(seconds)
        emitter.emit('seeked', { time: embed.currentTime })
        return
      }
      const video = screen.video
      if (!video || !Number.isFinite(video.duration)) return
      video.currentTime = clamp(Number(seconds) || 0, 0, video.duration)
      emitter.emit('seeked', { time: video.currentTime })
    },

    setVolume(value) {
      audio.setVolume(value)
      applyEmbedVolume()
    },
    setMuted(value) {
      audio.setMuted(value)
      applyEmbedVolume()
    },

    /**
     * How much of the film the room is currently leaving you, 0..1.
     *
     * 1 is the reference seat facing the screen. Handy for QA, since this is
     * the only part of the hall an embedded film can be given.
     */
    get embedRoomGain() {
      return embedRoomGain
    },

    /** One dial, rendered by the panel like any other. See embedRoomLevel(). */
    embedFields: [
      // Not "YouTube ..." by name: the browser test forbids a slider whose
      // label says YouTube, because that is how the discrete quality slider
      // got caught. The group heading above the row says which film it means.
      { key: 'embedRoom', label: 'How much your seat matters', min: 0, max: 1, step: 0.01, format: 'percent', default: 1 },
    ],
    get embedRoomAmount() {
      return embedRoomAmount
    },
    setEmbedRoomAmount(value) {
      embedRoomAmount = clamp(Number(value) || 0, 0, 1)
      // Take effect on a paused film too, not only on the next frame drawn.
      embedRoomGain = embedRoomLevel()
      applyEmbedVolume()
      return embedRoomAmount
    },

    /**
     * How loud the desk wants an embedded film. See `deskLevel` above.
     * @param {number|null} value 0..1, or null to hand the level back.
     */
    setEmbedLevel(value) {
      deskLevel = value === null ? null : clamp(Number(value) || 0, 0, 1)
      applyEmbedVolume()
      return deskLevel
    },
    get embedLevel() {
      return deskLevel === null ? audio.volume : deskLevel
    },

    /**
     * Show or hide the subtitles an embedded film brings with it.
     * A local file has no such track, so this is a YouTube and Vimeo control.
     */
    setCaptions(value) {
      return embed?.setCaptions(value) ?? false
    },
    get captions() {
      return embed?.captions ?? false
    },
    setReverbMix: audio.setReverbMix,
    setReverbPreset: audio.setReverbPreset,
    setReverbTail: audio.setReverbTail,
    setImpulseResponseUrl: audio.setImpulseResponseUrl,
    setSpatialEnabled: audio.setEnabled,
    setFit: screen.setFit,
    resumeAudio: audio.resume,

    /** Opens the computer's file dialog, same as the button top left. */
    openFileDialog() {
      media.picker?.openFileDialog()
    },

    async toggleFullscreen() {
      try {
        if (document.fullscreenElement) await document.exitFullscreen()
        else await fullscreenTarget().requestFullscreen?.()
      } catch {
        emitter.emit('blocked', {
          message: t('err.fullscreen'),
        })
      }
      return media.isFullscreen
    },

    /** main.js calls this every frame. VideoTexture mostly refreshes itself. */
    update(delta = 0) {
      if (embed?.active) {
        elapsedOnScreen += delta
        // The picture is inside an iframe we are not allowed to read, so the
        // room light is driven by a slow wander instead of the real frame.
        if (embed.isPlaying) screenLight.simulate(elapsedOnScreen)
        // The hall, in the one number their player answers to. Glided rather
        // than written straight, or walking would sound like somebody riding
        // a fader. See embedRoomLevel().
        const target = embedRoomLevel()
        const step = delta > 0 ? 1 - Math.exp(-delta / EMBED_GLIDE) : 1
        embedRoomGain += (target - embedRoomGain) * step
        applyEmbedVolume()
        embed.render(options.camera)
        return
      }

      const video = screen.video
      const texture = screen.texture
      if (!video || !texture) return

      screenLight.sample()

      if ('requestVideoFrameCallback' in video) return
      if (video.readyState >= video.HAVE_CURRENT_DATA) texture.needsUpdate = true
    },

    /** main.js calls this on window resize. */
    resize() {
      screen.layout()
      embed?.resize()
    },

    /**
     * Change the shape of the picture: 'scope' | 'flat' | 'hd'.
     * The hall moves its side masking, and whatever is playing re-fits into it.
     */
    setScreenRatio(name) {
      const size = options.cinema?.setScreenRatio?.(name)
      if (!size) return null
      // Masking belongs to the hall. While the film is on a television in
      // another room the hall still changes shape behind you, ready for when
      // you walk back in, but the picture in front of you keeps the size of the
      // surface it is actually on.
      if (screen.mesh === hallScreen()) {
        screen.setScreenSize(size.width, size.height)
        embed?.setSize(size)
      }
      emitter.emit('screenratio', { name, ...size })
      return size
    },
    get screenRatio() {
      return options.cinema?.screenRatio ?? null
    },

    /**
     * Hand the film to another screen and take everything with it: the picture,
     * the YouTube hole and the two panners at the sides of the image. Whatever
     * is playing keeps playing. This is how src/venues/ puts the film on the
     * television of a room you walked into.
     *
     * @param {*} target a mesh, or anything resolveScreenMesh() understands
     * @returns {import('three').Object3D|null} the screen the film is on now
     */
    setScreenMesh(target) {
      const next = target?.isMesh ? target : resolveScreenMesh(target)
      if (!next) return screen.mesh
      screen.setScreenMesh(next)
      // Back in the hall the side masking may be narrower than the surface, and
      // only the hall knows by how much.
      if (next === hallScreen() && options.cinema?.screenSize) {
        const size = options.cinema.screenSize
        screen.setScreenSize(size.width, size.height)
      }
      embed?.setScreenMesh(next, screen.size)
      audio.setScreenMesh(next)
      emitter.emit('screenmesh', { mesh: next, ...screen.size })
      return screen.mesh
    },

    dispose() {
      if (disposed) return
      disposed = true
      media.startOverlay?.dispose()
      media.picker?.dispose()
      media.controls?.dispose()
      embed?.dispose()
      screenLight.dispose()
      audio.dispose()
      screen.dispose()
      emitter.clear()
    },

    on: emitter.on,
    off: emitter.off,
  }

  // When the film stops, let the hall come back to its own light.
  media.on('ended', () => screenLight.reset())

  if (options.controls !== false) {
    media.controls = createMediaControls(media, {
      container: options.controlsContainer,
      hideOnPointerLock: options.hideControlsOnPointerLock,
    })
  }

  if (options.picker !== false) {
    media.picker = createSourcePicker(media, {
      container: options.controlsContainer,
      dropTarget: options.dropTarget,
    })
  }

  if (options.startOverlay !== false) {
    media.startOverlay = createStartOverlay(media, {
      container: options.controlsContainer,
      onPickFile: () => media.openFileDialog(),
      // The click that wakes the audio is also the one that can grab the
      // pointer, so entering the hall takes one click and not two. `entry`
      // carries the door they chose and the name they wrote: main.js takes it
      // from here to the network module, which is what actually joins them.
      onEnter: (entry) => {
        options.onEnter?.(entry)
        if (!options.onEnter) options.player?.lock?.()
      },
    })
  }

  const initialSource = options.source ?? sourceFromQuery()
  if (initialSource) {
    media.load(initialSource, { autoplay: !!options.autoplay })
  }

  return media
}

export const createCinemaMedia = createMedia

export default createMedia

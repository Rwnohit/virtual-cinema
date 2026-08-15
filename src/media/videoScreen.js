/**
 * Puts a <video> on the cinema screen as a THREE.VideoTexture.
 *
 * The screen mesh built by src/scene/cinema.js is never reshaped: we add a
 * thin surface on top of it and, for letterboxed playback, temporarily paint
 * the mesh black so the bars around the frame look right. Everything is put
 * back on dispose().
 *
 * The film can also be handed to another screen entirely - the television in a
 * venue from src/venues/ - with `setScreenMesh()`. Whatever is playing keeps
 * playing: only the parent of the movie surface changes.
 *
 * The viewer's own grade on the picture (brightness, contrast, colour, warmth,
 * midtones) rides in the shader of that surface - see picture.js - and is
 * driven through `setPicture()`. It starts neutral, so the room looks exactly
 * as it did before the dials existed.
 */

import * as THREE from 'three'
import { createEmitter, isCrossOrigin, isHlsUrl } from './util.js'
import { resolveScreenMesh, measureScreen } from './screenResolver.js'
import { computeFit, FIT_MODES } from './fit.js'
import { createPictureGrade, PICTURE_FIELDS, PICTURE_PRESETS } from './picture.js'

export { PICTURE_FIELDS, PICTURE_PRESETS, PICTURE_DEFAULTS, clampPicture } from './picture.js'

/**
 * Where a screen mesh remembers the face the room gave it.
 *
 * Both this module (black bars) and embedScreen.js (the transparent hole) swap
 * the material of whatever screen they are on, and both can be pointed at
 * another screen at any moment. One record, kept on the mesh itself, is what
 * stops the second one from "putting back" the temporary material of the first:
 * that mistake shows up as a permanently black screen, or as a wall you can see
 * straight through. embedScreen.js reads and writes the same key.
 */
export const ORIGINAL_MATERIAL_KEY = 'mediaOriginalMaterial'

/** The material this mesh wore before any of us touched it. */
function pristineMaterial(mesh) {
  if (!mesh.userData[ORIGINAL_MATERIAL_KEY]) mesh.userData[ORIGINAL_MATERIAL_KEY] = mesh.material
  return mesh.userData[ORIGINAL_MATERIAL_KEY]
}

function createVideoElement({ loop, muted }) {
  const video = document.createElement('video')
  video.playsInline = true
  video.setAttribute('playsinline', '')
  video.setAttribute('webkit-playsinline', '')
  video.preload = 'auto'
  video.loop = !!loop
  video.muted = !!muted
  video.controls = false

  // iOS refuses to play an element that is not in the document, and
  // display:none counts as "not there", so park it off screen instead.
  Object.assign(video.style, {
    position: 'fixed',
    top: '-10000px',
    left: '-10000px',
    width: '2px',
    height: '2px',
    opacity: '0',
    pointerEvents: 'none',
  })
  document.body.appendChild(video)

  return video
}

/** Plain Greek for whatever the <video> element complains about. */
function errorMessage(code) {
  switch (code) {
    case 1:
      return 'Η φόρτωση του βίντεο σταμάτησε.'
    case 2:
      return 'Χάθηκε η σύνδεση ενώ κατέβαινε το βίντεο.'
    case 3:
      return 'Το αρχείο φαίνεται χαλασμένο και δεν διαβάζεται.'
    case 4:
      return 'Ο browser δεν παίζει αυτή τη μορφή βίντεο. Δοκίμασε MP4 (H.264) ή WebM.'
    default:
      return 'Δεν μπόρεσα να παίξω αυτό το αρχείο ή link.'
  }
}

function applyColorSpace(texture) {
  if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace
  else if (THREE.sRGBEncoding !== undefined) texture.encoding = THREE.sRGBEncoding
}

/**
 * @param {object} options
 * @param {*} options.screen mesh / cinema handle / scene (see screenResolver)
 * @param {import('three').WebGLRenderer} [options.renderer] used for anisotropy
 * @param {'contain'|'cover'|'stretch'} [options.fit='contain']
 * @param {boolean} [options.loop=false]
 * @param {number} [options.brightness=1] multiplier on the screen image
 * @param {Record<string, number>} [options.picture] starting grade, see picture.js
 */
export function createVideoScreen(options = {}) {
  let mesh = resolveScreenMesh(options.screen ?? options.cinema ?? options.scene)
  if (!mesh) {
    throw new Error(
      '[media] Δεν βρέθηκε η οθόνη της αίθουσας. Δώσε το mesh στο option "screen" ή βάλε userData.role = "screen".',
    )
  }

  const emitter = createEmitter()
  const state = {
    fit: FIT_MODES.includes(options.fit) ? options.fit : 'contain',
    dimBase: options.dimBase !== false,
    loop: !!options.loop,
    objectUrl: null,
    currentSrc: null,
    corsRetried: false,
    hls: null,
    disposed: false,
  }

  const geometry = measureScreen(mesh)

  let video = createVideoElement({ loop: state.loop, muted: false })
  let texture = new THREE.VideoTexture(video)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  applyColorSpace(texture)
  if (options.renderer?.capabilities?.getMaxAnisotropy) {
    texture.anisotropy = Math.min(4, options.renderer.capabilities.getMaxAnisotropy())
  }

  const surfaceMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    toneMapped: false,
    side: THREE.DoubleSide,
    // The surface is coplanar with the screen, so push it forward in depth
    // instead of in space: that works from either side of the screen.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  if (typeof options.brightness === 'number') {
    surfaceMaterial.color.setScalar(options.brightness)
  }

  // The viewer's grade. Installed on the surface material once and driven by
  // uniforms from here on, so it survives everything that rebuilds the shader
  // (swapping the source) or the geometry (changing the screen format).
  const picture = createPictureGrade(options.picture)
  picture.install(surfaceMaterial)

  const surface = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), surfaceMaterial)
  surface.name = 'MovieSurface'
  surface.userData.isMediaSurface = true
  surface.visible = false

  /** Sit the movie surface flat on whichever screen we are currently on. */
  function placeSurface() {
    surface.position.set(geometry.center.x, geometry.center.y, geometry.center.z)
    surface.rotation.set(0, 0, 0)
    if (geometry.depthAxis === 'x') surface.rotation.y = Math.PI / 2
    else if (geometry.depthAxis === 'y') surface.rotation.x = -Math.PI / 2
    surface.renderOrder = (mesh.renderOrder || 0) + 1
  }

  placeSurface()
  pristineMaterial(mesh)
  mesh.add(surface)

  let baseMaterial = null
  /** True while the screen underneath the picture is painted black by us. */
  let dimmed = false

  function dimBaseMesh(on) {
    if (!state.dimBase) return
    if (on) {
      if (!baseMaterial) baseMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 })
      mesh.material = baseMaterial
      dimmed = true
    } else {
      // Never assume what the mesh is wearing: whoever else is on this screen
      // (the YouTube hole) may have put its own material on since we dimmed it.
      if (dimmed || mesh.material === baseMaterial) mesh.material = pristineMaterial(mesh)
      dimmed = false
    }
  }

  function layout() {
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh) return

    const plan = computeFit({
      videoWidth: vw,
      videoHeight: vh,
      screenWidth: geometry.width,
      screenHeight: geometry.height,
      fit: state.fit,
    })

    texture.repeat.set(plan.repeat.x, plan.repeat.y)
    texture.offset.set(plan.offset.x, plan.offset.y)
    surface.scale.set(plan.planeWidth, plan.planeHeight, 1)
    dimBaseMesh(plan.dimBase)

    surface.visible = true
    emitter.emit('layout', { videoWidth: vw, videoHeight: vh, fit: state.fit })
  }

  function clearObjectUrl() {
    if (state.objectUrl) {
      URL.revokeObjectURL(state.objectUrl)
      state.objectUrl = null
    }
  }

  function destroyHls() {
    if (state.hls) {
      try {
        state.hls.destroy()
      } catch {
        /* already gone */
      }
      state.hls = null
    }
  }

  function onMetadata() {
    layout()
    emitter.emit('loaded', { duration: video.duration })
  }

  function onError() {
    const error = video.error

    // A cross origin file without CORS headers fails right here. Retry once
    // with plain loading: the movie plays, but Web Audio can no longer read
    // its samples, so the spatial sound is dropped for that source.
    if (!state.corsRetried && !state.hls && video.crossOrigin === 'anonymous' && isCrossOrigin(state.currentSrc)) {
      state.corsRetried = true
      emitter.emit('degraded', {
        reason: 'cors',
        message:
          'Το link δεν επιτρέπει ανάγνωση ήχου από άλλο site, οπότε ο ήχος παίζει κανονικά αλλά χωρίς χωρικό εφέ.',
      })
      replaceElement({ crossOrigin: null })
      video.src = state.currentSrc
      video.load()
      return
    }

    emitter.emit('error', { code: error?.code ?? 0, message: errorMessage(error?.code) })
  }

  const forward = (type) => () => emitter.emit(type, { video })
  const handlers = {
    loadedmetadata: onMetadata,
    error: onError,
    play: forward('play'),
    pause: forward('pause'),
    ended: forward('ended'),
    timeupdate: forward('timeupdate'),
    waiting: forward('waiting'),
    canplay: forward('canplay'),
  }

  function bindElement(target) {
    for (const [type, handler] of Object.entries(handlers)) {
      target.addEventListener(type, handler)
    }
  }

  function unbindElement(target) {
    for (const [type, handler] of Object.entries(handlers)) {
      target.removeEventListener(type, handler)
    }
  }

  bindElement(video)

  /**
   * Swaps in a fresh <video>. Needed because a media element can only ever be
   * routed into Web Audio once, so the CORS fallback cannot reuse the old one.
   */
  function replaceElement({ crossOrigin = 'anonymous' } = {}) {
    const previous = video
    unbindElement(previous)
    previous.pause()
    previous.removeAttribute('src')
    previous.load()
    previous.remove()

    video = createVideoElement({ loop: state.loop, muted: previous.muted })
    video.volume = previous.volume
    if (crossOrigin) video.crossOrigin = crossOrigin
    bindElement(video)

    const oldTexture = texture
    texture = new THREE.VideoTexture(video)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    texture.repeat.copy(oldTexture.repeat)
    texture.offset.copy(oldTexture.offset)
    texture.anisotropy = oldTexture.anisotropy
    applyColorSpace(texture)
    surfaceMaterial.map = texture
    surfaceMaterial.needsUpdate = true
    oldTexture.dispose()

    emitter.emit('elementreplaced', { video, spatialAllowed: crossOrigin === 'anonymous' })
    return video
  }

  async function loadHlsLibrary() {
    // Kept away from static analysis so the app builds fine without hls.js.
    const candidates = ['hls.js', 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.mjs']
    for (const specifier of candidates) {
      try {
        const module = await import(/* @vite-ignore */ /* webpackIgnore: true */ specifier)
        const Hls = module.default || module.Hls
        if (Hls && Hls.isSupported()) return Hls
      } catch {
        /* try the next source */
      }
    }
    return null
  }

  async function attachHls(url) {
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url
      return true
    }
    try {
      const Hls = await loadHlsLibrary()
      if (!Hls) throw new Error('hls.js not available')
      const hls = new Hls({ enableWorker: true })
      hls.loadSource(url)
      hls.attachMedia(video)
      state.hls = hls
      return true
    } catch {
      emitter.emit('error', {
        code: 0,
        message: 'Αυτό το live stream (m3u8) θέλει τη βιβλιοθήκη hls.js για να παίξει εδώ.',
      })
      return false
    }
  }

  /**
   * Take whatever is on the screen off it.
   *
   * Called before a YouTube embed takes over the surface. Without this the last
   * frame of the local film stays painted in front of the embed, which is
   * exactly the "I put on a video and then a YouTube link and could only see
   * the video" the viewer ran into. Nothing is disposed: the element is reused
   * the moment a file is loaded again.
   */
  function clear() {
    destroyHls()
    video.pause()
    // A live stream lives on srcObject, and load() will not let go of it.
    if (video.srcObject) video.srcObject = null
    video.removeAttribute('src')
    video.load()
    clearObjectUrl()
    state.currentSrc = null
    state.corsRetried = false
    surface.visible = false
    // Hand the screen mesh back before anyone else claims it.
    dimBaseMesh(false)
  }

  /**
   * Put a live stream on the screen instead of a file.
   *
   * The one caller is somebody in the hall sharing their screen: what arrives
   * is a MediaStream off a peer connection, and from the element's point of
   * view it is simply a video that is already playing. Everything downstream -
   * the texture, the grade, the light it throws on the room - never learns the
   * difference.
   *
   * `srcObject` and `src` are mutually exclusive, so the old one is cleared
   * rather than left to argue.
   *
   * @param {MediaStream} stream
   */
  async function showStream(stream) {
    if (state.disposed || !stream) return false

    destroyHls()
    clearObjectUrl()
    state.corsRetried = false
    video.pause()
    video.removeAttribute('src')
    video.removeAttribute('crossorigin')
    state.currentSrc = 'live'
    video.srcObject = stream

    try {
      await video.play()
    } catch {
      emitter.emit('blocked', {
        message: 'Ο browser περιμένει ένα κλικ σου για να ξεκινήσει η ζωντανή προβολή.',
      })
    }
    emitter.emit('sourcechange', { src: 'live', isFile: false, live: true })
    return true
  }

  /**
   * @param {File|string} source local file, or url (mp4 / webm / ogg / m3u8)
   */
  async function load(source, { autoplay = false } = {}) {
    if (state.disposed) return

    destroyHls()
    clearObjectUrl()
    state.corsRetried = false
    surface.visible = false
    video.pause()

    let url
    if (typeof File !== 'undefined' && source instanceof File) {
      url = URL.createObjectURL(source)
      state.objectUrl = url
    } else if (typeof source === 'string' && source.trim()) {
      url = source.trim()
    } else {
      emitter.emit('error', { code: 0, message: 'Δώσε ένα αρχείο ταινίας ή ένα link.' })
      return
    }

    state.currentSrc = url

    // Web Audio can only touch the samples of a cross origin file when the
    // server allows it, so ask for CORS up front and fall back on error.
    if (isCrossOrigin(url)) video.crossOrigin = 'anonymous'
    else video.removeAttribute('crossorigin')

    if (isHlsUrl(url)) {
      const ok = await attachHls(url)
      if (!ok) return
    } else {
      video.src = url
    }

    video.load()
    emitter.emit('sourcechange', { src: url, isFile: state.objectUrl === url })

    if (autoplay) {
      try {
        await video.play()
      } catch {
        emitter.emit('blocked', {
          message: 'Ο browser περιμένει ένα κλικ σου για να ξεκινήσει η ταινία.',
        })
      }
    }
  }

  function setFit(mode) {
    if (!FIT_MODES.includes(mode)) return
    state.fit = mode
    layout()
  }

  /**
   * Hand the film to another screen: the television in a venue, or the hall's
   * own screen on the way back.
   *
   * The <video>, the texture and the grade are untouched, so a film that is
   * playing keeps playing - only the parent of the movie surface changes. The
   * screen we are leaving gets its own material back first, because we may have
   * painted it black for the letterbox bars and it is about to be somebody
   * else's wall again.
   *
   * @param {import('three').Object3D} next
   * @returns {import('three').Object3D} the screen the film is on now
   */
  function setScreenMesh(next) {
    if (state.disposed) return mesh
    const target = next?.isMesh ? next : resolveScreenMesh(next)
    if (!target || target === mesh) return mesh

    const wasVisible = surface.visible

    dimBaseMesh(false)
    mesh.remove(surface)

    mesh = target
    pristineMaterial(mesh)

    // A different screen is a different shape, so everything measured from the
    // old one has to be measured again. Mutated in place rather than replaced:
    // the audio and the embed were handed this very object.
    const measured = measureScreen(mesh)
    geometry.width = measured.width
    geometry.height = measured.height
    geometry.depthAxis = measured.depthAxis
    geometry.center.x = measured.center.x
    geometry.center.y = measured.center.y
    geometry.center.z = measured.center.z

    placeSurface()
    mesh.add(surface)

    // layout() is what re-fits the frame and repaints the bars, but it also
    // switches the surface on. Nothing was showing before the swap, so nothing
    // shows after it either.
    if (wasVisible) layout()
    else surface.visible = false

    emitter.emit('screenmesh', { mesh, width: geometry.width, height: geometry.height })
    return mesh
  }

  /**
   * The hall changed the shape of the picture (side masking moved), so the
   * frame has to be re-fitted into the smaller area.
   */
  function setScreenSize(width, height) {
    if (Number.isFinite(width) && width > 0) geometry.width = width
    if (Number.isFinite(height) && height > 0) geometry.height = height
    layout()
    return { width: geometry.width, height: geometry.height }
  }

  /**
   * One of the named looks from picture.js, by key or by its Greek label.
   * Every preset is a full set of values, so this is a switch and not a nudge.
   */
  function setPicturePreset(name) {
    const preset = PICTURE_PRESETS.find((item) => item.key === name || item.label === name)
    if (!preset) return picture.get()
    return picture.set(preset.values)
  }

  function dispose() {
    if (state.disposed) return
    state.disposed = true

    destroyHls()
    unbindElement(video)
    video.pause()
    video.removeAttribute('src')
    video.load()
    video.remove()
    clearObjectUrl()

    mesh.remove(surface)
    surface.geometry.dispose()
    surfaceMaterial.dispose()
    texture.dispose()
    mesh.material = pristineMaterial(mesh)
    if (baseMaterial) {
      baseMaterial.dispose()
      baseMaterial = null
    }
    emitter.clear()
  }

  return {
    get video() {
      return video
    },
    get texture() {
      return texture
    },
    get fit() {
      return state.fit
    },
    get hasSource() {
      return !!state.currentSrc
    },
    /** The screen the film is on right now, which can change; see setScreenMesh. */
    get mesh() {
      return mesh
    },
    surface,
    size: geometry,
    load,
    showStream,
    clear,
    setFit,
    setScreenSize,
    setScreenMesh,
    layout,

    /**
     * Grade the picture. Takes any subset of
     * { brightness, contrast, saturation, warmth, gamma } and returns the full
     * set that is now live.
     */
    setPicture: picture.set,
    getPicture: picture.get,
    resetPicture: picture.reset,
    setPicturePreset,
    /** The dials and the named looks, so a panel can build itself generically. */
    pictureFields: PICTURE_FIELDS,
    picturePresets: PICTURE_PRESETS,

    dispose,
    on: emitter.on,
    off: emitter.off,
  }
}

/**
 * YouTube and Vimeo on the cinema screen.
 *
 * Those two never hand over the picture as pixels: the video lives inside their
 * own iframe and no browser lets us copy it into a WebGL texture. So instead of
 * painting the frame onto the screen, the iframe itself is placed in the room -
 * a CSS3DRenderer puts a real DOM element at the exact position, size and angle
 * of the screen, and the WebGL canvas punches a transparent hole where the
 * screen is so it shows through.
 *
 * That means:
 *   - the picture is really there, in perspective, from any seat
 *   - anything physically in front of the screen still covers it
 *   - the sound comes straight out of the browser, so it cannot go through the
 *     hall reverb the way a local file does
 *   - the viewer's grade cannot ride in a shader either, so it is applied to
 *     the element as a CSS filter (see `setPicture` below and picture.js)
 *
 *   const embed = createEmbedScreen({ screenMesh, camera, container, renderer })
 *   if (embed.canPlay(url)) await embed.load(url)
 *   embed.render(camera)   // once per frame
 */

import * as THREE from 'three'
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'
import { createEmitter, clamp } from './util.js'
import { ORIGINAL_MATERIAL_KEY } from './videoScreen.js'
import { cssFilterFor } from './picture.js'

/**
 * The material this screen wore before either of us touched it. Shared with
 * videoScreen.js through one key on the mesh, so that neither module ever
 * "restores" the other one's temporary material - see the note there.
 */
function pristineMaterial(mesh) {
  if (!mesh) return null
  if (!mesh.userData[ORIGINAL_MATERIAL_KEY]) mesh.userData[ORIGINAL_MATERIAL_KEY] = mesh.material
  return mesh.userData[ORIGINAL_MATERIAL_KEY]
}

/** Width of the DOM element in CSS pixels before it is scaled into metres. */
const DEFAULT_PIXEL_WIDTH = 1600

/**
 * The picture quality choices, in element pixels.
 *
 * Steps and not a slider, because quality is not a continuum: YouTube serves
 * one of a handful of streams, and it picks which one from how large its player
 * is on the page. So each of these is the element width at which it starts
 * offering that rendition. A slider here promised a precision that does not
 * exist, which is exactly how it felt to use.
 */
export const EMBED_QUALITY_STEPS = [
  { key: 'auto', label: 'Auto', pixels: 1600 },
  { key: '720', label: '720p', pixels: 1280 },
  { key: '1080', label: '1080p', pixels: 1920 },
  { key: '1440', label: '1440p', pixels: 2560 },
  { key: '2160', label: '4K', pixels: 3840 },
]

/** Which step a pixel width belongs to, for ticking the right button. */
export function qualityStepFor(pixels) {
  let best = EMBED_QUALITY_STEPS[0]
  for (const step of EMBED_QUALITY_STEPS) {
    if (Math.abs(step.pixels - pixels) < Math.abs(best.pixels - pixels)) best = step
  }
  return best.key
}

const YT_API = 'https://www.youtube.com/iframe_api'

/* -------------------------------------------------------------------------- */
/* which site is this                                                          */
/* -------------------------------------------------------------------------- */

/**
 * @param {string} url
 * @returns {{ kind: 'youtube'|'vimeo', id: string, start?: number }|null}
 */
export function detectEmbed(url) {
  if (typeof url !== 'string') return null
  let parsed
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }

  const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
  const start = Number(parsed.searchParams.get('t') || parsed.searchParams.get('start')) || 0
  // A YouTube link can carry a whole playlist as well as, or instead of, one
  // video. Both forms are worth keeping: "watch?v=X&list=PL" means "start this
  // list at X", and a bare /playlist?list=PL means "start it at the top".
  const list = parsed.searchParams.get('list') || null
  const index = Number(parsed.searchParams.get('index')) || 0

  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1).split('/')[0]
    return id ? { kind: 'youtube', id, start, list, index } : null
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    if (parsed.pathname === '/playlist') {
      return list ? { kind: 'youtube', id: null, start, list, index } : null
    }
    if (parsed.pathname === '/watch') {
      const id = parsed.searchParams.get('v')
      if (id || list) return { kind: 'youtube', id, start, list, index }
      return null
    }
    const match = parsed.pathname.match(/^\/(embed|shorts|live|v)\/([^/?#]+)/)
    if (match) return { kind: 'youtube', id: match[2], start, list, index }
    return null
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const match = parsed.pathname.match(/(\d{6,})/)
    return match ? { kind: 'vimeo', id: match[1], start } : null
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* the YouTube iframe API                                                      */
/* -------------------------------------------------------------------------- */

let youtubeApi = null

function loadYouTubeApi() {
  if (youtubeApi) return youtubeApi
  youtubeApi = new Promise((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT)
      return
    }
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previous === 'function') previous()
      resolve(window.YT)
    }
    const script = document.createElement('script')
    script.src = YT_API
    script.async = true
    script.onerror = () => reject(new Error('YouTube API did not load'))
    document.head.appendChild(script)
    // Slow or blocked network: fail rather than hang the load() call forever.
    setTimeout(() => reject(new Error('YouTube API timed out')), 12000)
  }).catch((err) => {
    youtubeApi = null
    throw err
  })
  return youtubeApi
}

/* -------------------------------------------------------------------------- */

/**
 * @param {object} options
 * @param {import('three').Object3D} options.screenMesh
 * @param {import('three').WebGLRenderer} options.renderer
 * @param {HTMLElement} options.container the element holding the WebGL canvas
 * @param {{width:number,height:number}} options.size picture size in metres
 */
export function createEmbedScreen(options = {}) {
  const { renderer, container } = options
  let screenMesh = options.screenMesh ?? null
  const emitter = createEmitter()

  const state = {
    kind: null,
    id: null,
    url: null,
    playing: false,
    duration: 0,
    time: 0,
    volume: 0.85,
    muted: false,
    /**
     * Whether the embed is asked to show its own subtitles.
     *
     * Off, and off is not the same as "not asked for": YouTube turns captions
     * on by itself whenever the account, the browser language or the video's
     * own default says so, and there is no player var that reliably stops it.
     * `cc_load_policy: 0` is only a hint and it loses to all three. So the
     * subtitle module is unloaded outright once the player is up - see
     * applyCaptions() - and that is a thing you have to keep doing, because the
     * module is reloaded when the video changes inside a playlist.
     */
    captions: false,
    size: { width: options.size?.width || 16, height: options.size?.height || 9 },
    /** The viewer's grade, already translated to CSS by picture.js. */
    filter: 'none',
    /** Video ids of the list we are inside, and where in it we are. */
    playlist: [],
    playlistIndex: -1,
    /**
     * How many CSS pixels wide the element is before it is scaled into metres.
     *
     * This is the picture quality dial for an embed, and not by analogy: the
     * IFrame API's own quality call has been a no-op for years, and what
     * YouTube actually serves is decided by how large the player is on the
     * page. A wider element gets a higher stream and more pixels to fill the
     * screen mesh with; a narrower one is cheaper on a slow machine.
     */
    pixelWidth: options.pixelWidth || DEFAULT_PIXEL_WIDTH,
    disposed: false,
  }

  // --- the DOM layer, behind the WebGL canvas -------------------------------
  const css = new CSS3DRenderer()
  Object.assign(css.domElement.style, {
    position: 'absolute',
    inset: '0',
    zIndex: '0',
    pointerEvents: 'none',
  })
  container.insertBefore(css.domElement, container.firstChild)

  // The canvas has to sit on top of it, and stay clickable for the pointer lock.
  if (renderer?.domElement) {
    renderer.domElement.style.position = 'relative'
    renderer.domElement.style.zIndex = '1'
  }

  const cssScene = new THREE.Scene()

  const holder = document.createElement('div')
  holder.className = 'vc-embed'
  Object.assign(holder.style, {
    width: `${DEFAULT_PIXEL_WIDTH}px`,
    background: '#000',
    overflow: 'hidden',
    // Nothing here should ever eat a click meant for the room.
    pointerEvents: 'none',
  })

  const slot = document.createElement('div')
  slot.style.width = '100%'
  slot.style.height = '100%'
  holder.appendChild(slot)

  const object = new CSS3DObject(holder)
  object.visible = false
  cssScene.add(object)

  // --- the hole in the WebGL canvas -----------------------------------------
  // Writes depth and a fully transparent pixel, so the canvas shows the page
  // (and the iframe) through it, while anything nearer still draws on top.
  const holeMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    opacity: 0,
    blending: THREE.NoBlending,
    side: THREE.DoubleSide,
  })
  pristineMaterial(screenMesh)

  function applyPlacement() {
    const { width, height } = state.size
    const pixels = state.pixelWidth
    holder.style.width = `${pixels}px`
    holder.style.height = `${Math.round((pixels * height) / width)}px`

    const scale = width / pixels
    object.scale.set(scale, scale, scale)

    if (screenMesh) {
      screenMesh.getWorldPosition(object.position)
      screenMesh.getWorldQuaternion(object.quaternion)
      // A hair in front of the surface, so it never fights the screen for depth.
      object.translateZ(0.02)
    }
    css.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight)
  }

  /**
   * The grade is painted on `slot`, not on `holder`: the holder is the element
   * CSS3DRenderer writes the room's transform matrix onto, and a filter turns
   * an element into its own stacking and flattening context. Keeping the two
   * apart means the grade can never argue with the perspective.
   */
  function applyFilter() {
    slot.style.filter = state.filter
  }

  /**
   * Grade the embedded picture.
   *
   * Takes the same values as `screen.setPicture()`, because it is the same
   * grade: the shader in picture.js cannot reach inside somebody else's iframe,
   * so the numbers are applied to the element instead. picture.js owns the
   * translation, see `cssFilterFor()` there for where CSS and the shader differ.
   *
   * @param {Record<string, number>} values { brightness, contrast, ... }
   */
  function setPicture(values) {
    state.filter = cssFilterFor(values)
    applyFilter()
    return state.filter
  }

  function showLayer(on) {
    object.visible = !!on
    if (screenMesh) screenMesh.material = on ? holeMaterial : pristineMaterial(screenMesh)
    emitter.emit('embed', { active: !!on, kind: state.kind })
  }

  /**
   * Move the embed to another screen: the television in a venue, or the hall's
   * screen on the way back.
   *
   * The player itself is never touched, so a video that is playing carries on
   * playing while it moves with you. Only the hole travels: the screen we are
   * leaving gets its own face back, the new one loses it.
   *
   * @param {import('three').Object3D} next
   * @param {{width:number,height:number}} [size] picture size in metres
   */
  function setScreenMesh(next, size) {
    if (state.disposed || !next || next === screenMesh) {
      if (size) setSize(size)
      return screenMesh
    }

    // Only take back what we put there. Anything else on that screen belongs to
    // whoever else is drawing on it.
    if (screenMesh && screenMesh.material === holeMaterial) {
      screenMesh.material = pristineMaterial(screenMesh)
    }

    screenMesh = next
    pristineMaterial(screenMesh)
    if (state.kind) screenMesh.material = holeMaterial

    if (size?.width) state.size.width = size.width
    if (size?.height) state.size.height = size.height
    applyPlacement()
    return screenMesh
  }

  /* ---------------------------------------------------------------------- */
  /* players                                                                 */
  /* ---------------------------------------------------------------------- */

  let player = null // the YouTube player, when there is one
  let vimeoFrame = null
  let vimeoMessages = null
  let poll = null
  let captionTimers = []

  /**
   * Say again what the subtitles should be doing.
   *
   * Called more than once on purpose. The captions module does not exist yet
   * when the player says it is ready, it arrives some time after the first
   * frame, and it comes back on its own every time a playlist moves to the next
   * video. One call is a coin toss; a call on ready, on every state change and
   * on a short ladder of timers is what actually holds.
   *
   * Both module names are used: 'captions' is the HTML5 player's, 'cc' the old
   * AS3 one, and a player that does not know a name simply ignores the call.
   */
  function applyCaptions() {
    if (state.kind === 'vimeo') {
      vimeoSend(state.captions ? 'enableTextTrack' : 'disableTextTrack')
      return
    }
    if (!player) return
    for (const module of ['captions', 'cc']) {
      try {
        if (state.captions) player.loadModule?.(module)
        else player.unloadModule?.(module)
      } catch {
        /* this player build does not carry that module; the other name may */
      }
    }
    // unloadModule leaves the last track selected on some builds, so the track
    // itself is cleared as well. An empty object is the API's own "none".
    if (!state.captions) {
      try {
        player.setOption?.('captions', 'track', {})
      } catch {
        /* nothing to clear */
      }
    }
  }

  /** The ladder: the module can take a few seconds to exist at all. */
  function scheduleCaptions() {
    for (const timer of captionTimers) clearTimeout(timer)
    captionTimers = [0, 600, 1500, 3000, 6000].map((delay) =>
      setTimeout(() => {
        if (!state.disposed) applyCaptions()
      }, delay),
    )
  }

  function clearPlayer() {
    if (poll) {
      clearInterval(poll)
      poll = null
    }
    for (const timer of captionTimers) clearTimeout(timer)
    captionTimers = []
    if (player) {
      try {
        player.destroy()
      } catch {
        /* already gone */
      }
      player = null
    }
    if (vimeoMessages) {
      window.removeEventListener('message', vimeoMessages)
      vimeoMessages = null
    }
    vimeoFrame = null
    slot.innerHTML = ''
    const fresh = document.createElement('div')
    fresh.style.width = '100%'
    fresh.style.height = '100%'
    slot.appendChild(fresh)
    return fresh
  }

  function report() {
    emitter.emit('timeupdate', { time: state.time, duration: state.duration })
  }

  /** Keep the "3 από 24" counter honest, whoever moved the list. */
  function readPlaylist() {
    if (!player?.getPlaylist) return
    const list = player.getPlaylist() || []
    const index = player.getPlaylistIndex?.() ?? -1
    if (list.length !== state.playlist.length || index !== state.playlistIndex) {
      state.playlist = list
      state.playlistIndex = index
      emitter.emit('playlist', { length: list.length, index })
    }
  }

  async function loadYouTube(info) {
    const YT = await loadYouTubeApi()
    const mount = clearPlayer()

    await new Promise((resolve) => {
      player = new YT.Player(mount, {
        width: '100%',
        height: '100%',
        videoId: info.id || undefined,
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          iv_load_policy: 3,
          // A hint, and only a hint: see state.captions for why the module is
          // unloaded by hand as well.
          cc_load_policy: state.captions ? 1 : 0,
          start: info.start || 0,
          // A list with no video id starts at the top; with one, that video is
          // where the list is joined. `loop` keeps a list going round.
          ...(info.list ? { list: info.list, listType: 'playlist', index: info.index || 0 } : null),
        },
        events: {
          onReady: (event) => {
            event.target.setVolume(Math.round(state.volume * 100))
            if (state.muted) event.target.mute()
            event.target.playVideo()
            state.duration = event.target.getDuration() || 0
            readPlaylist()
            scheduleCaptions()
            resolve()
          },
          onStateChange: (event) => {
            state.playing = event.data === YT.PlayerState.PLAYING
            state.duration = player?.getDuration?.() || state.duration
            readPlaylist()
            // The next video in a playlist brings its own subtitles back.
            if (event.data === YT.PlayerState.PLAYING) applyCaptions()
            emitter.emit(state.playing ? 'play' : 'pause', {})
            if (event.data === YT.PlayerState.ENDED) emitter.emit('ended', {})
          },
          onError: () => {
            emitter.emit('error', {
              code: 0,
              message: 'Αυτό το βίντεο του YouTube δεν επιτρέπει προβολή έξω από το YouTube.',
            })
          },
        },
      })
    })

    poll = setInterval(() => {
      if (!player?.getCurrentTime) return
      state.time = player.getCurrentTime() || 0
      state.duration = player.getDuration() || state.duration
      report()
    }, 500)
  }

  function vimeoSend(method, value) {
    if (!vimeoFrame?.contentWindow) return
    vimeoFrame.contentWindow.postMessage(JSON.stringify({ method, value }), '*')
  }

  async function loadVimeo(info) {
    clearPlayer()
    const frame = document.createElement('iframe')
    frame.src =
      `https://player.vimeo.com/video/${info.id}?autoplay=1&title=0&byline=0&portrait=0&controls=0` +
      (info.start ? `#t=${info.start}s` : '')
    frame.allow = 'autoplay; fullscreen; encrypted-media'
    frame.style.width = '100%'
    frame.style.height = '100%'
    frame.style.border = '0'
    slot.innerHTML = ''
    slot.appendChild(frame)
    vimeoFrame = frame

    vimeoMessages = (event) => {
      if (!/vimeo\.com$/.test(new URL(event.origin).hostname)) return
      let data
      try {
        data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      } catch {
        return
      }
      if (data.event === 'ready') {
        for (const name of ['play', 'pause', 'timeupdate', 'ended']) vimeoSend('addEventListener', name)
        vimeoSend('setVolume', state.muted ? 0 : state.volume)
        applyCaptions()
        vimeoSend('play')
      } else if (data.event === 'timeupdate') {
        state.time = data.data?.seconds ?? state.time
        state.duration = data.data?.duration ?? state.duration
        report()
      } else if (data.event === 'play') {
        state.playing = true
        emitter.emit('play', {})
      } else if (data.event === 'pause') {
        state.playing = false
        emitter.emit('pause', {})
      } else if (data.event === 'ended') {
        state.playing = false
        emitter.emit('ended', {})
      }
    }
    window.addEventListener('message', vimeoMessages)
  }

  /* ---------------------------------------------------------------------- */
  /* public                                                                  */
  /* ---------------------------------------------------------------------- */

  /** True when this url is one we have to embed rather than texture. */
  function canPlay(url) {
    return !!detectEmbed(url)
  }

  /**
   * @param {string} url
   * @param {{at?: number}} [opts] where to come in, in seconds. Used when a
   *   hall is already twenty minutes into a film: the player is built with
   *   that as its own start point, so a late arrival never sees the opening
   *   frame flash past before jumping.
   */
  async function load(url, opts = {}) {
    const info = detectEmbed(url)
    if (!info) return false
    if (Number.isFinite(opts.at) && opts.at > 0) info.start = Math.round(opts.at)

    state.kind = info.kind
    state.id = info.id
    state.url = url
    state.time = 0
    state.duration = 0
    state.playing = false

    applyPlacement()
    showLayer(true)
    // A new player is a new iframe inside the slot, so put the grade back on it
    // before it draws its first frame.
    applyFilter()

    try {
      if (info.kind === 'youtube') await loadYouTube(info)
      else await loadVimeo(info)
    } catch (err) {
      showLayer(false)
      state.kind = null
      emitter.emit('error', {
        code: 0,
        message: 'Δεν φόρτωσε ο player του YouTube. Δες τη σύνδεση ή τυχόν ad blocker.',
        error: err,
      })
      return false
    }

    emitter.emit('loaded', { kind: info.kind, url })
    return true
  }

  function unload() {
    if (!state.kind) return
    clearPlayer()
    showLayer(false)
    state.kind = null
    state.id = null
    state.url = null
    state.playing = false
    state.time = 0
    state.duration = 0
  }

  function play() {
    if (!state.kind) return false
    if (state.kind === 'youtube') player?.playVideo?.()
    else vimeoSend('play')
    return true
  }

  function pause() {
    if (!state.kind) return false
    if (state.kind === 'youtube') player?.pauseVideo?.()
    else vimeoSend('pause')
    return true
  }

  function seek(seconds) {
    if (!state.kind) return
    const target = Math.max(0, Number(seconds) || 0)
    if (state.kind === 'youtube') player?.seekTo?.(target, true)
    else vimeoSend('setCurrentTime', target)
    state.time = target
  }

  function setVolume(value) {
    state.volume = clamp(Number(value) || 0, 0, 1)
    if (state.kind === 'youtube') player?.setVolume?.(Math.round(state.volume * 100))
    else vimeoSend('setVolume', state.muted ? 0 : state.volume)
  }

  function setMuted(value) {
    state.muted = !!value
    if (state.kind === 'youtube') {
      if (state.muted) player?.mute?.()
      else player?.unMute?.()
    } else {
      vimeoSend('setVolume', state.muted ? 0 : state.volume)
    }
  }

  /**
   * Subtitles on or off, for the site's own subtitle track.
   *
   * @param {boolean} value
   * @returns {boolean} what was stored
   */
  function setCaptions(value) {
    state.captions = !!value
    scheduleCaptions()
    return state.captions
  }

  function setSize(size) {
    if (size?.width) state.size.width = size.width
    if (size?.height) state.size.height = size.height
    applyPlacement()
  }

  /**
   * Picture quality for an embed: how many pixels wide the player element is.
   * See the note on `state.pixelWidth` for why this and not a quality call.
   */
  function setQuality(pixels) {
    const next = Math.round(Math.min(Math.max(Number(pixels) || DEFAULT_PIXEL_WIDTH, 640), 3840))
    if (next === state.pixelWidth) return state.pixelWidth
    state.pixelWidth = next
    applyPlacement()
    // Best effort on top: modern YouTube ignores it, older embeds honour it.
    const label = next >= 2400 ? 'hd1440' : next >= 1800 ? 'hd1080' : next >= 1200 ? 'hd720' : 'large'
    try {
      player?.setPlaybackQuality?.(label)
    } catch {
      /* the API dropped it years ago; the element size is the real control */
    }
    return state.pixelWidth
  }

  /** Next and previous only mean anything inside a playlist. */
  function next() {
    if (state.kind !== 'youtube' || !state.playlist.length) return false
    player?.nextVideo?.()
    return true
  }

  function previous() {
    if (state.kind !== 'youtube' || !state.playlist.length) return false
    player?.previousVideo?.()
    return true
  }

  function playAt(index) {
    if (state.kind !== 'youtube' || !state.playlist.length) return false
    player?.playVideoAt?.(Math.max(0, Math.min(index, state.playlist.length - 1)))
    return true
  }

  const _cameraDir = new THREE.Vector3()
  const _toScreen = new THREE.Vector3()

  /** Called once per frame, after the WebGL render. */
  function render(camera) {
    if (state.disposed || !state.kind || !camera) return
    // Behind the screen there is a wall, and a DOM element has no depth test
    // against WebGL, so hide it rather than let it shine through the building.
    _toScreen.copy(object.position).sub(camera.position)
    camera.getWorldDirection(_cameraDir)
    object.visible = _toScreen.dot(_cameraDir) > 0
    css.render(cssScene, camera)
  }

  function resize() {
    applyPlacement()
  }

  function dispose() {
    if (state.disposed) return
    state.disposed = true
    unload()
    css.domElement.remove()
    holeMaterial.dispose()
    emitter.clear()
  }

  applyPlacement()

  return {
    element: holder,
    canPlay,
    detect: detectEmbed,
    load,
    unload,
    play,
    pause,
    seek,
    setVolume,
    setMuted,
    setCaptions,
    get captions() {
      return state.captions
    },
    /** What the site's own player was last told to play at, 0..1. */
    get volume() {
      return state.muted ? 0 : state.volume
    },
    setSize,
    setPicture,
    setQuality,
    get quality() {
      return state.pixelWidth
    },
    next,
    previous,
    playAt,
    /** How long the list is and where we are in it, or 0 and -1 for one video. */
    get playlistLength() {
      return state.playlist.length
    },
    get playlistIndex() {
      return state.playlistIndex
    },
    /** The CSS filter the grade is currently painting with, handy for QA. */
    get filter() {
      return state.filter
    },
    setScreenMesh,
    get screenMesh() {
      return screenMesh
    },
    render,
    resize,
    dispose,
    get active() {
      return !!state.kind
    },
    get kind() {
      return state.kind
    },
    get isPlaying() {
      return state.playing
    },
    get currentTime() {
      return state.time
    },
    get duration() {
      return state.duration
    },
    on: emitter.on,
    off: emitter.off,
  }
}

export default createEmbedScreen

/**
 * main.js: integration layer only.
 *
 * This file owns no cinema logic. It boots the four feature modules in order,
 * hands each one the objects the previous step produced, and keeps a single
 * render loop running. If a module is not on disk yet (or throws while
 * starting) the app still boots and reports what is missing, so the other
 * modules can be developed and tested independently.
 *
 * Module contract (see README.md):
 *   src/scene/index.js   createScene({ container })
 *                        -> { renderer, scene, camera, seats?, update?, resize? }
 *   src/player/index.js  createPlayer({ renderer, scene, camera, seats, ... })
 *                        -> { update?, seat? }
 *   src/media/index.js   createMedia({ scene, camera, ... })
 *                        -> { update?, video? }
 *   src/sound/index.js   createSound({ media, player, ... })
 *                        -> { click?, tick?, setVolume? }
 *   src/venues/index.js  createVenues({ scene, player, media, sound, ... })
 *                        -> { list, current, go, update? }
 *   src/update/index.js  createUpdater({ sound, ... })
 *                        -> { available, apply?, showChangelog? }
 *   src/room/index.js    createRoom({ lighting, sound, player, ... })
 *                        -> { setHouseLights?, dispose? }
 *   src/net/index.js     createNet({ url, scene, camera, player, media, ... })
 *                        -> { update? }
 *
 * Every factory may be async and every returned field is optional.
 * `window.__cinema` exposes the boot result for the smoke tests and manual QA.
 */

/**
 * One path per module. Keep it that way: a second, non existent candidate is
 * still statically analysed by the bundler, which then refuses to resolve it
 * and fails both `npm run dev` and `npm run build`.
 */
const SOURCES = {
  scene: [() => import('./scene/index.js')],
  player: [() => import('./player/index.js')],
  media: [() => import('./media/index.js')],
  sound: [() => import('./sound/index.js')],
  audience: [() => import('./audience/index.js')],
  venues: [() => import('./venues/index.js')],
  update: [() => import('./update/index.js')],
  room: [() => import('./room/index.js')],
  net: [() => import('./net/index.js')],
}

/** Boot order. Every module gets whatever the ones before it produced. */
const ORDER = ['scene', 'player', 'media', 'sound', 'audience', 'venues', 'update', 'room', 'net']

/** Factory names accepted per module, in priority order. */
const FACTORIES = {
  scene: ['createScene', 'initScene', 'setupScene', 'buildScene', 'default'],
  player: ['createPlayer', 'initPlayer', 'setupPlayer', 'default'],
  media: ['createMedia', 'initMedia', 'setupMedia', 'createScreen', 'default'],
  sound: ['createSound', 'initSound', 'default'],
  audience: ['createAudience', 'initAudience', 'default'],
  venues: ['createVenues', 'initVenues', 'default'],
  update: ['createUpdater', 'createUpdate', 'default'],
  room: ['createRoom', 'createRoomControls', 'default'],
  net: ['createNet', 'initNet', 'setupNet', 'connect', 'default'],
}

const flags = (value) => Object.fromEntries(ORDER.map((name) => [name, value]))

const status = {
  ready: false,
  loaded: flags(false),
  started: flags(false),
  errors: [],
  handles: {},
}

window.__cinema = status

const statusEl = document.getElementById('boot-status')

function report() {
  if (!statusEl) return
  const missing = Object.keys(status.loaded).filter((k) => !status.started[k])
  if (!missing.length) {
    statusEl.textContent = ''
    statusEl.style.display = 'none'
    return
  }
  statusEl.style.display = ''
  statusEl.textContent =
    `Not loaded yet: ${missing.join(', ')}\n` +
    status.errors.slice(-3).join('\n')
}

async function loadModule(name) {
  let lastError = null
  for (const load of SOURCES[name]) {
    try {
      const mod = await load()
      status.loaded[name] = true
      return mod
    } catch (err) {
      lastError = err
    }
  }
  status.errors.push(`[${name}] module not found (${lastError?.message ?? 'unknown'})`)
  console.warn(`[cinema] module "${name}" not loaded yet`, lastError)
  return null
}

async function start(name, mod, context) {
  if (!mod) return null
  const factory = FACTORIES[name].map((key) => mod[key]).find((fn) => typeof fn === 'function')
  if (!factory) {
    status.errors.push(`[${name}] missing export: ${FACTORIES[name].slice(0, -1).join(' / ')}`)
    return null
  }
  try {
    const handle = (await factory(context)) ?? {}
    status.started[name] = true
    status.handles[name] = handle
    return handle
  } catch (err) {
    status.errors.push(`[${name}] threw on startup: ${err.message}`)
    console.error(`[cinema] module "${name}" failed to start`, err)
    return null
  }
}

function runLoop(context) {
  const { renderer, scene, camera } = context
  const updatables = ORDER
    .map((name) => status.handles[name])
    .filter((handle) => handle && typeof handle.update === 'function')

  let previous = performance.now()
  const frame = (now) => {
    const delta = Math.min((now - previous) / 1000, 0.1)
    previous = now
    for (const handle of updatables) {
      try {
        handle.update(delta)
      } catch (err) {
        console.error('[cinema] update failed', err)
      }
    }
    // The scene module owns how a frame reaches the canvas: it may put the
    // picture through the bloom composer first, and it knows when not to.
    if (typeof status.handles.scene?.render === 'function') status.handles.scene.render(camera)
    else if (renderer && scene && camera) renderer.render(scene, camera)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

async function boot() {
  const container = document.getElementById('app') ?? document.body

  const modules = Object.fromEntries(
    await Promise.all(ORDER.map(async (name) => [name, await loadModule(name)])),
  )

  const context = { container }

  const sceneApi = await start('scene', modules.scene, context)
  Object.assign(context, sceneApi ?? {})

  // Attach the canvas if the scene module built one but left it detached.
  const canvas = context.renderer?.domElement
  if (canvas && !canvas.isConnected) container.appendChild(canvas)

  context.player = await start('player', modules.player, context)

  /**
   * Which hall, and under what name.
   *
   * Filled in by the foyer (src/media/startOverlay.js) at the moment the
   * viewer presses the button, and read by the network module a line later.
   * It is a callback and not a value because the modules are built in order
   * and the viewer takes as long as they take.
   */
  context.onEnter = (entry) => {
    if (!entry?.hall) return
    context.net?.join(entry.hall, entry.name)
    context.player?.lock?.()
  }
  // The transport (play, the clock, the seek bar) lives in the room's dock now,
  // so the media module does not draw a second panel of its own.
  context.controls = false
  context.media = await start('media', modules.media, context)
  // A YouTube embed shows through a transparent hole in the canvas, and the
  // bloom composer would paint straight over it. The scene cannot see the media
  // module, so it asks this question once per frame instead.
  sceneApi?.setPostFxBypass?.(() => context.media?.embed?.active === true)
  // Sound shares the media module's AudioContext, so it has to come after it.
  context.sound = await start('sound', modules.sound, context)
  // The people in the seats fill the room and the mix at the same time, so they
  // need the desk that is already up.
  context.audience = await start('audience', modules.audience, context)
  // The other places you can walk into. They need the film (to hang it on the
  // television of whichever room you are in) and the desk (to play the rain
  // through it), so they come after both and before the panel that lists them.
  context.venues = await start('venues', modules.venues, context)
  // The room menu offers "what changed" and "update now", so it needs this.
  context.update = await start('update', modules.update, context)
  context.room = await start('room', modules.room, context)
  // No url here on purpose: src/net/config.js works out where the room server
  // is, and it is the only place that knows. In development that is port 8787
  // next door; served from one host it is this very origin over wss.
  //
  // `deferJoin` while the foyer is up: joining before the viewer has picked a
  // door would put them in a hall they never chose, and everyone already in it
  // would watch a stranger appear and leave again a second later.
  context.net = await start('net', modules.net, {
    ...context,
    deferJoin: !!context.media?.startOverlay,
  })
  // The room's bar carries the "share my screen" button, and the room is built
  // before the network that makes it work. This is the handshake.
  context.room?.bindScreenShare?.(context.net?.screen)
  context.net?.on?.('screen', () => context.room?.bindScreenShare?.(context.net?.screen))

  window.addEventListener('resize', () => {
    for (const handle of Object.values(status.handles)) {
      if (handle && typeof handle.resize === 'function') handle.resize()
    }
  })

  // A scene module may drive its own loop; only take over when it does not.
  if (typeof sceneApi?.start === 'function') sceneApi.start()
  else if (typeof sceneApi?.animate === 'function') sceneApi.animate()
  else runLoop(context)

  status.ready = true
  report()
}

boot().catch((err) => {
  status.errors.push(`boot: ${err.message}`)
  status.ready = true
  report()
  console.error('[cinema] boot failed', err)
})

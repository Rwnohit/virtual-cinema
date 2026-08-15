/**
 * Venues module: the other places you can be.
 *
 * The hall is no longer the only room. There is a dark living room with rain on
 * the window (the horror house) and a warm one with a fire in it (the cosy
 * room), and the film follows you into both: the television in each room is
 * the display surface, so a local file, a YouTube link or a Vimeo link plays in
 * there with every feature it has in the auditorium.
 *
 *   const venues = await createVenues(context)   // main.js, after media
 *   venues.go('horror')
 *   venues.setHorror(0.8)
 *
 * What this module owns
 *   - the two extra rooms (horror.js, cozy.js) and their lights
 *   - which one you are in, and the walk between them (fade, spawn, collision)
 *   - the doors: walking up to one offers the move, it never takes it for you
 *   - the sound those rooms make (audio.js), synthesised, no files
 *   - handing the player the room it is standing in: its seats, its camera
 *     shots and its television, in one call (`player.setPlace`)
 *
 * What it does not own: the film (src/media), the light board (src/room), the
 * mixing desk (src/sound). It asks all three and writes to none of their
 * settings.
 */

import * as THREE from 'three'
import { ROOM_BOUNDS } from '../scene/constants.js'
import { createHorrorVenue } from './horror.js'
import { createCozyVenue } from './cozy.js'
import { createVenueAudio } from './audio.js'
import { clamp01 } from './kit.js'

const STORAGE_KEY = 'vc.venue'
const STYLE_ID = 'vc-venue-style'

/**
 * The two rooms sit well away from the hall in world coordinates rather than
 * on top of it. Nothing then has to be told which room a coordinate belongs to:
 * the seats are 60 metres away, so they are never "the nearest free seat", and
 * two sets of collision boxes can never overlap.
 */
const ORIGINS = Object.freeze({
  horror: Object.freeze({ x: 62, z: 0 }),
  cozy: Object.freeze({ x: -62, z: 0 }),
})

/**
 * Everything a panel can put a slider on, in one table, so it can draw itself
 * without knowing anything about these rooms. Same shape as MIXER_FIELDS in
 * src/sound/mixer.js and BLOOM_FIELDS in src/scene/postfx.js.
 */
export const VENUE_FIELDS = Object.freeze([
  { key: 'horror', label: 'How frightening', min: 0, max: 1, step: 0.05, format: 'percent' },
  { key: 'fire', label: 'The fire', min: 0, max: 1, step: 0.05, format: 'percent' },
  { key: 'ambience', label: 'Room sounds', min: 0, max: 1, step: 0.05, format: 'percent' },
  // One television per room rather than one for both: they are different sets
  // in different rooms, and a slider that means "the one you are standing in
  // front of" is a slider you have to be somewhere to read.
  { key: 'tvHorror', label: 'Television · horror house', min: 0.7, max: 1.3, step: 0.05, format: 'x' },
  { key: 'tvCozy', label: 'Television · cosy room', min: 0.7, max: 1.3, step: 0.05, format: 'x' },
])

const DEFAULTS = Object.freeze({
  horror: 0.35,
  fire: 0.75,
  ambience: 0.85,
  tvHorror: 1,
  tvCozy: 1,
})

const CSS = `
.vv-veil{position:fixed;inset:0;z-index:78;background:#000;opacity:0;pointer-events:none;
  transition:opacity 320ms ease;}
.vv-prompt{position:fixed;left:50%;bottom:calc(96px + env(safe-area-inset-bottom,0px));
  transform:translate(-50%,8px);z-index:39;padding:9px 16px;border-radius:999px;
  background:rgba(10,11,15,.72);border:1px solid rgba(255,255,255,.14);color:#f2f2f4;
  font:13px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:.2px;
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  pointer-events:none;opacity:0;transition:opacity .22s ease,transform .22s ease;}
.vv-prompt.is-on{opacity:.96;transform:translate(-50%,0);}
.vv-prompt b{font-weight:600;color:#ffd479;}
@media (prefers-reduced-motion: reduce){.vv-veil,.vv-prompt{transition:none;}}
`

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @param {object} [context] everything main.js has built so far
 * @param {import('three').Scene} [context.scene]
 * @param {object} [context.cinema] the hall, for its group and its screen
 * @param {object} [context.seats] the seating, hidden while you are elsewhere
 * @param {object} [context.lighting] the hall's light rig, ditto
 * @param {object} [context.player] the player, for the feet and the collider
 * @param {object} [context.media] the film, for setScreenMesh()
 * @param {object} [context.sound] the mixing desk, for a channel to play into
 */
export function createVenues(context = {}) {
  const scene = context.scene ?? null
  const player = context.player ?? null
  const media = context.media ?? null
  const sound = context.sound ?? null
  const lighting = context.lighting ?? context.scene?.lighting ?? null
  const collider = player?.collider ?? null
  const container = context.container ?? document.getElementById('app') ?? document.body

  /* ---------------------------------------------------------------------- */
  /* settings                                                                */
  /* ---------------------------------------------------------------------- */

  const stored = readStored()
  const settings = { ...DEFAULTS, last: 'cinema' }
  for (const field of VENUE_FIELDS) {
    const value = Number(stored?.[field.key])
    if (Number.isFinite(value)) settings[field.key] = Math.min(Math.max(value, field.min), field.max)
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      /* private mode, never mind */
    }
  }

  /* ---------------------------------------------------------------------- */
  /* sound                                                                   */
  /* ---------------------------------------------------------------------- */

  // One AudioContext for the whole app: the mixing desk's if it booted, the
  // film's otherwise. A second one would drift against the film and would need
  // its own gesture to wake up.
  const audioContext = sound?.mixer?.context ?? media?.audio?.context ?? null
  // The room channel is where the building's own noises belong, so the viewer's
  // "air and ventilation" fader has the last word over the rain as well.
  const audioTarget = sound?.mixer?.channels?.room?.input ?? audioContext?.destination ?? null
  const voices = createVenueAudio({ context: audioContext, destination: audioTarget })
  voices.setLevel(settings.ambience)

  /* ---------------------------------------------------------------------- */
  /* the places                                                              */
  /* ---------------------------------------------------------------------- */

  const horror = createHorrorVenue({ origin: ORIGINS.horror, audio: voices })
  const cozy = createCozyVenue({ origin: ORIGINS.cozy, audio: voices })

  if (scene) {
    scene.add(horror.group)
    scene.add(cozy.group)
  }

  // Where the player was standing when the app booted is the hall's spawn: it
  // is the one place we know is legal, and it is where "Cinema" puts you back.
  const feet = player?.controls?.feet ?? null
  const hallSpawn = {
    x: feet?.x ?? 0,
    z: feet?.z ?? 12.4,
    yaw: player?.controls?.yaw ?? 0,
  }

  /**
   * The hall, described the same way as the two new rooms so that everything
   * below can treat all three alike. Its screen, its collision and its lights
   * belong to other modules, so most of this is deliberately empty.
   */
  const cinema = {
    id: 'cinema',
    label: 'Cinema',
    description: 'The big auditorium: 150 seats, curtains and a 23 metre screen.',
    group: null,
    get screen() {
      return context.cinema?.screen ?? null
    },
    spawn: hallSpawn,
    /** null means "the hall", which is what the collider falls back to. */
    layout: null,
    /** Same for the seats, the views and the screen C frames: see `swap`. */
    seats: null,
    views: null,
    screenInfo: null,
    exits: [
      {
        to: 'horror',
        // Just inside the back left exit door of the hall (see buildDoorsAndBooth).
        x: ROOM_BOUNDS.minX + 1.1,
        z: ROOM_BOUNDS.maxZ - 5,
        radius: 2.2,
        label: 'Horror house',
      },
      {
        to: 'cozy',
        x: ROOM_BOUNDS.maxX - 1.1,
        z: ROOM_BOUNDS.maxZ - 5,
        radius: 2.2,
        label: 'Cosy room',
      },
    ],
    /** The hall has a real light rig; the room panel drives it directly. */
    applyLights: () => ({}),
    enter() {},
    exit() {},
    update() {},
    dispose() {},
  }

  // Coming back from a room, you come out of the door you went in by.
  for (const exit of cinema.exits) {
    const arrive = { x: exit.x, z: exit.z - 0.6, yaw: 0 }
    const room = exit.to === 'horror' ? horror : cozy
    for (const back of room.exits) back.arrive = arrive
  }

  /**
   * A strip of light down the frame of the two doors that lead somewhere.
   *
   * The hall has four identical exit doors and nothing about them says which
   * two are worth walking to. This is the whole hint: a cold line beside one, a
   * warm one beside the other, dim enough to sit under the film the way the
   * aisle strips do. Walking up to it is what offers the move.
   */
  const markers = new THREE.Group()
  markers.name = 'VenueDoors'
  const markerMaterials = []
  for (const exit of cinema.exits) {
    const material = new THREE.MeshBasicMaterial({
      color: exit.to === 'horror' ? 0x24406b : 0x6b4318,
      fog: false,
    })
    markerMaterials.push(material)
    const side = exit.x < 0 ? -1 : 1
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.055, 2.4), material)
    // On the wall, a hand's width clear of the door frame, facing the aisle.
    strip.position.set(side * (ROOM_BOUNDS.maxX - 0.14), 1.32, exit.z + 1.05)
    strip.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2
    strip.name = `VenueDoor-${exit.to}`
    markers.add(strip)
  }
  scene?.add(markers)

  const places = new Map([
    [cinema.id, cinema],
    [horror.id, horror],
    [cozy.id, cozy],
  ])

  let current = 'cinema'
  let busy = false
  const listeners = new Set()

  /* ---------------------------------------------------------------------- */
  /* the overlay                                                             */
  /* ---------------------------------------------------------------------- */

  injectStyle()

  const veil = document.createElement('div')
  veil.className = 'vv-veil'
  container.appendChild(veil)

  const prompt = document.createElement('div')
  prompt.className = 'vv-prompt'
  container.appendChild(prompt)

  let promptText = ''
  let flashUntil = 0

  function setPrompt(html) {
    if (html === promptText) return
    promptText = html
    prompt.innerHTML = html
    prompt.classList.toggle('is-on', !!html)
  }

  /** A short caption of its own, so arriving somewhere says where you are. */
  function flash(message, ms = 1800) {
    flashUntil = performance.now() + ms
    setPrompt(message)
  }

  function fadeTo(value, ms) {
    veil.style.transitionDuration = `${ms}ms`
    veil.style.opacity = String(value)
    return wait(ms + 20)
  }

  /* ---------------------------------------------------------------------- */
  /* moving                                                                  */
  /* ---------------------------------------------------------------------- */

  /** Show or hide the hall. Its lights live in its own group, so they go too. */
  function showHall(on) {
    for (const handle of [context.cinema, context.seats, lighting]) {
      if (handle?.group) handle.group.visible = on
    }
    markers.visible = on
    // The hall's shadow map is drawn once and then frozen (see scene/index.js),
    // so it has to be asked for again when the room it belongs to comes back.
    if (on && context.renderer?.shadowMap) context.renderer.shadowMap.needsUpdate = true
  }

  function placePlayer(spawn) {
    const controls = player?.controls
    if (!controls || !spawn) return
    if (controls.isSeated) player.stand?.()
    // One call, because the body has to arrive in one piece: on the floor, at
    // a standstill, not in mid jump and not still walking somewhere else.
    controls.teleport({ x: spawn.x, z: spawn.z, yaw: spawn.yaw, pitch: 0 })
  }

  /** Nobody is teleported by a door they are already standing in. */
  function armExits(place) {
    for (const exit of place.exits ?? []) exit.armed = false
  }

  /**
   * What the player module needs to know about a place: where you may sit,
   * where the cameras go and how big the television is. Plain data, and null
   * for the hall, which owns all three itself.
   */
  function placeForPlayer(place) {
    if (!place || place.id === 'cinema' || !place.seats) return null
    return {
      id: place.id,
      seats: place.seats,
      seatReach: place.seatReach,
      views: place.views,
      // Kept by reference: resizing the set moves these numbers, and the
      // cinematic frame reads them every frame.
      screen: place.screenInfo,
    }
  }

  function swap(next, arrive) {
    const previous = places.get(current)
    previous?.exit?.()

    showHall(next.id === 'cinema')
    next.enter?.()

    collider?.setLayout(next.layout ?? null)
    // The seats E offers, the shots V walks through and the screen C frames all
    // belong to the room and not to the player, so they travel with the room.
    // null is the hall, exactly as it was.
    player?.setPlace?.(placeForPlayer(next))

    const screen = next.screen
    if (screen) media?.setScreenMesh?.(screen)

    placePlayer(arrive ?? next.spawn)

    // An audience belongs in an auditorium and nowhere else.
    if (next.id === 'cinema') {
      if ((sound?.mixer?.get?.('occupancy') ?? 0) > 0) sound?.crowd?.start?.()
    } else {
      sound?.crowd?.stop?.()
    }

    current = next.id
    settings.last = current
    persist()
    armExits(next)
    applyLights()

    for (const listener of listeners) {
      try {
        listener({ id: current, label: next.label })
      } catch (err) {
        console.error('[venues] listener failed', err)
      }
    }
  }

  /**
   * Walk into a place. Works from a door, from the panel and from the right
   * click menu alike.
   *
   * @param {string} id 'cinema' | 'horror' | 'cozy'
   * @param {{ at?: {x:number,z:number,yaw?:number}, fade?: boolean }} [options]
   * @returns {Promise<string>} the place you are in when it is over
   */
  async function go(id, options = {}) {
    const next = places.get(id)
    if (!next || busy || id === current) return current
    busy = true
    try {
      const fade = options.fade !== false
      // Short. This is a cut to the next room, not a journey: anything longer
      // and it starts to feel like a loading screen.
      if (fade) await fadeTo(1, 300)
      swap(next, options.at)
      if (fade) {
        await wait(70)
        await fadeTo(0, 420)
      }
      flash(`<b>${next.label}</b> · ${next.description}`, 2600)
    } finally {
      busy = false
    }
    return current
  }

  /* ---------------------------------------------------------------------- */
  /* lights                                                                  */
  /* ---------------------------------------------------------------------- */

  const lightState = { house: 0, warmth: 0 }

  /**
   * Hand the room panel's light sliders to whichever place you are in, so
   * "house lights" and "warm or cool" keep meaning something everywhere.
   * @param {{house?:number, warmth?:number}} [values]
   */
  function applyLights(values) {
    if (values) {
      if (Number.isFinite(values.house)) lightState.house = clamp01(values.house)
      if (Number.isFinite(values.warmth)) lightState.warmth = clamp01(values.warmth)
    }
    places.get(current)?.applyLights?.({ ...lightState })
    return { ...lightState }
  }

  /* ---------------------------------------------------------------------- */
  /* the knobs                                                               */
  /* ---------------------------------------------------------------------- */

  function setHorror(value) {
    settings.horror = clamp01(value)
    horror.setIntensity(settings.horror)
    persist()
    return settings.horror
  }

  function setFire(value) {
    settings.fire = clamp01(value)
    cozy.setFire(settings.fire)
    persist()
    return settings.fire
  }

  function setAmbience(value) {
    settings.ambience = clamp01(value)
    voices.setLevel(settings.ambience)
    persist()
    return settings.ambience
  }

  /**
   * A bigger or a smaller television in one of the rooms.
   *
   * The room builds a new screen mesh (see `setTvScale` in horror.js), so if the
   * film is playing on the old one it has to be handed the new one right away.
   * Nothing else has to be told: the framing reads the room's own measurements
   * every frame.
   *
   * @param {object} place the room whose set this is
   * @param {string} key the field in `settings` that remembers it
   */
  function setTv(place, key, value) {
    const applied = place.setTvScale(value)
    settings[key] = applied
    if (current === place.id) {
      const screen = place.screen
      if (screen) media?.setScreenMesh?.(screen)
    }
    persist()
    return applied
  }

  const setTvHorror = (value) => setTv(horror, 'tvHorror', value)
  const setTvCozy = (value) => setTv(cozy, 'tvCozy', value)

  const setters = {
    horror: setHorror,
    fire: setFire,
    ambience: setAmbience,
    tvHorror: setTvHorror,
    tvCozy: setTvCozy,
  }

  /* ---------------------------------------------------------------------- */
  /* doors                                                                   */
  /* ---------------------------------------------------------------------- */

  /** The door the player is standing in front of, if any. */
  let offered = null

  function updateDoors() {
    const at = player?.controls?.feet
    const place = places.get(current)
    if (!at || !place?.exits?.length || busy) {
      offered = null
      return
    }

    let nearest = null
    let best = Infinity
    for (const exit of place.exits) {
      const distance = Math.hypot(at.x - exit.x, at.z - exit.z)
      // A door you arrived through only becomes a door again once you have
      // stepped away from it. Otherwise you would be offered the way back the
      // instant you got here.
      if (!exit.armed) {
        if (distance > exit.radius * 1.35) exit.armed = true
        continue
      }
      if (distance < exit.radius && distance < best) {
        best = distance
        nearest = exit
      }
    }

    offered = nearest
    // Something you can actually do beats something we were telling you.
    if (nearest) {
      flashUntil = 0
      setPrompt(`${nearest.label} · <b>F</b>`)
      return
    }
    if (performance.now() < flashUntil) return
    setPrompt('')
  }

  const onKeyDown = (event) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
    const node = event.target
    if (node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable)) return
    if (event.code !== 'KeyF' || !offered) return
    event.preventDefault()
    const target = offered
    offered = null
    setPrompt('')
    sound?.click?.()
    go(target.to, { at: target.arrive })
  }
  document.addEventListener('keydown', onKeyDown)

  /* ---------------------------------------------------------------------- */
  /* frame                                                                   */
  /* ---------------------------------------------------------------------- */

  /** How often the room's own light sliders are read back, in seconds. */
  const LIGHT_POLL = 0.25
  let lightTimer = 0

  /**
   * Where the viewer is and which way they are looking, in world coordinates.
   *
   * The horror room needs this and nothing else does: everything it hides from
   * you (the chair that moves, whoever is in the corridor) has to know what is
   * behind your back. Reused rather than rebuilt, once per frame.
   */
  const look = { x: 0, z: 0, dirX: 0, dirZ: -1 }
  const _ahead = new THREE.Vector3()

  function readLook() {
    // The camera and not the head: in a fixed shot the viewer is looking from
    // somewhere else entirely, and a chair that moved in plain sight of the
    // panoramic view would give the whole thing away.
    const eye = context.camera ?? null
    if (eye) {
      _ahead.set(0, 0, -1).applyQuaternion(eye.quaternion)
      const flat = Math.hypot(_ahead.x, _ahead.z) || 1
      look.x = eye.position.x
      look.z = eye.position.z
      look.dirX = _ahead.x / flat
      look.dirZ = _ahead.z / flat
      return look
    }
    const controls = player?.controls
    if (!controls) return null
    look.x = controls.feet.x
    look.z = controls.feet.z
    look.dirX = -Math.sin(controls.yaw)
    look.dirZ = -Math.cos(controls.yaw)
    return look
  }

  function update(delta = 0) {
    const place = places.get(current)

    if (place && place.id !== 'cinema') {
      // The film lights this room the way it lights the hall. The hall's rig
      // keeps doing the sums even while it is hidden (the media module writes
      // to it every frame), so the damped colour is simply read off it here
      // instead of being worked out twice.
      const film = lighting?.getScreenLight?.()
      if (film) place.setScreenLight?.(film.color, film.intensity)
      place.update?.(delta, readLook())
    }

    lightTimer -= delta
    if (lightTimer <= 0) {
      lightTimer = LIGHT_POLL
      const board = lighting?.getSettings?.()
      if (board && (board.house !== lightState.house || board.warmth !== lightState.warmth)) {
        applyLights({ house: board.house, warmth: board.warmth })
      }
    }

    updateDoors()
    if (promptText && performance.now() > flashUntil && !offered) setPrompt('')
  }

  /* ---------------------------------------------------------------------- */

  function dispose() {
    document.removeEventListener('keydown', onKeyDown)
    if (current !== 'cinema') {
      places.get(current)?.exit?.()
      showHall(true)
      collider?.setLayout(null)
      player?.setPlace?.(null)
      const screen = cinema.screen
      if (screen) media?.setScreenMesh?.(screen)
      current = 'cinema'
    }
    horror.dispose()
    cozy.dispose()
    voices.dispose()
    for (const strip of markers.children) strip.geometry.dispose()
    for (const material of markerMaterials) material.dispose()
    markers.removeFromParent()
    veil.remove()
    prompt.remove()
    listeners.clear()
  }

  // Whatever was set last time is set again, but you always open in the hall:
  // the app is a cinema first, and being dropped into somebody's living room on
  // a cold boot would be a jump scare nobody asked for.
  setHorror(settings.horror)
  setFire(settings.fire)
  setTvHorror(settings.tvHorror)
  setTvCozy(settings.tvCozy)
  armExits(cinema)
  applyLights({
    house: lighting?.getSettings?.()?.house ?? 0,
    warmth: lighting?.getSettings?.()?.warmth ?? 0,
  })

  return {
    /** Plain data, safe to render straight into a panel or a menu. */
    list: [cinema, horror, cozy].map((place) => ({
      id: place.id,
      label: place.label,
      description: place.description,
    })),
    get current() {
      return current
    },
    get isBusy() {
      return busy
    },
    /** The place object itself, for anyone who needs the group or the screen. */
    place(id) {
      return places.get(id) ?? null
    },
    go,
    settings,
    VENUE_FIELDS,
    /** Same table under the name the other modules use for theirs. */
    fields: VENUE_FIELDS,
    setHorror,
    setFire,
    setAmbience,
    setTvHorror,
    setTvCozy,
    /** Generic pair, so a panel can drive VENUE_FIELDS without a switch. */
    set(key, value) {
      const apply = setters[key]
      return apply ? apply(value) : settings[key]
    },
    get(key) {
      return settings[key]
    },

    applyLights,
    /** Called when the place changes; returns the unsubscribe function. */
    onChange(fn) {
      if (typeof fn !== 'function') return () => {}
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    update,
    dispose,
  }
}

export { createHorrorVenue } from './horror.js'
export { createCozyVenue } from './cozy.js'
export { createVenueAudio } from './audio.js'

export default createVenues

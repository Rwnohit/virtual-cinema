/**
 * Sound module: everything you hear that is not the film, plus the mixing desk
 * that sits under all of it.
 *
 * `main.js` boots it after the media module so it can share that module's
 * AudioContext - one context for the whole app means one resume, one clock and
 * no drift between the movie and the room around it.
 *
 *   const sound = await createSound({ media, player, container })
 *   sound.click()               // the panel uses these
 *   sound.setVolume(0.5)
 *   sound.setPreset('imax')
 *   sound.setOccupancy(0.8)     // fill the seats
 *
 * The signal flow it owns:
 *
 *   foley  -> mixer.foley ─┐
 *   room tone -> mixer.room┤   (src/venues/ plays its rain and thunder in here)
 *   crowd  -> mixer.crowd ─┼─ master -> limiter -> destination
 *   film   -> mixer.bass ──┤   (below the crossover, mono, straight to master:
 *   film   -> movieOut ────┘    bass has no direction, so it must not go
 *                               through HRTF, and the screen channels give it
 *                               up so it is not in the room twice)
 *
 * The film is panned by the media module from the two sides of the screen, but
 * it now comes OUT through this desk's master rather than straight at the
 * listener, so "Overall volume" moves the film with everything else.
 *
 * Browsers keep audio asleep until the first real gesture, so the whole thing
 * stays silent until the viewer clicks, and then fades the room tone in.
 */

import { createFoley } from './foley.js'
import { createMixer, MIXER_FIELDS, SOUND_PRESETS, DEFAULT_PRESET } from './mixer.js'
import { createCrowd } from './crowd.js'

const STORAGE_KEY = 'vc.sound.volume'
const MIX_STORAGE_KEY = 'vc.sound.mix'
const DEFAULT_VOLUME = 0.7

/** Two footsteps closer than this are the same step; drop the second. */
const MIN_STEP_GAP = 0.13

/** Writing to localStorage on every slider frame is wasteful; coalesce. */
const PERSIST_DELAY = 260

function readStoredVolume() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return DEFAULT_VOLUME
    const value = Number(raw)
    return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : DEFAULT_VOLUME
  } catch {
    return DEFAULT_VOLUME
  }
}

function storeVolume(value) {
  try {
    localStorage.setItem(STORAGE_KEY, String(value))
  } catch {
    /* private mode, never mind */
  }
}

function readStoredMix() {
  try {
    const raw = localStorage.getItem(MIX_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function storeMix(settings) {
  try {
    localStorage.setItem(MIX_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* private mode, never mind */
  }
}

function resolveContext(context) {
  const shared =
    context.media?.listener?.context ??
    context.listener?.context ??
    context.audioContext ??
    null
  if (shared && shared.state !== 'closed') return { context: shared, owned: false }
  const Ctor = window.AudioContext || window.webkitAudioContext
  if (!Ctor) return { context: null, owned: false }
  return { context: new Ctor(), owned: true }
}

/** Nothing to hear, but every call the panel makes still has to work. */
function silentApi() {
  const noop = () => {}
  return {
    mixer: null,
    crowd: null,
    fields: MIXER_FIELDS,
    presets: SOUND_PRESETS,
    click: noop,
    tick: noop,
    clack: noop,
    step: noop,
    seat: noop,
    wake: () => Promise.resolve(),
    volume: 0,
    setVolume: () => 0,
    enabled: false,
    setEnabled: () => false,
    setOccupancy: () => 0,
    setPreset: () => DEFAULT_PRESET,
    set: () => 0,
    getSettings: () => ({ preset: DEFAULT_PRESET, ...SOUND_PRESETS[DEFAULT_PRESET].values }),
    setSettings: (obj) => obj,
    update: noop,
    dispose: noop,
  }
}

/**
 * @param {object} [context] the handle main.js has built so far
 * @param {object} [context.media] the media module, for its AudioContext and film bus
 * @param {object} [context.player] the player module, for its walk events
 * @param {number} [context.volume] 0..1, overrides the stored setting
 */
export function createSound(context = {}) {
  const { context: audio, owned } = resolveContext(context)
  if (!audio) {
    console.warn('[sound] this browser has no Web Audio, the room stays silent')
    return silentApi()
  }

  /* ---------------------------------------------------------------------- */
  /* the desk                                                                */
  /* ---------------------------------------------------------------------- */

  const movieAudio = context.media?.audio ?? null
  const movieNodes = movieAudio?.nodes ?? null
  // lfeSend is the film's own send to the sub. Taking it from a node of its own
  // rather than from the film fader means the desk's bass control lives only on
  // the desk: pulling "Bass" to zero leaves the film exactly as it was, and
  // taking the desk away leaves the film with its bass back. Older builds only
  // expose the fader itself, so fall back to that.
  const movieTap = movieNodes?.lfeSend ?? movieNodes?.movieBus ?? movieNodes?.movieGain ?? null

  const mixer = createMixer({
    context: audio,
    destination: audio.destination,
    movieTap,
    movieFader: movieNodes?.movieTrim ?? null,
    movieOut: movieNodes?.movieOut ?? null,
    movieTone: movieNodes?.movieTone ?? null,
    // Same handle answers for the reverb, the crossover and where the film
    // comes out, because all three belong to the film's own graph.
    film: movieAudio,
    reverb: movieAudio,
  })

  const crowd = createCrowd({ context: audio, destination: mixer.channels.crowd.input })
  mixer.bindCrowd(crowd)

  // Foley runs at unity into its own channel: the balance is the mixer's job
  // now, and the old master volume became the mixer's master.
  const foley = createFoley({
    context: audio,
    volume: 1,
    destination: mixer.channels.foley.input,
    roomDestination: mixer.channels.room.input,
  })

  const stored = readStoredMix()
  if (stored) mixer.setSettings(stored)
  if (context.volume !== undefined) mixer.set('master', context.volume)
  else if (!stored || !Number.isFinite(Number(stored.master))) mixer.set('master', readStoredVolume())

  let enabled = true
  let disposed = false
  let lastStepAt = 0
  let persistTimer = 0
  const unsubscribe = []

  function persist() {
    clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      if (!disposed) storeMix(mixer.getSettings())
    }, PERSIST_DELAY)
  }

  /**
   * Tell an embedded film how loud the desk wants it.
   *
   * YouTube and Vimeo play out of their own iframe, which the audio graph
   * cannot touch, so the two faders that would have caught them - the master
   * and the film - are multiplied here and sent down the media module's own
   * route instead. Without this the desk moved everything in the room except
   * the thing everybody is actually watching.
   */
  const syncEmbed = () => {
    if (typeof context.media?.setEmbedLevel !== 'function') return
    context.media.setEmbedLevel(mixer.get('master') * mixer.get('movie'))
  }

  /**
   * The panel is handed the mixer itself, so every route into it has to save.
   * Object.create keeps the mixer's getters working instead of freezing them
   * the way a spread would.
   */
  const mixerApi = Object.create(mixer)
  mixerApi.set = (key, value) => {
    const applied = mixer.set(key, value)
    syncEmbed()
    persist()
    return applied
  }
  mixerApi.setPreset = (name) => {
    const applied = mixer.setPreset(name)
    syncEmbed()
    persist()
    return applied
  }
  mixerApi.setSettings = (settings) => {
    const applied = mixer.setSettings(settings)
    syncEmbed()
    persist()
    return applied
  }
  mixerApi.setOccupancy = (value) => mixerApi.set('occupancy', value)

  // The desk is already at its stored settings by now, so the film that is put
  // on next starts at the level the viewer left it, not at the embed's own.
  syncEmbed()

  /* ---------------------------------------------------------------------- */
  /* waking the audio up                                                     */
  /* ---------------------------------------------------------------------- */

  function wake() {
    if (disposed) return Promise.resolve()
    const resumed = audio.state === 'suspended' ? audio.resume() : Promise.resolve()
    return resumed
      .then(() => {
        if (disposed || !enabled) return
        foley.startRoomTone()
        if (mixer.get('occupancy') > 0) crowd.start()
      })
      .catch(() => {})
  }

  const onGesture = () => wake()
  for (const type of ['pointerdown', 'keydown']) {
    document.addEventListener(type, onGesture, { passive: true })
    unsubscribe.push(() => document.removeEventListener(type, onGesture))
  }
  wake()

  /* ---------------------------------------------------------------------- */
  /* the player                                                              */
  /* ---------------------------------------------------------------------- */

  const controls = context.player?.controls
  if (controls?.on) {
    unsubscribe.push(
      controls.on('step', (payload = {}) => {
        if (!enabled || document.hidden) return
        const now = audio.currentTime
        if (now - lastStepAt < MIN_STEP_GAP) return
        lastStepAt = now
        foley.step(payload)
      }),
      controls.on('sit', () => enabled && foley.seat({ down: true })),
      controls.on('stand', () => enabled && foley.seat({ down: false })),
      controls.on('lock', () => wake()),
    )
  }

  /* ---------------------------------------------------------------------- */
  /* the film                                                                */
  /* ---------------------------------------------------------------------- */

  if (context.media?.on) {
    unsubscribe.push(
      // A film starting is a gesture we can trust; make sure the bed is running.
      context.media.on('play', () => wake()),
      // A new embed builds a new player at its own default volume, so the desk
      // has to say its number again the moment one lands on the screen.
      context.media.on('loaded', () => syncEmbed()),
    )
  }

  const api = {
    /** The panel calls these, so the whole UI sounds like one object. */
    click: () => enabled && foley.click(),
    tick: (options) => enabled && foley.tick(options),
    clack: (options) => enabled && foley.clack(options),
    step: (options) => enabled && foley.step(options),
    seat: (options) => enabled && foley.seat(options),

    wake,

    /** The desk, for a panel that wants to draw a slider per MIXER_FIELDS. */
    mixer: mixerApi,
    crowd,
    fields: MIXER_FIELDS,
    presets: SOUND_PRESETS,

    /** How full the house is, 0 = empty and silent, 1 = every seat taken. */
    setOccupancy: (value) => mixerApi.set('occupancy', value),
    setPreset: (name) => mixerApi.setPreset(name),
    set: (key, value) => mixerApi.set(key, value),
    getSettings: () => mixer.getSettings(),
    setSettings: (settings) => mixerApi.setSettings(settings),

    get volume() {
      return mixer.get('master')
    },
    setVolume(value) {
      const level = mixerApi.set('master', value)
      storeVolume(level)
      return level
    },

    get enabled() {
      return enabled
    },
    setEnabled(value) {
      enabled = !!value
      if (enabled) wake()
      else {
        foley.stopRoomTone()
        crowd.stop()
      }
      return enabled
    },

    dispose() {
      if (disposed) return
      clearTimeout(persistTimer)
      storeMix(mixer.getSettings())
      disposed = true
      unsubscribe.forEach((off) => typeof off === 'function' && off())
      crowd.dispose()
      foley.dispose()
      setTimeout(() => mixer.dispose(), 700)
      if (owned) setTimeout(() => audio.close().catch(() => {}), 900)
    },
  }

  return api
}

export { createFoley, createMixer, createCrowd, MIXER_FIELDS, SOUND_PRESETS, DEFAULT_PRESET }
export default createSound

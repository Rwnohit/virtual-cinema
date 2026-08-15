/**
 * Room module: the dock, the keys, the right click menu and the ceremony.
 *
 * Everything you can change about the building is behind one bar along the
 * bottom of the screen. With nothing open the picture is completely clear,
 * which is the whole reason this shape was chosen over a tall side panel: you
 * are in a cinema, and the cinema should be what you are looking at.
 *
 * The panel knows almost nothing about what it drives. Each module hands over a
 * table of fields - `{ key, label, min, max, step, format }` - and a getter and
 * setter, and `panel.js` draws sliders for them. Adding a knob somewhere else
 * needs no change here.
 *
 *   const room = await createRoom({ lighting, cinema, media, sound, player })
 *
 * Keys:
 *   L ........ show or hide the dock (releases the mouse if it was locked)
 *   [ / ] .... house lights one notch down / up
 *   right click ... the menu, with everything you reach for most
 */

import { createContextMenu } from './contextMenu.js'
import {
  injectPanelStyle,
  createDock,
  addSlider,
  addToggle,
  addChips,
  addGroupLabel,
  addResetAll,
} from './panel.js'
import { createShowtime, INTERVAL_HOUSE } from './showtime.js'
import { createQueue } from './queue.js'
import { parseTimeInput } from '../media/mediaControls.js'
import { formatTime } from '../media/util.js'
import { t, getLanguage, toggleLanguage, onLanguageChange, LANGUAGES } from '../i18n/index.js'

const STORAGE_KEY = 'vc.room.lights'

/**
 * The three states of a hall, each one a full set of dials.
 *
 * These are not shortcuts, they are the room's positions: the ceremony moves
 * between "Προβολή" and "Διάλειμμα", so whatever is written here is literally
 * what you see when a film starts and when it finishes. Which is why they can
 * be overwritten from the panel: your screening is yours.
 */
const PRESETS = {
  showtime: { label: 'Προβολή', house: 0, screenGain: 1, warmth: 0.3, aisle: 0.3, exit: 0.2, exposure: 1 },
  half: { label: 'Ημίφως', house: 0.22, screenGain: 0.9, warmth: 0.3, aisle: 0.35, exit: 0.45, exposure: 1 },
  interval: { label: 'Διάλειμμα', house: 0.85, screenGain: 0.5, warmth: 0.35, aisle: 0.7, exit: 0.7, exposure: 1 },
}

/** Which of the settings a preset holds. The dials, and nothing else. */
const DIAL_KEYS = ['house', 'screenGain', 'warmth', 'aisle', 'exit', 'exposure']

/** Every light in the hall, in the order they appear on the panel. */
const DIALS = [
  { key: 'house', label: 'Φώτα αίθουσας', format: (v) => `${Math.round(v * 100)}%` },
  { key: 'screenGain', label: 'Λάμψη οθόνης', max: 2, format: (v) => `${Math.round(v * 100)}%` },
  {
    key: 'warmth',
    label: 'Ζεστό ή ψυχρό',
    format: (v) =>
      v < 0.2 ? t('value.warm') : v < 0.45 ? t('value.warmPlus') : v < 0.7 ? t('value.neutral') : t('value.cool'),
  },
  {
    key: 'aisle',
    label: 'Φωτάκια διαδρόμου',
    format: (v) => (v < 0.005 ? t('value.off') : `${Math.round(v * 100)}%`),
  },
  { key: 'exit', label: 'Πινακίδες εξόδου', format: (v) => `${Math.round(v * 100)}%` },
  { key: 'exposure', label: 'Φωτεινότητα εικόνας', min: 0.4, max: 2, format: (v) => `${Math.round(v * 100)}%` },
]

const LIMITS = {
  house: [0, 1],
  screenGain: [0, 2],
  warmth: [0, 1],
  aisle: [0, 1],
  exit: [0, 1],
  exposure: [0.4, 2],
}

const DEFAULTS = { house: 0, screenGain: 1, warmth: 0, aisle: 0, exit: 0.7, exposure: 1, ratio: 'scope' }

const clampTo = (key, value) => {
  const [min, max] = LIMITS[key] ?? [0, 1]
  return Math.min(Math.max(Number(value) || 0, min), max)
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

function store(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* private mode, never mind */
  }
}

/**
 * @param {object} [context] the handle main.js has built so far
 * @param {boolean} [context.panel] set false to keep the keys but drop the UI
 */
export function createRoom(context = {}) {
  const lighting = context.lighting ?? context.scene?.lighting
  if (!lighting || typeof lighting.setHouseLights !== 'function') {
    console.warn('[room] no lighting rig in the context, the light board is off')
    return { update() {}, dispose() {} }
  }

  const sound = context.sound ?? null
  const media = context.media ?? null
  const cinema = context.cinema ?? null
  const player = context.player ?? null
  const venues = context.venues ?? null
  const audience = context.audience ?? null
  const renderer = context.renderer ?? null
  const container = context.container ?? document.getElementById('app') ?? document.body
  const ratios = cinema?.screenRatios ?? {}
  const picture = media?.screen ?? null
  // main.js flattens the scene handle into the context, so `context.scene` is
  // the THREE.Scene itself and the bloom arrives at the top level.
  const postfx = context.postfx ?? null
  const bloomFields = context.bloomFields ?? []

  injectPanelStyle()

  const stored = readStored()
  const settings = {}
  for (const key of Object.keys(LIMITS)) settings[key] = clampTo(key, stored?.[key] ?? DEFAULTS[key])
  settings.ratio = ratios[stored?.ratio] ? stored.ratio : cinema?.screenRatio ?? DEFAULTS.ratio
  settings.ceremony = stored?.ceremony !== false
  settings.effects = stored?.effects !== false
  // Off unless it was asked for. YouTube decides on its own to burn subtitles
  // over a film, and in a room whose whole point is the picture that is a
  // decision the viewer should be making.
  settings.captions = stored?.captions === true
  media?.setCaptions?.(settings.captions)

  /** The three positions of the room, with whatever the viewer saved over them. */
  const presets = {}
  for (const [key, preset] of Object.entries(PRESETS)) {
    presets[key] = { ...preset }
    for (const dial of DIAL_KEYS) {
      const saved = stored?.presets?.[key]?.[dial]
      if (Number.isFinite(saved)) presets[key][dial] = clampTo(dial, saved)
    }
  }
  settings.presets = presets

  const refreshers = []
  /** Rows of the page being built, so each page gets its own reset button. */
  let pageRows = []
  const trackRow = (row) => {
    refreshers.push(row.refresh)
    pageRows.push(row)
    return row
  }
  /** Close off a page with its own reset button, and start counting again. */
  const finishPage = (page) => {
    if (page && pageRows.length) addResetAll(page, [...pageRows], () => refreshAll())
    pageRows = []
  }
  const refreshAll = () => {
    for (const fn of refreshers) {
      try {
        fn()
      } catch {
        /* a panel row that lost its module is not worth a crash */
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* applying                                                                */
  /* ---------------------------------------------------------------------- */

  function applyLights({ immediate = false, quiet = false } = {}) {
    lighting.setHouseLights(settings.house, { immediate })
    lighting.setScreenGain?.(settings.screenGain)
    lighting.setWarmth?.(settings.warmth)
    lighting.setAisleLights?.(settings.aisle)
    lighting.setExitLights?.(settings.exit)
    // The fittings themselves dim with the light they throw, so a strip never
    // glows on a wall that is otherwise pitch black.
    cinema?.setTrimBrightness?.('aisle', 0.45 + settings.aisle * 0.9)
    cinema?.setTrimBrightness?.('exit', 0.35 + settings.exit * 1.1)
    cinema?.setTrimBrightness?.('cove', 0.3 + settings.house * 1.3)
    cinema?.setTrimBrightness?.('ceiling', 0.3 + settings.house * 1.3)
    if (renderer) renderer.toneMappingExposure = 1.15 * settings.exposure
    // A ramp calls this sixty times a second, and writing to localStorage sixty
    // times a second is how you make a smooth fade stutter. `quiet` is also
    // what keeps the ceremony's own ramp off the network: see getStage().
    if (!quiet) {
      persist()
      stageChanged()
    }
  }

  /* --- moving the room, slowly -------------------------------------------- */

  let rampFrame = null

  function cancelRamp() {
    if (rampFrame === null) return
    cancelAnimationFrame(rampFrame)
    rampFrame = null
  }

  /**
   * Walk every dial to a new position over `ms`.
   *
   * The lighting rig has its own little ramp for the house lights, but only for
   * those, and the ceremony needs the aisle strips, the exit signs and the
   * warmth to arrive together. So the interpolation happens here and the rig is
   * driven at `immediate`, which is a fancy way of saying we are the fade.
   */
  function rampLights(target, ms = 0) {
    cancelRamp()
    const keys = DIAL_KEYS.filter((key) => Number.isFinite(target?.[key]))
    if (!keys.length) return

    const land = () => {
      for (const key of keys) settings[key] = clampTo(key, target[key])
      applyLights({ immediate: true })
      refreshAll()
    }

    if (!(ms > 0) || typeof requestAnimationFrame !== 'function') {
      land()
      return
    }

    const from = {}
    for (const key of keys) from[key] = settings[key]
    const start = performance.now()

    const step = (now) => {
      const k = Math.min(1, (now - start) / ms)
      // Smoothstep: a dimmer that starts and stops gently, like a real one.
      const eased = k * k * (3 - 2 * k)
      for (const key of keys) settings[key] = clampTo(key, from[key] + (target[key] - from[key]) * eased)
      applyLights({ immediate: true, quiet: k < 1 })
      refreshAll()
      rampFrame = k < 1 ? requestAnimationFrame(step) : null
    }
    rampFrame = requestAnimationFrame(step)
  }

  /** Put the room in one of its three positions. */
  function applyPreset(key, { ms = 700, quiet = false } = {}) {
    const preset = presets[key]
    if (!preset) return false
    rampLights(preset, ms)
    if (!quiet) {
      sound?.clack?.({ on: preset.house > 0 })
      flash(t(`preset.${key}`))
    }
    return true
  }

  /** And the other way round: this room, as it stands, is now that position. */
  function savePreset(key) {
    const preset = presets[key]
    if (!preset) return false
    for (const dial of DIAL_KEYS) preset[dial] = settings[dial]
    persist()
    return true
  }

  function persist() {
    store({
      ...settings,
      picture: picture?.getPicture?.() ?? undefined,
      bloom: postfx?.getBloom?.() ?? undefined,
      quality: media?.quality ?? undefined,
    })
  }

  /* ---------------------------------------------------------------------- */
  /* the stage: the part of the room that belongs to everybody in it         */
  /* ---------------------------------------------------------------------- */

  /**
   * A hall is one room, so the things that ARE the room are shared: the
   * curtain, the house lights, how full the seats are, the shape of the
   * screen. Open the curtain and it opens for everyone, because there is only
   * one curtain.
   *
   * What stays yours is what only you can hear or see from where you sit: the
   * sound desk, the picture grade, the language, the quality of your own
   * stream. Sharing those would mean one person's headphones deciding what
   * everybody else's speakers do.
   *
   * The ceremony is deliberately NOT in here. It moves the lights sixty times
   * a second, and it does not need to be sent: every browser runs it off the
   * film's own state, which is already shared, so they arrive at the same
   * place on their own.
   */
  const STAGE_KEYS = ['house', 'screenGain', 'warmth', 'aisle', 'exit', 'exposure']
  const stageListeners = new Set()
  /** True while we are applying somebody else's change, so it is not sent back. */
  let applyingStage = false
  let stageTimer = null

  function getStage() {
    const values = { ratio: settings.ratio }
    for (const key of STAGE_KEYS) values[key] = settings[key]
    if (cinema && Number.isFinite(cinema.curtains)) values.curtains = cinema.curtains
    if (audience && Number.isFinite(audience.share)) values.audience = audience.share
    return values
  }

  /**
   * Say what changed, once the hand has come off the slider.
   *
   * Debounced because a drag is a hundred events and the hall needs the value
   * the viewer stopped on, not the ninety nine on the way there.
   */
  function stageChanged() {
    if (applyingStage) return
    clearTimeout(stageTimer)
    stageTimer = setTimeout(() => {
      const values = getStage()
      for (const fn of stageListeners) {
        try {
          fn(values)
        } catch {
          /* one listener must not stop the rest */
        }
      }
    }, 180)
  }

  /**
   * Somebody else moved something. Applied quietly: no clacks, no captions,
   * and above all no telling the hall what it just told us.
   */
  function applyStage(values) {
    if (!values || typeof values !== 'object') return
    applyingStage = true
    try {
      let lights = false
      for (const key of STAGE_KEYS) {
        if (!Number.isFinite(values[key])) continue
        const next = clampTo(key, values[key])
        if (Math.abs(next - settings[key]) < 0.005) continue
        settings[key] = next
        lights = true
      }
      if (lights) applyLights({ quiet: true })

      if (Number.isFinite(values.curtains) && cinema?.setCurtains) {
        if (Math.abs(values.curtains - cinema.curtains) > 0.02) {
          settings.curtains = values.curtains
          cinema.setCurtains(values.curtains)
        }
      }
      if (Number.isFinite(values.audience) && audience?.setCount) {
        if (Math.abs(values.audience - audience.share) > 0.01) audience.setCount(values.audience)
      }
      if (typeof values.ratio === 'string' && ratios[values.ratio] && values.ratio !== settings.ratio) {
        applyRatio(values.ratio, { quiet: true })
      }
      refreshAll()
    } finally {
      applyingStage = false
    }
  }

  function applyRatio(name, { quiet = false } = {}) {
    if (!ratios[name]) return null
    settings.ratio = name
    const size = media?.setScreenRatio?.(name) ?? cinema?.setScreenRatio?.(name) ?? null
    persist()
    if (!quiet) {
      sound?.clack?.({ on: true })
      flash(`${ratios[name].label} · ${ratios[name].note}`)
      stageChanged()
    }
    refreshAll()
    return size
  }

  // Anything the viewer graded or glowed last time comes back with them.
  if (stored?.picture && picture?.setPicture) picture.setPicture(stored.picture)
  if (stored?.bloom && postfx?.setBloom) postfx.setBloom(stored.bloom)
  if (Number.isFinite(stored?.curtains) && cinema?.setCurtains) {
    settings.curtains = stored.curtains
    cinema.setCurtains(stored.curtains, { immediate: true })
  }
  if (Number.isFinite(stored?.quality) && media?.setQuality) {
    settings.quality = stored.quality
    media.setQuality(stored.quality)
  }

  /* ---------------------------------------------------------------------- */
  /* the dock                                                                */
  /* ---------------------------------------------------------------------- */

  const dock = createDock({ container, sound })
  if (context.panel === false) dock.setVisible(false)

  const readout = document.createElement('div')
  readout.className = 'rp-readout'
  container.appendChild(readout)

  /**
   * The one line that stays up.
   *
   * `flash()` is for things you can miss without losing anything - a preset
   * name, the house lights. This is for the opposite: a film only you can see,
   * in a room with other people in it. It sits there until it stops being
   * true, and it can be dismissed, because a warning you cannot close becomes
   * furniture.
   */
  const notice = document.createElement('div')
  notice.className = 'rp-notice'
  notice.innerHTML = '<span data-role="text"></span><button type="button" aria-label="OK">×</button>'
  notice.querySelector('button').addEventListener('click', () => notice.classList.remove('is-on'))
  container.appendChild(notice)

  function setNotice(html) {
    if (!html) {
      notice.classList.remove('is-on')
      return
    }
    notice.querySelector('[data-role="text"]').innerHTML = html
    notice.classList.add('is-on')
  }

  /** Short lived caption, so the keys mean something with the dock hidden. */
  let readoutTimer = null
  function flash(message) {
    if (!message) return
    readout.textContent = message
    readout.classList.add('is-on')
    clearTimeout(readoutTimer)
    readoutTimer = setTimeout(() => readout.classList.remove('is-on'), 1600)
  }

  // One tick per notch of a slider, not one per pixel of mouse travel.
  const lastTick = new Map()
  function tick(key, value) {
    const step = Math.round(value * 12)
    if (lastTick.get(key) === step) return
    lastTick.set(key, step)
    sound?.tick?.()
  }

  /* --- the two things that must outlive a language change ----------------- */
  // Both wrap the media module or hold timers, so they are built once. Only the
  // panel is thrown away and redrawn when the language changes.
  const showtime = media
    ? createShowtime({
        media,
        lighting,
        cinema,
        sound,
        enabled: settings.ceremony,
        // The ceremony does not know what a "light" is. It knows the room has a
        // screening position and an interval position, and asks for one or the
        // other. Both are the viewer's own, saved from the panel.
        toShow: (ms) => rampLights(presets.showtime, ms),
        toHouse: (ms) => rampLights(presets.interval, ms),
        onState: (state, label) => {
          flash(label)
          refreshAll()
        },
      })
    : null

  const queue = media ? createQueue({ media, showtime, onChange: () => refreshQueue() }) : null

  // Registered once, not inside buildUI: walking through a door rebuilds the
  // panel, and a listener added on every rebuild would pile up.
  const offVenue = venues?.onChange?.(({ label }) => {
    buildUI()
    refreshAll()
    refreshTransport()
    flash(label)
  })

  /* --- the transport, which never moves ---------------------------------- */
  let seeking = false
  let playButton = null
  let timeInput = null
  let track = null
  let duration = null
  let queueList = null
  let volIcon = null
  /**
   * The other way to watch together: one screen, sent to everybody.
   *
   * Handed in by main.js after the network module is up, because this module
   * is built before it. Until then the button simply is not there - a control
   * that might not work is worse than one that is missing.
   */
  let screenShare = null
  let shareButton = null

  function refreshShare() {
    if (!shareButton) return
    const can = !!screenShare?.supported()
    shareButton.hidden = !can
    if (!can) return
    const sharing = !!screenShare.sharing
    shareButton.classList.toggle('is-on', sharing)
    shareButton.title = t(sharing ? 'dock.shareStop' : 'dock.share')
    shareButton.setAttribute('aria-label', shareButton.title)
    shareButton.querySelector('.ic').textContent = sharing ? '⏹' : '📡'
  }

  function toggleShare() {
    if (!screenShare) return
    if (screenShare.sharing) {
      screenShare.stop()
      flash(t('flash.shareOff'))
      refreshShare()
      return
    }
    // Straight from the click: the browser will not open its picker without a
    // live user gesture.
    screenShare
      .start()
      .then(() => {
        flash(t('flash.shareOn'))
        refreshShare()
      })
      .catch((err) => {
        flash(t(err?.reason === 'no-video' ? 'flash.shareNoVideo' : 'flash.shareCancelled'))
        refreshShare()
      })
  }
  let volBefore = sound?.volume ?? 1
  let quality = null

  function buildUI() {
    refreshers.length = 0
    dock.reset()
    buildTransport()
    buildPages()
  }

  function buildTransport() {
  if (media) {
    playButton = document.createElement('button')
    playButton.type = 'button'
    playButton.className = 'rp-dbtn rp-play'
    playButton.textContent = '▶'
    playButton.setAttribute('aria-label', t('dock.play'))
    playButton.addEventListener('click', () => media.toggle())
    dock.addToBar(playButton)

    const transport = document.createElement('div')
    transport.className = 'rp-time'
    transport.innerHTML = `
      <input type="text" data-role="at" value="0:00" aria-label="${t('dock.time')}" spellcheck="false">
      <input type="range" class="rp-range rp-track" data-role="track" min="0" max="1000" value="0" aria-label="${t('dock.seek')}">
      <span class="dur" data-role="dur">0:00</span>
    `
    dock.addToBar(transport)
    timeInput = transport.querySelector('[data-role="at"]')
    track = transport.querySelector('[data-role="track"]')
    duration = transport.querySelector('[data-role="dur"]')

    // Type a moment and go there. Sloppy input is fine: 1:21:4, 81:04, 4861.
    timeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        const seconds = parseTimeInput(timeInput.value)
        if (seconds === null) {
          flash(t('dock.badTime'))
          return
        }
        const total = media.duration
        media.seek(Number.isFinite(total) && total > 0 ? Math.min(seconds, total) : seconds)
        timeInput.blur()
      } else if (event.key === 'Escape') {
        timeInput.blur()
      }
    })
    timeInput.addEventListener('focus', () => timeInput.select())

    track.addEventListener('pointerdown', () => {
      seeking = true
    })
    const endSeek = () => {
      if (!seeking) return
      seeking = false
      const total = media.duration
      if (Number.isFinite(total) && total > 0) media.seek((Number(track.value) / 1000) * total)
    }
    track.addEventListener('pointerup', endSeek)
    track.addEventListener('change', endSeek)

    // Volume, right where the film is. How loud it is playing is not a setting,
    // it is part of playing, so it sits on the bar next to the time. Everything
    // that shapes the sound stays behind the "Ήχος" button.
    if (sound) {
      const vol = document.createElement('div')
      vol.className = 'rp-vol'
      vol.innerHTML = `
        <button type="button" class="rp-dbtn" data-role="mute" aria-label="${t('dock.volume')}"><span class="ic">🔊</span></button>
        <button type="button" class="rp-dbtn" data-role="share" title="${t('dock.share')}" aria-label="${t('dock.share')}" hidden><span class="ic">📡</span></button>
        <button type="button" class="rp-dbtn" data-role="clean" title="${t('dock.clean')}" aria-label="${t('dock.clean')}"><span class="ic">🎬</span></button>
      `
      dock.addToBar(vol)
      shareButton = vol.querySelector('[data-role="share"]')
      shareButton.addEventListener('click', () => {
        sound.click?.()
        toggleShare()
      })
      refreshShare()
      volIcon = vol.querySelector('[data-role="mute"] .ic')
      // The speaker is a mute, and a mute has to remember where you were.
      vol.querySelector('[data-role="mute"]').addEventListener('click', () => {
        const level = sound.volume ?? 0
        if (level > 0.001) {
          volBefore = level
          sound.setVolume(0)
        } else {
          sound.setVolume(volBefore || 0.8)
        }
        refreshVolume()
        sound.click?.()
      })
      // Where the volume slider used to unroll. It was asked for by name: the
      // level itself is one row down under "Ήχος", and the thing you actually
      // reach for on the bar mid film is "take all of this away".
      vol.querySelector('[data-role="clean"]').addEventListener('click', () => {
        sound.click?.()
        setCleanScreen(true)
      })
      refreshers.push(refreshVolume)
    }

    // The quality buttons belong to YouTube and to nothing else, so they are on
    // the bar only while a YouTube film is on the screen.
    if (media.qualitySteps?.length) {
      quality = document.createElement('div')
      quality.className = 'rp-qual'
      for (const step of media.qualitySteps) {
        const button = document.createElement('button')
        button.type = 'button'
        button.dataset.key = step.key
        button.textContent = step.key === 'auto' ? t('quality.auto') : step.label
        button.title = t('dock.quality')
        button.addEventListener('click', () => {
          media.setQualityStep(step.key)
          settings.quality = media.quality
          persist()
          refreshTransport()
          sound?.click?.()
        })
        quality.appendChild(button)
      }
      dock.addToBar(quality)
    }

    dock.separator()
  }
  }

  /** The speaker icon says how loud the room is, without a number. */
  function refreshVolume() {
    if (!volIcon || !sound) return
    const level = sound.volume ?? 0
    volIcon.textContent = level < 0.005 ? '🔇' : level < 0.45 ? '🔈' : '🔊'
  }

  function refreshTransport() {
    if (!media || !playButton) return
    const playing = media.isPlaying
    playButton.textContent = playing ? '❚❚' : '▶'
    playButton.setAttribute('aria-label', playing ? t('dock.pause') : t('dock.play'))
    const at = media.currentTime
    const total = media.duration
    if (document.activeElement !== timeInput) timeInput.value = formatTime(at)
    duration.textContent = formatTime(total)
    if (!seeking && Number.isFinite(total) && total > 0) {
      track.value = String(Math.round((at / total) * 1000))
    }
    if (quality) {
      const onYoutube = media.embedKind === 'youtube'
      quality.classList.toggle('is-on', onYoutube)
      if (onYoutube) {
        for (const button of quality.children) {
          button.classList.toggle('is-on', button.dataset.key === media.qualityStep)
        }
      }
    }
  }

  function buildPages() {
  /**
   * Which room the panel is describing.
   *
   * A cinema has curtains, a screen format and 144 seats; a living room has a
   * television and a fireplace. Showing all of it everywhere was the fastest
   * way to make the panel feel like someone else's control room, so each place
   * only draws its own, and the whole thing is redrawn when you walk through a
   * door.
   */
  const place = venues?.current ?? 'cinema'
  const inCinema = place === 'cinema'
  /** Venue dials are named after the room they belong to. */
  const venueKeys = { horror: ['horror', 'ambience', 'tvHorror'], cozy: ['fire', 'ambience', 'tvCozy'] }
  const myVenueKeys = venueKeys[place] ?? []
  /* --- Χώρος -------------------------------------------------------------- */
  const placePage = dock.addPage({ id: 'venue', label: t('dock.venue'), icon: '🏛' })

  if (venues?.list?.length) {
    const chips = addChips(
      placePage,
      venues.list.map((venue) => ({ key: venue.id, label: venue.label })),
      (key) => venues.current === key,
      (key) => {
        if (venues.isBusy) return
        venues.go(key)
        sound?.clack?.({ on: true })
      },
      { kind: 'venue' },
    )
    trackRow(chips)

    for (const field of venues.fields ?? []) {
      if (!myVenueKeys.includes(field.key)) continue
      const row = addSlider(placePage, field, () => venues.get(field.key), (value) => venues.set(field.key, value), {
        onInput: (value) => tick(field.key, value),
      })
      trackRow(row)
    }

  }

  finishPage(placePage)

  /* --- Οθόνη -------------------------------------------------------------- */
  const screenPage = dock.addPage({ id: 'screen', label: t('dock.screen'), icon: '🖥' })

  if (inCinema && cinema?.curtainFields?.length) {
    addGroupLabel(screenPage, t('group.curtains'))
    // Two buttons and a slider, not just a slider: "open them" and "close them"
    // are the only two things anyone actually wants, and hunting for the end of
    // a slider to do either of them is work.
    const curtainChips = addChips(
      screenPage,
      [
        { key: 'open', label: t('curtain.open') },
        { key: 'closed', label: t('curtain.closed') },
      ],
      (key) => (key === 'open' ? cinema.curtains < 0.5 : cinema.curtains >= 0.5),
      (key) => {
        const value = key === 'open' ? 0 : 1
        cinema.setCurtains(value)
        settings.curtains = value
        persist()
        stageChanged()
        refreshAll()
        sound?.clack?.({ on: key === 'closed' })
      },
    )
    trackRow(curtainChips)

    for (const field of cinema.curtainFields) {
      const row = addSlider(
        screenPage,
        field,
        () => cinema.curtains,
        (value) => {
          cinema.setCurtains(value)
          settings.curtains = value
          persist()
          stageChanged()
        },
        { onInput: (value) => tick(field.key, value) },
      )
      trackRow(row)
    }
  }

  if (inCinema && Object.keys(ratios).length) {
    addGroupLabel(screenPage, t('menu.screenSize'))
    const ratioChips = addChips(
      screenPage,
      Object.entries(ratios).map(([key, entry]) => ({ key, label: entry.label, note: entry.note })),
      (key) => key === settings.ratio,
      (key) => applyRatio(key),
      { kind: 'ratio' },
    )
    trackRow(ratioChips)
  }

  // Quality is not here any more: it is a YouTube thing, so it lives on the bar
  // and only while a YouTube film is playing. Subtitles are the same kind of
  // thing but they are not a per-film choice, so they stay a setting.
  if (media?.setCaptions) {
    addGroupLabel(screenPage, t('group.subtitles'))
    const captionRow = addToggle(
      screenPage,
      t('toggle.captions'),
      () => settings.captions,
      (on) => {
        settings.captions = media.setCaptions(on)
        persist()
        sound?.click?.()
        flash(t(settings.captions ? 'flash.captionsOn' : 'flash.captionsOff'))
      },
      { home: false },
    )
    trackRow(captionRow)
  }

  if (picture?.pictureFields?.length) {
    addGroupLabel(screenPage, t('group.picture'))
    if (picture.picturePresets?.length) {
      const chips = addChips(
        screenPage,
        picture.picturePresets.map((p) => ({ key: p.key, label: p.label })),
        () => false,
        (key) => {
          picture.setPicturePreset(key)
          persist()
          refreshAll()
          sound?.click?.()
        },
        { kind: 'picture' },
      )
      trackRow(chips)
    }

    const grid = document.createElement('div')
    grid.className = 'rp-cols'
    screenPage.appendChild(grid)

    for (const field of picture.pictureFields) {
      const row = addSlider(
        grid,
        { ...field, format: field.format ?? 'x' },
        () => picture.getPicture()[field.key],
        (value) => {
          picture.setPicture({ [field.key]: value })
          persist()
        },
        { onInput: (value) => tick(field.key, value) },
      )
      trackRow(row)
    }

    if (postfx?.getBloom && bloomFields.length) {
      addGroupLabel(screenPage, t('group.bloom'))
      const glow = document.createElement('div')
      glow.className = 'rp-cols'
      screenPage.appendChild(glow)
      for (const field of bloomFields) {
        if (field.type === 'toggle' || field.key === 'enabled') {
          const row = addToggle(glow, t(`field.${field.key}`), () => postfx.getBloom().enabled, (on) => {
            postfx.setBloom({ enabled: on })
            persist()
          })
          trackRow(row)
          continue
        }
        const row = addSlider(
          glow,
          { ...field, format: field.format ?? 'x' },
          () => postfx.getBloom()[field.key],
          (value) => {
            postfx.setBloom({ [field.key]: value })
            persist()
          },
          { onInput: (value) => tick(field.key, value) },
        )
        trackRow(row)
      }
    }
  }

  finishPage(screenPage)

  /* --- Φώτα --------------------------------------------------------------- */
  const lightPage = dock.addPage({ id: 'lights', label: t('dock.lights'), icon: '💡' })

  const CINEMA_ONLY_DIALS = ['aisle', 'exit']
  const presetChips = addChips(
    lightPage,
    Object.entries(presets).map(([key, preset]) => ({ key, label: preset.label })),
    (key) => DIAL_KEYS.every((dial) => Math.abs(presets[key][dial] - settings[dial]) < 0.02),
    (key) => applyPreset(key),
    { kind: 'preset' },
  )
  trackRow(presetChips)

  const lightGrid = document.createElement('div')
  lightGrid.className = 'rp-cols'
  lightPage.appendChild(lightGrid)
  for (const dial of DIALS) {
    if (dial.key === 'exposure' && !renderer) continue
    if (!inCinema && CINEMA_ONLY_DIALS.includes(dial.key)) continue
    const row = addSlider(
      lightGrid,
      { min: 0, max: 1, step: 0.01, ...dial },
      () => settings[dial.key],
      (value) => {
        // A hand on a slider always wins over a fade in progress.
        cancelRamp()
        settings[dial.key] = clampTo(dial.key, value)
        applyLights()
      },
      { onInput: (value) => tick(dial.key, value) },
    )
    trackRow(row)
  }

  // The room as it stands can become any of the three positions, which is how
  // "these are the lights I want for a screening" is said in one click.
  addGroupLabel(lightPage, t('group.saveLights'))
  const saveChips = addChips(
    lightPage,
    Object.entries(presets).map(([key, preset]) => ({ key, label: preset.label })),
    () => false,
    (key) => {
      savePreset(key)
      refreshAll()
      sound?.click?.()
      flash(`${t('flash.savedLights')} · ${t(`preset.${key}`)}`)
    },
    { kind: 'preset' },
  )
  trackRow(saveChips)

  if (inCinema && showtime) {
    addGroupLabel(lightPage, t('group.show'))
    const row = addToggle(
      lightPage,
      t('toggle.ceremony'),
      () => showtime.enabled,
      (on) => {
        showtime.enabled = on
        settings.ceremony = on
        persist()
        sound?.click?.()
      },
    )
    trackRow(row)

    const skip = document.createElement('div')
    skip.className = 'rp-row'
    skip.innerHTML = `<button type="button" class="rp-btn rp-tiny">${t('btn.startNow')}</button>`
    lightPage.appendChild(skip)
    skip.querySelector('button').addEventListener('click', () => showtime.skip())
  }

  finishPage(lightPage)

  /* --- Ήχος --------------------------------------------------------------- */
  if (sound) {
    const audioPage = dock.addPage({ id: 'sound', label: t('dock.sound'), icon: '🔊' })

    /**
     * How much of the room a YouTube film is allowed to feel.
     *
     * The rest of the desk cannot reach it: their player is in an iframe, so
     * there is no reverb on it and no sub under it, and that is measured, not
     * assumed (see the note in media/index.js). Distance and which way you are
     * facing DO reach it, through the one number their API answers to, and
     * this is how much of that to apply: 0 leaves the film flat wherever you
     * stand, 1 moves it as far as the room says.
     */
    if (media?.embedFields?.length) {
      addGroupLabel(audioPage, t('group.embedRoom'))
      for (const field of media.embedFields) {
        const row = addSlider(
          audioPage,
          field,
          () => media.embedRoomAmount,
          (value) => media.setEmbedRoomAmount(value),
          { onInput: (value) => tick(field.key, value) },
        )
        trackRow(row)
      }
      const hint = document.createElement('div')
      hint.className = 'rp-hint'
      hint.textContent = t('hint.embedRoom')
      audioPage.appendChild(hint)
    }

    // One switch for everything the building makes: footsteps, seats, the
    // crowd, the room itself. Off and on, to hear what it is worth.
    const effectsRow = addToggle(
      audioPage,
      t('toggle.effects'),
      () => sound.enabled,
      (on) => {
        sound.setEnabled(on)
        settings.effects = on
        persist()
        if (on) sound.click?.()
        flash(t(on ? 'flash.effectsOn' : 'flash.effectsOff'))
      },
    )
    trackRow(effectsRow)

    if (sound.presets) {
      const chips = addChips(
        audioPage,
        Object.entries(sound.presets).map(([key, preset]) => ({ key, label: preset.label ?? key })),
        (key) => sound.mixer?.preset === key,
        (key) => {
          sound.setPreset(key)
          refreshAll()
          sound.clack?.({ on: true })
          flash(t(`sound.${key}`))
        },
        { kind: 'sound' },
      )
      trackRow(chips)
    }

    let lastGroup = null
    let grid = null
    for (const field of sound.fields ?? []) {
      if (field.group && field.group !== lastGroup) {
        lastGroup = field.group
        addGroupLabel(audioPage, t(`sgroup.${field.group}`))
        grid = document.createElement('div')
        grid.className = 'rp-cols'
        audioPage.appendChild(grid)
      }
      const row = addSlider(grid ?? audioPage, field, () => sound.mixer?.get(field.key) ?? 0, (value) => sound.set(field.key, value), {
        onInput: (value) => tick(field.key, value),
      })
      trackRow(row)
    }

    finishPage(audioPage)

    const test = document.createElement('div')
    test.className = 'rp-row'
    test.innerHTML = `<button type="button" class="rp-btn rp-tiny">${t('btn.testSounds')}</button>`
    audioPage.appendChild(test)
    test.querySelector('button').addEventListener('click', () => {
      sound.step({ foot: 'left' })
      setTimeout(() => sound.step({ foot: 'right' }), 340)
      setTimeout(() => sound.seat({ down: true }), 780)
      setTimeout(() => sound.clack({ on: true }), 1350)
      flash(t('flash.soundTest'))
    })
  }

  /* --- Θέα ---------------------------------------------------------------- */
  const viewPage = dock.addPage({ id: 'view', label: t('dock.view'), icon: '👁' })

  if (player?.views?.list?.length) {
    // Read live: each place has its own shots, so this row rebuilds itself.
    const viewChips = addChips(
      viewPage,
      () => player.views.list.map((view) => ({ key: view.id, label: view.label })),
      (key) => player.views.current === key,
      (key) => {
        player.views.set(key)
        refreshAll()
        sound?.click?.()
      },
      { kind: 'view' },
    )
    trackRow(viewChips)

    const cine = addToggle(viewPage, t('toggle.cinematic'), () => player.isCinematic, (on) => {
      player.setCinematic(on)
      sound?.click?.()
    })
    trackRow(cine)
  }

  if (context.update) {
    addGroupLabel(viewPage, t('group.version'))
    const foot = document.createElement('div')
    foot.className = 'rp-row'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'rp-btn rp-tiny'
    button.textContent = `${t('btn.whatsNew')} · v${context.update.version}`
    button.addEventListener('click', () => {
      sound?.click?.()
      context.update.showChangelog()
    })
    foot.appendChild(button)
    viewPage.appendChild(foot)
  }


  if (inCinema && audience?.fields?.length) {
    addGroupLabel(viewPage, t('group.audience'))
    for (const field of audience.fields) {
      const row = addSlider(
        viewPage,
        { ...field, format: (v) => `${Math.round(v * (audience.max || 0))} ${t('value.people')}` },
        () => audience.share,
        (value) => {
          audience.setCount(value)
          stageChanged()
          refreshAll()
        },
        { onInput: (value) => tick('audience', value) },
      )
      trackRow(row)
    }
  }

  addGroupLabel(viewPage, t('group.language'))
  const langRow = addChips(
    viewPage,
    Object.values(LANGUAGES).map((entry) => ({ key: entry.code, label: entry.label })),
    (key) => getLanguage() === key,
    (key) => {
      if (key !== getLanguage()) toggleLanguage()
    },
  )
  trackRow(langRow)

  const hint = document.createElement('div')
  hint.className = 'rp-hint'
  hint.textContent = t('hint.keys')
  viewPage.appendChild(hint)

  pageRows = []

  /* --- Ουρά --------------------------------------------------------------- */
  if (queue) {
    const queuePage = dock.addPage({ id: 'queue', label: t('dock.queue'), icon: '📼' })

    // The interval usually ends when you say it ends. The timer is the rare
    // case, so it is the one you switch on, and the gap only matters then.
    const autoRow = addToggle(
      queuePage,
      t('queue.auto'),
      () => queue.auto,
      (on) => {
        queue.auto = on
        refreshQueue()
        sound?.click?.()
      },
      { home: false },
    )
    trackRow(autoRow)

    for (const field of queue.fields) {
      const row = addSlider(queuePage, field, () => queue.gap, (value) => queue.set('gap', value), {
        onInput: (value) => tick('gap', value / 300),
      })
      trackRow(row)
    }

    addGroupLabel(queuePage, t('group.next'))
    queueList = document.createElement('div')
    queueList.className = 'rp-queue'
    queuePage.appendChild(queueList)

    const actions = document.createElement('div')
    actions.className = 'rp-row'
    actions.innerHTML = `
      <button type="button" class="rp-btn" data-role="skip">${t('queue.next')}</button>
      <button type="button" class="rp-btn rp-tiny" data-role="clear">${t('btn.clearQueue')}</button>
    `
    queuePage.appendChild(actions)
    actions.querySelector('[data-role="skip"]').addEventListener('click', () => {
      sound?.click?.()
      queue.skip()
    })
    actions.querySelector('[data-role="clear"]').addEventListener('click', () => {
      sound?.click?.()
      queue.clear()
    })
    refreshers.push(refreshQueue)
    refreshQueue()
  }
  }

  /**
   * The list of what is coming, redrawn whenever the queue changes. Kept out of
   * the generic slider machinery because a list of films is not a value.
   */
  function refreshQueue() {
    if (!queueList || !queue) return
    queueList.innerHTML = ''
    if (!queue.items.length) {
      const empty = document.createElement('div')
      empty.className = 'rp-hint'
      empty.textContent = t('queue.empty')
      queueList.appendChild(empty)
      return
    }
    queue.items.forEach((item, index) => {
      const row = document.createElement('div')
      row.className = 'rp-qrow'
      const waiting = index === 0 && queue.countdown > 0
      row.innerHTML = `
        <span class="rp-qnum">${index + 1}</span>
        <span class="rp-qname"></span>
        <span class="rp-qwait">${waiting ? `${t('queue.waiting')} ${queue.countdown}${t('queue.seconds')}` : ''}</span>
        <button type="button" class="rp-btn rp-tiny" data-role="now">▶</button>
        <button type="button" class="rp-btn rp-tiny" data-role="drop">×</button>
      `
      row.querySelector('.rp-qname').textContent = item.label
      row.querySelector('[data-role="now"]').title = t('queue.playNow')
      row.querySelector('[data-role="now"]').addEventListener('click', () => queue.playAt(item.id))
      row.querySelector('[data-role="drop"]').title = t('btn.remove')
      row.querySelector('[data-role="drop"]').addEventListener('click', () => queue.remove(item.id))
      queueList.appendChild(row)
    })
  }

  /* ---------------------------------------------------------------------- */
  /* keys                                                                    */
  /* ---------------------------------------------------------------------- */

  let manuallyHidden = false
  let clean = false

  function setPanelVisible(visible) {
    manuallyHidden = !visible
    dock.setVisible(visible)
    if (!visible) dock.hide()
  }

  /**
   * Clean screen: the film, and nothing else on top of it.
   *
   * Hiding the bar was never the same as clearing the screen - the key list,
   * the sight in the middle, the "1 in the room" pill and the open-a-film
   * button all stayed - so this takes the lot, in one press, whatever else is
   * showing. The way back is the same L that has always meant "the desk", plus
   * Escape, and the room says so on its way out: a control you cannot undo is
   * a trap, and the button that turned it on is one of the things it hides.
   *
   * @param {boolean} on
   */
  function setCleanScreen(on) {
    clean = !!on
    document.body.classList.toggle('vc-clean', clean)
    if (clean) {
      dock.hide()
      dock.setVisible(false)
      // The readout is the one thing clean mode leaves alone: it says which key
      // brings everything back, then fades by itself a second and a half later,
      // and only then is the screen really empty. The sight in the middle and
      // the key list go with the rest through the class, so that a viewer who
      // had already switched the sight off with Caps Lock does not get it back
      // when they come out of here.
      flash(t('flash.cleanOn'))
    } else {
      dock.setVisible(!manuallyHidden && !document.pointerLockElement)
    }
    return clean
  }

  function nudgeHouse(direction) {
    settings.house = clampTo('house', Math.round((settings.house + direction * 0.1) * 100) / 100)
    applyLights()
    refreshAll()
    sound?.tick?.({ level: 1.4 })
    flash(`${t('flash.houseLights')} ${Math.round(settings.house * 100)}%`)
  }

  const onKeyDown = (event) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
    const node = event.target
    if (node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable)) return

    // Clean screen took everything away, so both of the keys that mean "give me
    // the room back" undo it first and do nothing else. One press, one result.
    if (clean && (event.code === 'KeyL' || event.code === 'Escape')) {
      setCleanScreen(false)
      setPanelVisible(true)
      sound?.click?.()
      return
    }

    if (event.code === 'KeyL') {
      // With the pointer locked the dock is hidden anyway, so hand the mouse
      // back first: L means "let me touch the desk", one key, one result.
      if (document.pointerLockElement) {
        player?.unlock?.()
        setPanelVisible(true)
      } else {
        setPanelVisible(manuallyHidden)
      }
      sound?.click?.()
      return
    }
    if (event.code === 'BracketLeft') nudgeHouse(-1)
    else if (event.code === 'BracketRight') nudgeHouse(1)
  }
  document.addEventListener('keydown', onKeyDown)

  const offView = player?.controls?.on?.('view', () => refreshAll()) ?? null

  // Out of the way while you are walking, exactly like the old panel.
  const onPointerLockChange = () => {
    const locked = !!document.pointerLockElement
    dock.setVisible(!locked && !manuallyHidden && !clean)
    if (locked) dock.hide()
  }
  document.addEventListener('pointerlockchange', onPointerLockChange)

  /* ---------------------------------------------------------------------- */
  /* right click                                                             */
  /* ---------------------------------------------------------------------- */

  const menu = createContextMenu({
    sound,
    build: () => {
      const playing = !!media?.isPlaying
      const seated = !!player?.isSeated
      const items = []

      if (media) {
        items.push({
          label: playing ? t('menu.pause') : t('menu.play'),
          hint: media.hasSource ? '' : t('menu.noFilm'),
          disabled: !media.hasSource,
          action: () => media.toggle(),
        })
        items.push({ label: t('menu.openFilm'), action: () => media.openFileDialog() })
        if (media.playlistLength > 0) {
          items.push({
            label: t('menu.next'),
            hint: `${media.playlistIndex + 1} ${t('menu.of')} ${media.playlistLength}`,
            action: () => media.next(),
          })
          items.push({
            label: t('menu.previous'),
            disabled: media.playlistIndex <= 0,
            action: () => media.previous(),
          })
        }
        items.push({ label: t('menu.fullscreen'), action: () => media.toggleFullscreen() })
        items.push({ separator: true })
      }

      // The right click menu is not part of the furniture clean mode hides, so
      // it is also the way back for anyone who did not read the readout.
      items.push({
        label: clean ? t('menu.cleanOff') : t('menu.cleanOn'),
        action: () => {
          setCleanScreen(!clean)
          if (!clean) setPanelVisible(true)
        },
      })
      items.push({ separator: true })

      if (media && cinema?.setCurtains && (!venues || venues.current === 'cinema')) {
        items.push({
          label: t('group.curtains'),
          chips: [
            { key: 'open', label: t('curtain.open') },
            { key: 'closed', label: t('curtain.closed') },
          ].map((chip) => ({
            label: chip.label,
            active: chip.key === 'open' ? cinema.curtains < 0.5 : cinema.curtains >= 0.5,
            action: () => {
              const value = chip.key === 'open' ? 0 : 1
              cinema.setCurtains(value)
              settings.curtains = value
              persist()
              stageChanged()
              refreshAll()
            },
          })),
        })
      }

      if (queue?.length) {
        items.push({
          label: t('queue.next'),
          hint: `${queue.length}`,
          action: () => queue.skip(),
        })
      }

      if (venues?.list?.length) {
        items.push({
          label: t('menu.venue'),
          chips: venues.list.map((venue) => ({
            label: venue.label,
            active: venues.current === venue.id,
            action: () => venues.go(venue.id),
          })),
        })
      }

      if (Object.keys(ratios).length) {
        items.push({
          label: t('menu.screenSize'),
          chips: Object.entries(ratios).map(([key, entry]) => ({
            label: entry.label,
            note: entry.note,
            active: key === settings.ratio,
            action: () => applyRatio(key),
          })),
        })
      }

      items.push({
        label: t('menu.lights'),
        chips: Object.entries(presets).map(([key, preset]) => ({
          label: t(`preset.${key}`),
          active: Math.abs(preset.house - settings.house) < 0.02,
          action: () => applyPreset(key),
        })),
      })

      if (player?.views?.list?.length) {
        items.push({
          label: t('menu.view'),
          chips: player.views.list.slice(0, 4).map((view) => ({
            label: view.label,
            active: player.views.current === view.id,
            action: () => {
              player.views.set(view.id)
              refreshAll()
            },
          })),
        })
        items.push({
          label: player.isCinematic ? t('menu.leaveFrame') : t('menu.enterFrame'),
          hint: 'C',
          action: () => player.setCinematic(!player.isCinematic),
        })
      }

      items.push({ separator: true })

      if (player) {
        items.push({
          label: seated ? t('menu.stand') : t('menu.sit'),
          hint: 'E',
          action: () => player.toggleSeat?.(),
        })
      }

      items.push({
        label: t('menu.dock'),
        hint: 'L',
        action: () => setPanelVisible(manuallyHidden),
      })
      items.push({ label: t('menu.enterRoom'), hint: t('menu.click'), action: () => player?.lock?.() })

      const updater = context.update
      if (updater) {
        items.push({ separator: true })
        if (updater.available) {
          items.push({ label: t('menu.updateNow'), action: () => updater.apply() })
        }
        items.push({ label: t('menu.whatsNew'), hint: `v${updater.version}`, action: () => updater.showChangelog() })
      }

      return items
    },
  })

  /* ---------------------------------------------------------------------- */

  // The picker is built before this module exists, so it only learns about the
  // queue now. Until then its "queue it" button is not even on screen.
  if (queue && media?.picker?.enableQueue) {
    media.picker.enableQueue((source) => {
      queue.add(source)
      flash(t('flash.queued'))
      sound?.click?.()
    })
  }

  buildUI()
  const offLanguage = onLanguageChange(() => {
    // Labels cannot be translated in place, so the dock is thrown away and
    // drawn again. Everything it drives lives outside it and is untouched.
    buildUI()
    refreshAll()
    refreshTransport()
    sound?.click?.()
  })

  applyLights({ immediate: true })
  applyRatio(settings.ratio, { quiet: true })
  if (sound && settings.effects === false) sound.setEnabled(false)

  // Before the first film the hall waits the way a real one does: lit, with the
  // curtain across the screen. Always, not just on a first visit: the viewer
  // asked for the curtain to be shut every time, so the first play always has
  // one to open.
  if (showtime?.enabled) {
    settings.house = Math.max(settings.house, INTERVAL_HOUSE)
    applyLights({ immediate: true })
    cinema?.setCurtains?.(1, { immediate: true })
  }

  refreshAll()
  refreshTransport()
  onPointerLockChange()
  /**
   * Things the hall wants to tell you, from a module that has no panel.
   *
   * A plain window event because the network module is built after this one and
   * cannot be listened to at construction. See the note in src/net/index.js.
   */
  const onNotice = (event) => {
    const detail = event.detail || {}
    if (detail.kind === 'joined') flash(`${t('lobby.joinedAt')} ${formatTime(detail.at)}`)
    else if (detail.kind === 'local') setNotice(t('lobby.localOnly'))
    else if (detail.kind === 'shared') setNotice(null)
  }
  window.addEventListener('cinema:notice', onNotice)

  const timer = setInterval(refreshTransport, 500)

  // Which build you are actually looking at, said once, on the way in. The page
  // never reloads itself, so a tab left open overnight is a real possibility,
  // and "it does not do the thing you fixed" is almost always this.
  if (context.update?.version) flash(`Virtual Cinema v${context.update.version}`)

  return {
    element: dock.bar,
    dock,
    settings,
    menu,
    showtime,
    queue,
    refresh: refreshAll,

    setHouseLights(level) {
      settings.house = clampTo('house', level)
      applyLights()
      refreshAll()
    },
    setScreenGain(gain) {
      settings.screenGain = clampTo('screenGain', gain)
      applyLights()
      refreshAll()
    },
    setWarmth(value) {
      settings.warmth = clampTo('warmth', value)
      applyLights()
      refreshAll()
    },
    setAisleLights(value) {
      settings.aisle = clampTo('aisle', value)
      applyLights()
      refreshAll()
    },
    setExitLights(value) {
      settings.exit = clampTo('exit', value)
      applyLights()
      refreshAll()
    },
    setExposure(value) {
      settings.exposure = clampTo('exposure', value)
      applyLights()
      refreshAll()
    },
    setScreenRatio: (name) => applyRatio(name),
    presets,
    applyPreset: (key, options) => applyPreset(key, { ms: 0, quiet: true, ...options }),
    savePreset,

    show: () => setPanelVisible(true),
    hide: () => setPanelVisible(false),
    open: (id) => dock.show(id),

    /**
     * Hand over the screen sharing controller once the network is up.
     * Called by main.js; see the note on `screenShare`.
     */
    bindScreenShare(share) {
      screenShare = share ?? null
      refreshShare()
      return share
    },

    /* --- the shared room. See the note above getStage(). ------------------ */
    getStage,
    applyStage,
    /** @param {(values: object) => void} fn @returns {() => void} */
    onStageChange(fn) {
      stageListeners.add(fn)
      return () => stageListeners.delete(fn)
    },

    /** Everything over the picture, gone. See setCleanScreen(). */
    setCleanScreen: (on) => setCleanScreen(on),
    get cleanScreen() {
      return clean
    },

    dispose() {
      clearTimeout(readoutTimer)
      clearInterval(timer)
      menu.dispose()
      offLanguage?.()
      offVenue?.()
      queue?.dispose()
      showtime?.dispose()
      offView?.()
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      window.removeEventListener('cinema:notice', onNotice)
      // The class lives on <body>, which outlives this module.
      document.body.classList.remove('vc-clean')
      dock.dispose()
      readout.remove()
    },
  }
}

export { PRESETS, createContextMenu }
export default createRoom

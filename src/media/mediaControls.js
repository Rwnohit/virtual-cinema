/**
 * Floating panel that drives the projection: play/pause, seek, volume, room
 * reverb and full screen. Choosing what to play lives in sourcePicker.js.
 *
 * The clock on the left of the transport bar is also the way in: click it and
 * it becomes a field, type where you want to be and press Enter. Same handle
 * for a local file and for a YouTube embed, since both sit behind media.seek().
 *
 * It stays out of the way of the walking controls: key events are stopped
 * inside the panel and the whole panel fades out while the pointer is locked.
 */

import { clamp, formatTime, injectStyle, hideWhilePointerLocked } from './util.js'

const STYLE_ID = 'media-controls-style'

const CSS = `
.mc-panel{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:40;
  width:min(560px,calc(100vw - 32px));box-sizing:border-box;padding:12px 14px;
  background:rgba(12,12,14,.82);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  border:1px solid rgba(255,255,255,.12);border-radius:14px;color:#f2f2f4;
  font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  box-shadow:0 18px 50px rgba(0,0,0,.5);transition:opacity .25s ease,transform .25s ease;
  padding-bottom:calc(12px + env(safe-area-inset-bottom,0px));}
.mc-panel.is-hidden{opacity:0;pointer-events:none;transform:translateX(-50%) translateY(12px);}
.mc-panel.mc-collapsed .mc-body{display:none;}
.mc-head{display:flex;align-items:center;gap:10px;}
.mc-title{font-weight:600;letter-spacing:.2px;flex:1;}
.mc-body{display:flex;flex-direction:column;gap:10px;margin-top:10px;}
.mc-row{display:flex;align-items:center;gap:10px;}
.mc-btn{appearance:none;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.07);
  color:#f2f2f4;border-radius:9px;padding:7px 12px;cursor:pointer;font:inherit;line-height:1;
  min-height:34px;transition:background .15s ease,border-color .15s ease;}
.mc-btn:hover{background:rgba(255,255,255,.15);}
.mc-btn:active{transform:translateY(1px);}
.mc-btn.mc-primary{background:#f2f2f4;color:#121214;border-color:#f2f2f4;font-weight:600;min-width:44px;}
.mc-btn.mc-icon{min-width:34px;padding:7px 9px;}
.mc-time{font-variant-numeric:tabular-nums;opacity:.75;min-width:44px;text-align:center;}
.mc-time.mc-typeable{cursor:text;border-radius:6px;padding:2px 3px;
  transition:background .15s ease,opacity .15s ease;}
.mc-time.mc-typeable:hover,.mc-time.mc-typeable:focus-visible{background:rgba(255,255,255,.14);opacity:1;}
.mc-time-input{width:76px;box-sizing:border-box;background:rgba(255,255,255,.1);
  border:1px solid rgba(255,255,255,.3);border-radius:6px;color:#f2f2f4;text-align:center;
  font:inherit;font-variant-numeric:tabular-nums;padding:3px 4px;}
.mc-range{-webkit-appearance:none;appearance:none;height:4px;border-radius:4px;flex:1;min-width:60px;
  background:rgba(255,255,255,.22);outline:none;cursor:pointer;}
.mc-range::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;
  background:#f2f2f4;border:none;cursor:pointer;}
.mc-range::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#f2f2f4;border:none;cursor:pointer;}
.mc-label{opacity:.7;white-space:nowrap;}
.mc-input{flex:1;min-width:0;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);
  border-radius:9px;color:#f2f2f4;padding:7px 10px;font:inherit;min-height:34px;box-sizing:border-box;}
.mc-input::placeholder{color:rgba(242,242,244,.4);}
.mc-select{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);border-radius:9px;
  color:#f2f2f4;padding:7px 8px;font:inherit;min-height:34px;cursor:pointer;}
.mc-select option{background:#131316;color:#f2f2f4;}
.mc-status{font-size:12px;opacity:.7;min-height:16px;}
.mc-status.mc-warn{color:#ffd479;opacity:1;}
.mc-status.mc-error{color:#ff8b8b;opacity:1;}
@media (max-width:520px){
  .mc-panel{left:12px;right:12px;transform:none;width:auto;}
  .mc-panel.is-hidden{transform:translateY(12px);}
  .mc-row.mc-wrap{flex-wrap:wrap;}
}
`

const PRESET_LABELS = {
  dry: 'Χωρίς αίθουσα',
  'screening-room': 'Μικρή αίθουσα',
  cinema: 'Σινεμά',
  imax: 'Μεγάλη αίθουσα',
}

/**
 * Read a moment somebody typed into the transport bar.
 *
 * Forgiving on purpose: this is a text field on a film, not a form. The parts
 * are read right to left as seconds, minutes, hours, so "1:21:04", "1:21:4",
 * "81:04" and "4861" all land on the same frame, minutes over 59 are fine and
 * a lone number means seconds. Spaces are ignored and a decimal can be written
 * with either a dot or a comma.
 *
 * Anything else comes back as null instead of as a guess: a typo must never
 * throw the viewer somewhere random in the film.
 *
 * @param {string} text
 * @returns {number|null} seconds, or null when it is not a time at all
 */
export function parseTimeInput(text) {
  const raw = String(text ?? '').replace(/\s+/g, '')
  if (!raw) return null

  const parts = raw.split(':')
  if (parts.length > 3) return null

  let seconds = 0
  for (const part of parts) {
    // An empty field ("1::04") is a typo and not a zero, so refuse it.
    if (!/^\d+([.,]\d+)?$/.test(part)) return null
    seconds = seconds * 60 + Number(part.replace(',', '.'))
  }
  return Number.isFinite(seconds) ? seconds : null
}

/**
 * @param {object} media the handle returned by createMedia()
 * @param {object} [options]
 * @param {HTMLElement} [options.container=document.body]
 * @param {boolean} [options.hideOnPointerLock=true]
 */
export function createMediaControls(media, options = {}) {
  injectStyle(STYLE_ID, CSS)

  const container = options.container || document.body
  const panel = document.createElement('div')
  panel.className = 'mc-panel'
  panel.innerHTML = `
    <div class="mc-head">
      <span class="mc-title">Προβολή ταινίας</span>
      <button class="mc-btn mc-icon" data-role="fullscreen" title="Πλήρης οθόνη" aria-label="Πλήρης οθόνη">⛶</button>
      <button class="mc-btn mc-icon" data-role="collapse" title="Μικρό ή μεγάλο" aria-label="Μικρό ή μεγάλο">−</button>
    </div>
    <div class="mc-body">
      <div class="mc-row">
        <button class="mc-btn mc-primary" data-role="play" aria-label="Παίξε">▶</button>
        <span class="mc-time mc-typeable" data-role="current" role="button" tabindex="0"
          title="Πάτα και γράψε το σημείο που θες">0:00</span>
        <input class="mc-time-input" data-role="time-input" type="text" hidden
          placeholder="1:21:04" aria-label="Πήγαινε σε χρονικό σημείο">

        <input class="mc-range" type="range" data-role="seek" min="0" max="1000" value="0" aria-label="Θέση ταινίας">
        <span class="mc-time" data-role="duration">0:00</span>
      </div>
      <div class="mc-row mc-wrap">
        <button class="mc-btn mc-icon" data-role="mute" aria-label="Σίγαση">🔊</button>
        <input class="mc-range" type="range" data-role="volume" min="0" max="100" value="85" aria-label="Ένταση">
        <span class="mc-label">Αίθουσα</span>
        <input class="mc-range" type="range" data-role="reverb" min="0" max="100" value="22" aria-label="Ηχώ αίθουσας">
        <select class="mc-select" data-role="preset" aria-label="Τύπος αίθουσας"></select>
      </div>
      <div class="mc-status" data-role="status"></div>
    </div>
  `
  container.appendChild(panel)

  const el = (role) => panel.querySelector(`[data-role="${role}"]`)
  const ui = {
    collapse: el('collapse'),
    fullscreen: el('fullscreen'),
    play: el('play'),
    current: el('current'),
    timeInput: el('time-input'),
    seek: el('seek'),
    duration: el('duration'),
    mute: el('mute'),
    volume: el('volume'),
    reverb: el('reverb'),
    preset: el('preset'),
    status: el('status'),
  }

  for (const [value, label] of Object.entries(PRESET_LABELS)) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    ui.preset.appendChild(option)
  }
  ui.preset.value = media.reverbPreset
  ui.volume.value = String(Math.round(media.volume * 100))
  ui.reverb.value = String(Math.round(media.reverbMix * 100))

  let seeking = false
  const unsubscribe = []

  function setStatus(message, kind = '') {
    ui.status.textContent = message || ''
    ui.status.className = `mc-status${kind ? ` mc-${kind}` : ''}`
  }

  function refreshPlayButton() {
    const playing = media.isPlaying
    ui.play.textContent = playing ? '❚❚' : '▶'
    ui.play.setAttribute('aria-label', playing ? 'Παύση' : 'Παίξε')
  }

  function refreshVolumeButton() {
    ui.mute.textContent = media.muted || media.volume === 0 ? '🔇' : '🔊'
  }

  function refreshTime() {
    const { currentTime, duration } = media
    ui.current.textContent = formatTime(currentTime)
    ui.duration.textContent = formatTime(duration)
    if (!seeking && Number.isFinite(duration) && duration > 0) {
      ui.seek.value = String(Math.round((currentTime / duration) * 1000))
    }
  }

  // --- wiring ------------------------------------------------------------
  ui.play.addEventListener('click', async () => {
    await media.toggle()
    refreshPlayButton()
  })

  ui.mute.addEventListener('click', () => {
    media.setMuted(!media.muted)
    refreshVolumeButton()
  })

  ui.volume.addEventListener('input', () => {
    media.setVolume(clamp(Number(ui.volume.value) / 100, 0, 1))
    refreshVolumeButton()
  })

  ui.reverb.addEventListener('input', () => {
    media.setReverbMix(clamp(Number(ui.reverb.value) / 100, 0, 1))
  })

  ui.preset.addEventListener('change', () => {
    media.setReverbPreset(ui.preset.value)
    ui.reverb.value = String(Math.round(media.reverbMix * 100))
  })

  ui.seek.addEventListener('pointerdown', () => {
    seeking = true
  })
  const endSeek = () => {
    if (!seeking) return
    seeking = false
    const duration = media.duration
    if (Number.isFinite(duration) && duration > 0) {
      media.seek((Number(ui.seek.value) / 1000) * duration)
    }
  }
  ui.seek.addEventListener('pointerup', endSeek)
  ui.seek.addEventListener('change', endSeek)

  // --- typing a time -----------------------------------------------------
  // The slider is for scrubbing, which is a lousy way to reach 1:21:04 in a two
  // hour film. Clicking the clock turns it into a field you can type into.

  function closeTimeEntry() {
    if (ui.timeInput.hidden) return
    ui.timeInput.hidden = true
    ui.current.hidden = false
  }

  function openTimeEntry() {
    if (!ui.timeInput.hidden) return
    ui.timeInput.value = formatTime(media.currentTime)
    ui.current.hidden = true
    ui.timeInput.hidden = false
    ui.timeInput.focus()
    ui.timeInput.select()
  }

  function commitTimeEntry() {
    const typed = parseTimeInput(ui.timeInput.value)
    if (typed === null) {
      setStatus('Γράψε το σημείο σαν 1:21:04, ή σκέτα δευτερόλεπτα.', 'warn')
      // Stay open: the typo is right there and can be fixed in place.
      ui.timeInput.select()
      return
    }

    // Past the end is somebody aiming at the finish, not an error worth a
    // message, so it lands on the last frame instead.
    const duration = media.duration
    const known = Number.isFinite(duration) && duration > 0
    const target = known ? clamp(typed, 0, duration) : Math.max(0, typed)

    media.seek(target)
    closeTimeEntry()
    setStatus('')

    // Both a local file and an embed answer on their own clock, so paint the
    // moment that was asked for rather than wait for the next timeupdate.
    ui.current.textContent = formatTime(target)
    if (known) ui.seek.value = String(Math.round((target / duration) * 1000))
  }

  ui.current.addEventListener('click', openTimeEntry)
  ui.current.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    openTimeEntry()
  })

  ui.timeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitTimeEntry()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeTimeEntry()
    }
  })
  // Clicking away is a change of mind. Enter is the only thing that commits.
  ui.timeInput.addEventListener('blur', closeTimeEntry)

  function refreshFullscreenButton() {
    const on = !!document.fullscreenElement
    ui.fullscreen.textContent = on ? '⤢' : '⛶'
    const label = on ? 'Έξοδος από πλήρη οθόνη' : 'Πλήρης οθόνη'
    ui.fullscreen.title = label
    ui.fullscreen.setAttribute('aria-label', label)
  }

  ui.fullscreen.addEventListener('click', () => media.toggleFullscreen())
  document.addEventListener('fullscreenchange', refreshFullscreenButton)

  ui.collapse.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('mc-collapsed')
    ui.collapse.textContent = collapsed ? '+' : '−'
  })

  // Keep typing and clicking inside the panel away from the walk controls.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    panel.addEventListener(type, (event) => event.stopPropagation())
  }
  panel.addEventListener('pointerdown', (event) => event.stopPropagation())
  panel.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true })

  // --- media events ------------------------------------------------------
  unsubscribe.push(
    media.on('play', () => {
      refreshPlayButton()
      setStatus('')
    }),
    media.on('pause', refreshPlayButton),
    media.on('ended', refreshPlayButton),
    media.on('timeupdate', refreshTime),
    media.on('loaded', () => {
      refreshTime()
      setStatus('')
    }),
    media.on('waiting', () => setStatus('Φορτώνει...')),
    media.on('canplay', () => {
      if (ui.status.textContent === 'Φορτώνει...') setStatus('')
    }),
    media.on('timeupdate', () => {
      if (ui.status.textContent === 'Φορτώνει...' && media.isPlaying) setStatus('')
    }),
    media.on('volume', refreshVolumeButton),
    media.on('blocked', (payload) => setStatus(payload.message, 'warn')),
    media.on('degraded', (payload) => setStatus(payload.message, 'warn')),
    media.on('error', (payload) => setStatus(payload.message, 'error')),
    media.on('reverb', (payload) => {
      if (PRESET_LABELS[payload.preset]) ui.preset.value = payload.preset
      if (Number.isFinite(payload.mix)) ui.reverb.value = String(Math.round(payload.mix * 100))
    }),
  )

  const unhide =
    options.hideOnPointerLock === false ? () => {} : hideWhilePointerLocked(panel)

  const timer = setInterval(refreshTime, 500)
  refreshPlayButton()
  refreshVolumeButton()
  refreshFullscreenButton()
  refreshTime()

  return {
    element: panel,
    setStatus,
    show() {
      panel.classList.remove('is-hidden')
    },
    hide() {
      panel.classList.add('is-hidden')
    },
    dispose() {
      clearInterval(timer)
      unsubscribe.forEach((off) => typeof off === 'function' && off())
      document.removeEventListener('fullscreenchange', refreshFullscreenButton)
      unhide()
      panel.remove()
    },
  }
}

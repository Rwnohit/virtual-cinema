/**
 * The foyer: your name, and which hall you are walking into.
 *
 * Two things have to happen before anyone is inside a cinema, and they are the
 * only two things this screen does.
 *
 * The click. Browsers keep the sound asleep until the visitor actually presses
 * something, so there has to be a press, and it has to be the same press that
 * takes you in. Everything else on this screen exists to make that one press
 * worth making.
 *
 * The hall. Four doors, and behind each one a screening that is already
 * running: who is inside, what is on, how far in it is. That is why the menu
 * is not a dropdown - "3 people, 21 minutes into something" is the reason you
 * pick one door over another, and a dropdown cannot say it. The list refreshes
 * while you stand here, because a foyer that lies about which room the party
 * is in is worse than no foyer.
 *
 * Picking a film is still never a condition for going in. You are allowed to
 * walk into an empty hall and put something on later, or nothing at all.
 */

import { injectStyle } from './util.js'
import { t, onLanguageChange } from '../i18n/index.js'

const STYLE_ID = 'media-start-overlay-style'

/** The four doors. Kept in step with HALLS in the wire protocol. */
const HALL_IDS = ['hall-1', 'hall-2', 'hall-3', 'hall-4']
/** How often the foyer asks the halls what they are doing. */
const REFRESH_MS = 4000
const NAME_KEY = 'cinema.name'

const CSS = `
.mo-overlay{position:fixed;inset:0;z-index:55;display:grid;place-items:center;
  padding:24px;box-sizing:border-box;color:#f2f2f4;background:radial-gradient(circle at 50% 45%,
  rgba(18,20,30,.82) 0%,rgba(4,5,9,.94) 70%);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  font:14px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  transition:opacity .45s ease;opacity:1;overflow-y:auto;}
.mo-overlay.is-leaving{opacity:0;pointer-events:none;}
.mo-inner{width:min(620px,calc(100vw - 40px));display:flex;flex-direction:column;align-items:center;
  gap:14px;text-align:center;margin:auto;padding:8px 0;}
.mo-kicker{text-transform:uppercase;letter-spacing:.18em;font-size:11px;opacity:.55;}
.mo-title{font-size:clamp(22px,4.4vw,30px);font-weight:600;line-height:1.25;margin:0;}
.mo-sub{opacity:.7;margin:0;}

.mo-name{display:flex;align-items:center;gap:10px;width:100%;max-width:340px;margin-top:4px;}
.mo-name label{font-size:12px;opacity:.6;white-space:nowrap;}
.mo-name input{flex:1;min-width:0;background:rgba(255,255,255,.07);
  border:1px solid rgba(255,255,255,.2);border-radius:999px;color:#f2f2f4;
  padding:11px 16px;font:inherit;text-align:center;min-height:44px;box-sizing:border-box;}
.mo-name input:focus{outline:none;border-color:rgba(255,255,255,.5);background:rgba(255,255,255,.12);}
.mo-name input::placeholder{color:rgba(242,242,244,.35);}

.mo-halls{display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%;margin-top:6px;}
.mo-hall{appearance:none;text-align:left;cursor:pointer;font:inherit;color:#f2f2f4;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:14px;
  padding:14px 16px;display:flex;flex-direction:column;gap:5px;min-height:96px;
  transition:background .15s ease,border-color .15s ease,transform .12s ease;}
.mo-hall:hover{background:rgba(255,255,255,.11);border-color:rgba(255,255,255,.3);}
.mo-hall:active{transform:translateY(1px);}
.mo-hall.is-on{background:#f2f2f4;color:#101014;border-color:#f2f2f4;}
.mo-hall.is-full{opacity:.45;cursor:default;}
.mo-hall.is-full:hover{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.14);}
.mo-hall-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px;}
.mo-hall-name{font-weight:600;letter-spacing:.2px;}
.mo-hall-who{font-size:12px;opacity:.6;font-variant-numeric:tabular-nums;white-space:nowrap;}
.mo-hall.is-on .mo-hall-who{opacity:.65;}
.mo-hall-now{font-size:12px;opacity:.72;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mo-hall-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;
  background:#6bcb77;vertical-align:middle;}
.mo-hall-idle .mo-hall-now{opacity:.4;}

.mo-cta{appearance:none;border:none;border-radius:999px;padding:16px 34px;cursor:pointer;
  background:#f2f2f4;color:#101014;font:600 16px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  box-shadow:0 16px 44px rgba(0,0,0,.55);transition:transform .15s ease,box-shadow .15s ease;
  min-height:52px;margin-top:8px;}
.mo-cta:hover{transform:translateY(-1px);box-shadow:0 20px 52px rgba(0,0,0,.6);}
.mo-cta:active{transform:translateY(1px);}
.mo-second{appearance:none;border:1px solid rgba(255,255,255,.2);background:transparent;color:#f2f2f4;
  border-radius:999px;padding:10px 20px;cursor:pointer;font:inherit;min-height:38px;opacity:.85;
  transition:background .15s ease,border-color .15s ease;}
.mo-second:hover{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.34);opacity:1;}
.mo-note{font-size:12px;opacity:.5;}
/* A short laptop screen is the common case, not the exception. */
@media (max-height:760px){
  .mo-inner{gap:10px;}
  .mo-hall{min-height:78px;padding:11px 13px;}
  .mo-cta{padding:13px 30px;min-height:46px;}
}
@media (max-width:520px){
  .mo-halls{grid-template-columns:1fr;}
}
`

/** "21 λεπτά μέσα" reads better than a running clock nobody can act on. */
function minutesIn(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  if (total < 60) return t('lobby.justStarted')
  return `${Math.floor(total / 60)} ${t('lobby.minutesIn')}`
}

/**
 * @param {object} media handle from createMedia()
 * @param {object} [options]
 * @param {HTMLElement} [options.container=document.body]
 * @param {() => void} [options.onPickFile] open the file dialog
 * @param {(entry: {hall: string, name: string}) => void} [options.onEnter]
 */
export function createStartOverlay(media, options = {}) {
  injectStyle(STYLE_ID, CSS)

  const container = options.container || document.body
  const overlay = document.createElement('div')
  overlay.className = 'mo-overlay'
  container.appendChild(overlay)

  const params = new URLSearchParams(window.location.search)
  /** A link with a hall in it walks you straight to that door. */
  let hall = HALL_IDS.includes(params.get('room')) ? params.get('room') : HALL_IDS[0]
  let halls = HALL_IDS.map((id) => ({ id, peers: 0, showing: false, playing: false, time: 0, label: null }))

  let dismissed = false
  let removeTimer = null
  let refreshTimer = null
  let offLanguage = null
  let nameInput = null

  /**
   * A name is always in the box before the viewer touches it.
   *
   * Theirs if they have been here before, otherwise one of the house's, so the
   * field reads as "change this if you like" rather than as a form to fill in.
   * An empty box must never be the thing standing between somebody and the
   * film: `enter()` falls back to the suggestion instead of refusing.
   */
  const HOUSE_NAMES = ['Popcorn', 'Reel', 'Usher', 'Matinee', 'Balcony', 'Trailer', 'Encore', 'Nachos']
  const suggestion = `${HOUSE_NAMES[Math.floor(Math.random() * HOUSE_NAMES.length)]} ${
    Math.floor(Math.random() * 90) + 10
  }`

  function savedName() {
    const fromUrl = params.get('name')
    if (fromUrl) return fromUrl.slice(0, 24)
    try {
      const stored = (window.localStorage.getItem(NAME_KEY) || '').slice(0, 24)
      if (stored) return stored
    } catch {
      /* private mode */
    }
    return suggestion
  }

  function build() {
    const typed = nameInput ? nameInput.value : savedName()
    overlay.innerHTML = `
      <div class="mo-inner">
        <span class="mo-kicker">${t('start.kicker')}</span>
        <h1 class="mo-title">${t('start.title')}</h1>
        <p class="mo-sub" data-role="sub">${t('lobby.sub')}</p>
        <div class="mo-name">
          <label for="mo-name-input">${t('lobby.yourName')}</label>
          <input id="mo-name-input" data-role="name" type="text" maxlength="24" autocomplete="off"
            spellcheck="false" placeholder="${t('lobby.namePlaceholder')}">
        </div>
        <div class="mo-halls" data-role="halls"></div>
        <button class="mo-cta" data-role="cta">${t('lobby.enterHall')}</button>
        <button class="mo-second" data-role="pick">${t('start.pick')}</button>
        <span class="mo-note">${t('lobby.note')}</span>
      </div>
    `
    nameInput = overlay.querySelector('[data-role="name"]')
    nameInput.value = typed
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        enter()
      }
    })

    overlay.querySelector('[data-role="cta"]').addEventListener('click', enter)
    overlay.querySelector('[data-role="pick"]').addEventListener('click', async () => {
      await media.resumeAudio()
      overlay.querySelector('[data-role="sub"]').textContent = t('start.pickFile')
      options.onPickFile?.()
    })

    buildHalls()
  }

  /** id -> the button and the three pieces of it that ever change. */
  const doors = new Map()

  /**
   * The doors are built once and only ever repainted.
   *
   * They used to be thrown away and made again on every refresh, which is four
   * times a minute, and a button that is replaced between your press and its
   * release is a button that does nothing. It was caught by a test clicking at
   * the wrong moment; a person would have called it "sometimes it ignores me".
   */
  function buildHalls() {
    const list = overlay.querySelector('[data-role="halls"]')
    if (!list) return
    list.innerHTML = ''
    doors.clear()
    HALL_IDS.forEach((id, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'mo-hall'
      button.innerHTML = `
        <span class="mo-hall-top">
          <span class="mo-hall-name"></span>
          <span class="mo-hall-who"></span>
        </span>
        <span class="mo-hall-now"></span>
      `
      button.querySelector('.mo-hall-name').textContent = `${t('lobby.hall')} ${index + 1}`
      button.addEventListener('click', () => {
        if (button.disabled) return
        hall = id
        paintHalls()
      })
      list.appendChild(button)
      doors.set(id, {
        button,
        who: button.querySelector('.mo-hall-who'),
        now: button.querySelector('.mo-hall-now'),
      })
    })
    paintHalls()
  }

  function paintHalls() {
    for (const info of halls) {
      const door = doors.get(info.id)
      if (!door) continue
      const full = info.peers >= 24 && info.id !== hall
      door.button.classList.toggle('is-on', info.id === hall)
      door.button.classList.toggle('is-full', full)
      door.button.classList.toggle('mo-hall-idle', !info.showing)
      door.button.disabled = full

      door.who.textContent = full
        ? t('lobby.full')
        : info.peers === 0
          ? t('lobby.empty')
          : `${info.peers} ${info.peers === 1 ? t('lobby.person') : t('lobby.people')}`

      door.now.textContent = ''
      if (info.showing) {
        const dot = document.createElement('span')
        dot.className = 'mo-hall-dot'
        door.now.appendChild(dot)
        door.now.append(`${info.label || t('lobby.aFilm')} · ${minutesIn(info.time)}`)
      } else {
        door.now.textContent = t('lobby.nothingOn')
      }
    }
  }

  async function refresh() {
    try {
      const response = await fetch('/rooms', { cache: 'no-store' })
      if (!response.ok) return
      const data = await response.json()
      if (!Array.isArray(data.halls) || dismissed) return
      halls = data.halls
      paintHalls()
    } catch {
      // No server: the doors still open, the hall is simply yours alone.
    }
  }

  function chosenName() {
    const typed = (nameInput?.value || '').replace(/\s+/g, ' ').trim().slice(0, 24)
    const name = typed || suggestion
    try {
      window.localStorage.setItem(NAME_KEY, name)
    } catch {
      /* private mode: the name lasts as long as the visit, which is enough */
    }
    return name
  }

  async function enter() {
    // Wake the audio clock while the click is still "fresh".
    await media.resumeAudio()
    dismiss()
    options.onEnter?.({ hall, name: chosenName() })
  }

  function dismiss() {
    if (dismissed) return
    dismissed = true
    clearInterval(refreshTimer)
    overlay.classList.add('is-leaving')
    removeTimer = setTimeout(() => overlay.remove(), 500)
  }

  build()
  refresh()
  refreshTimer = setInterval(refresh, REFRESH_MS)
  offLanguage = onLanguageChange(() => {
    if (!dismissed) build()
  })

  const unsubscribe = [
    media.on('error', (payload) => {
      const sub = overlay.querySelector('[data-role="sub"]')
      if (sub) sub.textContent = payload.message
    }),
  ]

  return {
    element: overlay,
    dismiss,
    get hall() {
      return hall
    },
    dispose() {
      unsubscribe.forEach((off) => typeof off === 'function' && off())
      offLanguage?.()
      clearInterval(refreshTimer)
      if (removeTimer) clearTimeout(removeTimer)
      overlay.remove()
    },
  }
}

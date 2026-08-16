/**
 * The player's on screen furniture: a small crosshair in the middle and a
 * corner caption with the keys, which fades out on its own after a few seconds.
 *
 * Pure DOM, no dependency on Three.js, and nothing here ever swallows a click:
 * the whole overlay is `pointer-events: none`.
 */

import { t, onLanguageChange } from '../i18n/index.js'

/**
 * Read fresh every time: the language can change while the room is open - and
 * so can the hands. A list of keys is worse than nothing on a phone, where
 * there is no W, no Shift and no Esc to press.
 */
const touchOnly = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)')?.matches || (navigator.maxTouchPoints || 0) > 0)
const keysText = () => t(touchOnly() ? 'hud.touch' : 'hud.keys')
const enterText = () => t(touchOnly() ? 'hud.enterTouch' : 'hud.enter')

const CSS = `
.pl-hud { position:absolute; inset:0; pointer-events:none; z-index:5;
  font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; color:#e8e8ea; }
.pl-cross { position:absolute; left:50%; top:50%; width:7px; height:7px; margin:-3.5px 0 0 -3.5px;
  border-radius:50%; background:rgba(255,255,255,.82);
  box-shadow:0 0 0 1.5px rgba(0,0,0,.45), 0 0 8px rgba(0,0,0,.5);
  opacity:.28; transition:opacity .25s ease, transform .25s ease; }
.pl-hud.is-live .pl-cross { opacity:.72; }
/* There is a seat in reach. The dot opens a little and stays the colour it was:
   the viewer knows where they are going to sit, and a coloured seat or a
   coloured sight said otherwise. */
.pl-hud.is-target .pl-cross { opacity:.92; transform:scale(1.25); }
/* Nothing to aim at when the camera is not on the player's eyes, and nothing
   at all when the viewer has switched the sight off with Caps Lock. */
.pl-hud.is-overview .pl-cross, .pl-hud.is-cinematic .pl-cross,
.pl-hud.no-cross .pl-cross { opacity:0; }
/* Top centre: the only strip of screen that no panel wants. */
.pl-keys { position:absolute; left:50%; top:calc(16px + env(safe-area-inset-top,0px));
  transform:translate(-50%,-5px);
  max-width:min(560px,calc(100vw - 32px)); text-align:center;
  padding:9px 14px; border-radius:11px;
  background:rgba(10,11,15,.62); border:1px solid rgba(255,255,255,.09);
  backdrop-filter:blur(7px); -webkit-backdrop-filter:blur(7px);
  opacity:0; transition:opacity .55s ease, transform .55s ease; }
.pl-keys.is-on { opacity:.94; transform:translate(-50%,0); }
.pl-keys b { font-weight:600; color:#ffd479; }
.pl-enter { position:absolute; left:50%; top:56%; transform:translate(-50%,0);
  padding:11px 20px; border-radius:999px; letter-spacing:.2px;
  background:rgba(10,11,15,.66); border:1px solid rgba(255,255,255,.12);
  backdrop-filter:blur(7px); -webkit-backdrop-filter:blur(7px);
  opacity:0; transition:opacity .35s ease; }
.pl-enter.is-on { opacity:.96; }
@media (prefers-reduced-motion: reduce) { .pl-hud * { transition:none !important; } }
`

export class PlayerHud {
  /**
   * @param {{container?:HTMLElement, hideAfter?:number}} [options]
   */
  constructor(options = {}) {
    this.container = options.container ?? document.body
    this.hideAfter = options.hideAfter ?? 7000
    this._timer = null

    if (!document.getElementById('pl-hud-style')) {
      const style = document.createElement('style')
      style.id = 'pl-hud-style'
      style.textContent = CSS
      document.head.appendChild(style)
    }

    this.root = document.createElement('div')
    this.root.className = 'pl-hud'

    this.crosshair = document.createElement('div')
    this.crosshair.className = 'pl-cross'

    this.keys = document.createElement('div')
    this.keys.className = 'pl-keys'
    this.keys.textContent = keysText()

    this.enter = document.createElement('div')
    this.enter.className = 'pl-enter is-on'
    this.enter.textContent = enterText()

    this.root.append(this.crosshair, this.keys, this.enter)
    this.container.appendChild(this.root)

    if (getComputedStyle(this.container).position === 'static') {
      this.container.style.position = 'relative'
    }

    this._offLanguage = onLanguageChange(() => {
      this.enter.textContent = enterText()
      this.showKeys()
    })

    this.showKeys()
  }

  /** Show the caption again and restart the fade out timer. */
  showKeys(text) {
    this.keys.textContent = text ?? keysText()
    this.keys.classList.add('is-on')
    clearTimeout(this._timer)
    this._timer = setTimeout(() => this.keys.classList.remove('is-on'), this.hideAfter)
  }

  /** A short message in the same corner, then back to the key list. */
  toast(text, duration = 2200) {
    this.keys.textContent = text
    this.keys.classList.add('is-on')
    clearTimeout(this._timer)
    this._timer = setTimeout(() => this.showKeys(), duration)
  }

  /** Pointer is locked: the player is actually in the room. */
  setLocked(locked) {
    this.root.classList.toggle('is-live', locked)
    this.enter.classList.toggle('is-on', !locked)
    if (locked) this.showKeys()
  }

  /** There is a free seat in reach. */
  setTargeting(on) {
    this.root.classList.toggle('is-target', !!on)
  }

  /** The camera is on one of the fixed views, not on the player's eyes. */
  setOverview(on) {
    this.root.classList.toggle('is-overview', !!on)
  }

  /** The picture fills the view. */
  setCinematic(on) {
    this.root.classList.toggle('is-cinematic', !!on)
  }

  /**
   * Show or hide the sight in the middle.
   *
   * It is an aiming aid, and once you know the room you stop needing it: it
   * just sits in the middle of the film. Caps Lock takes it away, because that
   * is a key nobody in here needs for anything else.
   */
  setCrosshair(on) {
    this.root.classList.toggle('no-cross', !on)
    return on
  }

  get crosshairVisible() {
    return !this.root.classList.contains('no-cross')
  }

  dispose() {
    clearTimeout(this._timer)
    this._offLanguage?.()
    this.root.remove()
  }
}

export default PlayerHud

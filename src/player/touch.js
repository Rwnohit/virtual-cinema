/**
 * The room, on a phone.
 *
 * Everything about walking around this cinema was built for a mouse and a
 * keyboard: the mouse is captured with pointer lock and drives the look, and
 * WASD drives the feet. A phone has neither. Pointer lock does not exist on
 * iOS at all, so "click to enter the room" did nothing you could see, and with
 * no keyboard there was no way to take a single step. The room was a
 * photograph.
 *
 * So: a thumb walks and a finger looks.
 *
 *   drag anywhere in the room ....... look around
 *   the stick, bottom left .......... walk, in any direction, as fast as you
 *                                     push it
 *   tap without dragging ............ sit down on the seat you tapped, or
 *                                     stand up again
 *
 * The stick is drawn here rather than in the room's own panel because it is
 * not a control of the cinema - it is a pair of legs, and it belongs with the
 * rest of the movement code.
 *
 *   const touch = createTouchControls({ controls, player, dom, sound })
 *   touch.dispose()
 */

/** Anything the user meant to press, rather than the room behind it. */
const UI = '.rp-dock, .rp-pop, .rp-notice, .net-hud, .pl-hud, .mc-panel, .cm-root, .vu-sheet, .ms-dock, .mo-overlay, button, input, select, textarea, a'

/** How far the stick can be pushed, in pixels, before it is "all the way". */
const STICK_RANGE = 46

/** A finger that never travelled this far was pointing, not dragging. */
const TAP_SLOP = 12
/** And it was a tap rather than a rest of the hand if it was this quick. */
const TAP_MS = 400

/** Radians of turn per pixel of finger travel. Gentler than the mouse: a
 *  thumb on glass covers far less distance than a hand on a desk. */
const RADIANS_PER_PIXEL = 0.0042


/**
 * Big enough for a thumb, out of the way of everything else.
 *
 * Bottom left, above the bar and clear of the room count. It only ever exists
 * on a touch screen, so there is no desktop layout to protect.
 */
const CSS = `
.tc-root{position:fixed;inset:0;z-index:39;pointer-events:none;}
.tc-root.is-hidden{display:none;}
.tc-stick{position:absolute;left:calc(18px + env(safe-area-inset-left,0px));
  bottom:calc(150px + env(safe-area-inset-bottom,0px));
  width:118px;height:118px;border-radius:50%;pointer-events:auto;touch-action:none;
  background:radial-gradient(circle at 50% 50%,rgba(255,255,255,.10),rgba(12,14,20,.42));
  border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  display:flex;align-items:center;justify-content:center;
  transition:opacity .2s ease,transform .12s ease;opacity:.72;}
.tc-stick.is-held{opacity:1;transform:scale(1.03);}
.tc-knob{width:52px;height:52px;border-radius:50%;background:rgba(242,242,244,.92);
  box-shadow:0 6px 18px rgba(0,0,0,.45);transition:transform .06s linear;}
`

export function isTouchDevice() {
  if (typeof window === 'undefined') return false
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches
  const points = navigator.maxTouchPoints || 0
  return !!coarse || points > 0
}

/**
 * @param {object} options
 * @param {object} options.controls the PlayerControls instance
 * @param {object} [options.player] the player module, for sitting down
 * @param {HTMLElement} options.dom the canvas
 * @param {object} [options.sound] for the click when a seat is taken
 */
export function createTouchControls(options = {}) {
  const { controls, player = null, dom, sound = null } = options
  if (!controls || !dom) return { dispose() {} }

  if (!document.getElementById('tc-style')) {
    const style = document.createElement('style')
    style.id = 'tc-style'
    style.textContent = CSS
    document.head.appendChild(style)
  }

  const root = document.createElement('div')
  root.className = 'tc-root'
  root.innerHTML = `
    <div class="tc-stick" aria-hidden="true"><span class="tc-knob"></span></div>
  `
  document.body.appendChild(root)
  const stick = root.querySelector('.tc-stick')
  const knob = root.querySelector('.tc-knob')

  /** The finger that is steering, and the one that is walking. */
  let looking = null
  let walking = null
  let startedAt = 0
  let travelled = 0
  let tapPoint = null

  const setKnob = (x, y) => {
    knob.style.transform = `translate(${x}px, ${y}px)`
  }

  const releaseStick = () => {
    walking = null
    controls.setTouchMove(0, 0)
    stick.classList.remove('is-held')
    setKnob(0, 0)
  }

  const onStart = (event) => {
    for (const touch of event.changedTouches) {
      const target = document.elementFromPoint(touch.clientX, touch.clientY)
      // The stick claims its own corner first.
      if (walking === null && target?.closest?.('.tc-stick')) {
        walking = { id: touch.identifier, x: touch.clientX, y: touch.clientY }
        stick.classList.add('is-held')
        continue
      }
      if (target?.closest?.(UI)) continue
      if (looking !== null) continue
      looking = { id: touch.identifier, x: touch.clientX, y: touch.clientY }
      startedAt = Date.now()
      travelled = 0
      tapPoint = { x: touch.clientX, y: touch.clientY }
    }
  }

  const onMove = (event) => {
    for (const touch of event.changedTouches) {
      if (walking && touch.identifier === walking.id) {
        const dx = touch.clientX - walking.x
        const dy = touch.clientY - walking.y
        const length = Math.hypot(dx, dy) || 1
        const clamped = Math.min(length, STICK_RANGE)
        const nx = (dx / length) * clamped
        const ny = (dy / length) * clamped
        setKnob(nx, ny)
        // Up the screen is forward. The strength is how far it is pushed, so
        // a small nudge is a slow walk and a full push is a stride.
        controls.setTouchMove(-ny / STICK_RANGE, nx / STICK_RANGE)
        event.preventDefault()
        continue
      }
      if (looking && touch.identifier === looking.id) {
        const dx = touch.clientX - looking.x
        const dy = touch.clientY - looking.y
        looking.x = touch.clientX
        looking.y = touch.clientY
        travelled += Math.hypot(dx, dy)
        controls.turnBy(dx * RADIANS_PER_PIXEL, dy * RADIANS_PER_PIXEL)
        event.preventDefault()
      }
    }
  }

  const onEnd = (event) => {
    for (const touch of event.changedTouches) {
      if (walking && touch.identifier === walking.id) {
        releaseStick()
        continue
      }
      if (looking && touch.identifier === looking.id) {
        const quick = Date.now() - startedAt < TAP_MS
        // A tap, not a drag: take the seat under the finger, or leave the one
        // you are in. This is the only way to sit down without a keyboard.
        if (quick && travelled < TAP_SLOP && tapPoint) {
          player?.toggleSit?.()
          sound?.click?.()
        }
        looking = null
      }
    }
  }

  const onCancel = () => {
    releaseStick()
    looking = null
  }

  dom.addEventListener('touchstart', onStart, { passive: false })
  dom.addEventListener('touchmove', onMove, { passive: false })
  dom.addEventListener('touchend', onEnd)
  dom.addEventListener('touchcancel', onCancel)

  return {
    element: root,
    /** Hidden with the rest of the furniture in clean mode. */
    setVisible(visible) {
      root.classList.toggle('is-hidden', !visible)
    },
    dispose() {
      dom.removeEventListener('touchstart', onStart)
      dom.removeEventListener('touchmove', onMove)
      dom.removeEventListener('touchend', onEnd)
      dom.removeEventListener('touchcancel', onCancel)
      root.remove()
    },
  }
}

export default createTouchControls

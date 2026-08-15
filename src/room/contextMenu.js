/**
 * The right click menu.
 *
 * In a browser, right click means "copy, paste, view source". Inside a room you
 * are standing in, it should mean "what can I do here". So the browser menu is
 * turned off and this one takes its place: the handful of things you actually
 * want without walking back to a panel.
 *
 * It is built fresh on every open, from a function, so the labels always tell
 * the truth ("Παύση" when the film is running, "Σήκω" when you are sitting).
 *
 *   const menu = createContextMenu({ target, sound, build: () => [...] })
 *
 * An item is one of:
 *   { label, hint?, action, disabled? }        a normal line
 *   { label, chips: [{ label, active, action }] }   a row of small buttons
 *   { separator: true }
 */

const STYLE_ID = 'room-context-menu-style'

const CSS = `
.cm-root{position:fixed;z-index:70;min-width:224px;max-width:280px;padding:6px;
  background:rgba(14,14,17,.94);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
  border:1px solid rgba(255,255,255,.14);border-radius:12px;color:#f2f2f4;
  font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  box-shadow:0 24px 60px rgba(0,0,0,.6);display:none;}
.cm-root.is-open{display:block;}
.cm-item{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;
  appearance:none;background:none;border:0;color:inherit;font:inherit;text-align:left;
  padding:8px 10px;border-radius:8px;cursor:pointer;}
.cm-item:hover{background:rgba(255,255,255,.1);}
.cm-item[disabled]{opacity:.38;cursor:default;}
.cm-item[disabled]:hover{background:none;}
.cm-label{flex:1;}
.cm-hint{opacity:.45;font-size:12px;font-variant-numeric:tabular-nums;}
.cm-group{padding:8px 10px 4px;}
.cm-group-label{opacity:.5;font-size:11px;letter-spacing:.4px;text-transform:uppercase;margin-bottom:6px;}
.cm-chips{display:flex;gap:5px;}
.cm-chip{appearance:none;flex:1;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);
  color:#f2f2f4;border-radius:7px;padding:6px 4px;font:inherit;font-size:12px;line-height:1.15;
  cursor:pointer;text-align:center;}
.cm-chip:hover{background:rgba(255,255,255,.16);}
.cm-chip.is-on{background:#f2f2f4;color:#121214;border-color:#f2f2f4;font-weight:600;}
.cm-chip small{display:block;opacity:.6;font-size:10px;}
.cm-chip.is-on small{opacity:.55;}
.cm-sep{height:1px;margin:5px 8px;background:rgba(255,255,255,.1);}
`

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

/**
 * @param {object} options
 * @param {HTMLElement} [options.target=document] where right clicks are caught
 * @param {() => Array} options.build returns the items for this open
 * @param {object} [options.sound] the sound module, for the clicks
 * @param {() => void} [options.onOpen] called before the menu is shown
 */
export function createContextMenu(options = {}) {
  injectStyle()

  const build = typeof options.build === 'function' ? options.build : () => []
  const sound = options.sound ?? null
  const target = options.target ?? document

  const root = document.createElement('div')
  root.className = 'cm-root'
  document.body.appendChild(root)

  let open = false

  function close() {
    if (!open) return
    open = false
    root.classList.remove('is-open')
    root.innerHTML = ''
  }

  function run(action) {
    close()
    sound?.click?.()
    try {
      action()
    } catch (err) {
      console.error('[room] menu action failed', err)
    }
  }

  function render(items) {
    root.innerHTML = ''
    for (const item of items) {
      if (!item) continue

      if (item.separator) {
        const line = document.createElement('div')
        line.className = 'cm-sep'
        root.appendChild(line)
        continue
      }

      if (item.chips) {
        const group = document.createElement('div')
        group.className = 'cm-group'
        const label = document.createElement('div')
        label.className = 'cm-group-label'
        label.textContent = item.label
        group.appendChild(label)

        const chips = document.createElement('div')
        chips.className = 'cm-chips'
        for (const chip of item.chips) {
          const button = document.createElement('button')
          button.type = 'button'
          button.className = `cm-chip${chip.active ? ' is-on' : ''}`
          button.innerHTML = chip.note
            ? `${chip.label}<small>${chip.note}</small>`
            : chip.label
          button.addEventListener('click', () => run(chip.action))
          chips.appendChild(button)
        }
        group.appendChild(chips)
        root.appendChild(group)
        continue
      }

      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'cm-item'
      button.disabled = !!item.disabled
      button.innerHTML = `<span class="cm-label"></span>${item.hint ? '<span class="cm-hint"></span>' : ''}`
      button.querySelector('.cm-label').textContent = item.label
      if (item.hint) button.querySelector('.cm-hint').textContent = item.hint
      if (!item.disabled) button.addEventListener('click', () => run(item.action))
      root.appendChild(button)
    }
  }

  /** Keep the whole menu on screen, whichever corner was clicked. */
  function place(x, y) {
    root.style.left = '0px'
    root.style.top = '0px'
    const rect = root.getBoundingClientRect()
    const left = Math.min(Math.max(8, x), window.innerWidth - rect.width - 8)
    const top = Math.min(Math.max(8, y), window.innerHeight - rect.height - 8)
    root.style.left = `${left}px`
    root.style.top = `${top}px`
  }

  function show(x, y) {
    options.onOpen?.()
    render(build())
    open = true
    root.classList.add('is-open')
    place(x, y)
    sound?.click?.()
  }

  const onContextMenu = (event) => {
    // Inside a text field the browser menu is the useful one, leave it alone.
    const node = event.target
    if (node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable)) return

    event.preventDefault()

    // With the pointer locked there is no cursor to aim with, so hand the mouse
    // back and open in the middle, where the crosshair was.
    if (document.pointerLockElement) {
      document.exitPointerLock?.()
      show(window.innerWidth / 2, window.innerHeight / 2)
      return
    }
    show(event.clientX, event.clientY)
  }

  const onPointerDown = (event) => {
    if (open && !root.contains(event.target)) close()
  }
  const onKeyDown = (event) => {
    if (open && event.key === 'Escape') {
      event.stopPropagation()
      close()
    }
  }

  target.addEventListener('contextmenu', onContextMenu)
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('blur', close)
  window.addEventListener('resize', close)

  return {
    element: root,
    get isOpen() {
      return open
    },
    open: show,
    close,
    dispose() {
      close()
      target.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      root.remove()
    },
  }
}

export default createContextMenu

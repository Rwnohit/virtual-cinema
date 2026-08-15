/**
 * The desk: every knob in the building, in one scrolling panel.
 *
 * The panel knows almost nothing about what it is driving. Each module hands
 * over a plain table of fields - `{ key, label, min, max, step, format }` - and
 * a pair of getter/setter functions, and the panel draws sliders for them. That
 * is what keeps this file from growing a branch every time the audio or the
 * picture gains another control: the modules own their own knobs, this only
 * knows how to render a row.
 *
 * Sections collapse, because there are now around thirty of these and nobody
 * wants to scroll past the light board to reach the bass.
 */

import { translateField, translateChip, t } from '../i18n/index.js'

const STYLE_ID = 'room-panel-style'

export const CSS = `
.rp-panel{position:fixed;right:16px;top:calc(16px + env(safe-area-inset-top,0px));z-index:41;
  width:min(288px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow-y:auto;
  box-sizing:border-box;padding:12px 14px;
  background:rgba(12,12,14,.84);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  border:1px solid rgba(255,255,255,.12);border-radius:14px;color:#f2f2f4;
  font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  box-shadow:0 18px 50px rgba(0,0,0,.5);transition:opacity .25s ease,transform .25s ease;
  scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent;}
.rp-panel::-webkit-scrollbar{width:8px;}
.rp-panel::-webkit-scrollbar-thumb{background:rgba(255,255,255,.18);border-radius:4px;}
.rp-panel.is-hidden{opacity:0;pointer-events:none;transform:translateY(-10px);}
.rp-panel.rp-collapsed .rp-body{display:none;}
.rp-head{display:flex;align-items:center;gap:10px;}
.rp-title{font-weight:600;letter-spacing:.2px;flex:1;}
.rp-body{display:flex;flex-direction:column;gap:4px;margin-top:10px;}

.rp-sec{border-top:1px solid rgba(255,255,255,.09);padding-top:6px;margin-top:2px;}
.rp-sec:first-child{border-top:0;margin-top:0;padding-top:0;}
.rp-sec-head{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;
  appearance:none;background:none;border:0;color:inherit;font:inherit;cursor:pointer;
  padding:7px 2px;text-align:left;opacity:.62;letter-spacing:.4px;text-transform:uppercase;font-size:11px;}
.rp-sec-head:hover{opacity:1;}
.rp-sec-head .rp-caret{transition:transform .18s ease;}
.rp-sec.is-open .rp-sec-head{opacity:.95;}
.rp-sec.is-open .rp-caret{transform:rotate(90deg);}
.rp-sec-body{display:none;flex-direction:column;gap:9px;padding:4px 0 10px;}
.rp-sec.is-open .rp-sec-body{display:flex;}
.rp-group{font-size:11px;opacity:.45;letter-spacing:.3px;margin-top:2px;}

.rp-row{display:flex;gap:6px;flex-wrap:wrap;}
.rp-btn{appearance:none;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.07);
  color:#f2f2f4;border-radius:9px;padding:7px 8px;cursor:pointer;font:inherit;line-height:1.15;
  min-height:32px;flex:1;text-align:center;transition:background .15s ease,border-color .15s ease;}
.rp-btn:hover{background:rgba(255,255,255,.15);}
.rp-btn:active{transform:translateY(1px);}
.rp-btn.is-on{background:#f2f2f4;color:#121214;border-color:#f2f2f4;font-weight:600;}
.rp-btn small{display:block;font-size:10px;opacity:.6;}
.rp-btn.rp-icon{flex:0 0 auto;min-width:32px;padding:7px 9px;}
.rp-btn.rp-tiny{flex:0 0 auto;padding:5px 10px;min-height:26px;font-size:12px;}
.rp-btn.rp-half{flex:1 1 46%;}

.rp-field{display:flex;flex-direction:column;gap:4px;}
.rp-legend{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;opacity:.74;}
.rp-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.rp-right{display:flex;align-items:center;gap:6px;flex:0 0 auto;}
.rp-value{font-variant-numeric:tabular-nums;opacity:.9;}
/* The undo arrow only shows once there is something to undo. It keeps its slot
   either way, so the values stay in one column and nothing reflows when a row
   becomes undoable: only the opacity moves. */
.rp-undo{appearance:none;border:0;background:none;color:#f2f2f4;cursor:pointer;
  font-size:13px;line-height:1;padding:0;width:15px;flex:0 0 15px;
  opacity:0;pointer-events:none;transition:opacity .15s ease;}
.rp-undo.is-on{opacity:.5;pointer-events:auto;}
.rp-undo.is-on:hover{opacity:1;}
.rp-resetall{margin-top:2px;}
.rp-range{-webkit-appearance:none;appearance:none;height:4px;border-radius:4px;width:100%;
  background:rgba(255,255,255,.22);outline:none;cursor:pointer;margin:0;}
.rp-range::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;
  background:#f2f2f4;border:none;cursor:pointer;}
.rp-range::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#f2f2f4;border:none;cursor:pointer;}
.rp-toggle{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;opacity:.8;}
.rp-hint{font-size:11px;opacity:.5;letter-spacing:.2px;padding-top:6px;}
.rp-foot{display:flex;gap:6px;align-items:center;padding-top:8px;border-top:1px solid rgba(255,255,255,.09);}

/* --- the dock: a remote control along the bottom, panels above it --------- */
.rp-dock{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));
  transform:translateX(-50%);z-index:41;display:flex;align-items:center;gap:4px;padding:6px;
  max-width:calc(100vw - 24px);
  background:rgba(12,12,14,.86);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
  border:1px solid rgba(255,255,255,.12);border-radius:15px;color:#f2f2f4;
  font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  box-shadow:0 20px 50px rgba(0,0,0,.55);transition:opacity .25s ease,transform .25s ease;}
.rp-dock.is-hidden{opacity:0;pointer-events:none;transform:translateX(-50%) translateY(12px);}
.rp-dbtn{appearance:none;border:0;background:none;color:rgba(242,242,244,.62);font:inherit;font-size:12px;
  cursor:pointer;border-radius:11px;padding:9px 12px;display:flex;align-items:center;gap:7px;white-space:nowrap;}
.rp-dbtn:hover{background:rgba(255,255,255,.08);color:#f2f2f4;}
.rp-dbtn.is-on{background:rgba(255,255,255,.14);color:#f2f2f4;}
.rp-dbtn .ic{font-size:14px;line-height:1;}
.rp-dbtn[disabled]{opacity:.35;cursor:default;}
.rp-dbtn[disabled]:hover{background:none;color:rgba(242,242,244,.62);}
.rp-play{background:#f2f2f4;color:#121214;font-weight:600;min-width:42px;justify-content:center;}
.rp-play:hover{background:#fff;color:#121214;}
.rp-dsep{width:1px;height:22px;background:rgba(255,255,255,.1);margin:0 3px;flex:0 0 auto;}
.rp-time{display:flex;align-items:center;gap:8px;padding:0 4px;}
.rp-time input[type=text]{width:76px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);
  border-radius:8px;color:#f2f2f4;font:inherit;font-size:12px;padding:5px 6px;text-align:center;
  font-variant-numeric:tabular-nums;}
.rp-time input[type=text]:focus{outline:none;border-color:rgba(255,255,255,.4);background:rgba(255,255,255,.12);}
.rp-time .dur{font-size:12px;opacity:.55;font-variant-numeric:tabular-nums;}
.rp-track{width:clamp(90px,18vw,220px);}

/* The little run of round buttons on the bar: mute, share a screen, clear the
   screen. It used to hold a volume slider that unrolled on hover, which is
   why it is called this. */
.rp-vol{display:flex;align-items:center;}
/* Quality only appears when the film is a YouTube one, so it is hidden by
   default rather than laid out and emptied. */
.rp-qual{display:none;align-items:center;gap:3px;padding:0 2px;}
.rp-qual.is-on{display:flex;}
.rp-qual button{appearance:none;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);
  color:rgba(242,242,244,.66);font:inherit;font-size:11px;cursor:pointer;border-radius:8px;padding:5px 7px;}
.rp-qual button:hover{background:rgba(255,255,255,.1);color:#f2f2f4;}
.rp-qual button.is-on{background:#f2f2f4;color:#121214;border-color:#f2f2f4;}

.rp-pop{position:fixed;left:50%;bottom:calc(86px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);
  z-index:41;width:min(460px,calc(100vw - 24px));max-height:min(56vh,520px);overflow-y:auto;
  box-sizing:border-box;padding:14px 16px;
  background:rgba(12,12,14,.9);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
  border:1px solid rgba(255,255,255,.12);border-radius:15px;color:#f2f2f4;
  font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  box-shadow:0 24px 60px rgba(0,0,0,.6);display:none;
  scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent;}
.rp-pop.is-open{display:block;}
.rp-pop.is-hidden{display:none;}
.rp-pop h4{margin:0 0 10px;font-size:11px;letter-spacing:.5px;text-transform:uppercase;
  color:rgba(242,242,244,.55);font-weight:600;}
.rp-page{display:none;flex-direction:column;gap:10px;}
.rp-page.is-on{display:flex;}
.rp-cols{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;}
/* The bar has to hold a transport, a volume, five quality buttons and six tabs.
   Rather than let it run off the sides of a small window, it gives up its width
   in the order it can afford to: first the paddings, then the words. */
@media (max-width:1200px){
  .rp-dbtn{padding:9px 9px;gap:5px;}
  .rp-qual button{padding:5px 5px;font-size:10px;}
  .rp-track{width:clamp(70px,10vw,150px);}
}
@media (max-width:1100px){
  .rp-dbtn span:not(.ic){display:none;}
}
@media (max-width:560px){
  .rp-cols{grid-template-columns:1fr;}
  .rp-track{width:70px;}
  .rp-qual{display:none !important;}
}

/* --- the library: tonight's programme --------------------------------------
   One film at a time, big, the way a foyer sells a screening - and the rest on
   a rail underneath. Choosing from the rail brings a film UP to the hero
   rather than starting it: in here a click starts the film for everybody in
   the hall, and that is not something to do by brushing past a thumbnail.
   The accent is the venue's, read off their own site. */
.rp-pop.is-library{width:min(760px,calc(100vw - 24px));}
.rp-lib{--lime:#D1FE17;--on-lime:#0B0C0E;}
.rp-hero{position:relative;border-radius:14px;overflow:hidden;min-height:250px;isolation:isolate;
  display:flex;align-items:flex-end;padding:20px;margin-bottom:12px;}
.rp-hero-bg{position:absolute;inset:0;z-index:-2;background:#0c0c10 center/cover no-repeat;
  transform:scale(1.06);animation:rp-drift 20s ease-in-out infinite alternate;}
@keyframes rp-drift{to{transform:scale(1.14) translate3d(-2%,-1%,0);}}
.rp-hero::before{content:"";position:absolute;inset:0;z-index:-1;
  background:linear-gradient(90deg,rgba(10,11,14,.95) 0%,rgba(10,11,14,.72) 46%,rgba(10,11,14,.18) 100%);}
.rp-hero-copy{max-width:60%;}
.rp-kick{font:700 10px/1 ui-monospace,"Space Mono",monospace;letter-spacing:.16em;
  text-transform:uppercase;color:var(--lime);}
.rp-hero h3{margin:8px 0 6px;font-size:clamp(20px,3vw,28px);font-weight:700;letter-spacing:-.02em;}
.rp-hero-facts{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:11.5px;
  color:rgba(242,242,244,.66);margin-bottom:8px;}
.rp-hero-facts b{color:#f2f2f4;font-weight:600;}
.rp-hero-facts .sep{opacity:.4;}
.rp-hero p{margin:0 0 14px;font-size:12.5px;line-height:1.5;color:rgba(242,242,244,.78);
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
.rp-hero-acts{display:flex;gap:9px;flex-wrap:wrap;align-items:center;}
.rp-hero-play{appearance:none;border:0;border-radius:999px;cursor:pointer;
  background:var(--lime);color:var(--on-lime);font:600 13.5px/1 inherit;padding:11px 20px;
  display:inline-flex;align-items:center;gap:8px;transition:transform .16s ease,box-shadow .16s ease;}
.rp-hero-play:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(0,0,0,.55);}
.rp-hero-play:active{transform:translateY(0);}
/* The interval. Quiet on purpose - it is the thing you reach for mid film, not
   the thing the screen is selling. */
.rp-hero-hold{appearance:none;border:1px solid rgba(255,255,255,.24);background:rgba(0,0,0,.35);
  color:#f2f2f4;border-radius:999px;cursor:pointer;font:500 13px/1 inherit;padding:11px 17px;
  display:inline-flex;align-items:center;gap:8px;transition:border-color .16s ease,background .16s ease;}
.rp-hero-hold:hover{border-color:rgba(255,255,255,.5);background:rgba(0,0,0,.55);}
/* A grid that goes DOWN, not a rail that goes right. Ninety films on one
   horizontal strip is a catalogue you have to drag through; four across and
   scrolling is one you can read. */
.rp-rail{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;
  max-height:min(42vh,320px);overflow-y:auto;padding:2px 4px 4px 2px;
  scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent;}
.rp-slide{appearance:none;border:0;background:none;padding:0;cursor:pointer;
  color:#f2f2f4;font:inherit;text-align:left;}
.rp-filters{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin:0 0 10px;}
.rp-filter{appearance:none;border:1px solid rgba(255,255,255,.14);background:transparent;
  color:rgba(242,242,244,.6);border-radius:999px;padding:6px 13px;font:500 12px inherit;
  cursor:pointer;transition:color .16s ease,border-color .16s ease,background .16s ease;}
.rp-filter:hover{color:#f2f2f4;border-color:rgba(255,255,255,.32);}
.rp-filter.is-on{background:var(--lime);color:var(--on-lime);border-color:var(--lime);font-weight:600;}
.rp-count{margin-left:auto;font-size:11.5px;color:rgba(242,242,244,.4);
  font-variant-numeric:tabular-nums;}
.rp-slide .art{aspect-ratio:16/9;border-radius:9px;background:#0c0c10 center/cover no-repeat;
  outline:1px solid rgba(255,255,255,.12);outline-offset:-1px;
  transition:outline-color .22s ease,transform .22s ease;}
.rp-slide:hover .art{outline-color:var(--lime);transform:translateY(-3px);}
.rp-slide.is-on .art{outline-color:var(--lime);outline-width:2px;}
.rp-slide b{display:block;font-size:12px;font-weight:600;margin-top:7px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.rp-slide span{display:block;font-size:10.5px;color:rgba(242,242,244,.5);margin-top:1px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
/* A short laptop screen is the common case, not the exception. */
@media (max-height:820px){
  .rp-hero{min-height:190px;padding:16px;}
  .rp-hero p{-webkit-line-clamp:2;margin-bottom:10px;}
}
@media (max-width:640px){ .rp-hero-copy{max-width:100%;} }

.rp-queue{display:flex;flex-direction:column;gap:5px;}
.rp-qrow{display:flex;align-items:center;gap:8px;padding:5px 7px;border-radius:9px;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);font-size:12px;}
.rp-qnum{opacity:.45;font-variant-numeric:tabular-nums;min-width:14px;}
.rp-qname{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.rp-qwait{opacity:.55;font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap;}
.rp-qrow .rp-btn{min-height:24px;padding:3px 8px;font-size:12px;}

.rp-readout{position:fixed;left:50%;top:calc(18% + env(safe-area-inset-top,0px));transform:translateX(-50%);
  z-index:42;padding:8px 14px;border-radius:999px;background:rgba(12,12,14,.8);color:#f2f2f4;
  border:1px solid rgba(255,255,255,.14);font:13px/1 system-ui,-apple-system,"Segoe UI",sans-serif;
  pointer-events:none;opacity:0;transition:opacity .2s ease;backdrop-filter:blur(10px);}
.rp-readout.is-on{opacity:1;}

/* --- the standing notice -------------------------------------------------
   For the one thing that must not be said in a message that fades: a film
   playing off your own disk is a film nobody else in the hall can see, and a
   1.6 second flash loses that race against the ceremony's own "enjoy the
   film". Measured: the warning was written and then overwritten before anyone
   could read it, and the viewer sat through a whole screening alone in a room
   with somebody else in it. So this one stays up until it stops being true. */
.rp-notice{position:fixed;left:50%;top:calc(64px + env(safe-area-inset-top,0px));transform:translateX(-50%);
  z-index:43;display:none;align-items:center;gap:10px;max-width:min(560px,calc(100vw - 32px));
  padding:9px 15px;border-radius:999px;box-sizing:border-box;
  background:rgba(48,34,10,.92);border:1px solid rgba(255,212,121,.42);color:#ffd479;
  font:13px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:left;
  box-shadow:0 14px 40px rgba(0,0,0,.5);backdrop-filter:blur(10px);}
.rp-notice.is-on{display:flex;}
.rp-notice b{color:#fff;font-weight:600;}
.rp-notice button{appearance:none;border:0;background:none;color:inherit;cursor:pointer;
  font:inherit;font-size:16px;line-height:1;opacity:.6;padding:0 0 0 4px;flex:0 0 auto;}
.rp-notice button:hover{opacity:1;}
body.vc-clean .rp-notice{display:none !important;}

/* --- clean screen: the film and nothing else ------------------------------
   Listed by name rather than swept with a wildcard, because two of the things
   over the canvas must survive: the CSS3D layer, which IS the picture when the
   film is a YouTube one, and the readout, which is how the viewer is told
   which key brings everything back. It fades on its own a second later, so
   the screen still ends up completely clear. */
body.vc-clean .rp-dock,
body.vc-clean .rp-pop,
body.vc-clean .pl-hud,
body.vc-clean .net-hud,
body.vc-clean .mc-panel,
body.vc-clean .ms-dock,
body.vc-clean .vu-pill{display:none !important;}

@media (max-width:520px){
  .rp-panel{left:12px;right:12px;width:auto;}
}
`

export function injectPanelStyle() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

/** How a raw number is written next to its slider. */
export function formatValue(field, value) {
  if (typeof field.format === 'function') return field.format(value)
  switch (field.format) {
    case 'hz':
      return `${Math.round(value)} Hz`
    case 'seconds':
      // Through t(), like every other word this file prints: a unit is a word,
      // and a hard coded one is Greek sitting in the English panel.
      return `${value.toFixed(2)} ${t('unit.seconds')}`
    case 'percent':
      return `${Math.round(value * 100)}%`
    case 'x':
      return `${value.toFixed(2)}×`
    case 'signed':
      return `${value > 0 ? '+' : ''}${Math.round(value * 100)}`
    default:
      return `${Math.round(value * 100)}%`
  }
}

/**
 * The dock: one bar along the bottom, one panel that opens above it.
 *
 * Chosen over a tall side panel because the room is the point. With nothing
 * open the picture is completely clear, and the two things you reach for while
 * a film is running (play, and where you are in it) never move.
 *
 * @param {{ container?: HTMLElement, sound?: object }} [options]
 */
export function createDock(options = {}) {
  injectPanelStyle()
  const container = options.container ?? document.body
  const sound = options.sound ?? null

  const bar = document.createElement('div')
  bar.className = 'rp-dock'
  container.appendChild(bar)

  const pop = document.createElement('div')
  pop.className = 'rp-pop'
  pop.innerHTML = '<h4 data-role="title"></h4><div data-role="pages"></div>'
  container.appendChild(pop)

  const title = pop.querySelector('[data-role="title"]')
  const pages = pop.querySelector('[data-role="pages"]')
  const tabs = new Map()
  let openId = null

  /** Tell the page that was open that it no longer is. */
  function closeCurrent() {
    if (openId === null) return
    tabs.get(openId)?.onClose?.()
  }

  function show(id) {
    const entry = tabs.get(id)
    if (!entry) return
    if (openId !== id) closeCurrent()
    openId = id
    title.textContent = entry.label
    for (const [key, tab] of tabs) {
      tab.button.classList.toggle('is-on', key === id)
      tab.page.classList.toggle('is-on', key === id)
    }
    pop.classList.add('is-open')
    entry.onOpen?.()
  }

  function hide() {
    closeCurrent()
    openId = null
    pop.classList.remove('is-open')
    for (const tab of tabs.values()) tab.button.classList.remove('is-on')
  }

  function toggle(id) {
    if (openId === id) hide()
    else show(id)
  }

  /**
   * Add a section. Returns the element to fill with sliders and chips.
   * @param {{ id: string, label: string, icon?: string, onOpen?: () => void }} spec
   */
  function addPage(spec) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'rp-dbtn'
    button.innerHTML = `${spec.icon ? `<span class="ic">${spec.icon}</span>` : ''}<span></span>`
    button.querySelector('span:last-child').textContent = spec.label
    button.addEventListener('click', () => {
      sound?.click?.()
      toggle(spec.id)
    })
    bar.appendChild(button)

    const page = document.createElement('div')
    page.className = 'rp-page'
    pages.appendChild(page)

    tabs.set(spec.id, { ...spec, button, page })
    return page
  }

  /** Anything that is not a section: the transport, a separator, a button. */
  function addToBar(element) {
    bar.appendChild(element)
    return element
  }

  function separator() {
    const line = document.createElement('span')
    line.className = 'rp-dsep'
    bar.appendChild(line)
    return line
  }

  // Panels swallow their own keys and clicks, and so does this one.
  for (const node of [bar, pop]) {
    for (const type of ['keydown', 'keyup', 'keypress']) {
      node.addEventListener(type, (event) => event.stopPropagation())
    }
    node.addEventListener('pointerdown', (event) => event.stopPropagation())
    node.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true })
  }

  /**
   * Empty the bar and the panel, keeping the elements themselves.
   * Switching language rebuilds every label, and rebuilding is honest: a
   * translation table cannot be applied to text that is already in the DOM.
   */
  function reset() {
    hide()
    tabs.clear()
    bar.innerHTML = ''
    pages.innerHTML = ''
    title.textContent = ''
  }

  return {
    bar,
    pop,
    addPage,
    addToBar,
    separator,
    reset,
    show,
    hide,
    toggle,
    get open() {
      return openId
    },
    setVisible(visible) {
      bar.classList.toggle('is-hidden', !visible)
      pop.classList.toggle('is-hidden', !visible)
    },
    dispose() {
      bar.remove()
      pop.remove()
    },
  }
}

/**
 * One collapsible section.
 * @param {HTMLElement} parent
 * @param {string} title
 * @param {boolean} [open]
 */
export function addSection(parent, title, open = false) {
  const section = document.createElement('div')
  section.className = `rp-sec${open ? ' is-on is-open' : ''}`
  section.innerHTML = `
    <button class="rp-sec-head" type="button"><span class="rp-caret">›</span><span></span></button>
    <div class="rp-sec-body"></div>
  `
  section.querySelector('.rp-sec-head span:last-child').textContent = title
  const body = section.querySelector('.rp-sec-body')
  section.querySelector('.rp-sec-head').addEventListener('click', () => {
    section.classList.toggle('is-open')
  })
  parent.appendChild(section)
  return { element: section, body }
}

/**
 * One slider, wired to a getter and a setter.
 *
 * @param {HTMLElement} parent
 * @param {{key:string,label:string,min:number,max:number,step:number,format?:*}} field
 * @param {() => number} read
 * @param {(value:number) => void} write
 * @param {{ onInput?: (value:number) => void }} [hooks]
 * @returns {{ refresh: () => void, input: HTMLInputElement }}
 */
export function addSlider(parent, spec, read, write, hooks = {}) {
  // Every module keeps its own Greek labels; the language swap happens once,
  // here, on the way to the screen. See i18n/index.js.
  const field = translateField(spec, hooks.kind ?? 'field')
  const wrap = document.createElement('label')
  wrap.className = 'rp-field'
  wrap.innerHTML = `
    <span class="rp-legend">
      <span class="rp-name"></span>
      <span class="rp-right">
        <button type="button" class="rp-undo" tabindex="-1">↺</button>
        <span class="rp-value"></span>
      </span>
    </span>
    <input class="rp-range" type="range">
  `
  wrap.querySelector('.rp-name').textContent = field.label
  const value = wrap.querySelector('.rp-value')
  const input = wrap.querySelector('input')
  const undo = wrap.querySelector('.rp-undo')
  input.min = String(field.min)
  input.max = String(field.max)
  input.step = String(field.step ?? 0.01)
  input.setAttribute('aria-label', field.label)

  /**
   * Where the undo button goes back to.
   *
   * The field's own default if it declares one, otherwise whatever the value
   * was the first time this row was drawn. That second case matters: the panel
   * is rebuilt on a language change, and "undo" then has to mean the value the
   * app started with, not the one the row happened to open on.
   */
  const fallback = Number.isFinite(spec.default) ? spec.default : read()
  const home = Number.isFinite(hooks.home) ? hooks.home : fallback

  undo.title = t('tip.reset')
  undo.setAttribute('aria-label', `${t('btn.reset')}: ${field.label}`)
  undo.addEventListener('click', (event) => {
    // The row is a <label>, so a click inside it would also focus the slider.
    event.preventDefault()
    write(home)
    refresh()
    hooks.onUndo?.(home)
  })

  function refresh() {
    const current = read()
    input.value = String(current)
    value.textContent = formatValue(field, current)
    // Only offer to undo something that was actually done.
    undo.classList.toggle('is-on', Math.abs(current - home) > (Number(field.step) || 0.01) / 2)
  }

  input.addEventListener('input', () => {
    const next = Number(input.value)
    write(next)
    value.textContent = formatValue(field, next)
    undo.classList.toggle('is-on', Math.abs(next - home) > (Number(field.step) || 0.01) / 2)
    hooks.onInput?.(next)
  })

  parent.appendChild(wrap)
  refresh()
  return { refresh, input, home, reset: () => {
    write(home)
    refresh()
  } }
}

/** A small caption above a run of related controls. */
export function addGroupLabel(parent, text) {
  const label = document.createElement('div')
  label.className = 'rp-group'
  label.textContent = text
  parent.appendChild(label)
  return label
}

/** A plain on/off line, with the same undo as a slider. */
export function addToggle(parent, label, read, write, options = {}) {
  const row = document.createElement('div')
  row.className = 'rp-toggle'
  row.innerHTML = `
    <span class="rp-name"></span>
    <span class="rp-right">
      <button type="button" class="rp-undo" tabindex="-1">↺</button>
      <button class="rp-btn rp-tiny" type="button" data-role="value"></button>
    </span>
  `
  row.querySelector('.rp-name').textContent = label
  const button = row.querySelector('[data-role="value"]')
  const undo = row.querySelector('.rp-undo')
  const home = options.home !== undefined ? !!options.home : !!read()

  function refresh() {
    const on = !!read()
    button.textContent = on ? t('toggle.yes') : t('toggle.no')
    button.classList.toggle('is-on', on)
    undo.classList.toggle('is-on', on !== home)
  }

  button.addEventListener('click', () => {
    write(!read())
    refresh()
  })

  undo.title = t('tip.reset')
  undo.addEventListener('click', () => {
    write(home)
    refresh()
  })

  parent.appendChild(row)
  refresh()
  return {
    refresh,
    element: row,
    home,
    reset: () => {
      write(home)
      refresh()
    },
  }
}

/**
 * One button that puts a whole page back. Takes the rows themselves, so it can
 * never drift out of step with what is on the page.
 */
export function addResetAll(parent, rows, onDone) {
  const wrap = document.createElement('div')
  wrap.className = 'rp-row rp-resetall'
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'rp-btn rp-tiny'
  button.textContent = `↺ ${t('btn.resetAll')}`
  button.addEventListener('click', () => {
    for (const row of rows) {
      try {
        row.reset?.()
      } catch {
        /* one stubborn row must not stop the rest */
      }
    }
    onDone?.()
  })
  wrap.appendChild(button)
  parent.appendChild(wrap)
  return { element: wrap }
}

/**
 * A row of choices. `items` is `[{ key, label, note? }]`, or a function
 * returning that list: the views change when you walk into another room, so the
 * row has to be able to rebuild itself and not just re-tick a fixed set.
 *
 * @returns {{ refresh: () => void, element: HTMLElement }}
 */
export function addChips(parent, items, isActive, choose, options = {}) {
  const row = document.createElement('div')
  row.className = 'rp-row'
  parent.appendChild(row)

  const source = typeof items === 'function' ? items : () => items
  // `kind` says which keyed table holds these labels: 'venue', 'ratio', 'preset'.
  const read = options.kind
    ? () => (source() ?? []).map((item) => translateChip(item, options.kind))
    : source
  let buttons = []
  let signature = null

  function build() {
    const list = read() ?? []
    row.innerHTML = ''
    buttons = []
    for (const item of list) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'rp-btn'
      if (list.length > 3) button.classList.add('rp-half')
      button.innerHTML = item.note ? `${item.label}<small>${item.note}</small>` : item.label
      button.addEventListener('click', () => choose(item.key))
      row.appendChild(button)
      buttons.push([item.key, button])
    }
    signature = list.map((item) => `${item.key}:${item.label}`).join('|')
  }

  function refresh() {
    const next = (read() ?? []).map((item) => `${item.key}:${item.label}`).join('|')
    if (next !== signature) build()
    for (const [key, button] of buttons) button.classList.toggle('is-on', isActive(key))
  }

  build()
  refresh()
  return { refresh, element: row }
}

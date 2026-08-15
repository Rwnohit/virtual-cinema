/**
 * Ways to hand a movie to the cinema:
 *
 *   1. a small button top left that opens the file dialog
 *   2. dropping a video file (or a link) anywhere on the page
 *   3. a field for pasting a video address
 *
 * Local files go in through URL.createObjectURL(); videoScreen releases the
 * previous object url every time a new source is loaded.
 */

import { injectStyle, hideWhilePointerLocked, looksLikeVideo } from './util.js'
import { t, onLanguageChange } from '../i18n/index.js'

const STYLE_ID = 'media-source-picker-style'

const CSS = `
.ms-dock{position:fixed;top:16px;left:16px;z-index:42;display:flex;flex-direction:column;gap:8px;
  align-items:flex-start;font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#f2f2f4;
  transition:opacity .25s ease;}
.ms-dock.is-hidden{opacity:0;pointer-events:none;}
.ms-row{display:flex;gap:8px;align-items:center;}
.ms-btn{appearance:none;border:1px solid rgba(255,255,255,.14);background:rgba(12,12,14,.72);
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:#f2f2f4;border-radius:999px;
  padding:9px 15px;cursor:pointer;font:inherit;line-height:1;min-height:36px;
  box-shadow:0 8px 24px rgba(0,0,0,.35);transition:background .15s ease,border-color .15s ease;}
.ms-btn:hover{background:rgba(30,30,34,.9);border-color:rgba(255,255,255,.28);}
.ms-btn:active{transform:translateY(1px);}
.ms-btn.ms-quiet{padding:9px 13px;opacity:.85;}
.ms-file{display:none;}
.ms-link{display:none;gap:8px;align-items:center;background:rgba(12,12,14,.72);border:1px solid rgba(255,255,255,.14);
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-radius:12px;padding:8px;
  box-shadow:0 8px 24px rgba(0,0,0,.35);}
.ms-link.is-open{display:flex;}
.ms-input{width:min(300px,60vw);background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);
  border-radius:8px;color:#f2f2f4;padding:7px 10px;font:inherit;min-height:32px;box-sizing:border-box;}
.ms-input::placeholder{color:rgba(242,242,244,.4);}
.ms-hint{font-size:12px;opacity:.6;max-width:280px;}
.ms-hint.ms-error{color:#ff8b8b;opacity:1;}
.ms-veil{position:fixed;inset:0;z-index:60;display:none;place-items:center;
  background:rgba(5,6,10,.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);}
.ms-veil.is-open{display:grid;}
.ms-veil-box{border:2px dashed rgba(255,255,255,.45);border-radius:18px;padding:34px 46px;text-align:center;
  color:#f2f2f4;font:600 18px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;}
.ms-veil-box small{display:block;margin-top:6px;font-weight:400;font-size:13px;opacity:.7;}
@media (max-width:520px){
  .ms-dock{top:12px;left:12px;}
  .ms-input{width:min(220px,52vw);}
}
`

/**
 * @param {object} media the handle from createMedia()
 * @param {object} [options]
 * @param {HTMLElement} [options.container=document.body]
 * @param {HTMLElement} [options.dropTarget=document.body] where files can be dropped
 */
export function createSourcePicker(media, options = {}) {
  injectStyle(STYLE_ID, CSS)

  const container = options.container || document.body
  const dropTarget = options.dropTarget || document.body

  const dock = document.createElement('div')
  dock.className = 'ms-dock'
  // The link field is open from the start and the file button is the quiet one.
  // That is the wrong way round for one person and the right way round for a
  // hall: a link is the only kind of film everybody in the room can actually
  // see, and hiding it behind a toggle is how somebody ends up watching a file
  // off their own disk alone, in a room with other people in it.
  dock.innerHTML = `
    <div class="ms-link is-open" data-role="link-row">
      <input class="ms-input" type="text" data-role="url" placeholder="${t('picker.url')}">
      <button class="ms-btn" data-role="load">${t('picker.play')}</button>
      <button class="ms-btn ms-quiet" data-role="queue">${t('picker.queue')}</button>
    </div>
    <div class="ms-row">
      <button class="ms-btn ms-quiet" data-role="open">${t('picker.open')}</button>
      <button class="ms-btn ms-quiet" data-role="toggle-link" hidden>${t('picker.link')}</button>
    </div>
    <div class="ms-hint" data-role="hint">${t('picker.hint')}</div>
    <input class="ms-file" type="file" accept="video/*" data-role="file">
  `
  container.appendChild(dock)

  const veil = document.createElement('div')
  veil.className = 'ms-veil'
  veil.innerHTML = `<div class="ms-veil-box">${t('picker.drop')}<small>${t('picker.dropNote')}</small></div>`
  container.appendChild(veil)

  const el = (role) => dock.querySelector(`[data-role="${role}"]`)
  const ui = {
    open: el('open'),
    toggleLink: el('toggle-link'),
    linkRow: el('link-row'),
    url: el('url'),
    load: el('load'),
    queue: el('queue'),
    hint: el('hint'),
    file: el('file'),
  }

  const DEFAULT_HINT = t('picker.hint')

  function setHint(message, isError = false) {
    ui.hint.textContent = message || DEFAULT_HINT
    ui.hint.classList.toggle('ms-error', !!isError && !!message)
  }

  async function play(source, label) {
    setHint(label ? `${t('picker.loading')}: ${label}` : `${t('picker.loading')}...`)
    await media.load(source, { autoplay: true })
  }

  ui.open.addEventListener('click', () => ui.file.click())

  ui.file.addEventListener('change', async () => {
    const file = ui.file.files && ui.file.files[0]
    if (!file) return
    await play(file, file.name)
    // Let the same file be picked again later.
    ui.file.value = ''
  })

  ui.toggleLink.addEventListener('click', () => {
    const open = ui.linkRow.classList.toggle('is-open')
    if (open) ui.url.focus()
  })

  const loadUrl = async () => {
    const url = ui.url.value.trim()
    if (!url) {
      setHint(t('picker.needUrl'), true)
      return
    }
    await play(url)
  }
  ui.load.addEventListener('click', loadUrl)

  // Queueing is the same input, a different verb. The room module hands over
  // `onQueue` once it exists, and until then the button simply is not there.
  ui.queue.style.display = 'none'
  ui.queue.addEventListener('click', () => {
    const url = ui.url.value.trim()
    if (!url) {
      setHint(t('picker.needUrl'), true)
      return
    }
    api.onQueue?.(url)
    ui.url.value = ''
    setHint('')
  })
  ui.url.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loadUrl()
  })

  // Typing must not walk the viewer across the room.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    dock.addEventListener(type, (event) => event.stopPropagation())
  }
  dock.addEventListener('pointerdown', (event) => event.stopPropagation())

  // --- drag and drop -----------------------------------------------------
  let dragDepth = 0

  const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).some((t) => t === 'Files' || t === 'text/uri-list')

  const onDragEnter = (event) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    dragDepth += 1
    veil.classList.add('is-open')
  }
  const onDragOver = (event) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }
  const onDragLeave = () => {
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) veil.classList.remove('is-open')
  }
  const onDrop = async (event) => {
    event.preventDefault()
    dragDepth = 0
    veil.classList.remove('is-open')

    const file = Array.from(event.dataTransfer?.files || []).find(looksLikeVideo)
    if (file) {
      await play(file, file.name)
      return
    }
    const dropped = event.dataTransfer?.getData('text/uri-list') || event.dataTransfer?.getData('text/plain')
    if (dropped && /^https?:\/\//i.test(dropped.trim())) {
      ui.url.value = dropped.trim()
      await play(dropped.trim())
      return
    }
    setHint(t('picker.notVideo'), true)
  }

  dropTarget.addEventListener('dragenter', onDragEnter)
  dropTarget.addEventListener('dragover', onDragOver)
  dropTarget.addEventListener('dragleave', onDragLeave)
  dropTarget.addEventListener('drop', onDrop)

  const unhide = hideWhilePointerLocked(dock)
  const unsubscribe = [
    media.on('sourcechange', () => setHint('')),
    media.on('loaded', () => setHint('')),
    media.on('error', (payload) => setHint(payload.message, true)),
    media.on('degraded', (payload) => setHint(payload.message, true)),
  ]

  const api = {
    element: dock,
    /** Set by the room module: hands a source to the queue instead of playing. */
    onQueue: null,
    /** Show the queue button once someone is listening for it. */
    enableQueue(handler) {
      api.onQueue = handler
      ui.queue.style.display = handler ? '' : 'none'
    },
    /** Opens the computer's file dialog. */
    openFileDialog() {
      ui.file.click()
    },
    setHint,
    dispose() {
      unhide()
      unsubscribe.forEach((off) => typeof off === 'function' && off())
      dropTarget.removeEventListener('dragenter', onDragEnter)
      dropTarget.removeEventListener('dragover', onDragOver)
      dropTarget.removeEventListener('dragleave', onDragLeave)
      dropTarget.removeEventListener('drop', onDrop)
      dock.remove()
      veil.remove()
      offLanguage?.()
    },
  }

  // Rebuilding the whole dock for four labels is not worth it; these are the
  // only strings on it, so they are simply rewritten.
  const offLanguage = onLanguageChange(() => {
    ui.open.textContent = t('picker.open')
    ui.toggleLink.textContent = t('picker.link')
    ui.load.textContent = t('picker.play')
    ui.queue.textContent = t('picker.queue')
    ui.url.placeholder = t('picker.url')
    setHint('')
  })

  return api
}

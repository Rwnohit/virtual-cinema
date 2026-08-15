/**
 * Updates, on your terms.
 *
 * Nothing here ever reloads the page on its own. When a newer build shows up it
 * says so, quietly, in the corner, and waits. You are in the middle of a film
 * in a dark room; deciding when to interrupt that is your call, not ours.
 *
 * Two ways it finds out:
 *   - while developing, the dev server sends a message every time a file is
 *     saved (see the plugin in vite.config.js, which swallows the reload)
 *   - when hosted, `/version.json` is checked every couple of minutes and
 *     whenever you come back to the tab
 *
 *   const updater = await createUpdater()
 *   updater.available   // true once there is something newer
 *   updater.apply()     // reloads, and only when asked
 */

import { t, onLanguageChange } from '../i18n/index.js'

const POLL_MS = 150000
const STAMP_URL = '/version.json'
const CHANGELOG_URL = '/CHANGELOG.md'

const STYLE_ID = 'vc-update-style'

const CSS = `
.vu-pill{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:64;
  display:none;align-items:center;gap:10px;padding:10px 12px 10px 14px;
  background:rgba(12,12,14,.9);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  border:1px solid rgba(255,255,255,.16);border-radius:12px;color:#f2f2f4;
  font:13px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  box-shadow:0 18px 44px rgba(0,0,0,.55);max-width:min(320px,calc(100vw - 32px));}
.vu-pill.is-on{display:flex;}
.vu-text{flex:1;}
.vu-text b{display:block;font-weight:600;}
.vu-text small{opacity:.6;font-size:11px;}
.vu-btn{appearance:none;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;
  background:#f2f2f4;color:#121214;font:600 13px/1 system-ui,-apple-system,"Segoe UI",sans-serif;}
.vu-btn:hover{background:#fff;}
.vu-close{appearance:none;border:0;background:none;color:#f2f2f4;opacity:.5;cursor:pointer;
  font-size:16px;line-height:1;padding:4px 2px;}
.vu-close:hover{opacity:1;}

.vu-sheet{position:fixed;inset:0;z-index:66;display:none;place-items:center;padding:24px;
  box-sizing:border-box;background:rgba(4,5,9,.72);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);}
.vu-sheet.is-on{display:grid;}
.vu-card{width:min(620px,100%);max-height:min(72vh,760px);overflow-y:auto;box-sizing:border-box;
  padding:22px 24px;background:rgba(16,16,19,.96);border:1px solid rgba(255,255,255,.14);
  border-radius:16px;color:#f2f2f4;font:14px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  box-shadow:0 30px 80px rgba(0,0,0,.6);}
.vu-card h1{font-size:19px;margin:0 0 2px;}
.vu-card h2{font-size:15px;margin:22px 0 6px;padding-top:14px;border-top:1px solid rgba(255,255,255,.1);}
.vu-card h2:first-of-type{border-top:0;padding-top:0;margin-top:14px;}
.vu-card p{margin:6px 0;opacity:.75;}
.vu-card ul{margin:6px 0;padding-left:20px;}
.vu-card li{margin:4px 0;}
.vu-card strong{color:#fff;}
.vu-head{display:flex;align-items:flex-start;gap:12px;}
.vu-head .vu-close{font-size:20px;}
`

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

/** The version this bundle was built as. Replaced at build time. */
function currentStamp() {
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'
  const built = typeof __APP_BUILT__ === 'string' ? __APP_BUILT__ : ''
  return { version, built }
}

/** Markdown, but only the four shapes the changelog actually uses. */
function renderMarkdown(text) {
  const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (s) => escape(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>')

  const html = []
  let inList = false
  let lastItem = -1
  const closeList = () => {
    if (inList) html.push('</ul>')
    inList = false
    lastItem = -1
  }

  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    // The card already carries its own title, so the file's h1 is dropped.
    if (/^# /.test(line)) {
      closeList()
    } else if (/^## /.test(line)) {
      closeList()
      html.push(`<h2>${inline(line.slice(3))}</h2>`)
    } else if (/^\s*- /.test(line)) {
      if (!inList) {
        html.push('<ul>')
        inList = true
      }
      lastItem = html.push(`<li>${inline(line.replace(/^\s*- /, ''))}</li>`) - 1
    } else if (!line.trim()) {
      closeList()
    } else if (inList && lastItem >= 0) {
      // A wrapped bullet, glued back onto the line it belongs to.
      html[lastItem] = html[lastItem].replace(/<\/li>$/, ` ${inline(line.trim())}</li>`)
    } else {
      html.push(`<p>${inline(line)}</p>`)
    }
  }
  closeList()
  return html.join('\n')
}

/**
 * @param {object} [context]
 * @param {object} [context.sound] the sound module, for the clicks
 * @param {HTMLElement} [context.container]
 * @param {boolean} [context.poll] set false to skip the hosted version check
 */
export function createUpdater(context = {}) {
  injectStyle()

  const container = context.container ?? document.body
  const sound = context.sound ?? null
  const current = currentStamp()

  let available = false
  let latest = null
  let disposed = false
  let timer = null

  // --- the quiet corner pill ------------------------------------------------
  const pill = document.createElement('div')
  pill.className = 'vu-pill'
  pill.innerHTML = `
    <span class="vu-text">
      <b>${t('update.title')}</b>
      <small data-role="detail">${t('update.detail')}</small>
    </span>
    <button class="vu-btn" type="button" data-role="apply">${t('btn.update')}</button>
    <button class="vu-close" type="button" data-role="later" title="${t('btn.later')}" aria-label="${t('btn.later')}">×</button>
  `
  container.appendChild(pill)

  const detail = pill.querySelector('[data-role="detail"]')

  // --- the changelog sheet --------------------------------------------------
  const sheet = document.createElement('div')
  sheet.className = 'vu-sheet'
  sheet.innerHTML = `
    <div class="vu-card">
      <div class="vu-head">
        <div style="flex:1">
          <h1>${t('update.changelog')}</h1>
          <p style="margin:0">${t('update.running')} <strong>${current.version}</strong></p>
        </div>
        <button class="vu-close" type="button" data-role="close" aria-label="${t('btn.close')}">×</button>
      </div>
      <div data-role="body"><p>${t('update.loading')}</p></div>
    </div>
  `
  container.appendChild(sheet)

  const sheetBody = sheet.querySelector('[data-role="body"]')

  function announce(reason, stamp) {
    if (available || disposed) return
    available = true
    latest = stamp ?? null
    if (reason === 'dev') detail.textContent = t('update.dev')
    else if (stamp?.version) detail.textContent = `${t('update.version')} ${stamp.version}. ${t('update.detail')}`
    pill.classList.add('is-on')
    sound?.click?.()
  }

  function apply() {
    location.reload()
  }

  pill.querySelector('[data-role="apply"]').addEventListener('click', apply)
  pill.querySelector('[data-role="later"]').addEventListener('click', () => {
    pill.classList.remove('is-on')
    sound?.click?.()
  })

  // --- what changed ---------------------------------------------------------
  let changelogHtml = null

  async function showChangelog() {
    sheet.classList.add('is-on')
    if (changelogHtml === null) {
      try {
        const response = await fetch(CHANGELOG_URL, { cache: 'no-store' })
        changelogHtml = response.ok
          ? renderMarkdown(await response.text())
          : `<p>${t('update.missing')}</p>`
      } catch {
        changelogHtml = `<p>${t('update.missing')}</p>`
      }
    }
    sheetBody.innerHTML = changelogHtml
  }

  function hideChangelog() {
    sheet.classList.remove('is-on')
  }

  sheet.querySelector('[data-role="close"]').addEventListener('click', hideChangelog)
  sheet.addEventListener('click', (event) => {
    if (event.target === sheet) hideChangelog()
  })
  const onKeyDown = (event) => {
    if (event.key === 'Escape' && sheet.classList.contains('is-on')) {
      event.stopPropagation()
      hideChangelog()
    }
  }
  document.addEventListener('keydown', onKeyDown, true)

  // Panels swallow their own keys and clicks; these two are no different.
  for (const node of [pill, sheet]) {
    for (const type of ['keydown', 'keyup', 'keypress']) {
      node.addEventListener(type, (event) => event.stopPropagation())
    }
    node.addEventListener('pointerdown', (event) => event.stopPropagation())
  }

  /* ---------------------------------------------------------------------- */
  /* finding out                                                             */
  /* ---------------------------------------------------------------------- */

  // While developing: the dev server tells us instead of reloading.
  if (import.meta.hot) {
    import.meta.hot.on('vc:update-available', () => announce('dev'))
  }

  async function check() {
    if (disposed || available) return null
    try {
      const response = await fetch(`${STAMP_URL}?ts=${Date.now()}`, { cache: 'no-store' })
      if (!response.ok) return null
      const stamp = await response.json()
      const newer = stamp.version !== current.version || (stamp.built && stamp.built !== current.built)
      if (newer) announce('hosted', stamp)
      return stamp
    } catch {
      return null
    }
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible') check()
  }

  if (context.poll !== false && !import.meta.hot) {
    timer = setInterval(check, POLL_MS)
    document.addEventListener('visibilitychange', onVisible)
  }

  return {
    version: current.version,
    built: current.built,
    get available() {
      return available
    },
    get latest() {
      return latest
    },
    check,
    apply,
    showChangelog,
    hideChangelog,
    /** For the tests and for anyone who wants to see the pill on demand. */
    announce,
    dispose() {
      disposed = true
      if (timer) clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      document.removeEventListener('keydown', onKeyDown, true)
      pill.remove()
      sheet.remove()
    },
  }
}

export default createUpdater

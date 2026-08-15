/**
 * Small shared helpers for the media layer.
 * Dependency free on purpose, so every media module can import it.
 */

/** Clamp a number into [min, max]. */
export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value
}

/** Tiny event emitter (on / off / emit). */
export function createEmitter() {
  const map = new Map()

  const emitter = {
    on(type, handler) {
      if (!map.has(type)) map.set(type, new Set())
      map.get(type).add(handler)
      return () => emitter.off(type, handler)
    },
    off(type, handler) {
      const set = map.get(type)
      if (set) set.delete(handler)
    },
    emit(type, payload) {
      const set = map.get(type)
      if (!set) return
      for (const handler of [...set]) {
        try {
          handler(payload)
        } catch (err) {
          console.error(`[media] listener for "${type}" threw`, err)
        }
      }
    },
    clear() {
      map.clear()
    },
  }

  return emitter
}

/** Add a stylesheet once, no matter how many times the module is built. */
export function injectStyle(id, css) {
  if (document.getElementById(id)) return
  const style = document.createElement('style')
  style.id = id
  style.textContent = css
  document.head.appendChild(style)
}

/**
 * Hide a panel while the player has the pointer locked for looking around.
 * @returns {() => void} unsubscribe
 */
export function hideWhilePointerLocked(element, className = 'is-hidden') {
  const handler = () => element.classList.toggle(className, !!document.pointerLockElement)
  document.addEventListener('pointerlockchange', handler)
  handler()
  return () => document.removeEventListener('pointerlockchange', handler)
}

/** Files a browser can realistically play, for drag and drop checks. */
export function looksLikeVideo(file) {
  if (!file) return false
  if (typeof file.type === 'string' && file.type.startsWith('video/')) return true
  return /\.(mp4|m4v|webm|ogv|ogg|mov|mkv|avi)$/i.test(file.name || '')
}

/** True when the url points to another origin, so it needs CORS headers. */
export function isCrossOrigin(url) {
  if (typeof url !== 'string') return false
  if (/^(blob:|data:)/i.test(url)) return false
  try {
    return new URL(url, location.href).origin !== location.origin
  } catch {
    return false
  }
}

/** True for HLS playlists, which most desktop browsers cannot play natively. */
export function isHlsUrl(url) {
  return typeof url === 'string' && /\.m3u8(\?|#|$)/i.test(url)
}

/** mm:ss (or h:mm:ss) for the transport bar. */
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}

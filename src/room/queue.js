/**
 * The queue: what plays after this.
 *
 * A cinema does not cut from one film to the next. It finishes, the lights come
 * up, people move about, and some minutes later the next screening begins. So
 * the queue does not simply chain the files: it waits for the ceremony to put
 * the room back (see showtime.js), then holds the interval for as long as you
 * asked, and only then starts the next one, which brings the ceremony with it.
 *
 *   const queue = createQueue({ media, showtime })
 *   queue.add('/movies/two.mp4', 'Η δεύτερη')
 *   queue.gap = 30          // seconds of interval between films
 *
 * The gap is yours to set because it is the one thing a projectionist decides:
 * ten seconds for a double bill, two minutes if people want to get up.
 */

import { t } from '../i18n/index.js'

const STORAGE_KEY = 'vc.queue'

/** How long the interval lasts by default. */
const DEFAULT_GAP = 25

/** Anything under this and the ceremony would still be running. */
const MIN_GAP = 5
const MAX_GAP = 300

/** The dial the panel builds itself from. */
export const QUEUE_FIELDS = [
  {
    key: 'gap',
    label: 'Κενό ανάμεσα στις ταινίες',
    min: MIN_GAP,
    max: MAX_GAP,
    step: 5,
    format: (value) => `${Math.round(value)} ${t('queue.seconds')}`,
  },
]

const clampGap = (value) => Math.min(Math.max(Math.round(Number(value) || DEFAULT_GAP), MIN_GAP), MAX_GAP)

/** A readable name for whatever was handed over. */
export function labelFor(source) {
  if (typeof File !== 'undefined' && source instanceof File) return source.name
  if (typeof source !== 'string') return 'Film'
  try {
    const url = new URL(source, location.href)
    if (/youtube|youtu\.be/.test(url.hostname)) return `YouTube · ${url.searchParams.get('v') ?? url.pathname.slice(1)}`
    if (/vimeo/.test(url.hostname)) return `Vimeo · ${url.pathname.replace(/\D+/g, '')}`
    const name = url.pathname.split('/').filter(Boolean).pop()
    return decodeURIComponent(name || url.hostname)
  } catch {
    return source.slice(0, 40)
  }
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

/**
 * @param {object} options
 * @param {object} options.media the film
 * @param {object} [options.showtime] the ceremony, so the two do not overlap
 * @param {(state: object) => void} [options.onChange]
 */
export function createQueue(options = {}) {
  const { media, showtime } = options
  if (!media) return null

  /** @type {{id:number,source:*,label:string,file:boolean}[]} */
  const items = []
  let nextId = 1
  let gap = clampGap(readStored()?.gap ?? DEFAULT_GAP)
  /**
   * Whether the next film starts on its own.
   *
   * Off by default, because that is what people actually do: the interval ends
   * when someone decides it ends. The timed gap is the rarer case, so it is the
   * one you have to ask for.
   */
  let auto = readStored()?.auto === true
  /** Seconds left of the interval, or 0 when nothing is waiting. */
  let countdown = 0
  let timer = null
  let ticker = null
  let disposed = false

  function announce() {
    options.onChange?.({ items: [...items], gap, countdown })
  }

  function persist() {
    try {
      // Only the gap survives a reload. A local file cannot be reopened from a
      // saved path, and a half remembered queue is worse than an empty one.
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ gap, auto }))
    } catch {
      /* private mode, never mind */
    }
  }

  function clearTimers() {
    clearTimeout(timer)
    clearInterval(ticker)
    timer = null
    ticker = null
    countdown = 0
  }

  /** Take the next film off the queue and start it, ceremony and all. */
  function startNext() {
    clearTimers()
    const next = items.shift()
    announce()
    if (!next) return false
    // autoplay: true is what hands it to the ceremony, which lowers the lights
    // and opens the curtain before anything appears on the screen.
    media.load(next.source, { autoplay: true })
    return true
  }

  /**
   * Wait out the interval, then go. The countdown starts only once the room has
   * finished coming back up, so the number on the panel is the wait the viewer
   * actually has, not a timer racing the curtain.
   */
  function scheduleNext() {
    if (disposed || !items.length) return
    clearTimers()

    const begin = () => {
      countdown = gap
      announce()
      ticker = setInterval(() => {
        countdown = Math.max(0, countdown - 1)
        announce()
      }, 1000)
      timer = setTimeout(startNext, gap * 1000)
    }

    // The ceremony owns the room until it says otherwise.
    if (showtime && showtime.state !== 'interval') {
      const wait = setInterval(() => {
        if (disposed) {
          clearInterval(wait)
          return
        }
        if (showtime.state === 'interval') {
          clearInterval(wait)
          begin()
        }
      }, 500)
      timer = wait
      return
    }
    begin()
  }

  const offEnded = media.on('ended', () => {
    // Without the timer the queue simply waits, and the panel shows a button.
    if (auto && items.length) scheduleNext()
  })

  return {
    get items() {
      return [...items]
    },
    get length() {
      return items.length
    },
    get gap() {
      return gap
    },
    set gap(value) {
      gap = clampGap(value)
      persist()
      announce()
    },
    get countdown() {
      return countdown
    },
    get auto() {
      return auto
    },
    set auto(value) {
      auto = !!value
      if (!auto) clearTimers()
      persist()
      announce()
    },
    fields: QUEUE_FIELDS,
    QUEUE_FIELDS,

    /** Generic pair, so the panel can drive the gap like any other slider. */
    get: () => gap,
    set: (_key, value) => {
      gap = clampGap(value)
      persist()
      announce()
      return gap
    },

    add(source, label) {
      const file = typeof File !== 'undefined' && source instanceof File
      items.push({ id: nextId++, source, label: label || labelFor(source), file })
      announce()
      return items.length
    },

    remove(id) {
      const index = items.findIndex((item) => item.id === id)
      if (index < 0) return false
      items.splice(index, 1)
      if (!items.length) clearTimers()
      announce()
      return true
    },

    clear() {
      items.length = 0
      clearTimers()
      announce()
    },

    /** Jump the queue: this one, now, with the ceremony. */
    playAt(id) {
      const index = items.findIndex((item) => item.id === id)
      if (index < 0) return false
      const [item] = items.splice(index, 1)
      clearTimers()
      announce()
      media.load(item.source, { autoplay: true })
      return true
    },

    /** Do not wait out the rest of the interval. */
    skip() {
      return startNext()
    },

    dispose() {
      disposed = true
      clearTimers()
      offEnded?.()
    },
  }
}

export default createQueue

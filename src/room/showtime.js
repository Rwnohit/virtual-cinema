/**
 * The ceremony.
 *
 * A cinema does not simply start playing. You sit in a lit room behind a closed
 * curtain, the curtain opens, the lights sink into the film, and near the end
 * the house comes back so nobody is left fumbling in the dark. Those minutes
 * are most of what makes a cinema feel like a cinema rather than a television,
 * so they are here.
 *
 *   const showtime = createShowtime({ media, lighting, cinema, toShow, toHouse })
 *   showtime.enabled = true
 *
 * Two decisions, both from watching it happen:
 *
 * 1. The film is never held back. Waiting three seconds in the dark for a play
 *    you already pressed feels broken, not ceremonial. The picture starts at
 *    once and the room changes around it, over the first seconds of the film.
 * 2. The house comes up BEFORE the end, not after. Real projection fades the
 *    lights in under the last of the picture. And the curtain, once opened,
 *    stays open: closing it between films is a thing only the projectionist
 *    does, by hand.
 */

/** The hall between films: lit enough to find your seat. */
export const INTERVAL_HOUSE = 0.55

const SECONDS = 1000

/** How long the room takes to settle into the screening look, film running. */
const LIGHTS_DOWN_MS = 5 * SECONDS

/** How long before the last frame the house starts coming back. */
export const BEFORE_END_S = 5

/**
 * @param {object} options
 * @param {object} options.media the film
 * @param {object} options.lighting the light rig
 * @param {object} options.cinema the hall, for its curtains
 * @param {object} [options.sound] for the switch of the dimmer
 * @param {(ms: number) => void} [options.toShow] take the lights to the screening look
 * @param {(ms: number) => void} [options.toHouse] and back to the interval look
 * @param {(state: string, label: string) => void} [options.onState]
 */
export function createShowtime(options = {}) {
  const { media, lighting, cinema, sound } = options
  if (!media || !lighting) return null

  /** 'interval' | 'showing' | 'ending' */
  let state = 'interval'
  let enabled = options.enabled !== false
  let timer = null
  /** True while we are the ones calling play, so we do not intercept ourselves. */
  let ours = false

  // The room owns the dials, so it is the room that moves them. Without it we
  // can still work the house lights on our own.
  const toShow = options.toShow ?? ((ms) => options.setHouse?.(0, ms))
  const toHouse = options.toHouse ?? ((ms) => options.setHouse?.(INTERVAL_HOUSE, ms))
  const openCurtains = () => cinema?.setCurtains?.(0)

  /**
   * A ceremony has to fit inside its film.
   *
   * Five seconds of fade is right for a feature and absurd for a ten second
   * clip, where it would still be dimming when the thing ended. So both ends of
   * it shrink with the running time, and a film long enough never notices.
   */
  function timing() {
    const total = media.duration
    if (!Number.isFinite(total) || total <= 0) return { down: LIGHTS_DOWN_MS, lead: BEFORE_END_S }
    return {
      down: Math.min(LIGHTS_DOWN_MS, (total * SECONDS) / 3),
      lead: Math.min(BEFORE_END_S, total / 4),
    }
  }

  function announce(next, label) {
    state = next
    options.onState?.(next, label)
  }

  function clear() {
    clearTimeout(timer)
    timer = null
  }

  /**
   * Put the hall in its between films state, without touching the film.
   * The curtain is only ever closed here on purpose (at boot), never as part
   * of the ceremony.
   */
  function toInterval({ immediate = false, curtains = false } = {}) {
    clear()
    toHouse(immediate ? 0 : timing().lead * SECONDS)
    if (curtains) cinema?.setCurtains?.(1, { immediate })
    announce('interval', '')
  }

  /**
   * Curtain up, lights down, picture now. Returns a promise that settles when
   * the film has been asked to play, which is straight away.
   */
  function begin() {
    if (!enabled) return Promise.resolve(false)
    clear()
    announce('showing', 'Καλή προβολή')

    sound?.clack?.({ on: false })
    openCurtains()
    toShow(timing().down)

    ours = true
    return Promise.resolve(media.play())
      .then(() => true)
      .finally(() => {
        ours = false
      })
  }

  /** The end is in sight: give the room back, slowly, under the last frames. */
  function finish() {
    if (!enabled || state !== 'showing') return
    announce('ending', '')
    clear()
    sound?.clack?.({ on: true })
    const up = timing().lead * SECONDS
    toHouse(up)
    timer = setTimeout(() => announce('interval', 'Τέλος προβολής'), up)
  }

  /**
   * The hook. `media.play` is wrapped rather than listened to, because the
   * ceremony has to know that this play is the start of a screening and not
   * someone coming back from a pause.
   */
  const originalPlay = media.play.bind(media)
  media.play = (...args) => {
    if (!enabled || ours || state === 'showing') return originalPlay(...args)
    return begin().then(() => media.isPlaying)
  }

  /**
   * Loading a film with `autoplay` is the other way in, and the commoner one:
   * it is what the "Παίξε" button next to the link field does. Without this the
   * ceremony would only happen when you pressed play on an already loaded film,
   * which is the one time people do not expect it.
   */
  const originalLoad = media.load.bind(media)
  media.load = (source, loadOptions = {}) => {
    if (!enabled || ours || !loadOptions.autoplay) return originalLoad(source, loadOptions)
    return Promise.resolve(originalLoad(source, { ...loadOptions, autoplay: false })).then((result) => {
      begin()
      return result
    })
  }

  /**
   * The clock, which is also the safety net.
   *
   * Watching the time rather than waiting for `ended` is the whole point: by
   * the time a film has ended, bringing the house back is too late. But it does
   * a second job that turns out to matter more. Whatever happened before, if a
   * film is running and the end is not in sight, the room belongs to the film:
   * curtain open, lights down. So a ceremony that was skipped, interrupted or
   * confused by some earlier film puts itself right within half a second,
   * instead of leaving you watching a film with the lights on.
   */
  const offTime = media.on('timeupdate', () => {
    if (!enabled) return
    const total = media.duration
    const at = media.currentTime
    // A clip shorter than the fade itself, and a live stream with no end at
    // all, are both left to the `ended` event below.
    const known = Number.isFinite(total) && total > BEFORE_END_S / 2
    const left = known ? total - at : Infinity
    const lead = timing().lead

    if (state === 'showing') {
      if (known && left <= lead) finish()
      return
    }

    // Not showing, but the film is running and nowhere near its end: this is a
    // screening, whether the ceremony noticed it or not.
    if (media.isPlaying && left > lead + 1) {
      announce('showing', '')
      clear()
      openCurtains()
      toShow(timing().down)
    }
  })

  const offEnded = media.on('ended', () => {
    // Either the film was too short to see the end coming, or it stopped early.
    if (state === 'showing') finish()
  })

  const offSource = media.on('sourcechange', () => {
    // A new film means the ceremony is owed again.
    clear()
    if (state !== 'interval') announce('interval', '')
  })

  return {
    get state() {
      return state
    },
    get enabled() {
      return enabled
    },
    set enabled(value) {
      enabled = !!value
      if (!enabled) clear()
    },
    begin,
    finish,
    toInterval,
    /** Skip the fade: the screening look at once, and go. */
    skip() {
      clear()
      openCurtains()
      toShow(0)
      announce('showing', '')
      ours = true
      return Promise.resolve(originalPlay()).finally(() => {
        ours = false
      })
    },
    dispose() {
      clear()
      offTime?.()
      offEnded?.()
      offSource?.()
      media.play = originalPlay
      media.load = originalLoad
    },
  }
}

export default createShowtime

/**
 * The screen lighting up the room.
 *
 * Every ~10 frames the movie is drawn into an invisible 8x8 canvas. That is
 * 64 pixels, cheap enough to do while the film plays, and enough to know the
 * average colour and brightness of the current shot. The result is handed to
 * the scene through `lighting.setScreenLight(...)` when that function exists.
 *
 * If the scene does not offer it, we fall back to tinting the two point
 * lights the hall already has in front of the screen, remembering their
 * original colour so dispose() puts everything back.
 */

const SAMPLE_SIZE = 8

/**
 * The scene reads intensity as "1 = a normal bright frame", while the average
 * luma of a real frame sits nearer 0.4. This lifts one into the other, and
 * leaves headroom above 1 for a white flash.
 */
const INTENSITY_SCALE = 2.4
const INTENSITY_MAX = 3

/** How many failed reads in a row before we stop trying. */
const MAX_FAILURES = 3

/**
 * @param {object} options
 * @param {HTMLVideoElement} options.getVideo returns the current video element
 * @param {object} [options.lighting] the scene's lighting handle
 * @param {number} [options.everyFrames=10]
 * @param {number} [options.smoothing=0.12] 0 = frozen, 1 = instant
 */
export function createScreenLight(options = {}) {
  const getVideo = options.getVideo
  const lighting = options.lighting || null
  const everyFrames = Math.max(1, Math.round(options.everyFrames ?? 10))
  const smoothing = Math.min(Math.max(options.smoothing ?? 0.12, 0.01), 1)

  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE_SIZE
  canvas.height = SAMPLE_SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  const state = {
    frame: 0,
    enabled: !!ctx,
    // Current smoothed reading, 0..1 per channel.
    r: 0.5,
    g: 0.5,
    b: 0.6,
    brightness: 0,
    failures: 0,
    disposed: false,
  }

  // --- fallback: tint the lights the hall already has ---------------------
  const fallbackLights = []
  if (lighting && typeof lighting.setScreenLight !== 'function' && lighting.lights) {
    for (const key of ['screenWash', 'screenBounce']) {
      const light = lighting.lights[key]
      if (light && light.isLight && light.color) {
        fallbackLights.push({
          light,
          baseColor: light.color.clone(),
          baseIntensity: light.intensity,
        })
      }
    }
  }

  const TINT = 0.65

  function applyFallback() {
    for (const entry of fallbackLights) {
      // Part way between the room's own tint and the colour on screen, so a
      // dark shot never kills the light completely.
      const base = entry.baseColor
      entry.light.color.setRGB(
        base.r + (state.r - base.r) * TINT,
        base.g + (state.g - base.g) * TINT,
        base.b + (state.b - base.b) * TINT,
      )
      entry.light.intensity = entry.baseIntensity * (0.35 + state.brightness * 1.15)
    }
  }

  function publish() {
    const hex =
      (Math.round(state.r * 255) << 16) | (Math.round(state.g * 255) << 8) | Math.round(state.b * 255)

    const intensity = Math.min(state.brightness * INTENSITY_SCALE, INTENSITY_MAX)

    const detail = {
      color: hex,
      intensity,
      brightness: state.brightness,
      r: state.r,
      g: state.g,
      b: state.b,
    }

    if (lighting && typeof lighting.setScreenLight === 'function') {
      try {
        // The scene's own damping smooths this further, so cuts never strobe.
        lighting.setScreenLight(hex, intensity)
      } catch (err) {
        console.warn('[media] lighting.setScreenLight failed', err)
      }
    } else if (fallbackLights.length) {
      applyFallback()
    }

    return detail
  }

  /**
   * Call once per rendered frame. Reads the picture only every Nth frame.
   * @returns {object|null} the reading when one was taken
   */
  function sample() {
    if (!state.enabled || state.disposed) return null

    state.frame += 1
    if (state.frame % everyFrames !== 0) return null

    const video = typeof getVideo === 'function' ? getVideo() : getVideo
    if (!video || video.readyState < 2 || !video.videoWidth) return null

    let data
    try {
      ctx.drawImage(video, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
      data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data
      state.failures = 0
    } catch (err) {
      // A cross origin movie without CORS headers taints the canvas and can
      // never be read. Give up only after it fails repeatedly, so one bad
      // frame does not freeze the room light for the whole screening.
      state.failures += 1
      if (state.failures >= MAX_FAILURES) {
        state.enabled = false
        console.warn('[media] Το φως της αίθουσας δεν διαβάζει αυτό το βίντεο.', err)
      }
      return null
    }

    let r = 0
    let g = 0
    let b = 0
    const pixels = SAMPLE_SIZE * SAMPLE_SIZE
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]
      g += data[i + 1]
      b += data[i + 2]
    }
    r = r / pixels / 255
    g = g / pixels / 255
    b = b / pixels / 255

    // Rec.709 luma: how bright the shot feels, not just how big the numbers are.
    const brightness = 0.2126 * r + 0.7152 * g + 0.0722 * b

    state.r += (r - state.r) * smoothing
    state.g += (g - state.g) * smoothing
    state.b += (b - state.b) * smoothing
    state.brightness += (brightness - state.brightness) * smoothing

    return publish()
  }

  /**
   * Light the room without being able to read the picture.
   *
   * A YouTube or Vimeo embed lives in its own iframe and no browser will let us
   * sample it, so instead of leaving the hall dead we run a slow, plausible
   * wander around a neutral screen white. Not the real film, but the room keeps
   * breathing with it.
   *
   * @param {number} elapsed seconds since the film started
   */
  function simulate(elapsed = 0) {
    if (state.disposed) return null
    const wander = 0.5 + Math.sin(elapsed * 0.31) * 0.12 + Math.sin(elapsed * 0.13 + 1.7) * 0.08
    state.r = 0.52 + Math.sin(elapsed * 0.09) * 0.05
    state.g = 0.54
    state.b = 0.6 + Math.sin(elapsed * 0.07 + 2.2) * 0.05
    state.brightness = Math.max(0.12, wander)
    return publish()
  }

  /** Fade the spill away, eg when the movie stops. */
  function reset() {
    state.brightness = 0
    for (const entry of fallbackLights) {
      entry.light.color.copy(entry.baseColor)
      entry.light.intensity = entry.baseIntensity
    }
  }

  function dispose() {
    if (state.disposed) return
    state.disposed = true
    reset()
    canvas.width = 0
    canvas.height = 0
  }

  return {
    sample,
    simulate,
    reset,
    dispose,
    get reading() {
      return { r: state.r, g: state.g, b: state.b, brightness: state.brightness }
    },
    get usesFallback() {
      return fallbackLights.length > 0 && !(lighting && typeof lighting.setScreenLight === 'function')
    },
  }
}

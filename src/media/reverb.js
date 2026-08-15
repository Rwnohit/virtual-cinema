/**
 * Room reverb for the movie soundtrack.
 *
 * The impulse response is built at runtime, so there is no audio asset to
 * ship: shaped noise with a progressive low pass for air absorption, plus a
 * handful of early reflections so the tail reads as "big room with side
 * walls" instead of a generic wash. A recorded IR can be loaded instead with
 * loadImpulseResponse().
 */

/**
 * A cinema is not a concert hall. Every surface is there to kill the sound:
 * carpet on the floor, fabric on the walls, upholstery on 150 seats.
 *
 * Design targets actually used for cinemas, mid band (500-4000 Hz):
 *   small screening room, under 200 m3 ......... 0.25-0.35 s
 *   standard multiplex, 500-1500 m3 ............ 0.35-0.55 s
 *   large multiplex, 1500-3500 m3 .............. 0.45-0.65 s
 * and the decay is not flat with frequency: the same specification asks for
 * roughly 0.40-0.70 s in the bass against 0.28-0.45 s in the top. Dolby's
 * theatre guidelines put it as a rule - reverberation time rises at low
 * frequencies, falls at high ones, smoothly, with no band above 150 Hz longer
 * than the one below it. The progressive low pass below does exactly that: the
 * tail darkens as it dies, so the highs are gone before the bass is.
 *
 * `seconds` is the buffer length, not RT60; the (1-t)^decay envelope means the
 * audible tail is roughly 0.85 of it. So cinema at 0.6 s reads as about 0.5 s
 * of decay, which is where a real multiplex sits.
 */
export const REVERB_PRESETS = {
  'screening-room': { seconds: 0.4, decay: 4.4, damping: 0.8, earlyGain: 0.5, mix: 0.07 },
  cinema: { seconds: 0.6, decay: 3.6, damping: 0.7, earlyGain: 0.55, mix: 0.11 },
  imax: { seconds: 0.85, decay: 3.0, damping: 0.58, earlyGain: 0.6, mix: 0.16 },
  dry: { seconds: 0.22, decay: 6.0, damping: 0.86, earlyGain: 0.22, mix: 0.0 },
}

export const DEFAULT_REVERB_PRESET = 'cinema'

// Early reflection taps in seconds. Close in and few: the side walls answer
// fast in a treated room, and then nothing comes back at all.
const EARLY_TAPS = [0.009, 0.015, 0.022, 0.031, 0.042, 0.055, 0.071]

function pseudoNoise(seed) {
  // Deterministic noise, so two runs of the app sound exactly the same.
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return (state / 0xffffffff) * 2 - 1
  }
}

/**
 * @param {BaseAudioContext} context
 * @param {string|object} [options] preset name, or an object overriding it
 * @returns {AudioBuffer}
 */
export function createImpulseResponse(context, options = {}) {
  const preset =
    typeof options === 'string'
      ? REVERB_PRESETS[options] || REVERB_PRESETS[DEFAULT_REVERB_PRESET]
      : { ...REVERB_PRESETS[options.preset || DEFAULT_REVERB_PRESET], ...options }

  const sampleRate = context.sampleRate
  const length = Math.max(1, Math.floor(preset.seconds * sampleRate))
  const buffer = context.createBuffer(2, length, sampleRate)

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    const noise = pseudoNoise(channel === 0 ? 0x5eed1 : 0xb0b2)
    let lowpassState = 0

    for (let i = 0; i < length; i++) {
      const t = i / length

      // Air absorption: the tail gets darker as it dies away.
      const coefficient = Math.max(0.02, 1 - preset.damping * (0.35 + t))
      lowpassState += coefficient * (noise() - lowpassState)

      data[i] = lowpassState * Math.pow(1 - t, preset.decay)
    }

    // Early reflections, offset per channel so the room feels wide.
    EARLY_TAPS.forEach((tap, index) => {
      const skew = channel === 0 ? 1 : 1.07
      const position = Math.floor(tap * skew * sampleRate)
      if (position >= length) return
      const gain = preset.earlyGain * Math.pow(0.72, index) * (channel === 0 ? 1 : -0.85)
      data[position] += gain
    })
  }

  return buffer
}

/**
 * Load a recorded impulse response (wav/flac) instead of the synthetic one.
 * @returns {Promise<AudioBuffer>}
 */
export async function loadImpulseResponse(context, url) {
  const response = await fetch(url, { mode: 'cors' })
  if (!response.ok) throw new Error(`[media] impulse response ${url} -> HTTP ${response.status}`)
  const bytes = await response.arrayBuffer()
  return await context.decodeAudioData(bytes)
}

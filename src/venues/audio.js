/**
 * The sound of the rooms you can walk into: rain, thunder, a house settling, a
 * fire, a heartbeat.
 *
 * Same philosophy as src/sound/foley.js, and for the same reason: not one audio
 * file, so there is nothing to download, nothing to wait for and no two thunder
 * claps that are ever identical. Every voice is a burst of noise shaped by a
 * filter that decides what it is made of and by an envelope that decides how
 * hard it happened.
 *
 * This module never touches the mixing desk in src/sound/. It is handed a
 * destination - the room channel of that desk when there is one - and plays
 * into it, so the viewer's own "air and ventilation" fader still has the last
 * word over everything here.
 *
 *   const voices = createVenueAudio({ context, destination })
 *   voices.setRain(0.6)
 *   voices.thunder({ level: 0.8 })
 */

const NOISE_SECONDS = 3

const rand = (min, max) => min + Math.random() * (max - min)
const clamp01 = (value) => Math.min(Math.max(Number(value) || 0, 0), 1)

/** White noise: the raw material of rain, thunder and every creak below. */
function whiteNoise(context) {
  const buffer = context.createBuffer(1, context.sampleRate * NOISE_SECONDS, context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
  return buffer
}

/** Brown noise: white noise integrated, so it leans low. Wind, fire, weight. */
function brownNoise(context) {
  const buffer = context.createBuffer(1, context.sampleRate * NOISE_SECONDS, context.sampleRate)
  const data = buffer.getChannelData(0)
  let last = 0
  for (let i = 0; i < data.length; i += 1) {
    const white = Math.random() * 2 - 1
    last = (last + 0.02 * white) / 1.02
    data[i] = last * 3.5
  }
  return buffer
}

/** Everything a panel can call when there is no Web Audio at all. */
function silent() {
  const noop = () => {}
  return {
    available: false,
    master: null,
    setRain: noop,
    setFire: noop,
    thunder: noop,
    creak: noop,
    doorAway: noop,
    floorCreak: noop,
    heartbeat: noop,
    scuttle: noop,
    crackle: noop,
    setLevel: noop,
    stopAll: noop,
    dispose: noop,
  }
}

/**
 * @param {{ context?: BaseAudioContext, destination?: AudioNode }} options
 */
export function createVenueAudio(options = {}) {
  const context = options.context
  if (!context || typeof context.createGain !== 'function') return silent()

  const master = context.createGain()
  master.gain.value = 1
  master.connect(options.destination ?? context.destination)

  let white = null
  let brown = null
  const noise = () => (white ??= whiteNoise(context))
  const rumbleNoise = () => (brown ??= brownNoise(context))

  let disposed = false
  const loops = new Set()

  /* ----------------------------------------------------------------------- */
  /* building blocks                                                          */
  /* ----------------------------------------------------------------------- */

  /**
   * A burst of noise through one filter, with an attack/decay envelope.
   * Self cleaning: every node is dropped when the source stops.
   */
  function burst({
    at = context.currentTime,
    duration = 0.2,
    attack = 0.004,
    gain = 0.2,
    type = 'bandpass',
    frequency = 900,
    endFrequency = null,
    Q = 1,
    pan = 0,
    rate = 1,
    brownish = false,
  }) {
    if (disposed) return
    const source = context.createBufferSource()
    source.buffer = brownish ? rumbleNoise() : noise()
    source.playbackRate.value = rate
    // Thunder outlives the noise buffer. Looping it costs nothing (the third
    // argument of start() still stops it on time) and without this a long roll
    // goes silent halfway through while its envelope carries on.
    if (duration + 0.1 >= NOISE_SECONDS) source.loop = true

    const filter = context.createBiquadFilter()
    filter.type = type
    filter.Q.value = Q
    filter.frequency.setValueAtTime(frequency, at)
    if (endFrequency) filter.frequency.exponentialRampToValueAtTime(endFrequency, at + duration)

    const envelope = context.createGain()
    envelope.gain.setValueAtTime(0.0001, at)
    envelope.gain.linearRampToValueAtTime(gain, at + attack)
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration)

    const panner = context.createStereoPanner?.()
    if (panner) panner.pan.value = pan

    source.connect(filter).connect(envelope)
    const out = panner ? envelope.connect(panner) : envelope
    out.connect(master)

    // Start somewhere random in the buffer, so two bursts are never the same.
    const offset = Math.random() * Math.max(NOISE_SECONDS - duration - 0.1, 0.01)
    source.start(at, offset, duration + 0.08)
    source.stop(at + duration + 0.08)
    source.onended = () => {
      source.disconnect()
      filter.disconnect()
      envelope.disconnect()
      panner?.disconnect()
    }
  }

  /** A short sine thump: the weight behind an impact. */
  function thump({
    at = context.currentTime,
    frequency = 70,
    endFrequency = 40,
    duration = 0.16,
    gain = 0.3,
    type = 'sine',
  }) {
    if (disposed) return
    const osc = context.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(frequency, at)
    osc.frequency.exponentialRampToValueAtTime(Math.max(endFrequency, 8), at + duration)

    const envelope = context.createGain()
    envelope.gain.setValueAtTime(0.0001, at)
    envelope.gain.linearRampToValueAtTime(gain, at + 0.008)
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration)

    osc.connect(envelope).connect(master)
    osc.start(at)
    osc.stop(at + duration + 0.03)
    osc.onended = () => {
      osc.disconnect()
      envelope.disconnect()
    }
  }

  /** A looping bed that can be faded in and out and torn down on the way out. */
  function makeLoop(build) {
    const loop = build()
    loops.add(loop)
    return loop
  }

  function killLoop(loop) {
    if (!loop) return
    loops.delete(loop)
    const now = context.currentTime
    loop.gain.gain.cancelScheduledValues(now)
    loop.gain.gain.setValueAtTime(Math.max(loop.gain.gain.value, 0.0001), now)
    loop.gain.gain.linearRampToValueAtTime(0.0001, now + 0.35)
    setTimeout(() => {
      try {
        for (const node of loop.sources) node.stop()
      } catch {
        /* already stopped */
      }
      for (const node of loop.nodes) node.disconnect?.()
    }, 500)
  }

  /* ----------------------------------------------------------------------- */
  /* rain                                                                     */
  /* ----------------------------------------------------------------------- */

  /**
   * Rain is filtered noise and nothing else.
   *
   * Two layers, because one never sounds like weather: a wide low body (the
   * street, the roof, everything at once) and a narrow bright band around
   * 1.8 kHz, which is the water actually hitting the glass in front of you. A
   * very slow oscillator on the level does the gusts - without it the ear works
   * out inside ten seconds that it is listening to a loop.
   */
  let rainLoop = null
  let rainLevel = 0

  function buildRain() {
    const body = context.createBufferSource()
    body.buffer = noise()
    body.loop = true
    body.playbackRate.value = 0.85

    const bodyLow = context.createBiquadFilter()
    bodyLow.type = 'lowpass'
    bodyLow.frequency.value = 1400
    bodyLow.Q.value = 0.6

    const bodyHigh = context.createBiquadFilter()
    bodyHigh.type = 'highpass'
    bodyHigh.frequency.value = 260
    bodyHigh.Q.value = 0.5

    const glass = context.createBufferSource()
    glass.buffer = noise()
    glass.loop = true
    glass.playbackRate.value = 1.15

    const glassBand = context.createBiquadFilter()
    glassBand.type = 'bandpass'
    glassBand.frequency.value = 1850
    glassBand.Q.value = 0.9

    const glassGain = context.createGain()
    glassGain.gain.value = 0.5

    const gain = context.createGain()
    gain.gain.value = 0.0001

    // The gusts. 0.05 Hz is one swell every twenty seconds, which is about how
    // long real rain takes to lean on a window and back off again.
    const gust = context.createOscillator()
    gust.type = 'sine'
    gust.frequency.value = 0.05
    const gustDepth = context.createGain()
    gustDepth.gain.value = 0
    gust.connect(gustDepth).connect(gain.gain)

    body.connect(bodyHigh).connect(bodyLow).connect(gain)
    glass.connect(glassBand).connect(glassGain).connect(gain)
    gain.connect(master)

    body.start()
    glass.start()
    gust.start()

    return {
      gain,
      gustDepth,
      sources: [body, glass, gust],
      nodes: [body, bodyHigh, bodyLow, glass, glassBand, glassGain, gust, gustDepth, gain],
    }
  }

  /** @param {number} level 0 = dry night, 1 = it is hammering down */
  function setRain(level) {
    if (disposed) return
    rainLevel = clamp01(level)
    if (rainLevel <= 0.005) {
      if (rainLoop) {
        killLoop(rainLoop)
        rainLoop = null
      }
      return
    }
    if (!rainLoop) rainLoop = makeLoop(buildRain)
    const now = context.currentTime
    // Rain gets louder and brighter together: a downpour is not a drizzle with
    // the volume up, it has more top end in it.
    rainLoop.gain.gain.setTargetAtTime(0.006 + 0.075 * rainLevel * rainLevel, now, 1.2)
    rainLoop.gustDepth.gain.setTargetAtTime(0.02 * rainLevel, now, 1.2)
  }

  /* ----------------------------------------------------------------------- */
  /* fire                                                                     */
  /* ----------------------------------------------------------------------- */

  let fireLoop = null

  function buildFire() {
    const source = context.createBufferSource()
    source.buffer = rumbleNoise()
    source.loop = true
    source.playbackRate.value = 0.7

    const tone = context.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = 420
    tone.Q.value = 0.7

    const gain = context.createGain()
    gain.gain.value = 0.0001

    // The breathing of a fire, slower and less regular than a gust of rain.
    const breath = context.createOscillator()
    breath.type = 'sine'
    breath.frequency.value = 0.14
    const breathDepth = context.createGain()
    breathDepth.gain.value = 0.004
    breath.connect(breathDepth).connect(gain.gain)

    source.connect(tone).connect(gain).connect(master)
    source.start()
    breath.start()

    return { gain, sources: [source, breath], nodes: [source, tone, gain, breath, breathDepth] }
  }

  function setFire(level) {
    if (disposed) return
    const value = clamp01(level)
    if (value <= 0.005) {
      if (fireLoop) {
        killLoop(fireLoop)
        fireLoop = null
      }
      return
    }
    if (!fireLoop) fireLoop = makeLoop(buildFire)
    fireLoop.gain.gain.setTargetAtTime(0.012 + 0.03 * value, context.currentTime, 1.5)
  }

  /** One log popping. The venue calls this at random, a few times a minute. */
  function crackle({ level = 1 } = {}) {
    const now = context.currentTime + 0.005
    burst({
      at: now,
      duration: rand(0.03, 0.07),
      gain: rand(0.02, 0.055) * level,
      type: 'bandpass',
      frequency: rand(1300, 3400),
      Q: rand(1.5, 4),
      pan: rand(-0.35, 0.35),
    })
    if (Math.random() < 0.4) {
      burst({
        at: now + rand(0.04, 0.13),
        duration: 0.035,
        gain: 0.02 * level,
        type: 'bandpass',
        frequency: rand(900, 2200),
        Q: 2.5,
        pan: rand(-0.3, 0.3),
      })
    }
  }

  /* ----------------------------------------------------------------------- */
  /* the weather and the house                                                */
  /* ----------------------------------------------------------------------- */

  /**
   * Thunder: a long low noise burst with a very slow decay, plus a sub that
   * falls away underneath it. `level` is really distance - far thunder is not
   * quiet thunder, it is thunder with the top end taken off it by two
   * kilometres of air, so the filter moves with the volume.
   */
  function thunder({ level = 0.6 } = {}) {
    if (disposed) return
    const value = clamp01(level)
    const now = context.currentTime + 0.02
    const duration = 2.2 + value * 2.6

    burst({
      at: now,
      duration,
      attack: 0.05 + (1 - value) * 0.25,
      gain: 0.05 + 0.16 * value,
      type: 'lowpass',
      frequency: 90 + 260 * value,
      endFrequency: 45 + 40 * value,
      Q: 1.4,
      pan: rand(-0.5, 0.5),
      brownish: true,
    })

    thump({
      at: now + 0.03,
      frequency: 46 + 18 * value,
      endFrequency: 22,
      duration: 1.1 + value,
      gain: 0.06 + 0.16 * value,
    })

    // Close lightning has a crack on the front of it. Distant lightning does
    // not: that edge is the first thing the air eats.
    if (value > 0.62) {
      burst({
        at: now,
        duration: 0.22,
        attack: 0.002,
        gain: 0.05 * (value - 0.62) * 2.6,
        type: 'bandpass',
        frequency: 1500,
        endFrequency: 420,
        Q: 0.9,
      })
    }

    // The tail coming back off the hills.
    burst({
      at: now + 0.5 + (1 - value) * 0.6,
      duration: duration * 0.8,
      attack: 0.4,
      gain: 0.03 + 0.05 * value,
      type: 'lowpass',
      frequency: 160,
      Q: 0.8,
      brownish: true,
    })
  }

  /**
   * A house settling: wood giving up a fraction of a millimetre at a time.
   *
   * The reason a creak is unmistakable is that it is not one sound but a burst
   * of tiny ones - stick, slip, stick - so this schedules a handful of short
   * grains with a rising pitch rather than one smooth swell.
   */
  function creak({ level = 1, low = false } = {}) {
    if (disposed) return
    const start = context.currentTime + 0.01
    const grains = Math.round(rand(5, 9))
    const span = rand(0.5, 1.1)
    const base = low ? rand(150, 240) : rand(280, 430)
    const pan = rand(-0.7, 0.7)

    for (let i = 0; i < grains; i += 1) {
      const t = i / (grains - 1)
      burst({
        at: start + t * span + rand(0, 0.02),
        duration: rand(0.05, 0.13),
        attack: 0.01,
        gain: (0.012 + 0.02 * (1 - Math.abs(t - 0.5) * 2)) * level,
        type: 'bandpass',
        frequency: base * (1 + t * 0.55),
        Q: rand(8, 16),
        pan,
      })
    }
    thump({ at: start, frequency: rand(80, 120), endFrequency: 52, duration: 0.3, gain: 0.05 * level })
  }

  /** A door, somewhere else in the house. Muffled, because it is not this room. */
  function doorAway({ level = 1 } = {}) {
    if (disposed) return
    const now = context.currentTime + 0.01
    const pan = rand(-0.8, 0.8)

    burst({
      at: now,
      duration: 0.85,
      attack: 0.08,
      gain: 0.03 * level,
      type: 'bandpass',
      frequency: 340,
      endFrequency: 760,
      Q: 9,
      pan,
    })
    burst({
      at: now + 0.9,
      duration: 0.2,
      attack: 0.004,
      gain: 0.05 * level,
      type: 'lowpass',
      frequency: 420,
      Q: 0.8,
      pan,
      brownish: true,
    })
    thump({ at: now + 0.9, frequency: 92, endFrequency: 44, duration: 0.32, gain: 0.09 * level })
  }

  /** The floor taking a step that nobody took. */
  function floorCreak({ level = 1 } = {}) {
    creak({ level: level * 0.8, low: true })
  }

  /**
   * One heartbeat: two thumps, the second softer and a third of a second later,
   * which is the interval that makes a pulse read as a pulse.
   */
  function heartbeat({ level = 1, rate = 1 } = {}) {
    if (disposed) return
    const now = context.currentTime + 0.01
    const gap = 0.3 / Math.max(rate, 0.5)

    thump({ at: now, frequency: 58, endFrequency: 26, duration: 0.19, gain: 0.16 * level })
    burst({
      at: now,
      duration: 0.11,
      gain: 0.02 * level,
      type: 'lowpass',
      frequency: 180,
      Q: 0.7,
      brownish: true,
    })
    thump({ at: now + gap, frequency: 50, endFrequency: 24, duration: 0.16, gain: 0.1 * level })
  }

  /** Something small, moving fast, close to the floor. */
  function scuttle({ level = 1, pan = 0 } = {}) {
    if (disposed) return
    const now = context.currentTime + 0.005
    const steps = Math.round(rand(3, 6))
    for (let i = 0; i < steps; i += 1) {
      burst({
        at: now + i * rand(0.035, 0.07),
        duration: 0.022,
        attack: 0.002,
        gain: 0.012 * level,
        type: 'highpass',
        frequency: rand(3200, 6000),
        Q: 0.8,
        pan,
      })
    }
  }

  /** Master level for everything this room makes, so leaving it is silent. */
  function setLevel(value) {
    if (disposed) return
    master.gain.setTargetAtTime(clamp01(value), context.currentTime, 0.15)
  }

  function stopAll() {
    setRain(0)
    setFire(0)
  }

  function dispose() {
    if (disposed) return
    stopAll()
    disposed = true
    for (const loop of [...loops]) killLoop(loop)
    setTimeout(() => master.disconnect(), 700)
  }

  return {
    available: true,
    master,
    setRain,
    setFire,
    thunder,
    creak,
    doorAway,
    floorCreak,
    heartbeat,
    scuttle,
    crackle,
    setLevel,
    stopAll,
    dispose,
    get rainLevel() {
      return rainLevel
    },
  }
}

export default createVenueAudio

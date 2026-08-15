/**
 * The audience: a room full of people who are trying to be quiet.
 *
 * An empty auditorium measures about 25-30 dBA. Put people in it and the floor
 * rises to roughly 35 dBA without anyone saying a word, purely from breathing
 * and clothing. So the whole module is driven by one number, occupancy, and at
 * zero it is genuinely silent, not "quiet".
 *
 * Nothing is on a grid. Every one off sound is scheduled as a Poisson process
 * (interval = -ln(U) / rate), which is what a crowd actually is: independent
 * people doing independent things. A metronomic cough would be worse than no
 * cough at all. The rates come from measured behaviour: concert audiences
 * average about 0.025 coughs per person per minute, roughly 1.5 an hour, about
 * double the everyday rate.
 *
 * Everything is synthesised, so there is no file to load and no two coughs are
 * the same.
 *
 *   const crowd = createCrowd({ context, destination })
 *   crowd.setOccupancy(0.6)
 *   crowd.absorption   // 0..1, hand this to the reverb: bodies eat the tail
 */

const NOISE_SECONDS = 2

/** Nominal house size, so the event rates are per person and not per vibe. */
const DEFAULT_SEATS = 150

/** Events per person per hour, from measured audience behaviour. */
const RATES_PER_PERSON_HOUR = {
  cough: 1.5,
  shift: 20,
  rustle: 60,
  breath: 6,
  laugh: 0.6,
}

const rand = (min, max) => min + Math.random() * (max - min)

const clamp01 = (value) => Math.min(Math.max(Number(value) || 0, 0), 1)

/** White noise: fabric, breath, the top of a cough. */
function whiteNoise(context) {
  const buffer = context.createBuffer(1, context.sampleRate * NOISE_SECONDS, context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
  return buffer
}

/** Brown noise: white noise integrated, so it leans low. The murmur bed. */
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

/**
 * @param {{ context: BaseAudioContext, destination?: AudioNode, seats?: number, occupancy?: number }} options
 */
export function createCrowd(options = {}) {
  const context = options.context
  if (!context) throw new Error('[sound] createCrowd needs an AudioContext')

  const seats = Math.max(1, options.seats ?? DEFAULT_SEATS)

  let occupancy = clamp01(options.occupancy ?? 0)
  let spread = 0.6
  let disposed = false
  let running = false
  // stop() is the app muting the room, not an empty house: it has to survive a
  // later occupancy change, otherwise dragging the slider would bring the
  // audience back while the sound is switched off.
  let stopped = false
  let bed = null

  const timers = {}
  const noiseBuffer = whiteNoise(context)
  let brownBuffer = null

  /* ----------------------------------------------------------------------- */
  /* the shape of "behind you"                                                */
  /* ----------------------------------------------------------------------- */

  const out = context.createGain()
  out.gain.value = 1
  out.connect(options.destination ?? context.destination)

  // Everything the crowd makes goes through here first.
  const bus = context.createGain()
  bus.gain.value = 1

  // Sound arriving from behind loses its top end to the pinna and gains a
  // little around 1 kHz. That, plus the fact that the nearest row is still a
  // couple of metres away, is why the audience never sounds like it is in
  // front of you even though there is no HRTF panner here.
  const rearTone = context.createBiquadFilter()
  rearTone.type = 'lowpass'
  rearTone.frequency.value = 5200
  rearTone.Q.value = 0.5

  const rearBody = context.createBiquadFilter()
  rearBody.type = 'peaking'
  rearBody.frequency.value = 1050
  rearBody.Q.value = 0.9
  rearBody.gain.value = 2.5

  const centre = context.createGain()
  centre.gain.value = 0.55

  const sides = context.createGain()
  sides.gain.value = spread

  bus.connect(rearTone)
  rearTone.connect(rearBody)
  rearBody.connect(centre)
  centre.connect(out)

  // Two short delays wide left and right: not reverb, just the fact that a
  // hundred people are spread over ten metres and none of them are at a point.
  for (const [time, pan] of [
    [0.011, -0.85],
    [0.019, 0.9],
    [0.029, -0.45],
  ]) {
    const delay = context.createDelay(0.1)
    delay.delayTime.value = time
    const panner = context.createStereoPanner?.()
    rearBody.connect(delay)
    if (panner) {
      panner.pan.value = pan
      delay.connect(panner)
      panner.connect(sides)
    } else {
      delay.connect(sides)
    }
  }
  sides.connect(out)

  /* ----------------------------------------------------------------------- */
  /* one off voices                                                           */
  /* ----------------------------------------------------------------------- */

  /**
   * A burst of noise through one filter with an attack/decay envelope. Self
   * cleaning: every node is dropped when the source stops.
   */
  function burst({
    at = context.currentTime,
    duration = 0.1,
    attack = 0.004,
    gain = 0.05,
    type = 'bandpass',
    frequency = 1000,
    endFrequency = null,
    Q = 1,
    pan = 0,
    rate = 1,
  }) {
    const source = context.createBufferSource()
    source.buffer = noiseBuffer
    source.playbackRate.value = rate
    const offset = Math.random() * (NOISE_SECONDS - duration - 0.05)

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
    const tail = panner ? envelope.connect(panner) : envelope
    tail.connect(bus)

    source.start(at, offset, duration + 0.05)
    source.stop(at + duration + 0.05)
    source.onended = () => {
      source.disconnect()
      filter.disconnect()
      envelope.disconnect()
      panner?.disconnect()
    }
  }

  /** Where in the house this one came from. Never dead centre, that is the screen. */
  function seatPan() {
    const side = Math.random() < 0.5 ? -1 : 1
    return side * rand(0.2, 0.95)
  }

  /**
   * A cough: a pressure release low down, then the noisy rasp on top. Real
   * coughs are loud, and a cough in a half empty room is exactly as loud as one
   * in a full room - only the odds change. So the level here does not follow
   * occupancy, only the rate does.
   */
  function cough() {
    const now = context.currentTime + 0.02
    const pan = seatPan()
    const size = rand(0.7, 1.15)
    burst({ at: now, duration: 0.075, attack: 0.006, gain: 0.075 * size, type: 'bandpass', frequency: rand(320, 460), endFrequency: 190, Q: 1.4, pan })
    burst({ at: now + 0.01, duration: 0.13, attack: 0.01, gain: 0.032 * size, type: 'bandpass', frequency: rand(1300, 2200), Q: 0.8, pan })
    // Some coughs are a double, and that is what gives them away as a person.
    if (Math.random() < 0.4) {
      burst({ at: now + rand(0.28, 0.5), duration: 0.09, gain: 0.045 * size, type: 'bandpass', frequency: rand(300, 430), endFrequency: 200, Q: 1.3, pan })
    }
  }

  /** Somebody changing position: upholstery, a hinge, a knee against the seat back. */
  function shift() {
    const now = context.currentTime + 0.02
    const pan = seatPan()
    burst({ at: now, duration: rand(0.18, 0.36), attack: 0.03, gain: rand(0.012, 0.026), type: 'lowpass', frequency: rand(900, 1600), Q: 0.5, pan })
    if (Math.random() < 0.35) {
      burst({ at: now + rand(0.05, 0.15), duration: 0.22, attack: 0.02, gain: 0.014, type: 'bandpass', frequency: rand(380, 620), endFrequency: 260, Q: 5.5, pan })
    }
  }

  /** Clothing. The most common sound in a cinema after the film itself. */
  function rustle() {
    burst({
      at: context.currentTime + 0.02,
      duration: rand(0.05, 0.16),
      attack: 0.012,
      gain: rand(0.004, 0.011),
      type: 'bandpass',
      frequency: rand(1900, 4200),
      Q: 0.7,
      pan: seatPan(),
    })
  }

  /** One audible breath out of a hundred inaudible ones. */
  function breath() {
    const now = context.currentTime + 0.02
    const pan = seatPan()
    burst({ at: now, duration: rand(0.3, 0.55), attack: 0.12, gain: rand(0.006, 0.013), type: 'bandpass', frequency: rand(520, 820), Q: 0.6, pan })
  }

  /**
   * Not a laugh, a suppressed one: three or four pulses through the nose. A
   * full laugh from a synthesiser sounds like a machine, this reads as a person.
   */
  function laugh() {
    const now = context.currentTime + 0.02
    const pan = seatPan()
    const pulses = Math.floor(rand(3, 6))
    const step = rand(0.09, 0.14)
    const base = rand(420, 700)
    for (let i = 0; i < pulses; i += 1) {
      burst({
        at: now + i * step + rand(-0.012, 0.012),
        duration: rand(0.05, 0.08),
        attack: 0.008,
        gain: rand(0.014, 0.026) * (1 - i * 0.15),
        type: 'bandpass',
        frequency: base * rand(0.92, 1.08),
        Q: 2.2,
        pan,
      })
    }
  }

  const voices = { cough, shift, rustle, breath, laugh }

  /* ----------------------------------------------------------------------- */
  /* the bed                                                                  */
  /* ----------------------------------------------------------------------- */

  /**
   * The sound of bodies. Not voices: nobody is talking during the film. This is
   * the collective hush - air moving in and out of a hundred people, clothes
   * settling, and the low frequency mush that a crowd of warm bodies makes.
   */
  function startBed() {
    if (bed || disposed || context.state === 'closed') return
    if (!brownBuffer) brownBuffer = brownNoise(context)

    const gain = context.createGain()
    gain.gain.value = 0.0001
    gain.connect(bus)

    const nodes = [gain]

    // Two decorrelated copies of the same bed, one either side, so it wraps
    // instead of sitting in the middle of your head.
    for (const [rate, pan] of [
      [0.97, -0.75],
      [1.03, 0.8],
    ]) {
      const source = context.createBufferSource()
      source.buffer = brownBuffer
      source.loop = true
      source.playbackRate.value = rate

      const tone = context.createBiquadFilter()
      tone.type = 'lowpass'
      tone.frequency.value = 430
      tone.Q.value = 0.4

      const panner = context.createStereoPanner?.()
      source.connect(tone)
      if (panner) {
        panner.pan.value = pan
        tone.connect(panner)
        panner.connect(gain)
        nodes.push(panner)
      } else {
        tone.connect(gain)
      }
      source.start(rand(0, 0.05))
      nodes.push(source, tone)
    }

    // A whisper of the higher band: clothing and hair, always present, never
    // identifiable. Without it the bed is a rumble and reads as air, not people.
    const hiss = context.createBufferSource()
    hiss.buffer = noiseBuffer
    hiss.loop = true
    const hissTone = context.createBiquadFilter()
    hissTone.type = 'bandpass'
    hissTone.frequency.value = 2400
    hissTone.Q.value = 0.55
    const hissGain = context.createGain()
    hissGain.gain.value = 0.06
    hiss.connect(hissTone).connect(hissGain).connect(gain)
    hiss.start(rand(0, 0.05))
    nodes.push(hiss, hissTone, hissGain)

    // A crowd swells and settles over tens of seconds. Two slow oscillators at
    // unrelated rates never repeat inside a film's running time.
    const drift = context.createOscillator()
    drift.type = 'sine'
    drift.frequency.value = 0.043
    const driftGain = context.createGain()
    driftGain.gain.value = 0.0035
    drift.connect(driftGain).connect(gain.gain)
    drift.start()

    const drift2 = context.createOscillator()
    drift2.type = 'sine'
    drift2.frequency.value = 0.017
    const drift2Gain = context.createGain()
    drift2Gain.gain.value = 0.0022
    drift2.connect(drift2Gain).connect(gain.gain)
    drift2.start()

    nodes.push(drift, driftGain, drift2, drift2Gain)

    bed = { gain, nodes, oscillators: [drift, drift2] }
    applyBedLevel(1.5)
  }

  /**
   * Perceived crowd level is not linear in headcount: doubling the audience is
   * about +3 dB, so the curve is flattened with a power under one. The ceiling
   * is the +5 to +7 dB an occupied house adds over an empty one.
   */
  function applyBedLevel(seconds = 0.6) {
    if (!bed) return
    const level = stopped || occupancy <= 0 ? 0.0001 : 0.004 + 0.052 * Math.pow(occupancy, 0.7)
    const now = context.currentTime
    bed.gain.gain.cancelScheduledValues(now)
    bed.gain.gain.setValueAtTime(Math.max(bed.gain.gain.value, 0.0001), now)
    bed.gain.gain.linearRampToValueAtTime(level, now + seconds)
  }

  /* ----------------------------------------------------------------------- */
  /* scheduling                                                               */
  /* ----------------------------------------------------------------------- */

  /** Events per second for this many people in the seats. */
  function rateOf(kind) {
    if (occupancy <= 0) return 0
    return (RATES_PER_PERSON_HOUR[kind] * seats * occupancy) / 3600
  }

  /**
   * Poisson interarrival. Recomputed every time, so dragging the occupancy
   * slider changes the density of the room within one event.
   */
  function pump(kind) {
    if (disposed) return
    const rate = rateOf(kind)
    if (rate <= 0) {
      // Idle poll, cheap: nothing is playing while the room is empty.
      timers[kind] = setTimeout(() => pump(kind), 1200)
      return
    }
    const wait = (-Math.log(1 - Math.random()) / rate) * 1000
    timers[kind] = setTimeout(() => {
      if (!disposed && occupancy > 0 && running) voices[kind]()
      pump(kind)
    }, Math.min(Math.max(wait, 80), 20000))
  }

  function start() {
    if (disposed) return
    stopped = false
    if (!running) {
      running = true
      for (const kind of Object.keys(voices)) pump(kind)
    }
    // Also the way back from stop(): the bed is still there, just faded out.
    startBed()
    applyBedLevel()
  }

  function stop() {
    running = false
    stopped = true
    for (const kind of Object.keys(timers)) clearTimeout(timers[kind])
    applyBedLevel(0.4)
  }

  /* ----------------------------------------------------------------------- */
  /* api                                                                      */
  /* ----------------------------------------------------------------------- */

  /**
   * 0 = empty house and total silence, 1 = every seat taken.
   */
  function setOccupancy(value) {
    occupancy = clamp01(value)
    if (occupancy > 0 && !running && !stopped) start()
    applyBedLevel()
    return occupancy
  }

  /** How far around the listener the audience sits. */
  function setSpread(value) {
    spread = clamp01(value)
    sides.gain.setTargetAtTime(spread, context.currentTime, 0.08)
    return spread
  }

  function dispose() {
    if (disposed) return
    disposed = true
    stop()
    const dying = bed
    bed = null
    setTimeout(() => {
      if (dying) {
        for (const osc of dying.oscillators) {
          try {
            osc.stop()
          } catch {
            /* already stopped */
          }
        }
        for (const node of dying.nodes) {
          try {
            node.stop?.()
          } catch {
            /* not a source, or already stopped */
          }
          node.disconnect?.()
        }
      }
      for (const node of [bus, rearTone, rearBody, centre, sides, out]) {
        try {
          node.disconnect()
        } catch {
          /* already disconnected */
        }
      }
    }, 600)
  }

  if (occupancy > 0) start()

  return {
    input: bus,
    output: out,
    get occupancy() {
      return occupancy
    },
    get spread() {
      return spread
    },
    /**
     * How much of the reverb tail the audience is eating. One measured hall
     * went from 1.09 s half full to 0.84 s full, so a packed house is worth
     * roughly a quarter of the tail. The mixer scales the wet mix by this.
     */
    get absorption() {
      return occupancy
    },
    setOccupancy,
    setSpread,
    start,
    stop,
    dispose,
  }
}

export default createCrowd

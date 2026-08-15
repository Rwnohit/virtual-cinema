/**
 * Foley: the sounds the room itself makes.
 *
 * Everything here is synthesised from noise and a couple of oscillators, so
 * there is not a single audio file to download and nothing to wait for. That
 * also means every step is slightly different, which is what stops footsteps
 * from turning into a machine gun after ten seconds of walking.
 *
 * Recipe used for all of it: one short burst of noise, shaped by a filter that
 * decides what the material is (carpet, fabric, plastic, metal) and by a gain
 * envelope that decides how hard it was hit.
 *
 *   const foley = createFoley({ context })
 *   foley.step({ running: false, foot: 'left' })
 *   foley.seat({ down: true })
 *   foley.click()
 */

const NOISE_SECONDS = 2

const rand = (min, max) => min + Math.random() * (max - min)

/** One white noise buffer, reused by every voice. */
function whiteNoise(context) {
  const buffer = context.createBuffer(1, context.sampleRate * NOISE_SECONDS, context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
  return buffer
}

/** Brown noise: white noise integrated, so it leans low. Sounds like air. */
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
 * @param {{ context: AudioContext, destination?: AudioNode, roomDestination?: AudioNode, volume?: number }} options
 */
export function createFoley(options = {}) {
  const context = options.context
  if (!context) throw new Error('[sound] createFoley needs an AudioContext')

  const master = context.createGain()
  master.gain.value = options.volume ?? 0.75
  master.connect(options.destination ?? context.destination)

  // The air handling is not foley, it is the building. Given its own output so
  // the mixer can put it on its own fader without dragging the footsteps with
  // it. Falls back to the foley master when nobody is mixing.
  const roomOut = context.createGain()
  roomOut.gain.value = 1
  roomOut.connect(options.roomDestination ?? master)

  // --- the room answering back ---------------------------------------------
  // Not reverb: a cinema is too heavily treated for a tail. What you actually
  // hear is one dull slap off the side walls, gone in a few hundredths of a
  // second. Two short delays through a low pass is exactly that, and it is what
  // stops every footstep from sounding like it was recorded in a padded cell.
  const roomSend = context.createGain()
  roomSend.gain.value = 1

  const slapTone = context.createBiquadFilter()
  slapTone.type = 'lowpass'
  slapTone.frequency.value = 850
  slapTone.Q.value = 0.5

  const slapGain = context.createGain()
  slapGain.gain.value = 0.3

  for (const time of [0.019, 0.031, 0.047]) {
    const delay = context.createDelay(0.2)
    delay.delayTime.value = time
    roomSend.connect(delay)
    delay.connect(slapTone)
  }
  slapTone.connect(slapGain).connect(master)

  const noiseBuffer = whiteNoise(context)
  let brownBuffer = null

  /* ----------------------------------------------------------------------- */
  /* building blocks                                                          */
  /* ----------------------------------------------------------------------- */

  /**
   * A burst of noise through one filter, with an attack/decay envelope.
   * Self cleaning: every node is dropped when the source stops.
   */
  function burst({
    at = context.currentTime,
    duration = 0.1,
    attack = 0.002,
    gain = 0.5,
    type = 'bandpass',
    frequency = 1000,
    endFrequency = null,
    Q = 1,
    pan = 0,
    rate = 1,
    room = true,
  }) {
    const source = context.createBufferSource()
    source.buffer = noiseBuffer
    source.playbackRate.value = rate
    // Start somewhere random in the buffer so two bursts are never identical.
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
    const output = panner ? envelope.connect(panner) : envelope
    output.connect(master)
    if (room) output.connect(roomSend)

    source.start(at, offset, duration + 0.05)
    source.stop(at + duration + 0.05)
    source.onended = () => {
      source.disconnect()
      filter.disconnect()
      envelope.disconnect()
      panner?.disconnect()
    }
  }

  /** A short sine thump: the weight behind an impact. */
  function thump({ at = context.currentTime, frequency = 70, endFrequency = 45, duration = 0.12, gain = 0.4, room = false }) {
    const osc = context.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(frequency, at)
    osc.frequency.exponentialRampToValueAtTime(endFrequency, at + duration)

    const envelope = context.createGain()
    envelope.gain.setValueAtTime(0.0001, at)
    envelope.gain.linearRampToValueAtTime(gain, at + 0.006)
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration)

    osc.connect(envelope)
    envelope.connect(master)
    if (room) envelope.connect(roomSend)
    osc.start(at)
    osc.stop(at + duration + 0.02)
    osc.onended = () => {
      osc.disconnect()
      envelope.disconnect()
    }
  }

  /* ----------------------------------------------------------------------- */
  /* voices                                                                   */
  /* ----------------------------------------------------------------------- */

  /**
   * A footstep on cinema carpet: a soft low thud plus the scuff of the pile.
   * Nothing bright, carpet eats the top end - that is what makes it read as a
   * cinema and not a corridor.
   */
  function step({ running = false, foot = 'left', level = 1 } = {}) {
    const now = context.currentTime + 0.005
    const side = foot === 'left' ? -0.14 : 0.14
    const weight = (running ? 1.35 : 1) * level
    const variation = rand(0.88, 1.12)

    // The heel landing. Most of a footstep on cinema carpet is this: low,
    // short, and swallowed by the underlay.
    thump({
      at: now,
      frequency: rand(66, 82) * variation,
      endFrequency: 38,
      duration: running ? 0.08 : 0.12,
      gain: 0.2 * weight,
      room: true,
    })

    // The pile of the carpet under the sole. Low passed, not band passed:
    // carpet has no top end to give, and that is the whole sound of a cinema.
    burst({
      at: now,
      duration: running ? 0.06 : 0.085,
      gain: 0.055 * weight,
      type: 'lowpass',
      frequency: rand(620, 1050) * variation,
      Q: 0.5,
      pan: side,
      rate: variation,
    })

    // A whisper of shoe leather on top, so it is not a pure thud.
    burst({
      at: now,
      duration: 0.035,
      gain: 0.016 * weight,
      type: 'bandpass',
      frequency: rand(1900, 2600),
      Q: 0.9,
      pan: side,
      rate: variation,
      room: false,
    })

    // Walking has a heel then a toe; running is one flat slap.
    if (!running) {
      burst({
        at: now + rand(0.045, 0.065),
        duration: 0.05,
        gain: 0.022 * weight,
        type: 'lowpass',
        frequency: rand(700, 1000),
        Q: 0.5,
        pan: side * 0.6,
        rate: variation,
      })
    }
  }

  /** Sitting down on, or getting up from, a folding cinema seat. */
  function seat({ down = true } = {}) {
    const now = context.currentTime + 0.01

    if (down) {
      // The cushion takes the weight.
      thump({ at: now, frequency: 74, endFrequency: 38, duration: 0.18, gain: 0.3 })
      // The hinge and the spring, dropping in pitch as the seat folds open.
      burst({
        at: now + 0.02,
        duration: 0.3,
        attack: 0.01,
        gain: 0.1,
        type: 'bandpass',
        frequency: 540,
        endFrequency: 250,
        Q: 6.5,
      })
      // Upholstery.
      burst({ at: now, duration: 0.22, gain: 0.05, type: 'highpass', frequency: 2600, Q: 0.5 })
    } else {
      burst({ at: now, duration: 0.16, gain: 0.045, type: 'highpass', frequency: 2400, Q: 0.5 })
      // The seat springing back up, this time the pitch rises.
      burst({
        at: now + 0.06,
        duration: 0.34,
        attack: 0.02,
        gain: 0.09,
        type: 'bandpass',
        frequency: 280,
        endFrequency: 620,
        Q: 7,
      })
      thump({ at: now + 0.3, frequency: 120, endFrequency: 70, duration: 0.1, gain: 0.13 })
    }
  }

  // The panel sounds are in your hands, not across the hall, so they skip the
  // room send entirely: no slap, no distance.

  /** A button being pressed on the panel. */
  function click() {
    const now = context.currentTime + 0.002
    burst({ at: now, duration: 0.02, gain: 0.09, type: 'bandpass', frequency: 2300, Q: 1.3, room: false })
    thump({ at: now, frequency: 480, endFrequency: 260, duration: 0.035, gain: 0.05 })
  }

  /** The smallest sound in the app: one notch of a slider. */
  function tick({ level = 1 } = {}) {
    burst({
      at: context.currentTime + 0.002,
      duration: 0.012,
      gain: 0.045 * level,
      type: 'highpass',
      frequency: rand(3600, 5200),
      Q: 0.7,
      room: false,
    })
  }

  /** A proper lighting switch: two contacts, one after the other. */
  function clack({ on = true } = {}) {
    const now = context.currentTime + 0.004
    burst({ at: now, duration: 0.03, gain: 0.13, type: 'bandpass', frequency: on ? 1250 : 1050, Q: 3.5 })
    burst({ at: now + 0.045, duration: 0.05, gain: 0.06, type: 'bandpass', frequency: 780, Q: 2.5 })
    thump({ at: now, frequency: 150, endFrequency: 90, duration: 0.06, gain: 0.08 })
  }

  /* ----------------------------------------------------------------------- */
  /* room tone                                                                */
  /* ----------------------------------------------------------------------- */

  let tone = null

  /**
   * The bed under everything: the air handling, and nothing else.
   *
   * A cinema is one of the quietest rooms most people ever sit in - the whole
   * building is designed so you hear the film and not the world. THX certified
   * houses may not exceed NC-30 in any octave band, and premium rooms are built
   * to NC-25, about 33 dBA. Those curves fall about 5 dB per octave: NC-30
   * allows 57 dB at 63 Hz but only 48 dB at 125 Hz and keeps dropping. So room
   * tone here is nearly all bottom end - brown noise through a low pass is
   * already that slope - and it is set far lower than instinct says: you should
   * only notice it when it stops.
   */
  function startRoomTone() {
    if (tone || context.state === 'closed') return
    if (!brownBuffer) brownBuffer = brownNoise(context)

    const air = context.createBufferSource()
    air.buffer = brownBuffer
    air.loop = true

    const airFilter = context.createBiquadFilter()
    airFilter.type = 'lowpass'
    airFilter.frequency.value = 190
    airFilter.Q.value = 0.4

    const airGain = context.createGain()
    airGain.gain.value = 0.0001

    const hum = context.createOscillator()
    hum.type = 'sine'
    hum.frequency.value = 49.5
    const humGain = context.createGain()
    humGain.gain.value = 0.0001

    // Very slow wander, so the bed never sounds like a frozen loop.
    const drift = context.createOscillator()
    drift.type = 'sine'
    drift.frequency.value = 0.06
    const driftGain = context.createGain()
    driftGain.gain.value = 0.003
    drift.connect(driftGain).connect(airGain.gain)

    air.connect(airFilter).connect(airGain).connect(roomOut)
    hum.connect(humGain).connect(roomOut)

    const now = context.currentTime
    airGain.gain.setValueAtTime(0.0001, now)
    airGain.gain.linearRampToValueAtTime(0.012, now + 3)
    humGain.gain.setValueAtTime(0.0001, now)
    humGain.gain.linearRampToValueAtTime(0.0018, now + 3)

    air.start()
    hum.start()
    drift.start()

    tone = { air, hum, drift, airGain, humGain, airFilter, driftGain }
  }

  function stopRoomTone() {
    if (!tone) return
    const now = context.currentTime
    tone.airGain.gain.cancelScheduledValues(now)
    tone.airGain.gain.setValueAtTime(tone.airGain.gain.value, now)
    tone.airGain.gain.linearRampToValueAtTime(0.0001, now + 0.4)
    tone.humGain.gain.linearRampToValueAtTime(0.0001, now + 0.4)
    const dying = tone
    tone = null
    setTimeout(() => {
      try {
        dying.air.stop()
        dying.hum.stop()
        dying.drift.stop()
      } catch {
        /* already stopped */
      }
      Object.values(dying).forEach((node) => node.disconnect?.())
    }, 500)
  }

  function dispose() {
    stopRoomTone()
    setTimeout(() => {
      roomSend.disconnect()
      slapTone.disconnect()
      slapGain.disconnect()
      roomOut.disconnect()
      master.disconnect()
    }, 600)
  }

  return {
    master,
    roomOut,
    step,
    seat,
    click,
    tick,
    clack,
    startRoomTone,
    stopRoomTone,
    get volume() {
      return master.gain.value
    },
    setVolume(value) {
      const level = Math.min(Math.max(Number(value) || 0, 0), 1)
      master.gain.setTargetAtTime(level, context.currentTime, 0.02)
    },
    dispose,
  }
}

export default createFoley

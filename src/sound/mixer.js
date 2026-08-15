/**
 * The mixing desk for the whole room.
 *
 * WHY these numbers: measured cinema practice, not taste.
 *
 *  RT60. A cinema is not a concert hall. Design targets for a standard
 *  multiplex (500-1500 m3) are 0.35-0.55 s across 500-4000 Hz, 0.45-0.65 s for
 *  a large house, 0.25-0.35 s for a small screening room. Decay is not flat
 *  with frequency: the same spec asks for roughly 0.40-0.70 s in the bass and
 *  only 0.28-0.45 s in the top. Dolby's theatre guidelines say the same thing
 *  as a rule: reverberation time rises at low frequencies and falls at high
 *  ones, smoothly, with no band above 150 Hz longer than the band below it.
 *  So: dark, short, and the bass is the only thing that hangs around.
 *
 *  X-curve (SMPTE ST 202). The house response of a dubbing stage or a cinema
 *  over ~125 m3 is flat from about 63 Hz to 2 kHz, then rolls off at 3 dB per
 *  octave, and at 6 dB per octave above 10 kHz. That is why film sound in a
 *  real auditorium is soft on top compared with the same mix on headphones.
 *  Approximated here with one high shelf at 2.2 kHz, 0 to -9 dB.
 *
 *  Level. -20 dBFS pink noise reads 85 dB(C) at the reference seat per screen
 *  channel, peaks reach 105 dB. The LFE is calibrated 10 dB hotter in band
 *  (about 89-91 dB C, peaks 115 dB). That +10 dB is the whole reason a cinema
 *  feels physical, and it is what the bass channel below is imitating.
 *
 *  LFE and bass management. The LFE carries 120 Hz and down, and mixers
 *  usually roll their material off from around 80 Hz. Bass management systems
 *  cross over at 80 Hz (THX) up to 120 Hz. Below roughly 80 Hz the head is far
 *  smaller than half a wavelength, interaural level difference collapses to
 *  nothing and the phase difference is too small to read, so the ear cannot
 *  tell where the bass is coming from. That is the physical licence for
 *  sending this channel straight to the master instead of through the HRTF
 *  panners: it is not a shortcut, it is what actually happens.
 *
 *  A crossover, though, SPLITS. It does not copy. This desk used to add the low
 *  band as a second, mono, louder voice on top of the panned film, and the
 *  result was measurable: with programme level pink noise, turning your head 90
 *  degrees moved the left/right balance by 8.7 dB with no desk at all and by
 *  0.7 dB on the IMAX preset. So the desk now tells the film's own graph where
 *  the crossover is (setBassCrossover), the screen channels give the low band
 *  up, and the sub is the only place it exists.
 *
 *  Background noise. THX certified rooms must not exceed NC-30 in any octave
 *  band; premium (IMAX, Atmos) houses are specified at NC-25, about 33 dBA,
 *  standard multiplex NC-30, about 38 dBA. The NC-30 curve allows 57 dB at
 *  63 Hz but only 48 dB at 125 Hz and keeps falling, so room tone in a cinema
 *  is nearly all low frequency: air handling rumble, not hiss.
 *
 *  Audience. An empty good auditorium measures about 25-30 dBA. With people in
 *  it the floor rises to about 35 dBA purely from breathing and clothing. So
 *  the crowd bed is worth roughly +5 to +7 dB over the empty room at a full
 *  house, and nothing at all when empty. Bodies also absorb: about 0.45 sabins
 *  per seated person at 500 Hz, and one measured hall went from 1.09 s half
 *  full to 0.84 s full, about a 23 percent shorter tail. Hence the absorption
 *  feed into the reverb mix.
 *
 *   const mixer = createMixer({ context, destination, movieTap })
 *   mixer.setPreset('imax')
 *   mixer.set('bass', 0.8)
 */

/** Rooms are calibrated to a nominal seat count; the crowd maths uses it too. */
export const HOUSE_SEATS = 150

const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max)

/**
 * Every adjustable value in one place, so the panel can be rendered without
 * knowing a thing about the audio graph. `format` tells it how to print.
 */
export const MIXER_FIELDS = [
  { key: 'master', label: 'Overall volume', group: 'room', min: 0, max: 1, step: 0.01, format: 'percent' },
  { key: 'movie', label: 'Film', group: 'film', min: 0, max: 1, step: 0.01, format: 'percent' },
  { key: 'xcurve', label: 'Film treble (X-curve)', group: 'film', min: 0, max: 1, step: 0.01, format: 'percent' },
  { key: 'bass', label: 'Bass (LFE)', group: 'bass', min: 0, max: 1, step: 0.01, format: 'percent' },
  { key: 'bassExtension', label: 'Bass reach', group: 'bass', min: 0, max: 1, step: 0.01, format: 'percent' },
  // 50-120 Hz, not 60-160. Bass management crosses at 80 Hz (THX) and at most
  // 120 Hz, and everything below the crossover is sent to the sub in mono. Park
  // it at 160 Hz and male dialogue goes mono with it, which is exactly the
  // "everything sounds the same wherever I look" the desk used to cause.
  { key: 'bassCrossover', label: 'Bass crossover', group: 'bass', min: 50, max: 120, step: 5, format: 'hz' },
  { key: 'occupancy', label: 'How full the room is', group: 'audience', min: 0, max: 1, step: 0.01, format: 'percent' },
  { key: 'crowd', label: 'Audience level', group: 'audience', min: 0, max: 1, step: 0.01, format: 'percent' },
  { key: 'crowdSpread', label: 'Audience spread', group: 'audience', min: 0, max: 1, step: 0.01, format: 'percent' },
  { key: 'foley', label: 'Footsteps and seats', group: 'room', min: 0, max: 1, step: 0.01, format: 'percent' },
  { key: 'room', label: 'Air and ventilation', group: 'room', min: 0, max: 1, step: 0.01, format: 'percent' },
  // 0-1, and it has moved twice for the same reason: 0.4 was a dry room at the
  // top of the slider, 0.6 was a polite one. The curve behind it is shaped so
  // that raising the ceiling did not move anything anyone had already set -
  // see applyMix() in spatialAudio.js - so the whole change is new room at the
  // far end, and the far end is well past anything a real cinema does.
  { key: 'reverb', label: 'Room reverb', group: 'room', min: 0, max: 1, step: 0.01, format: 'percent' },
  // The other half of a big room, and the half no amount of mix can fake: how
  // long the tail lasts. In seconds, because that is what it is, and because
  // "0.5 s" and "2.4 s" are two rooms anybody can hear the difference between.
  { key: 'reverbTail', label: 'How long it rings', group: 'room', min: 0.15, max: 3.5, step: 0.05, format: 'seconds' },
]

const FIELD_BY_KEY = new Map(MIXER_FIELDS.map((field) => [field.key, field]))

/**
 * Starting points, not destinations: applying one just writes these values,
 * and every slider stays live afterwards.
 *
 * `room` names the impulse response the film's reverb switches to, from
 * REVERB_PRESETS in src/media/reverb.js. That is what makes these five sound
 * like five different buildings instead of five volume settings: a 0.22 s tail
 * in a living room against a 0.85 s one in a dome is a difference you hear in
 * the first second, and no fader can imitate it.
 */
export const SOUND_PRESETS = {
  // The reference: a standard 500-1500 m3 multiplex, half sold, crossed over
  // at the THX 80 Hz so almost nothing localisable goes to the sub.
  cinema: {
    label: 'Cinema',
    room: 'cinema',
    values: {
      master: 0.72,
      movie: 0.8,
      xcurve: 0.45,
      bass: 0.5,
      bassExtension: 0.4,
      bassCrossover: 75,
      occupancy: 0.35,
      crowd: 0.45,
      crowdSpread: 0.6,
      foley: 0.7,
      room: 0.45,
      reverb: 0.13,
      reverbTail: 0.6,
    },
  },
  // A dome: much bigger room, much longer tail, the deepest bottom octave in
  // the business and the widest audience. Loud on purpose.
  imax: {
    label: 'IMAX',
    room: 'imax',
    values: {
      master: 0.9,
      movie: 0.95,
      xcurve: 0.6,
      bass: 0.66,
      bassExtension: 0.9,
      bassCrossover: 90,
      occupancy: 0.65,
      crowd: 0.5,
      crowdSpread: 1,
      foley: 0.65,
      room: 0.55,
      reverb: 0.26,
      reverbTail: 0.85,
    },
  },
  // Under 200 m3 and empty: 0.25-0.35 s of tail, no audience at all, and the
  // air handling of a room built for four people.
  quiet: {
    label: 'Quiet room',
    room: 'screening-room',
    values: {
      master: 0.55,
      movie: 0.7,
      xcurve: 0.3,
      bass: 0.42,
      bassExtension: 0.2,
      bassCrossover: 60,
      occupancy: 0.02,
      crowd: 0.15,
      crowdSpread: 0.35,
      foley: 0.55,
      room: 0.25,
      reverb: 0.08,
      reverbTail: 0.4,
    },
  },
  // Every seat taken. The wet slider is set high and the house eats a third of
  // it: 150 bodies are about 0.45 sabins each at 500 Hz, and that is why a
  // sold out screening sounds tighter than the same room at a press preview.
  premiere: {
    label: 'Premiere',
    room: 'cinema',
    values: {
      master: 0.8,
      movie: 0.85,
      xcurve: 0.5,
      bass: 0.56,
      bassExtension: 0.5,
      bassCrossover: 80,
      occupancy: 1,
      crowd: 0.85,
      crowdSpread: 0.9,
      foley: 0.85,
      room: 0.5,
      reverb: 0.2,
      reverbTail: 0.6,
    },
  },
  // A living room. No X-curve at all: the SMPTE roll off is a correction for a
  // large auditorium and a home system is meant to be flat. A small sub cannot
  // reach low, so it crosses high and stops early.
  home: {
    label: 'Living room',
    room: 'dry',
    values: {
      master: 0.6,
      movie: 0.75,
      xcurve: 0,
      bass: 0.38,
      bassExtension: 0.1,
      bassCrossover: 105,
      occupancy: 0,
      crowd: 0,
      crowdSpread: 0.25,
      foley: 0.5,
      room: 0.3,
      reverb: 0.05,
      reverbTail: 0.22,
    },
  },
}

export const DEFAULT_PRESET = 'cinema'

/** How much of the wet tail a full house eats. From the 1.09 s -> 0.84 s case. */
const ABSORPTION_DEPTH = 0.35

/** The LFE sits 10 dB hot in a real house; 2.0 here is that headroom, not more. */
const BASS_MAX_GAIN = 2.0

/**
 * The room channel carries the building AND everything src/venues/ plays into
 * it: rain on a window, thunder, a fire. The routing was never the problem
 * (this fader measures 44 dB of travel end to end) but it topped out at unity
 * and the presets parked it near 0.5, so the rain lived permanently 6 dB down
 * with nowhere to go. Unity now sits in the middle of the slider and the top
 * half is worth +6 dB.
 */
const ROOM_MAX_GAIN = 2.0

/**
 * @param {object} options
 * @param {BaseAudioContext} options.context
 * @param {AudioNode} [options.destination] defaults to context.destination
 * @param {AudioNode} [options.movieTap] where the LFE is taken from
 * @param {GainNode} [options.movieFader] the film's own level, the "Film" slider
 * @param {AudioNode} [options.movieOut] everything the film makes, into the master
 * @param {BiquadFilterNode} [options.movieTone] high shelf for the X-curve
 * @param {object} [options.film] the spatial audio handle: crossover and output
 * @param {{ setReverbMix: (value:number)=>void }} [options.reverb]
 */
export function createMixer(options = {}) {
  const context = options.context
  if (!context) throw new Error('[sound] createMixer needs an AudioContext')

  const destination = options.destination ?? context.destination
  const movieTap = options.movieTap ?? null
  const movieTone = options.movieTone ?? null
  const reverb = options.reverb ?? null
  // The same handle answers for the crossover and for where the film comes out.
  const film = options.film ?? options.reverb ?? null

  // A BiquadFilterNode also has a `gain`, and writing a volume into a shelf's
  // gain would quietly EQ the film instead of turning it down. Only a node with
  // no `frequency` param is a real fader.
  const faderCandidate = options.movieFader ?? movieTap
  const movieLevel =
    faderCandidate?.gain && faderCandidate.frequency === undefined ? faderCandidate.gain : null

  const values = { ...SOUND_PRESETS[DEFAULT_PRESET].values }
  let presetName = DEFAULT_PRESET
  let custom = false
  let crowd = null
  let disposed = false

  const ramp = (param, value, seconds = 0.06) => {
    if (!param) return
    param.setTargetAtTime(value, context.currentTime, seconds)
  }

  /* ----------------------------------------------------------------------- */
  /* master                                                                   */
  /* ----------------------------------------------------------------------- */

  const master = context.createGain()
  master.gain.value = values.master

  // Insurance, not colour, and it should be inaudible until something is
  // genuinely about to clip. At -6 dB with a soft 8 dB knee it started working
  // well before that: measured on a hot bus, a 20 dB fader move came out as
  // 11.1 dB. At -2 dB with a 2 dB knee the same move comes out as 12.1 dB, and
  // everything below -3 dB is now untouched instead of gently squashed. Worth
  // 1 dB, which is not the reason the desk felt dead, but it is the right
  // shape for a safety limiter.
  const limiter = context.createDynamicsCompressor()
  limiter.threshold.value = -2
  limiter.knee.value = 2
  limiter.ratio.value = 20
  limiter.attack.value = 0.003
  limiter.release.value = 0.25

  master.connect(limiter)
  limiter.connect(destination)

  // The film joins the desk here. Until this round it went straight to the
  // listener, which is why "Overall volume" only moved the room around it.
  // setOutput() is asked first because it also takes the film OFF the listener;
  // connecting movieOut by hand would leave the old route live and play the
  // film twice, once inside the desk and once around it.
  const movieOut = options.movieOut ?? null
  let routedMovie = false
  if (typeof film?.setOutput === 'function') {
    routedMovie = film.setOutput(master) === master
  } else if (movieOut && typeof movieOut.connect === 'function') {
    movieOut.connect(master)
    routedMovie = true
  }

  /* ----------------------------------------------------------------------- */
  /* the bass channel: the thing that actually makes a room feel like a cinema */
  /* ----------------------------------------------------------------------- */

  // Forced to one channel so the two sides of the film sum, exactly like the
  // bass management in a real processor. Stereo bass under 120 Hz is a fiction
  // anyway, and summing avoids the phase cancellation you get from panning it.
  const lfeIn = context.createGain()
  lfeIn.channelCount = 1
  lfeIn.channelCountMode = 'explicit'
  lfeIn.channelInterpretation = 'speakers'
  lfeIn.gain.value = 1

  // Under about 20 Hz there is nothing left to hear, only cone travel and
  // headroom lost in the limiter. This corner drops from 30 Hz to 18 Hz as
  // "extension" rises, so the slider buys real bottom octave, not just level.
  const lfeCut = context.createBiquadFilter()
  lfeCut.type = 'highpass'
  lfeCut.frequency.value = 26
  lfeCut.Q.value = 0.6

  // Two cascaded second order sections = 24 dB/octave, which is what bass
  // management crossovers actually use. One section leaks far too much voice
  // into the sub and you hear the dialogue coming out of the floor.
  const lfeLowA = context.createBiquadFilter()
  lfeLowA.type = 'lowpass'
  lfeLowA.frequency.value = values.bassCrossover
  lfeLowA.Q.value = 0.7071

  const lfeLowB = context.createBiquadFilter()
  lfeLowB.type = 'lowpass'
  lfeLowB.frequency.value = values.bassCrossover
  lfeLowB.Q.value = 0.7071

  // "Extends" rather than "gets louder": a shelf under 32 Hz lifts the bottom
  // octave, which is where the chest hit lives and where most systems give up.
  // It used to sit at 52 Hz, which is not the bottom octave at all: it was a
  // broad lift over everything the sub carries, and on real programme material
  // that alone was enough to bury the panned sound under mono bass.
  const lfeShelf = context.createBiquadFilter()
  lfeShelf.type = 'lowshelf'
  lfeShelf.frequency.value = 32
  lfeShelf.gain.value = 0

  const bassGain = context.createGain()
  bassGain.gain.value = values.bass * BASS_MAX_GAIN

  lfeIn.connect(lfeCut)
  lfeCut.connect(lfeLowA)
  lfeLowA.connect(lfeLowB)
  lfeLowB.connect(lfeShelf)
  lfeShelf.connect(bassGain)
  bassGain.connect(master)

  // A cross origin file that cannot go through Web Audio plays straight out of
  // the <video> element, so nothing arrives here and the bass channel is simply
  // silent for that source. There is no way around it and nothing breaks.
  if (movieTap && typeof movieTap.connect === 'function') movieTap.connect(lfeIn)

  /* ----------------------------------------------------------------------- */
  /* the simple channels                                                      */
  /* ----------------------------------------------------------------------- */

  const crowdGain = context.createGain()
  crowdGain.gain.value = values.crowd
  crowdGain.connect(master)

  const foleyGain = context.createGain()
  foleyGain.gain.value = values.foley
  foleyGain.connect(master)

  const roomGain = context.createGain()
  roomGain.gain.value = values.room * ROOM_MAX_GAIN
  roomGain.connect(master)

  /* ----------------------------------------------------------------------- */
  /* applying values                                                          */
  /* ----------------------------------------------------------------------- */

  function applyReverb() {
    if (!reverb || typeof reverb.setReverbMix !== 'function') return
    // A full house shortens the tail, so the same slider means less wet when
    // the room is packed. This is why a preview screening sounds different
    // from a sold out one, and it is free realism.
    const absorption = crowd ? clamp(crowd.absorption, 0, 1) : 0
    reverb.setReverbMix(values.reverb * (1 - ABSORPTION_DEPTH * absorption))
  }

  /**
   * Swap the impulse response for the one this preset's building would have.
   * It has to run BEFORE the reverb value is applied: setReverbPreset() writes
   * that preset's own mix, and the slider has to be the thing that wins.
   */
  function applyRoomAcoustic() {
    const name = SOUND_PRESETS[presetName]?.room
    if (!name || typeof reverb?.setReverbPreset !== 'function') return
    reverb.setReverbPreset(name)
  }

  const appliers = {
    master: (value) => ramp(master.gain, value),
    movie: (value) => ramp(movieLevel, value, 0.04),
    xcurve: (value) => {
      // SMPTE ST 202 is -3 dB/octave from 2 kHz, so the average tilt over the
      // audible top is a few dB. One shelf gets close enough to feel right.
      if (movieTone?.gain) ramp(movieTone.gain, -9 * value, 0.08)
    },
    bass: (value) => ramp(bassGain.gain, value * BASS_MAX_GAIN, 0.08),
    bassExtension: (value) => {
      // An 8 dB shelf plus a corner that walks from 36 Hz down to 16 Hz. The
      // old 8 dB over 30-18 Hz was worth about 2 dB end to end, which is not a
      // slider, it is a decoration: most of the travel comes from the corner,
      // because opening the bottom octave is what "extension" actually means.
      ramp(lfeShelf.gain, 8 * value, 0.08)
      ramp(lfeCut.frequency, 36 - 20 * value, 0.08)
    },
    bassCrossover: (value) => {
      ramp(lfeLowA.frequency, value, 0.08)
      ramp(lfeLowB.frequency, value, 0.08)
      // The other half of the crossover: the screen channels have to LOSE what
      // the sub is given, or the low band is in the room twice and the mono
      // copy wins. This is the line that brought the panning back.
      film?.setBassCrossover?.(value)
    },
    occupancy: (value) => {
      crowd?.setOccupancy(value)
      applyReverb()
    },
    crowd: (value) => ramp(crowdGain.gain, value),
    crowdSpread: (value) => crowd?.setSpread(value),
    foley: (value) => ramp(foleyGain.gain, value),
    room: (value) => ramp(roomGain.gain, value * ROOM_MAX_GAIN),
    reverb: () => applyReverb(),
    reverbTail: (value) => reverb?.setReverbTail?.(value),
  }

  function applyAll() {
    for (const field of MIXER_FIELDS) appliers[field.key](values[field.key])
  }

  /**
   * @param {string} key one of MIXER_FIELDS
   * @param {number} value clamped to that field's range
   * @returns {number} what was actually stored
   */
  function set(key, value) {
    const field = FIELD_BY_KEY.get(key)
    if (!field || disposed) return values[key]
    const next = clamp(value, field.min, field.max)
    values[key] = next
    appliers[key](next)
    custom = true
    return next
  }

  function setPreset(name) {
    const preset = SOUND_PRESETS[name]
    if (!preset || disposed) return presetName
    Object.assign(values, preset.values)
    presetName = name
    custom = false
    applyRoomAcoustic()
    applyAll()
    return presetName
  }

  function getSettings() {
    return { preset: presetName, custom, ...values }
  }

  /**
   * Tolerant on purpose: it is fed straight from localStorage, which can hold
   * anything from an older build.
   */
  function setSettings(settings = {}) {
    if (!settings || typeof settings !== 'object' || disposed) return getSettings()
    if (typeof settings.preset === 'string' && SOUND_PRESETS[settings.preset]) {
      Object.assign(values, SOUND_PRESETS[settings.preset].values)
      presetName = settings.preset
    }
    for (const field of MIXER_FIELDS) {
      if (!Number.isFinite(Number(settings[field.key]))) continue
      values[field.key] = clamp(settings[field.key], field.min, field.max)
    }
    custom = settings.custom === true
    applyRoomAcoustic()
    applyAll()
    return getSettings()
  }

  /**
   * The crowd is built after the mixer (it needs the crowd channel input as a
   * destination), so it is handed back in afterwards.
   */
  function bindCrowd(instance) {
    crowd = instance || null
    crowd?.setOccupancy(values.occupancy)
    crowd?.setSpread(values.crowdSpread)
    applyReverb()
    return crowd
  }

  function dispose() {
    if (disposed) return
    disposed = true
    // Hand the film back: it has to keep playing when the desk goes away, with
    // its bass, straight at the listener the way it did before there was one.
    film?.setBassCrossover?.(0)
    film?.setOutput?.(null)
    if (movieTap && typeof movieTap.disconnect === 'function') {
      try {
        movieTap.disconnect(lfeIn)
      } catch {
        /* already detached */
      }
    }
    for (const node of [lfeIn, lfeCut, lfeLowA, lfeLowB, lfeShelf, bassGain, crowdGain, foleyGain, roomGain, master, limiter]) {
      try {
        node.disconnect()
      } catch {
        /* already disconnected */
      }
    }
  }

  applyRoomAcoustic()
  applyAll()

  return {
    context,
    fields: MIXER_FIELDS,
    presets: SOUND_PRESETS,

    /** Where each channel wants its sound plugged in. */
    channels: {
      master: { input: master, setLevel: (value) => set('master', value) },
      movie: {
        input: movieOut ?? movieTap,
        setLevel: (value) => set('movie', value),
        setTone: (value) => set('xcurve', value),
      },
      bass: {
        input: lfeIn,
        setLevel: (value) => set('bass', value),
        setExtension: (value) => set('bassExtension', value),
        setCrossover: (value) => set('bassCrossover', value),
      },
      crowd: { input: crowdGain, setLevel: (value) => set('crowd', value) },
      foley: { input: foleyGain, setLevel: (value) => set('foley', value) },
      room: { input: roomGain, setLevel: (value) => set('room', value) },
    },

    /** True when there is a film to tap; the two movie sliders are inert without it. */
    get hasMovie() {
      return !!movieTap
    },
    /** True when the film actually comes out through this desk's master. */
    get ownsMovieOutput() {
      return routedMovie
    },
    get preset() {
      return presetName
    },
    get values() {
      return { ...values }
    },
    get(key) {
      return values[key]
    },
    set,
    setPreset,
    setOccupancy: (value) => set('occupancy', value),
    getSettings,
    setSettings,
    bindCrowd,
    dispose,
  }
}

export default createMixer

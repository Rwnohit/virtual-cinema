/**
 * Lighting rig for the hall - "showtime" look.
 *
 * A real auditorium during a screening is almost black. Practically all the
 * light in the room is bounced off the screen, so it changes colour and
 * brightness with the film. Everything here is built around that:
 *
 *   - ambient / hemisphere are a whisper, just enough to keep shapes readable
 *   - the house downlights over the audience start switched off
 *   - the screen throws a wide, soft, shadow casting spot back over the seats
 *   - the aisle step lights and the green exit signs stay on, always
 *
 *   import { createLighting } from './scene/lighting.js'
 *   const lighting = createLighting()
 *   scene.add(lighting.group)
 *
 * Driving it from the film (this is what the media module calls):
 *
 *   lighting.setScreenLight(0xffd9a0, 0.85)   // bright warm scene
 *   lighting.setScreenLight(0x0a1830, 0.05)   // night scene, room goes dark
 *
 * `intensity` is relative: 0 = black frame (the room keeps only a faint glow),
 * 1 = a normal bright frame. Values above 1 are allowed for explosions and the
 * like, up to 3. The move is always damped over a fraction of a second, never
 * instant, so cuts do not strobe the room.
 */

import * as THREE from 'three'
import { ROOM, ROOM_BOUNDS, SCREEN, STAGE, SEATING, PALETTE } from './constants.js'

/** Candela range of the screen spot, from a black frame to a bright one. */
const SCREEN_SPOT = { min: 45, base: 900 }
/** Same for the soft fill that keeps the front rows from going to silhouette. */
const SCREEN_FILL = { min: 14, base: 260 }

/** Time constants of the damping, in seconds. Colour lags a touch behind. */
const INTENSITY_TAU = 0.16
const COLOR_TAU = 0.28
/**
 * House lights are on a dimmer, not a switch. Slow on purpose: a cinema takes
 * a couple of seconds to come up, and a slider that snaps looks like a bug.
 */
const HOUSE_TAU = 0.55

/** Ambient and hemisphere with the house lights off, ie during the film. */
const BASE_FILL = { ambient: 0.11, hemisphere: 0.09 }

/** How much of the base fill the film itself provides at a normal bright frame. */
const SPILL_FILL = { ambient: 0.5, hemisphere: 0.34 }

/** The room's own tint, before the picture starts colouring it. */
const AMBIENT_BASE = new THREE.Color(0x0a1020)
const SKY_BASE = new THREE.Color(0x0e1626)

/**
 * The light that comes back UP off the carpet in front of the screen. A cinema
 * floor is dark and matt, but it is also the first thing a two storey picture
 * lands on, so it is what actually carries the colour of the film into the room.
 */
const SCREEN_BOUNCE = { min: 4, base: 120 }

/** Ends of the house light colour range, from tungsten to daylight. */
const HOUSE_WARM = PALETTE.warmLight
const HOUSE_COOL = 0xdce8ff

/** Where the room sits before any film is loaded. */
const IDLE = { color: 0x9ab7ff, intensity: 0.34 }

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

/** Height of the stepped seating floor at a given depth. */
function riserFloorY(z) {
  const row = Math.floor((z - SEATING.firstRowZ + SEATING.rowSpacing * 0.5) / SEATING.rowSpacing)
  return clamp(row, 0, SEATING.rows - 1) * SEATING.rowRise
}

/**
 * Accepts anything the media module might hand over: 0xrrggbb, '#rrggbb',
 * a THREE.Color, [r, g, b] or { r, g, b } in either 0..1 or 0..255.
 */
function applyColor(target, value) {
  if (value === null || value === undefined) return
  if (typeof value === 'number' || typeof value === 'string') {
    target.set(value)
    return
  }
  if (value.isColor) {
    target.copy(value)
    return
  }
  const rgb = Array.isArray(value)
    ? value
    : typeof value.r === 'number'
      ? [value.r, value.g, value.b]
      : null
  if (!rgb) return
  const scale = rgb.some((c) => c > 1) ? 1 / 255 : 1
  target.setRGB(clamp(rgb[0] * scale, 0, 1), clamp(rgb[1] * scale, 0, 1), clamp(rgb[2] * scale, 0, 1))
}

/**
 * @param {{ shadows?: boolean, houseLevel?: number, flicker?: boolean,
 *           aisleLevel?: number, exitLevel?: number }} [options]
 * @returns {{
 *   group: THREE.Group,
 *   lights: Record<string, any>,
 *   setScreenLight: (color?: any, intensity?: number, opts?: { immediate?: boolean }) => void,
 *   getScreenLight: () => { color: THREE.Color, intensity: number },
 *   setHouseLights: (level: number, opts?: { immediate?: boolean }) => void,
 *   setScreenGain: (gain: number) => void,
 *   setWarmth: (value: number) => void,
 *   setAisleLights: (level: number) => void,
 *   setExitLights: (level: number) => void,
 *   getSettings: () => { house, screenGain, warmth, aisle, exit },
 *   update: (elapsed: number, delta?: number) => void,
 *   dispose: () => void
 * }}
 */
export function createLighting(options = {}) {
  const { shadows = true, houseLevel: initialHouseLevel = 0, flicker = true } = options

  const group = new THREE.Group()
  group.name = 'Lighting'

  // --- base fill ---------------------------------------------------------
  // Deliberately tiny during the film. Anything more and the room stops
  // reading as "dark". It comes back up with the house lights.
  const ambient = new THREE.AmbientLight(0x0a1020, BASE_FILL.ambient)
  const hemisphere = new THREE.HemisphereLight(0x0e1626, 0x080406, BASE_FILL.hemisphere)
  group.add(ambient, hemisphere)

  // --- the screen, which is the light in this room ------------------------
  // A spot rather than a point light: one cheap 2D shadow map instead of a
  // cube map, and the seats throw long shadows away from the screen.
  const screenWash = new THREE.SpotLight(IDLE.color, SCREEN_SPOT.base, 62, 1.02, 1.0, 1.35)
  screenWash.position.set(SCREEN.x, SCREEN.y - 0.4, SCREEN.z + 1.4)
  screenWash.name = 'ScreenWash'

  const washTarget = new THREE.Object3D()
  washTarget.position.set(SCREEN.x, 1.0, ROOM_BOUNDS.maxZ - 6)
  group.add(washTarget)
  screenWash.target = washTarget

  if (shadows) {
    screenWash.castShadow = true
    screenWash.shadow.mapSize.set(1024, 1024)
    screenWash.shadow.camera.near = 2
    screenWash.shadow.camera.far = 48
    screenWash.shadow.bias = -0.0007
    screenWash.shadow.normalBias = 0.03
    screenWash.shadow.radius = 3 // soft edges, PCFSoft
  }
  group.add(screenWash)

  // Soft wrap-around so the front rows keep some shape instead of blowing out.
  const screenFill = new THREE.PointLight(IDLE.color, SCREEN_FILL.base, 30, 1.8)
  screenFill.position.set(SCREEN.x, STAGE.height + 2.2, SCREEN.z + 5.5)
  screenFill.name = 'ScreenFill'
  group.add(screenFill)

  // The bounce off the floor: low, in front of the stage, throwing the colour
  // of the picture back up onto the seats and the walls.
  const screenBounce = new THREE.PointLight(IDLE.color, SCREEN_BOUNCE.base, 34, 2.1)
  screenBounce.position.set(SCREEN.x, 0.55, SCREEN.z + 7.5)
  screenBounce.name = 'ScreenBounce'
  group.add(screenBounce)

  // --- house downlights: off during the film ------------------------------
  const houseLights = []
  for (const z of [-3, 3.5, 10]) {
    const spot = new THREE.SpotLight(PALETTE.warmLight, 620, 30, 0.72, 0.9, 2)
    spot.position.set(0, ROOM.height - 0.5, z)

    const target = new THREE.Object3D()
    target.position.set(0, 0, z + 1)
    group.add(target)
    spot.target = target

    group.add(spot)
    houseLights.push(spot)
  }

  // --- warm coves on the side walls, part of the house rig ----------------
  const coveLights = []
  for (const sign of [-1, 1]) {
    for (const z of [-7, 2, 11]) {
      const cove = new THREE.PointLight(PALETTE.warmLight, 150, 22, 2)
      cove.position.set(sign * (ROOM.width / 2 - 1.1), 8.1, z)
      group.add(cove)
      coveLights.push(cove)
    }
  }

  // --- the practicals: lamps you see, rather than lamps that light the room -
  // Step lights sit just above the tread of whichever riser they are on. They
  // are deliberately tiny and start switched OFF: a real aisle light is a lamp
  // you notice in the dark, not a puddle of orange on the carpet.
  const aisleGlows = []
  for (const z of [-2, 2, 6, 9.5]) {
    const glow = new THREE.PointLight(PALETTE.aisleLight, 7, 2.4, 2.4)
    glow.position.set(0, riserFloorY(z) + 0.14, z)
    glow.visible = false
    group.add(glow)
    aisleGlows.push(glow)
  }

  const exitGlows = []
  for (const sign of [-1, 1]) {
    for (const z of [ROOM_BOUNDS.maxZ - 5, ROOM_BOUNDS.minZ + 4.5]) {
      const exit = new THREE.PointLight(PALETTE.exitGreen, 14, 5, 2.2)
      exit.position.set(sign * (ROOM.width / 2 - 0.9), 2.95, z)
      group.add(exit)
      exitGlows.push(exit)
    }
  }

  const lights = {
    ambient,
    hemisphere,
    screenWash,
    screenFill,
    screenBounce,
    houseLights,
    coveLights,
    aisleGlows,
    exitGlows,
  }

  // --- state --------------------------------------------------------------
  const baseHouseIntensity = houseLights.map((l) => l.intensity)
  const baseCoveIntensity = coveLights.map((l) => l.intensity)
  const baseAisleIntensity = aisleGlows.map((l) => l.intensity)
  const baseExitIntensity = exitGlows.map((l) => l.intensity)

  const targetColor = new THREE.Color(IDLE.color)
  const currentColor = new THREE.Color(IDLE.color)
  let targetIntensity = IDLE.intensity
  let currentIntensity = IDLE.intensity

  let houseTarget = clamp(initialHouseLevel, 0, 1)
  let houseLevel = houseTarget
  /** Viewer knob on how hard the film lights the room. 1 = as shot. */
  let screenGain = 1
  /** 0 = tungsten house lights, 1 = daylight. */
  let warmth = 0
  /** Pools of light on the carpet from the aisle strips. Off by default. */
  let aisleLevel = clamp(options.aisleLevel ?? 0, 0, 1)
  /** How far the exit signs throw. */
  let exitLevel = clamp(options.exitLevel ?? 0.7, 0, 1)
  const houseColor = new THREE.Color(HOUSE_WARM)
  let lastElapsed = 0

  /**
   * Move the light coming off the screen towards a colour and a brightness.
   * Called by the media module once per frame (or whenever the frame changes);
   * cheap enough to call every frame, and always eased, never stepped.
   */
  function setScreenLight(color, intensity, { immediate = false } = {}) {
    applyColor(targetColor, color)
    if (Number.isFinite(intensity)) targetIntensity = clamp(intensity, 0, 3)
    if (immediate) {
      currentColor.copy(targetColor)
      currentIntensity = targetIntensity
      applyScreenLight(1)
    }
  }

  function getScreenLight() {
    return { color: currentColor.clone(), intensity: currentIntensity }
  }

  function applyScreenLight(flickerFactor) {
    screenWash.color.copy(currentColor)
    screenFill.color.copy(currentColor)
    screenBounce.color.copy(currentColor)
    const gain = flickerFactor * screenGain
    screenWash.intensity =
      (SCREEN_SPOT.min + (SCREEN_SPOT.base - SCREEN_SPOT.min) * currentIntensity) * gain
    screenFill.intensity =
      (SCREEN_FILL.min + (SCREEN_FILL.base - SCREEN_FILL.min) * currentIntensity) * gain
    screenBounce.intensity =
      (SCREEN_BOUNCE.min + (SCREEN_BOUNCE.base - SCREEN_BOUNCE.min) * currentIntensity) * gain
    applyFill()
  }

  /**
   * The base fill: what the room has to see by when nothing is aimed at it.
   *
   * Two things feed it and both have to land in one place, or whichever ran
   * last would wipe the other. The house lights bounce off every wall, and so
   * does the film: a dark room with a bright picture in it is not neutral grey,
   * it is the colour of whatever is on the screen. That is why the ambient is
   * tinted here rather than left at a fixed blue, and it is what makes a red
   * scene turn the whole auditorium red.
   */
  function applyFill() {
    const spill = Math.min(currentIntensity, 1.6) * screenGain
    ambient.intensity = BASE_FILL.ambient + houseLevel * 0.42 + spill * SPILL_FILL.ambient
    hemisphere.intensity = BASE_FILL.hemisphere + houseLevel * 0.38 + spill * SPILL_FILL.hemisphere

    // Never all the way to the screen colour: the room keeps some of its own
    // character, otherwise a green scene makes the carpet look painted green.
    const tint = Math.min(0.82, spill * 0.62)
    ambient.color.copy(AMBIENT_BASE).lerp(currentColor, tint)
    hemisphere.color.copy(SKY_BASE).lerp(currentColor, tint * 0.8)
  }

  function applyHouseLights() {
    applyFill()

    // A light at zero intensity still costs a slot in every fragment shader.
    // Hiding it drops it from the light list entirely, which is 9 lights worth
    // of shading saved for the whole film. Flipping it back costs one shader
    // rebuild, which only happens when the house lights actually come up.
    const on = houseLevel > 0.001

    houseLights.forEach((light, i) => {
      light.intensity = baseHouseIntensity[i] * houseLevel
      light.visible = on
      light.color.copy(houseColor)
    })
    coveLights.forEach((light) => {
      light.visible = on
      light.color.copy(houseColor)
    })
  }

  /**
   * Dim or raise the house lights, 0 = off (showtime), 1 = full (interval).
   * The move is on a dimmer ramp unless `immediate` is asked for.
   */
  function setHouseLights(level, { immediate = false } = {}) {
    houseTarget = clamp(level, 0, 1)
    if (immediate) {
      houseLevel = houseTarget
      applyHouseLights()
    }
  }

  /**
   * How hard the film lights the room, on top of what the frame itself says.
   * 0 = the spill is off and only the practicals are left, 2 = twice as strong.
   */
  function setScreenGain(gain) {
    screenGain = clamp(Number(gain) || 0, 0, 2)
    applyScreenLight(1)
  }

  /** House light colour, 0 = tungsten warm, 1 = daylight cool. */
  function setWarmth(value) {
    warmth = clamp(Number(value) || 0, 0, 1)
    houseColor.set(HOUSE_WARM).lerp(new THREE.Color(HOUSE_COOL), warmth)
    applyHouseLights()
  }

  /**
   * How much light the aisle strips actually throw on the carpet.
   * 0 leaves the strips glowing but the floor clean, which is how it should
   * look during a film; 1 gives you the full nosing light.
   */
  function setAisleLights(level) {
    aisleLevel = clamp(Number(level) || 0, 0, 1)
    const on = aisleLevel > 0.001
    aisleGlows.forEach((light, i) => {
      light.intensity = baseAisleIntensity[i] * aisleLevel
      light.visible = on
    })
  }

  /** The green glow around the exit signs. */
  function setExitLights(level) {
    exitLevel = clamp(Number(level) || 0, 0, 1)
    const on = exitLevel > 0.001
    exitGlows.forEach((light, i) => {
      light.intensity = baseExitIntensity[i] * exitLevel
      light.visible = on
    })
  }

  /** Everything a control panel needs to draw itself in the right position. */
  function getSettings() {
    return { house: houseTarget, screenGain, warmth, aisle: aisleLevel, exit: exitLevel }
  }

  /**
   * @param {number} elapsed seconds since start
   * @param {number} [delta] seconds since the previous frame
   */
  function update(elapsed, delta) {
    const dt = Number.isFinite(delta) ? delta : Math.max(0, elapsed - lastElapsed)
    lastElapsed = elapsed

    // Frame rate independent easing towards the target.
    const kIntensity = 1 - Math.exp(-dt / INTENSITY_TAU)
    const kColor = 1 - Math.exp(-dt / COLOR_TAU)
    currentIntensity += (targetIntensity - currentIntensity) * kIntensity
    currentColor.lerp(targetColor, kColor)

    // The dimmer ramp. Snap the last hair, otherwise the lights never fully
    // switch off and keep costing a shader slot for nothing.
    if (Math.abs(houseTarget - houseLevel) > 0.0005) {
      houseLevel += (houseTarget - houseLevel) * (1 - Math.exp(-dt / HOUSE_TAU))
      if (Math.abs(houseTarget - houseLevel) <= 0.0005) houseLevel = houseTarget
      applyHouseLights()
    }

    // Projector shutter and lamp wander: a few percent, never a strobe.
    const projector = flicker
      ? 1 + Math.sin(elapsed * 11.3) * 0.012 + Math.sin(elapsed * 23.7) * 0.007 + Math.sin(elapsed * 3.1) * 0.011
      : 1
    applyScreenLight(projector)

    // The practicals breathe on their own, slower and out of phase.
    if (aisleLevel > 0.001) {
      const practical = flicker ? 1 + Math.sin(elapsed * 1.9 + 1.3) * 0.05 : 1
      aisleGlows.forEach((light, i) => {
        light.intensity = baseAisleIntensity[i] * aisleLevel * practical
      })
    }

    if (houseLevel > 0.001) {
      const cove = houseLevel * (flicker ? 1 + Math.sin(elapsed * 0.7) * 0.03 : 1)
      coveLights.forEach((light, i) => {
        light.intensity = baseCoveIntensity[i] * cove
      })
    }
  }

  function dispose() {
    group.traverse((object) => {
      if (object.isLight) object.dispose?.()
    })
  }

  // Start in the showtime state.
  setWarmth(warmth)
  setHouseLights(houseTarget, { immediate: true })
  setAisleLights(aisleLevel)
  setExitLights(exitLevel)
  applyScreenLight(1)

  return {
    group,
    lights,
    setScreenLight,
    getScreenLight,
    setHouseLights,
    setScreenGain,
    setWarmth,
    setAisleLights,
    setExitLights,
    getSettings,
    get houseLevel() {
      return houseTarget
    },
    update,
    dispose,
  }
}

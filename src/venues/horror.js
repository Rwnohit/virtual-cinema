/**
 * The horror house: a room somebody left in a hurry, with a television in it.
 *
 * The plan is deliberately not a box. The living room is an L: a corridor goes
 * off the right hand wall into the dark and ends at a door that is ajar, with a
 * cold line of light under it. You never go down there. That is the point of it:
 * the room has somewhere it does not explain.
 *
 * The fear is a dial and not a setting. At 0 this is simply a quiet room at
 * night: no rain, no thunder, no creaking, nothing in the corners, the chair
 * stays where you left it and there is nobody in the corridor. Everything below
 * scales off that one number, and it crosses its thresholds in this order:
 *
 *   > 0.02 ... rain on the glass, thunder, the house settling
 *   > 0.35 ... the chair is not where you left it
 *   > 0.50 ... something at the end of the corridor, once in a long while
 *   > 0.60 ... things along the skirting, and a heartbeat
 *
 * Restraint is the whole design. Nothing jumps out, nothing screams, and every
 * one of those events happens where you are not looking.
 *
 * Local coordinates, like every room in this app:
 *   -Z ... towards the television
 *   +Z ... towards the door back to the hall
 *   +X ... towards the corridor
 *   +Y ... up
 */

import * as THREE from 'three'
import {
  addBox,
  addPeel,
  addPlane,
  blocker,
  buildArmchair,
  buildChair,
  buildDisplay,
  buildDoor,
  buildRoomShell,
  buildSofa,
  buildTable,
  buildWindow,
  clamp,
  clamp01,
  fill,
  glow,
  lerp,
  matte,
  perimeterPoint,
  rand,
  roomBounds,
  disposeRoom,
  venueSeat,
  venueView,
} from './kit.js'

/** The living room itself. */
const ROOM = Object.freeze({ minX: -4.2, maxX: 4.2, minZ: -4.4, maxZ: 4.4, height: 2.85 })

/** The corridor off the right hand wall. Lower than the room, and much darker. */
const HALL = Object.freeze({ minX: 4.2, maxX: 7.7, minZ: -1.95, maxZ: -0.45, height: 2.3 })

/** The whole floor plan, walls included, for the shell and for the collider. */
const PLAN = Object.freeze({
  height: ROOM.height,
  areas: [
    { minX: ROOM.minX, maxX: ROOM.maxX, minZ: ROOM.minZ, maxZ: ROOM.maxZ },
    { minX: HALL.minX, maxX: HALL.maxX, minZ: HALL.minZ, maxZ: HALL.maxZ, height: HALL.height },
  ],
  walls: [
    { x1: ROOM.minX, z1: ROOM.minZ, x2: ROOM.maxX, z2: ROOM.minZ },
    { x1: ROOM.minX, z1: ROOM.maxZ, x2: ROOM.maxX, z2: ROOM.maxZ },
    { x1: ROOM.minX, z1: ROOM.minZ, x2: ROOM.minX, z2: ROOM.maxZ },
    // The right hand wall, in two pieces, with the mouth of the corridor
    // between them.
    { x1: ROOM.maxX, z1: ROOM.minZ, x2: ROOM.maxX, z2: HALL.minZ },
    { x1: ROOM.maxX, z1: HALL.maxZ, x2: ROOM.maxX, z2: ROOM.maxZ },
    { x1: HALL.minX, z1: HALL.minZ, x2: HALL.maxX, z2: HALL.minZ, height: HALL.height },
    { x1: HALL.minX, z1: HALL.maxZ, x2: HALL.maxX, z2: HALL.maxZ, height: HALL.height },
    { x1: HALL.maxX, z1: HALL.minZ, x2: HALL.maxX, z2: HALL.maxZ, height: HALL.height },
  ],
})

/** The television. `bottom` is fixed, so a bigger set grows upwards. */
const TV = Object.freeze({ width: 2.6, height: 1.4625, x: 0, z: ROOM.minZ + 0.19, bottom: 0.5 })

/** How small and how big the set can be made from the panel. */
const TV_SCALE = Object.freeze({ min: 0.7, max: 1.3 })

/** The window on the left hand wall, where the weather is. */
const WINDOW = Object.freeze({ width: 1.7, height: 1.3, y: 1.55, z: 0.6, x: ROOM.minX + 0.06 })

/** The sofa and the armchair, which are also the two places you can sit. */
const SOFA = Object.freeze({ x: 0, z: 1.35, width: 2.4, depth: 1.0 })
const CHAIR = Object.freeze({ x: 2.65, z: -0.6, yaw: 0.63 })

/**
 * Where the wooden chair can end up. It is never where you left it, and it only
 * ever moves while your back is turned.
 */
const CHAIR_SPOTS = Object.freeze([
  { x: 2.0, z: 2.6, yaw: 2.6 },
  { x: -2.6, z: 2.4, yaw: -0.9 },
  // Facing into the corner, which is the one that stops people dead.
  { x: 1.3, z: -2.4, yaw: 3.05 },
  { x: -3.0, z: -0.6, yaw: 1.5 },
  { x: 0.9, z: 3.4, yaw: 0.35 },
])

/**
 * Light levels. The house dimmer never quite reaches zero and never reaches
 * daylight either: this is one standing lamp in a room at night, and the point
 * of the room is that the television is the brightest thing in it.
 */
const LAMP = Object.freeze({ min: 1.5, max: 26 })
const AMBIENT = Object.freeze({ min: 0.03, max: 0.26 })
const HEMI = Object.freeze({ min: 0.02, max: 0.2 })
/** Screen spill, from a black frame to a bright one. Same idea as lighting.js. */
const TV_LIGHT = Object.freeze({ min: 5, base: 54 })
/** How hard a lightning flash hits the room. */
const FLASH_MAX = 130

const WARM = 0xffb877
const COOL = 0xbfd2ff

/** Drops on the glass. Enough to read as rain, few enough to cost nothing. */
const DROPS = 44

const _dummy = new THREE.Object3D()
const _point = { x: 0, z: 0 }

/**
 * @param {{ origin?: {x:number,z:number}, audio?: object }} [options]
 */
export function createHorrorVenue(options = {}) {
  const origin = options.origin ?? { x: 0, z: 0 }
  const voices = options.audio ?? null

  const group = new THREE.Group()
  group.name = 'VenueHorror'
  group.position.set(origin.x, 0, origin.z)
  group.visible = false

  /* ---------------------------------------------------------------------- */
  /* materials                                                               */
  /* ---------------------------------------------------------------------- */

  const mats = {
    wall: matte(0x191312, 0.97),
    floor: matte(0x191211, 0.92),
    ceiling: matte(0x0c0a0a, 1),
    skirting: matte(0x231a17, 0.9),
    frame: matte(0x2a2126, 0.95),
    cushion: matte(0x342830, 0.98),
    wood: matte(0x241a16, 0.85),
    woodDark: matte(0x18110f, 0.9),
    door: matte(0x1e1512, 0.8),
    doorPanel: matte(0x150f0d, 0.85),
    handle: new THREE.MeshStandardMaterial({ color: 0x8a8172, roughness: 0.4, metalness: 0.7 }),
    bezel: matte(0x090909, 0.6),
    // Unlit, like the hall's screen: a display makes its own light, and the
    // media module paints straight onto it.
    screen: new THREE.MeshBasicMaterial({ color: 0x0b0f16, fog: false }),
    rug: matte(0x2b1f22, 1),
    fabric: matte(0x1d1720, 0.98),
    metal: new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.45, metalness: 0.6 }),
    shade: glow(0x140e08),
    standby: glow(0x2a0806),
    night: glow(0x0a1220),
    // The paper is a shade lighter than the wall and the plaster under it is a
    // shade darker, which is the whole trick: the eye reads damage, not colour.
    paper: matte(0x231a19, 0.98, { side: THREE.DoubleSide }),
    plaster: matte(0x120d0c, 1),
    /** The rectangle of paper the sun never reached, where a picture hung. */
    ghost: matte(0x241b1a, 0.98),
    drop: new THREE.MeshBasicMaterial({
      color: 0x93aecd,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    }),
    crawler: matte(0x08080a, 1),
    /** The line of light under the door at the end of the corridor. */
    sliver: glow(0x2b3d55),
    /**
     * Whatever is standing at the end of the corridor. Flat black and unlit, so
     * it is only ever a shape against that light, never a thing with a face.
     */
    figure: new THREE.MeshBasicMaterial({
      color: 0x04050a,
      transparent: true,
      opacity: 0,
      fog: false,
    }),
  }

  /* ---------------------------------------------------------------------- */
  /* the room                                                                */
  /* ---------------------------------------------------------------------- */

  buildRoomShell(group, PLAN, mats)

  // The header over the mouth of the corridor: the corridor ceiling is lower
  // than the room's, and this is the piece of wall that says so.
  addBox(
    group,
    mats.wall,
    [0.16, ROOM.height - HALL.height, HALL.maxZ - HALL.minZ],
    [ROOM.maxX, (ROOM.height + HALL.height) / 2, (HALL.minZ + HALL.maxZ) / 2],
  )

  // --- the television -------------------------------------------------------
  /**
   * Live measurements of the set, read every frame by the cinematic frame in
   * player/views.js. A television that can be resized has to be measured, not
   * remembered.
   */
  const screenInfo = {
    center: { x: origin.x + TV.x, y: TV.bottom + TV.height / 2, z: origin.z + TV.z },
    width: TV.width,
    height: TV.height,
    maxBack: ROOM.maxZ - 0.8 - TV.z,
  }

  let tvScale = 1
  let display = null

  function buildTv() {
    const width = TV.width * tvScale
    const height = TV.height * tvScale
    const next = buildDisplay(mats, { width, height, name: 'HorrorScreen' })
    next.group.position.set(TV.x, TV.bottom + height / 2, TV.z)
    group.add(next.group)

    screenInfo.center.y = TV.bottom + height / 2
    screenInfo.width = width
    screenInfo.height = height
    display = next
  }

  /**
   * Put a bigger or a smaller set in the room.
   *
   * The screen mesh is rebuilt rather than scaled: the film, its sound and a
   * YouTube embed all measure the mesh they were handed, and a parent that had
   * been scaled underneath them would leave the picture the size of the old set.
   * The caller hands the new screen to the media module.
   */
  function setTvScale(value) {
    const next = clamp(Number(value) || 1, TV_SCALE.min, TV_SCALE.max)
    if (display && Math.abs(next - tvScale) < 1e-4) return tvScale
    tvScale = next
    const previous = display
    buildTv()
    if (previous) {
      previous.group.removeFromParent()
      // Only our own geometry: the film's surface may still be parented to the
      // old screen until the media module is told about the new one.
      for (const mesh of previous.meshes) mesh.geometry.dispose()
    }
    return tvScale
  }

  buildTv()

  // The cabinet it stands on, and the one red standby light that tells you the
  // set is on even when nothing is playing.
  addBox(group, mats.wood, [2.4, 0.42, 0.44], [0, 0.21, ROOM.minZ + 0.32], { round: 0.02 })
  addBox(group, mats.woodDark, [2.24, 0.03, 0.4], [0, 0.28, ROOM.minZ + 0.32])
  addBox(group, mats.standby, [0.03, 0.02, 0.01], [1.05, 0.44, ROOM.minZ + 0.54])

  // --- the sofa, the rug, the table ----------------------------------------
  const sofa = buildSofa(mats, { width: SOFA.width, depth: SOFA.depth })
  sofa.position.set(SOFA.x, 0, SOFA.z)
  group.add(sofa)

  const armchair = buildArmchair(mats, { width: 1.0, depth: 0.95 })
  armchair.position.set(CHAIR.x, 0, CHAIR.z)
  armchair.rotation.y = CHAIR.yaw
  group.add(armchair)

  addPlane(group, mats.fabric, [3.7, 2.9], [0, 0.008, 0.1], { rx: -Math.PI / 2 })
  addPlane(group, mats.rug, [3.5, 2.7], [0, 0.012, 0.1], { rx: -Math.PI / 2, name: 'Rug' })

  const table = buildTable(mats, { width: 1.15, depth: 0.66, height: 0.5 })
  table.position.set(0, 0, 0.15)
  group.add(table)
  // Somebody left a mug on it and did not come back for it.
  addBox(group, mats.frame, [0.09, 0.11, 0.09], [-0.3, 0.555, 0.05], { round: 0.03 })

  // --- the corner lamp ------------------------------------------------------
  const lampPost = new THREE.Group()
  lampPost.position.set(-3.4, 0, 1.9)
  addBox(lampPost, mats.metal, [0.28, 0.03, 0.28], [0, 0.015, 0], { round: 0.012 })
  addBox(lampPost, mats.metal, [0.035, 1.42, 0.035], [0, 0.72, 0])
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.25, 0.28, 14, 1, true), mats.shade)
  shade.position.y = 1.55
  shade.material.side = THREE.DoubleSide
  lampPost.add(shade)
  group.add(lampPost)

  // --- a sideboard against the left wall ------------------------------------
  addBox(group, mats.wood, [0.5, 0.86, 1.6], [ROOM.minX + 0.35, 0.43, -2.2], { round: 0.02 })
  // Two pictures over it, one of them hanging crooked, and the clean rectangle
  // where a third one used to be. Nobody straightened it and nobody took it
  // down: both of those are somebody's decision, and this room has none left.
  for (const [z, tilt] of [[-2.75, 0], [-1.75, 0.11]]) {
    addBox(group, mats.woodDark, [0.04, 0.46, 0.36], [ROOM.minX + 0.1, 1.72, z], { rx: tilt })
    addBox(group, mats.fabric, [0.012, 0.36, 0.26], [ROOM.minX + 0.13, 1.72, z], { rx: tilt })
  }
  addPlane(group, mats.ghost, [0.34, 0.44], [ROOM.minX + 0.085, 1.7, -0.9], { ry: Math.PI / 2 })
  addBox(group, mats.metal, [0.012, 0.02, 0.02], [ROOM.minX + 0.09, 1.95, -0.9])

  // --- the wallpaper, coming away -------------------------------------------
  // Four strips, all of them above eye level or in a corner, so they are read
  // rather than examined.
  addPeel(group, mats, { x: ROOM.minX + 0.09, y: 2.55, z: -3.3, ry: Math.PI / 2, width: 0.5, height: 1.1, tilt: 0.4 })
  addPeel(group, mats, { x: ROOM.minX + 0.09, y: 2.7, z: 2.9, ry: Math.PI / 2, width: 0.36, height: 0.8, tilt: 0.26 })
  addPeel(group, mats, { x: 3.1, y: 2.66, z: ROOM.minZ + 0.09, width: 0.42, height: 1.25, tilt: 0.32 })
  addPeel(group, mats, { x: -2.4, y: 2.72, z: ROOM.maxZ - 0.09, ry: Math.PI, width: 0.3, height: 0.7, tilt: 0.22 })
  // Damp coming up the wall behind the sofa.
  addPlane(group, mats.plaster, [2.2, 1.1], [0.4, 0.55, ROOM.maxZ - 0.085], { ry: Math.PI })

  // --- the window -----------------------------------------------------------
  const windowUnit = buildWindow(mats, { width: WINDOW.width, height: WINDOW.height })
  windowUnit.group.position.set(WINDOW.x, WINDOW.y, WINDOW.z)
  windowUnit.group.rotation.y = Math.PI / 2
  group.add(windowUnit.group)
  const pane = windowUnit.pane

  // Rain on the glass: one instanced quad per drop, stretched into a trail.
  const drops = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.007, 1), mats.drop, DROPS)
  drops.position.z = 0.02
  drops.frustumCulled = false
  drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  windowUnit.group.add(drops)

  const dropState = Array.from({ length: DROPS }, () => ({
    x: rand(-WINDOW.width / 2 + 0.05, WINDOW.width / 2 - 0.05),
    y: rand(-WINDOW.height / 2, WINDOW.height / 2),
    length: rand(0.05, 0.22),
    speed: rand(0.35, 1.1),
  }))

  // --- the door back to the hall --------------------------------------------
  const exitDoor = buildDoor(mats)
  exitDoor.group.position.set(-1.9, 0, ROOM.maxZ - 0.09)
  exitDoor.group.rotation.y = Math.PI
  group.add(exitDoor.group)

  // --- the corridor ---------------------------------------------------------
  const corridorZ = (HALL.minZ + HALL.maxZ) / 2

  // The door at the far end, left open a hand's width onto whatever is behind
  // it. The light under it is the only cold light in the room.
  const farDoor = buildDoor(mats, { width: 0.86, height: 2.0, ajar: 0.3 })
  farDoor.group.position.set(HALL.maxX - 0.09, 0, corridorZ)
  farDoor.group.rotation.y = -Math.PI / 2
  group.add(farDoor.group)

  const sliver = addPlane(group, mats.sliver, [0.9, 1.9], [HALL.maxX - 0.11, 0.98, corridorZ], {
    ry: -Math.PI / 2,
    name: 'DoorLight',
  })

  // Whatever is standing in front of it. Two boxes: at this distance, in this
  // light, a silhouette is all anyone would see anyway.
  const figure = new THREE.Group()
  figure.position.set(HALL.maxX - 0.95, 0, corridorZ + 0.1)
  figure.visible = false
  addBox(figure, mats.figure, [0.46, 1.62, 0.26], [0, 0.81, 0], { round: 0.05 })
  addBox(figure, mats.figure, [0.22, 0.26, 0.22], [0, 1.75, 0], { round: 0.06 })
  group.add(figure)

  // A dead bulb hanging in the corridor, and a coat on a hook.
  addBox(group, mats.metal, [0.02, 0.5, 0.02], [HALL.minX + 1.2, HALL.height - 0.25, corridorZ])
  addBox(group, mats.fabric, [0.2, 0.9, 0.34], [HALL.minX + 0.5, 1.15, HALL.minZ + 0.28], { round: 0.08 })

  // --- the chair that is not where you left it ------------------------------
  const chair = buildChair(mats)
  let chairSpot = 0
  chair.position.set(CHAIR_SPOTS[0].x, 0, CHAIR_SPOTS[0].z)
  chair.rotation.y = CHAIR_SPOTS[0].yaw
  group.add(chair)

  /** Its blocking box follows it, so a chair behind you is still a chair. */
  const chairBox = blocker('horror-chair', origin, {
    x: CHAIR_SPOTS[0].x,
    z: CHAIR_SPOTS[0].z,
    width: 0.62,
    depth: 0.62,
    top: 0.9,
  })

  function moveChair(spot) {
    chair.position.set(spot.x, 0, spot.z)
    chair.rotation.y = spot.yaw
    chairBox.minX = origin.x + spot.x - 0.31
    chairBox.maxX = origin.x + spot.x + 0.31
    chairBox.minZ = origin.z + spot.z - 0.31
    chairBox.maxZ = origin.z + spot.z + 0.31
  }

  // --- the things that crawl ------------------------------------------------
  // Six of them, low and flat, running along the skirting. They are only ever
  // caught out of the corner of the eye, which is exactly the point.
  const crawlerGeometry = new THREE.SphereGeometry(0.06, 7, 5)
  const crawlerRoom = { width: ROOM.maxX - ROOM.minX, depth: ROOM.maxZ - ROOM.minZ }
  const crawlers = Array.from({ length: 6 }, (_, i) => {
    const mesh = new THREE.Mesh(crawlerGeometry, mats.crawler)
    mesh.scale.set(1.8, 0.5, 1)
    mesh.visible = false
    group.add(mesh)
    return { mesh, t: i / 6, speed: rand(0.02, 0.05), pause: rand(0, 3) }
  })

  /* ---------------------------------------------------------------------- */
  /* light                                                                   */
  /* ---------------------------------------------------------------------- */

  const ambient = new THREE.AmbientLight(0x0b101c, AMBIENT.min)
  const hemisphere = new THREE.HemisphereLight(0x161c2a, 0x060405, HEMI.min)
  group.add(ambient, hemisphere)

  const lampLight = new THREE.PointLight(WARM, LAMP.min, 9, 2)
  lampLight.position.set(-3.4, 1.5, 1.9)
  group.add(lampLight)

  // The television, which is the light in this room exactly as the screen is
  // the light in the hall. Driven from the film every frame.
  const tvLight = new THREE.PointLight(0x9ab7ff, TV_LIGHT.min, 12, 1.7)
  tvLight.position.set(TV.x, TV.bottom + TV.height / 2, TV.z + 0.7)
  group.add(tvLight)

  // The light from the far door, which never reaches the room.
  const corridorLight = new THREE.PointLight(0x4a6a94, 2.4, 4.5, 2)
  corridorLight.position.set(HALL.maxX - 0.5, 1.1, corridorZ)
  group.add(corridorLight)

  // Lightning, from outside the window. Sits inside the room because there is
  // no hole in the wall to come through, and nobody can tell the difference.
  const flashLight = new THREE.PointLight(0xc8daff, 0, 16, 1.6)
  flashLight.position.set(WINDOW.x + 0.4, WINDOW.y + 0.3, WINDOW.z)
  flashLight.visible = false
  group.add(flashLight)

  /* ---------------------------------------------------------------------- */
  /* state                                                                   */
  /* ---------------------------------------------------------------------- */

  let intensity = 0
  let house = 0
  let warmth = 0
  let active = false
  let elapsed = 0

  let thunderIn = 12
  let creakIn = 20
  let flashTime = -1
  let flashPeak = 0
  let heartIn = 0
  let chairIn = 20
  /** 'gone' | 'there' | 'leaving', and how long it has been that way. */
  let figureState = 'gone'
  let figureIn = 40
  let figureAge = 0
  let figureSeen = 0
  let figureFade = 0
  const nightColor = new THREE.Color(0x0a1220)
  const flashColor = new THREE.Color(0xa9c1e4)
  const sliverColor = new THREE.Color(0x2b3d55)

  /** The dimmer, and the colour of the bulb. 0 = tungsten, 1 = moonlight. */
  function applyLights(settings = {}) {
    if (Number.isFinite(settings.house)) house = clamp01(settings.house)
    if (Number.isFinite(settings.warmth)) warmth = clamp01(settings.warmth)

    const bulb = new THREE.Color(WARM).lerp(new THREE.Color(COOL), warmth)
    lampLight.color.copy(bulb)
    lampLight.intensity = lerp(LAMP.min, LAMP.max, house)
    // The shade you can see comes up with the light it throws, so it never
    // glows on a lamp that is switched off.
    mats.shade.color.setHex(0x140e08).lerp(bulb, house * 0.75)

    ambient.intensity = lerp(AMBIENT.min, AMBIENT.max, house)
    hemisphere.intensity = lerp(HEMI.min, HEMI.max, house)
    return { house, warmth }
  }

  /** The film lighting the room, handed over by the media module's screen light. */
  function setScreenLight(color, level) {
    if (color) tvLight.color.copy(color)
    const value = Math.min(Math.max(Number(level) || 0, 0), 2)
    tvLight.intensity = TV_LIGHT.min + (TV_LIGHT.base - TV_LIGHT.min) * value
  }

  /**
   * How frightened this room is, 0..1. See the thresholds at the top of the
   * file: everything under 0.35 is weather, everything over it is company.
   */
  function setIntensity(value) {
    intensity = clamp01(value)
    if (!active) return intensity

    voices?.setRain?.(intensity <= 0.02 ? 0 : intensity * 0.9)
    if (intensity <= 0.02) heartIn = 0
    if (intensity <= 0.5 && figureState !== 'gone') hideFigure(true)
    // Next event is re-rolled so a change of the dial is felt straight away
    // rather than after the old, calmer timer has run out.
    thunderIn = Math.min(thunderIn, nextThunder())
    creakIn = Math.min(creakIn, nextCreak())
    chairIn = Math.min(chairIn, nextChair())
    figureIn = Math.min(figureIn, nextFigure())
    return intensity
  }

  const nextThunder = () => lerp(95, 13, intensity) * rand(0.55, 1.5)
  const nextCreak = () => lerp(70, 9, intensity) * rand(0.5, 1.6)
  const nextChair = () => lerp(90, 22, intensity) * rand(0.6, 1.5)
  const nextFigure = () => lerp(150, 55, intensity) * rand(0.7, 1.4)

  /** Lightning: the flash first, and the sound of it as far behind as it is far. */
  function strike() {
    const near = clamp01(intensity * rand(0.55, 1.15))
    flashPeak = FLASH_MAX * (0.35 + near * 0.9)
    flashTime = 0
    flashLight.visible = true
    const delay = lerp(3.4, 0.35, near)
    setTimeout(() => {
      if (active) voices?.thunder?.({ level: near })
    }, delay * 1000)
  }

  function hideFigure(now = false) {
    if (now) {
      figureState = 'gone'
      figure.visible = false
      figureFade = 0
      mats.figure.opacity = 0
      figureIn = nextFigure()
      return
    }
    figureState = 'leaving'
    figureAge = 0
  }

  /* ---------------------------------------------------------------------- */
  /* frame                                                                   */
  /* ---------------------------------------------------------------------- */

  function updateRain(delta) {
    const level = intensity
    const on = level > 0.02
    drops.visible = on
    mats.drop.opacity = 0.16 + 0.5 * level
    if (!on) return

    // A drop only runs when enough water has gathered behind it, so they crawl
    // and stall rather than fall at one speed. Faster and longer as it worsens.
    const shown = Math.max(4, Math.round(DROPS * (0.25 + 0.75 * level)))
    for (let i = 0; i < DROPS; i += 1) {
      const drop = dropState[i]
      if (i < shown) {
        drop.y -= drop.speed * delta * (0.45 + level * 1.4)
        if (drop.y < -WINDOW.height / 2 - drop.length) {
          drop.y = WINDOW.height / 2 + rand(0, 0.3)
          drop.x = rand(-WINDOW.width / 2 + 0.05, WINDOW.width / 2 - 0.05)
          drop.length = rand(0.05, 0.1 + level * 0.28)
          drop.speed = rand(0.35, 0.8 + level * 0.9)
        }
        _dummy.position.set(drop.x, drop.y + drop.length / 2, 0)
        _dummy.scale.set(1, drop.length, 1)
      } else {
        // Parked off the glass instead of hidden: an InstancedMesh has no per
        // instance visibility, and a zero scale still costs the same triangle.
        _dummy.position.set(0, WINDOW.height * 2, 0)
        _dummy.scale.set(1, 0.0001, 1)
      }
      _dummy.updateMatrix()
      drops.setMatrixAt(i, _dummy.matrix)
    }
    drops.instanceMatrix.needsUpdate = true
  }

  function updateFlash(delta) {
    if (flashTime < 0) return
    flashTime += delta

    // Two pops and a long fall away: real lightning almost never flashes once.
    const t = flashTime
    let shape = 0
    if (t < 0.06) shape = t / 0.06
    else if (t < 0.13) shape = 1 - (t - 0.06) / 0.07 * 0.75
    else if (t < 0.2) shape = 0.25 + (t - 0.13) / 0.07 * 0.7
    else if (t < 0.85) shape = Math.max(0, 0.95 - (t - 0.2) / 0.65)
    else {
      flashTime = -1
      flashLight.intensity = 0
      flashLight.visible = false
      mats.night.color.copy(nightColor)
      return
    }

    flashLight.intensity = flashPeak * shape
    mats.night.color.copy(nightColor).lerp(flashColor, Math.min(shape * 1.1, 1))
  }

  function updateCrawlers(delta) {
    // Below 0.6 there is nothing there. That threshold is part of the design of
    // the dial: under it the room is only weather, over it it has company.
    const shown = intensity <= 0.6 ? 0 : Math.round(lerp(1, crawlers.length, (intensity - 0.6) / 0.4))

    for (let i = 0; i < crawlers.length; i += 1) {
      const crawler = crawlers[i]
      if (i >= shown) {
        crawler.mesh.visible = false
        continue
      }
      crawler.mesh.visible = true
      // They move in bursts. Something that crawls at a constant speed is a
      // toy train; something that stops dead and then bolts is alive.
      crawler.pause -= delta
      if (crawler.pause > 0) continue
      const dash = crawler.speed * (1 + intensity)
      crawler.t += dash * delta
      if (Math.random() < delta * 0.35) {
        crawler.pause = rand(0.4, 2.6)
        if (Math.random() < 0.25) voices?.scuttle?.({ level: intensity, pan: rand(-0.6, 0.6) })
      }
      perimeterPoint(crawler.t, crawlerRoom, 0.16, _point)
      crawler.mesh.position.set(_point.x, 0.035, _point.z)
      crawler.mesh.rotation.y = Math.atan2(_point.x, _point.z)
    }
  }

  /**
   * How far off the middle of the view something is, in the cosine the dot
   * product gives us: 1 is dead ahead, 0 is straight out to the side.
   *
   * @param {{x:number,z:number,dirX:number,dirZ:number}} look the player, in
   *   world coordinates, as the venues module reads it off the controls
   */
  function facing(look, x, z) {
    if (!look) return 0
    const dx = origin.x + x - look.x
    const dz = origin.z + z - look.z
    const distance = Math.hypot(dx, dz) || 1e-4
    return (dx * look.dirX + dz * look.dirZ) / distance
  }

  /** The chair only ever moves behind your back, and never onto your feet. */
  function updateChair(delta, look) {
    if (intensity <= 0.35) return
    chairIn -= delta
    if (chairIn > 0) return

    // Anything in front of the viewer is off limits, and so is anything close
    // enough to walk into. A chair that lands on you is a bug, not a fright.
    const behind = CHAIR_SPOTS.map((spot, index) => ({ spot, index }))
      .filter(({ spot, index }) => {
        if (index === chairSpot) return false
        if (!look) return true
        const near = Math.hypot(origin.x + spot.x - look.x, origin.z + spot.z - look.z)
        return near > 1.6 && facing(look, spot.x, spot.z) < 0.25
      })
    if (!behind.length) {
      // Try again shortly rather than giving up on this one.
      chairIn = 1.2
      return
    }

    const pick = behind[Math.floor(Math.random() * behind.length)]
    chairSpot = pick.index
    moveChair(pick.spot)
    chairIn = nextChair()
    voices?.floorCreak?.({ level: 0.5 + intensity * 0.6 })
  }

  /**
   * Somebody at the end of the corridor.
   *
   * It arrives while you are looking somewhere else, it stays as long as you do
   * not look at it, and once you have looked straight at it for a moment it is
   * gone. Nothing about it moves, and it is never there twice in a row for the
   * same reason a joke is not funny twice.
   */
  function updateFigure(delta, look) {
    const x = HALL.maxX - 0.95
    const z = corridorZ + 0.1

    if (figureState === 'gone') {
      if (intensity <= 0.5) return
      figureIn -= delta
      if (figureIn > 0) return
      // Roughly the edge of the frame: it will not walk in while you watch,
      // but standing with the corridor 70 degrees off your shoulder does not
      // count as watching, or it would never come at all.
      if (facing(look, x, z) > 0.62) {
        figureIn = 2
        return
      }
      figureState = 'there'
      figureAge = 0
      figureSeen = 0
      figure.visible = true
      return
    }

    figureAge += delta

    if (figureState === 'there') {
      figureFade = Math.min(1, figureFade + delta * 1.6)
      mats.figure.opacity = figureFade * 0.96
      // Straight at it, and close enough down the corridor to be sure.
      if (facing(look, x, z) > 0.93) figureSeen += delta
      else figureSeen = Math.max(0, figureSeen - delta * 0.5)
      if (figureSeen > 0.7 || figureAge > 22) {
        hideFigure()
        if (figureSeen > 0.7) voices?.doorAway?.({ level: 0.7 + intensity * 0.5 })
      }
      return
    }

    // Leaving: gone in a third of a second, which is not enough time to be sure
    // you saw it at all.
    figureFade = Math.max(0, figureFade - delta * 3)
    mats.figure.opacity = figureFade * 0.96
    if (figureFade <= 0) hideFigure(true)
  }

  /**
   * @param {number} delta seconds
   * @param {{x:number,z:number,dirX:number,dirZ:number}} [look] where the
   *   viewer is and which way they are looking, in world coordinates
   */
  function update(delta, look) {
    if (!active) return
    elapsed += delta
    updateRain(delta)
    updateFlash(delta)
    updateCrawlers(delta)
    updateFigure(delta, look)

    // The line under the far door breathes, very slightly, as though something
    // on the other side of it moved.
    const breath = 0.72 + Math.sin(elapsed * 0.7) * 0.12 * intensity
    mats.sliver.color.copy(sliverColor).multiplyScalar(breath)
    corridorLight.intensity = 1.6 + breath * 1.2

    if (intensity <= 0.02) return

    updateChair(delta, look)

    thunderIn -= delta
    if (thunderIn <= 0) {
      thunderIn = nextThunder()
      strike()
    }

    creakIn -= delta
    if (creakIn <= 0) {
      creakIn = nextCreak()
      // The house has three ways of saying it is still standing.
      const roll = Math.random()
      if (roll < 0.5) voices?.creak?.({ level: 0.5 + intensity })
      else if (roll < 0.78) voices?.floorCreak?.({ level: 0.5 + intensity })
      else voices?.doorAway?.({ level: 0.4 + intensity * 0.9 })
    }

    if (intensity > 0.6) {
      heartIn -= delta
      if (heartIn <= 0) {
        // Faster the further past the threshold you push it: 58 bpm at 0.6,
        // about 100 at 1.
        const bpm = lerp(58, 104, (intensity - 0.6) / 0.4)
        heartIn = 60 / bpm
        voices?.heartbeat?.({ level: (intensity - 0.6) * 2.2, rate: bpm / 60 })
      }
    } else {
      heartIn = 0
    }
  }

  /* ---------------------------------------------------------------------- */

  function enter() {
    active = true
    group.visible = true
    hideFigure(true)
    thunderIn = nextThunder() * 0.35
    creakIn = nextCreak() * 0.4
    chairIn = nextChair() * 0.5
    // Nothing is waiting for you in the corridor the moment you walk in.
    figureIn = Math.max(20, nextFigure() * 0.6)
    heartIn = 0
    setIntensity(intensity)
  }

  function exit() {
    active = false
    group.visible = false
    flashTime = -1
    flashLight.intensity = 0
    flashLight.visible = false
    mats.night.color.copy(nightColor)
    hideFigure(true)
    voices?.setRain?.(0)
  }

  function dispose() {
    exit()
    disposeRoom(group, mats)
    crawlerGeometry.dispose()
    group.removeFromParent?.()
  }

  applyLights({ house: 0, warmth: 0 })

  /* ---------------------------------------------------------------------- */
  /* what the rest of the app sees                                           */
  /* ---------------------------------------------------------------------- */

  /** The middle of the set at its ordinary size: where a shot looks. */
  const tvTarget = { x: TV.x, y: TV.bottom + TV.height / 2, z: TV.z }

  const seats = [
    venueSeat(origin, {
      id: 'horror-sofa-left',
      label: 'Sofa, left',
      x: SOFA.x - 0.47,
      z: SOFA.z,
      eyeY: 1.18,
      look: tvTarget,
      stand: { x: -1.75, z: 1.0 },
    }),
    venueSeat(origin, {
      id: 'horror-sofa-right',
      label: 'Sofa, right',
      x: SOFA.x + 0.47,
      z: SOFA.z,
      eyeY: 1.18,
      look: tvTarget,
      stand: { x: 1.75, z: 1.0 },
    }),
    venueSeat(origin, {
      id: 'horror-armchair',
      label: 'The armchair',
      x: CHAIR.x,
      z: CHAIR.z,
      yaw: CHAIR.yaw,
      eyeY: 1.2,
      look: tvTarget,
      stand: { x: 1.5, z: -1.2 },
    }),
  ]

  const views = [
    venueView(origin, {
      id: 'sofa',
      label: 'From the sofa',
      hint: 'where you are sitting',
      drift: 0.05,
      eye: { x: SOFA.x, y: 1.18, z: SOFA.z + 0.16 },
      target: tvTarget,
    }),
    venueView(origin, {
      id: 'door',
      label: 'From the door',
      hint: 'just as you walked in',
      drift: 0.12,
      eye: { x: -1.9, y: 1.62, z: 3.7 },
      target: tvTarget,
    }),
    venueView(origin, {
      id: 'corridor',
      label: 'Down the corridor',
      hint: 'out of the dark',
      drift: 0.05,
      // Inside the corridor, aimed through its mouth: the room is what you see,
      // and the frame around it is a wall you are standing behind.
      eye: { x: 5.4, y: 1.52, z: corridorZ },
      target: { x: 0.4, y: 1.05, z: 0.2 },
    }),
    venueView(origin, {
      id: 'behind-tv',
      label: 'Behind the television',
      hint: 'the reverse angle',
      drift: 0.18,
      eye: { x: 0, y: 1.45, z: ROOM.minZ + 0.85 },
      target: { x: SOFA.x, y: 0.95, z: SOFA.z },
    }),
    venueView(origin, {
      id: 'wide',
      label: 'Wide',
      hint: 'the whole room',
      drift: 0.5,
      eye: { x: -3.3, y: 2.45, z: 3.6 },
      target: { x: 0.6, y: 1.0, z: -1.4 },
    }),
  ]

  return {
    id: 'horror',
    label: 'Horror house',
    description: 'A dark living room with rain on the glass, a corridor, and a television that is on.',
    group,
    get screen() {
      return display.screen
    },
    pane,
    /** Just inside the door, looking at the television. */
    spawn: { x: origin.x - 1.9, z: origin.z + 3.5, yaw: 0 },
    layout: {
      bounds: roomBounds(origin, { minX: ROOM.minX, maxX: HALL.maxX, minZ: ROOM.minZ, maxZ: ROOM.maxZ }),
      floorAt: () => 0,
      blockers: [
        // The two corners of the bounding rectangle that are not in the room.
        fill('horror-void-front', origin, {
          minX: HALL.minX, maxX: HALL.maxX, minZ: ROOM.minZ, maxZ: HALL.minZ,
        }),
        fill('horror-void-back', origin, {
          minX: HALL.minX, maxX: HALL.maxX, minZ: HALL.maxZ, maxZ: ROOM.maxZ,
        }),
        blocker('horror-sofa', origin, { x: SOFA.x, z: SOFA.z, width: 2.5, depth: 1.1, top: 0.9 }),
        blocker('horror-table', origin, { z: 0.15, width: 1.2, depth: 0.72, top: 0.55 }),
        blocker('horror-tv-unit', origin, {
          z: ROOM.minZ + 0.32, width: 2.5, depth: 0.5, top: 0.55,
        }),
        blocker('horror-armchair', origin, { x: CHAIR.x, z: CHAIR.z, width: 1.25, depth: 1.25, top: 0.95 }),
        blocker('horror-lamp', origin, { x: -3.4, z: 1.9, width: 0.5, depth: 0.5, top: 1.7 }),
        blocker('horror-sideboard', origin, {
          x: ROOM.minX + 0.35, z: -2.2, width: 0.6, depth: 1.7, top: 0.9,
        }),
        chairBox,
      ],
    },
    seats,
    /** A living room, not an auditorium: the sofa is not offered from the door. */
    seatReach: 2.1,
    views,
    screenInfo,
    /** Walking into this takes you back to the hall. */
    exits: [
      {
        to: 'cinema',
        x: origin.x - 1.9,
        z: origin.z + ROOM.maxZ - 0.55,
        radius: 1.3,
        label: 'Back to the hall',
      },
    ],
    applyLights,
    setScreenLight,
    setIntensity,
    setTvScale,
    get tvScale() {
      return tvScale
    },
    get intensity() {
      return intensity
    },
    update,
    enter,
    exit,
    dispose,
  }
}

export default createHorrorVenue

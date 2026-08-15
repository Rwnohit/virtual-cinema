/**
 * «Ζεστό σαλόνι»: the room you would actually want to watch a film in.
 *
 * It is not the horror room repainted, and that was the whole brief. It is
 * wider than it is deep, it is low and beamed, and it has a bay window pushed
 * out of the left hand wall with a bench in it, snow going past outside and a
 * moon that never quite comes out. The fire is on the right, the books are
 * behind you where they belong, and nothing in here ever moves on its own
 * except the fire, the snow and the cat.
 *
 * The screen is still the brightest thing in the room. The lamps sit
 * deliberately under it, which is what stops a warm room from turning into a
 * lit shop window and swallowing the film.
 *
 * Local coordinates:
 *   -Z ... towards the television
 *   +Z ... towards the door back to the hall
 *   -X ... towards the bay window
 *   +X ... towards the fire
 */

import * as THREE from 'three'
import {
  addBox,
  addPlane,
  blocker,
  buildArmchair,
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
  rand,
  roomBounds,
  disposeRoom,
  venueSeat,
  venueView,
} from './kit.js'

/** The room: wide, shallow and low, which is the opposite of the other one. */
const ROOM = Object.freeze({ minX: -5, maxX: 5, minZ: -3.8, maxZ: 3.8, height: 3.15 })

/** The bay, pushed out of the left hand wall, with the bench in it. */
const BAY = Object.freeze({ minX: -6.5, maxX: -5, minZ: -1.3, maxZ: 1.3, height: 2.5 })

const PLAN = Object.freeze({
  height: ROOM.height,
  areas: [
    { minX: ROOM.minX, maxX: ROOM.maxX, minZ: ROOM.minZ, maxZ: ROOM.maxZ },
    { minX: BAY.minX, maxX: BAY.maxX, minZ: BAY.minZ, maxZ: BAY.maxZ, height: BAY.height },
  ],
  walls: [
    { x1: ROOM.minX, z1: ROOM.minZ, x2: ROOM.maxX, z2: ROOM.minZ },
    { x1: ROOM.minX, z1: ROOM.maxZ, x2: ROOM.maxX, z2: ROOM.maxZ },
    { x1: ROOM.maxX, z1: ROOM.minZ, x2: ROOM.maxX, z2: ROOM.maxZ },
    // The left hand wall, in two pieces, with the bay opening between them.
    { x1: ROOM.minX, z1: ROOM.minZ, x2: ROOM.minX, z2: BAY.minZ },
    { x1: ROOM.minX, z1: BAY.maxZ, x2: ROOM.minX, z2: ROOM.maxZ },
    { x1: BAY.minX, z1: BAY.minZ, x2: BAY.maxX, z2: BAY.minZ, height: BAY.height },
    { x1: BAY.minX, z1: BAY.maxZ, x2: BAY.maxX, z2: BAY.maxZ, height: BAY.height },
    { x1: BAY.minX, z1: BAY.minZ, x2: BAY.minX, z2: BAY.maxZ, height: BAY.height },
  ],
})

/** The big screen on the wall. Bigger than the horror set, and hung higher. */
const TV = Object.freeze({ width: 3.0, height: 1.6875, x: 0, z: ROOM.minZ + 0.19, bottom: 0.52 })
const TV_SCALE = Object.freeze({ min: 0.7, max: 1.3 })

/** The fireplace, on the right hand wall. */
const FIRE = Object.freeze({ x: ROOM.maxX - 0.06, z: -0.5, width: 1.5, height: 1.15 })

/** The couch, the armchair and the bench in the bay: three places to sit. */
const SOFA = Object.freeze({ x: 0, z: 1.55, width: 2.7, depth: 1.05 })
const CHAIR = Object.freeze({ x: 3.3, z: 0.2, yaw: 0.71 })
const BENCH = Object.freeze({ x: -6.05, z: 0, width: 0.5, depth: 1.9 })

const LAMP = Object.freeze({ min: 5, max: 34 })
const AMBIENT = Object.freeze({ min: 0.1, max: 0.44 })
const HEMI = Object.freeze({ min: 0.07, max: 0.34 })
const TV_LIGHT = Object.freeze({ min: 6, base: 62 })
const FIRE_LIGHT = Object.freeze({ min: 0, max: 34 })

const WARM = 0xffb877
const COOL = 0xdce8ff

/** Book spines, in the colours old books actually are. */
const BOOK_COLORS = [0x6d3b2c, 0x3f4a35, 0x2f3b4f, 0x6b5a34, 0x4a2f3a, 0x37403f, 0x5c4a33]

/** Flakes on the bay window. Slow, and never in a hurry to land. */
const FLAKES = 54

const _dummy = new THREE.Object3D()
const _color = new THREE.Color()

/**
 * One bookshelf unit, filled. The books are a single InstancedMesh: 60 spines
 * for the cost of one draw call, which is the only reason a wall of them is
 * affordable next to a 150 seat auditorium.
 */
function buildShelf(mats, options = {}) {
  const { width = 1.6, height = 2.05, depth = 0.32, shelves = 4 } = options
  const group = new THREE.Group()
  group.name = 'Bookshelf'

  addBox(group, mats.wood, [0.05, height, depth], [-width / 2, height / 2, 0])
  addBox(group, mats.wood, [0.05, height, depth], [width / 2, height / 2, 0])
  addBox(group, mats.woodDark, [width, 0.03, 0.02], [0, height / 2, -depth / 2 + 0.01])
  addBox(group, mats.wood, [width, 0.04, depth], [0, height - 0.02, 0])
  addBox(group, mats.wood, [width, 0.04, depth], [0, 0.02, 0])

  const gap = (height - 0.08) / shelves
  const perShelf = 15
  const books = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats.book, shelves * perShelf)
  books.name = 'Books'

  let index = 0
  for (let s = 0; s < shelves; s += 1) {
    const shelfY = 0.04 + s * gap
    if (s > 0) addBox(group, mats.wood, [width - 0.1, 0.03, depth - 0.02], [0, shelfY, 0])

    // Fill from the left, leaving whatever is over at the right: a shelf that
    // is exactly full looks printed, a shelf with a gap looks used.
    let x = -width / 2 + 0.08
    for (let b = 0; b < perShelf; b += 1) {
      const thickness = rand(0.022, 0.05)
      const tall = rand(0.19, gap - 0.06)
      const lean = b === perShelf - 1 ? rand(-0.22, 0) : 0
      if (x + thickness > width / 2 - 0.08) {
        // Out of room on this shelf. Park the rest inside the carcass.
        _dummy.position.set(0, shelfY - 1, 0)
        _dummy.rotation.set(0, 0, 0)
        _dummy.scale.set(0.0001, 0.0001, 0.0001)
      } else {
        _dummy.position.set(x + thickness / 2, shelfY + 0.02 + tall / 2, 0.01)
        _dummy.rotation.set(0, 0, lean)
        _dummy.scale.set(thickness, tall, depth - 0.09)
        x += thickness + 0.004
      }
      _dummy.updateMatrix()
      books.setMatrixAt(index, _dummy.matrix)
      books.setColorAt(index, _color.setHex(BOOK_COLORS[index % BOOK_COLORS.length]))
      index += 1
    }
  }
  books.instanceMatrix.needsUpdate = true
  if (books.instanceColor) books.instanceColor.needsUpdate = true
  group.add(books)

  return group
}

/**
 * @param {{ origin?: {x:number,z:number}, audio?: object }} [options]
 */
export function createCozyVenue(options = {}) {
  const origin = options.origin ?? { x: 0, z: 0 }
  const voices = options.audio ?? null

  const group = new THREE.Group()
  group.name = 'VenueCozy'
  group.position.set(origin.x, 0, origin.z)
  group.visible = false

  /* ---------------------------------------------------------------------- */
  /* materials                                                               */
  /* ---------------------------------------------------------------------- */

  const mats = {
    wall: matte(0x2f2721, 0.96),
    floor: matte(0x33241a, 0.86),
    ceiling: matte(0x241d18, 1),
    skirting: matte(0x3d3128, 0.9),
    beam: matte(0x2b1f16, 0.9),
    frame: matte(0x4a3b33, 0.95),
    cushion: matte(0x5b4638, 0.98),
    wood: matte(0x3a2a1e, 0.82),
    woodDark: matte(0x281c14, 0.88),
    door: matte(0x3a2a1f, 0.8),
    doorPanel: matte(0x2d2018, 0.85),
    handle: new THREE.MeshStandardMaterial({ color: 0xb08d52, roughness: 0.35, metalness: 0.75 }),
    bezel: matte(0x121212, 0.6),
    screen: new THREE.MeshBasicMaterial({ color: 0x101520, fog: false }),
    rug: matte(0x6a4a38, 1),
    rugTrim: matte(0x4c3325, 1),
    book: matte(0x6d3b2c, 0.92),
    stone: matte(0x3b3630, 0.95),
    metal: new THREE.MeshStandardMaterial({ color: 0x4a4238, roughness: 0.5, metalness: 0.5 }),
    leaf: matte(0x2f4a2c, 0.9),
    shade: glow(0x3a2410),
    ember: glow(0x40160a),
    curtain: matte(0x4a2f2a, 0.99),
    cat: matte(0x241a1a, 1),
    /** The night outside, and the moon that never quite gets through it. */
    night: glow(0x0d1524),
    moon: new THREE.MeshBasicMaterial({
      color: 0x8fa6c8,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      fog: false,
    }),
    flake: new THREE.MeshBasicMaterial({
      color: 0xc8d6ea,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      fog: false,
    }),
    flame: new THREE.MeshBasicMaterial({
      color: 0xff8a34,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      side: THREE.DoubleSide,
    }),
  }

  /* ---------------------------------------------------------------------- */
  /* the room                                                                */
  /* ---------------------------------------------------------------------- */

  buildRoomShell(group, PLAN, mats)

  // Four beams across the ceiling. A low room with beams in it is a different
  // room from a low room without them, and they cost four boxes.
  for (const z of [-2.6, -0.9, 0.8, 2.5]) {
    addBox(group, mats.beam, [ROOM.maxX - ROOM.minX, 0.22, 0.18], [0, ROOM.height - 0.13, z])
  }
  // The header over the bay, where the ceiling steps down.
  addBox(
    group,
    mats.wall,
    [0.16, ROOM.height - BAY.height, BAY.maxZ - BAY.minZ],
    [ROOM.minX, (ROOM.height + BAY.height) / 2, 0],
  )

  // --- the television -------------------------------------------------------
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
    const next = buildDisplay(mats, { width, height, name: 'CozyScreen' })
    next.group.position.set(TV.x, TV.bottom + height / 2, TV.z)
    group.add(next.group)

    screenInfo.center.y = TV.bottom + height / 2
    screenInfo.width = width
    screenInfo.height = height
    display = next
  }

  /**
   * A bigger or a smaller set. The mesh is rebuilt rather than scaled: see the
   * same function in horror.js for why.
   */
  function setTvScale(value) {
    const next = clamp(Number(value) || 1, TV_SCALE.min, TV_SCALE.max)
    if (display && Math.abs(next - tvScale) < 1e-4) return tvScale
    tvScale = next
    const previous = display
    buildTv()
    if (previous) {
      previous.group.removeFromParent()
      for (const mesh of previous.meshes) mesh.geometry.dispose()
    }
    return tvScale
  }

  buildTv()

  // A low sideboard under the screen with a couple of things on it.
  addBox(group, mats.wood, [2.9, 0.44, 0.44], [0, 0.22, ROOM.minZ + 0.32], { round: 0.02 })
  addBox(group, mats.woodDark, [0.16, 0.24, 0.14], [-1.1, 0.56, ROOM.minZ + 0.32], { round: 0.02 })
  addBox(group, mats.stone, [0.1, 0.16, 0.1], [1.15, 0.52, ROOM.minZ + 0.32], { round: 0.03 })

  // --- the couch and the armchair -------------------------------------------
  const couch = buildSofa(mats, { width: SOFA.width, depth: SOFA.depth, seat: 0.44 })
  couch.position.set(SOFA.x, 0, SOFA.z)
  group.add(couch)
  // A throw over the near arm, because nobody folds these.
  addBox(group, mats.curtain, [0.5, 0.06, 0.62], [SOFA.x - SOFA.width / 2 + 0.16, 0.79, SOFA.z - 0.08], {
    round: 0.03,
    rz: 0.06,
  })

  const chair = buildArmchair(mats, { width: 1.02, depth: 0.96, seat: 0.42 })
  chair.position.set(CHAIR.x, 0, CHAIR.z)
  chair.rotation.y = CHAIR.yaw
  group.add(chair)

  addPlane(group, mats.rugTrim, [4.6, 3.4], [0, 0.008, 0.1], { rx: -Math.PI / 2 })
  addPlane(group, mats.rug, [4.3, 3.1], [0, 0.012, 0.1], { rx: -Math.PI / 2, name: 'Rug' })

  const table = buildTable(mats, { width: 1.3, depth: 0.72, height: 0.5 })
  table.position.set(0, 0, 0.3)
  group.add(table)
  addBox(group, mats.stone, [0.24, 0.05, 0.18], [0.3, 0.555, 0.3], { round: 0.02 })
  addBox(group, mats.frame, [0.09, 0.1, 0.09], [-0.22, 0.58, 0.24], { round: 0.03 })
  // Two books left open face down, which is how books live in a room like this.
  addBox(group, mats.book, [0.22, 0.04, 0.16], [-0.42, 0.545, 0.42], { ry: 0.3 })
  addBox(group, mats.book, [0.2, 0.03, 0.15], [-0.4, 0.575, 0.44], { ry: 0.12 })

  // --- the books ------------------------------------------------------------
  // Behind the couch, where a bookcase belongs. The last room had them facing
  // the seats, which is exactly where a television needs to be.
  for (const x of [-2.7, -0.8]) {
    const shelf = buildShelf(mats)
    shelf.position.set(x, 0, ROOM.maxZ - 0.24)
    shelf.rotation.y = Math.PI
    group.add(shelf)
  }

  // --- the lamps ------------------------------------------------------------
  /** A table lamp: base, stem, shade. The shade is what you actually see. */
  function buildTableLamp() {
    const lamp = new THREE.Group()
    addBox(lamp, mats.metal, [0.16, 0.03, 0.16], [0, 0.015, 0], { round: 0.012 })
    addBox(lamp, mats.metal, [0.03, 0.28, 0.03], [0, 0.16, 0])
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 0.19, 14, 1, true), mats.shade)
    cone.position.y = 0.38
    cone.material.side = THREE.DoubleSide
    lamp.add(cone)
    return lamp
  }

  // Side table by the couch, with a lamp on it.
  const sideTable = buildTable(mats, { width: 0.5, depth: 0.5, height: 0.56 })
  sideTable.position.set(1.85, 0, 2.15)
  group.add(sideTable)
  const lampA = buildTableLamp()
  lampA.position.set(1.85, 0.56, 2.15)
  group.add(lampA)

  // And one on the bookshelf, which is what lights the back of the room.
  const lampB = buildTableLamp()
  lampB.position.set(-0.8, 2.09, ROOM.maxZ - 0.24)
  group.add(lampB)

  // A plant in the far corner, because every warm room has one.
  const pot = addBox(group, mats.stone, [0.34, 0.36, 0.34], [4.3, 0.18, 3.1], { round: 0.05 })
  pot.name = 'Plant'
  for (let i = 0; i < 7; i += 1) {
    const angle = (i / 7) * Math.PI * 2
    addBox(group, mats.leaf, [0.05, 0.62, 0.16], [4.3 + Math.cos(angle) * 0.12, 0.66, 3.1 + Math.sin(angle) * 0.12], {
      rz: Math.cos(angle) * 0.3,
      rx: Math.sin(angle) * 0.3,
    })
  }

  // --- the bay window -------------------------------------------------------
  const bayWindow = buildWindow(mats, { width: 2.1, height: 1.55, sill: true })
  bayWindow.group.position.set(BAY.minX + 0.09, 1.42, 0)
  bayWindow.group.rotation.y = Math.PI / 2
  group.add(bayWindow.group)

  // Two narrow ones on the cheeks of the bay, which is what makes it a bay and
  // not a hole in the wall.
  for (const sign of [-1, 1]) {
    const cheek = buildWindow(mats, { width: 0.8, height: 1.4, bars: false, sill: false })
    cheek.group.position.set(BAY.minX + 0.75, 1.42, sign * (BAY.maxZ - 0.09))
    cheek.group.rotation.y = sign > 0 ? 0 : Math.PI
    group.add(cheek.group)
  }

  // The moon, behind the snow, never quite out.
  const moon = addPlane(group, mats.moon, [0.5, 0.5], [BAY.minX + 0.11, 1.86, -0.5], {
    ry: Math.PI / 2,
    name: 'Moon',
  })

  // Snow going past the glass. Same instanced trick as the rain next door, with
  // the opposite behaviour: it drifts, and it is in no hurry.
  const flakes = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.03, 0.03), mats.flake, FLAKES)
  flakes.position.set(BAY.minX + 0.14, 1.42, 0)
  flakes.rotation.y = Math.PI / 2
  flakes.frustumCulled = false
  flakes.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  group.add(flakes)

  const flakeState = Array.from({ length: FLAKES }, () => ({
    x: rand(-1.05, 1.05),
    y: rand(-0.78, 0.78),
    speed: rand(0.07, 0.22),
    sway: rand(0.2, 0.9),
    phase: rand(0, Math.PI * 2),
  }))

  // Curtains either side of the bay opening, and a pelmet over it.
  for (const sign of [-1, 1]) {
    addBox(group, mats.curtain, [0.22, 2.3, 0.34], [ROOM.minX + 0.22, 1.2, sign * 1.16], { round: 0.06 })
  }
  addBox(group, mats.curtain, [0.28, 0.26, 2.9], [ROOM.minX + 0.22, 2.44, 0], { round: 0.05 })

  // The bench in the bay: the third place to sit, and the best one.
  addBox(group, mats.wood, [BENCH.width, 0.42, BENCH.depth], [BENCH.x, 0.21, BENCH.z], { round: 0.03 })
  addBox(group, mats.cushion, [BENCH.width - 0.06, 0.12, BENCH.depth - 0.12], [BENCH.x, 0.48, BENCH.z], {
    round: 0.05,
  })
  for (const z of [-0.62, 0.02, 0.66]) {
    addBox(group, mats.curtain, [0.14, 0.34, 0.34], [BENCH.x - 0.14, 0.7, z], { round: 0.07, rz: 0.2 })
  }

  // --- the fireplace --------------------------------------------------------
  const hearth = new THREE.Group()
  hearth.position.set(FIRE.x, 0, FIRE.z)
  hearth.rotation.y = -Math.PI / 2
  group.add(hearth)

  addBox(hearth, mats.stone, [FIRE.width + 0.7, FIRE.height + 0.55, 0.26], [0, (FIRE.height + 0.55) / 2, 0.12])
  addBox(hearth, mats.woodDark, [FIRE.width + 1.0, 0.11, 0.34], [0, FIRE.height + 0.6, 0.16])
  // The opening: a black recess the flames sit inside.
  addBox(hearth, mats.ceiling, [FIRE.width, FIRE.height, 0.1], [0, FIRE.height / 2 + 0.05, 0.2])
  addBox(hearth, mats.stone, [FIRE.width + 0.9, 0.06, 0.55], [0, 0.03, 0.42])
  addBox(hearth, mats.ember, [FIRE.width - 0.5, 0.07, 0.12], [0, 0.11, 0.24])
  // Two logs, and a basket of spares beside the hearth.
  addBox(hearth, mats.woodDark, [0.62, 0.11, 0.11], [-0.1, 0.17, 0.26], { round: 0.045, rz: 0.1 })
  addBox(hearth, mats.woodDark, [0.58, 0.1, 0.1], [0.08, 0.28, 0.26], { round: 0.04, rz: -0.16 })
  addBox(hearth, mats.wood, [0.42, 0.3, 0.42], [1.35, 0.15, 0.42], { round: 0.04 })
  for (let i = 0; i < 4; i += 1) {
    addBox(hearth, mats.woodDark, [0.09, 0.09, 0.38], [1.28 + i * 0.05, 0.24 + (i % 2) * 0.08, 0.42], {
      round: 0.04,
      rx: 0.1,
    })
  }
  // A picture over the mantel, straight, because somebody looks after this room.
  addBox(hearth, mats.woodDark, [0.86, 0.62, 0.05], [0, FIRE.height + 1.05, 0.12])
  addBox(hearth, mats.rugTrim, [0.72, 0.48, 0.01], [0, FIRE.height + 1.05, 0.15])

  // The flames themselves: three additive sheets, which is all a fire seen from
  // across a room ever needs. They are animated, not simulated.
  const flames = [0.42, 0.62, 0.5].map((height, i) => {
    const flame = new THREE.Mesh(new THREE.PlaneGeometry(0.34, height), mats.flame)
    flame.position.set((i - 1) * 0.26, height / 2 + 0.14, 0.26 + i * 0.01)
    flame.userData.height = height
    flame.renderOrder = 3
    hearth.add(flame)
    return flame
  })

  // --- the cat --------------------------------------------------------------
  // Curled up on the rug where the fire reaches. It breathes and does nothing
  // else, which is the most a cat has ever done in a room like this.
  const cat = new THREE.Group()
  cat.position.set(2.0, 0, -0.9)
  cat.rotation.y = -0.5
  addBox(cat, mats.cat, [0.44, 0.2, 0.3], [0, 0.11, 0], { round: 0.09 })
  addBox(cat, mats.cat, [0.19, 0.17, 0.18], [0.2, 0.16, 0.06], { round: 0.07 })
  addBox(cat, mats.cat, [0.32, 0.07, 0.07], [-0.16, 0.07, 0.14], { round: 0.03, ry: 0.6 })
  for (const sign of [-1, 1]) {
    addBox(cat, mats.cat, [0.06, 0.07, 0.05], [0.25, 0.26, sign * 0.05], { rz: sign * 0.2 })
  }
  group.add(cat)

  // --- the door -------------------------------------------------------------
  const door = buildDoor(mats)
  door.group.position.set(2.6, 0, ROOM.maxZ - 0.09)
  door.group.rotation.y = Math.PI
  group.add(door.group)

  /* ---------------------------------------------------------------------- */
  /* light                                                                   */
  /* ---------------------------------------------------------------------- */

  const ambient = new THREE.AmbientLight(0x2a1d14, AMBIENT.min)
  const hemisphere = new THREE.HemisphereLight(0x3b2c20, 0x120c08, HEMI.min)
  group.add(ambient, hemisphere)

  const lampLights = [
    new THREE.PointLight(WARM, LAMP.min, 8, 2),
    new THREE.PointLight(WARM, LAMP.min * 0.7, 7, 2),
  ]
  lampLights[0].position.set(1.85, 0.95, 2.15)
  lampLights[1].position.set(-0.8, 2.45, ROOM.maxZ - 0.3)
  for (const light of lampLights) group.add(light)

  const fireLight = new THREE.PointLight(0xff8a3c, FIRE_LIGHT.max, 9, 1.9)
  fireLight.position.set(FIRE.x - 0.5, 0.55, FIRE.z)
  group.add(fireLight)

  // The night coming in at the bay. Cold, and far too weak to compete with the
  // film: it is there so the window reads as a window.
  const moonLight = new THREE.PointLight(0x6d86b4, 2.2, 5, 2)
  moonLight.position.set(BAY.minX + 0.6, 1.7, 0)
  group.add(moonLight)

  const tvLight = new THREE.PointLight(0x9ab7ff, TV_LIGHT.min, 13, 1.7)
  tvLight.position.set(TV.x, TV.bottom + TV.height / 2, TV.z + 0.8)
  group.add(tvLight)

  /* ---------------------------------------------------------------------- */
  /* state                                                                   */
  /* ---------------------------------------------------------------------- */

  let house = 0
  let warmth = 0
  let fire = 0.75
  let active = false
  let elapsed = 0
  let crackleIn = 3

  /**
   * The room's own dimmer.
   *
   * The lamps never go all the way out, unlike the hall: this is a home, and a
   * home with every light off at the wall is the other room. What the slider
   * really does here is decide whether you are reading or watching.
   */
  function applyLights(settings = {}) {
    if (Number.isFinite(settings.house)) house = clamp01(settings.house)
    if (Number.isFinite(settings.warmth)) warmth = clamp01(settings.warmth)

    const bulb = new THREE.Color(WARM).lerp(new THREE.Color(COOL), warmth)
    lampLights[0].color.copy(bulb)
    lampLights[1].color.copy(bulb)
    lampLights[0].intensity = lerp(LAMP.min, LAMP.max, house)
    lampLights[1].intensity = lerp(LAMP.min, LAMP.max, house) * 0.7
    mats.shade.color.setHex(0x2a1a0c).lerp(bulb, 0.25 + house * 0.6)

    ambient.intensity = lerp(AMBIENT.min, AMBIENT.max, house)
    hemisphere.intensity = lerp(HEMI.min, HEMI.max, house)
    return { house, warmth }
  }

  function setScreenLight(color, level) {
    if (color) tvLight.color.copy(color)
    const value = Math.min(Math.max(Number(level) || 0, 0), 2)
    tvLight.intensity = TV_LIGHT.min + (TV_LIGHT.base - TV_LIGHT.min) * value
  }

  /** How much fire there is in the fireplace, 0 = out, 1 = properly going. */
  function setFire(value) {
    fire = clamp01(value)
    const on = fire > 0.01
    for (const flame of flames) flame.visible = on
    mats.ember.color.setHex(0x120604).lerp(new THREE.Color(0xff5a1e), fire * 0.8)
    if (active) voices?.setFire?.(fire)
    return fire
  }

  function updateSnow(delta) {
    for (let i = 0; i < FLAKES; i += 1) {
      const flake = flakeState[i]
      flake.y -= flake.speed * delta
      if (flake.y < -0.8) {
        flake.y = 0.8
        flake.x = rand(-1.05, 1.05)
        flake.speed = rand(0.07, 0.22)
      }
      // Sideways drift, so no two of them fall down the same line.
      const x = flake.x + Math.sin(elapsed * flake.sway + flake.phase) * 0.09
      _dummy.position.set(x, flake.y, 0)
      _dummy.scale.setScalar(0.6 + (i % 5) * 0.18)
      _dummy.updateMatrix()
      flakes.setMatrixAt(i, _dummy.matrix)
    }
    flakes.instanceMatrix.needsUpdate = true
  }

  function update(delta) {
    if (!active) return
    elapsed += delta

    updateSnow(delta)
    // The cat breathes: 14 a minute, which is a cat asleep.
    cat.scale.set(1, 1 + Math.sin(elapsed * 1.45) * 0.035, 1)
    mats.moon.opacity = 0.26 + Math.sin(elapsed * 0.11) * 0.06

    // The fire. Three sines at prime-ish rates never repeat visibly, which is
    // what keeps a loop from reading as a loop.
    if (fire > 0.01) {
      const flicker =
        1 + Math.sin(elapsed * 8.3) * 0.09 + Math.sin(elapsed * 3.1) * 0.06 + Math.sin(elapsed * 17.7) * 0.03
      fireLight.intensity = lerp(FIRE_LIGHT.min, FIRE_LIGHT.max, fire) * flicker
      mats.flame.opacity = (0.34 + 0.3 * fire) * flicker
      for (let i = 0; i < flames.length; i += 1) {
        const flame = flames[i]
        const wobble = 1 + Math.sin(elapsed * (5.5 + i * 1.7) + i) * 0.16
        flame.scale.set(1 + Math.sin(elapsed * (3.3 + i)) * 0.1, wobble, 1)
        flame.position.y = (flame.userData.height * wobble) / 2 + 0.14
      }

      crackleIn -= delta
      if (crackleIn <= 0) {
        crackleIn = rand(1.2, 6) / (0.4 + fire)
        voices?.crackle?.({ level: fire })
      }
    } else {
      fireLight.intensity = 0
    }
  }

  function enter() {
    active = true
    group.visible = true
    voices?.setFire?.(fire)
    crackleIn = rand(0.8, 3)
  }

  function exit() {
    active = false
    group.visible = false
    voices?.setFire?.(0)
  }

  function dispose() {
    exit()
    disposeRoom(group, mats)
    group.removeFromParent?.()
  }

  applyLights({ house: 0, warmth: 0 })
  setFire(fire)

  /* ---------------------------------------------------------------------- */
  /* what the rest of the app sees                                           */
  /* ---------------------------------------------------------------------- */

  const tvTarget = { x: TV.x, y: TV.bottom + TV.height / 2, z: TV.z }

  const seats = [
    venueSeat(origin, {
      id: 'cozy-sofa-left',
      label: 'Καναπές, αριστερά',
      x: SOFA.x - 0.545,
      z: SOFA.z,
      sitY: 0.58,
      eyeY: 1.18,
      look: tvTarget,
      stand: { x: -1.95, z: 1.2 },
    }),
    venueSeat(origin, {
      id: 'cozy-sofa-right',
      label: 'Καναπές, δεξιά',
      x: SOFA.x + 0.545,
      z: SOFA.z,
      sitY: 0.58,
      eyeY: 1.18,
      look: tvTarget,
      stand: { x: 1.85, z: 0.9 },
    }),
    venueSeat(origin, {
      id: 'cozy-armchair',
      label: 'Η πολυθρόνα, δίπλα στο τζάκι',
      x: CHAIR.x,
      z: CHAIR.z,
      yaw: CHAIR.yaw,
      sitY: 0.56,
      eyeY: 1.2,
      look: tvTarget,
      stand: { x: 2.9, z: -0.95 },
    }),
    venueSeat(origin, {
      id: 'cozy-window',
      label: 'Το παγκάκι στο παράθυρο',
      x: BENCH.x,
      z: BENCH.z,
      // Facing into the room, with the snow behind your shoulder.
      yaw: -Math.PI / 2,
      sitY: 0.54,
      eyeY: 1.12,
      look: tvTarget,
      stand: { x: -5.4, z: 0 },
    }),
  ]

  const views = [
    venueView(origin, {
      id: 'sofa',
      label: 'Από τον καναπέ',
      hint: 'εκεί που κάθεσαι',
      drift: 0.05,
      eye: { x: SOFA.x, y: 1.18, z: SOFA.z + 0.16 },
      target: tvTarget,
    }),
    venueView(origin, {
      id: 'fire',
      label: 'Δίπλα στο τζάκι',
      hint: 'από τη ζεστή μεριά',
      drift: 0.14,
      eye: { x: 3.9, y: 1.3, z: -1.6 },
      target: tvTarget,
    }),
    venueView(origin, {
      id: 'window',
      label: 'Από το παράθυρο',
      hint: 'με το χιόνι πίσω σου',
      drift: 0.1,
      eye: { x: BENCH.x - 0.16, y: 1.12, z: BENCH.z },
      target: tvTarget,
    }),
    venueView(origin, {
      id: 'behind-tv',
      label: 'Πίσω από την τηλεόραση',
      hint: 'η ανάποδη γωνία',
      drift: 0.18,
      eye: { x: 0, y: 1.55, z: ROOM.minZ + 0.8 },
      target: { x: SOFA.x, y: 0.95, z: SOFA.z },
    }),
    venueView(origin, {
      id: 'wide',
      label: 'Πανοραμική',
      hint: 'όλο το δωμάτιο',
      drift: 0.5,
      eye: { x: -4.2, y: 2.7, z: 3.3 },
      target: { x: 0.8, y: 1.1, z: -1.2 },
    }),
  ]

  return {
    id: 'cozy',
    label: 'Ζεστό σαλόνι',
    description: 'Τζάκι, βιβλία, χιόνι στο παράθυρο και μια μεγάλη οθόνη στον τοίχο.',
    group,
    get screen() {
      return display.screen
    },
    moon,
    spawn: { x: origin.x + 2.6, z: origin.z + 2.9, yaw: 0 },
    layout: {
      bounds: roomBounds(origin, { minX: BAY.minX, maxX: ROOM.maxX, minZ: ROOM.minZ, maxZ: ROOM.maxZ }),
      floorAt: () => 0,
      blockers: [
        fill('cozy-void-front', origin, {
          minX: BAY.minX, maxX: BAY.maxX, minZ: ROOM.minZ, maxZ: BAY.minZ,
        }),
        fill('cozy-void-back', origin, {
          minX: BAY.minX, maxX: BAY.maxX, minZ: BAY.maxZ, maxZ: ROOM.maxZ,
        }),
        blocker('cozy-couch', origin, { x: SOFA.x, z: SOFA.z, width: 2.8, depth: 1.1, top: 0.9 }),
        blocker('cozy-chair', origin, { x: CHAIR.x, z: CHAIR.z, width: 1.3, depth: 1.3, top: 0.9 }),
        blocker('cozy-table', origin, { z: 0.3, width: 1.35, depth: 0.78, top: 0.55 }),
        blocker('cozy-side-table', origin, { x: 1.85, z: 2.15, width: 0.55, depth: 0.55, top: 0.6 }),
        blocker('cozy-sideboard', origin, {
          z: ROOM.minZ + 0.32, width: 2.9, depth: 0.5, top: 0.55,
        }),
        blocker('cozy-shelves', origin, {
          x: -1.75, z: ROOM.maxZ - 0.24, width: 3.6, depth: 0.42, top: 2.1,
        }),
        blocker('cozy-hearth', origin, {
          x: ROOM.maxX - 0.28, z: FIRE.z, width: 0.75, depth: 2.5, top: 1.8,
        }),
        blocker('cozy-bench', origin, {
          x: BENCH.x, z: BENCH.z, width: BENCH.width, depth: BENCH.depth, top: 0.6,
        }),
        blocker('cozy-plant', origin, { x: 4.3, z: 3.1, width: 0.45, depth: 0.45, top: 1.2 }),
      ],
    },
    seats,
    seatReach: 2.1,
    views,
    screenInfo,
    exits: [
      {
        to: 'cinema',
        x: origin.x + 2.6,
        z: origin.z + ROOM.maxZ - 0.55,
        radius: 1.3,
        label: 'Πίσω στην αίθουσα',
      },
    ],
    applyLights,
    setScreenLight,
    setFire,
    setTvScale,
    get tvScale() {
      return tvScale
    },
    get fire() {
      return fire
    },
    update,
    enter,
    exit,
    dispose,
  }
}

export default createCozyVenue

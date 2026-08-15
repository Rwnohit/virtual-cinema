/**
 * The cinema hall itself: shell, carpet, stepped risers, side walls, ceiling,
 * stage, screen (+ masking frame and curtains), doors, projection booth and the
 * atmospheric touches (floating dust, projector haze).
 *
 * No lights live here - see `lighting.js`.
 *
 *   import { createCinema } from './scene/cinema.js'
 *   const cinema = createCinema()
 *   scene.add(cinema.group)
 *
 * `cinema.screen` is the screen mesh and `cinema.screenMaterial` its material,
 * so anything that wants to draw on the screen can do so without hunting
 * through the graph (the mesh is also named 'CinemaScreen').
 */

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import {
  ROOM,
  ROOM_BOUNDS,
  STAGE,
  SCREEN,
  SCREEN_CENTER,
  SCREEN_RATIOS,
  DEFAULT_SCREEN_RATIO,
  screenWidthFor,
  SEATING,
  SEAT_BLOCK_OUTER,
  BOOTH,
  PALETTE,
} from './constants.js'

export { ROOM, STAGE, SCREEN, SCREEN_CENTER, SCREEN_RATIOS }

const FRONT_Z = ROOM_BOUNDS.minZ
const BACK_Z = ROOM_BOUNDS.maxZ
const LEFT_X = ROOM_BOUNDS.minX
const RIGHT_X = ROOM_BOUNDS.maxX

function makeMaterials() {
  return {
    shell: new THREE.MeshStandardMaterial({
      color: PALETTE.wall,
      roughness: 0.96,
      metalness: 0.0,
      side: THREE.BackSide,
    }),
    carpet: new THREE.MeshStandardMaterial({ color: PALETTE.carpet, roughness: 1.0 }),
    carpetTrim: new THREE.MeshStandardMaterial({ color: PALETTE.carpetTrim, roughness: 1.0 }),
    riser: new THREE.MeshStandardMaterial({ color: 0x1d0d11, roughness: 1.0 }),
    panel: new THREE.MeshStandardMaterial({ color: PALETTE.wallPanel, roughness: 0.9 }),
    panelDark: new THREE.MeshStandardMaterial({ color: 0x101217, roughness: 0.95 }),
    ceiling: new THREE.MeshStandardMaterial({ color: PALETTE.ceiling, roughness: 1.0 }),
    stage: new THREE.MeshStandardMaterial({ color: PALETTE.stage, roughness: 0.85 }),
    masking: new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 1.0 }),
    curtain: new THREE.MeshStandardMaterial({ color: PALETTE.curtain, roughness: 0.98 }),
    metal: new THREE.MeshStandardMaterial({ color: PALETTE.metal, roughness: 0.35, metalness: 0.8 }),
    speaker: new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.8 }),
    door: new THREE.MeshStandardMaterial({ color: 0x120d10, roughness: 0.7, metalness: 0.2 }),
    // Emissive trim. Dim values on purpose: during a film these are lamps seen
    // in the dark, not light sources, so they must not glare.
    stripCove: new THREE.MeshBasicMaterial({ color: PALETTE.emissiveCove, fog: true }),
    stripCeiling: new THREE.MeshBasicMaterial({ color: PALETTE.emissiveCeiling, fog: true }),
    stripAisle: new THREE.MeshBasicMaterial({ color: PALETTE.emissiveAisle, fog: true }),
    exit: new THREE.MeshBasicMaterial({ color: PALETTE.emissiveExit, fog: false }),
    boothGlass: new THREE.MeshBasicMaterial({ color: PALETTE.emissiveBooth, fog: false }),
  }
}

/** Outer shell of the room, rendered from the inside. */
function buildShell(group, mat) {
  const shell = new THREE.Mesh(new THREE.BoxGeometry(ROOM.width, ROOM.height, ROOM.depth), mat.shell)
  shell.position.set(0, ROOM.height / 2, 0)
  shell.name = 'RoomShell'
  shell.receiveShadow = true
  group.add(shell)

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.width, ROOM.depth), mat.ceiling)
  ceiling.rotation.x = Math.PI / 2
  ceiling.position.y = ROOM.height - 0.01
  ceiling.name = 'Ceiling'
  group.add(ceiling)
}

/** Flat carpet in front of the risers plus the stepped seating platforms. */
function buildFloorAndRisers(group, mat) {
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.width, ROOM.depth), mat.carpet)
  carpet.rotation.x = -Math.PI / 2
  carpet.position.y = 0.01
  carpet.receiveShadow = true
  carpet.name = 'Carpet'
  group.add(carpet)

  const risers = new THREE.Group()
  risers.name = 'Risers'

  // Step `r` covers everything from just in front of row `r` to the back wall,
  // so the boxes simply stack into a staircase.
  for (let r = 1; r < SEATING.rows; r++) {
    const frontZ = SEATING.firstRowZ + r * SEATING.rowSpacing - 1.1
    const depth = BACK_Z - frontZ
    const height = r * SEATING.rowRise

    const step = new THREE.Mesh(new THREE.BoxGeometry(ROOM.width, height, depth), mat.riser)
    step.position.set(0, height / 2, frontZ + depth / 2)
    step.castShadow = false
    step.receiveShadow = true
    risers.add(step)

    // Carpet strip on the tread of every step.
    const tread = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.width, SEATING.rowSpacing), mat.carpet)
    tread.rotation.x = -Math.PI / 2
    tread.position.set(0, height + 0.005, frontZ + SEATING.rowSpacing / 2)
    tread.receiveShadow = true
    risers.add(tread)

    // Nosing light on the front edge of the step, in each aisle. These are
    // lamps you see, not lamps that light the floor: the pools of light on the
    // carpet come from lighting.js and start switched off.
    const sideAisleX = (SEAT_BLOCK_OUTER + ROOM.width / 2 - 0.7) / 2
    for (const x of [0, -sideAisleX, sideAisleX]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(x === 0 ? 2.4 : 3.0, 0.035, 0.06), mat.stripAisle)
      strip.position.set(x, height - 0.06, frontZ + 0.03)
      risers.add(strip)
    }
  }

  group.add(risers)

  // Trim line where the flat orchestra floor meets the first riser.
  const trim = new THREE.Mesh(new THREE.BoxGeometry(ROOM.width, 0.04, 0.12), mat.carpetTrim)
  trim.position.set(0, 0.03, SEATING.firstRowZ + SEATING.rowSpacing - 1.16)
  group.add(trim)
}

/** Acoustic slats and a dado rail along both side walls. */
function buildSideWalls(group, mat) {
  const slatGeo = new RoundedBoxGeometry(0.16, 6.4, 0.9, 2, 0.05)

  for (const sign of [-1, 1]) {
    const wallX = sign * (ROOM.width / 2)
    const wall = new THREE.Group()
    wall.name = sign < 0 ? 'WallLeft' : 'WallRight'

    for (let z = FRONT_Z + 4; z < BACK_Z - 1.5; z += 1.5) {
      const slat = new THREE.Mesh(slatGeo, (Math.round(z) % 3 === 0) ? mat.panelDark : mat.panel)
      slat.position.set(wallX - sign * 0.1, 4.6, z)
      slat.receiveShadow = true
      wall.add(slat)
    }

    // Dado rail below the slats and a shadow gap above them.
    const dado = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, ROOM.depth - 6), mat.panelDark)
    dado.position.set(wallX - sign * 0.12, 1.28, 1)
    wall.add(dado)

    const cove = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, ROOM.depth - 6), mat.panelDark)
    cove.position.set(wallX - sign * 0.25, 9.2, 1)
    wall.add(cove)

    // Warm strip hidden inside the cove.
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, ROOM.depth - 7), mat.stripCove)
    strip.position.set(wallX - sign * 0.52, 9.08, 1)
    wall.add(strip)

    group.add(wall)
  }
}

/** Long recessed light coffers on the ceiling. */
function buildCeilingDetail(group, mat) {
  for (const sign of [-1, 1]) {
    const coffer = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, ROOM.depth - 8), mat.panelDark)
    coffer.position.set(sign * 6.5, ROOM.height - 0.2, 1)
    group.add(coffer)

    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.5, ROOM.depth - 9), mat.stripCeiling)
    glow.rotation.x = Math.PI / 2
    glow.position.set(sign * 6.5, ROOM.height - 0.41, 1)
    group.add(glow)
  }
}

/** Stage in front of the screen, with a skirt and side steps. */
function buildStage(group, mat) {
  const deck = new THREE.Mesh(new THREE.BoxGeometry(STAGE.width, STAGE.height, STAGE.depth), mat.stage)
  deck.position.set(0, STAGE.height / 2, STAGE.z)
  deck.receiveShadow = true
  deck.castShadow = true
  deck.name = 'Stage'
  group.add(deck)

  const lip = new THREE.Mesh(new THREE.BoxGeometry(STAGE.width + 0.2, 0.1, 0.16), mat.metal)
  lip.position.set(0, STAGE.height - 0.04, STAGE.z + STAGE.depth / 2 + 0.06)
  group.add(lip)

  for (const sign of [-1, 1]) {
    for (let s = 0; s < 2; s++) {
      const h = STAGE.height * ((s + 1) / 2)
      const step = new THREE.Mesh(new THREE.BoxGeometry(1.6, h, 0.5), mat.stage)
      step.position.set(sign * (STAGE.width / 2 - 1), h / 2, STAGE.z + STAGE.depth / 2 + 0.75 - s * 0.5)
      step.receiveShadow = true
      group.add(step)
    }
  }
}

/**
 * The screen and its black masking frame. The curtains that hang in front of it
 * are built separately, see `buildCurtains`.
 *
 * The screen material is unlit on purpose: a projection surface makes its own
 * light, and it keeps whatever is drawn on it perfectly readable.
 */
function buildScreen(group, mat) {
  const frameGeo = new THREE.BoxGeometry(
    SCREEN.maxWidth + SCREEN.frame * 2,
    SCREEN.height + SCREEN.frame * 2,
    0.3,
  )
  const masking = new THREE.Mesh(frameGeo, mat.masking)
  masking.position.set(SCREEN.x, SCREEN.y, SCREEN.z - 0.16)
  masking.name = 'ScreenMasking'
  group.add(masking)

  // fog: false - the picture is the brightest thing in the room and must stay
  // clean from the back row, exactly like a real projection.
  const screenMaterial = new THREE.MeshBasicMaterial({ color: PALETTE.screen, fog: false })
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.maxWidth, SCREEN.height), screenMaterial)
  screen.position.set(SCREEN.x, SCREEN.y, SCREEN.z)
  screen.name = 'CinemaScreen'
  screen.userData.role = 'screen'
  group.add(screen)

  // Side masking. Two black panels that travel in from the edges when the
  // picture is narrower than the surface, the way a real hall changes format.
  // They sit just in front of the screen so they cover the movie surface too.
  const wingGeo = new THREE.BoxGeometry(1, SCREEN.height + SCREEN.frame * 2, 0.12)
  const wings = [-1, 1].map((sign) => {
    const wing = new THREE.Mesh(wingGeo, mat.masking)
    wing.name = sign < 0 ? 'MaskingLeft' : 'MaskingRight'
    wing.userData.sign = sign
    wing.renderOrder = 6
    wing.visible = false
    group.add(wing)
    return wing
  })

  /** Slide the masking to the picture width and report the new picture size. */
  function applyRatio(name) {
    const width = screenWidthFor(name)
    const spare = (SCREEN.maxWidth - width) / 2

    for (const wing of wings) {
      if (spare <= 0.02) {
        wing.visible = false
        continue
      }
      wing.visible = true
      // The panel is 1m wide, so its scale is its width in metres.
      wing.scale.set(spare + 0.04, 1, 1)
      wing.position.set(
        SCREEN.x + wing.userData.sign * (width / 2 + (spare + 0.04) / 2),
        SCREEN.y,
        SCREEN.z + 0.09,
      )
    }

    return { width, height: SCREEN.height, ratio: width / SCREEN.height }
  }

  return { screen, screenMaterial, applyRatio }
}

/* -------------------------------------------------------------------------- */
/* curtains                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The dial a panel can draw for the curtains, in the same shape as every other
 * field table in the app.
 * @type {Array<{key:string,label:string,min:number,max:number,step:number,format:string}>}
 */
export const CURTAIN_FIELDS = [
  { key: 'curtains', label: 'Κουρτίνες', min: 0, max: 1, step: 0.01, format: 'percent' },
]

/** Folds per side. Enough that a closed curtain reads as cloth and not as poles. */
const CURTAIN_FOLDS = 9
/**
 * How quickly a fold takes up the movement of the one ahead of it, per second.
 * Low enough that the row visibly ripples, high enough that the leaders never
 * outrun the cloth.
 */
const CURTAIN_FOLLOW = 5.5
/**
 * Spring towards the target, in (rad/s)^2.
 *
 * Slow on purpose. A house curtain is thirty kilos of velvet on a motor that
 * takes its time, and watching it cross is half the reason it is there. At the
 * old stiffness the whole travel was over in about 1.7 seconds, which read as a
 * shutter rather than as cloth. This is nearer five.
 */
const CURTAIN_STIFFNESS = 3.4
/** 2 * zeta * omega with zeta ~ 0.82: it barely overshoots, then settles. */
const CURTAIN_DAMPING = 3.0
/** Width of one fold as built, which is how far it can stretch before it gaps. */
const CURTAIN_FOLD_WIDTH = 0.52

const clampTo = (value, min, max) => Math.min(Math.max(value, min), max)

/**
 * Two curtains that travel across the picture.
 *
 * Cheap on purpose: a row of vertical cylinders per side, no cloth simulation.
 * What makes it read as heavy fabric is the movement rather than the geometry.
 *
 *   - each fold hangs on the rail at its own place, bunched up beside the
 *     picture when the curtain is open and shared out across it when closed
 *   - a fold is dragged by the one ahead of it, the way the carriers on a real
 *     track pull each other, so the row never moves as one rigid piece
 *   - how wide a fold is drawn comes from how much rail it actually has to
 *     itself at that moment, so the cloth gathers and spreads on its own
 *   - a damped spring carries it to its target, so it leans into the movement
 *     and sways to a stop instead of arriving like a door
 *
 * @param {THREE.Group} group the hall
 * @param {Record<string, THREE.Material>} mat
 * @param {number} initial 0 = open, 1 = closed
 */
function buildCurtains(group, mat, initial = 0) {
  const foldGeo = new THREE.CylinderGeometry(0.24, 0.28, SCREEN.height + 1.2, 10, 1, false)
  const gap = ROOM.width / 2 - SCREEN.maxWidth / 2
  /** |x| of the leading fold with the curtain open: just clear of the picture. */
  const openEdge = SCREEN.maxWidth / 2 + 0.32
  /** Bunched, the folds overlap. That overlap is what makes a gather look thick. */
  const bunchStep = clampTo((gap - 0.8) / CURTAIN_FOLDS, 0.12, 0.3)
  /** Closed, each side shares out the half of the picture it has to cover. */
  const spreadStep = openEdge / CURTAIN_FOLDS

  let value = clampUnit(initial)
  const sides = []

  for (const sign of [-1, 1]) {
    const curtain = new THREE.Group()
    curtain.name = sign < 0 ? 'CurtainLeft' : 'CurtainRight'
    const folds = []

    for (let i = 0; i < CURTAIN_FOLDS; i++) {
      const mesh = new THREE.Mesh(foldGeo, mat.curtain)
      // The two halves meet a little past the middle, the way real curtains
      // overlap: a hairline seam down the centre of the picture would be worse
      // than any amount of extra fabric.
      const closed = (i + 0.45) * spreadStep
      const open = openEdge + i * bunchStep
      const position = open + (closed - open) * value

      mesh.position.set(sign * position, SCREEN.y - 0.2, SCREEN.z + 0.5 + Math.sin(i * 1.4) * 0.08)
      mesh.castShadow = true
      curtain.add(mesh)

      folds.push({ mesh, open, closed, position, velocity: 0, openness: value })
    }

    group.add(curtain)
    sides.push({ sign, folds })
  }

  /** Shape every fold from where its neighbours ended up. */
  function place() {
    for (const side of sides) {
      const { folds } = side
      for (let i = 0; i < folds.length; i++) {
        const fold = folds[i]
        const before = folds[i - 1]
        const after = folds[i + 1]
        // Rail to itself: half the distance between its two neighbours, or the
        // distance to its only neighbour at the ends of the row.
        const room =
          before && after
            ? Math.abs(after.position - before.position) / 2
            : Math.abs((after ?? before).position - fold.position)

        const stretch = clampTo(room / CURTAIN_FOLD_WIDTH, 1, 3.6)
        // Cloth that is pulled wide also goes flat, so it loses in depth what
        // it gains across.
        fold.mesh.scale.set(stretch, 1, 1 / Math.sqrt(stretch))
        fold.mesh.position.x = side.sign * fold.position
        // Heavy fabric hangs behind its own top rail while it travels.
        fold.mesh.rotation.z = clampTo(-side.sign * fold.velocity * 0.02, -0.09, 0.09)
      }
    }
  }

  /** @param {number} next 0 = open, 1 = closed */
  function set(next, { immediate = false } = {}) {
    value = clampUnit(Number(next) || 0)
    if (immediate) {
      for (const side of sides) {
        for (const fold of side.folds) {
          fold.openness = value
          fold.position = fold.open + (fold.closed - fold.open) * value
          fold.velocity = 0
        }
      }
      place()
    }
    return value
  }

  function update(dt) {
    // A tab that was asleep comes back with a huge dt, and a spring given a
    // huge step explodes. One frame of catching up is enough. A dt that is not
    // a number at all would poison every position from here on, so it is out.
    const step = clampTo(Number(dt) || 0, 0, 0.05)
    if (step <= 0) return

    let moving = false

    for (const side of sides) {
      let ahead = value
      for (const fold of side.folds) {
        fold.openness += (ahead - fold.openness) * Math.min(1, step * CURTAIN_FOLLOW)
        ahead = fold.openness

        const target = fold.open + (fold.closed - fold.open) * fold.openness
        fold.velocity += (target - fold.position) * CURTAIN_STIFFNESS * step
        fold.velocity -= fold.velocity * CURTAIN_DAMPING * step
        fold.position += fold.velocity * step

        if (Math.abs(fold.velocity) > 1e-4 || Math.abs(target - fold.position) > 1e-4) moving = true
      }
    }

    // Settled curtains cost nothing: no matrices are touched until they move.
    if (moving) place()
  }

  place()

  return {
    set,
    update,
    get value() {
      return value
    },
  }
}

/**
 * The surround cabinets up the side walls.
 *
 * The three screen channels are deliberately not here. In a real hall they
 * stand behind the screen and fire through it: the surface is perforated with
 * a million tiny holes so the sound comes from the picture and the cabinets
 * stay out of sight. Standing them on the stage in front of the picture, which
 * is what this used to do, is the one place they can never be.
 */
function buildSpeakers(group, mat) {
  const surround = new RoundedBoxGeometry(0.5, 0.9, 0.7, 2, 0.05)
  for (const sign of [-1, 1]) {
    for (let z = -8; z <= 14; z += 5.5) {
      const s = new THREE.Mesh(surround, mat.speaker)
      s.position.set(sign * (ROOM.width / 2 - 0.35), 7.4, z)
      s.rotation.y = sign * -0.25
      group.add(s)
    }
  }
}

/** Exit doors with lit signs, plus the projection booth windows at the back. */
function buildDoorsAndBooth(group, mat) {
  const doorGeo = new RoundedBoxGeometry(1.5, 2.6, 0.16, 2, 0.04)
  const signGeo = new THREE.PlaneGeometry(0.7, 0.24)

  const doorSpots = [
    { x: LEFT_X + 0.12, z: BACK_Z - 5, ry: Math.PI / 2 },
    { x: RIGHT_X - 0.12, z: BACK_Z - 5, ry: -Math.PI / 2 },
    { x: LEFT_X + 0.12, z: FRONT_Z + 4.5, ry: Math.PI / 2 },
    { x: RIGHT_X - 0.12, z: FRONT_Z + 4.5, ry: -Math.PI / 2 },
  ]

  for (const spot of doorSpots) {
    const door = new THREE.Mesh(doorGeo, mat.door)
    door.position.set(spot.x, 1.3, spot.z)
    door.rotation.y = spot.ry
    group.add(door)

    const sign = new THREE.Mesh(signGeo, mat.exit)
    sign.position.set(spot.x + Math.sign(-spot.x) * 0.06, 2.95, spot.z)
    sign.rotation.y = spot.ry
    sign.name = 'ExitSign'
    group.add(sign)
  }

  // Projection booth: a dark recess with two glowing portholes.
  const recess = new THREE.Mesh(new THREE.BoxGeometry(6.5, 2.6, 0.3), mat.panelDark)
  recess.position.set(0, BOOTH.y, BACK_Z - 0.16)
  group.add(recess)

  for (const sign of [-1, 1]) {
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(BOOTH.windowWidth, BOOTH.windowHeight),
      mat.boothGlass,
    )
    glass.position.set(sign * BOOTH.spacing * 0.5, BOOTH.y, BACK_Z - 0.32)
    glass.rotation.y = Math.PI
    glass.name = 'BoothWindow'
    group.add(glass)
  }
}

/**
 * The picture, lying on the carpet in front of the screen.
 *
 * A cinema floor is matt, so this is not a mirror: it is the wide, soft pool of
 * light a two storey picture throws onto the first few metres of carpet, and it
 * is the thing that carries the colour of the film into the room. Additive, so
 * black is invisible and it can only ever add light, and faded to nothing at
 * its far edge with vertex colours so it has no visible rim.
 *
 * Driven from lighting.js's reading of the frame through `setScreenSpill`.
 */
function buildScreenSpill(group) {
  const depth = 13
  const geometry = new THREE.PlaneGeometry(SCREEN.maxWidth * 1.12, depth, 24, 12)

  const position = geometry.attributes.position
  const colors = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i += 1) {
    // Local Y runs from the screen (top) to the audience (bottom) before the
    // plane is laid flat, so this is distance from the screen.
    const away = clampUnit((depth / 2 - position.getY(i)) / depth)
    const across = clampUnit(1 - Math.abs(position.getX(i)) / (SCREEN.maxWidth * 0.56))
    const fade = Math.pow(1 - away, 2.1) * Math.pow(across, 0.7)
    colors[i * 3 + 0] = fade
    colors[i * 3 + 1] = fade
    colors[i * 3 + 2] = fade
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
    toneMapped: false,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.rotation.x = -Math.PI / 2
  // Just above the carpet and the stage lip, and in front of the first riser.
  mesh.position.set(SCREEN.x, 0.02, SCREEN.z + STAGE.depth / 2 + depth / 2 - 0.4)
  mesh.name = 'ScreenSpill'
  mesh.renderOrder = 1
  group.add(mesh)

  return { mesh, material }
}

/** Slow floating dust motes. */
function buildDust(group) {
  const count = 520
  const positions = new Float32Array(count * 3)
  const speeds = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = (Math.random() - 0.5) * (ROOM.width - 3)
    positions[i * 3 + 1] = 1.2 + Math.random() * (ROOM.height - 3)
    positions[i * 3 + 2] = FRONT_Z + 4 + Math.random() * (ROOM.depth - 8)
    speeds[i] = 0.02 + Math.random() * 0.06
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

  const material = new THREE.PointsMaterial({
    color: 0xbfd0ff,
    size: 0.018,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.13,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  })

  const points = new THREE.Points(geometry, material)
  points.name = 'Dust'
  points.frustumCulled = false
  group.add(points)

  return { points, positions, speeds, count }
}

/**
 * The cone of light from the booth window to the screen: dust hanging in the
 * projector beam. One open cone, additively blended, brightest at the lens and
 * fading out long before it reaches the screen, so it never washes the picture.
 * 48 triangles and no per frame work beyond a slow shimmer - free at 60fps.
 */
function buildProjectorBeam(group) {
  const from = new THREE.Vector3(0, BOOTH.y, BACK_Z - 0.5)
  const to = new THREE.Vector3(SCREEN.x, SCREEN.y, SCREEN.z + 0.4)
  const throwLength = from.distanceTo(to)

  // Only the rear part of the throw is drawn. Near the lens is where a real
  // beam actually reads; carrying it all the way to the screen paints a faint
  // ring over the picture when you are sitting on the projection axis.
  const length = throwLength * 0.58
  const endRadius = 0.1 + (length / throwLength) * (SCREEN.height * 0.52 - 0.1)

  const geometry = new THREE.CylinderGeometry(0.1, endRadius, length, 24, 6, true)
  geometry.translate(0, -length / 2, 0)

  // Fade along the beam with vertex colours: with additive blending, black is
  // invisible, so this gives a soft falloff without a second draw call.
  const position = geometry.attributes.position
  const colors = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    const t = clampUnit(-position.getY(i) / length) // 0 at the lens, 1 at the screen
    // Dense at the lens, dissolving to nothing at the far end so the cone has
    // no visible rim where it stops.
    const fade = Math.pow(1 - t, 1.1) * 0.9 + (1 - t) * 0.1
    colors[i * 3 + 0] = fade * 0.82
    colors[i * 3 + 1] = fade * 0.88
    colors[i * 3 + 2] = fade
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const material = new THREE.MeshBasicMaterial({
    color: 0xbcd2ff,
    vertexColors: true,
    transparent: true,
    // Deliberately tiny. Anything above ~0.05 stops looking like dust in the
    // air and starts looking like a solid white wedge across the room.
    opacity: 0.028,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
  })

  const beam = new THREE.Mesh(geometry, material)
  beam.position.copy(from)
  beam.lookAt(to)
  // Careful: Object3D.lookAt() on a plain Mesh aims local +Z at the target
  // (unlike a camera, which aims -Z). The cone body runs along local -Y, so
  // -90 degrees about X is what swings it onto +Z, towards the screen.
  beam.rotateX(-Math.PI / 2)
  beam.name = 'ProjectorBeam'
  beam.frustumCulled = false
  beam.renderOrder = 2
  group.add(beam)

  return { mesh: beam, material, baseOpacity: material.opacity }
}

const clampUnit = (value) => Math.min(Math.max(value, 0), 1)

/**
 * Builds the whole hall.
 *
 * @param {{ dust?: boolean, beam?: boolean, screenRatio?: string, curtains?: number }} [options]
 * @returns {{
 *   group: THREE.Group,
 *   screen: THREE.Mesh,
 *   screenMaterial: THREE.MeshBasicMaterial,
 *   screenSize: { width: number, height: number, ratio: number },
 *   screenRatio: string,
 *   setScreenRatio: (name: string) => { width: number, height: number, ratio: number },
 *   setTrimBrightness: (kind: string, level: number) => void,
 *   curtains: number,
 *   setCurtains: (value: number, options?: { immediate?: boolean }) => number,
 *   curtainFields: typeof CURTAIN_FIELDS,
 *   beam: THREE.Mesh | null,
 *   update: (dt: number) => void,
 *   dispose: () => void
 * }}
 */
export function createCinema(options = {}) {
  // Open by default: you come in while the film is already playing.
  const { dust = true, beam = true, curtains = 0 } = options

  const group = new THREE.Group()
  group.name = 'Cinema'

  const mat = makeMaterials()

  buildShell(group, mat)
  buildFloorAndRisers(group, mat)
  buildSideWalls(group, mat)
  buildCeilingDetail(group, mat)
  buildStage(group, mat)
  const { screen, screenMaterial, applyRatio } = buildScreen(group, mat)
  const curtainRig = buildCurtains(group, mat, curtains)
  buildSpeakers(group, mat)
  buildDoorsAndBooth(group, mat)

  const spill = buildScreenSpill(group)
  const dustField = dust ? buildDust(group) : null
  const projectorBeam = beam ? buildProjectorBeam(group) : null

  /**
   * Lay the colour of the current frame on the carpet.
   *
   * @param {{ color: THREE.Color, intensity: number }} reading from lighting.js
   * @param {number} [gain] the viewer's «Λάμψη οθόνης», so the pool obeys it too
   */
  function setScreenSpill(reading, gain = 1) {
    if (!reading) return
    spill.material.color.copy(reading.color)
    // Deliberately shy. Past about 0.2 it stops reading as light on a floor and
    // starts reading as a glowing carpet.
    spill.material.opacity = Math.min(0.2, Math.max(0, reading.intensity) * 0.11 * gain)
  }

  // --- the lamps you can see, as opposed to the light they cast -------------
  // Every emissive trim keeps its designed colour here, so a control panel can
  // dim the fittings themselves and not just the pools of light around them.
  const TRIMS = {
    aisle: mat.stripAisle,
    cove: mat.stripCove,
    ceiling: mat.stripCeiling,
    exit: mat.exit,
    booth: mat.boothGlass,
  }
  const trimBase = Object.fromEntries(
    Object.entries(TRIMS).map(([key, material]) => [key, material.color.clone()]),
  )

  /** @param {number} level 0 = the fitting is off, 1 = as designed, up to 2 */
  function setTrimBrightness(kind, level) {
    const material = TRIMS[kind]
    if (!material) return
    const value = Math.min(Math.max(Number(level) || 0, 0), 2)
    material.color.copy(trimBase[kind]).multiplyScalar(value)
  }

  let screenRatio = SCREEN_RATIOS[options.screenRatio] ? options.screenRatio : DEFAULT_SCREEN_RATIO
  let screenSize = applyRatio(screenRatio)

  /**
   * Change the shape of the picture. Returns the new picture size so the media
   * module can re-fit whatever is playing.
   */
  function setScreenRatio(name) {
    if (!SCREEN_RATIOS[name]) return screenSize
    screenRatio = name
    screenSize = applyRatio(name)
    return screenSize
  }

  /**
   * Open and close the curtains.
   *
   * The number is where they are asked to go, not where they are: the folds
   * take about a second to get there and settle, driven from update().
   *
   * @param {number} value 0 = open and clear of the picture, 1 = closed
   * @param {{ immediate?: boolean }} [opts] skip the travel, for setting up
   */
  function setCurtains(value, opts) {
    return curtainRig.set(value, opts)
  }

  let elapsed = 0

  function update(dt) {
    elapsed += dt
    curtainRig.update(dt)

    if (projectorBeam) {
      // Dust drifting through the beam makes it shimmer a little.
      projectorBeam.material.opacity =
        projectorBeam.baseOpacity * (1 + Math.sin(elapsed * 1.7) * 0.16 + Math.sin(elapsed * 5.3) * 0.07)
    }

    if (!dustField) return
    const { positions, speeds, count } = dustField
    const top = ROOM.height - 0.4
    for (let i = 0; i < count; i++) {
      const y = i * 3 + 1
      positions[y] += speeds[i] * dt
      if (positions[y] > top) positions[y] = 1.2
    }
    dustField.points.geometry.attributes.position.needsUpdate = true
  }

  function dispose() {
    group.traverse((object) => {
      if (object.geometry) object.geometry.dispose()
    })
    for (const m of Object.values(mat)) m.dispose()
    screenMaterial.dispose()
  }

  return {
    group,
    screen,
    screenMaterial,
    get screenSize() {
      return { ...screenSize }
    },
    get screenRatio() {
      return screenRatio
    },
    setScreenRatio,
    screenRatios: SCREEN_RATIOS,
    setTrimBrightness,
    /** Lay the colour of the frame on the carpet. See buildScreenSpill. */
    setScreenSpill,
    screenSpill: spill.mesh,
    /** Where the curtains were last asked to go. 0 = open, 1 = closed. */
    get curtains() {
      return curtainRig.value
    },
    setCurtains,
    /** The dial, so a panel can build itself generically. */
    curtainFields: CURTAIN_FIELDS,
    beam: projectorBeam?.mesh ?? null,
    update,
    dispose,
  }
}

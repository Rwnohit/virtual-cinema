/**
 * Shared building blocks for the places you can walk into.
 *
 * Same discipline as src/scene/cinema.js: everything is made of primitives, no
 * textures and no files, and the numbers are metres. A living room is small
 * enough that the eye reads silhouettes rather than surfaces, so a sofa is six
 * rounded boxes and that is genuinely enough - what sells it is where the light
 * falls, not how many triangles it took.
 *
 * Nothing here knows about a specific room. `horror.js` and `cozy.js` are the
 * two rooms; this file is the furniture van.
 *
 * Two rules the rooms depend on:
 *   - a room is a plan, not a box. `buildRoomShell` takes a list of floor areas
 *     and a list of wall segments, which is what lets a room have a corridor
 *     going off it or a window bay sticking out of it.
 *   - seats and camera shots leave here as plain data in world coordinates, so
 *     the whole seating and view geometry of a room can be checked in Node.
 */

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

/** Matt surface. Almost everything in a home is matt; nothing here shines. */
export const matte = (color, roughness = 0.94, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra })

/**
 * A lamp you see, as opposed to the light it casts. Unlit on purpose, exactly
 * like the emissive trim in the hall: a shade or a fire has to keep glowing
 * when the room around it is nearly black.
 */
export const glow = (color, extra = {}) =>
  new THREE.MeshBasicMaterial({ color, fog: false, ...extra })

/**
 * One box, positioned. `round` turns it into a RoundedBoxGeometry, which is
 * what makes upholstery read as upholstery rather than as a crate.
 *
 * @param {THREE.Object3D} parent
 * @param {THREE.Material} material
 * @param {[number,number,number]} size
 * @param {[number,number,number]} position
 * @param {{round?:number, ry?:number, rx?:number, rz?:number, name?:string}} [options]
 */
export function addBox(parent, material, size, position, options = {}) {
  const geometry = options.round
    ? new RoundedBoxGeometry(size[0], size[1], size[2], 2, options.round)
    : new THREE.BoxGeometry(size[0], size[1], size[2])
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(position[0], position[1], position[2])
  if (options.rx) mesh.rotation.x = options.rx
  if (options.ry) mesh.rotation.y = options.ry
  if (options.rz) mesh.rotation.z = options.rz
  if (options.name) mesh.name = options.name
  parent.add(mesh)
  return mesh
}

/** One flat panel, face up unless you turn it. */
export function addPlane(parent, material, size, position, options = {}) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), material)
  mesh.position.set(position[0], position[1], position[2])
  if (options.rx) mesh.rotation.x = options.rx
  if (options.ry) mesh.rotation.y = options.ry
  if (options.rz) mesh.rotation.z = options.rz
  if (options.name) mesh.name = options.name
  parent.add(mesh)
  return mesh
}

/* -------------------------------------------------------------------------- */
/* the shell                                                                   */
/* -------------------------------------------------------------------------- */

/** Thickness of an interior wall, and how far the skirting stands proud of it. */
const WALL_THICKNESS = 0.16
const SKIRTING_PROUD = 0.035

/**
 * The room itself, from its plan.
 *
 * Walls are thin boxes rather than one inverted cube, which costs a handful of
 * draw calls and buys the two things the rooms are built on: a doorway shows
 * the thickness of the wall it is cut into, and a plan can be any shape, so a
 * corridor can leave the room and a window bay can push out of it.
 *
 * @param {THREE.Object3D} group
 * @param {{
 *   height: number,
 *   areas: Array<{minX:number,maxX:number,minZ:number,maxZ:number,height?:number}>,
 *   walls: Array<{x1:number,z1:number,x2:number,z2:number,height?:number,thickness?:number}>,
 * }} plan
 * @param {{wall:THREE.Material, floor:THREE.Material, ceiling:THREE.Material, skirting:THREE.Material}} mats
 */
export function buildRoomShell(group, plan, mats) {
  for (const area of plan.areas) {
    const width = area.maxX - area.minX
    const depth = area.maxZ - area.minZ
    const x = (area.minX + area.maxX) / 2
    const z = (area.minZ + area.maxZ) / 2
    const height = area.height ?? plan.height

    addPlane(group, mats.floor, [width, depth], [x, 0.005, z], {
      rx: -Math.PI / 2,
      name: 'Floor',
    })
    addPlane(group, mats.ceiling, [width, depth], [x, height - 0.01, z], {
      rx: Math.PI / 2,
      name: 'Ceiling',
    })
  }

  for (const wall of plan.walls) {
    const dx = wall.x2 - wall.x1
    const dz = wall.z2 - wall.z1
    const length = Math.hypot(dx, dz)
    if (length < 0.01) continue
    const height = wall.height ?? plan.height
    const thickness = wall.thickness ?? WALL_THICKNESS
    // Rotation about Y maps local +X to (cos, -sin), so this is the angle that
    // lays the long side of the box along the segment.
    const ry = Math.atan2(-dz, dx)
    const x = (wall.x1 + wall.x2) / 2
    const z = (wall.z1 + wall.z2) / 2

    addBox(group, mats.wall, [length, height, thickness], [x, height / 2, z], { ry, name: 'Wall' })
    // Skirting, drawn as a slightly fatter board on the same line. The line it
    // draws round the bottom of the room is what stops the walls from looking
    // like painted cardboard, and one box per wall is all it costs.
    addBox(
      group,
      mats.skirting,
      [length, 0.13, thickness + SKIRTING_PROUD * 2],
      [x, 0.065, z],
      { ry },
    )
  }
}

/** Every wall segment of a plain rectangular room, ready for `buildRoomShell`. */
export function rectWalls({ minX, maxX, minZ, maxZ }) {
  return [
    { x1: minX, z1: minZ, x2: maxX, z2: minZ },
    { x1: minX, z1: maxZ, x2: maxX, z2: maxZ },
    { x1: minX, z1: minZ, x2: minX, z2: maxZ },
    { x1: maxX, z1: minZ, x2: maxX, z2: maxZ },
  ]
}

/* -------------------------------------------------------------------------- */
/* furniture                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A sofa: base, back, two arms, seat cushions and back cushions.
 * Sits at the origin facing -Z, which is the direction every room in this app
 * calls "towards the picture". The top of the cushions is `SOFA_SIT` over the
 * floor, which is where a seat record's `sitY` comes from.
 */
export function buildSofa(mats, options = {}) {
  const { width = 2.4, depth = 0.95, seat = 0.42, places = 2 } = options
  const group = new THREE.Group()
  group.name = 'Sofa'

  addBox(group, mats.frame, [width, seat, depth], [0, seat / 2, 0], { round: 0.06 })
  addBox(group, mats.frame, [width, 0.72, 0.22], [0, seat + 0.3, depth / 2 - 0.11], { round: 0.07 })

  for (const sign of [-1, 1]) {
    addBox(group, mats.frame, [0.26, 0.34, depth], [sign * (width / 2 - 0.13), seat + 0.17, 0], {
      round: 0.09,
    })
  }

  const cushionWidth = (width - 0.52) / places
  for (let i = 0; i < places; i += 1) {
    const x = -width / 2 + 0.26 + cushionWidth * (i + 0.5)
    addBox(group, mats.cushion, [cushionWidth - 0.04, 0.17, depth - 0.24], [x, seat + 0.07, -0.06], {
      round: 0.06,
    })
    // Back cushions lean, which is the difference between a sofa and a bench.
    addBox(group, mats.cushion, [cushionWidth - 0.06, 0.44, 0.16], [x, seat + 0.36, depth / 2 - 0.24], {
      round: 0.05,
      rx: 0.16,
    })
  }

  return group
}

/**
 * An armchair: a sofa for one, with wings high enough to read as a silhouette
 * from across a dark room.
 */
export function buildArmchair(mats, options = {}) {
  const { width = 0.98, depth = 0.94, seat = 0.4 } = options
  const group = new THREE.Group()
  group.name = 'Armchair'

  addBox(group, mats.frame, [width, seat, depth], [0, seat / 2, 0], { round: 0.06 })
  addBox(group, mats.frame, [width, 0.86, 0.2], [0, seat + 0.4, depth / 2 - 0.1], { round: 0.08 })
  for (const sign of [-1, 1]) {
    addBox(group, mats.frame, [0.19, 0.36, depth - 0.06], [sign * (width / 2 - 0.09), seat + 0.18, -0.02], {
      round: 0.08,
    })
    // The wing: a panel that leans in over the shoulder.
    addBox(group, mats.frame, [0.12, 0.4, 0.5], [sign * (width / 2 - 0.06), seat + 0.62, depth / 2 - 0.22], {
      round: 0.05,
      rz: sign * 0.06,
    })
  }
  addBox(group, mats.cushion, [width - 0.28, 0.17, depth - 0.26], [0, seat + 0.07, -0.05], { round: 0.06 })
  addBox(group, mats.cushion, [width - 0.3, 0.42, 0.15], [0, seat + 0.36, depth / 2 - 0.23], {
    round: 0.05,
    rx: 0.15,
  })
  for (const sign of [-1, 1]) {
    addBox(group, mats.woodDark, [0.07, 0.1, 0.07], [sign * (width / 2 - 0.12), 0.05, depth / 2 - 0.12])
    addBox(group, mats.woodDark, [0.07, 0.1, 0.07], [sign * (width / 2 - 0.12), 0.05, -depth / 2 + 0.12])
  }

  return group
}

/**
 * A plain wooden chair: seat, four legs, three back slats. Faces -Z like
 * everything else. The horror room owns one of these and moves it about.
 */
export function buildChair(mats, options = {}) {
  const { width = 0.44, depth = 0.44, seat = 0.46 } = options
  const group = new THREE.Group()
  group.name = 'Chair'

  addBox(group, mats.wood, [width, 0.05, depth], [0, seat, 0], { round: 0.012 })
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const backLeg = sz > 0
      const height = backLeg ? seat + 0.62 : seat
      addBox(
        group,
        mats.woodDark,
        [0.045, height, 0.045],
        [sx * (width / 2 - 0.035), height / 2, sz * (depth / 2 - 0.035)],
      )
    }
  }
  for (const y of [seat + 0.24, seat + 0.42, seat + 0.58]) {
    addBox(group, mats.wood, [width - 0.09, 0.06, 0.03], [0, y, depth / 2 - 0.035])
  }
  return group
}

/**
 * A low table. The top is deliberately over the player's step height so it is
 * something you walk round rather than something you glide through.
 */
export function buildTable(mats, options = {}) {
  const { width = 1.1, depth = 0.62, height = 0.52 } = options
  const group = new THREE.Group()
  group.name = 'Table'

  addBox(group, mats.wood, [width, 0.06, depth], [0, height - 0.03, 0], { round: 0.02 })
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addBox(
        group,
        mats.woodDark,
        [0.06, height - 0.06, 0.06],
        [sx * (width / 2 - 0.08), (height - 0.06) / 2, sz * (depth / 2 - 0.08)],
      )
    }
  }
  return group
}

/**
 * A door in a wall: frame, slab, handle. Built facing +Z, so a room puts it on
 * a wall by turning it. `ajar` swings the slab open on its hinge, which is a
 * different thing from a door that is shut: a gap you can see through and not
 * far enough to see into.
 */
export function buildDoor(mats, options = {}) {
  const { width = 0.92, height = 2.08, ajar = 0 } = options
  const group = new THREE.Group()
  group.name = 'Door'

  addBox(group, mats.frame, [width + 0.16, 0.09, 0.14], [0, height + 0.045, 0])
  for (const sign of [-1, 1]) {
    addBox(group, mats.frame, [0.08, height, 0.14], [sign * (width / 2 + 0.04), height / 2, 0])
  }

  // The slab hangs off a hinge on the left jamb, so opening it turns the leaf
  // and not the doorway.
  const hinge = new THREE.Group()
  hinge.position.set(-width / 2, 0, 0)
  hinge.rotation.y = ajar
  group.add(hinge)

  addBox(hinge, mats.door, [width, height, 0.06], [width / 2, height / 2, 0.01], { round: 0.015 })
  // Two sunk panels, the cheapest way to say "this is a door and not a plank".
  for (const y of [height * 0.29, height * 0.71]) {
    addBox(hinge, mats.doorPanel, [width - 0.22, height * 0.3, 0.012], [width / 2, y, 0.045])
  }
  addBox(hinge, mats.handle, [0.13, 0.035, 0.035], [width - 0.16, 1.02, 0.06], { round: 0.016 })

  return { group, hinge }
}

/**
 * A window: the view through it, the frame, the sash bars and the sill.
 *
 * Built in the XY plane facing +Z, so a room turns it onto whichever wall it
 * belongs to. The pane is handed back because the weather happens on it.
 *
 * @returns {{group: THREE.Group, pane: THREE.Mesh}}
 */
export function buildWindow(mats, options = {}) {
  const { width = 1.6, height = 1.3, bars = true, sill = true } = options
  const group = new THREE.Group()
  group.name = 'Window'

  const pane = addPlane(group, mats.night, [width, height], [0, 0, 0.005], { name: 'WindowPane' })

  addBox(group, mats.wood, [width + 0.18, 0.09, 0.12], [0, height / 2 + 0.045, 0.02])
  for (const sign of [-1, 1]) {
    addBox(group, mats.wood, [0.09, height, 0.12], [sign * (width / 2 + 0.045), 0, 0.02])
  }
  if (sill) {
    addBox(group, mats.wood, [width + 0.3, 0.07, 0.22], [0, -height / 2 - 0.035, 0.06], { round: 0.02 })
  } else {
    addBox(group, mats.wood, [width + 0.18, 0.09, 0.12], [0, -height / 2 - 0.045, 0.02])
  }
  if (bars) {
    addBox(group, mats.wood, [0.05, height, 0.06], [0, 0, 0.03])
    addBox(group, mats.wood, [width, 0.05, 0.06], [0, 0, 0.03])
  }

  return { group, pane }
}

/**
 * The television: bezel and the display surface itself.
 *
 * The screen mesh is the whole point of a venue - `media.setScreenMesh()` hangs
 * the film on it - so it carries the same marks as the hall's screen: the role
 * in userData and an unlit material, because a screen makes its own light.
 *
 * The meshes are handed back one by one because a television can be resized:
 * the room throws these away and builds bigger ones, and it must not throw away
 * the film surface the media module parented to the old screen.
 *
 * @returns {{ group: THREE.Group, screen: THREE.Mesh, meshes: THREE.Mesh[] }}
 */
export function buildDisplay(mats, options = {}) {
  const { width = 2.6, height = 1.4625, name = 'VenueScreen' } = options
  const group = new THREE.Group()
  group.name = 'Display'

  const bezel = addBox(group, mats.bezel, [width + 0.09, height + 0.09, 0.07], [0, 0, -0.045], {
    round: 0.012,
  })

  const screen = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mats.screen)
  screen.name = name
  screen.userData.role = 'screen'
  screen.position.z = 0.001
  group.add(screen)

  return { group, screen, meshes: [bezel, screen] }
}

/**
 * Wallpaper that has come away from the wall.
 *
 * A strip hinged along its top edge and tipped into the room, with the darker
 * plaster showing behind it. Nothing about a horror room says "somebody lived
 * here and stopped" faster, and it costs two planes.
 */
export function addPeel(parent, mats, options = {}) {
  const { x = 0, y = 1.8, z = 0, ry = 0, width = 0.4, height = 0.9, tilt = 0.35 } = options
  const anchor = new THREE.Group()
  anchor.position.set(x, y, z)
  anchor.rotation.y = ry
  parent.add(anchor)

  // The plaster underneath, flat on the wall.
  addPlane(anchor, mats.plaster, [width * 1.05, height * 0.98], [0, -height / 2, 0.004])

  const hinge = new THREE.Group()
  hinge.rotation.x = tilt
  anchor.add(hinge)
  addPlane(hinge, mats.paper, [width, height], [0, -height / 2, 0.012])

  return anchor
}

/* -------------------------------------------------------------------------- */
/* plain data the player module reads                                          */
/* -------------------------------------------------------------------------- */

/** A local point of a room, in world coordinates. */
export function worldPoint(origin, point) {
  return { x: origin.x + point.x, y: point.y ?? 0, z: origin.z + point.z }
}

/**
 * A seat in a venue: the same record shape as `src/scene/seats.js`, so the
 * player module cannot tell a sofa from seat C7.
 *
 * Everything is given in room coordinates and comes out in world coordinates.
 * `lookAt` is the television of the room, which is what the eye turns to when
 * you sit; `standSpot` is the piece of floor you are put back on, which the
 * tests check is actually free.
 *
 * @param {{x:number,z:number}} origin
 * @param {{
 *   id:string, label:string, x:number, z:number, yaw?:number, back?:number,
 *   sitY?:number, eyeY?:number, look:{x:number,y:number,z:number},
 *   stand:{x:number,z:number},
 * }} seat
 */
export function venueSeat(origin, seat) {
  const { id, label, x, z, yaw = 0, back = 0.16, sitY = 0.56, eyeY = 1.2 } = seat
  // The eye sits a hand's width back into the cushions, along the seat's own
  // back direction rather than along +Z: an armchair is turned, a sofa is not.
  const ex = origin.x + x + Math.sin(yaw) * back
  const ez = origin.z + z + Math.cos(yaw) * back

  return Object.freeze({
    id,
    label,
    position: Object.freeze({ x: origin.x + x, y: 0, z: origin.z + z }),
    sitPosition: Object.freeze({ x: origin.x + x, y: sitY, z: origin.z + z }),
    eyePosition: Object.freeze({ x: ex, y: eyeY, z: ez }),
    lookAt: Object.freeze(worldPoint(origin, seat.look)),
    standSpot: Object.freeze({ x: origin.x + seat.stand.x, z: origin.z + seat.stand.z }),
    rotationY: yaw,
  })
}

/**
 * A fixed camera shot of a venue, in world coordinates, ready for
 * `player.setPlace()`. Two points and a name: the camera maths is the player's.
 */
export function venueView(origin, view) {
  return {
    id: view.id,
    label: view.label,
    hint: view.hint ?? '',
    drift: view.drift,
    eye: worldPoint(origin, view.eye),
    target: worldPoint(origin, view.target),
  }
}

/**
 * A point on the skirting, all the way round a rectangle, from a single number.
 * `t` runs 0..1 anticlockwise from the front left corner. Used by the things
 * that crawl along the edges of the horror room.
 */
export function perimeterPoint(t, room, inset, out = { x: 0, z: 0 }) {
  const w = room.width / 2 - inset
  const d = room.depth / 2 - inset
  const span = 2 * (w * 2 + d * 2)
  let walked = ((t % 1) + 1) % 1 * span
  const along = (length) => {
    const taken = Math.min(walked, length)
    walked -= taken
    return taken
  }

  const back = along(w * 2)
  if (walked <= 0) {
    out.x = -w + back
    out.z = d
    return out
  }
  const left = along(d * 2)
  if (walked <= 0) {
    out.x = w
    out.z = d - left
    return out
  }
  const front = along(w * 2)
  if (walked <= 0) {
    out.x = w - front
    out.z = -d
    return out
  }
  out.x = -w
  out.z = -d + walked
  return out
}

/** Give back every bit of GPU memory a room took. */
export function disposeRoom(group, materials) {
  group.traverse((object) => {
    // The film's own surface is parented to whichever screen is showing it. It
    // belongs to the media module and outlives this room (see videoScreen.js,
    // which stamps `isMediaSurface` on it for exactly this reason).
    if (object.userData?.isMediaSurface) return
    if (object.geometry) object.geometry.dispose()
  })
  for (const material of Object.values(materials ?? {})) material?.dispose?.()
}

/** Blocking box for the player collider, in world coordinates. */
export function blocker(name, origin, { x = 0, z = 0, width, depth, top }) {
  return {
    name,
    minX: origin.x + x - width / 2,
    maxX: origin.x + x + width / 2,
    minZ: origin.z + z - depth / 2,
    maxZ: origin.z + z + depth / 2,
    top,
  }
}

/**
 * A blocking box straight from two corners of the plan, for the parts of a
 * room's bounding rectangle that are not in the room: an L shaped floor is a
 * rectangle with the missing corner filled in.
 */
export function fill(name, origin, { minX, maxX, minZ, maxZ, top = 4 }) {
  return {
    name,
    minX: origin.x + minX,
    maxX: origin.x + maxX,
    minZ: origin.z + minZ,
    maxZ: origin.z + maxZ,
    top,
  }
}

/**
 * Walls for the player collider. The inset is baked in: the collider clamps the
 * centre of the player, not their skin.
 */
export function roomBounds(origin, room, inset = 0.45) {
  return {
    minX: origin.x + (room.minX ?? -room.width / 2) + inset,
    maxX: origin.x + (room.maxX ?? room.width / 2) - inset,
    minZ: origin.z + (room.minZ ?? -room.depth / 2) + inset,
    maxZ: origin.z + (room.maxZ ?? room.depth / 2) - inset,
  }
}

export const clamp01 = (value) => Math.min(Math.max(Number(value) || 0, 0), 1)
export const lerp = (a, b, t) => a + (b - a) * t
export const rand = (min, max) => min + Math.random() * (max - min)
export const clamp = (value, min, max) => (value < min ? min : value > max ? max : value)

/**
 * Cinema seating: the seat *data* and the seat *meshes*.
 *
 * The layout is generated once from `SEATING` in `constants.js` and exported as
 * a plain, frozen array (`SEATS`) so that any other module can use it without
 * touching Three.js at all:
 *
 *   import { SEATS, getSeatById } from './scene/seats.js'
 *
 *   SEATS[0]
 *   // {
 *   //   id: 'A1', row: 0, rowLabel: 'A', number: 1,
 *   //   block: 'left', indexInBlock: 6,
 *   //   position:    { x, y, z },   // floor anchor of the seat
 *   //   sitPosition: { x, y, z },   // top of the cushion
 *   //   eyePosition: { x, y, z },   // eye level of a seated person
 *   //   rotationY, isAisleSeat, isEdgeSeat, distanceToScreen
 *   // }
 */

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { SEATING, SCREEN_CENTER, PALETTE } from './constants.js'

/** The raw layout configuration (rows, spacing, aisle width...). */
export const SEAT_LAYOUT = SEATING

/** Where every seat is looking. */
export { SCREEN_CENTER }

function buildSeatData() {
  const {
    rows,
    seatsPerBlock,
    rowSpacing,
    firstRowZ,
    rowRise,
    seatSpacing,
    aisleHalfWidth,
    seatWidth,
    sitHeight,
    eyeHeight,
    rowLabels,
  } = SEATING

  const seats = []

  for (let row = 0; row < rows; row++) {
    const rowLabel = rowLabels[row]
    const z = firstRowZ + row * rowSpacing
    const floorY = row * rowRise

    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1
      const block = side === 0 ? 'left' : 'right'

      for (let k = 0; k < seatsPerBlock; k++) {
        // k = 0 is the seat next to the centre aisle, growing outwards.
        const x = sign * (aisleHalfWidth + seatWidth / 2 + k * seatSpacing)
        // Numbering runs 1..N from the far left to the far right of the row.
        const number = side === 0 ? seatsPerBlock - k : seatsPerBlock + 1 + k
        const id = `${rowLabel}${number}`

        const dx = x - SCREEN_CENTER.x
        const dy = floorY + eyeHeight - SCREEN_CENTER.y
        const dz = z - SCREEN_CENTER.z

        seats.push(
          Object.freeze({
            id,
            row,
            rowLabel,
            number,
            block,
            indexInBlock: k,
            /** Floor anchor: where the seat stands on its riser. */
            position: Object.freeze({ x, y: floorY, z }),
            /** Top of the cushion. */
            sitPosition: Object.freeze({ x, y: floorY + sitHeight, z }),
            /** Eye level of a seated person (slightly behind the seat centre). */
            eyePosition: Object.freeze({ x, y: floorY + eyeHeight, z: z + 0.18 }),
            /** Seats toe in slightly towards the centre of the screen. */
            rotationY: x * 0.012,
            isAisleSeat: k === 0,
            isEdgeSeat: k === seatsPerBlock - 1,
            distanceToScreen: Number(Math.sqrt(dx * dx + dy * dy + dz * dz).toFixed(2)),
          }),
        )
      }
    }
  }

  seats.sort((a, b) => (a.row - b.row) || (a.number - b.number))
  return Object.freeze(seats)
}

/** Every seat in the hall, ordered by row then seat number. */
export const SEATS = buildSeatData()

/** Just the ids, e.g. ['A1', 'A2', ... 'H14']. */
export const SEAT_IDS = Object.freeze(SEATS.map((s) => s.id))

const SEATS_BY_ID = new Map(SEATS.map((s) => [s.id, s]))

/** Look up a single seat by its id ('C7'). Returns undefined if unknown. */
export function getSeatById(id) {
  return SEATS_BY_ID.get(id)
}

/** All seats of one row, e.g. getSeatsByRow('C'). */
export function getSeatsByRow(rowLabel) {
  const label = String(rowLabel).toUpperCase()
  return SEATS.filter((s) => s.rowLabel === label)
}

/** The seat whose floor anchor is closest to a point {x, y, z}. */
export function getNearestSeat(point) {
  let best = null
  let bestDist = Infinity
  for (const seat of SEATS) {
    const dx = seat.position.x - point.x
    const dz = seat.position.z - point.z
    const d = dx * dx + dz * dz
    if (d < bestDist) {
      bestDist = d
      best = seat
    }
  }
  return best
}

// --------------------------------------------------------------------------
// Meshes
// --------------------------------------------------------------------------

/** Positions a geometry in the seat's local space. Always returns a fresh, non-indexed copy. */
function place(geometry, { x = 0, y = 0, z = 0, rx = 0 } = {}) {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry
  if (geo !== geometry) geometry.dispose()
  if (rx) geo.rotateX(rx)
  return geo.translate(x, y, z)
}

/**
 * A seat is 112 copies of the same shape, so the parts are welded once into
 * three template geometries (frame / upholstery / armrests) and shared by every
 * seat. That is 3 draw calls per seat instead of 12, while still leaving the
 * upholstery on its own mesh so a single seat can be tinted or picked.
 */
function buildSeatGeometries() {
  const w = SEATING.seatWidth
  const d = SEATING.seatDepth
  const armX = w / 2 - 0.02

  const framePieces = [
    place(new RoundedBoxGeometry(w, 0.38, d, 2, 0.06), { y: 0.32 }),
  ]
  for (const sign of [-1, 1]) {
    framePieces.push(place(new THREE.BoxGeometry(0.07, 0.3, 0.09), { x: sign * armX, y: 0.47, z: 0.28 }))
    for (const sz of [-1, 1]) {
      framePieces.push(
        place(new THREE.CylinderGeometry(0.05, 0.06, 0.14, 8), {
          x: sign * (w / 2 - 0.12),
          y: 0.07,
          z: sz * (d / 2 - 0.12),
        }),
      )
    }
  }

  // The back is deliberately low. A cinema seat you can see over is worth more
  // here than a tall one: the row in front must not sit in the bottom of the
  // picture (see SEATING.seatTopHeight).
  const upholsteryPieces = [
    place(new RoundedBoxGeometry(w - 0.06, 0.15, d - 0.05, 3, 0.07), { y: SEATING.sitHeight, z: 0.02, rx: -0.035 }),
    place(new RoundedBoxGeometry(w - 0.08, 0.72, 0.17, 3, 0.07), { y: 0.9, z: 0.31, rx: 0.14 }),
    place(new RoundedBoxGeometry(w - 0.26, 0.18, 0.18, 3, 0.07), { y: 1.29, z: 0.25, rx: 0.14 }),
  ]

  const armrestPieces = [-1, 1].map((sign) =>
    place(new RoundedBoxGeometry(0.11, 0.09, d - 0.14, 3, 0.045), { x: sign * armX, y: 0.64, z: 0.04 }),
  )

  const merge = (pieces) => {
    const merged = mergeGeometries(pieces, false)
    for (const piece of pieces) piece.dispose()
    return merged
  }

  return {
    frame: merge(framePieces),
    upholstery: merge(upholsteryPieces),
    armrest: merge(armrestPieces),
  }
}

/**
 * Builds one seat as a Group whose local origin sits on the floor, facing -Z
 * (towards the screen).
 */
function buildSeat(seat, geo, materials) {
  const group = new THREE.Group()
  group.name = `seat-${seat.id}`
  group.position.set(seat.position.x, seat.position.y, seat.position.z)
  group.rotation.y = seat.rotationY

  // Each seat owns its upholstery material so a single seat can be tinted
  // (selected / occupied / unavailable) without affecting the rest of the hall.
  const upholstery = materials.upholstery.clone()

  const parts = [
    new THREE.Mesh(geo.frame, materials.frame),
    new THREE.Mesh(geo.upholstery, upholstery),
    new THREE.Mesh(geo.armrest, materials.armrest),
  ]

  for (const mesh of parts) {
    mesh.castShadow = true
    mesh.receiveShadow = true
    // Stamped on every part so a raycast hit maps straight back to the seat.
    mesh.userData.seatId = seat.id
    mesh.userData.seat = seat
    group.add(mesh)
  }

  group.userData.seatId = seat.id
  group.userData.seat = seat
  group.userData.upholsteryMaterial = upholstery
  group.userData.parts = parts

  return group
}

/**
 * Creates the 3D seating.
 *
 * @returns {{
 *   group: THREE.Group,
 *   seats: typeof SEATS,
 *   objects: Map<string, THREE.Group>,
 *   pickMeshes: THREE.Mesh[],
 *   getSeatObject: (id: string) => THREE.Group | undefined,
 *   dispose: () => void
 * }}
 */
export function createSeats() {
  const group = new THREE.Group()
  group.name = 'Seating'

  const geo = buildSeatGeometries()

  const materials = {
    upholstery: new THREE.MeshStandardMaterial({
      color: PALETTE.upholstery,
      roughness: 0.92,
      metalness: 0.0,
    }),
    frame: new THREE.MeshStandardMaterial({
      color: PALETTE.frame,
      roughness: 0.65,
      metalness: 0.25,
    }),
    armrest: new THREE.MeshStandardMaterial({
      color: 0x241416,
      roughness: 0.5,
      metalness: 0.15,
    }),
  }

  const objects = new Map()
  const pickMeshes = []

  for (const seat of SEATS) {
    const object = buildSeat(seat, geo, materials)
    objects.set(seat.id, object)
    pickMeshes.push(...object.userData.parts)
    group.add(object)
  }

  return {
    group,
    seats: SEATS,
    objects,
    pickMeshes,
    getSeatObject: (id) => objects.get(id),
    dispose() {
      for (const g of Object.values(geo)) g.dispose()
      for (const m of Object.values(materials)) m.dispose()
      for (const object of objects.values()) object.userData.upholsteryMaterial.dispose()
      objects.clear()
      pickMeshes.length = 0
    },
  }
}

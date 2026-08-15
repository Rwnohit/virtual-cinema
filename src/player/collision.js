/**
 * Collision for the walking player.
 *
 * The hall is a known shape, so instead of raycasting the scene graph every
 * frame we build the blocking volumes once from the shared dimensions in
 * `src/scene/constants.js`. That is exact, allocation free and stays in sync
 * with the room automatically. Nothing here imports Three.js, which also makes
 * it testable in plain Node.
 *
 * The player is a circle of `radius` on the floor. Blocking volumes are
 * axis aligned boxes with a `top` height: anything lower than `stepHeight` is
 * walked over instead of blocking.
 *
 * The hall is not the only room any more. `setLayout()` swaps the whole set of
 * boxes, the walls and the floor for another place (see src/venues/), and
 * `setLayout(null)` puts the hall back exactly as it was.
 */

import { ROOM_BOUNDS, STAGE, SEATING } from '../scene/constants.js'

/**
 * Floor height at a given depth. The hall is flat in front of the seating and
 * then rises one step per row (see `buildFloorAndRisers` in scene/cinema.js).
 * @param {number} z
 * @returns {number}
 */
export function floorHeightAt(z) {
  const { firstRowZ, rowSpacing, rowRise, rows } = SEATING
  // Step r starts 1.1m in front of row r and runs to the back wall.
  const step = Math.floor((z - firstRowZ + 1.1) / rowSpacing)
  if (step < 1) return 0
  return Math.min(step, rows - 1) * rowRise
}

/**
 * One frame of a jump, in place.
 *
 * This lives next to the floor rather than in the camera rig because it is the
 * only piece of the jump that has to be exact, and because here it can be
 * checked without a browser: give it the arc and it says where the body is next
 * frame and whether it has just landed.
 *
 * @param {{y:number, vy:number}} body height of the feet and vertical speed
 * @param {number} dt seconds
 * @param {number} floorY the floor under the body right now
 * @param {number} gravity m/s^2, positive
 * @returns {boolean} true on the frame the body touches down
 */
export function stepAir(body, dt, floorY, gravity) {
  body.vy -= gravity * dt
  body.y += body.vy * dt
  // Only a body on its way down lands: rising through the floor of a riser you
  // are jumping out of must not end the jump.
  if (body.vy <= 0 && body.y <= floorY) {
    body.y = floorY
    body.vy = 0
    return true
  }
  return false
}

/** Every box the player cannot walk through. */
export function buildBlockers() {
  const boxes = []

  // --- stage in front of the screen, plus its side stairs ------------------
  boxes.push({
    name: 'stage',
    minX: -STAGE.width / 2 - 0.1,
    maxX: STAGE.width / 2 + 0.1,
    minZ: STAGE.z - STAGE.depth / 2,
    maxZ: STAGE.z + STAGE.depth / 2,
    top: STAGE.height,
  })
  for (const sign of [-1, 1]) {
    const x = sign * (STAGE.width / 2 - 1)
    boxes.push({
      name: `stage-stairs-${sign < 0 ? 'left' : 'right'}`,
      minX: x - 0.9,
      maxX: x + 0.9,
      minZ: STAGE.z + STAGE.depth / 2,
      maxZ: STAGE.z + STAGE.depth / 2 + 1.1,
      top: STAGE.height,
    })
  }

  // --- the two seat blocks of every row ------------------------------------
  const {
    rows,
    seatsPerBlock,
    rowSpacing,
    firstRowZ,
    rowRise,
    seatSpacing,
    aisleHalfWidth,
    seatWidth,
  } = SEATING

  const blockOuter =
    aisleHalfWidth + seatWidth / 2 + (seatsPerBlock - 1) * seatSpacing + seatWidth / 2

  for (let row = 0; row < rows; row++) {
    const z = firstRowZ + row * rowSpacing
    const floorY = row * rowRise
    for (const sign of [-1, 1]) {
      boxes.push({
        name: `seats-row-${row}-${sign < 0 ? 'left' : 'right'}`,
        minX: sign < 0 ? -blockOuter : aisleHalfWidth,
        maxX: sign < 0 ? -aisleHalfWidth : blockOuter,
        // A bit deeper at the back to cover the reclined backrests.
        minZ: z - 0.52,
        maxZ: z + 0.72,
        top: floorY + SEATING.seatTopHeight,
      })
    }
  }

  return boxes
}

export class PlayerCollider {
  /**
   * @param {{radius?:number, stepHeight?:number, wallInset?:number, blockers?:Array}} [options]
   */
  constructor(options = {}) {
    this.radius = options.radius ?? 0.34
    this.stepHeight = options.stepHeight ?? 0.5
    this.wallInset = options.wallInset ?? 0.55

    /**
     * The hall, kept whole so that walking back into it needs no rebuilding and
     * cannot drift from what it was at boot.
     * @type {{blockers:Array, bounds:{minX:number,maxX:number,minZ:number,maxZ:number}, floorAt:null}}
     */
    this.hallLayout = {
      blockers: options.blockers ?? buildBlockers(),
      bounds: {
        minX: ROOM_BOUNDS.minX + this.wallInset,
        maxX: ROOM_BOUNDS.maxX - this.wallInset,
        minZ: ROOM_BOUNDS.minZ + this.wallInset,
        maxZ: ROOM_BOUNDS.maxZ - this.wallInset,
      },
      floorAt: null,
    }

    /** Which room the player is currently walking around in. */
    this.layout = null
    this.setLayout(null)
  }

  /**
   * Walk in another room, or in the hall again.
   *
   * @param {{blockers?:Array, bounds?:{minX:number,maxX:number,minZ:number,maxZ:number},
   *          floorAt?:(x:number,z:number)=>number}|null} layout
   *   null puts the hall back
   * @returns {this}
   */
  setLayout(layout) {
    const next = layout ?? this.hallLayout
    this.layout = layout ?? null
    this.blockers = next.blockers ?? []
    const bounds = next.bounds ?? this.hallLayout.bounds
    this.minX = bounds.minX
    this.maxX = bounds.maxX
    this.minZ = bounds.minZ
    this.maxZ = bounds.maxZ
    // A flat room has no stepped risers, so it says so with its own function
    // instead of inheriting the staircase of the auditorium.
    this._floorAt = typeof next.floorAt === 'function' ? next.floorAt : null
    return this
  }

  /** Floor height under a point. */
  floorAt(x, z) {
    return this._floorAt ? this._floorAt(x, z) : floorHeightAt(z)
  }

  /**
   * Push a point out of every box it overlaps and keep it inside the room.
   * Mutates `out` ({x, z}) and returns it.
   *
   * @param {{x:number, z:number}} out desired position
   * @param {number} feetY current height of the feet
   */
  resolve(out, feetY) {
    const r = this.radius
    const reach = feetY + this.stepHeight

    // Two passes so that sliding into a corner settles instead of jittering.
    for (let pass = 0; pass < 2; pass++) {
      let moved = false
      for (const box of this.blockers) {
        if (box.top <= reach) continue // low enough to step over

        const minX = box.minX - r
        const maxX = box.maxX + r
        const minZ = box.minZ - r
        const maxZ = box.maxZ + r
        if (out.x <= minX || out.x >= maxX || out.z <= minZ || out.z >= maxZ) continue

        // Push out along whichever side is closest.
        const left = out.x - minX
        const right = maxX - out.x
        const front = out.z - minZ
        const back = maxZ - out.z
        const smallest = Math.min(left, right, front, back)

        if (smallest === left) out.x = minX
        else if (smallest === right) out.x = maxX
        else if (smallest === front) out.z = minZ
        else out.z = maxZ
        moved = true
      }
      if (!moved) break
    }

    if (out.x < this.minX) out.x = this.minX
    else if (out.x > this.maxX) out.x = this.maxX
    if (out.z < this.minZ) out.z = this.minZ
    else if (out.z > this.maxZ) out.z = this.maxZ

    return out
  }

  /** True when a point is standing somewhere legal (used by tests and spawn). */
  isFree(x, z, feetY = 0) {
    const probe = { x, z }
    this.resolve(probe, feetY)
    return Math.abs(probe.x - x) < 1e-6 && Math.abs(probe.z - z) < 1e-6
  }
}

export default PlayerCollider

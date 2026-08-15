/**
 * Which seat the player can take, and which one they are on.
 *
 * The hall's seat data comes from `src/scene/seats.js` (read only). A venue
 * hands over its own table through `setSeats()`: a sofa and an armchair are
 * seats, described exactly like the ones in the auditorium, so everything from
 * here down is the same code in all three rooms.
 *
 * Nothing in here paints a seat any more. The viewer knows where they are going
 * to sit, and a seat that turns yellow when you walk past it says otherwise.
 */

import { SEATS } from '../scene/seats.js'
import { PLAYER_CONFIG } from './config.js'
import { setPlayerSeat } from './state.js'

export class SeatManager {
  /**
   * @param {{seats?:Array, objects?:Map, config?:object, reach?:number}} [options]
   */
  constructor(options = {}) {
    this.config = { ...PLAYER_CONFIG, ...(options.config ?? {}) }
    /** Seats taken by other people; filled in by the networking module. */
    this.occupied = new Set()
    this.currentId = null
    this._listeners = new Set()

    this.setSeats(options.seats, { objects: options.objects, reach: options.reach })
  }

  /**
   * Walk into another room: its seats replace the ones we were offering.
   * `setSeats(null)` puts the hall's back.
   *
   * @param {Array|object|null} seats a seat table, a seats handle, or null
   * @param {{objects?:Map, reach?:number}} [options]
   */
  setSeats(seats, options = {}) {
    // Whoever we were sitting on is in the room we just left.
    if (this.currentId) {
      this.currentId = null
      setPlayerSeat(null)
    }
    this.seats = normalizeSeats(seats)
    this.objects = options.objects ?? null
    this.byId = new Map(this.seats.map((seat) => [seat.id, seat]))
    this.occupied = new Set()
    /**
     * How far you may be from a seat to take it. A living room says so itself:
     * the hall's 5.2m would offer you the sofa from the doorway.
     */
    this.reach = Number.isFinite(options.reach) ? options.reach : this.config.seatReach
    return this.seats
  }

  get current() {
    return this.currentId ? this.byId.get(this.currentId) : null
  }

  getSeat(id) {
    return this.byId.get(String(id)) ?? null
  }

  isFree(id) {
    const key = String(id)
    return this.byId.has(key) && !this.occupied.has(key)
  }

  /** Called by the networking module: the ids other people are sitting on. */
  setOccupied(ids) {
    this.occupied = new Set((ids ?? []).map(String))
    if (this.currentId) this.occupied.delete(this.currentId)
  }

  /**
   * The closest free seat to a point, or null if none is within reach.
   * @param {{x:number,y:number,z:number}} point
   * @param {number} [maxDistance]
   */
  nearestFree(point, maxDistance = this.reach) {
    let best = null
    let bestDistance = maxDistance * maxDistance

    for (const seat of this.seats) {
      if (this.occupied.has(seat.id)) continue
      const dx = seat.position.x - point.x
      const dz = seat.position.z - point.z
      // Rows are stepped, so keep the height in the metric but weight it down.
      const dy = (seat.position.y - point.y) * 0.5
      const distance = dx * dx + dy * dy + dz * dz
      if (distance < bestDistance) {
        bestDistance = distance
        best = seat
      }
    }
    return best
  }

  /* ---------------------------------------------------------------------- */

  /** @returns {{ok:boolean, seat?:object, reason?:string}} */
  claim(seatId) {
    const seat = this.getSeat(seatId)
    if (!seat) return { ok: false, reason: 'unknown-seat' }
    if (this.occupied.has(seat.id)) return { ok: false, reason: 'taken' }

    this.currentId = seat.id
    setPlayerSeat(seat.id)
    this._emit({ type: 'sit', seat })
    return { ok: true, seat }
  }

  release() {
    if (!this.currentId) return null
    const seat = this.byId.get(this.currentId)
    this.currentId = null
    setPlayerSeat(null)
    this._emit({ type: 'stand', seat })
    return seat ?? null
  }

  /* ---------------------------------------------------------------------- */

  onChange(fn) {
    this._listeners.add(fn)
    return () => this._listeners.delete(fn)
  }

  _emit(event) {
    for (const fn of this._listeners) {
      try {
        fn(event)
      } catch (err) {
        console.error('[player] seat listener failed', err)
      }
    }
  }

  dispose() {
    this._listeners.clear()
  }
}

/**
 * `main.js` hands us whatever the scene returned: the seats handle
 * ({ seats, objects, ... }), a plain array, or nothing at all. A venue hands us
 * a plain array as well, which is what keeps its seating testable in Node.
 */
function normalizeSeats(input) {
  if (Array.isArray(input)) return input
  if (Array.isArray(input?.seats)) return input.seats
  return SEATS
}

export default SeatManager

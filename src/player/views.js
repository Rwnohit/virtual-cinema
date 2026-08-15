/**
 * The fixed camera shots, plus the cinematic framing, for whichever place the
 * player is standing in.
 *
 * Every shot of the hall is derived from the shared room dimensions instead of
 * being typed in by hand, so another row of seats or a taller screen moves the
 * cameras with the room rather than leaving them aimed at a wall. This file only
 * answers "where does this shot sit and where does it look"; the blending
 * between shots belongs to `controls.js`, which owns the camera.
 *
 * The hall is not the only place any more. A venue hands over its own shots and
 * its own television as plain data (`makePlace`), and `setActivePlace` swaps the
 * whole set: V then walks the shots of the room you are actually in, and C
 * frames the screen that is actually in front of you. `setActivePlace(null)`
 * puts the hall back exactly as it was.
 *
 * Nothing here reads the player, which is what lets a shot be computed at any
 * time, including before the first frame.
 */

import * as THREE from 'three'
import {
  BOOTH,
  ROOM_BOUNDS,
  SCREEN,
  SCREEN_CENTER,
  SEATING,
  SIDE_AISLE_X,
  STAGE,
  screenWidthFor,
} from '../scene/constants.js'
import { floorHeightAt } from './collision.js'
import { PLAYER_CONFIG } from './config.js'

/** The one view that is not a fixed shot: the player's own eyes. */
export const FIRST_PERSON = 'first-person'

/**
 * The cycle behind V. First person comes first so that one more press of V
 * always brings the viewer home the short way round.
 */
export const VIEWS = Object.freeze([
  { id: FIRST_PERSON, label: 'Πρώτο πρόσωπο', hint: 'τα μάτια σου' },
  { id: 'back-row', label: 'Τελευταία σειρά', hint: 'πίσω ψηλά' },
  { id: 'booth', label: 'Θάλαμος προβολής', hint: 'από το φινιστρίνι' },
  { id: 'side', label: 'Πλάγια θέα', hint: 'πλαϊνός διάδρομος' },
  { id: 'stage', label: 'Μπροστά από την οθόνη', hint: 'η αίθουσα από τη σκηνή' },
  { id: 'wide', label: 'Πανοραμική', hint: 'όλη η αίθουσα' },
].map((entry) => Object.freeze(entry)))

/** Speed of the slow sideways float, in radians per second. */
const DRIFT_RATE = 0.22

/** Last row of seats: the shot sits on it, so it follows the risers. */
const LAST_ROW_Z = SEATING.firstRowZ + (SEATING.rows - 1) * SEATING.rowSpacing
const LAST_ROW_FLOOR = (SEATING.rows - 1) * SEATING.rowRise

/** Depth of the side shot, roughly the middle of the seating. */
const SIDE_Z = SEATING.firstRowZ + Math.floor(SEATING.rows / 2) * SEATING.rowSpacing

const _eye = new THREE.Vector3()
const _target = new THREE.Vector3()
const _ahead = new THREE.Vector3()
const _right = new THREE.Vector3()
const _matrix = new THREE.Matrix4()
const _worldUp = new THREE.Vector3(0, 1, 0)

/**
 * One entry per fixed view.
 *
 * `place` writes the eye point and the point the shot looks at. `drift` is how
 * much of the slow sideways float (from `PLAYER_CONFIG.overviewDrift`) the shot
 * takes: without it a held camera reads as a photograph rather than a shot.
 */
const SHOTS = {
  'back-row': {
    drift: 0.15,
    place(eye, target) {
      // Seated eye height on the top riser, a hand's width behind the row.
      eye.set(0, LAST_ROW_FLOOR + SEATING.eyeHeight, LAST_ROW_Z + 0.2)
      target.set(SCREEN_CENTER.x, SCREEN_CENTER.y, SCREEN_CENTER.z)
    },
  },
  booth: {
    drift: 0.3,
    place(eye, target) {
      // Behind one of the two windows, far enough inside the room that the wall
      // itself never clips into the near plane.
      eye.set(-BOOTH.spacing / 2, BOOTH.y, BOOTH.z - 0.45)
      target.set(SCREEN_CENTER.x, SCREEN_CENTER.y, SCREEN_CENTER.z)
    },
  },
  side: {
    drift: 0.4,
    place(eye, target) {
      // Standing in the left side aisle, lifted just over the headrests so the
      // picture is not cut by the row in front.
      eye.set(-SIDE_AISLE_X, floorHeightAt(SIDE_Z) + PLAYER_CONFIG.eyeHeight + 0.45, SIDE_Z)
      // Aimed a little below the middle of the screen, which brings the rows
      // into the bottom of the frame.
      target.set(SCREEN_CENTER.x, SCREEN_CENTER.y - 1, SCREEN_CENTER.z)
    },
  },
  stage: {
    drift: 0.25,
    place(eye, target) {
      // On the stage, at the front edge, with the hall in front of it: the
      // reverse angle, the only one that shows the audience.
      eye.set(0, STAGE.height + PLAYER_CONFIG.eyeHeight - 0.08, STAGE.z + STAGE.depth / 2 + 0.5)
      target.set(0, 3.2, LAST_ROW_Z - 3)
    },
  },
  wide: {
    drift: 1,
    place(eye, target, config) {
      const from = config.overviewPosition ?? PLAYER_CONFIG.overviewPosition
      const at = config.overviewLookAt ?? PLAYER_CONFIG.overviewLookAt
      eye.set(from.x, from.y, from.z)
      target.set(at.x, at.y, at.z)
    },
  },
}

/* -------------------------------------------------------------------------- */
/* which place owns the camera                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The hall: its views, its shots, and no television of its own (the cinematic
 * frame falls back to the projection screen in `constants.js`).
 */
const HALL = Object.freeze({ id: 'cinema', views: VIEWS, shots: SHOTS, screen: null })

let active = HALL

/**
 * Turn a room's plain data into a set of shots.
 *
 * Venues describe a shot as two points in world space and nothing else, which
 * keeps their tables testable in plain Node and keeps the camera maths here.
 *
 * @param {{
 *   id: string,
 *   views?: Array<{id:string,label:string,hint?:string,eye:{x:number,y:number,z:number},
 *                  target:{x:number,y:number,z:number},drift?:number}>,
 *   screen?: {center:{x:number,y:number,z:number}, width:number, height:number, maxBack?:number}|null,
 * }} place
 */
export function makePlace(place = {}) {
  const shots = {}
  const list = [VIEWS[0]]

  for (const entry of place.views ?? []) {
    if (!entry?.id || entry.id === FIRST_PERSON) continue
    list.push(Object.freeze({ id: entry.id, label: entry.label ?? '', hint: entry.hint ?? '' }))
    // The two points are read at build time, but the screen below is kept by
    // reference: a television that can be resized has to be measured live.
    const eye = { ...entry.eye }
    const target = { ...entry.target }
    shots[entry.id] = {
      drift: Number.isFinite(entry.drift) ? entry.drift : 0.12,
      place(outEye, outTarget) {
        outEye.set(eye.x, eye.y, eye.z)
        outTarget.set(target.x, target.y, target.z)
      },
    }
  }

  return {
    id: place.id ?? 'place',
    views: Object.freeze(list),
    shots,
    screen: place.screen ?? null,
  }
}

/**
 * Hand V and C to a place, or to the hall with null.
 * @param {ReturnType<typeof makePlace>|null} place
 */
export function setActivePlace(place) {
  active = place ?? HALL
  return active
}

/** The views V walks through where the player is standing. */
export function activeViews() {
  return active.views
}

/** @param {string} id @returns {{id:string,label:string,hint?:string}|null} */
export function getView(id) {
  return active.views.find((entry) => entry.id === id) ?? null
}

/** Position of a view in the cycle, or -1. */
export function viewIndex(id) {
  return active.views.findIndex((entry) => entry.id === id)
}

/** True for the view that has no fixed shot of its own. */
export function isFirstPerson(id) {
  return id === FIRST_PERSON
}

/**
 * The id `step` places further along the cycle, wrapping round both ways.
 * @param {string} id @param {number} [step]
 */
export function nextViewId(id, step = 1) {
  const views = active.views
  const at = viewIndex(id)
  const from = at < 0 ? 0 : at
  const count = views.length
  return views[(((from + step) % count) + count) % count].id
}

/**
 * Where a fixed view sits and how it looks, written into `position` and
 * `quaternion`.
 *
 * @param {string} id
 * @param {THREE.Vector3} position
 * @param {THREE.Quaternion} quaternion
 * @param {{elapsed?:number, drift?:number, config?:object}} [context]
 * @returns {boolean} false for the first person view, which has no shot
 */
export function computeShot(id, position, quaternion, context = {}) {
  const shot = active.shots[id]
  if (!shot) return false

  const config = context.config ?? PLAYER_CONFIG
  shot.place(_eye, _target, config)

  const amount = (context.drift ?? config.overviewDrift ?? 0) * (shot.drift ?? 0)
  if (amount !== 0) {
    // Drift across the frame rather than along a world axis, so a shot that
    // looks sideways floats sideways too.
    _ahead.copy(_target).sub(_eye).normalize()
    _right.crossVectors(_ahead, _worldUp).normalize()
    _eye.addScaledVector(_right, Math.sin((context.elapsed ?? 0) * DRIFT_RATE) * amount)
  }

  position.copy(_eye)
  _matrix.lookAt(_eye, _target, _worldUp)
  quaternion.setFromRotationMatrix(_matrix)
  return true
}

/** Width of the picture we are framing: whatever masking currently leaves lit. */
function pictureWidth(options) {
  const given = Number(options.width)
  if (Number.isFinite(given) && given > 0) return Math.min(SCREEN.maxWidth, given)
  if (typeof options.ratio === 'string') return screenWidthFor(options.ratio)
  return SCREEN.maxWidth
}

/**
 * The shot that makes the picture fill the view: dead on the axis of the
 * screen, as close as the frame allows.
 *
 * The distance comes out of the camera itself (vertical fov and aspect) and out
 * of the screen dimensions, so it survives a resize, a different fov and a
 * change of ratio without a magic number anywhere. Whichever side of the
 * picture runs out of room first decides how close we may sit, which is what
 * keeps the frame from cropping the film.
 *
 * @param {THREE.Vector3} position
 * @param {THREE.Quaternion} quaternion
 * @param {{fov?:number, aspect?:number, width?:number, ratio?:string, fill?:number}} [options]
 * @returns {number} the distance in front of the screen
 */
export function computeCinematicShot(position, quaternion, options = {}) {
  const fov = Number(options.fov) > 0 ? Number(options.fov) : 60
  const aspect = Number(options.aspect) > 0 ? Number(options.aspect) : 16 / 9
  const fill = clamp(Number(options.fill) > 0 ? Number(options.fill) : 1, 0.35, 1)

  // In a venue the picture is that room's television, which can be resized
  // while the frame is on screen, so it is measured every frame rather than
  // remembered. Every television in this app faces +Z and its room is never
  // turned, which is why one axis is enough here as well.
  const tv = active.screen
  const center = tv ? tv.center : SCREEN_CENTER
  const width = tv ? tv.width : pictureWidth(options)
  const height = tv ? tv.height : SCREEN.height
  const limit = tv
    ? tv.maxBack ?? Infinity
    : ROOM_BOUNDS.maxZ - 0.8 - SCREEN.z

  const halfV = Math.tan((fov * Math.PI) / 360)
  const halfH = halfV * aspect
  const distance = Math.max(height / 2 / (halfV * fill), width / 2 / (halfH * fill))

  // A very tall, narrow window would want to sit outside the back wall.
  const back = Math.min(distance, limit)

  position.set(center.x, center.y, center.z + back)
  // Straight down the axis of the screen, so there is nothing to rotate.
  quaternion.set(0, 0, 0, 1)
  return back
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value
}

export default VIEWS

/**
 * The camera rig: mouse look, walking, sitting, the fixed views and the
 * cinematic frame.
 *
 * One source of truth for the orientation (`yaw` / `pitch`) and one for the
 * position (`feet`), from which the camera transform is derived every frame.
 * That keeps the camera modes (walking / seated / a fixed view / the framed
 * screen) from fighting over the camera: they are layers blended on top of each
 * other, never separate owners.
 *
 * The mouse is read here rather than through PointerLockControls on purpose.
 * That helper writes straight onto the camera, which meant every frame had to
 * decode the camera quaternion back into yaw and pitch and then rebuild it -
 * and a round trip through Euler angles is exactly where a fast flick of the
 * mouse turns into a visible snap. Now the pointer moves the two angles and
 * nothing else ever writes to the camera.
 */

import * as THREE from 'three'
import { SCREEN_CENTER, SIDE_AISLE_X } from '../scene/constants.js'
import { PLAYER_CONFIG, KEYMAP } from './config.js'
import { PlayerCollider, stepAir } from './collision.js'
import { updatePlayerTransform } from './state.js'
import {
  FIRST_PERSON,
  activeViews,
  computeCinematicShot,
  computeShot,
  getView,
  nextViewId,
} from './views.js'

const _euler = new THREE.Euler(0, 0, 0, 'YXZ')
const _forward = new THREE.Vector3()
const _up = new THREE.Vector3()
const _standEye = new THREE.Vector3()
const _seatEye = new THREE.Vector3()
const _playEye = new THREE.Vector3()
const _camEye = new THREE.Vector3()
const _shotEye = new THREE.Vector3()
const _quatPlay = new THREE.Quaternion()
const _camQuat = new THREE.Quaternion()
const _shotQuat = new THREE.Quaternion()
const TWO_PI = Math.PI * 2

/** Radians of turn per pixel of mouse travel, the same feel as three's helper. */
const RADIANS_PER_PIXEL = 0.002

/**
 * Browsers occasionally report an absurd jump in `movementX` - right after the
 * pointer is locked, when the OS pointer wraps a screen edge, or when a frame
 * was dropped and two moves got merged. Left alone that is a hard snap of the
 * view. No human flick covers this many pixels in one event, so it is dropped.
 */
const MAX_PIXELS_PER_EVENT = 260

/** Moves this soon after locking are the browser settling, not the hand. */
const SETTLE_MS = 120

/** How tight the lens gets at full zoom, as a share of the normal field. */
const ZOOM_MIN_FOV = 0.34

/** Past the end of the zoom the camera takes over and frames the picture. */
const ZOOM_ENTER = 0.995

/** And letting go of that much zoom hands the lens back. */
const ZOOM_LEAVE = 0.82

/** Seconds for the lens to reach a new zoom. Short: it must feel direct. */
const ZOOM_TAU = 0.11

/** Yaw that makes you face `target` from `point`. */
export function yawTowards(point, target = SCREEN_CENTER) {
  return Math.atan2(-(target.x - point.x), -(target.z - point.z))
}

/** Pitch that puts `target` in the centre of the view from `point`. */
export function pitchTowards(point, target = SCREEN_CENTER) {
  const dx = target.x - point.x
  const dz = target.z - point.z
  const flat = Math.hypot(dx, dz)
  return Math.atan2(target.y - point.y, flat || 0.001)
}

/** The hall's screen, which is what "the picture" means when nothing else says. */
export const yawTowardsScreen = (point) => yawTowards(point, SCREEN_CENTER)
export const pitchTowardsScreen = (point) => pitchTowards(point, SCREEN_CENTER)

export class PlayerControls {
  /**
   * @param {{camera:THREE.PerspectiveCamera, domElement:HTMLElement, collider?:PlayerCollider, config?:object, spawn?:{x:number,z:number}}} options
   */
  constructor(options = {}) {
    if (!options.camera) throw new Error('[player] createPlayer needs a camera')

    this.camera = options.camera
    this.domElement = options.domElement ?? document.body
    this.config = { ...PLAYER_CONFIG, ...(options.config ?? {}) }
    this.keymap = { ...KEYMAP, ...(options.keymap ?? {}) }
    this.collider = options.collider ?? new PlayerCollider({
      radius: this.config.radius,
      stepHeight: this.config.stepHeight,
    })

    this._locked = false
    /** No pointer to lock: a finger is the pointer. Set by the player module. */
    this.touchOnly = false
    this._lockedAt = 0

    // --- position -----------------------------------------------------------
    const spawn = options.spawn ?? { x: 0, z: 11.5 }
    this.feet = new THREE.Vector3(spawn.x, this.collider.floorAt(spawn.x, spawn.z), spawn.z)
    this.velocity = new THREE.Vector3()
    this.walked = 0 // metres walked, drives the step bob
    this.bob = 0
    this.moving = false
    this.lastStepDistance = 0
    this.stepFoot = 'right'

    // --- the jump -----------------------------------------------------------
    /** True from the moment Space is pressed until the feet touch down again. */
    this.airborne = false
    this.verticalVelocity = 0
    /**
     * The floor the body left. Collision in mid air is resolved at this height
     * and not at the height of the feet, which is what stops a jump from
     * putting anyone on top of a seat, a sofa or a table.
     */
    this.groundY = this.feet.y
    this._air = { y: 0, vy: 0 }

    // --- orientation --------------------------------------------------------
    this.yaw = yawTowardsScreen(this.feet)
    this.pitch = 0

    // --- seat ---------------------------------------------------------------
    this.seat = null
    this.seatBlend = 0
    this.seatYaw = 0
    this.seatPitch = 0
    this.standReturn = { x: spawn.x, z: spawn.z }

    // --- fixed views --------------------------------------------------------
    this._viewId = FIRST_PERSON
    /** How much of the fixed shot is on screen, 0 = the player's own eyes. */
    this.viewBlend = 0
    /**
     * The last view that has a shot of its own. Kept after going back to first
     * person so the camera has somewhere to blend out of, the same trick as
     * `_lastSeat` below.
     */
    this._shotId = null
    /** Where the fixed camera is right now, and where it was told to fly from. */
    this._shot = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }
    this._shotFrom = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }
    this._shotBlend = 1
    this._shotSnap = true

    // --- the lens -----------------------------------------------------------
    /** 0 is the room's own field of view, 1 is as tight as the wheel goes. */
    this.zoom = 0
    this.zoomTarget = 0
    this.baseFov = this.camera.fov

    // --- cinematic frame ----------------------------------------------------
    this._cinematic = false
    this.cinematicBlend = 0
    this._cinematicAt = 0
    /** Which picture we are framing: 0 means the whole screen surface. */
    this._cinematicWidth = 0
    this._cinematicRatio = undefined
    this._cine = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }

    /**
     * The player's own head, wherever the camera happens to be looking from.
     * The audio listener rides this, so a fixed shot never drags the sound
     * across the room.
     */
    this.head = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }

    this.elapsed = 0

    this.keys = new Set()
    /** How hard the on-screen stick is being pushed, -1..1 each way. */
    this.touchAhead = 0
    this.touchSide = 0
    this.listeners = new Map()

    this._bind()
    this._applyLook()
    this.publish()
  }

  /* ---------------------------------------------------------------------- */
  /* input                                                                   */
  /* ---------------------------------------------------------------------- */

  _bind() {
    this._onKeyDown = (event) => {
      if (event.repeat) return
      this.keys.add(event.code)

      if (this.keymap.crosshair?.includes(event.code)) {
        // Hiding the sight is not "doing something with the room", so this one
        // key must not knock the viewer out of the cinematic frame.
        this.emit('crosshair')
      } else if (this.keymap.cinematic?.includes(event.code)) {
        this.setCinematic(!this._cinematic)
      } else {
        // Any other key means the viewer is doing something with the room, so
        // the framed screen lets go instead of fighting them for the camera.
        if (this._cinematic) this.setCinematic(false)
        if (this.keymap.seat.includes(event.code)) this.emit('toggle-seat')
        else if (this.keymap.jump?.includes(event.code)) this.jump()
        else if (this.keymap.view.includes(event.code)) {
          if (event.shiftKey) this.previousView()
          else this.nextView()
        }
      }

      if (this._isMoveKey(event.code)) event.preventDefault()
    }
    this._onKeyUp = (event) => this.keys.delete(event.code)
    this._onBlur = () => this.keys.clear()

    this._onMouseMove = (event) => this._look(event)
    /**
     * A click leaves the cinematic frame; moving the mouse does not.
     *
     * The viewer asked for exactly this: they want to be able to look around
     * while the picture fills the view, and to decide themselves when it is
     * over. Clicks on the panel and the menus are somebody else's business, so
     * only a click in the room itself counts.
     */
    this._onMouseDown = (event) => {
      if (!this._cinematic) return
      const target = event.target
      if (target !== this.domElement && target !== document.body && target !== document.documentElement) {
        return
      }
      this.setCinematic(false)
    }
    /**
     * The wheel is one continuous move from "the room" to "inside the film".
     *
     * Scrolling in narrows the lens; keep going past the end of its travel and
     * the camera takes over and frames the picture. Scrolling back out lets go
     * of the frame and hands the same lens back, still zoomed, so it unwinds
     * through the same positions it came in through. One gesture, both ways.
     */
    this._onWheel = (event) => {
      // A wheel over a panel is that panel scrolling, not the viewer zooming.
      if (event.target?.closest?.('.rp-panel, .mc-panel, .cm-root, .vu-sheet, .ms-dock')) return
      event.preventDefault()
      const step = event.deltaMode === 1 ? event.deltaY * 0.04 : event.deltaY * 0.0016
      this.zoomTarget = clamp(this.zoomTarget - step, 0, 1)

      if (!this._cinematic && this.zoomTarget >= ZOOM_ENTER) {
        this.setCinematic(true)
      } else if (this._cinematic && this.zoomTarget <= ZOOM_LEAVE) {
        this.setCinematic(false)
      }
    }
    this._onPointerLockChange = () => {
      this.setLocked(document.pointerLockElement === this.domElement)
    }
    this._onPointerLockError = () => this.setLocked(false)

    document.addEventListener('keydown', this._onKeyDown)
    document.addEventListener('keyup', this._onKeyUp)
    window.addEventListener('blur', this._onBlur)
    document.addEventListener('mousemove', this._onMouseMove)
    document.addEventListener('mousedown', this._onMouseDown)
    document.addEventListener('wheel', this._onWheel, { passive: false })
    document.addEventListener('pointerlockchange', this._onPointerLockChange)
    document.addEventListener('pointerlockerror', this._onPointerLockError)
  }

  /**
   * One mouse move. Applied straight to yaw and pitch, clamped rather than
   * wrapped, so looking at the ceiling can never roll the horizon over.
   */
  _look(event) {
    const dx = event.movementX ?? 0
    const dy = event.movementY ?? 0
    // A jump no hand could make is the browser talking, not the viewer: it
    // neither turns the head nor breaks the cinematic frame.
    if (Math.abs(dx) > MAX_PIXELS_PER_EVENT || Math.abs(dy) > MAX_PIXELS_PER_EVENT) return

    if (!this._locked) return
    // Anything during the settle window, or while a fixed view has the camera,
    // is not the viewer looking around.
    if (performance.now() - this._lockedAt < SETTLE_MS) return
    if (this.viewBlend > 0.02) return
    // The cinematic frame is deliberately not in that list. It holds the
    // camera, but the head keeps turning underneath it, so the mouse is never
    // dead and the viewer comes out of the frame looking where they pointed.

    const speed = RADIANS_PER_PIXEL * this.config.pointerSpeed
    this.turnBy(dx * speed, dy * speed)
  }

  /**
   * Walk from something that is not a keyboard.
   *
   * A thumb on a stick gives a direction AND a strength, which keys cannot:
   * -1..1 each way, and the length of the pair is how fast. Kept apart from
   * `keys` so a phone and a desk never fight over the same state.
   */
  setTouchMove(ahead, side) {
    this.touchAhead = Math.max(-1, Math.min(1, Number(ahead) || 0))
    this.touchSide = Math.max(-1, Math.min(1, Number(side) || 0))
  }

  /** Turn by an amount somebody has already worked out, in radians. */
  turnBy(dyaw, dpitch) {
    this.yaw -= dyaw
    this.pitch -= dpitch
    this.pitch = clamp(this.pitch, this.config.minPitch, this.config.maxPitch)
  }

  /** Called by the pointer lock events. Tests use it when the browser refuses. */
  setLocked(locked) {
    const next = !!locked
    if (next === this._locked) return
    this._locked = next
    if (next) {
      this._lockedAt = performance.now()
      this.emit('lock')
    } else {
      this.keys.clear()
      this.emit('unlock')
    }
  }

  _isMoveKey(code) {
    return (
      this.keymap.forward.includes(code) ||
      this.keymap.backward.includes(code) ||
      this.keymap.left.includes(code) ||
      this.keymap.right.includes(code) ||
      // Space scrolls the page if nobody stops it, and the page is the cinema.
      (this.keymap.jump?.includes(code) ?? false)
    )
  }

  _down(action) {
    return this.keymap[action].some((code) => this.keys.has(code))
  }

  lock() {
    const element = this.domElement
    /**
     * A phone has no pointer to lock.
     *
     * `requestPointerLock` does not exist on iOS and is refused on most
     * Android browsers, so "click to enter the room" went nowhere and every
     * gate downstream - walking, looking, the crosshair - stayed shut. There
     * is nothing to capture on a touch screen: the finger IS the pointer, so
     * being in the room is simply a fact we set.
     */
    if (this.touchOnly || !element?.requestPointerLock) {
      if (this.touchOnly) this.setLocked(true)
      return
    }
    /**
     * The retry is the point, and so is swallowing what IT throws.
     *
     * Raw movement - no operating system acceleration in the way - is what
     * makes a fast turn land where you aimed it, but not every browser and not
     * every moment will grant it. The plain fallback can refuse as well: a
     * window that is not the focused one answers "the root document of this
     * element is not valid for pointer lock", and that came out as an
     * unhandled rejection in the console while the room itself was perfectly
     * fine. Not being handed the mouse is a thing that happens. It is not an
     * error, and the next click asks again.
     */
    const plain = () => {
      try {
        const again = element.requestPointerLock()
        if (again?.catch) again.catch(() => {})
      } catch {
        /* asked, refused, no harm done */
      }
    }
    try {
      const request = element.requestPointerLock({ unadjustedMovement: true })
      if (request?.catch) request.catch(plain)
    } catch {
      plain()
    }
  }

  unlock() {
    if (this.touchOnly) {
      this.setLocked(false)
      return
    }
    document.exitPointerLock?.()
  }

  get isLocked() {
    return this._locked
  }

  /* ---------------------------------------------------------------------- */
  /* events                                                                  */
  /* ---------------------------------------------------------------------- */

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(fn)
    return () => this.listeners.get(type)?.delete(fn)
  }

  emit(type, payload) {
    for (const fn of this.listeners.get(type) ?? []) {
      try {
        fn(payload)
      } catch (err) {
        console.error(`[player] "${type}" listener failed`, err)
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* the jump                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Leave the floor. One jump per landing: nothing here starts a second arc
   * while the first one is still in the air.
   *
   * @returns {boolean} whether the body actually left the ground
   */
  jump() {
    if (this.airborne || this.seat) return false
    // The same test as walking: while a fixed shot or the framed screen owns
    // the camera the body stays exactly where the viewer left it.
    if (!this.isLocked || this.overview || this._cinematic) return false
    this.airborne = true
    this.groundY = this.feet.y
    this.verticalVelocity = this.config.jumpSpeed
    this.emit('jump', { from: this.feet.y })
    return true
  }

  /** Put the body down somewhere legal, in one piece. Used when a room changes. */
  teleport(spot = {}) {
    const x = Number.isFinite(spot.x) ? spot.x : this.feet.x
    const z = Number.isFinite(spot.z) ? spot.z : this.feet.z
    const y = this.collider.floorAt(x, z)
    this.feet.set(x, y, z)
    this.groundY = y
    this.airborne = false
    this.verticalVelocity = 0
    this.velocity.set(0, 0, 0)
    this.standReturn = { x, z }
    if (Number.isFinite(spot.yaw)) this.yaw = spot.yaw
    if (Number.isFinite(spot.pitch)) this.pitch = spot.pitch
    // Walking distance drives the footsteps, so it must not jump across a world.
    this.walked = 0
    this.lastStepDistance = 0
    this.bob = 0
    this.publish()
    return this.feet
  }

  /* ---------------------------------------------------------------------- */
  /* seat                                                                    */
  /* ---------------------------------------------------------------------- */

  get isSeated() {
    return this.seat !== null
  }

  /**
   * @param {object} seat a seat record from scene/seats.js or from a venue.
   *   `lookAt` (the screen of the room the seat is in) and `standSpot` are
   *   optional: without them this is the hall, and the hall's screen and aisles
   *   are the answer.
   */
  sitOn(seat) {
    if (!seat) return
    this.standReturn = this.findStandSpot(seat)
    this.seat = seat
    const look = seat.lookAt ?? SCREEN_CENTER
    this.seatYaw = yawTowards(seat.eyePosition, look)
    this.seatPitch = pitchTowards(seat.eyePosition, look)
    this.velocity.set(0, 0, 0)
    this.airborne = false
    this.verticalVelocity = 0
  }

  standUp() {
    if (!this.seat) return
    const spot = this.standReturn
    this.feet.set(spot.x, this.collider.floorAt(spot.x, spot.z), spot.z)
    this.groundY = this.feet.y
    this.airborne = false
    this.verticalVelocity = 0
    this.seat = null
    this.velocity.set(0, 0, 0)
  }

  /**
   * A free spot to stand on when leaving a seat: whatever the seat itself says
   * (a sofa knows where its own floor is), then the aisles of the hall, then
   * wherever the player was standing before they sat down. The last resort is
   * pushed out of the furniture by the collider, so this always answers.
   */
  findStandSpot(seat) {
    const z = seat.position.z
    const feetY = seat.position.y
    const side = seat.position.x > 0 ? 1 : -1
    const candidates = []
    if (seat.standSpot) candidates.push({ x: seat.standSpot.x, z: seat.standSpot.z })
    candidates.push(
      { x: side * 0.75, z }, // centre aisle
      { x: side * SIDE_AISLE_X, z }, // side aisle
      { x: this.feet.x, z: this.feet.z }, // where we came from
    )
    for (const spot of candidates) {
      if (this.collider.isFree(spot.x, spot.z, feetY)) return spot
    }
    const fallback = { x: seat.position.x, z: seat.position.z + this.config.standOffset }
    this.collider.resolve(fallback, feetY)
    return fallback
  }

  /* ---------------------------------------------------------------------- */
  /* views                                                                   */
  /* ---------------------------------------------------------------------- */

  /** Id of the view the camera is on. */
  get view() {
    return this._viewId
  }

  /** Greek name of the current view, for the HUD and the menu. */
  get viewLabel() {
    return getView(this._viewId)?.label ?? ''
  }

  /** Every view of the place you are in, in the order V walks through them. */
  get views() {
    return activeViews()
  }

  /**
   * The camera has nowhere to fly back to any more: called when the whole set
   * of shots is swapped for another room's, so that the next fixed view starts
   * where it belongs instead of travelling out of a shot in a different world.
   */
  resetViews() {
    const changed = this._viewId !== FIRST_PERSON || this._cinematic
    this._viewId = FIRST_PERSON
    this._shotId = null
    this.viewBlend = 0
    this._shotBlend = 1
    this._shotSnap = true
    this.setCinematic(false, { silent: true })
    // Walking from one room to another in first person is not a change of view,
    // and it must not put a caption on screen every time you use a door.
    if (changed) this._emitView()
  }

  /** True whenever the camera has left the player's own eyes. */
  get overview() {
    return this._viewId !== FIRST_PERSON
  }

  /** Old name of `viewBlend`, kept so nothing outside has to change at once. */
  get overviewBlend() {
    return this.viewBlend
  }

  /**
   * Move the camera to a named view. Blended, never cut.
   * @param {string} id one of the ids in `views.js`
   * @returns {boolean} false for an unknown id or for the view we are already on
   */
  setView(id) {
    const entry = getView(id)
    if (!entry) return false
    const cinematicWasOn = this._cinematic
    if (entry.id === this._viewId && !cinematicWasOn) return false

    if (cinematicWasOn) this.setCinematic(false, { silent: true })

    if (entry.id !== this._viewId) {
      this._viewId = entry.id
      if (entry.id !== FIRST_PERSON) {
        // Coming from the player's own eyes there is nothing on screen to
        // travel from, so the shot starts where it belongs and only `viewBlend`
        // moves. Coming from another shot, the camera flies across the hall.
        if (this.viewBlend <= 0.02) this._shotSnap = true
        else this._beginShotTravel()
        this._shotId = entry.id
      }
    }

    this._emitView()
    return true
  }

  nextView() {
    return this.setView(nextViewId(this._viewId, 1))
  }

  previousView() {
    return this.setView(nextViewId(this._viewId, -1))
  }

  /** Freeze where the fixed camera is now and ease from there to the new shot. */
  _beginShotTravel() {
    this._shotFrom.position.copy(this._shot.position)
    this._shotFrom.quaternion.copy(this._shot.quaternion)
    this._shotBlend = 0
    this._shotSnap = false
  }

  /**
   * The old single wide shot: out to the panorama and back again. The room
   * menu still calls this through `player.toggleView`.
   */
  toggleOverview() {
    return this.setView(this._viewId === FIRST_PERSON ? 'wide' : FIRST_PERSON)
  }

  /* ---------------------------------------------------------------------- */
  /* cinematic frame                                                         */
  /* ---------------------------------------------------------------------- */

  get cinematic() {
    return this._cinematic
  }

  /**
   * Lean into the film: the camera slides onto the axis of the screen, or of
   * the television of the room you are in, and frames the picture so it fills
   * the view. A click in the room, or any key, leaves it and blends back to
   * wherever the viewer was. Moving the mouse does not: looking around while the
   * picture is up is the point of it.
   *
   * @param {boolean} on
   * @param {{width?:number, ratio?:string, silent?:boolean}} [options] the
   *   picture being framed, if the masking has narrowed it
   */
  setCinematic(on, options = {}) {
    if (options.width !== undefined || options.ratio !== undefined) {
      this._cinematicWidth = Number(options.width) || 0
      this._cinematicRatio = typeof options.ratio === 'string' ? options.ratio : undefined
    }

    const next = !!on
    if (next === this._cinematic) return false
    this._cinematic = next
    if (next) {
      this._cinematicAt = performance.now()
      // However the frame was entered, the lens is now "all the way in", so
      // that rolling the wheel back is what lets go of it.
      this.zoomTarget = 1
    } else if (this.zoomTarget > ZOOM_LEAVE) {
      // Left by a click or a key rather than by unwinding the wheel: put the
      // lens back to the room, or the next scroll would drop straight back in.
      this.zoomTarget = 0
    }
    if (!options.silent) this._emitView()
    return true
  }

  toggleCinematic() {
    return this.setCinematic(!this._cinematic)
  }

  _emitView() {
    const entry = getView(this._viewId)
    this.emit('view', {
      id: this._viewId,
      label: entry?.label ?? '',
      hint: entry?.hint ?? '',
      cinematic: this._cinematic,
      /** Old name: true whenever the camera is not on the player's eyes. */
      overview: this._viewId !== FIRST_PERSON,
    })
  }

  /* ---------------------------------------------------------------------- */
  /* frame                                                                   */
  /* ---------------------------------------------------------------------- */

  update(delta) {
    const cfg = this.config
    const dt = Math.min(Math.max(delta || 0, 0), cfg.maxDeltaTime)
    if (dt <= 0) return
    this.elapsed += dt

    if (this.seat) this._updateSeated(dt)
    else this._updateWalking(dt)

    this._updateView(dt)
    this._updateCinematic(dt)
    this._updateZoom(dt)
    this._applyLook()
    this.publish()
  }

  /**
   * Ease the lens towards the wheel, and hand it over while the frame is up.
   *
   * The framed shot already fills the view by moving the camera, so a narrowed
   * lens on top of it would fight the framing and change what "fills" means.
   * The zoom therefore fades out as the frame fades in, and comes back on the
   * way out, which is what makes the whole gesture feel like one movement.
   */
  _updateZoom(dt) {
    const camera = this.camera
    if (!camera?.isPerspectiveCamera) return

    this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.exp(-dt / ZOOM_TAU))
    if (Math.abs(this.zoomTarget - this.zoom) < 0.0005) this.zoom = this.zoomTarget

    const applied = this.zoom * (1 - this.cinematicBlend)
    const fov = this.baseFov * (1 - applied * (1 - ZOOM_MIN_FOV))
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
  }

  /** Put the lens back where it started, without touching the camera mode. */
  resetZoom() {
    this.zoomTarget = 0
  }

  _updateWalking(dt) {
    const cfg = this.config

    if (this.seatBlend > 0) {
      this.seatBlend = Math.max(0, this.seatBlend - dt * cfg.seatBlendSpeed)
    }

    let ahead = 0
    let side = 0
    // Whenever the camera is somewhere else, the keys must not walk the body
    // away underneath it: coming back would land the viewer in another room.
    const canWalk = this.isLocked && !this.overview && !this._cinematic
    if (canWalk) {
      if (this._down('forward')) ahead += 1
      if (this._down('backward')) ahead -= 1
      if (this._down('right')) side += 1
      if (this._down('left')) side -= 1
      // The stick adds to the keys rather than replacing them: a tablet with a
      // keyboard attached is a real thing and neither should win.
      ahead += this.touchAhead || 0
      side += this.touchSide || 0
    }

    const sin = Math.sin(this.yaw)
    const cos = Math.cos(this.yaw)
    let wishX = -sin * ahead + cos * side
    let wishZ = -cos * ahead - sin * side
    const wishLength = Math.hypot(wishX, wishZ)
    if (wishLength > 0) {
      wishX /= wishLength
      wishZ /= wishLength
    }

    const speed = this._down('run') ? cfg.runSpeed : cfg.walkSpeed
    const rate = (wishLength > 0 ? cfg.acceleration : cfg.damping) *
      (this.airborne ? cfg.airControl : 1)
    const blend = Math.min(1, rate * dt)
    this.velocity.x += (wishX * speed - this.velocity.x) * blend
    this.velocity.z += (wishZ * speed - this.velocity.z) * blend
    if (Math.abs(this.velocity.x) < 0.002) this.velocity.x = 0
    if (Math.abs(this.velocity.z) < 0.002) this.velocity.z = 0

    const before = { x: this.feet.x, z: this.feet.z }
    const next = { x: this.feet.x + this.velocity.x * dt, z: this.feet.z + this.velocity.z * dt }
    // In the air the body is still the size it was on the floor: resolving at
    // the height of the ground it left is what keeps a jump from clearing the
    // seat backs, the sofas or the walls.
    this.collider.resolve(next, this.airborne ? this.groundY : this.feet.y)
    this.feet.x = next.x
    this.feet.z = next.z

    const floorY = this.collider.floorAt(this.feet.x, this.feet.z)
    if (this.airborne) {
      this._air.y = this.feet.y
      this._air.vy = this.verticalVelocity
      const landed = stepAir(this._air, dt, floorY, cfg.gravity)
      this.feet.y = this._air.y
      this.verticalVelocity = this._air.vy
      if (landed) {
        this.airborne = false
        this.groundY = floorY
        // The sound module turns a step into a footfall, which is exactly what
        // landing sounds like, and it rate limits them for us.
        this.stepFoot = this.stepFoot === 'left' ? 'right' : 'left'
        this.lastStepDistance = this.walked
        this.emit('step', { foot: this.stepFoot, running: false, landing: true })
        this.emit('land', { at: floorY })
      }
    } else {
      // Follow the risers smoothly instead of snapping up a step.
      this.feet.y += (floorY - this.feet.y) * Math.min(1, cfg.floorFollow * dt)
      if (Math.abs(floorY - this.feet.y) < 0.001) this.feet.y = floorY
      this.groundY = floorY
    }

    // Step bob, driven by the distance actually covered.
    const stepped = Math.hypot(this.feet.x - before.x, this.feet.z - before.z)
    this.walked += stepped
    const pace = this.airborne || dt <= 0 ? 0 : Math.min(1, stepped / dt / cfg.walkSpeed)
    const targetBob = Math.sin(this.walked * cfg.bobFrequency * TWO_PI) * cfg.bobAmplitude * pace
    this.bob += (targetBob - this.bob) * Math.min(1, 12 * dt)

    const wasMoving = this.moving
    this.moving = stepped / Math.max(dt, 1e-4) > 0.25
    this._emitSteps(wasMoving)

    this.pitch = clamp(this.pitch, cfg.minPitch, cfg.maxPitch)
  }

  /**
   * Footsteps come off the distance actually covered, not off a timer, so they
   * stay in step with the walk however fast the frames arrive and stop dead
   * when a wall does. The sound module listens for these.
   */
  _emitSteps(wasMoving) {
    // Nothing walks in mid air; the landing has a footfall of its own.
    if (this.airborne) {
      this.lastStepDistance = this.walked
      return
    }
    if (!this.moving) {
      if (wasMoving) this.lastStepDistance = this.walked
      return
    }
    const running = this._down('run')
    const stride = running ? this.config.runStride : this.config.walkStride
    // Leaving standstill: put the first foot down straight away.
    if (!wasMoving) this.lastStepDistance = this.walked - stride

    if (this.walked - this.lastStepDistance < stride) return
    this.lastStepDistance = this.walked
    this.stepFoot = this.stepFoot === 'left' ? 'right' : 'left'
    this.emit('step', { foot: this.stepFoot, running })
  }

  _updateSeated(dt) {
    const cfg = this.config
    this.moving = false
    this.bob += (0 - this.bob) * Math.min(1, 8 * dt)
    this.seatBlend = Math.min(1, this.seatBlend + dt * cfg.seatBlendSpeed)

    // While settling in, turn towards the screen; after that look around freely
    // but never all the way round.
    const settling = Math.min(1, dt * cfg.seatBlendSpeed * 1.6)
    let yawOffset = wrapAngle(this.yaw - this.seatYaw)
    let pitchOffset = this.pitch - this.seatPitch
    if (this.seatBlend < 0.999) {
      yawOffset *= 1 - settling
      pitchOffset *= 1 - settling
    }
    this.yaw = this.seatYaw + clamp(yawOffset, -cfg.seatYawLimit, cfg.seatYawLimit)
    this.pitch = clamp(this.seatPitch + pitchOffset, cfg.minPitch, cfg.maxPitch)
  }

  /**
   * The fixed views: how much of the shot is on screen, and where that shot is.
   *
   * The shot is rebuilt every frame rather than once on the way in, because it
   * breathes: the slow sideways drift is what keeps a held camera from reading
   * as a photograph.
   */
  _updateView(dt) {
    const cfg = this.config

    const target = this.overview ? 1 : 0
    if (this.viewBlend !== target) {
      const step = dt * cfg.overviewBlendSpeed
      this.viewBlend =
        target > this.viewBlend
          ? Math.min(1, this.viewBlend + step)
          : Math.max(0, this.viewBlend - step)
    }

    // `_shotId` outlives the view itself so that going back to first person has
    // something to blend out of.
    if (!this._shotId) return
    if (!computeShot(this._shotId, _shotEye, _shotQuat, {
      elapsed: this.elapsed,
      drift: cfg.overviewDrift,
      config: cfg,
    })) {
      return
    }

    if (this._shotSnap) {
      this._shotSnap = false
      this._shotBlend = 1
      this._shotFrom.position.copy(_shotEye)
      this._shotFrom.quaternion.copy(_shotQuat)
    }

    if (this._shotBlend < 1) {
      this._shotBlend = Math.min(1, this._shotBlend + dt * cfg.viewTravelSpeed)
    }

    const t = smoothstep(this._shotBlend)
    this._shot.position.copy(this._shotFrom.position).lerp(_shotEye, t)
    this._shot.quaternion.copy(this._shotFrom.quaternion).slerp(_shotQuat, t)
  }

  /**
   * The cinematic frame. Also rebuilt every frame, which is what makes it
   * survive a resize or a change of screen ratio while it is on screen.
   */
  _updateCinematic(dt) {
    const cfg = this.config

    const target = this._cinematic ? 1 : 0
    if (this.cinematicBlend !== target) {
      const step = dt * cfg.cinematicBlendSpeed
      this.cinematicBlend =
        target > this.cinematicBlend
          ? Math.min(1, this.cinematicBlend + step)
          : Math.max(0, this.cinematicBlend - step)
    }

    if (this.cinematicBlend <= 0) return
    computeCinematicShot(this._cine.position, this._cine.quaternion, {
      fov: this.camera.fov,
      aspect: this.camera.aspect,
      fill: cfg.cinematicFill,
      width: this._cinematicWidth,
      ratio: this._cinematicRatio,
    })
  }

  /** Builds the final camera transform: walk / seat, then view, then frame. */
  _applyLook() {
    const cfg = this.config

    _standEye.set(this.feet.x, this.feet.y + cfg.eyeHeight + this.bob, this.feet.z)

    if (this.seat) this._lastSeat = this.seat
    const seat = this.seat ?? this._lastSeat
    if (this.seatBlend > 0 && seat) {
      _seatEye.set(seat.eyePosition.x, seat.eyePosition.y, seat.eyePosition.z)
      _playEye.copy(_standEye).lerp(_seatEye, smoothstep(this.seatBlend))
    } else {
      _playEye.copy(_standEye)
    }

    _euler.set(clamp(this.pitch, cfg.minPitch, cfg.maxPitch), this.yaw, 0, 'YXZ')
    _quatPlay.setFromEuler(_euler)

    // The head is the player, always, whatever the camera is doing. Everything
    // that should stay with the body (the audio listener above all) reads this.
    this.head.position.copy(_playEye)
    this.head.quaternion.copy(_quatPlay)

    _camEye.copy(_playEye)
    _camQuat.copy(_quatPlay)

    if (this.viewBlend > 0 && this._shotId) {
      const t = smoothstep(this.viewBlend)
      _camEye.lerp(this._shot.position, t)
      _camQuat.slerp(this._shot.quaternion, t)
    }

    if (this.cinematicBlend > 0) {
      const t = smoothstep(this.cinematicBlend)
      _camEye.lerp(this._cine.position, t)
      _camQuat.slerp(this._cine.quaternion, t)
    }

    this.camera.position.copy(_camEye)
    this.camera.quaternion.copy(_camQuat)
  }

  /**
   * Hand the transform to state.js for the audio and networking modules.
   *
   * This publishes the player's head and not the camera on purpose: in a fixed
   * view or in the cinematic frame the camera is off flying around the hall,
   * and a listener that followed it would swing the whole soundtrack with it.
   * The ears stay on the body.
   */
  publish() {
    const head = this.head
    _forward.set(0, 0, -1).applyQuaternion(head.quaternion)
    _up.set(0, 1, 0).applyQuaternion(head.quaternion)
    _euler.setFromQuaternion(head.quaternion, 'YXZ')

    updatePlayerTransform({
      position: head.position,
      rotation: { x: _euler.x, y: _euler.y, z: _euler.z },
      quaternion: head.quaternion,
      forward: _forward,
      up: _up,
      moving: this.moving,
    })
  }

  dispose() {
    document.removeEventListener('keydown', this._onKeyDown)
    document.removeEventListener('keyup', this._onKeyUp)
    window.removeEventListener('blur', this._onBlur)
    document.removeEventListener('mousemove', this._onMouseMove)
    document.removeEventListener('mousedown', this._onMouseDown)
    document.removeEventListener('wheel', this._onWheel)
    document.removeEventListener('pointerlockchange', this._onPointerLockChange)
    document.removeEventListener('pointerlockerror', this._onPointerLockError)
    if (this._locked) this.unlock()
    this.listeners.clear()
    this.keys.clear()
  }
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value
}

/** Wrap an angle into [-PI, PI]. */
function wrapAngle(angle) {
  let a = (angle + Math.PI) % TWO_PI
  if (a < 0) a += TWO_PI
  return a - Math.PI
}

function smoothstep(t) {
  return t * t * (3 - 2 * t)
}

export default PlayerControls

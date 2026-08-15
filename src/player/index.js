/**
 * Player module: you, inside the cinema.
 *
 * `main.js` boots the scene first and then calls:
 *
 *   const player = await createPlayer({ renderer, scene, camera, container, seats })
 *   player.update(delta)   // once per frame
 *
 * Controls
 *   click ............ lock the pointer and enter the room (Esc leaves)
 *   mouse ............ look around, 85 degrees up and down
 *   W A S D / arrows . walk, Shift runs
 *   Space ............ jump, one per landing
 *   E ................ sit on the nearest free seat, E again to stand up
 *   V ................ next camera view in this room, Shift+V the previous one
 *   C ................ cinematic frame: the picture fills the view
 *
 * The hall is not the only room. `setPlace()` swaps the seats, the fixed views
 * and the screen that C frames for another place (see src/venues/), and
 * `setPlace(null)` puts the auditorium back exactly as it was.
 *
 * Audio and networking do not talk to this file: they read `./state.js`, which
 * carries the player's position, orientation and seat as plain numbers. Note
 * that this stays the player's own head even while the camera is off in a fixed
 * view, so the sound never wanders off with the shot.
 */

import { PlayerControls } from './controls.js'
import { PlayerCollider } from './collision.js'
import { SeatManager } from './seating.js'
import { PlayerHud } from './hud.js'
import { PLAYER_CONFIG } from './config.js'
import { FIRST_PERSON, activeViews, makePlace, setActivePlace } from './views.js'
import { getPlayerHead, getPlayerState, setPlayerSeat } from './state.js'
import { t } from '../i18n/index.js'

/** How often we look for a seat within reach (seconds). */
const TARGET_INTERVAL = 1 / 12

/**
 * @param {object} [context] the handle main.js built from the scene module
 * @param {import('three').PerspectiveCamera} context.camera
 * @param {import('three').WebGLRenderer} [context.renderer]
 * @param {HTMLElement} [context.container]
 * @param {object|Array} [context.seats] the seats handle or the plain seat array
 * @param {object} [context.config] PLAYER_CONFIG overrides
 * @param {boolean} [context.hud] set false to skip the crosshair and caption
 */
export function createPlayer(context = {}) {
  const camera = context.camera
  if (!camera) {
    console.warn('[player] no camera in the context, the player is disabled')
    return { update() {} }
  }

  const config = { ...PLAYER_CONFIG, ...(context.config ?? {}) }
  const container = context.container ?? document.getElementById('app') ?? document.body
  const domElement = context.renderer?.domElement ?? container

  const collider = new PlayerCollider({
    radius: config.radius,
    stepHeight: config.stepHeight,
  })

  const controls = new PlayerControls({
    camera,
    domElement,
    collider,
    config,
    spawn: context.spawn ?? { x: 0, z: 12.4 },
  })

  const seatManager = new SeatManager({
    seats: context.seats ?? context.seatData ?? context.SEATS,
    objects: context.seats?.objects,
    config,
  })

  const hud = context.hud === false ? null : new PlayerHud({ container })

  let targetTimer = 0
  let candidate = null
  let disposed = false

  /* ---------------------------------------------------------------------- */
  /* sit / stand                                                             */
  /* ---------------------------------------------------------------------- */

  /** What a seat is called out loud: a sofa has a name, a seat has a number. */
  const seatName = (seat) => seat?.label ?? `${t('hud.seat')} ${seat?.id ?? ''}`.trim()

  function sit(seatId) {
    if (controls.isSeated) return false
    const id = seatId ?? candidate?.id
    if (!id) {
      hud?.toast(t('hud.noSeat'))
      return false
    }
    const result = seatManager.claim(id)
    if (!result.ok) {
      hud?.toast(t('hud.seatTaken'))
      return false
    }
    controls.sitOn(result.seat)
    hud?.setTargeting(false)
    hud?.toast(`${t('hud.satDown')}: ${seatName(result.seat)} · E`)
    // The sound module turns this into a folding seat.
    controls.emit('sit', { seat: result.seat })
    candidate = null
    return true
  }

  function stand() {
    if (!controls.isSeated) return false
    const seat = seatManager.release()
    controls.standUp()
    hud?.toast(t('hud.stoodUp') + (seat ? `: ${seatName(seat)}` : ''))
    controls.emit('stand', { seat })
    return true
  }

  function toggleSeat() {
    return controls.isSeated ? stand() : sit()
  }

  /* ---------------------------------------------------------------------- */
  /* which place we are in                                                   */
  /* ---------------------------------------------------------------------- */

  /**
   * Hand the player to another room, or back to the hall with null.
   *
   * One call swaps the three things that are about the room and not about the
   * player: the seats E offers, the shots V walks through and the screen C
   * frames. Everything else (the body, the collider, the sound) is untouched.
   *
   * @param {{
   *   id?: string,
   *   seats?: Array, seatReach?: number,
   *   views?: Array<{id:string,label:string,hint?:string,eye:object,target:object,drift?:number}>,
   *   screen?: {center:object, width:number, height:number, maxBack?:number},
   * }|null} place
   */
  function setPlace(place) {
    if (controls.isSeated) stand()
    setActivePlace(place ? makePlace(place) : null)
    seatManager.setSeats(place?.seats ?? null, { reach: place?.seatReach })
    candidate = null
    hud?.setTargeting(false)
    // The shots of the room we just left are 60 metres away; nothing may blend
    // out of them.
    controls.resetViews()
    return place?.id ?? 'cinema'
  }

  /* ---------------------------------------------------------------------- */
  /* wiring                                                                  */
  /* ---------------------------------------------------------------------- */

  const offSeat = controls.on('toggle-seat', toggleSeat)
  const offView = controls.on('view', ({ id, label, cinematic }) => {
    const fixed = id !== FIRST_PERSON
    hud?.setOverview(fixed)
    hud?.setCinematic(cinematic)
    if (cinematic) hud?.toast(t('hud.cinematic'))
    else if (fixed) hud?.toast(`${label} · ${t('hud.nextView')}`)
    else hud?.toast(t('hud.firstPerson'))
  })
  const offLock = controls.on('lock', () => hud?.setLocked(true))
  const offUnlock = controls.on('unlock', () => hud?.setLocked(false))
  const offCross = controls.on('crosshair', () => {
    if (!hud) return
    const on = hud.setCrosshair(!hud.crosshairVisible)
    hud.toast(on ? t('flash.crosshairOn') : t('flash.crosshairOff'))
  })

  const onClick = () => {
    if (disposed || controls.isLocked) return
    controls.lock()
  }
  domElement.addEventListener('click', onClick)

  /* ---------------------------------------------------------------------- */
  /* frame                                                                   */
  /* ---------------------------------------------------------------------- */

  function update(delta) {
    if (disposed) return
    controls.update(delta)

    targetTimer += delta
    if (targetTimer < TARGET_INTERVAL) return
    targetTimer = 0

    if (controls.isSeated || controls.overview || controls.cinematic) {
      if (candidate) {
        candidate = null
        hud?.setTargeting(false)
      }
      return
    }

    const next = seatManager.nearestFree(controls.feet)
    if (next?.id !== candidate?.id) {
      candidate = next
      hud?.setTargeting(!!next)
    }
  }

  function dispose() {
    disposed = true
    domElement.removeEventListener('click', onClick)
    offSeat()
    offView()
    offLock()
    offUnlock()
    offCross()
    seatManager.dispose()
    controls.dispose()
    hud?.dispose()
    setPlayerSeat(null)
  }

  return {
    // what main.js uses
    update,
    dispose,

    // what the other modules may want
    controls,
    collider,
    seatManager,
    config,

    sit,
    stand,
    toggleSeat,
    jump: () => controls.jump(),
    setPlace,
    lock: () => controls.lock(),
    unlock: () => controls.unlock(),

    /**
     * The camera views of the room you are standing in, for the menu and the
     * room panel. `list` is plain data ({ id, label, hint }), safe to render
     * straight, and it changes when you walk into another place.
     */
    views: {
      get list() {
        return activeViews().map((entry) => ({ ...entry }))
      },
      set: (id) => controls.setView(id),
      next: () => controls.nextView(),
      previous: () => controls.previousView(),
      get current() {
        return controls.view
      },
    },

    /** Frame the screen so the picture fills the view. */
    setCinematic: (on, options) => controls.setCinematic(on, options),

    /** The wheel's lens, 0 = the room's own field of view, 1 = as tight as it goes. */
    get zoom() {
      return controls.zoom
    },
    setZoom(value) {
      controls.zoomTarget = Math.min(Math.max(Number(value) || 0, 0), 1)
      return controls.zoomTarget
    },
    resetZoom: () => controls.resetZoom(),
    toggleCinematic: () => controls.toggleCinematic(),

    /** The old single wide shot, still wired to the right click menu. */
    toggleView: () => controls.toggleOverview(),

    get seat() {
      return seatManager.current
    },
    get seatId() {
      return seatManager.currentId
    },
    get isSeated() {
      return controls.isSeated
    },
    get isLocked() {
      return controls.isLocked
    },
    get isOverview() {
      return controls.overview
    },
    get isCinematic() {
      return controls.cinematic
    },
    /** True between leaving the floor and touching down again. */
    get isAirborne() {
      return controls.airborne
    },
    /** Id of the view the camera is on, one of `views.list`. */
    get view() {
      return controls.view
    },
    get viewLabel() {
      return controls.viewLabel
    },

    /** Networking: the seats other people are on. */
    setOccupiedSeats: (ids) => seatManager.setOccupied(ids),

    /** Audio: where the head is and where it looks. */
    getPlayerHead,
    getState: getPlayerState,
  }
}

export { getPlayerHead, getPlayerState }
export { VIEWS, FIRST_PERSON } from './views.js'
export {
  getPlayerPosition,
  getPlayerRotation,
  getPlayerSeatId,
  isPlayerSeated,
  subscribePlayerState,
  subscribePlayerSeat,
} from './state.js'
export { PlayerControls, PlayerCollider, SeatManager, PlayerHud, PLAYER_CONFIG }

export default createPlayer

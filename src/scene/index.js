/**
 * Scene module - the static 3D cinema.
 *
 * This is the entry point `src/main.js` boots first. It creates the renderer,
 * the scene and a camera, assembles the hall (`cinema.js`), the seating
 * (`seats.js`) and the lighting rig (`lighting.js`), and hands everything back
 * so the other modules can build on top of it.
 *
 *   const { renderer, scene, camera, seats, screen } = await createScene({ container })
 *
 * On purpose, this module does NOT: move the camera, play video, produce sound
 * or talk to a server. It only renders a room that is ready for all of that.
 *
 * What the other modules get from the returned handle:
 *   renderer, scene, camera ... the Three.js basics
 *   seats                   ... seat data + meshes (see seats.js)
 *   seatData / SEATS        ... the plain seat array, no Three.js needed
 *   screen, screenMaterial  ... the projection surface
 *   cinema, lighting        ... the room and the light rig handles
 *   render(camera), postfx  ... draw a frame, with the bloom on top
 */

import * as THREE from 'three'
import { createCinema } from './cinema.js'
import { createSeats, SEATS, getSeatById, getSeatsByRow, getNearestSeat, SEAT_LAYOUT } from './seats.js'
import { createLighting } from './lighting.js'
import { createPostFx, BLOOM_FIELDS } from './postfx.js'
import { ROOM, SCREEN, SCREEN_CENTER, SEATING, PALETTE } from './constants.js'

export * from './constants.js'
export { SEATS, getSeatById, getSeatsByRow, getNearestSeat, SEAT_LAYOUT }
export { createCinema } from './cinema.js'
export { createSeats } from './seats.js'
export { createLighting } from './lighting.js'
export { createPostFx, BLOOM_FIELDS } from './postfx.js'

/** Static establishing shot from the back of the hall. */
const DEFAULT_CAMERA = {
  position: { x: 0, y: 6.4, z: 15.2 },
  lookAt: { x: 0, y: 4.4, z: -9 },
  fov: 52,
}

function sizeOf(container) {
  const width = container?.clientWidth || window.innerWidth
  const height = container?.clientHeight || window.innerHeight
  return { width, height }
}

/**
 * @param {{ container?: HTMLElement, dust?: boolean, beam?: boolean, shadows?: boolean }} [options]
 */
export function createScene(options = {}) {
  const {
    container = document.getElementById('app') ?? document.body,
    dust = true,
    beam = true,
    shadows = true,
  } = options

  const { width, height } = sizeOf(container)

  // --- renderer ----------------------------------------------------------
  // alpha: true is what lets an embedded YouTube player show through the
  // screen. The room paints an opaque background over the whole canvas anyway,
  // so nothing else changes - see media/embedScreen.js.
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(width, height)
  // Film response rather than raw pixels: ACES rolls the bright screen off
  // gently instead of clipping it, and keeps the deep shadows from going muddy.
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  renderer.shadowMap.enabled = shadows
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  // Nothing in this hall ever moves and the one shadow casting light is bolted
  // to the screen, so the shadow map is drawn once instead of every frame.
  // That is a whole extra pass over 150 seats saved, every frame, forever.
  renderer.shadowMap.autoUpdate = false
  renderer.shadowMap.needsUpdate = shadows
  container.appendChild(renderer.domElement)

  // --- scene -------------------------------------------------------------
  const scene = new THREE.Scene()
  scene.name = 'VirtualCinema'
  scene.background = new THREE.Color(PALETTE.fog)
  // Dense enough that the back of the hall dissolves into black instead of
  // every wall reading at the same flat brightness.
  scene.fog = new THREE.FogExp2(PALETTE.fog, 0.026)

  // --- camera ------------------------------------------------------------
  const camera = new THREE.PerspectiveCamera(DEFAULT_CAMERA.fov, width / height, 0.1, 200)
  camera.position.set(DEFAULT_CAMERA.position.x, DEFAULT_CAMERA.position.y, DEFAULT_CAMERA.position.z)
  camera.lookAt(DEFAULT_CAMERA.lookAt.x, DEFAULT_CAMERA.lookAt.y, DEFAULT_CAMERA.lookAt.z)
  camera.name = 'MainCamera'

  // --- contents ----------------------------------------------------------
  const cinema = createCinema({ dust, beam, screenRatio: options.screenRatio })
  const seats = createSeats()
  const lighting = createLighting({ shadows })

  scene.add(cinema.group)
  scene.add(seats.group)
  scene.add(lighting.group)

  // --- the glow ----------------------------------------------------------
  // Post processing sits between the hall and the canvas, so it is built last.
  // `bypassPostFx` is how whoever owns the film says "not this frame": an
  // embedded YouTube player shows through a transparent hole in the canvas and
  // the composer would paint over it. This module cannot see the media module,
  // so the answer arrives as a predicate, either here or later through
  // `setPostFxBypass()`. See postfx.js.
  const postfx = createPostFx({
    renderer,
    scene,
    camera,
    container,
    bloom: options.bloom,
    bypass: options.bypassPostFx,
  })

  let elapsed = 0

  function update(delta = 0) {
    elapsed += delta
    cinema.update(delta)
    lighting.update(elapsed, delta)
    // The rig has just eased its reading of the frame; hand the same colour to
    // the pool of light on the carpet so the two never disagree.
    cinema.setScreenSpill(lighting.getScreenLight(), lighting.getSettings().screenGain)
  }

  /**
   * Draw one frame. main.js calls this instead of renderer.render() so the
   * bloom is in the picture, and it falls back to the plain render on its own
   * whenever the composer has to stand aside.
   * @param {import('three').Camera} [activeCamera]
   */
  function render(activeCamera = camera) {
    postfx.render(activeCamera)
  }

  function resize() {
    const size = sizeOf(container)
    camera.aspect = size.width / size.height
    camera.updateProjectionMatrix()
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(size.width, size.height)
    postfx.resize()
  }

  function dispose() {
    postfx.dispose()
    cinema.dispose()
    seats.dispose()
    lighting.dispose()
    renderer.dispose()
    renderer.domElement.remove()
  }

  return {
    renderer,
    scene,
    camera,
    container,

    // the hall
    cinema,
    /**
     * The light rig. The media module drives the room from the film with
     * `lighting.setScreenLight(color, intensity)` - see lighting.js.
     */
    lighting,
    /** Shortcut to the same call, for anyone who only needs this one thing. */
    setScreenLight: lighting.setScreenLight,
    setHouseLights: lighting.setHouseLights,
    setAisleLights: lighting.setAisleLights,
    setExitLights: lighting.setExitLights,
    room: ROOM,

    // seating
    seats,
    seatData: SEATS,
    SEATS,
    seatLayout: SEAT_LAYOUT,
    getSeatById,
    getSeatsByRow,
    getNearestSeat,

    // the projection surface
    screen: cinema.screen,
    screenMaterial: cinema.screenMaterial,
    get screenSize() {
      return cinema.screenSize
    },
    get screenRatio() {
      return cinema.screenRatio
    },
    /** Change the shape of the picture: 'scope' | 'flat' | 'hd'. */
    setScreenRatio: cinema.setScreenRatio,
    screenRatios: cinema.screenRatios,
    /** The curtains in front of the screen: 0 open, 1 closed. */
    setCurtains: cinema.setCurtains,
    get curtains() {
      return cinema.curtains
    },
    curtainFields: cinema.curtainFields,
    /** Dim the visible fittings (aisle strips, coves, exit signs). */
    setTrimBrightness: cinema.setTrimBrightness,
    screenCenter: SCREEN_CENTER,
    screenSpec: SCREEN,
    seatingSpec: SEATING,

    // the glow around the picture
    postfx,
    /** Adjust the bloom: { enabled, strength, radius, threshold }. */
    setBloom: postfx.setBloom,
    getBloom: postfx.getBloom,
    /** The dials, so a panel can build itself generically. */
    bloomFields: BLOOM_FIELDS,
    /**
     * Tell the glow when to stand aside. Pass `() => media.embed?.active`: a
     * YouTube embed needs the canvas to stay transparent where the screen is.
     */
    setPostFxBypass: postfx.setBypass,

    defaultCamera: DEFAULT_CAMERA,
    update,
    render,
    resize,
    dispose,
  }
}

export default createScene

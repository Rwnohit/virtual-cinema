/**
 * Shared dimensions of the cinema hall.
 *
 * Every module in `src/scene/` derives its geometry from these numbers, so the
 * room shell, the stepped risers and the seat coordinates always stay in sync.
 *
 * Coordinate system
 *   -Z ....... towards the screen (front of the hall)
 *   +Z ....... towards the back wall / projection booth
 *   +Y ....... up
 *   x = 0 .... centre aisle
 */

/** Inner dimensions of the hall. */
export const ROOM = Object.freeze({
  width: 28,
  depth: 36,
  height: 13,
})

/** Inner surfaces of the room, handy for bounds checks. */
export const ROOM_BOUNDS = Object.freeze({
  minX: -ROOM.width / 2,
  maxX: ROOM.width / 2,
  minZ: -ROOM.depth / 2,
  maxZ: ROOM.depth / 2,
  floorY: 0,
  ceilingY: ROOM.height,
})

/** Raised platform in front of the screen. */
export const STAGE = Object.freeze({
  width: 22,
  depth: 3.6,
  height: 0.9,
  z: -16.2, // centre
})

/**
 * Shapes the picture can take. Like a real hall, the height never changes and
 * the side masking travels in and out: scope fills the wall, flat and 16:9 sit
 * inside it with black masking on either side.
 */
export const SCREEN_RATIOS = Object.freeze({
  scope: Object.freeze({ label: 'Πανοραμική', note: '2.39:1', ratio: 2.39 }),
  flat: Object.freeze({ label: 'Σινεμά', note: '1.85:1', ratio: 1.85 }),
  hd: Object.freeze({ label: 'Τηλεόραση', note: '16:9', ratio: 16 / 9 }),
})

export const DEFAULT_SCREEN_RATIO = 'scope'

/** Picture height, shared by every ratio. */
const SCREEN_HEIGHT = 9.6

/**
 * The projection screen. `width` is the widest shape (scope) and also the size
 * of the physical surface; the narrower ratios are made by masking, not by
 * rebuilding anything.
 */
export const SCREEN = Object.freeze({
  width: Number((SCREEN_HEIGHT * SCREEN_RATIOS.scope.ratio).toFixed(3)),
  maxWidth: Number((SCREEN_HEIGHT * SCREEN_RATIOS.scope.ratio).toFixed(3)),
  height: SCREEN_HEIGHT,
  x: 0,
  y: 6.15,
  z: -17.5,
  /** Thickness of the black masking frame around the screen. */
  frame: 0.35,
})

/** Width of the picture for a given ratio, never wider than the surface. */
export function screenWidthFor(ratioName) {
  const entry = SCREEN_RATIOS[ratioName] ?? SCREEN_RATIOS[DEFAULT_SCREEN_RATIO]
  return Math.min(SCREEN.maxWidth, SCREEN.height * entry.ratio)
}

/** Centre point of the screen. Everything that should "face the movie" aims here. */
export const SCREEN_CENTER = Object.freeze({ x: SCREEN.x, y: SCREEN.y, z: SCREEN.z })

/**
 * Seating layout.
 * Two blocks of seats separated by a centre aisle, on stepped risers.
 */
export const SEATING = Object.freeze({
  rows: 8,
  /** Seats on each side of the centre aisle. */
  seatsPerBlock: 9,
  /** Distance between two rows along Z. */
  rowSpacing: 2.0,
  /** Z of the first (front) row. Far enough back for the wide screen. */
  firstRowZ: -2.8,
  /** How much each row is raised above the previous one (keeps sightlines clear). */
  rowRise: 0.42,
  /** Distance between two neighbouring seats along X. */
  seatSpacing: 1.05,
  /** Half width of the centre aisle. */
  aisleHalfWidth: 1.2,
  seatWidth: 0.88,
  seatDepth: 0.82,
  /** Height of the cushion above the row floor. */
  sitHeight: 0.5,
  /**
   * Eye height of a seated person above the row floor.
   * Together with a lower seat back this is what keeps the row in front out of
   * the bottom of the picture: the seat tops now finish well under eye level.
   */
  eyeHeight: 1.24,
  /** Top of the headrest above the row floor. Collision and QA read this. */
  seatTopHeight: 1.38,
  rowLabels: 'ABCDEFGH',
})

/** X where a seat block ends and the side aisle begins. */
export const SEAT_BLOCK_OUTER =
  SEATING.aisleHalfWidth +
  SEATING.seatWidth / 2 +
  (SEATING.seatsPerBlock - 1) * SEATING.seatSpacing +
  SEATING.seatWidth / 2

/** Middle of the side aisle, where someone leaving a seat ends up standing. */
export const SIDE_AISLE_X = Number(((SEAT_BLOCK_OUTER + ROOM.width / 2 - 0.7) / 2).toFixed(2))

/** Projection booth window on the back wall. */
export const BOOTH = Object.freeze({
  y: 9.2,
  z: ROOM_BOUNDS.maxZ - 0.2,
  windowWidth: 1.1,
  windowHeight: 0.8,
  spacing: 1.8,
})

/**
 * Colour palette of the hall.
 *
 * Tuned for a room lit almost only by the screen: the surfaces are much darker
 * than they look here, because whatever light reaches them is what gives them
 * their colour. Anything that stays visibly lit during the film (aisle strips,
 * exit signs) is listed separately at the bottom.
 */
export const PALETTE = Object.freeze({
  carpet: 0x1a0a0e,
  carpetTrim: 0x2e1118,
  wall: 0x0a0b0e,
  wallPanel: 0x0f1116,
  ceiling: 0x050609,
  stage: 0x06070a,
  upholstery: 0x5c1a21,
  upholsteryDark: 0x3a0f14,
  frame: 0x101116,
  metal: 0x2c2f36,
  curtain: 0x4a0f17,
  screen: 0x1b2130,

  // light colours
  warmLight: 0xffb877,
  coolLight: 0x9ab7ff,
  exitGreen: 0x35d17a,
  aisleLight: 0xff7a2f,

  /** Emissive strips, kept dim on purpose so they read as lamps, not as suns. */
  emissiveCove: 0x241a12,
  emissiveCeiling: 0x1d160f,
  emissiveAisle: 0xb4451a,
  emissiveExit: 0x2fbf6e,
  emissiveBooth: 0x1b2434,

  /** The dark the room fades into. */
  fog: 0x030406,
})

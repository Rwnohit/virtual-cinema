/**
 * Tunables for the first person player.
 * Distances in metres, speeds in m/s, angles in radians.
 */

/** 85 degrees up and down, as required. */
export const MAX_PITCH = (85 * Math.PI) / 180

export const PLAYER_CONFIG = {
  // Body
  eyeHeight: 1.7,
  radius: 0.34,
  /** Anything lower than this is stepped over instead of blocking. */
  stepHeight: 0.5,

  // Walking
  walkSpeed: 3.1,
  runSpeed: 5.8,
  acceleration: 13,
  damping: 12,
  /** How fast the eyes follow the floor when climbing a riser. */
  floorFollow: 14,

  // Jump (Space)
  /**
   * A hop, not a leap.
   *
   * 4.6 m/s against 22 m/s^2 is 0.48m of air for 0.42s, which is what a person
   * actually jumps. It also settles the question the room asks: the seat backs
   * finish 1.38m over their riser and the sofas 0.9m over the floor, so there is
   * nothing in either room this can climb onto. Collision while airborne is
   * resolved at the height of the ground you left, never at the height you have
   * reached, so a jump cannot post the body over a blocker either.
   */
  jumpSpeed: 4.6,
  gravity: 22,
  /**
   * How much of the walking control you keep in mid air. A jump you can steer
   * freely is a flight; this leaves just enough to aim the landing.
   */
  airControl: 0.3,

  // Step bob
  bobAmplitude: 0.045,
  bobFrequency: 1.85, // cycles per metre walked

  /** Metres between two footsteps. Longer stride when running. */
  walkStride: 0.82,
  runStride: 1.15,

  // Looking
  pointerSpeed: 1.0,
  minPitch: -MAX_PITCH,
  maxPitch: MAX_PITCH,

  // Seated
  seatBlendSpeed: 3.4, // 0 -> 1 in roughly a third of a second
  seatYawLimit: (110 * Math.PI) / 180, // how far you may turn away from the screen
  seatPitchLimit: MAX_PITCH,
  /**
   * How far you may be from a seat to sit on it with E. The deepest seat of a
   * block is 4.06m from the nearest aisle, so this leaves room to spare.
   */
  seatReach: 5.2,
  /** Where you end up when you stand back up. */
  standOffset: 1.1,

  // Fixed views (V for the next one, Shift+V for the previous)
  /** The wide shot of the hall, one of the views in `views.js`. */
  overviewPosition: { x: 0, y: 8.6, z: 16.4 },
  overviewLookAt: { x: 0, y: 4.2, z: -8 },
  /** How fast a view fades in over the player's own eyes. */
  overviewBlendSpeed: 2.2,
  overviewDrift: 0.9, // gentle sideways drift, metres
  /**
   * How fast the camera travels from one fixed view straight to the next.
   * 0.8 is a fraction over a second, which is long enough to read the hall
   * going past and short enough not to feel like waiting.
   */
  viewTravelSpeed: 0.8,

  // Cinematic frame (C)
  cinematicBlendSpeed: 1.5,
  /**
   * How much of the view the picture takes when it fills the frame. 1 puts the
   * edge of the picture exactly on the edge of the window; a hair under that
   * keeps the black masking in shot, which is what makes it read as a screen.
   */
  cinematicFill: 0.97,

  // Misc
  maxDeltaTime: 0.1,
}

export const KEYMAP = {
  forward: ['KeyW', 'ArrowUp'],
  backward: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  seat: ['KeyE'],
  view: ['KeyV'],
  cinematic: ['KeyC'],
  /** Caps Lock: nothing else in the room wants it, and it is easy to find. */
  crosshair: ['CapsLock'],
}

export default PLAYER_CONFIG

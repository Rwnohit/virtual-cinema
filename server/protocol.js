/**
 * Wire protocol shared by the multiplayer server and the browser client.
 * Keep this file byte-identical with src/net/protocol.js.
 */

export const PROTOCOL_VERSION = 1;

export const MSG = {
  // client -> server
  HELLO: 'hello',
  STATE: 'state',
  SEAT_CLAIM: 'seat',
  SIGNAL: 'sig',
  PING: 'ping',
  /** "put this on" / "play" / "pause" / "I moved the film to here". */
  SHOW: 'show',
  /** "I opened the curtain" / "I put the lights up" / "I filled the seats". */
  STAGE: 'stage',

  // server -> client
  WELCOME: 'welcome',
  PEER_JOIN: 'join',
  PEER_LEAVE: 'leave',
  SNAPSHOT: 'snap',
  SEAT_MAP: 'seats',
  SEAT_DENIED: 'seatno',
  PONG: 'pong',
  /** What this hall is showing, and where in it everybody is. */
  SHOW_STATE: 'showst',
  /** The room itself: curtain, lights, how full the seats are, screen shape. */
  STAGE_STATE: 'stagest',
  ERROR: 'err',
};

/**
 * The halls, by name.
 *
 * A fixed list rather than "whatever room somebody typed", because a hall you
 * cannot find is not a hall: a viewer picks one off a menu, sees who is inside
 * and what is on, and walks in. The labels are not here - they are words on a
 * screen and belong in the two languages, see src/i18n.
 */
export const HALLS = ['hall-1', 'hall-2', 'hall-3', 'hall-4'];

/**
 * How far a viewer may drift from the hall before their film is nudged back.
 *
 * Small enough that nobody is watching a different moment to the person next to
 * them, big enough that an ordinary buffering hiccup is not answered with a
 * jump. Only ever corrected by seeking to the hall's clock, never by asking
 * the hall to wait.
 */
export const SHOW_DRIFT_S = 1.75;
/** A film is never more than this stale on screen; the hall re-states it. */
export const SHOW_RESTATE_MS = 5000;

/**
 * The parts of the room that belong to the room and not to the person in it.
 *
 * A hall has one curtain and one set of house lights: open the curtain and it
 * is open for everybody, because there is only one. What is NOT here is just
 * as deliberate - the sound desk, the picture grade, the language - because
 * those are what one person hears and sees from one seat, and sharing them
 * would let somebody else's headphones decide what your speakers do.
 */
export const STAGE_KEYS = [
  'curtains',
  'house',
  'screenGain',
  'warmth',
  'aisle',
  'exit',
  'exposure',
  'audience',
  'ratio',
  /** Who is sharing their screen right now, or "" for nobody. */
  'live',
];

/** The stage values that are words rather than numbers. */
export const STAGE_TEXT_KEYS = ['ratio', 'live'];

/** Server snapshot rate. 15 Hz is plenty for people sitting in a cinema. */
export const TICK_HZ = 15;
/** How often the client pushes its own pose when it keeps moving. */
export const STATE_SEND_HZ = 12;
/** Full (non delta) snapshot every N ticks so late joiners never drift. */
export const KEYFRAME_EVERY = 30;
/** Render remote peers this far in the past so interpolation always has data. */
export const INTERP_DELAY_MS = 120;

export const MAX_MESSAGE_BYTES = 16 * 1024;
export const MAX_PEERS_PER_ROOM = 24;
export const MAX_NAME_LENGTH = 24;
export const HEARTBEAT_MS = 25_000;

/** Voice: distance model tuning, in world units (1 unit = 1 metre). */
export const VOICE = {
  refDistance: 1.4,
  maxDistance: 18,
  rolloffFactor: 1.8,
  innerAngle: 100,
  outerAngle: 260,
  outerGain: 0.45,
};

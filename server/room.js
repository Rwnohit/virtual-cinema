/**
 * Room and peer bookkeeping. Pure data plus tiny helpers, no socket logic
 * beyond the send() convenience wrapper, so this stays easy to unit test.
 */

import { randomUUID } from 'node:crypto';
import { MSG, MAX_NAME_LENGTH, MAX_PEERS_PER_ROOM, STAGE_KEYS, STAGE_TEXT_KEYS } from './protocol.js';

const PALETTE = [
  '#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff',
  '#c77dff', '#ff9f68', '#00c2a8', '#f473b9',
];

const OPEN = 1; // ws.OPEN without importing ws here

export function newPeerId() {
  return randomUUID().slice(0, 8);
}

function cleanName(raw, fallback) {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return fallback;
  return s.slice(0, MAX_NAME_LENGTH);
}

function vec3(v, fallback) {
  if (!Array.isArray(v) || v.length < 3) return fallback;
  const out = [Number(v[0]), Number(v[1]), Number(v[2])];
  return out.every(Number.isFinite) ? out : fallback;
}

function quat(v, fallback) {
  if (!Array.isArray(v) || v.length < 4) return fallback;
  const out = [Number(v[0]), Number(v[1]), Number(v[2]), Number(v[3])];
  return out.every(Number.isFinite) ? out : fallback;
}

export class Peer {
  constructor(ws, id, index) {
    this.ws = ws;
    this.id = id;
    this.name = `Guest ${index}`;
    this.color = PALETTE[index % PALETTE.length];
    this.p = [0, 1.6, 0];
    this.q = [0, 0, 0, 1];
    this.seat = null;
    this.speaking = false;
    this.dirty = true;
    this.alive = true;
    this.joinedAt = Date.now();
    this.msgBudget = 0;
    this.budgetResetAt = 0;
  }

  applyHello(data) {
    this.name = cleanName(data?.name, this.name);
    if (typeof data?.color === 'string' && /^#[0-9a-f]{6}$/i.test(data.color)) {
      this.color = data.color;
    }
    this.dirty = true;
  }

  applyState(data) {
    const p = vec3(data?.p, null);
    const q = quat(data?.q, null);
    if (p) this.p = p;
    if (q) this.q = q;
    if (typeof data?.speaking === 'boolean') this.speaking = data.speaking;
    this.dirty = true;
  }

  toWire() {
    return {
      id: this.id,
      name: this.name,
      color: this.color,
      p: this.p,
      q: this.q,
      seat: this.seat,
      speaking: this.speaking,
    };
  }

  toPose() {
    return { id: this.id, p: this.p, q: this.q, seat: this.seat, speaking: this.speaking };
  }

  send(obj) {
    if (this.ws && this.ws.readyState === OPEN) {
      try {
        this.ws.send(JSON.stringify(obj));
      } catch {
        /* socket died mid write, the close handler will clean up */
      }
    }
  }
}

/** A link everybody in the hall can actually open. */
function cleanSource(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 2048) return null;
  let url;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  // `blob:` and `file:` are a film that exists on one person's own machine.
  // Sending that name to the hall would put a dead link on everyone else's
  // screen, so a local film stays local and the room simply carries on with
  // whatever it had.
  return url.protocol === 'http:' || url.protocol === 'https:' ? s : null;
}

function cleanTime(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  // Twelve hours. Long enough for anything anyone will sit through, short
  // enough that a nonsense number cannot push the clock past the year 3000.
  return Math.min(n, 43_200);
}

export class Room {
  constructor(id) {
    this.id = id;
    this.peers = new Map();
    /** seatId -> peerId */
    this.seats = new Map();
    this.tick = 0;
    this.counter = 0;

    /**
     * What this hall is showing.
     *
     * The hall owns the screening, not the person who started it: `time` is
     * where the film was at the moment `at`, so anyone arriving later is told
     * where the film is NOW and starts there. That is the whole difference
     * between four halls and four people each watching alone.
     *
     * `rev` only ever goes up. Two people pressing pause at the same instant is
     * ordinary, and without it the slower message would arrive last and win.
     */
    this.show = {
      src: null,
      label: null,
      playing: false,
      time: 0,
      at: Date.now(),
      by: null,
      rev: 0,
    };

    /**
     * The room around the film. Empty until somebody touches something, so a
     * hall nobody has been in does not impose a curtain position on the first
     * person through the door - they bring their own and it becomes the
     * hall's. See setStage().
     */
    this.stage = { by: null, rev: 0 };
  }

  /**
   * The room itself, as opposed to the film in it. See STAGE_KEYS.
   *
   * Nothing here has a clock, so unlike the screening it is simply the last
   * thing anybody said. Numbers are clamped rather than rejected, because a
   * value out of range is a browser being odd and not an attack, and a hall
   * that ignores it silently is worse than one that meets it halfway.
   *
   * @param {Peer} peer
   * @param {object} values
   * @returns {boolean} whether anything changed
   */
  setStage(peer, values) {
    if (!values || typeof values !== 'object') return false;
    let changed = false;
    for (const key of STAGE_KEYS) {
      if (!(key in values)) continue;
      const raw = values[key];
      let next;
      if (STAGE_TEXT_KEYS.includes(key)) {
        // An empty one is a real value here: "nobody is sharing" has to be
        // sayable, or a share that stopped would look like one still running.
        next = String(raw ?? '').slice(0, 40).replace(/[^\w-]/g, '');
      } else {
        const n = Number(raw);
        if (!Number.isFinite(n)) continue;
        next = Math.min(Math.max(n, 0), 2);
      }
      if (this.stage[key] === next) continue;
      this.stage[key] = next;
      changed = true;
    }
    if (!changed) return false;
    this.stage.by = peer?.id ?? null;
    this.stage.rev += 1;
    return true;
  }

  /**
   * The screening as it stands right now, with the clock run forward.
   * @returns {{src:string|null,label:string|null,playing:boolean,time:number,at:number,by:string|null,rev:number}}
   */
  showNow() {
    const now = Date.now();
    const time = this.show.playing
      ? this.show.time + Math.max(0, now - this.show.at) / 1000
      : this.show.time;
    return { ...this.show, time: Math.round(time * 1000) / 1000, at: now };
  }

  /**
   * Somebody put something on, pressed play, or moved the film.
   *
   * @param {Peer} peer
   * @param {object} data
   * @returns {boolean} whether the hall changed, and so whether to tell everyone
   */
  setShow(peer, data) {
    if (!data || typeof data !== 'object') return false;

    // Roll the clock forward FIRST. A pause carries no time with it - it means
    // "stop where we are" - and starting from the stored pair would freeze the
    // hall at whatever second the film was on when it was last spoken about,
    // which is usually the second it started.
    const next = { ...this.showNow(), by: peer?.id ?? null, at: Date.now(), rev: this.show.rev + 1 };

    if ('src' in data) {
      const src = cleanSource(data.src);
      // A film nobody else can open must not clear the one that is running.
      if (!src && data.src) return false;
      if (src !== next.src) {
        next.src = src;
        next.time = 0;
        next.playing = false;
      }
      next.label = src ? String(data.label ?? '').slice(0, 120) || null : null;
    }
    // A hall with no film has nowhere to be. Recording "playing" against no
    // source produced a state that meant nothing and did real harm: it came
    // straight back as "the screening stopped", and paused the private film
    // the viewer had just started. No film, no clock.
    if (next.src) {
      if (typeof data.playing === 'boolean') next.playing = data.playing;
      if (data.time !== undefined) next.time = cleanTime(data.time);
    } else {
      next.playing = false;
      next.time = 0;
    }

    // Nothing anyone would notice: do not wake the whole hall for it.
    const same =
      next.src === this.show.src &&
      next.playing === this.show.playing &&
      Math.abs(next.time - this.showNow().time) < 0.4;
    if (same) return false;

    this.show = next;
    return true;
  }

  get size() {
    return this.peers.size;
  }

  isFull() {
    return this.peers.size >= MAX_PEERS_PER_ROOM;
  }

  add(ws) {
    const peer = new Peer(ws, newPeerId(), ++this.counter);
    this.peers.set(peer.id, peer);
    return peer;
  }

  remove(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return null;
    this.peers.delete(peerId);
    this.releaseSeatsOf(peerId);
    return peer;
  }

  releaseSeatsOf(peerId) {
    let changed = false;
    for (const [seatId, owner] of this.seats) {
      if (owner === peerId) {
        this.seats.delete(seatId);
        changed = true;
      }
    }
    return changed;
  }

  /**
   * First come first served. Returns 'ok' | 'taken' | 'released'.
   * A null seatId means the peer stood up.
   */
  claimSeat(peer, seatId) {
    if (seatId === null || seatId === undefined || seatId === '') {
      const changed = this.releaseSeatsOf(peer.id);
      peer.seat = null;
      peer.dirty = true;
      return changed ? 'released' : 'ok';
    }
    const key = String(seatId);
    const owner = this.seats.get(key);
    if (owner && owner !== peer.id) return 'taken';
    this.releaseSeatsOf(peer.id);
    this.seats.set(key, peer.id);
    peer.seat = key;
    peer.dirty = true;
    return 'ok';
  }

  seatMap() {
    return Object.fromEntries(this.seats);
  }

  peerList(exceptId) {
    const out = [];
    for (const peer of this.peers.values()) {
      if (peer.id !== exceptId) out.push(peer.toWire());
    }
    return out;
  }

  broadcast(obj, exceptId) {
    for (const peer of this.peers.values()) {
      if (peer.id !== exceptId) peer.send(obj);
    }
  }
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  get(roomId) {
    const key = String(roomId || 'main').slice(0, 40).replace(/[^\w-]/g, '') || 'main';
    let room = this.rooms.get(key);
    if (!room) {
      room = new Room(key);
      this.rooms.set(key, room);
    }
    return room;
  }

  dropIfEmpty(room) {
    if (room.size === 0) this.rooms.delete(room.id);
  }

  stats() {
    const rooms = [];
    for (const room of this.rooms.values()) {
      const show = room.showNow();
      rooms.push({
        id: room.id,
        peers: room.size,
        seatsTaken: room.seats.size,
        // Enough for a menu to say "3 inside, 21 minutes in", and not one field
        // more: the lobby is a public page and nobody in it has joined yet.
        showing: !!show.src,
        label: show.label,
        playing: show.playing,
        time: Math.round(show.time),
        names: [...room.peers.values()].map((peer) => peer.name).slice(0, 8),
      });
    }
    return { rooms, total: rooms.reduce((n, r) => n + r.peers, 0) };
  }
}

export { MSG, MAX_PEERS_PER_ROOM };

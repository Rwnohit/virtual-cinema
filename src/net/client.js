/**
 * Thin websocket client: connect, keep alive, reconnect, and push our pose.
 * Knows nothing about Three.js so it can be tested on its own.
 */

import { MSG, STATE_SEND_HZ } from './protocol.js';
import { resolveServerUrl, resolveRoom, resolveDisplayName } from './config.js';

const SEND_INTERVAL_MS = 1000 / STATE_SEND_HZ;
const IDLE_RESEND_MS = 1000;
const MOVE_EPSILON = 0.02; // metres
const TURN_EPSILON = 0.0008; // 1 - |dot| between quaternions

export class NetClient {
  constructor(options = {}) {
    this.url = resolveServerUrl(options.url);
    this.room = resolveRoom(options.room);
    this.name = resolveDisplayName(options.name);
    this.color = options.color || null;

    this.id = null;
    this.status = 'idle'; // idle | connecting | online | offline
    this.rtt = 0;
    this.serverVoice = null;
    /**
     * Server clock minus ours, in milliseconds.
     *
     * The hall states where the film is against ITS clock, and two laptops are
     * routinely seconds apart. Without this a viewer joining a screening would
     * be put exactly as far into the wrong place as their clock is wrong, and
     * would then be dragged there again on every correction. Measured from the
     * ping we already send, halved for the trip out.
     */
    this.serverOffset = 0;
    this._offsetSamples = 0;

    this.ws = null;
    this.closedByUs = false;
    this.everConnected = false;
    this.retries = 0;
    this.retryTimer = null;
    this.pingTimer = null;

    this._listeners = new Map();
    this._lastSentAt = 0;
    this._lastPose = { p: [0, 0, 0], q: [0, 0, 0, 1], speaking: false };
    this._pendingSeat = null;
  }

  /* ---------------------------------------------------------------- events */

  on(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    this._listeners.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const set = this._listeners.get(type);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[net] listener for "${type}" threw`, err);
      }
    }
  }

  _setStatus(status, detail) {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', { status, detail });
  }

  /* ------------------------------------------------------------ connection */

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return this;
    }
    this.closedByUs = false;
    this._setStatus('connecting');

    const qs = new URLSearchParams({ room: this.room, name: this.name });
    if (this.color) qs.set('color', this.color);

    if (typeof WebSocket === 'undefined') return this;

    let ws;
    try {
      ws = new WebSocket(`${this.url}?${qs}`);
    } catch {
      // Bad url or blocked scheme: stay quiet, the room is simply empty.
      this._setStatus('offline', 'bad url');
      this._scheduleReconnect();
      return this;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.retries = 0;
      this.everConnected = true;
      this._setStatus('online');
      this.send({ t: MSG.HELLO, name: this.name, color: this.color });
      if (this._pendingSeat !== null) this.claimSeat(this._pendingSeat);
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ t: MSG.PING, ts: Date.now() }), 5000);
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      this._handle(msg);
    };

    ws.onclose = (event) => {
      clearInterval(this.pingTimer);
      this.ws = null;
      this.id = null;
      this._setStatus('offline', event.reason || '');
      this.emit('reset');
      if (!this.closedByUs) this._scheduleReconnect();
    };

    ws.onerror = () => {
      /* onclose always follows, reconnect is handled there */
    };

    return this;
  }

  _scheduleReconnect() {
    clearTimeout(this.retryTimer);
    // If the server was never there (nobody started it), back off further so we
    // do not fill the console every few seconds while someone works solo.
    const ceiling = this.everConnected ? 8000 : 20000;
    const delay = Math.min(ceiling, 500 * 2 ** this.retries) + Math.random() * 250;
    this.retries += 1;
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  _handle(msg) {
    switch (msg.t) {
      case MSG.WELCOME:
        this.id = msg.id;
        this.serverVoice = msg.voice || null;
        this.emit('welcome', msg);
        break;
      case MSG.PEER_JOIN:
        this.emit('peer:join', msg.peer);
        break;
      case MSG.PEER_LEAVE:
        this.emit('peer:leave', msg.id);
        break;
      case MSG.SNAPSHOT:
        this.emit('snapshot', msg);
        break;
      case MSG.SEAT_MAP:
        this.emit('seats', msg.seats || {});
        break;
      case MSG.SEAT_DENIED:
        this.emit('seat:denied', msg);
        break;
      case MSG.SIGNAL:
        this.emit('signal', msg);
        break;
      case MSG.SHOW_STATE:
        this.emit('show', msg.show || null);
        break;
      case MSG.STAGE_STATE:
        this.emit('stage', msg.stage || null);
        break;
      case MSG.PONG: {
        if (!msg.ts) break;
        const now = Date.now();
        this.rtt = now - msg.ts;
        if (Number.isFinite(msg.now)) {
          // The reply was written half a round trip ago.
          const sample = msg.now + this.rtt / 2 - now;
          // First answer is taken whole, later ones ease in: a single slow
          // packet should not jerk the whole hall's clock.
          this.serverOffset =
            this._offsetSamples === 0 ? sample : this.serverOffset + (sample - this.serverOffset) * 0.25;
          this._offsetSamples += 1;
        }
        break;
      }
      case MSG.ERROR:
        console.warn('[net] server error', msg);
        break;
      default:
        break;
    }
  }

  /* --------------------------------------------------------------- sending */

  get online() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN && !!this.id;
  }

  send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  /**
   * Push our pose, throttled and only when something actually changed.
   * p is [x,y,z], q is a quaternion [x,y,z,w].
   */
  sendState(p, q, speaking = false) {
    if (!this.online) return false;

    const now = performance.now();
    if (now - this._lastSentAt < SEND_INTERVAL_MS) return false;

    const last = this._lastPose;
    const dx = p[0] - last.p[0];
    const dy = p[1] - last.p[1];
    const dz = p[2] - last.p[2];
    const movedSq = dx * dx + dy * dy + dz * dz;
    const dot = Math.abs(q[0] * last.q[0] + q[1] * last.q[1] + q[2] * last.q[2] + q[3] * last.q[3]);
    const turned = 1 - Math.min(1, dot);
    const stale = now - this._lastSentAt > IDLE_RESEND_MS;

    if (movedSq < MOVE_EPSILON * MOVE_EPSILON && turned < TURN_EPSILON && speaking === last.speaking && !stale) {
      return false;
    }

    this._lastSentAt = now;
    this._lastPose = { p: [p[0], p[1], p[2]], q: [q[0], q[1], q[2], q[3]], speaking };
    return this.send({
      t: MSG.STATE,
      p: [round(p[0]), round(p[1]), round(p[2])],
      q: [round(q[0], 4), round(q[1], 4), round(q[2], 4), round(q[3], 4)],
      speaking,
    });
  }

  /** The server's clock, read from here. See `serverOffset`. */
  get serverNow() {
    return Date.now() + this.serverOffset;
  }

  /**
   * Tell the hall what is on, or what just happened to it.
   * @param {{src?:string|null,label?:string|null,playing?:boolean,time?:number}} data
   */
  sendShow(data) {
    return this.send({ t: MSG.SHOW, ...data });
  }

  /**
   * Tell the hall what the ROOM now looks like: curtain, lights, seats.
   * @param {Record<string, number|string>} values
   */
  sendStage(values) {
    return this.send({ t: MSG.STAGE, values });
  }

  /**
   * Walk into a different hall, under a different name.
   *
   * The room is part of the handshake - it is in the query string of the socket
   * itself - so changing it means a new socket. Closing ours on purpose would
   * normally stop the reconnect loop, hence the flag being put back by hand.
   *
   * @param {string} room
   * @param {string} [name]
   */
  join(room, name) {
    const next = String(room || 'main');
    const renamed = name ? String(name).slice(0, 24) : this.name;
    if (this.online && next === this.room && renamed === this.name) return this;

    this.room = next;
    this.name = renamed;
    this._pendingSeat = null;
    if (this.ws) {
      this.closedByUs = true;
      try {
        this.ws.close(1000, 'changing hall');
      } catch {
        /* it was already gone */
      }
      this.ws = null;
      this.id = null;
    }
    clearTimeout(this.retryTimer);
    this.retries = 0;
    this.closedByUs = false;
    return this.connect();
  }

  /** seatId null means "I stood up". */
  claimSeat(seatId) {
    this._pendingSeat = seatId ?? null;
    return this.send({ t: MSG.SEAT_CLAIM, seat: seatId ?? null });
  }

  signal(to, data) {
    return this.send({ t: MSG.SIGNAL, to, data });
  }

  setName(name) {
    this.name = String(name).slice(0, 24);
    try {
      window.localStorage.setItem('cinema.name', this.name);
    } catch {
      /* ignore */
    }
    this.send({ t: MSG.HELLO, name: this.name, color: this.color });
  }

  close() {
    this.closedByUs = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    this.ws?.close(1000, 'bye');
    this.ws = null;
    this._setStatus('idle');
  }
}

function round(n, digits = 3) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

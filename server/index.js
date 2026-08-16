/**
 * Multiplayer server for the virtual 3D cinema.
 *
 *  - presence and pose sync (who is where, where they look, which seat)
 *  - seat occupancy, first come first served
 *  - blind relay for WebRTC signalling so peers can open voice channels
 *
 * Voice audio never touches this process, it goes peer to peer over WebRTC.
 *
 *   node server/index.js            # ws://localhost:8787/ws
 *   PORT=9000 node server/index.js
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomManager } from './room.js';
import {
  MSG,
  PROTOCOL_VERSION,
  TICK_HZ,
  KEYFRAME_EVERY,
  MAX_MESSAGE_BYTES,
  HEARTBEAT_MS,
  VOICE,
  HALLS,
} from './protocol.js';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
/** Unset means "any path": main.js connects to ws://host:8787 with no path,
 *  while the standalone client defaults to /ws. Both must work. */
const PATH = process.env.WS_PATH || null;
/** Comma separated list, or * for anything. Browsers do not enforce CORS on
 *  websockets, so this is a cheap guard rather than real security. */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const rooms = new RoomManager();

/* -------------------------------------------------------------------------- */
/* the site                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The built room, served by the same process that runs the room.
 *
 * One host, one port, one certificate: the page arrives over https and the
 * socket opens over wss to the very same origin, so there is no second service
 * to keep alive, no cross origin rules to satisfy and no port for a visitor's
 * network to block. When there is no build on disk (a plain `npm run server`
 * during development) this simply does nothing and Vite serves the page.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = process.env.SITE_DIR || path.join(HERE, '..', 'dist');
const hasSite = fs.existsSync(path.join(SITE, 'index.html'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/**
 * Turn a url into a file inside the build, or null.
 *
 * Everything is resolved and then checked to still be under the build folder,
 * so `..` in a url cannot walk out of it and read the rest of the disk.
 */
function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  const full = path.resolve(SITE, `.${path.posix.normalize(decoded)}`);
  const root = path.resolve(SITE);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  try {
    const stat = fs.statSync(full);
    if (stat.isDirectory()) return null;
    return { full, size: stat.size };
  } catch {
    return null;
  }
}

/**
 * Vite writes the hash of the contents into the name of every asset it builds,
 * so those really never change and may be kept for a year. `index.html` and the
 * version stamp are the opposite: they are how a viewer finds out there is a
 * new build at all, so they are never held.
 *
 * `immutable` is only ever put on a file we are actually sending. A cached
 * "this 404 lasts a year" is a page that stays broken until the browser is
 * reinstalled.
 */
function cacheFor(file) {
  const unix = file.replace(/\\/g, '/');
  if (/\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(unix)) {
    return 'public, max-age=31536000, immutable';
  }
  /**
   * A poster is named after its film, so it can be replaced when the
   * catalogue is rebuilt and cannot be called immutable - but it is the same
   * picture from one week to the next, and `no-cache` would mean asking about
   * all eighty-eight of them every single time the library is opened.
   */
  if (unix.includes('/posters/')) return 'public, max-age=604800';
  return 'no-cache';
}

function sendFile(req, res, file, status = 200) {
  const type = TYPES[path.extname(file.full).toLowerCase()] || 'application/octet-stream';
  res.writeHead(status, {
    'content-type': type,
    'content-length': file.size,
    'cache-control': status === 200 ? cacheFor(file.full) : 'no-store',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(file.full).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';

  if (url === '/health' || url.startsWith('/health?')) {
    const body = JSON.stringify({
      ok: true,
      protocol: PROTOCOL_VERSION,
      tickRate: TICK_HZ,
      uptime: Math.round(process.uptime()),
      site: hasSite,
      ...rooms.stats(),
    });
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    });
    res.end(body);
    return;
  }

  // What the lobby is drawn from: every hall, whether anyone has walked into
  // it yet or not, so the menu has four doors even on a quiet morning.
  if (url === '/rooms' || url.startsWith('/rooms?')) {
    const live = new Map(rooms.stats().rooms.map((room) => [room.id, room]));
    const body = JSON.stringify({
      halls: HALLS.map(
        (id) =>
          live.get(id) ?? {
            id,
            peers: 0,
            seatsTaken: 0,
            showing: false,
            label: null,
            playing: false,
            time: 0,
            names: [],
          },
      ),
    });
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    });
    res.end(body);
    return;
  }

  if (!hasSite) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('method not allowed');
    return;
  }

  const file = resolveFile(url);
  if (file) {
    sendFile(req, res, file);
    return;
  }

  // Anything else is a route into the room, not a missing file: hand back the
  // page and let the app read the url itself.
  const index = resolveFile('/index.html');
  if (!index) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  sendFile(req, res, index, 200);
});

const wss = new WebSocketServer({
  server,
  ...(PATH ? { path: PATH } : {}),
  maxPayload: MAX_MESSAGE_BYTES,
  perMessageDeflate: false,
});

function originAllowed(origin) {
  if (ALLOWED_ORIGINS.includes('*')) return true;
  if (!origin) return true; // native clients and curl send no Origin
  return ALLOWED_ORIGINS.includes(origin);
}

/** Cheap token bucket so a buggy or hostile client cannot flood the room. */
function allowMessage(peer) {
  const now = Date.now();
  if (now > peer.budgetResetAt) {
    peer.budgetResetAt = now + 1000;
    peer.msgBudget = 0;
  }
  peer.msgBudget += 1;
  return peer.msgBudget <= 150;
}

wss.on('connection', (ws, req) => {
  if (!originAllowed(req.headers.origin)) {
    ws.close(4003, 'origin not allowed');
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const room = rooms.get(url.searchParams.get('room'));

  if (room.isFull()) {
    ws.close(4001, 'room full');
    return;
  }

  const peer = room.add(ws);
  peer.applyHello({
    name: url.searchParams.get('name'),
    color: url.searchParams.get('color'),
  });

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  peer.send({
    t: MSG.WELCOME,
    protocol: PROTOCOL_VERSION,
    id: peer.id,
    room: room.id,
    you: peer.toWire(),
    peers: room.peerList(peer.id),
    seats: room.seatMap(),
    tickRate: TICK_HZ,
    voice: VOICE,
    // Where the film is at this instant. This one line is what lets somebody
    // walk in twenty minutes late and sit down inside the same scene.
    show: room.showNow(),
    // And the room it is playing in: curtain, lights, how full the seats are.
    stage: room.stage,
    now: Date.now(),
  });
  room.broadcast({ t: MSG.PEER_JOIN, peer: peer.toWire() }, peer.id);

  ws.on('message', (raw) => {
    if (!allowMessage(peer)) return;

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;

    switch (msg.t) {
      case MSG.HELLO: {
        peer.applyHello(msg);
        room.broadcast({ t: MSG.PEER_JOIN, peer: peer.toWire() }, peer.id);
        break;
      }

      case MSG.STATE: {
        peer.applyState(msg);
        break;
      }

      case MSG.SEAT_CLAIM: {
        const result = room.claimSeat(peer, msg.seat ?? null);
        if (result === 'taken') {
          peer.send({ t: MSG.SEAT_DENIED, seat: String(msg.seat), by: room.seats.get(String(msg.seat)) });
        } else {
          const payload = { t: MSG.SEAT_MAP, seats: room.seatMap() };
          peer.send(payload);
          room.broadcast(payload, peer.id);
        }
        break;
      }

      case MSG.SIGNAL: {
        // Blind relay. The server never inspects SDP or ICE payloads.
        const target = room.peers.get(String(msg.to || ''));
        if (target && target.id !== peer.id) {
          target.send({ t: MSG.SIGNAL, from: peer.id, data: msg.data });
        }
        break;
      }

      case MSG.SHOW: {
        // The hall decides, not the person who spoke: setShow() sanitises and
        // stamps, and then everyone - including whoever asked - is told the
        // same thing. Without echoing it back, the asker's own player would be
        // the only one in the room running on its own clock.
        if (!room.setShow(peer, msg)) break;
        const payload = { t: MSG.SHOW_STATE, show: room.showNow() };
        peer.send(payload);
        room.broadcast(payload, peer.id);
        log(`show  room=${room.id} src=${room.show.src ? 'yes' : 'none'} playing=${room.show.playing} at=${Math.round(room.show.time)}s`);
        break;
      }

      case MSG.STAGE: {
        if (!room.setStage(peer, msg.values)) break;
        // Not echoed to the sender: they are already looking at it, and their
        // own panel would jump under their hand as the round trip landed.
        room.broadcast({ t: MSG.STAGE_STATE, stage: room.stage }, peer.id);
        break;
      }

      case MSG.PING: {
        peer.send({ t: MSG.PONG, ts: msg.ts, now: Date.now() });
        break;
      }

      default:
        break;
    }
  });

  const bye = () => {
    if (!room.peers.has(peer.id)) return;
    room.remove(peer.id);
    room.broadcast({ t: MSG.PEER_LEAVE, id: peer.id }, peer.id);
    room.broadcast({ t: MSG.SEAT_MAP, seats: room.seatMap() }, peer.id);
    rooms.dropIfEmpty(room);
    log(`leave ${peer.id} (${peer.name}) room=${room.id} left=${room.size}`);
  };

  ws.on('close', bye);
  ws.on('error', bye);

  log(`join  ${peer.id} (${peer.name}) room=${room.id} total=${room.size}`);
});

/** Snapshot loop: only peers that actually moved, plus a periodic keyframe. */
const tickTimer = setInterval(() => {
  for (const room of rooms.rooms.values()) {
    room.tick += 1;
    const keyframe = room.tick % KEYFRAME_EVERY === 0;
    const moved = [];
    for (const peer of room.peers.values()) {
      if (peer.dirty || keyframe) moved.push(peer.toPose());
      peer.dirty = false;
    }
    if (!moved.length) continue;

    const ts = Date.now();
    for (const peer of room.peers.values()) {
      const others = moved.filter((m) => m.id !== peer.id);
      if (others.length) peer.send({ t: MSG.SNAPSHOT, ts, peers: others, key: keyframe || undefined });
    }
  }
}, Math.round(1000 / TICK_HZ));

/** Drop sockets that stopped answering, otherwise ghosts stay in their seats. */
const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    try {
      client.ping();
    } catch {
      client.terminate();
    }
  }
}, HEARTBEAT_MS);

function log(line) {
  const stamp = new Date().toISOString().slice(11, 19);
  process.stdout.write(`[cinema ${stamp}] ${line}\n`);
}

function shutdown() {
  clearInterval(tickTimer);
  clearInterval(heartbeat);
  for (const client of wss.clients) client.close(1001, 'server shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log(`port ${PORT} is already taken. Another server is probably running.`);
    process.exit(1);
  }
  log(`server error: ${err.message}`);
});

server.listen(PORT, HOST, () => {
  log(`listening on ws://localhost:${PORT}${PATH || ''} (health: http://localhost:${PORT}/health)`);
  log(hasSite ? `serving the room from ${SITE}` : 'no build on disk, websocket only');
});

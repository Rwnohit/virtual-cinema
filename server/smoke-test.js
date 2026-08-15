/**
 * Quick end to end check of the multiplayer server, no browser needed.
 *
 *   npm run server                # in one terminal
 *   node server/smoke-test.js     # in another
 *
 * Two fake clients join, move, take seats and relay a signalling payload.
 */

import { WebSocket } from 'ws';
import { MSG } from './protocol.js';

// No path on purpose: this is the url main.js builds. /ws works too.
const URL_BASE = process.env.NET_URL || 'ws://localhost:8787';
const ROOM = `smoke-${Math.random().toString(36).slice(2, 7)}`;

const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!ok) failures.push(label);
};

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${URL_BASE}?room=${ROOM}&name=${encodeURIComponent(name)}`);
    const inbox = [];
    ws.on('message', (raw) => inbox.push(JSON.parse(raw.toString())));
    ws.on('error', reject);
    ws.on('open', () => resolve({ ws, inbox, name, send: (o) => ws.send(JSON.stringify(o)) }));
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const find = (inbox, type) => inbox.find((m) => m.t === type);

const a = await connect('Alpha');
await wait(120);
const b = await connect('Beta');
await wait(250);

const welcomeA = find(a.inbox, MSG.WELCOME);
const welcomeB = find(b.inbox, MSG.WELCOME);
check('both clients get a welcome with an id', !!welcomeA?.id && !!welcomeB?.id);
check('the second client sees the first one already inside', welcomeB.peers.length === 1);
check('the first client is told that someone joined', !!find(a.inbox, MSG.PEER_JOIN));

a.send({ t: MSG.STATE, p: [1, 1.6, -3], q: [0, 0, 0, 1], speaking: true });
await wait(250);
const snap = find(b.inbox, MSG.SNAPSHOT);
check('poses reach the other client', snap?.peers?.[0]?.p?.[0] === 1);
check('the speaking flag travels too', snap?.peers?.[0]?.speaking === true);
check('nobody receives their own pose back', !snap.peers.some((p) => p.id === welcomeB.id));

a.send({ t: MSG.SEAT_CLAIM, seat: 'C7' });
await wait(200);
check('a seat claim is broadcast', find(b.inbox, MSG.SEAT_MAP)?.seats?.C7 === welcomeA.id);

b.send({ t: MSG.SEAT_CLAIM, seat: 'C7' });
await wait(200);
check('a taken seat is refused', find(b.inbox, MSG.SEAT_DENIED)?.seat === 'C7');

a.send({ t: MSG.SIGNAL, to: welcomeB.id, data: { desc: { type: 'offer', sdp: 'x' } } });
await wait(200);
const sig = find(b.inbox, MSG.SIGNAL);
check('webrtc signalling is relayed to the right peer', sig?.from === welcomeA.id && sig?.data?.desc?.sdp === 'x');

a.ws.close();
await wait(300);
check('leaving is announced', find(b.inbox, MSG.PEER_LEAVE)?.id === welcomeA.id);
const seatsAfter = b.inbox.filter((m) => m.t === MSG.SEAT_MAP).pop();
check('the seat is freed when its owner leaves', !seatsAfter?.seats?.C7);

b.ws.close();
await wait(100);

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);

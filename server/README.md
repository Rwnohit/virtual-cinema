# Multiplayer server (virtual 3D cinema)

Keeps track of who is in, where they are sitting and where they are looking,
and plays postman for WebRTC. The voice does NOT go through here, it goes peer
to peer.

## Running it

From the project root, not from in here:

```bash
npm run server     # ws://localhost:8787
```

`ws` is already in the root `package.json`, this folder does not want a second
`npm install`.

Check it is alive: <http://localhost:8787/health>

It accepts a connection on any path, both a bare `ws://host:8787` (which is how
`main.js` builds it) and `ws://host:8787/ws`.

Settings come from env vars: `PORT` (8787), `HOST` (0.0.0.0), `WS_PATH` (pins it
to a single path), `ALLOWED_ORIGINS` (comma separated list, or `*`).

## Testing without a browser

```bash
npm run server              # in one terminal
node server/smoke-test.js   # in another
```

Checks join, poses, seats, seat conflicts, WebRTC relay and leave.

## Files

| File | What it does |
| --- | --- |
| `index.js` | Serves the build, HTTP health, WebSocket, 15 Hz snapshot loop, heartbeat |
| `room.js` | Rooms, peers, seat ownership (first come, first seated), the shared screening |
| `protocol.js` | The messages. The same file as `src/net/protocol.js` |
| `smoke-test.js` | 11 end to end checks |

## The protocol in a nutshell

Client to server: `hello`, `state`, `seat`, `sig`, `ping`
Server to client: `welcome`, `join`, `leave`, `snap`, `seats`, `seatno`, `pong`

- `state` is only sent when something changes, up to 12 times a second.
- `snap` goes out 15 times a second and carries only the people who moved, with
  a full keyframe every 2 seconds.
- `sig` is a blind relay: the server never looks inside the SDP.

## Limits

24 people per room, 16 KB per message, 150 messages per second per connection.
Dead connections are dropped at 25 seconds, so no ghosts are left sitting in
the seats.

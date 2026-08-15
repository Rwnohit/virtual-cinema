# src/net · multiplayer client

You see the others sitting and moving, and you hear them from the side they are
on. It touches no file outside this folder.

## Wiring it in

`src/main.js` already does it:

```js
createNet({ url, scene, camera, player, media })  // -> { update(delta) }
```

`main.js` calls `update(delta)` inside its own loop, and the internal loop then
switches itself off. If the server is not running, `createNet` returns normally
and you are simply alone in the hall.

If somebody wants to set it up by hand, there is also `createNetwork(...)` with
the same options.

## What it reads from elsewhere (read only)

| Source | What it looks for | If it is missing |
| --- | --- | --- |
| `camera` | position and direction, the basis for sound and avatar | falls back to player state |
| `player` (handle) or `src/player/state.js` | `seat` / `seatId`, and pose if there is no camera | stands upright where the camera is |
| `seats` / `SEATS` from the scene | `{ id, eyePosition }` or `{ id, position }` | only for the first placement, before a pose arrives |

Both are read dynamically and read only. You can hand them over yourself:
`createNetwork({ getLocalState: () => ({ position, quaternion, seat }) })`.

## Checking without a browser

```bash
node src/net/self-check.mjs
```

16 checks: that it comes up without a server, that the listener sits on the
camera, that the neighbour on your right is heard on the right and the one on
your left on the left, and that further away is quieter.

## The useful part of the API

```js
net.count                 // how many of us are in
net.isSeatTaken('C7')     // to grey out taken seats
net.occupiedSeats()       // { seatId: peerId }
net.claimSeat('C7')       // if you are not getting it out of player state
net.on('seats', map => {})
net.on('peers', list => {})
net.enableMic() / net.setMuted(true) / net.toggleMic()
net.dispose()
```

## Options

`url`, `room`, `name`, `color`, `scene`, `camera`, `three`, `seats`,
`getLocalState`, `hud` (default true), `voice` (default true),
`autoUpdate` (default true), `tuning` (sound distance settings).

The server finds itself: `?net=ws://...` in the URL, otherwise `VITE_NET_URL`,
otherwise the same machine on 8787.

## Voice and spatial sound

- Full mesh WebRTC. The server only passes the connection messages along.
- Every voice goes through a `PannerNode` with `HRTF`: whoever is sitting to
  your left is heard on your left, and gets louder as they come closer
  (`inverse`, refDistance 1.4 m, gone by 18 m). Somebody with their back turned
  sounds more muffled.
- The listener is pinned to the camera every frame.
- We share the same `AudioContext` as Three.js (`THREE.AudioContext`), so the
  film and the voices live in one world.
- The microphone only opens on a button press, because the browser demands it.
  The button is at the bottom left, `hud: false` turns it off.

## Files

| File | What it does |
| --- | --- |
| `index.js` | The single entry point, ties it all together |
| `client.js` | WebSocket, reconnect, sends a pose only when it changes |
| `peers.js` | Interpolation buffer, smooth movement 120 ms behind |
| `avatars.js` | The little body, the name tag, the speaking ring |
| `voice.js` | WebRTC mesh, perfect negotiation, replaceTrack for the microphone |
| `audio.js` | PannerNode HRTF, listener on the camera, voice meter |
| `local-state.js` | The translator towards `player/state.js` and `scene/seats.js` |
| `show.js` | The hall's screening: what is on, and how far in |
| `ui.js` | The small HUD with the microphone |
| `protocol.js` | The messages, the same as `server/protocol.js` |

## Known traps

- In Chrome a WebRTC stream is not audible through Web Audio unless it is also
  attached to an `<audio>` element. We make one, hidden and muted.
- Over http from another device, the microphone is not granted. It wants
  `localhost` or https.
- Without a TURN server, difficult networks (strict NAT) may fail to connect.
  The STUN servers live in `config.js`.

# Multiplayer server (virtual 3D cinema)

Κρατάει το ποιος είναι μέσα, πού κάθεται και πού κοιτάει, και παίζει τον
ταχυδρόμο για το WebRTC. Η φωνή ΔΕΝ περνάει από εδώ, πάει peer to peer.

## Τρέξιμο

Από τη ρίζα του έργου, όχι από εδώ μέσα:

```bash
npm run server     # ws://localhost:8787
```

Το `ws` είναι ήδη στο `package.json` της ρίζας, δεν θέλει δεύτερο
`npm install` εδώ.

Έλεγχος ότι ζει: <http://localhost:8787/health>

Δέχεται σύνδεση σε οποιοδήποτε path, και σκέτο `ws://host:8787` (έτσι το
φτιάχνει το `main.js`) και `ws://host:8787/ws`.

Ρυθμίσεις με env vars: `PORT` (8787), `HOST` (0.0.0.0), `WS_PATH` (κλειδώνει σε
ένα μόνο path), `ALLOWED_ORIGINS` (λίστα με κόμμα, ή `*`).

## Τεστ χωρίς browser

```bash
npm run server              # σε ένα terminal
node server/smoke-test.js   # σε άλλο
```

Ελέγχει join, poses, seats, seat conflicts, WebRTC relay και leave.

## Αρχεία

| Αρχείο | Τι κάνει |
| --- | --- |
| `index.js` | HTTP health, WebSocket, snapshot loop 15 Hz, heartbeat |
| `room.js` | Δωμάτια, peers, κατοχή θέσεων (πρώτος έρχεται, πρώτος κάθεται) |
| `protocol.js` | Τα μηνύματα. Ίδιο αρχείο με το `src/net/protocol.js` |
| `smoke-test.js` | 11 έλεγχοι end to end |

## Πρωτόκολλο με δυο λόγια

Client προς server: `hello`, `state`, `seat`, `sig`, `ping`
Server προς client: `welcome`, `join`, `leave`, `snap`, `seats`, `seatno`, `pong`

- `state` στέλνεται μόνο όταν κάτι αλλάζει, μέχρι 12 φορές το δευτερόλεπτο.
- `snap` φεύγει 15 φορές το δευτερόλεπτο και περιέχει μόνο όσους κουνήθηκαν,
  με ένα πλήρες keyframe κάθε 2 δευτερόλεπτα.
- `sig` είναι τυφλή αναμετάδοση: ο server δεν κοιτάει ποτέ μέσα στο SDP.

## Όρια

24 άτομα ανά δωμάτιο, 16 KB ανά μήνυμα, 150 μηνύματα ανά δευτερόλεπτο ανά
σύνδεση. Νεκρές συνδέσεις πέφτουν στα 25 δευτερόλεπτα, ώστε να μη μένουν
φαντάσματα στις θέσεις.

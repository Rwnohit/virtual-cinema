# src/net · multiplayer client

Βλέπεις τους άλλους να κάθονται και να κουνιούνται, και τους ακούς από τη μεριά
που βρίσκονται. Δεν πειράζει κανένα αρχείο εκτός από αυτόν τον φάκελο.

## Ενσωμάτωση

Γίνεται ήδη μόνη της από το `src/main.js`:

```js
createNet({ url, scene, camera, player, media })  // -> { update(delta) }
```

Το `main.js` καλεί το `update(delta)` μέσα στο δικό του loop και τότε το
εσωτερικό loop σβήνει μόνο του. Αν ο server δεν τρέχει, το `createNet`
επιστρέφει κανονικά και είσαι απλώς μόνος στην αίθουσα.

Αν κάποιος θέλει να το στήσει χειροκίνητα, υπάρχει και το `createNetwork(...)`
με τις ίδιες επιλογές.

## Τι διαβάζει από αλλού (μόνο ανάγνωση)

| Πηγή | Τι ψάχνει | Αν λείπει |
| --- | --- | --- |
| `camera` | θέση και διεύθυνση, η βάση για ήχο και avatar | δοκιμάζει το player state |
| `player` (handle) ή `src/player/state.js` | `seat` / `seatId`, και pose αν δεν υπάρχει κάμερα | στέκεται όρθιος στη θέση της κάμερας |
| `seats` / `SEATS` του scene | `{ id, eyePosition }` ή `{ id, position }` | μόνο για το πρώτο στήσιμο πριν έρθει pose |

## Έλεγχος χωρίς browser

```bash
node src/net/self-check.mjs
```

16 έλεγχοι: ότι σηκώνεται χωρίς server, ότι ο ακροατής κάθεται πάνω στην κάμερα,
ότι ο διπλανός δεξιά ακούγεται δεξιά και ο αριστερά αριστερά, και ότι όσο πιο
μακριά τόσο πιο σιγά.

Και τα δύο διαβάζονται δυναμικά και μόνο για ανάγνωση. Μπορείς να τα δώσεις και
με το χέρι: `createNetwork({ getLocalState: () => ({ position, quaternion, seat }) })`.

## Χρήσιμα από το API

```js
net.count                 // πόσοι είμαστε μέσα
net.isSeatTaken('C7')     // για να γκριζάρεις πιασμένες θέσεις
net.occupiedSeats()       // { seatId: peerId }
net.claimSeat('C7')       // αν δεν το βγάζεις από το player state
net.on('seats', map => {})
net.on('peers', list => {})
net.enableMic() / net.setMuted(true) / net.toggleMic()
net.dispose()
```

## Επιλογές

`url`, `room`, `name`, `color`, `scene`, `camera`, `three`, `seats`,
`getLocalState`, `hud` (default true), `voice` (default true),
`autoUpdate` (default true), `tuning` (ρυθμίσεις απόστασης ήχου).

Ο server βρίσκεται μόνος του: `?net=ws://...` στο URL, αλλιώς `VITE_NET_URL`,
αλλιώς η ίδια μηχανή στο 8787.

## Φωνή και χωρικός ήχος

- Full mesh WebRTC. Ο server μόνο περνάει τα μηνύματα σύνδεσης.
- Κάθε φωνή περνάει από `PannerNode` με `HRTF`: όποιος κάθεται αριστερά σου
  ακούγεται αριστερά, και όσο πλησιάζει δυναμώνει (`inverse`, refDistance 1.4 m,
  σβήνει στα 18 m). Όποιος γυρίζει την πλάτη ακούγεται πιο πνιχτά.
- Ο listener κολλάει πάνω στην κάμερα σε κάθε καρέ.
- Μοιραζόμαστε το ίδιο `AudioContext` με το Three.js (`THREE.AudioContext`), για
  να ζουν ταινία και φωνές στον ίδιο κόσμο.
- Το μικρόφωνο ανοίγει μόνο με πάτημα κουμπιού, έτσι το απαιτεί ο browser. Το
  κουμπί είναι κάτω αριστερά, με `hud: false` το σβήνεις.

## Αρχεία

| Αρχείο | Τι κάνει |
| --- | --- |
| `index.js` | Το μοναδικό σημείο εισόδου, τα δένει όλα |
| `client.js` | WebSocket, reconnect, αποστολή pose μόνο όταν αλλάζει |
| `peers.js` | Interpolation buffer, ομαλή κίνηση στα 120 ms πίσω |
| `avatars.js` | Το σωματάκι, το ταμπελάκι, το δαχτυλίδι ομιλίας |
| `voice.js` | WebRTC mesh, perfect negotiation, replaceTrack για το μικρόφωνο |
| `audio.js` | PannerNode HRTF, listener στην κάμερα, μετρητής φωνής |
| `local-state.js` | Ο μεταφραστής προς `player/state.js` και `scene/seats.js` |
| `ui.js` | Το μικρό HUD με το μικρόφωνο |
| `protocol.js` | Τα μηνύματα, ίδιο με το `server/protocol.js` |

## Γνωστές παγίδες

- Στο Chrome ένα WebRTC stream δεν ακούγεται μέσω Web Audio αν δεν είναι
  δεμένο και σε ένα `<audio>` element. Το φτιάχνουμε κρυφό και muted.
- Σε http από άλλη συσκευή, το μικρόφωνο δεν δίνεται. Θέλει `localhost` ή https.
- Χωρίς TURN server, δύσκολα δίκτυα (αυστηρό NAT) μπορεί να μη συνδεθούν.
  Τα STUN μπαίνουν στο `config.js`.

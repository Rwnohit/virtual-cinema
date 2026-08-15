# Virtual Cinema

A 3D cinema hall, inside the browser. You walk in, pick a seat, put on whatever
film you like, and hear the other people in the room from the direction they
are actually sitting in.

The hall is dark. The light comes off the screen itself, so it moves with the
film.

Client: Three.js. Server: Node, with a WebSocket for presence and WebRTC for
voice.

---

## What you need

- **Node.js 20 or newer** (`node -v` to see what you have)
- A current browser (Chrome, Edge, Firefox, Safari)
- Headphones, so the voice chat does not feed back

## Install

```bash
cd virtual-cinema
npm install
```

Once, at the start.

## Running it

It wants **two terminals**, one for the server and one for the page.

```bash
npm run server
```

```bash
npm run dev
```

Then open **http://localhost:5173**.

| Command | What it does |
|---------|--------------|
| `npm run dev` | Serves the page (Vite) on `localhost:5173` |
| `npm run server` | Runs the presence server on `localhost:8787` |
| `npm test` | The quick smoke tests |
| `npm run test:browser` | Opens a real browser and checks the scene and the film |
| `npm run build` | Builds the deployable version into `dist/` |
| `npm run version:stamp` | Rewrites the version. Runs on its own before `dev` and `build` |
| `npm run ship` | Publishes the source and deploys, if the machine has a `deploy.env` |

Without the server the hall and the film work exactly the same, you are just
on your own in there.

## How it plays

Once the page loads, press **Enter the room**. The mouse locks to the page and
you are inside.

**You do not need a film to go in.** You can wander around an empty hall for as
long as you like and put something on later, or never. If you already know what
you want to watch, there is **Or choose a film now** underneath.

| Key | What it does |
|-----|--------------|
| Mouse | Look around |
| `W` `A` `S` `D` | Walk forward, left, back, right |
| `Shift` | Run |
| `Space` | Jump |
| `E` | Sit down in the seat in front of you, and stand up again |
| `V` | Change your view of the hall (`Shift+V` goes the other way) |
| `[` `]` | Take the house lights down and up |
| `C` | Cinematic frame: the screen fills your vision |
| **Mouse wheel** | Zoom. Keep going past the end and it enters the frame, roll back and it leaves |
| `Caps Lock` | Hides and brings back the little sight in the middle |
| `F` | Go through the door, when you are standing in front of one |
| `L` | Opens the room panel, and gives you the mouse back |
| **Right click** | The room menu, wherever you happen to be standing |
| `Esc` | Unlocks the mouse (so you can reach the panels) |

**The right click menu**

Right click does not open the browser menu with copy and paste in it. It opens
the room menu: pause, open a film, full screen, screen format, lights, seat and
view. If the mouse was locked, it gives it back to you and opens in the middle
of the screen. Inside a text field it leaves well alone, because there the
browser menu is the useful one.

**Sitting down**

1. Walk up to a free seat.
2. Press `E` to sit.
3. Press `E` again to stand.

Taken seats are not offered to you, you see them occupied by the people in them.

## Undo

Every slider has a small **↺** beside it, which appears the moment you touch it
and puts it back where it was. Every page of the panel has a **Reset all** at
the end.

## Language

The room speaks **Greek and English**. You switch from the **View** panel, and
it remembers your choice. The first time round it follows your browser.

Every new piece that goes in from here on is written in both: the strings all
live together in `src/i18n/index.js`, and the sliders take their labels from
there by key, so no single piece needs translation code of its own.

## Halls, and watching together

The front door asks for a name and a hall. Whatever is playing in that hall,
everybody in it watches together: the same film, at the same second. Walk in
twenty minutes late and you land twenty minutes in, not at the opening frame.

The room itself is shared too, not just the film. The curtain, the house
lights, the audience in the seats and the screen format are the hall's, seeded
by whoever walked in first. What is deliberately **not** shared is your sound
desk and your picture grade, because those are what one person hears and sees
from one seat.

A file off your own disk is the exception, and the room says so: nobody else
can open it, because it never leaves your computer. For a shared screening, use
a link.

## The queue

In the link field, next to **Play**, there is **Add to queue**. Whatever you put
there lines up, and you see it in the **Queue** panel: what is coming, with a
button to play it now or take it out.

**By default the queue waits for you**: you press next, and it goes on with the
full ceremony, like a new screening. If you want it to run itself, switch on
the automatic option and then you set **the gap**, from 5 seconds to 5 minutes.
The countdown only starts once the hall has brought its lights back up, so the
number you see is the real wait.

## The ceremony

The hall waits for you the way a real one does: **lights up, curtain closed**.

You press play and **the film starts immediately**. The curtain opens and the
lights come down over the top of it, in the first few seconds: you do not sit
in the dark waiting for something you have already pressed. **Five seconds
before the end** the hall starts coming back up, the way a real screening does,
and **the curtain does not close again** on its own.

Where the lights go is up to you. The three presets in the **Lights** panel
(Showtime, Half lights, Interval) hold **all six** settings, and the ceremony
goes exactly there. Set the hall up the way you want it and press **Save the
current lights as · Showtime**: that is what you will get on every film.

In the same panel you can switch the ceremony off if you do not want it, and
next to it there is **Start now** for when you are in a hurry. The curtains on
their own are **first in the Screen panel**, and in the right click menu.

## The bottom bar

Everything you want **while the film is playing** is there and does not move:
play, time, the seek bar, and the **volume** beside them. The speaker mutes and
remembers where you were, and the slider unrolls as soon as you go near it.
Whatever *shapes* the sound (the sub, the crowd, the reverb) stays in the Sound
panel.

When **YouTube** is playing, the five quality buttons appear there too. With
your own file they do not appear at all, because they would mean nothing.

## The crowd

In the **View** panel, the audience slider fills the hall with people: each one
a card with an avatar and a name, sitting in their seat.

The same number fills the sound. Thirty people sound like thirty people, and
because a crowd soaks sound up, the reverb shortens along with them.

## The three places

You are not stuck in the auditorium. There are two more places through the
**back doors**. Walk up to a door, it will tell you where it goes, and press
`F`. You can also change place from the panel or the right click menu.

| Place | What it is |
|-------|------------|
| **Cinema** | The big auditorium |
| **Horror house** | A dark living room with a television, a sofa and rain on the window |
| **Cosy room** | The same, but warm and quiet, with a fire and bookshelves |

**The film follows you**: whatever is playing carries on playing on that room's
television, with the same controls throughout. The lights and the warm-or-cool
keep working too, on whatever fittings that room has.

**And the panel changes with you.** Each place shows only its own: in the cinema
you get curtains, screen format, aisle lights, exit signs, the ceremony and the
audience. In the horror house you get its dread level and its television, in the
cosy room the fire and its own. You never have to scroll past settings that mean
nothing where you are standing.

**Dread**

One slider. At 0 it is a quiet dark living room. As it climbs: rain on the
glass, lightning with a flash, the house creaking, and higher up things dragging
across the floor and a heartbeat underneath.

## The sound

**The film**

- The sound comes off the screen, so it changes as you turn your head.
- Other people's voices come from where they are sitting. The further away, the quieter.
- The first time, the browser will ask for the microphone. Without permission you can hear, but not be heard.
- If you hear nothing, click once inside the page. Browsers do not allow sound before the first click.

**How the room is built**

A cinema is not a church: everything in it is there to **eat** sound. Carpet on
the floor, fabric on the walls, a hundred and forty upholstered seats. So here:

- the **reverb is short and dark**, around a second, and it dies straight away
- the highs are cut long before the lows, the way fabric does it
- the **air in the room** is only just audible, not a horror-film ambience
- **footsteps** are low and muffled, with a single sharp knock off the side walls

The **Room** slider in the sound panel and the menu beside it change how big the
place sounds: from no room at all to a large auditorium.

**The room's own sounds**

Beyond the film, the hall makes its own noises:

- **footsteps** on the carpet, which change when you run with `Shift`
- the **seat** opening as you sit and closing as you get up
- **clicks** on the buttons and small **ticks** as you drag the sliders

Not a single sound file is downloaded: they are all made at the moment you hear
them, so no two footsteps are alike. The **Test the sounds** button in the panel
plays them in order, so you can hear exactly what it is doing.

## The mixing desk

In the **Sound** section of the panel you mix it yourself. First pick a preset
(**Cinema**, **IMAX**, **Quiet room**, **Premiere**, **Home**) and then change
whatever you like on top of it.

| Group | What you set |
|-------|--------------|
| **Room** | Overall volume, the reverb, footsteps and seats, the sound of the air |
| **Film** | The film's level, and how much the highs are pulled back the way real cinemas do it |
| **Sub** | Level, how deep it goes, and from where down it counts |
| **Audience** | How full the hall is, how loud the crowd is, how spread out |

Two things give it its character:

- **The sub** has its own channel that does **not** go through the screen
  speakers. That is how a cinema subwoofer works: below roughly 100 Hz the ear
  cannot tell where a sound is coming from, it just feels it everywhere.
- **The crowd.** The fuller you make the hall, the more life there is around
  you: breathing, clothes, the occasional small cough. At 0 the hall is empty
  and silent. And because a crowd soaks sound up, the reverb shortens as it
  fills.

## The picture

In the **Picture** section you set how the film looks on the screen:
brightness, contrast, colour, warm or cool, mid tones. There are four presets
too: normal, brighter, warm, cool.

In the **Glow** section you set the bloom, that is, how far the screen light
spreads into the dark room. It starts subtle on purpose.

## Views and the frame

`V` cycles through six views: **first person**, **back row**, **projection
booth**, **from the side**, **in front of the screen**, **wide**. `Shift+V` goes
the other way. The camera travels, it does not cut.

`C` gives you the **cinematic frame**: the screen fills your vision, as if you
had leaned into the film. **Click or press a key and you are out**, back where
you were.

Wherever the camera goes, **your ears stay on your body**: the sound comes from
where you are actually standing, not from where the camera is looking.

## The size of the screen

The screen takes up nearly the whole front wall. Its shape changes from the
panel or the right click menu, the way it does in a real hall: the height stays
the same and the **black masks at the sides** close in or open out.

| Option | Shape | When |
|--------|-------|------|
| **Scope** | 2.39:1 | Scope films, the widest |
| **Flat** | 1.85:1 | The classic cinema shape |
| **Widescreen** | 16:9 | YouTube and anything made for a screen |

Whatever is playing fits inside without being stretched.

## The house lights

Each light has its own slider:

| Setting | What it does |
|---------|--------------|
| **House lights** | From out (showtime) to up (interval). They come up slowly, like a real dimmer |
| **Screen glow** | How much the film lights the room around you. At 0 the hall stays dark, at 200% it floods you |
| **Warm or cool** | The colour of the light, from a yellow bulb to daylight white |
| **Aisle lights** | The little lights on the steps. **They start off**, so the floor stays clean |
| **Exit signs** | How much green the exits throw around themselves |
| **Exposure** | Overall exposure, if your monitor shows everything too dark or too washed out |

At the top there are the three presets: **Showtime**, **Half lights**,
**Interval**.

Without even opening the panel, `[` and `]` take the lights down and up in steps
of 10%, and tell you so in the middle of the screen.

Whatever you set is kept in your browser, so the hall opens the way you left it.

## Put your own film on

**From your computer**

1. Press `Esc`.
2. Press the file button and choose your video.
3. Press ▶ and go back into the hall with a click.

Nobody else in the hall can see this one, and the room will tell you so. The
file never leaves your computer.

**From a link**

Write the link in the field beside it and press **Play**. It takes `mp4`,
`webm`, `m3u8`, and **YouTube** or **Vimeo**. This is the one to use if you want
to watch together.

**YouTube**

Paste the link exactly as you copied it (`youtube.com/watch?v=...` or
`youtu.be/...`) and it plays on the big screen. Two things to know:

- The **sound comes out of the YouTube player**, so it does not pass through the
  hall reverb the way your own file does. Volume and pause work normally, and
  how far away you are standing still counts.
- YouTube videos are **16:9**, so set the screen to widescreen for it to fill
  without black gaps.

If a video will not play, its owner has disallowed playback outside YouTube.
Nothing to be done, try another.

**Lists**

Paste a playlist link (`youtube.com/playlist?list=...`, or a video that belongs
to a list) and they play one after another. The right click menu grows a **Next
in the list** with your place in it, for example 3 of 24.

**Quality**

In the **Screen** panel, buttons: **Auto, 720p, 1080p, 1440p, 4K**.

YouTube decides for itself what quality to send, and its yardstick is **how big
the player is**. These buttons change exactly that, which is why they are
buttons: there are specific qualities, not a continuous scale. Higher means a
cleaner picture and more work for the computer.

**A test video**

If you want something on the screen right away, write `/sample.webm` in the link
field and load it. It is a six second colour test pattern that ships with the
project.

## Updates: only when you press them

The page **never refreshes on its own**. You are inside a dark room, in the
middle of a film. When that gets interrupted is your decision.

When there is something newer, a quiet **new version ready** appears at the
bottom right, with two buttons: update now, or **×** for later. The same thing
lives in the right click menu.

- While we are working on the project, every file save shows it.
- On a deployed version, `/version.json` is checked on its own every two and a
  half minutes and every time you come back to the tab.

**What changed**: the button in the panel (or the right click menu) opens the
full list of changes, the same one in [CHANGELOG.md](CHANGELOG.md). The version
you are running is written above it.

The version number comes out of `package.json` and is stamped on every
`npm run dev` and `npm run build` by `scripts/write-version.mjs`.

## Deploying it

One process serves the page **and** runs the room, so the page and the WebSocket
share a single host, port and certificate. Anything else and `wss` on another
port is dead over https and on corporate networks.

```bash
npm run build && npm run server
```

`npm run ship` does the whole round: it commits, pushes the source, deploys, and
then waits for the live build stamp to move before it says it worked. It reads
where to deploy from a `deploy.env` file, which stays on the machine that owns
the address:

```
RAILWAY_SERVICE=<service name>
LIVE_URL=https://<your address>
```

Without that file it still commits and pushes, and simply says it has nowhere to
deploy to.

## Layout

```
virtual-cinema/
  index.html          the page's starting point
  CHANGELOG.md        what changed in each version
  scripts/
    write-version.mjs stamps the version before every dev / build
    ship.mjs          publish the source and deploy, in one press
  public/
    sample.webm       a test video, so there is something on screen at once
  src/
    main.js           joins the pieces together, holds no logic of its own
    scene/            the hall, the screen, the seats, the lighting
    player/           movement, camera, choosing a seat
    media/            the film on the screen and its sound
      embedScreen.js  YouTube and Vimeo inside the room
    i18n/             every string, in Greek and in English
    sound/            the mixing desk, the crowd, footsteps, seats, clicks
    audience/         the people in the seats
    venues/           the horror house and the cosy room
    update/           "new version" and the list of changes
    room/             the room panel, the keys and the right click menu
    net/              presence, spatial voice, and the shared screening
  server/
    index.js          serves the build, WebSocket presence, WebRTC signalling
  tests/              smoke tests and a manual QA script
```

### How the pieces clip together

`src/main.js` loads the modules in order and hands each one whatever the
previous one made. Every module exports a single function:

| Module | Function | Takes | Returns |
|--------|----------|-------|---------|
| `src/scene/index.js` | `createScene` | `{ container }` | `{ renderer, scene, camera, seats, lighting }` |
| `src/player/index.js` | `createPlayer` | `{ renderer, scene, camera, seats }` | `{ update, seat }` |
| `src/media/index.js` | `createMedia` | `{ scene, camera, lighting, ... }` | `{ update, video }` |
| `src/sound/index.js` | `createSound` | `{ media, player }` | `{ click, tick, setVolume }` |
| `src/venues/index.js` | `createVenues` | `{ scene, player, media, sound }` | `{ list, current, go, update }` |
| `src/update/index.js` | `createUpdater` | `{ sound }` | `{ available, apply, showChangelog }` |
| `src/room/index.js` | `createRoom` | `{ lighting, sound, player }` | `{ setHouseLights, applyPreset }` |
| `src/net/index.js` | `createNet` | `{ url, scene, camera, player, media }` | `{ update }` |

The order is not arbitrary: the room sound borrows the film's AudioContext, and
the lights panel wants both the lighting and the sound.

Everything returned is optional. If a module has `update(delta)`, `main.js`
calls it every frame. If it has `resize()`, it calls it on every resize. If a
module is missing or throws, the page still comes up and writes what is missing
at the bottom left.

For checking, `window.__cinema` shows the boot state:

```js
__cinema.ready      // true once startup finished
__cinema.started    // which modules started
__cinema.errors     // what went wrong
```

## Settings

| Variable | Default | What it does |
|----------|---------|--------------|
| `PORT` | `8787` | The server's port |
| `VITE_SERVER_URL` | `ws://localhost:8787` | Where the client connects |

Put them in a `.env` file at the root, or in front of the command:

```bash
PORT=9000 npm run server
```

## Checks

```bash
npm test
```

Quick smoke tests, no browser:

- the shape of the project and the npm scripts are where they should be
- every module exports the function `main.js` expects
- the server comes up and takes **two users at once** without falling over

Pieces that do not exist yet come out as `skipped`, they do not go red.

```bash
npm run test:browser
```

Opens a real browser and checks that the hall draws, that the film advances,
that `W` walks and makes footsteps, that `E` puts you in a seat, that the lights
go up and down, that the aisle lights start off, that the screen changes through
all three formats, that right click opens our menu, that YouTube links are
recognised, and that the room sounds produce a real signal. It wants Playwright:

```bash
npm i -D playwright && npx playwright install chromium
```

If it is not installed, it comes out `SKIPPED` and does not break the build.

```bash
npm run test:halls
```

Two real browsers, one hall: one person starts a film and lets it run, a second
walks in afterwards and has to land inside the same minute. Point it at a
deployed address with `ORIGIN=https://... npm run test:halls`.

For everything that needs eyes and ears, there is a step by step script in
**[tests/QA-MANUAL.md](tests/QA-MANUAL.md)**.

## If something is not working

| Problem | What to look at |
|---------|-----------------|
| Black screen | The bottom left says which piece is missing. Also look at the console with `F12` |
| The mouse will not lock | Press the start button, or click once inside the hall |
| I cannot see the control bar | Press `Esc`. It hides while you walk |
| I cannot see the room panel | Press `L`. That one hides while you walk too |
| A YouTube link will not play | The video's owner disallows playback elsewhere. Try another video |
| YouTube sound has no room on it | That is how it is: their player keeps hold of the sound. With your own file it has |
| The YouTube picture has black at the sides | Set the screen to widescreen |
| I cannot hear footsteps | Click once inside the page, and check the room sounds switch in the panel |
| The hall is too dark | Bring the lights up with `]`, or the screen glow in the panel |
| I am walking while typing a link | Click somewhere outside the field and try again, and tell us about it |
| I cannot see anybody else | Is `npm run server` running? Look at its terminal |
| Nothing at all is audible | Click once inside the page and allow the microphone |
| `Port 5173 in use` | A `npm run dev` is already running. Close it or let Vite take 5174 |
| I can hear myself | Put headphones on |

## Licence

MIT. See [LICENSE](LICENSE).

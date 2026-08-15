# Manual QA checklist

A plain hands-on pass, for the round with the **dark hall**, the **first person
walking** and **your own video**. It takes 10 minutes and somebody outside the
project can run it on their own.

## Before you start

Open two terminal windows inside the project folder:

```bash
npm run server   # window 1 (only needed for more than one viewer)
npm run dev      # window 2
```

Then open **http://localhost:5173** and put headphones on.

---

## A. The basic round

Do the steps in order. Tick the box when you see what the right hand column
says.

| # | What I do | What I should see | ✔ |
|---|-----------|-------------------|---|
| 1 | Open `http://localhost:5173` | Within a few seconds the hall loads and I see **Enter the room** | [ ] |
| 2 | Press **Enter the room** without having put a film on | I go straight in. It does **not** ask me for a file, no dialog opens | [ ] |
| 3 | Look at the mouse pointer | The pointer is gone, the mouse has locked to the page | [ ] |
| 4 | Move the mouse left and right | The view follows smoothly, no juddering, and it does not flip over | [ ] |
| 5 | **Move the mouse very fast, with sharp turns** | **No snapping back, no momentary somersault**, the picture follows my hand | [ ] |
| 6 | Look right up and right down | It stops at the top and bottom limit, it does not tumble | [ ] |
| 7 | Press `W` | I walk forward | [ ] |
| 8 | Press `S` `A` `D` | I go back, left, right, always relative to where I am looking | [ ] |
| 9 | Walk into a wall and into seats | It stops me, I pass through nothing and I do not get out of the hall | [ ] |
| 10 | Walk up to a free seat | The seat stands out and tells me I can sit | [ ] |
| 11 | Press `E` | I sit in the seat, at eye height, facing the screen | [ ] |
| 12 | **Sit and look straight at the screen** | **The front row stays low, it does not climb into the picture** | [ ] |
| 13 | Move the mouse while seated | I look around normally, but I do not leave the seat | [ ] |
| 14 | Press `E` again | I stand up and walk again | [ ] |
| 15 | Press `V` | I see the whole hall from a wide shot | [ ] |
| 16 | Press `V` again | I come back to my own eyes, in the same place I was | [ ] |
| 17 | Look at the hall in general | It is **dark**. The light comes off the screen, not off lamps | [ ] |
| 18 | Look at walls and seats as the film cuts to another scene | The light on them changes with the film | [ ] |
| 19 | Press `Esc` | The mouse unlocks and I see the pointer and the control bar again | [ ] |

- [ ] **A passed**

## B. Putting my own video on

The control bar is along the bottom. It hides while the mouse is locked, so
press `Esc` first to see it.

| # | What I do | What I should see | ✔ |
|---|-----------|-------------------|---|
| 1 | Press `Esc` | The control bar appears | [ ] |
| 2 | Press the file button and choose one of my own videos | The video appears on the hall screen | [ ] |
| 3 | Press ▶ | The film starts and the time runs | [ ] |
| 4 | Drag the seek bar | The film goes to the point I picked | [ ] |
| 5 | Look at the shape of the picture | It is neither stretched nor squashed, whatever the video's dimensions are | [ ] |
| 6 | Put a video link in the field beside it and press **Play** | That plays too | [ ] |
| 7 | Put a wrong link in on purpose | It tells me so with a message, the page does not hang | [ ] |
| 8 | Type the letters `w` `a` `s` `d` inside the link field | They type normally, I do **not** walk around the hall | [ ] |
| 9 | Go back into the hall with a click | My film carries on playing | [ ] |

**From YouTube**

| # | What I do | What I should see | ✔ |
|---|-----------|-------------------|---|
| 10 | Paste a `youtube.com/watch?v=...` link and press **Play** | The video plays on the hall screen, in perspective | [ ] |
| 11 | Walk around and look at it from the side | The picture leans with the screen, it is not stuck to the glass | [ ] |
| 12 | Press pause and change the volume from the bar | It obeys, and the time runs correctly | [ ] |
| 13 | Read the note under the controls | It tells me the sound comes out of the YouTube player | [ ] |
| 14 | Set the screen format to widescreen | The picture fills the screen with no black at the sides | [ ] |
| 15 | Load one of my own files again | YouTube goes away and the screen is normal again | [ ] |
| 16 | Look at something standing in front of the screen (a speaker, a seat) | It hides it properly, the picture does not come through it | [ ] |

- [ ] **B passed**

## B2. Screen format and the right click menu

| # | What I do | What I should see | ✔ |
|---|-----------|-------------------|---|
| 1 | In the panel, press **Flat 1.85:1** | The black masks close in from the sides and the picture narrows | [ ] |
| 2 | Press **Widescreen 16:9** | It narrows further, the height stays the same | [ ] |
| 3 | Press **Scope 2.39:1** | The masks open all the way and the screen takes the whole wall | [ ] |
| 4 | **Right click** inside the hall | Our menu opens, **not** the browser's copy and paste one | [ ] |
| 5 | Right click while the mouse is locked | The mouse is released and the menu opens in the middle | [ ] |
| 6 | Choose something from the menu | It does what it says and the menu closes | [ ] |
| 7 | Right click inside the link field | Here the browser menu comes up normally, for pasting | [ ] |
| 8 | Right click and press `Esc` | The menu closes without anything happening | [ ] |

- [ ] **B2 passed**

## C. The house lights

The room panel hides while you walk, so press `L` to see it.

| # | What I do | What I should see | ✔ |
|---|-----------|-------------------|---|
| 1 | Press `L` from inside the hall | The mouse is released and the lights panel appears | [ ] |
| 2 | Drag **House lights** upwards | The lights come up **slowly**, not abruptly, and I see walls and ceiling | [ ] |
| 3 | Take it back down to 0 | The hall goes dark again, only the screen light and the safety lamps are left | [ ] |
| 4 | Press **Interval** | The lights come up and the button stays pressed | [ ] |
| 5 | Press **Showtime** | The lights go out again | [ ] |
| 6 | Drag **Screen glow** to 0 | The film plays, but it no longer lights the room | [ ] |
| 7 | Drag it to 200% | The hall floods with the light of the film | [ ] |
| 8 | Drag **Warm or cool** to the right, with the lights up | The light goes daylight white, from the yellow it was | [ ] |
| 9 | **Look at the floor with the lights out** | **Clean carpet, no orange patches** | [ ] |
| 10 | Drag **Aisle lights** to 100% | Now and only now do the little lights on the steps appear | [ ] |
| 11 | Drag **Exit signs** to 0 | The exits stop throwing green around themselves | [ ] |
| 12 | Drag **Exposure** up and down | The whole picture opens up and darkens with it | [ ] |
| 13 | Go back into the hall and press `]` three times | The lights come up in steps of 10% and it tells me in the middle of the screen | [ ] |
| 14 | Press `[` three times | They go back down the same way | [ ] |
| 15 | Close and reopen the page | The light settings are as I left them | [ ] |

- [ ] **C passed**

## D. The room's own sounds

With headphones, and with the film **paused** so they can be heard clearly.

| # | What I do | What I should hear | ✔ |
|---|-----------|--------------------|---|
| 1 | Walk with `W` | Footsteps on carpet, one at a time, in step with the walking | [ ] |
| 2 | Stop | The footsteps stop at once, they do not carry on by themselves | [ ] |
| 3 | Run with `Shift` | The footsteps get closer together and louder | [ ] |
| 4 | Walk into a wall and keep pressing `W` | No footsteps, because I am not going anywhere | [ ] |
| 5 | Sit with `E` | The seat is heard opening and taking the weight | [ ] |
| 6 | Stand with `E` | The seat is heard folding back | [ ] |
| 7 | Press a button in the lights panel | A clean click | [ ] |
| 8 | Drag a slider | Small ticks, one per step, not a carpet of noise | [ ] |
| 9 | Stand still and listen | Almost total quiet, the air only just audible. **No "atmosphere"** | [ ] |
| 10 | Listen behind each footstep | One sharp, low knock off the walls, cut off at once. No reverb tail | [ ] |
| 11 | Press **Test the sounds** in the panel | In order: two footsteps, a seat, a switch | [ ] |
| 12 | Take **Room sound effects** down to off | Silence. The film's sound carries on normally | [ ] |
| 13 | Switch it back on | The sounds come straight back | [ ] |

- [ ] **D passed**

## E. The film's sound

| # | What I do | What I should hear | ✔ |
|---|-----------|--------------------|---|
| 1 | Listen on headphones, facing the screen | The sound comes from in front of me | [ ] |
| 2 | Turn my back on the screen | The sound comes from behind me | [ ] |
| 3 | Turn left so the screen is on my right | The sound is heard more in the right ear | [ ] |
| 4 | Walk to the back row | The sound drops away gradually, it does not cut | [ ] |
| 5 | Move the **Room** slider in the panel | The reverb changes, as if the size of the place changed | [ ] |
| 6 | Take the volume all the way down and back up | It follows immediately | [ ] |
| 7 | Switch tabs and come back | Picture and sound are together, they have not come apart | [ ] |

- [ ] **E passed**

## F. More than one viewer (if the server is running)

| # | What I do | What I should see | ✔ |
|---|-----------|-------------------|---|
| 1 | Open a second window in private browsing, on the same link | It joins the same hall | [ ] |
| 2 | Look from the first window | I see the second viewer inside the hall | [ ] |
| 3 | Sit with `E` in one | The other shows them seated, in exactly the same seat | [ ] |
| 4 | Walk in one | In the other the movement is smooth, no snapping | [ ] |
| 5 | Allow the microphone and talk | It is heard in the other window, from the side they are sitting on | [ ] |
| 6 | Close the second window | The viewer leaves the hall within a few seconds | [ ] |
| 7 | Look at the server terminal | No red lines, the server carries on running | [ ] |

- [ ] **F passed**

## G. Updates and the changelog

| # | What I do | What I should see | ✔ |
|---|-----------|-------------------|---|
| 1 | Open the page and sit inside the hall for a few minutes | **Not once does it refresh on its own** | [ ] |
| 2 | (While we are working) a project file is saved | "New version ready" appears at the bottom right. The page does **not** reload | [ ] |
| 3 | Press the **×** on the message | It goes away and I carry on with what I was doing | [ ] |
| 4 | Right click again | The menu has "Update to the new version" in it | [ ] |
| 5 | Press **Update** | Now and only now does the new version load | [ ] |
| 6 | Press **What changed** in the panel or the menu | The list of changes opens, with the version I am running above it | [ ] |
| 7 | Press `Esc` or click outside the window | It closes, without touching anything else | [ ] |

- [ ] **G passed**

## H. A last look

| # | What I do | What I should see | ✔ |
|---|-----------|-------------------|---|
| 1 | Open the console with `F12` | No red lines | [ ] |
| 2 | Type `__cinema` and Enter | `ready: true` and every `started` at `true` | [ ] |
| 3 | Resize the window | The picture follows, it is neither cropped nor distorted | [ ] |
| 4 | Leave it open for 10 minutes | It stays smooth, it does not get heavy | [ ] |

- [ ] **H passed**

---

## Automated checks

```bash
npm test              # quick, no browser
npm run test:browser  # opens a real browser (wants Playwright)
npm run test:halls    # two browsers, one hall, shared screening
```

Pieces that have not arrived yet come out `skipped`, they do not go red.

---

## Findings from the last full run

State: **14 August 2026**, version **0.4.0**: calm mouse, low seats, entry
without a film, changelog and manual updating.

### `npm test`: 15 passed, 0 failed, 0 skipped

All seven pieces were in (`scene`, `player`, `media`, `sound`, `update`,
`room`, `net`) plus `server/`. The two simultaneous viewers check passes.

### The page does not reload on its own

Measured: leave a mark on the page, change a project file, and the mark is
still there afterwards. In place of the refresh, the new version message
appeared.

### `npm run test:browser`: 18 passed, 0 failed

In a real browser: we went into the hall **without a film**, the test video
went onto the screen and advanced, `W` walked and produced footsteps, `E` put
the player in the seat, the lights went up and back down, the aisle lights were
found off and came on when asked, the screen changed through all three formats
(22.94 → 17.76 → 17.07 metres wide), right click opened our menu, YouTube and
Vimeo links were recognised, the new version message appeared only when asked
for and the change list was read, and the room sounds produced a measurable
signal (silence measured 0, so that a circuit playing nothing cannot pass).

The look was measured too: 20 movements of 40 pixels gave exactly 1.60 rad of
turn, an unnatural 9000 pixel jump was ignored whole, and the view stopped at 85
degrees up and down without flipping over.

### A real YouTube link

Tried with a real video: it went onto the screen in perspective, started on its
own, the bar showed the right duration (10:34) and the stage speakers occluded
it properly from the front. Going back to a local file, the screen recovered.

### One that looked wrong and was not

In the test video (`public/sample.webm`) the colour band looks wider than the
vertical bars. It is like that inside the file itself, the projection is not at
fault: checked by pulling a frame straight out of the file.

### `npm run build` works again

It was broken, and with it **the whole page under `npm run dev`**: the new vite
stopped at `Failed to resolve import "./scene.js"`. `src/main.js` was also
trying fallback paths (`./scene.js`, `./player.js` and so on) that do not exist
on disk. **One** path per piece was left and both were fixed.

### A small one

There is `server/smoke-test.js`. It does not run under `npm test`, because that
only looks at the `tests/` folder. If it should be in the run, say so and it
goes into the script.

---

## If something goes wrong

Write down: the step number, what you saw, which browser you have, and what the
console (`F12`) and the server terminal said.

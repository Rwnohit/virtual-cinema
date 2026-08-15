# What changed

Every version, in plain words. Newest at the top.

## 0.23.0 · 15 August 2026

- **All 88 films, not 36.** The builder stopped early and was quietly hiding
  two thirds of the festival. It now walks the whole feed.
- **The programme is a grid that scrolls DOWN**, four across, instead of one
  long strip you had to drag sideways.
- **Sort it three ways**: most watched, most liked, feature length. With the
  count of everything showing.
- **Pressing start puts the panel away**, so you are looking at the film and
  not at the menu you just used.
- **An interval button.** It pauses for the whole hall and brings the house
  lights up, the way a real one does. Press it again to carry on and the lights
  go back down on their own.
- 🐛 The interval used to do nothing visible if you pressed it within a second
  of starting a film: it moved the lights by hand while the opening fade was
  still running, and the fade won.

## 0.22.0 · 15 August 2026

- **The programme is the festival's own.** 36 films from the Higgsfield
  community feed - names, synopses, covers, creators - fetched by
  `scripts/build-library.mjs`. Nothing is copied: every entry keeps their
  stream and their poster, and each viewer's browser fetches the film from them.
- **The Library is now a foyer, not a list.** One film big, with its poster
  drifting behind it, its **runtime**, its creator and its synopsis. The rest
  runs along a rail underneath.
- **Choosing from the rail brings a film up; the button starts it.** In here a
  click plays for the whole hall, and that should not happen by brushing past a
  thumbnail.
- Colours and type are measured off higgsfield.ai, not guessed: lime #D1FE17 on
  near-black, dark type on the lime.

## 0.21.0 · 15 August 2026

- **🎞 A Library tab: the programme, on the wall.** Posters you can click, and
  picking one starts that film **for the whole hall**, from the same moment -
  exactly as pasting its link does.
- **The catalogue is ONE file.** `/library.json` holds the titles, posters and
  links. A venue that wants its own programme replaces that one file, or points
  it at their own feed, and the cinema fills with it. Nothing else has to know
  where films come from.
- Films served this way get what YouTube never could: **the hall's own sound**
  reaches them - reverb, sub, the two screen channels.

## 0.20.1 · 15 August 2026

- 🐛 **Serious, and one day old:** as soon as there were two of you in a hall,
  the second person could not play a film from a file or a direct link. The
  video channel that screen sharing uses was taking over their cinema screen
  even when nobody was sharing anything down it. It hid behind YouTube, which
  draws in a frame of its own and never touches that element.

## 0.20.0 · 15 August 2026

- **📡 Share your screen with the hall.** A new button on the bar, next to the
  speaker. You pick a tab or a window, and **everybody sees exactly what you
  see**, with its sound.
  - **There is nothing to keep in sync.** It is one picture sent to everyone,
    not four players trying to agree. That settles both the freezing and the
    "one of us is ahead of the other".
  - **It plays ANYTHING**: a file off your computer, YouTube, whatever you have
    open. It also settles "my own files cannot be shared".
  - Measured: the second viewer got **1350x1050** and the colour the first one
    sent, pixel for pixel.
- **What it costs, honestly:** the picture leaves YOUR line, one copy per
  person. On a home upload that means a few people, not a full hall. And
  **Netflix and Disney+ come out black**, which is the whole point of their
  protection.
- 🐛 **Three things still came out in Greek for an English viewer**: the
  captions of the ceremony, the names of the picture presets, and every message
  about something not playing. All of them go through the language switch now.

## 0.19.0 · 15 August 2026

- **The hall is ONE room now.** Curtain, lights, people in the seats and screen
  format are shared: whatever you change, everybody sees, and anyone who comes
  in later finds the hall the way you left it.
  - Only your **sound** and your **picture** stay yours. There is no sense in
    one person's headphones setting another person's speakers.
- 🐛 **The freezing.** If you were playing a film the hall could not see (a file
  off your own computer), the hall **paused you all by itself**.
- 🐛 **The video stuttered.** Sync corrected every 1.5 seconds; if one player
  was loading slowly, it fell into a vicious circle. Now it corrects rarely and
  only when it is sure.
- 🐛 **Play and pause immediately after walking in** were ignored. The system
  now tells "I did that" from "the hall told me" by meaning, not by a timer.

## 0.18.0 · 15 August 2026

- 🐛 **If you walked in and put a film on IMMEDIATELY, the film never reached
  the others.** For a second after entering, whatever you did was thrown away.
- 🔴 **A film off your own computer cannot be shared**, and now it says so
  plainly: a **permanent yellow notice** at the top, which does not go away
  until you use a link. Before, it was a 1.6 second message that "Enjoy the
  film" wiped out before you could read it.
- **The link field is now open from the start**, with the line "put a link in
  and the WHOLE hall sees it". The file button now says "A file off your
  computer (only for you)".
- 🐛 An error was logged to the console when the browser refused the mouse in a
  window that was not in front. It was not a fault, it was normal.

## 0.17.0 · 15 August 2026

- **The reverb goes much further.** The room reverb slider stopped at 60%. It
  now reaches 100%, and the part that was added is **real**: measured, from 60%
  to 100% the tail gains **8.8 dB**.
- **A new "reverb length" slider** next to it: from 0.15 to 3.5 seconds. That
  changes the *size of the place*, not the amount. Measured, the film rings on
  from 0.77 to **3.05 seconds** after the sound.
- **Whatever you had set stays exactly as it was.** The curve is built so the
  bottom half does not move at all (in the cinema preset, 0.2 dB of difference).
- ℹ️ The reverb catches a film **from a file**. YouTube plays in its own player
  and cannot be routed through the hall.

## 0.16.0 · 15 August 2026

- **Four halls, one screening each.** At the start you pick a door and see what
  is going on behind each one: how many are in, what is playing, how many
  minutes in it is. The halls cannot see each other.
- **You land where the film is.** If somebody is already 20 minutes in, you
  start at minute 20, not at the opening frame. Measured: the second viewer
  landed at second 445, 0.7 seconds out.
- **Play, pause and seeking reach everybody** in the same hall.
- **You write your name at the door.** It lasts as long as the visit, and the
  others see it.
- 🐛 The hall menu was rebuilt every 4 seconds and **ate your click**. It now
  refreshes without the button going missing.
- 🐛 When you moved forward in the film, **it pulled you back**: the hall never
  learned that you had seeked, and treated it as lag.
- 🐛 Right after a film started, **your clicks were ignored** for as long as the
  ceremony (curtain and lights) lasted.
- ℹ️ A film off your own computer is seen only by you. A shared screening wants
  a link.

## 0.15.0 · 15 August 2026

- **A YouTube film is now heard from where you are standing.** Walk to the back
  and it drops, turn your back and it drops further, exactly like a normal file.
  Measured: in front 100%, back row 61%, with your back turned 50%.
- **A new "YouTube distance" slider** in the Sound panel: at 0 the film sounds
  the same wherever you are, at 100% it moves as much as the hall says.
- **What is NOT possible, and why.** The hall reverb and the sub cannot reach
  YouTube. The only road that exists was tried (taking the tab's sound from the
  browser) and it was measured that the browser hands **our own sounds back to
  us** as well: a tone of 0.40 came back as 0.48, which is feedback. The two
  settings that are supposed to solve it did not.
- 🐛 Fixed: the head was being read backwards, so turning your back on the
  screen would make the sound **louder**.

## 0.14.0 · 15 August 2026

- **YouTube sound finally listens to the bar.** Until now YouTube played at its
  own level and no room control reached it. The master and film levels now set
  it properly, and mute closes it. (The hall reverb and the sub still cannot
  reach it: the sound comes out of their player.)
- **YouTube subtitles: a switch in the Screen panel.** YouTube was turning
  subtitles on by itself. They are now **off**, and you turn them on only if you
  want them.
- **A clean screen on one button (🎬).** On the bar, where the volume slider
  used to be. One press and **everything** goes: the bar, the hints, the sight
  in the middle, the "in the room" tag, the film button. Only the film is left.
  Back with **L** or **Esc**, or with a right click.
- The volume is still one click away: the speaker mutes, and the slider lives in
  the **Sound** panel under the master level.

## 0.13.0 · 14 August 2026

- **The hall puts itself right.** If for any reason a film is playing with the
  curtain closed or the lights up, within half a second the curtain opens and
  the lights come down. You do not have to press anything.
- **Play always takes.** Before, if the previous film had left the ceremony
  half done, the next one started without it.
- **The version is written as you walk in** ("Virtual Cinema v0.13.0"), so you
  know at once whether your page is old and wants the update button.

## 0.12.0 · 14 August 2026

- **The film starts immediately.** You press play and it plays; the curtain
  opens and the lights come down **over the top of it**, in the first few
  seconds. No more waiting in the dark.
- **The showtime lights are yours.** The three presets (Showtime, Half lights,
  Interval) now hold **all six** settings, and the ceremony goes exactly there.
  In Lights there is **Save the current lights as**: set the hall up the way you
  want it and make it showtime with one click.
- **The interval comes five seconds before the end**, the way it does in a real
  hall, and **the curtain does not close again** on its own.
- **Volume on the bar**, next to the time: the speaker mutes and remembers where
  you were, and the slider unrolls as soon as you go near it. The mixing desk
  stays in the Sound panel.
- **YouTube quality moved down to the bar** and appears **only when YouTube is
  playing**.
- **A switch for the room's own sounds** (footsteps, seats, crowd, room), so you
  can hear the difference.
- And the small tag with the crowd and the microphone speaks English now too.

## 0.11.0 · 14 August 2026

- **Each place shows only its own.** In the cinema you see curtains, screen
  format, aisle lights, exits, the ceremony and the audience. In the horror
  house only its own, in the cosy room only its own. The panel is rebuilt as
  soon as you go through the door.
- **The curtains are now the first thing** in the Screen panel, and they went
  into the **right click menu** as well: open or closed, no hunting.
- **The ceremony moved to Lights** (where it belongs) and **the audience to
  View**.
- **The queue waits for you.** Normally you press next and it goes on. The
  automatic gap is now a switch you turn on only if you want it.
- **The English was fixed** everywhere: light presets, sound and group names,
  views, picture looks and every value that was still coming out in Greek.

## 0.10.0 · 14 August 2026

- **Undo on every setting.** A small ↺ appears beside every slider the moment
  you touch it, and puts it back where it was. Every page has its own **Reset
  all** too.
- **YouTube quality became buttons**: Auto, 720p, 1080p, 1440p, 4K. The slider
  was the wrong idea: YouTube gives specific qualities, not a continuous scale,
  so a slider promised a precision that does not exist.
- **The curtains move much more slowly**, like thirty kilos of velvet on a
  motor: the travel takes close to five seconds instead of one and a half.
- **Open and closed buttons** for the curtains, alongside the slider, in the
  Screen panel. You no longer have to hunt for the end of a slider to close them.

## 0.9.0 · 14 August 2026

- **Greek and English.** The whole menu, the messages and the sliders change
  language from View, and it remembers your choice. The first time round it
  follows your browser.
- **A film queue.** The link field now also has **Add to queue**, and a new
  panel shows what is coming, with buttons to play something now or take it out.
- **You set the gap between films**, from 5 seconds to 5 minutes. The next one
  only starts once the hall has brought its lights up, and it brings the whole
  ceremony with it: lights down, curtain, film.
- **The curtain is always closed at the start**, whatever you had set, so the
  first play always has something to open.

## 0.8.0 · 14 August 2026

- **The screening ceremony.** The hall waits for you the way a real one does:
  lights up, curtain closed. You press play and **the lights fade down, the
  curtain opens, and only then does the film start**. When it ends, ten seconds
  of dark, then the lights come up and the curtain closes. You switch it off
  from View, and next to it there is a start now for when you are in a hurry.
- **People in the seats.** Cards with an avatar and a name sit in the seats,
  with a slider for how many. The same number fills the sound: 36 people sound
  like 36 people.
- **A new menu: the console at the bottom.** A bar like a remote control along
  the bottom, with play, the time and five buttons. The panels open above it and
  close with a click. As long as you touch nothing, the picture is completely
  clean.
- The old film panel was folded into the bar, so there are no longer two panels
  saying the same things.
- On a computer with no graphics card, the glow is drawn more simply instead of
  taking the page down with it.

## 0.7.0 · 14 August 2026

- **Zoom on the mouse wheel.** Roll forward and the lens closes in. Keep going
  past the end and the **cinematic frame** comes in by itself. Roll back and it
  unwinds from the same points, back where you were.
- **The screen colours paint the room.** A wide pool of light falls on the
  carpet in front of the screen, and the light coming back off the floor
  colours the whole hall. A red scene makes the room red, not blue.
- **YouTube playlists.** Paste a list link (`playlist?list=...` or a video
  inside a list) and they play in order. The right click menu has a next in the
  list with your place in it, for example 3 of 24.
- **Picture quality** on a slider of its own. On YouTube the quality is decided
  by how big the player is, so the slider changes exactly that. On your own file
  it sets the sharpness on the screen.
- **Caps Lock** hides and brings back the little sight in the middle.

## 0.6.0 · 14 August 2026

- **The sound plays from left and right again.** The mixing desk was sending
  the bass twice, once spread across the speakers and once in mono and louder,
  and the mono one was drowning the other. Measured: the left to right
  difference on a 90 degree turn had fallen to 0.7 dB on IMAX, it is now 3.4,
  and 6.1 on Cinema.
- **The sound sliders actually do something now.** The master had 4.6 dB of
  travel, it now has 40. The reverb was taking the overall level down instead of
  adding to it.
- **The sound presets really differ** from one another.
- **Jump with `Space`**, just as far as a person jumps. You cannot climb onto
  seats and you cannot get out of the room.
- **No yellow seat** when you come near. You know where you are going to sit.
- **The speakers in front of the screen are gone.** In a real cinema they are
  behind the screen, which is why you never see them.
- **Curtains that open and close** with weight: they gather, one lags behind the
  other and they sway a little before they settle.
- **You can type the time.** Click on the time and type `1:21:04`.
- **The picture filters reach YouTube** now too, not only your own file.
- **You can sit down in both houses**: sofa, armchair, and in the cosy room a
  bench at the window. The sofa finally faces the television.
- **Views of their own in each room** with `V`, and the cinematic frame works
  everywhere.
- **The frame leaves on a click**, not the moment you move the mouse, so you can
  look around while the screen fills your vision.
- **The horror house rebuilt**: a corridor that goes somewhere dark, a door left
  ajar, wallpaper coming away, the mark of a picture that is not there any more.
  A chair that only moves when you are not looking at it, and something standing
  at the end of the corridor.
- **The cosy room rebuilt**: a different room shape, beams, a fire, a sleeping
  cat, and a **window** with snow outside.
- **Television size** adjustable in each house.

## 0.5.0 · 14 August 2026

- **Two new places.** Through the back doors of the hall you get into a **horror
  house** with a television, a sofa and rain on the window, or a **cosy room**
  with a fire. The film follows you and plays on the television, with all the
  same controls. Walk up to the door and press `F`.
- **A dread slider**: rain, lightning, creaking, and higher up things dragging
  across the floor.
- **A mixing desk.** Sliders of your own for the film, the sub, the crowd,
  footsteps and the room, with five presets you then change however you like.
- **Ambience from the crowd**: the fuller the hall, the more life around you,
  with the odd cough and shift. Empty hall, total quiet.
- **The sub makes the hall.** A separate channel for the low end that does not
  go through the screen speakers, exactly like a cinema subwoofer.
- **Several views on `V`**: first person, back row, projection booth, from the
  side, in front of the screen, wide.
- **A cinematic frame on `C`**: the screen fills your vision, and you leave the
  moment you move the mouse.
- **Picture filters**: brightness, contrast, colour, warm or cool, mid tones,
  with four presets.
- **Glow (bloom)** around the screen, adjustable.
- The panel was split into sections that open and close, because it had got to
  26 sliders.
- **Fixed**: if you loaded a file and then YouTube, the file stayed on top and
  you could not see the YouTube.

## 0.4.0 · 14 August 2026

- **The mouse does not judder any more.** The look is read straight off the
  mouse movement, without the trip out to the camera and back that made fast
  turns jump. The browser's unnatural jumps are ignored and we ask for raw
  movement, without the Windows acceleration.
- **Smaller seats.** The back was cut down and eye height went up, so the front
  row no longer climbs into the bottom of the picture.
- **You go in without putting a film on.** The button says enter the room and
  puts you in. The film goes on whenever you want, or never.
- **Updates only when you press them.** No more sudden refreshes: when there is
  a new version, a quiet message appears at the bottom right and you update.
- **A changelog inside the app**, from the right click menu.
- Shadows are worked out once instead of every frame, which is faster too.

## 0.3.0 · 14 August 2026

- **A much bigger screen**, with three formats: Scope 2.39:1, Flat 1.85:1 and
  Widescreen 16:9. They change with black masks closing in from the sides, the
  way they do in a real hall.
- **YouTube and Vimeo links play**, on the screen and in perspective.
- **Right click is the room menu**, not the browser's copy and paste.
- **The sound was rebuilt like a real cinema**: short dark reverb, almost no
  room air, low muffled footsteps with one sharp knock off the walls.
- **A clean floor.** The aisle lights start off, and every light now has a
  slider of its own (house, screen, warm or cool, aisle, exits, overall
  exposure).
- A bigger hall, more seats, a test button for the sounds.

## 0.2.0 · 14 August 2026

- **Adjustable lighting** with a panel at the top right, three presets and the
  `[` `]` keys. The lights come up slowly, like a real dimmer.
- **Room sounds**: footsteps on the carpet, a seat opening and closing, clicks
  and ticks on the controls. All made at the moment you hear them, with no
  sound files at all.
- Fixed the error that stopped the main page opening at all.

## 0.1.0

- The first hall: a 3D room, first person walking, seats, a film on the screen
  with spatial sound, and more than one viewer connected.

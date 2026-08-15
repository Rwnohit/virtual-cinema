/**
 * Browser smoke test: the hall loads and the film plays.
 *
 *   npm run test:browser
 *
 * Brings up vite and the server, opens the page with Playwright, and checks:
 *   1. window.__cinema reaches ready with no boot error
 *   2. there is a canvas with real dimensions (the scene drew)
 *   3. the video advances (currentTime goes up)
 *   4. W A S D moves you and makes footsteps
 *   5. the house lights go up and come down
 *   6. the room sounds produce a real signal
 *   7. the screen changes through all three formats
 *   8. right click opens our own menu
 *   9. YouTube and Vimeo links are recognised
 *  10. you can walk in without putting a film on
 *  11. the look neither jumps nor flips over
 *  12. the update waits to be pressed
 *
 * Wants Playwright. Without it, the run comes out SKIPPED (exit 0):
 *   npm i -D playwright && npx playwright install chromium
 */

import fs from 'node:fs'
import { SERVER_ENTRIES, at, firstExisting, sleep, startProcess, waitForPort } from './helpers.mjs'

const CLIENT_PORT = 5173
const SERVER_PORT = 8787
const results = []

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

let playwright
try {
  playwright = await import('playwright')
} catch {
  console.log('SKIPPED: Playwright was not found.')
  console.log('Install: npm i -D playwright && npx playwright install chromium')
  process.exit(0)
}

const serverEntry = firstExisting(SERVER_ENTRIES)
const client = startProcess('npm', ['run', 'dev'], { PORT: String(CLIENT_PORT) })
const server = serverEntry
  ? startProcess(process.execPath, [serverEntry], { PORT: String(SERVER_PORT) })
  : null

let browser

// A CEILING ON ITS LIFE. The headless browser draws the hall with
// SwiftShader, which means on the processor: for as long as it lives, it
// eats CPU. A run that hung, or lost its parent when the terminal closed,
// was left orphaned for days. Whatever happens, everything dies here.
const BUDGET_MS = 6 * 60 * 1000
let torndown = false
function teardown(reason) {
  if (torndown) return
  torndown = true
  if (reason) console.log(`\n${reason}`)
  // The browser closes asynchronously, so its process gets a plain kill as
  // well: on a violent exit there is no time for close() to run.
  try {
    browser?.process()?.kill()
  } catch {}
  browser?.close().catch(() => {})
  client.stop()
  server?.stop()
}
const watchdog = setTimeout(() => {
  teardown(`OUT OF TIME: the run passed ${BUDGET_MS / 60000} minutes, everything closes.`)
  setTimeout(() => process.exit(1), 1500).unref()
}, BUDGET_MS)
watchdog.unref()
process.on('exit', () => teardown())
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(signal, () => {
    teardown(`Interrupted (${signal}).`)
    setTimeout(() => process.exit(130), 1000).unref()
  })
}
try {
  const clientPort = await waitForPort([CLIENT_PORT, 5174, 5175], 40000)
  if (!clientPort) throw new Error(`vite did not come up:\n${client.output()}`)
  if (server) await waitForPort([SERVER_PORT], 15000)

  browser = await playwright.chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  // A smaller window on purpose: the headless browser draws on the
  // processor, and at 1280x800 with the bloom composer on top the page
  // died halfway through the run. The hall does not have to be big to
  // be measured.
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } })
  const pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(err.message))

  await page.goto(`http://127.0.0.1:${clientPort}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__cinema?.ready === true, null, { timeout: 30000 })

  // Bloom holds a big antialiased buffer, which on SwiftShader is the
  // most expensive thing on the page. Its values are checked properly
  // further down, it simply is not drawn while the run is going.
  await page.evaluate(() => window.__cinema.handles.scene?.postfx?.setBloom?.({ enabled: false }))

  const boot = await page.evaluate(() => window.__cinema)
  check('the scene loaded', boot.started.scene === true, boot.errors.join(' | '))
  check('every module loaded', Object.values(boot.started).every(Boolean), boot.errors.join(' | '))

  // The opening screen has to let you straight in, with no film demanded.
  const overlay = await page.evaluate(() => ({
    cta: document.querySelector('.mo-cta')?.textContent?.trim() ?? null,
    pick: !!document.querySelector('.mo-second'),
  }))
  await page.click('.mo-cta').catch(() => {})
  await sleep(1200)
  const entered = await page.evaluate(() => ({
    gone: !document.querySelector('.mo-overlay'),
    hasSource: window.__cinema.handles.media.hasSource,
  }))
  check(
    'I get into the hall without a film',
    !!overlay.cta && overlay.pick && entered.gone && entered.hasSource === false,
    `«${overlay.cta}»`,
  )

  const canvas = await page.evaluate(() => {
    const el = document.querySelector('#app canvas') ?? document.querySelector('canvas')
    return el ? { width: el.width, height: el.height } : null
  })
  check('there is a WebGL canvas', Boolean(canvas && canvas.width > 0 && canvas.height > 0), JSON.stringify(canvas))

  // The sample film in public/, so the run does not want a file of our own.
  // The ceremony holds the film until the lights are out, so it is put
  // aside here: it has a check of its own further down.
  const loaded = await page.evaluate(async () => {
    const media = window.__cinema.handles.media
    const showtime = window.__cinema.handles.room?.showtime
    if (showtime) showtime.enabled = false
    await media.load('/sample.webm', { autoplay: true })
    await media.play()
    await new Promise((r) => setTimeout(r, 1200))
    return { width: media.video.videoWidth, height: media.video.videoHeight }
  })
  check('the film went onto the screen', loaded.width > 0 && loaded.height > 0, `${loaded.width}x${loaded.height}`)

  const before = await page.evaluate(() => document.querySelector('video')?.currentTime ?? null)
  await sleep(2500)
  const after = await page.evaluate(() => document.querySelector('video')?.currentTime ?? null)
  if (before === null) check('the film plays', false, 'no <video> element found')
  else check('the film plays', after > before, `currentTime ${before} -> ${after}`)

  // --- first person ------------------------------------------------------
  // The headless browser refuses to lock the mouse and walking depends on
  // it, so we declare it ourselves in order to exercise the keys.
  await page.evaluate(() => {
    window.__probe = { steps: 0 }
    const controls = window.__cinema.handles.player.controls
    controls.on('step', () => (window.__probe.steps += 1))
    controls.setLocked(true)
  })
  const from = await page.evaluate(() => ({ ...window.__cinema.handles.player.controls.feet }))
  await page.keyboard.down('w')
  await sleep(1800)
  await page.keyboard.up('w')
  await sleep(300)
  const to = await page.evaluate(() => ({
    ...window.__cinema.handles.player.controls.feet,
    steps: window.__probe.steps,
  }))
  const walked = Math.hypot(to.x - from.x, to.z - from.z)
  check('W walks', walked > 0.2, `${walked.toFixed(2)} metres`)
  check('footsteps are heard', to.steps > 0, `${to.steps} steps`)

  // --- sitting down -------------------------------------------------------
  await page.keyboard.press('e')
  await sleep(800)
  const seated = await page.evaluate(() => window.__cinema.handles.player.isSeated)
  check('E puts you in the seat', seated === true)
  await page.keyboard.press('e')
  await sleep(400)

  // --- house lights -------------------------------------------------------
  const lights = await page.evaluate(async () => {
    const room = window.__cinema.handles.room
    const rig = window.__cinema.handles.scene.lighting
    const read = () => rig.lights.houseLights[0].intensity
    // The dimmer climbs per frame and the headless browser draws slowly,
    // so we wait for it to arrive, with a ceiling on the wait.
    const until = async (ok) => {
      for (let i = 0; i < 90; i += 1) {
        if (ok(read())) break
        await new Promise((r) => setTimeout(r, 400))
      }
      return read()
    }
    // From a known place: the ceremony leaves the lights where it wants them.
    rig.setHouseLights(0, { immediate: true })
    room.setHouseLights(1)
    const up = await until((value) => value > 100)
    // Coming down on the dimmer wants dozens of frames, and the headless
    // browser draws one a second. That it comes down we have seen already,
    // here we check that it reaches the bottom.
    room.setHouseLights(0)
    rig.setHouseLights(0, { immediate: true })
    const down = await until((value) => value < 5)
    return { up, down, settings: rig.getSettings() }
  })
  check('the lights come up and go out', lights.up > 100 && lights.down < 5, `${Math.round(lights.up)} -> ${Math.round(lights.down)}`)

  // No bright patch on the floor while the film runs, but it has its own dial.
  const aisle = await page.evaluate(async () => {
    const rig = window.__cinema.handles.scene.lighting
    const room = window.__cinema.handles.room
    const off = rig.lights.aisleGlows.every((l) => !l.visible)
    room.setAisleLights(1)
    await new Promise((r) => setTimeout(r, 200))
    const on = rig.lights.aisleGlows.every((l) => l.visible && l.intensity > 0)
    room.setAisleLights(0)
    return { off, on, dials: document.querySelectorAll('.rp-pop .rp-range').length }
  })
  check(
    'the aisle lights start off and can be turned on',
    aisle.off && aisle.on && aisle.dials >= 6,
    `${aisle.dials} dials`,
  )

  // --- room sounds --------------------------------------------------------
  const foley = await page.evaluate(async () => {
    const { createFoley } = await import('/src/sound/foley.js')
    const peak = async (fire) => {
      const ctx = new OfflineAudioContext(2, 44100, 44100)
      fire(createFoley({ context: ctx }))
      const buffer = await ctx.startRendering()
      let max = 0
      for (let c = 0; c < buffer.numberOfChannels; c += 1) {
        const data = buffer.getChannelData(c)
        for (let i = 0; i < data.length; i += 1) max = Math.max(max, Math.abs(data[i]))
      }
      return max
    }
    return {
      step: await peak((f) => f.step({})),
      seat: await peak((f) => f.seat({ down: true })),
      click: await peak((f) => f.click()),
      silence: await peak(() => {}),
    }
  })
  check(
    'the sounds produce a signal',
    foley.step > 0.01 && foley.seat > 0.01 && foley.click > 0.005 && foley.silence === 0,
    JSON.stringify(foley),
  )

  // --- screen formats -----------------------------------------------------
  const formats = await page.evaluate(async () => {
    const room = window.__cinema.handles.room
    const scene = window.__cinema.handles.scene
    const out = {}
    for (const name of ['scope', 'flat', 'hd']) {
      room.setScreenRatio(name)
      await new Promise((r) => setTimeout(r, 250))
      out[name] = {
        width: +scene.screenSize.width.toFixed(2),
        // The width of the picture has to follow the mask.
        surface: +window.__cinema.handles.media.screen.surface.scale.x.toFixed(2),
      }
    }
    room.setScreenRatio('scope')
    return out
  })
  check(
    'the screen changes format',
    formats.scope.width > formats.flat.width &&
      formats.flat.width > formats.hd.width &&
      formats.hd.surface <= formats.hd.width + 0.01,
    JSON.stringify(formats),
  )

  // --- right click ---------------------------------------------------------
  const menu = await page.evaluate(() => {
    document.dispatchEvent(
      new MouseEvent('contextmenu', { clientX: 500, clientY: 320, bubbles: true, cancelable: true }),
    )
    const root = document.querySelector('.cm-root')
    const open = !!root?.classList.contains('is-open')
    const items = [...(root?.querySelectorAll('.cm-item .cm-label') || [])].map((n) => n.textContent)
    // Choosing something has to close the menu on its own.
    root?.querySelector('.cm-item:not([disabled])')?.click()
    return { open, items, closed: !root.classList.contains('is-open') }
  })
  check(
    'right click opens the menu',
    menu.open && menu.closed && menu.items.length >= 4,
    menu.items.join(' / '),
  )

  // --- YouTube links -------------------------------------------------------
  const links = await page.evaluate(async () => {
    const { detectEmbed } = await import('/src/media/embedScreen.js')
    return {
      short: detectEmbed('https://youtu.be/dQw4w9WgXcQ')?.kind,
      watch: detectEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.kind,
      vimeo: detectEmbed('https://vimeo.com/76979871')?.kind,
      file: detectEmbed('https://example.com/movie.mp4'),
    }
  })
  check(
    'YouTube and Vimeo links are recognised',
    links.short === 'youtube' && links.watch === 'youtube' && links.vimeo === 'vimeo' && links.file === null,
    JSON.stringify(links),
  )

  // --- the look --------------------------------------------------------------
  const look = await page.evaluate(async () => {
    const c = window.__cinema.handles.player.controls
    c.setLocked(true)
    // The first movements after the lock are ignored on purpose (that is the
    // browser settling, not the hand), so the test waits them out.
    await new Promise((r) => setTimeout(r, 220))
    const start = { yaw: c.yaw, pitch: c.pitch }
    const move = (x, y) => document.dispatchEvent(new MouseEvent('mousemove', { movementX: x, movementY: y }))

    for (let i = 0; i < 20; i += 1) move(40, 0)
    const turned = c.yaw - start.yaw

    // An unnatural jump from the browser has to be ignored whole.
    const beforeSpike = { yaw: c.yaw, pitch: c.pitch }
    move(9000, 9000)
    const spikeIgnored = c.yaw === beforeSpike.yaw && c.pitch === beforeSpike.pitch

    // And it does not tumble however far up or down I look.
    for (let i = 0; i < 60; i += 1) move(0, -80)
    const top = c.pitch
    for (let i = 0; i < 120; i += 1) move(0, 80)
    const bottom = c.pitch
    return { turned, spikeIgnored, top, bottom, limit: c.config.maxPitch }
  })
  check(
    'the look follows without jumping',
    Math.abs(look.turned + 1.6) < 0.01 &&
      look.spikeIgnored &&
      Math.abs(look.top - look.limit) < 0.01 &&
      Math.abs(look.bottom + look.limit) < 0.01,
    `turned ${look.turned.toFixed(2)} rad, limit ${look.limit.toFixed(2)}`,
  )

  // --- updating by hand ------------------------------------------------------
  const updates = await page.evaluate(async () => {
    const updater = window.__cinema.handles.update
    const quietAtBoot = !document.querySelector('.vu-pill')?.classList.contains('is-on')
    updater.announce('dev')
    const shows = !!document.querySelector('.vu-pill')?.classList.contains('is-on')
    await updater.showChangelog()
    const sheet = document.querySelector('.vu-sheet')
    const entries = sheet.querySelectorAll('h2').length
    updater.hideChangelog()
    return { quietAtBoot, shows, entries, version: updater.version }
  })
  check(
    'the update waits for me, and the changelog can be read',
    updates.quietAtBoot && updates.shows && updates.entries >= 2,
    `v${updates.version}, ${updates.entries} versions`,
  )

  // --- the desk, the picture and the glow -----------------------------------
  const desk = await page.evaluate(() => {
    const sound = window.__cinema.handles.sound
    const screen = window.__cinema.handles.media.screen
    const postfx = window.__cinema.handles.scene.postfx
    sound.set('bass', 0.8)
    screen.setPicture({ brightness: 1.3 })
    postfx.setBloom({ strength: 0.9 })
    return {
      bass: sound.mixer?.get('bass'),
      brightness: screen.getPicture().brightness,
      bloom: postfx.getBloom().strength,
      mixFields: (sound.fields ?? []).length,
      pictureFields: (screen.pictureFields ?? []).length,
      sliders: document.querySelectorAll('.rp-pop .rp-range').length,
    }
  })
  check(
    'the desk, the picture and the glow all answer',
    Math.abs(desk.bass - 0.8) < 0.01 &&
      Math.abs(desk.brightness - 1.3) < 0.01 &&
      Math.abs(desk.bloom - 0.9) < 0.01 &&
      desk.sliders >= 25,
    `${desk.mixFields} sound + ${desk.pictureFields} picture, ${desk.sliders} dials on the panel`,
  )

  // --- the two other places -------------------------------------------------
  const places = await page.evaluate(async () => {
    const venues = window.__cinema.handles.venues
    const media = window.__cinema.handles.media
    // The sample is six seconds and the run lasts longer, so without a loop
    // the "still playing" check would fail for the wrong reason.
    if (media.video) media.video.loop = true
    await media.play()
    const out = []
    for (const id of ['horror', 'cozy', 'cinema']) {
      await venues.go(id, { fade: false })
      // The headless browser draws about a frame a second and the video
      // starts at its own pace, so we wait rather than guess.
      for (let i = 0; i < 30 && !media.isPlaying; i += 1) {
        await new Promise((r) => setTimeout(r, 300))
        if (!media.isPlaying) media.play()
      }
      out.push({ id: venues.current, screen: media.screenMesh?.name, playing: media.isPlaying })
    }
    return { out, list: venues.list.map((v) => v.id) }
  })
  const screens = places.out.map((p) => p.screen)
  check(
    'the film follows me into the other places',
    places.list.length === 3 &&
      new Set(screens).size === 3 &&
      places.out.every((p) => p.playing) &&
      places.out[2].id === 'cinema',
    screens.join(' -> '),
  )

  // --- the wheel, the sight and the spill -----------------------------------
  const lens = await page.evaluate(async () => {
    const controls = window.__cinema.handles.player.controls
    const camera = window.__cinema.handles.scene.camera
    controls.setCinematic(false, { silent: true })
    controls.resetZoom()
    await new Promise((r) => setTimeout(r, 400))
    const wide = camera.fov

    const wheel = (deltaY) => document.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }))
    for (let i = 0; i < 40; i += 1) wheel(-120)
    const enteredFrame = controls.cinematic
    await new Promise((r) => setTimeout(r, 500))

    for (let i = 0; i < 40; i += 1) wheel(120)
    const leftFrame = !controls.cinematic
    // The lens opens per frame and the headless browser draws very little,
    // so we wait for it to arrive rather than sleep a fixed time.
    for (let i = 0; i < 40 && Math.abs(camera.fov - wide) > 0.5; i += 1) {
      await new Promise((r) => setTimeout(r, 300))
    }
    const back = camera.fov

    // Caps Lock hides the sight without leaving whatever mode we are in.
    const hud = document.querySelector('.pl-hud')
    const before = !hud.classList.contains('no-cross')
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'CapsLock', bubbles: true }))
    const after = !hud.classList.contains('no-cross')

    return { wide: +wide.toFixed(1), back: +back.toFixed(1), enteredFrame, leftFrame, before, after }
  })
  check(
    'the wheel zooms, enters the frame and leaves it',
    lens.enteredFrame && lens.leftFrame && Math.abs(lens.wide - lens.back) < 0.6,
    `fov ${lens.wide} -> frame -> ${lens.back}`,
  )
  check('Caps Lock hides the sight', lens.before === true && lens.after === false)

  const spill = await page.evaluate(() => {
    const cinema = window.__cinema.handles.scene.cinema
    const rig = window.__cinema.handles.scene.lighting
    cinema.setScreenSpill({ color: { r: 1, g: 0.2, b: 0.2, copy() {} }, intensity: 1 }, 1)
    rig.setScreenLight(0xff3322, 1.2, { immediate: true })
    return {
      hasMesh: !!cinema.screenSpill,
      opacity: +cinema.screenSpill.material.opacity.toFixed(3),
      ambient: rig.lights.ambient.color.getHexString(),
      bounce: Math.round(rig.lights.screenBounce.intensity),
    }
  })
  check(
    'the screen paints the floor and the room',
    spill.hasMesh && spill.opacity > 0 && spill.bounce > 10,
    `opacity ${spill.opacity}, bounce ${spill.bounce}, ambient #${spill.ambient}`,
  )

  // --- YouTube playlists ----------------------------------------------------
  const lists = await page.evaluate(async () => {
    const { detectEmbed } = await import('/src/media/embedScreen.js')
    return {
      playlist: detectEmbed('https://www.youtube.com/playlist?list=PLabc123456')?.list,
      inWatch: detectEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123456')?.list,
      plain: detectEmbed('https://youtu.be/dQw4w9WgXcQ')?.list ?? null,
      quality: window.__cinema.handles.media.setQuality(2560),
    }
  })
  check(
    'it reads YouTube playlists and changes quality',
    lists.playlist === 'PLabc123456' && lists.inWatch === 'PLabc123456' && lists.plain === null && lists.quality === 2560,
    JSON.stringify(lists),
  )

  // --- the screening ceremony -----------------------------------------------
  // OUT OF THE HALL first. The ceremony is the behaviour of ONE viewer, and
  // the checks below drive it by hand: seek to the end, play, seek again.
  // With the socket open, the hall (rightly) answers every one of those and
  // pulls you back to where it thinks the screening is, so we would be
  // measuring sync and not the ceremony. Sync has a test of its own:
  // `npm run test:halls`.
  await page.evaluate(() => window.__cinema.handles.net?.client?.close())
  await sleep(400)

  const ceremony = await page.evaluate(async () => {
    const room = window.__cinema.handles.room
    const cinema = window.__cinema.handles.scene.cinema
    const media = window.__cinema.handles.media
    const showtime = room.showtime
    if (!showtime) return { missing: true }

    // Start from the interval: lights up, curtain closed.
    showtime.enabled = true
    media.pause()
    // From the start of the film: left at the end, the five-seconds-before
    // rule fires at once and the hall comes back up.
    media.seek(0)
    room.applyPreset('interval')
    cinema.setCurtains(1, { immediate: true })
    await new Promise((r) => setTimeout(r, 300))
    const before = { house: room.settings.house, curtains: cinema.curtains, state: showtime.state }

    // One press of play: the film starts AT ONCE, the curtain opens, and the
    // lights come down over the top of it.
    await media.play()
    const during = { curtains: cinema.curtains, state: showtime.state, playing: media.isPlaying }

    // The fade takes seconds: poll for it, never sleep a fixed time.
    let dimmed = room.settings.house
    for (let i = 0; i < 40 && dimmed > 0.05; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      dimmed = room.settings.house
    }
    return { before, during, dimmed, playing: media.isPlaying, state: showtime.state }
  })
  check(
    'play plays at once, the curtain opens and the lights come down over it',
    !ceremony.missing &&
      ceremony.before.house > 0.4 &&
      ceremony.before.curtains === 1 &&
      ceremony.during.curtains === 0 &&
      ceremony.during.playing &&
      ceremony.dimmed <= 0.05,
    `${ceremony.before?.state} -> ${ceremony.state} · lights ${ceremony.dimmed}`,
  )

  // --- and the interval before the end --------------------------------------
  const earlyInterval = await page.evaluate(async () => {
    const room = window.__cinema.handles.room
    const cinema = window.__cinema.handles.scene.cinema
    const media = window.__cinema.handles.media
    const showtime = room.showtime
    if (!showtime) return { missing: true }

    const total = media.duration
    if (!Number.isFinite(total) || total <= 0) return { noDuration: true }
    // Just before the last five seconds of the film.
    media.seek(Math.max(0, total - 4.5))
    if (!media.isPlaying) await media.play()

    let state = showtime.state
    for (let i = 0; i < 40 && state === 'showing'; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      state = showtime.state
    }
    let house = room.settings.house
    for (let i = 0; i < 40 && house < 0.3; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      house = room.settings.house
    }
    return { state, house, curtains: cinema.curtains }
  })
  check(
    'the lights come up before the end, without the curtain closing',
    !earlyInterval.missing &&
      !earlyInterval.noDuration &&
      earlyInterval.state !== 'showing' &&
      earlyInterval.house > 0.3 &&
      earlyInterval.curtains === 0,
    `${earlyInterval.state} · lights ${earlyInterval.house} · curtain ${earlyInterval.curtains}`,
  )

  // --- and the hall puts itself right ---------------------------------------
  const selfHeal = await page.evaluate(async () => {
    const room = window.__cinema.handles.room
    const cinema = window.__cinema.handles.scene.cinema
    const media = window.__cinema.handles.media
    const showtime = room.showtime
    if (!showtime) return { missing: true }

    showtime.enabled = true
    media.seek(0)
    await media.play()
    await new Promise((r) => setTimeout(r, 400))

    // Break the hall while it plays: curtain closed, lights up, and the
    // ceremony believing we are in the interval. Exactly what a viewer sees
    // when the ceremony has been lost.
    cinema.setCurtains(1, { immediate: true })
    room.applyPreset('interval')
    showtime.toInterval()
    const broken = { state: showtime.state, curtains: cinema.curtains, house: room.settings.house }

    let healed = { state: showtime.state, curtains: cinema.curtains }
    for (let i = 0; i < 12 && healed.state !== 'showing'; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      healed = { state: showtime.state, curtains: cinema.curtains }
    }
    let house = room.settings.house
    for (let i = 0; i < 20 && house > 0.3; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      house = room.settings.house
    }
    media.pause()
    return { broken, healed, house }
  })
  check(
    'a broken hall with the film running puts itself right',
    !selfHeal.missing &&
      selfHeal.broken.curtains === 1 &&
      selfHeal.healed.state === 'showing' &&
      selfHeal.healed.curtains === 0 &&
      selfHeal.house < 0.3,
    `${selfHeal.broken?.state} -> ${selfHeal.healed?.state} · lights ${selfHeal.house}`,
  )

  // --- the crowd in the seats -----------------------------------------------
  const crowd = await page.evaluate(async () => {
    const audience = window.__cinema.handles.audience
    const sound = window.__cinema.handles.sound
    audience.setCount(0)
    const empty = audience.group.children.filter((c) => c.visible).length
    audience.setCount(0.25)
    await new Promise((r) => setTimeout(r, 200))
    const some = audience.group.children.filter((c) => c.visible).length
    return {
      empty,
      some,
      count: audience.count,
      max: audience.max,
      occupancy: sound.mixer?.get('occupancy') ?? 0,
      taken: audience.count > 0,
    }
  })
  check(
    'the seats fill up with names',
    crowd.empty === 0 && crowd.some === crowd.count && crowd.count > 10 && crowd.occupancy > 0.2,
    `${crowd.count} of ${crowd.max}, occupancy ${crowd.occupancy.toFixed(2)}`,
  )

  // --- two languages ---------------------------------------------------------
  const langs = await page.evaluate(async () => {
    const i18n = await import('/src/i18n/index.js')
    // The page buttons, not the volume: that one is an icon.
    const label = () => document.querySelector('.rp-dbtn:not([data-role]) span:not(.ic)')?.textContent ?? ''
    i18n.setLanguage('el')
    await new Promise((r) => setTimeout(r, 200))
    const greek = label()
    i18n.setLanguage('en')
    await new Promise((r) => setTimeout(r, 200))
    const english = label()
    const slider = [...document.querySelectorAll('.rp-pop .rp-legend span')].map((n) => n.textContent)
    i18n.setLanguage('el')
    await new Promise((r) => setTimeout(r, 200))
    return { greek, english, stored: localStorage.getItem('vc.lang'), sliderInEnglish: slider }
  })
  check(
    'the menu speaks both languages',
    // 'Χώρος' is the Greek for 'Place'. It is written out because this check
    // exists to prove the Greek half of the switch is alive.
    langs.greek === 'Χώρος' && langs.english === 'Place' && langs.greek !== langs.english,
    `«${langs.greek}» / «${langs.english}»`,
  )

  // --- the queue -------------------------------------------------------------
  const queued = await page.evaluate(async () => {
    const room = window.__cinema.handles.room
    const queue = room.queue
    if (!queue) return { missing: true }
    queue.clear()
    queue.add('/sample.webm', 'The second one')
    queue.add('https://www.youtube.com/watch?v=abc12345678', null)
    queue.gap = 15
    await new Promise((r) => setTimeout(r, 200))
    const rows = document.querySelectorAll('.rp-queue .rp-qrow').length
    const labels = queue.items.map((item) => item.label)
    queue.remove(queue.items[0].id)
    const afterRemove = queue.length
    queue.clear()
    return { rows, labels, afterRemove, empty: queue.length, gap: queue.gap }
  })
  check(
    'the queue holds films and the gap is mine to set',
    !queued.missing && queued.rows === 2 && queued.afterRemove === 1 && queued.empty === 0 && queued.gap === 15,
    `${queued.labels?.join(' · ')}, gap ${queued.gap}s`,
  )

  // --- undo, quality and curtains -------------------------------------------
  const undo = await page.evaluate(async () => {
    const room = window.__cinema.handles.room
    const rig = window.__cinema.handles.scene.lighting
    const i18n = await import('/src/i18n/index.js')

    // The ceremony leaves the lights travelling. Wait for them to settle AND
    // rebuild the panel, or undo points at a value that moved underneath it.
    let last = null
    for (let i = 0; i < 40; i += 1) {
      const now = room.settings.house
      if (now === last) break
      last = now
      await new Promise((r) => setTimeout(r, 250))
    }
    i18n.setLanguage('en')
    await new Promise((r) => setTimeout(r, 150))
    i18n.setLanguage('el')
    await new Promise((r) => setTimeout(r, 150))

    room.dock.show('lights')
    await new Promise((r) => setTimeout(r, 200))
    const row = document.querySelector('.rp-page.is-on .rp-field')
    const slider = row.querySelector('input')
    const undoButton = row.querySelector('.rp-undo')
    const hiddenAtRest = !undoButton.classList.contains('is-on')

    slider.value = String(Number(slider.max) * 0.8)
    slider.dispatchEvent(new Event('input', { bubbles: true }))
    const moved = Number(slider.value)
    const offersUndo = undoButton.classList.contains('is-on')
    undoButton.click()
    const back = Number(slider.value)

    const resetAll = !!document.querySelector('.rp-page.is-on .rp-resetall button')
    return { hiddenAtRest, moved, back, offersUndo, resetAll, house: rig.getSettings().house }
  })
  check(
    'every setting goes back',
    undo.hiddenAtRest && undo.offersUndo && undo.moved !== undo.back && undo.resetAll,
    `${undo.moved} -> ${undo.back}, page button: ${undo.resetAll ? 'yes' : 'no'}`,
  )

  const quality = await page.evaluate(async () => {
    const media = window.__cinema.handles.media
    const steps = media.qualitySteps.map((s) => s.key)
    media.setQualityStep('1080')
    const at1080 = { step: media.qualityStep, pixels: media.quality }
    media.setQualityStep('auto')
    return { steps, at1080, auto: media.qualityStep, sliderGone: !document.querySelector('input[aria-label*="YouTube"]') }
  })
  check(
    'YouTube quality is a fixed set of choices',
    quality.steps.length === 5 && quality.at1080.step === '1080' && quality.at1080.pixels === 1920 && quality.auto === 'auto' && quality.sliderGone,
    quality.steps.join(' / '),
  )

  const curtains = await page.evaluate(async () => {
    const cinema = window.__cinema.handles.scene.cinema
    cinema.setCurtains(0, { immediate: true })
    const open = cinema.curtains
    cinema.setCurtains(1)
    const asked = cinema.curtains
    // How many frames it wants to cross: slow on purpose.
    let frames = 0
    const fold = cinema.group.getObjectByName('CurtainLeft')?.children?.[0]
    const from = fold?.position.x ?? 0
    for (let i = 0; i < 40 && frames < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 100))
      frames += 1
      if (Math.abs((fold?.position.x ?? 0) - from) > 0.2) break
    }
    return { open, asked, moved: Math.abs((fold?.position.x ?? 0) - from) > 0.05 }
  })
  check(
    'the curtains open and close',
    curtains.open === 0 && curtains.asked === 1 && curtains.moved,
    `${curtains.open} -> ${curtains.asked}`,
  )

  check('a clean console', pageErrors.length === 0, pageErrors.join(' | '))

  // The screenshot is a gift, not a check: on SwiftShader it is the most
  // expensive thing we ask for, and it must not fail a run that passed.
  try {
    fs.mkdirSync(at('tests/artifacts'), { recursive: true })
    await page.screenshot({ path: at('tests/artifacts/cinema.png'), timeout: 60000 })
    console.log(`\nScreenshot: ${at('tests/artifacts/cinema.png')}`)
  } catch (err) {
    console.log(`\n(no screenshot: ${err.message.split('\n')[0]})`)
  }
} catch (err) {
  check('boot', false, err.message)
} finally {
  clearTimeout(watchdog)
  teardown()
  await sleep(500)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)

/**
 * Browser smoke test: αίθουσα φορτώνει + η ταινία παίζει.
 *
 *   npm run test:browser
 *
 * Σηκώνει vite + server, ανοίγει τη σελίδα με Playwright και ελέγχει ότι:
 *   1. το window.__cinema φτάνει σε ready χωρίς σφάλμα boot
 *   2. υπάρχει καμβάς με πραγματικές διαστάσεις (η σκηνή ζωγραφίστηκε)
 *   3. το βίντεο προχωράει (currentTime αυξάνεται)
 *   4. το W A S D μετακινεί και βγάζει βήματα
 *   5. τα φώτα της αίθουσας ανεβαίνουν και κατεβαίνουν
 *   6. οι ήχοι της αίθουσας βγάζουν πραγματικό σήμα
 *   7. η οθόνη αλλάζει και στα τρία μεγέθη
 *   8. το δεξί κλικ ανοίγει το δικό μας μενού
 *   9. τα links YouTube / Vimeo αναγνωρίζονται
 *  10. μπαίνεις στην αίθουσα χωρίς να βάλεις ταινία
 *  11. η ματιά δεν πηδάει και δεν κάνει τούμπα
 *  12. η ενημέρωση περιμένει να την πατήσεις
 *
 * Χρειάζεται Playwright. Αν δεν είναι εγκατεστημένο, βγαίνει SKIPPED (exit 0):
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
  console.log('SKIPPED: δεν βρέθηκε Playwright.')
  console.log('Εγκατάσταση: npm i -D playwright && npx playwright install chromium')
  process.exit(0)
}

const serverEntry = firstExisting(SERVER_ENTRIES)
const client = startProcess('npm', ['run', 'dev'], { PORT: String(CLIENT_PORT) })
const server = serverEntry
  ? startProcess(process.execPath, [serverEntry], { PORT: String(SERVER_PORT) })
  : null

let browser

// ΤΑΒΑΝΙ ΖΩΗΣ. Ο headless browser ζωγραφίζει την αίθουσα με SwiftShader, δηλαδή
// με τον επεξεργαστή: όσο ζει, τρώει CPU. Ένα τεστ που κόλλησε (ή που έχασε τον
// γονιό του όταν έκλεισε το terminal) έμενε ορφανό για μέρες με το «Chrome
// Headless» στο Task Manager στο τέρμα. Ό,τι κι αν γίνει, εδώ πεθαίνουν όλα.
const BUDGET_MS = 6 * 60 * 1000
let torndown = false
function teardown(reason) {
  if (torndown) return
  torndown = true
  if (reason) console.log(`\n${reason}`)
  // Ο browser κλείνει ασύγχρονα, οπότε στέλνουμε ΚΑΙ σκέτο kill στη διεργασία
  // του: σε βίαιο τερματισμό δεν προλαβαίνει να τρέξει το close().
  try {
    browser?.process()?.kill()
  } catch {}
  browser?.close().catch(() => {})
  client.stop()
  server?.stop()
}
const watchdog = setTimeout(() => {
  teardown(`ΤΕΛΟΣ ΧΡΟΝΟΥ: το τεστ ξεπέρασε τα ${BUDGET_MS / 60000} λεπτά — όλα κλείνουν.`)
  setTimeout(() => process.exit(1), 1500).unref()
}, BUDGET_MS)
watchdog.unref()
process.on('exit', () => teardown())
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(signal, () => {
    teardown(`Διακοπή (${signal}).`)
    setTimeout(() => process.exit(130), 1000).unref()
  })
}
try {
  const clientPort = await waitForPort([CLIENT_PORT, 5174, 5175], 40000)
  if (!clientPort) throw new Error(`ο vite δεν σηκώθηκε:\n${client.output()}`)
  if (server) await waitForPort([SERVER_PORT], 15000)

  browser = await playwright.chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  // Μικρότερο παράθυρο επίτηδες: ο headless browser ζωγραφίζει με τον
  // επεξεργαστή, και σε 1280x800 με τον composer του bloom από πάνω η σελίδα
  // έπεφτε στη μέση του ελέγχου. Η αίθουσα δεν χρειάζεται να είναι μεγάλη για
  // να μετρηθεί.
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } })
  const pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(err.message))

  await page.goto(`http://127.0.0.1:${clientPort}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__cinema?.ready === true, null, { timeout: 30000 })

  // Το bloom κρατάει έναν μεγάλο buffer με antialiasing, που σε SwiftShader
  // είναι το ακριβότερο πράγμα στη σελίδα. Οι τιμές του ελέγχονται παρακάτω
  // κανονικά, απλώς δεν ζωγραφίζεται όσο τρέχει ο έλεγχος.
  await page.evaluate(() => window.__cinema.handles.scene?.postfx?.setBloom?.({ enabled: false }))

  const boot = await page.evaluate(() => window.__cinema)
  check('η σκηνή φόρτωσε', boot.started.scene === true, boot.errors.join(' | '))
  check('φόρτωσαν όλα τα modules', Object.values(boot.started).every(Boolean), boot.errors.join(' | '))

  // Η αρχική οθόνη πρέπει να σε βάζει μέσα σκέτο, χωρίς να απαιτεί ταινία.
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
    'μπαίνω στην αίθουσα χωρίς ταινία',
    !!overlay.cta && overlay.pick && entered.gone && entered.hasSource === false,
    `«${overlay.cta}»`,
  )

  const canvas = await page.evaluate(() => {
    const el = document.querySelector('#app canvas') ?? document.querySelector('canvas')
    return el ? { width: el.width, height: el.height } : null
  })
  check('υπάρχει καμβάς WebGL', Boolean(canvas && canvas.width > 0 && canvas.height > 0), JSON.stringify(canvas))

  // Το δείγμα ταινίας του public/, ώστε ο έλεγχος να μη θέλει δικό μας αρχείο.
  // Η τελετή προβολής κρατάει την ταινία μέχρι να σβήσουν τα φώτα, οπότε εδώ
  // μπαίνει στην άκρη: έχει δικό της έλεγχο πιο κάτω.
  const loaded = await page.evaluate(async () => {
    const media = window.__cinema.handles.media
    const showtime = window.__cinema.handles.room?.showtime
    if (showtime) showtime.enabled = false
    await media.load('/sample.webm', { autoplay: true })
    await media.play()
    await new Promise((r) => setTimeout(r, 1200))
    return { width: media.video.videoWidth, height: media.video.videoHeight }
  })
  check('η ταινία μπήκε στην οθόνη', loaded.width > 0 && loaded.height > 0, `${loaded.width}x${loaded.height}`)

  const before = await page.evaluate(() => document.querySelector('video')?.currentTime ?? null)
  await sleep(2500)
  const after = await page.evaluate(() => document.querySelector('video')?.currentTime ?? null)
  if (before === null) check('η ταινία παίζει', false, 'δεν βρέθηκε στοιχείο <video>')
  else check('η ταινία παίζει', after > before, `currentTime ${before} -> ${after}`)

  // --- πρώτο πρόσωπο -----------------------------------------------------
  // Ο headless browser αρνείται το κλείδωμα του ποντικιού και το περπάτημα
  // εξαρτάται από αυτό, οπότε το δηλώνουμε εμείς για να δοκιμαστούν τα πλήκτρα.
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
  check('το W περπατάει', walked > 0.2, `${walked.toFixed(2)} μέτρα`)
  check('ακούγονται βήματα', to.steps > 0, `${to.steps} βήματα`)

  // --- κάθισμα ------------------------------------------------------------
  await page.keyboard.press('e')
  await sleep(800)
  const seated = await page.evaluate(() => window.__cinema.handles.player.isSeated)
  check('το E σε βάζει στη θέση', seated === true)
  await page.keyboard.press('e')
  await sleep(400)

  // --- φώτα αίθουσας ------------------------------------------------------
  const lights = await page.evaluate(async () => {
    const room = window.__cinema.handles.room
    const rig = window.__cinema.handles.scene.lighting
    const read = () => rig.lights.houseLights[0].intensity
    // Ο dimmer ανεβαίνει ανά καρέ και ο headless browser ζωγραφίζει αργά,
    // οπότε περιμένουμε να φτάσει, με ταβάνι χρόνου.
    const until = async (ok) => {
      for (let i = 0; i < 90; i += 1) {
        if (ok(read())) break
        await new Promise((r) => setTimeout(r, 400))
      }
      return read()
    }
    // Από γνωστό σημείο: η τελετή αφήνει τα φώτα εκεί που τα θέλει εκείνη.
    rig.setHouseLights(0, { immediate: true })
    room.setHouseLights(1)
    const up = await until((value) => value > 100)
    // Το κατέβασμα με τον dimmer θέλει δεκάδες καρέ, και ο headless browser
    // ζωγραφίζει ένα το δευτερόλεπτο. Το ότι κατεβαίνει το είδαμε ήδη, εδώ
    // ελέγχουμε ότι φτάνει μέχρι κάτω.
    room.setHouseLights(0)
    rig.setHouseLights(0, { immediate: true })
    const down = await until((value) => value < 5)
    return { up, down, settings: rig.getSettings() }
  })
  check('τα φώτα ανάβουν και σβήνουν', lights.up > 100 && lights.down < 5, `${Math.round(lights.up)} -> ${Math.round(lights.down)}`)

  // Καμία φωτεινή κηλίδα στο πάτωμα όσο παίζει η ταινία, αλλά με δικό της κουμπί.
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
    'τα φωτάκια του διαδρόμου ξεκινούν κλειστά και ανοίγουν',
    aisle.off && aisle.on && aisle.dials >= 6,
    `${aisle.dials} μπάρες`,
  )

  // --- ήχοι αίθουσας ------------------------------------------------------
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
    'οι ήχοι βγάζουν σήμα',
    foley.step > 0.01 && foley.seat > 0.01 && foley.click > 0.005 && foley.silence === 0,
    JSON.stringify(foley),
  )

  // --- μεγέθη οθόνης ------------------------------------------------------
  const formats = await page.evaluate(async () => {
    const room = window.__cinema.handles.room
    const scene = window.__cinema.handles.scene
    const out = {}
    for (const name of ['scope', 'flat', 'hd']) {
      room.setScreenRatio(name)
      await new Promise((r) => setTimeout(r, 250))
      out[name] = {
        width: +scene.screenSize.width.toFixed(2),
        // Το πλάτος της εικόνας πρέπει να ακολουθεί τη μάσκα.
        surface: +window.__cinema.handles.media.screen.surface.scale.x.toFixed(2),
      }
    }
    room.setScreenRatio('scope')
    return out
  })
  check(
    'η οθόνη αλλάζει μέγεθος',
    formats.scope.width > formats.flat.width &&
      formats.flat.width > formats.hd.width &&
      formats.hd.surface <= formats.hd.width + 0.01,
    JSON.stringify(formats),
  )

  // --- δεξί κλικ -----------------------------------------------------------
  const menu = await page.evaluate(() => {
    document.dispatchEvent(
      new MouseEvent('contextmenu', { clientX: 500, clientY: 320, bubbles: true, cancelable: true }),
    )
    const root = document.querySelector('.cm-root')
    const open = !!root?.classList.contains('is-open')
    const items = [...(root?.querySelectorAll('.cm-item .cm-label') || [])].map((n) => n.textContent)
    // Διαλέγοντας κάτι, το μενού πρέπει να κλείνει μόνο του.
    root?.querySelector('.cm-item:not([disabled])')?.click()
    return { open, items, closed: !root.classList.contains('is-open') }
  })
  check(
    'το δεξί κλικ ανοίγει το μενού',
    menu.open && menu.closed && menu.items.length >= 4,
    menu.items.join(' / '),
  )

  // --- links από YouTube ---------------------------------------------------
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
    'αναγνωρίζει τα links YouTube και Vimeo',
    links.short === 'youtube' && links.watch === 'youtube' && links.vimeo === 'vimeo' && links.file === null,
    JSON.stringify(links),
  )

  // --- η ματιά --------------------------------------------------------------
  const look = await page.evaluate(async () => {
    const c = window.__cinema.handles.player.controls
    c.setLocked(true)
    // Οι πρώτες κινήσεις μετά το κλείδωμα αγνοούνται επίτηδες (είναι ο browser
    // που στρώνει, όχι το χέρι), οπότε το τεστ τις περιμένει να περάσουν.
    await new Promise((r) => setTimeout(r, 220))
    const start = { yaw: c.yaw, pitch: c.pitch }
    const move = (x, y) => document.dispatchEvent(new MouseEvent('mousemove', { movementX: x, movementY: y }))

    for (let i = 0; i < 20; i += 1) move(40, 0)
    const turned = c.yaw - start.yaw

    // Ένα αφύσικο πήδημα του browser πρέπει να αγνοηθεί ολόκληρο.
    const beforeSpike = { yaw: c.yaw, pitch: c.pitch }
    move(9000, 9000)
    const spikeIgnored = c.yaw === beforeSpike.yaw && c.pitch === beforeSpike.pitch

    // Και δεν γίνεται τούμπα όσο κι αν κοιτάξω πάνω ή κάτω.
    for (let i = 0; i < 60; i += 1) move(0, -80)
    const top = c.pitch
    for (let i = 0; i < 120; i += 1) move(0, 80)
    const bottom = c.pitch
    return { turned, spikeIgnored, top, bottom, limit: c.config.maxPitch }
  })
  check(
    'η ματιά ακολουθεί χωρίς πηδήματα',
    Math.abs(look.turned + 1.6) < 0.01 &&
      look.spikeIgnored &&
      Math.abs(look.top - look.limit) < 0.01 &&
      Math.abs(look.bottom + look.limit) < 0.01,
    `στροφή ${look.turned.toFixed(2)} rad, όριο ±${look.limit.toFixed(2)}`,
  )

  // --- ενημέρωση με το χέρι --------------------------------------------------
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
    'η ενημέρωση περιμένει εμένα, και ο changelog διαβάζεται',
    updates.quietAtBoot && updates.shows && updates.entries >= 2,
    `v${updates.version}, ${updates.entries} εκδόσεις`,
  )

  // --- ο μίκτης, η εικόνα και η λάμψη ---------------------------------------
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
    'ο μίκτης, η εικόνα και η λάμψη ακούνε',
    Math.abs(desk.bass - 0.8) < 0.01 &&
      Math.abs(desk.brightness - 1.3) < 0.01 &&
      Math.abs(desk.bloom - 0.9) < 0.01 &&
      desk.sliders >= 25,
    `${desk.mixFields} ήχου + ${desk.pictureFields} εικόνας, ${desk.sliders} μπάρες στο πάνελ`,
  )

  // --- οι δύο νέοι χώροι ----------------------------------------------------
  const places = await page.evaluate(async () => {
    const venues = window.__cinema.handles.venues
    const media = window.__cinema.handles.media
    // Το δείγμα είναι έξι δευτερόλεπτα και ο έλεγχος κρατάει περισσότερο, οπότε
    // χωρίς loop το «παίζει ακόμη» θα αποτύγχανε για λάθος λόγο.
    if (media.video) media.video.loop = true
    await media.play()
    const out = []
    for (const id of ['horror', 'cozy', 'cinema']) {
      await venues.go(id, { fade: false })
      // Ο headless browser ζωγραφίζει ~1 καρέ το δευτερόλεπτο και το βίντεο
      // ξεκινάει με τον δικό του ρυθμό, οπότε περιμένουμε αντί να μαντεύουμε.
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
    'η ταινία με ακολουθεί στους άλλους χώρους',
    places.list.length === 3 &&
      new Set(screens).size === 3 &&
      places.out.every((p) => p.playing) &&
      places.out[2].id === 'cinema',
    screens.join(' -> '),
  )

  // --- η ρόδα, το σημάδι και ο καθρεφτισμός ---------------------------------
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
    // Ο φακός ανοίγει ανά καρέ και ο headless browser ζωγραφίζει ελάχιστα,
    // οπότε περιμένουμε να φτάσει αντί για σταθερό χρόνο.
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
    'η ρόδα ζουμάρει, μπαίνει στο κάδρο και βγαίνει',
    lens.enteredFrame && lens.leftFrame && Math.abs(lens.wide - lens.back) < 0.6,
    `fov ${lens.wide} -> κάδρο -> ${lens.back}`,
  )
  check('το Caps Lock κρύβει το σημάδι', lens.before === true && lens.after === false)

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
    'η οθόνη βάφει το πάτωμα και τον χώρο',
    spill.hasMesh && spill.opacity > 0 && spill.bounce > 10,
    `opacity ${spill.opacity}, bounce ${spill.bounce}, ambient #${spill.ambient}`,
  )

  // --- λίστες YouTube -------------------------------------------------------
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
    'διαβάζει λίστες YouTube και αλλάζει ποιότητα',
    lists.playlist === 'PLabc123456' && lists.inWatch === 'PLabc123456' && lists.plain === null && lists.quality === 2560,
    JSON.stringify(lists),
  )

  // --- η τελετή προβολής ----------------------------------------------------
  // ΕΞΩ ΑΠΟ ΤΗΝ ΑΙΘΟΥΣΑ πρώτα. Η τελετή είναι συμπεριφορά ΕΝΟΣ θεατή, και τα
  // επόμενα τεστ την οδηγούν με το χέρι: seek στο τέλος, play, ξανά seek. Με
  // ανοιχτή σύνδεση, η αίθουσα (σωστά) απαντάει σε κάθε ένα από αυτά και σε
  // γυρίζει εκεί που νομίζει ότι είναι η προβολή — οπότε θα μετρούσαμε τον
  // συγχρονισμό, όχι την τελετή. Ο συγχρονισμός έχει δικό του τεστ:
  // `npm run test:halls`.
  await page.evaluate(() => window.__cinema.handles.net?.client?.close())
  await sleep(400)

  const ceremony = await page.evaluate(async () => {
    const room = window.__cinema.handles.room
    const cinema = window.__cinema.handles.scene.cinema
    const media = window.__cinema.handles.media
    const showtime = room.showtime
    if (!showtime) return { missing: true }

    // Ξεκινάμε από «διάλειμμα»: φώτα αναμμένα, κουρτίνα κλειστή.
    showtime.enabled = true
    media.pause()
    // Από την αρχή της ταινίας: αν έχει μείνει στο τέλος, το «πέντε
    // δευτερόλεπτα πριν» χτυπάει αμέσως και η αίθουσα ξανανάβει.
    media.seek(0)
    room.applyPreset('interval')
    cinema.setCurtains(1, { immediate: true })
    await new Promise((r) => setTimeout(r, 300))
    const before = { house: room.settings.house, curtains: cinema.curtains, state: showtime.state }

    // Ένα πάτημα play: η ταινία ξεκινάει ΑΜΕΣΩΣ, η κουρτίνα ανοίγει, και τα
    // φώτα κατεβαίνουν από πάνω της.
    await media.play()
    const during = { curtains: cinema.curtains, state: showtime.state, playing: media.isPlaying }

    // Ο σβήστης κρατάει δευτερόλεπτα: poll, ποτέ σταθερό sleep.
    let dimmed = room.settings.house
    for (let i = 0; i < 40 && dimmed > 0.05; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      dimmed = room.settings.house
    }
    return { before, during, dimmed, playing: media.isPlaying, state: showtime.state }
  })
  check(
    'το play παίζει αμέσως, ανοίγει η κουρτίνα και τα φώτα κατεβαίνουν από πάνω',
    !ceremony.missing &&
      ceremony.before.house > 0.4 &&
      ceremony.before.curtains === 1 &&
      ceremony.during.curtains === 0 &&
      ceremony.during.playing &&
      ceremony.dimmed <= 0.05,
    `${ceremony.before?.state} -> ${ceremony.state} · φώτα ${ceremony.dimmed}`,
  )

  // --- και το διάλειμμα πριν από το τέλος -----------------------------------
  const earlyInterval = await page.evaluate(async () => {
    const room = window.__cinema.handles.room
    const cinema = window.__cinema.handles.scene.cinema
    const media = window.__cinema.handles.media
    const showtime = room.showtime
    if (!showtime) return { missing: true }

    const total = media.duration
    if (!Number.isFinite(total) || total <= 0) return { noDuration: true }
    // Λίγο πριν τους τελευταίους πέντε πόντους της ταινίας.
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
    'τα φώτα ανεβαίνουν πριν το τέλος, χωρίς να κλείσει η κουρτίνα',
    !earlyInterval.missing &&
      !earlyInterval.noDuration &&
      earlyInterval.state !== 'showing' &&
      earlyInterval.house > 0.3 &&
      earlyInterval.curtains === 0,
    `${earlyInterval.state} · φώτα ${earlyInterval.house} · κουρτίνα ${earlyInterval.curtains}`,
  )

  // --- και η αίθουσα διορθώνεται μόνη της -----------------------------------
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

    // Σπάμε την αίθουσα όσο παίζει: κουρτίνα κλειστή, φώτα αναμμένα, και η
    // τελετή να νομίζει ότι είμαστε σε διάλειμμα. Ακριβώς ό,τι βλέπει ο θεατής
    // όταν η τελετή έχει χαθεί.
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
    'αν χαλάσει η αίθουσα με την ταινία να παίζει, ξαναστρώνει μόνη της',
    !selfHeal.missing &&
      selfHeal.broken.curtains === 1 &&
      selfHeal.healed.state === 'showing' &&
      selfHeal.healed.curtains === 0 &&
      selfHeal.house < 0.3,
    `${selfHeal.broken?.state} -> ${selfHeal.healed?.state} · φώτα ${selfHeal.house}`,
  )

  // --- ο κόσμος στις θέσεις -------------------------------------------------
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
    'γεμίζουν οι θέσεις με ονόματα',
    crowd.empty === 0 && crowd.some === crowd.count && crowd.count > 10 && crowd.occupancy > 0.2,
    `${crowd.count} από ${crowd.max}, occupancy ${crowd.occupancy.toFixed(2)}`,
  )

  // --- δύο γλώσσες ----------------------------------------------------------
  const langs = await page.evaluate(async () => {
    const i18n = await import('/src/i18n/index.js')
    // Τα κουμπιά των σελίδων, όχι η ένταση: αυτή είναι ένα εικονίδιο.
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
    'το μενού μιλάει και τις δύο γλώσσες',
    langs.greek === 'Χώρος' && langs.english === 'Place' && langs.greek !== langs.english,
    `«${langs.greek}» / «${langs.english}»`,
  )

  // --- η ουρά ---------------------------------------------------------------
  const queued = await page.evaluate(async () => {
    const room = window.__cinema.handles.room
    const queue = room.queue
    if (!queue) return { missing: true }
    queue.clear()
    queue.add('/sample.webm', 'Δεύτερη')
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
    'η ουρά κρατάει ταινίες και το κενό είναι δικό μου',
    !queued.missing && queued.rows === 2 && queued.afterRemove === 1 && queued.empty === 0 && queued.gap === 15,
    `${queued.labels?.join(' · ')}, κενό ${queued.gap}s`,
  )

  // --- επαναφορά, ποιότητα και κουρτίνες ------------------------------------
  const undo = await page.evaluate(async () => {
    const room = window.__cinema.handles.room
    const rig = window.__cinema.handles.scene.lighting
    const i18n = await import('/src/i18n/index.js')

    // Η τελετή αφήνει τα φώτα να ταξιδεύουν. Περίμενε να σταθούν ΚΑΙ ξαναχτίσε
    // το πάνελ, αλλιώς το «πίσω» δείχνει σε τιμή που πρόλαβε να αλλάξει.
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
    'κάθε ρύθμιση γυρίζει πίσω',
    undo.hiddenAtRest && undo.offersUndo && undo.moved !== undo.back && undo.resetAll,
    `${undo.moved} -> ${undo.back}, κουμπί σελίδας: ${undo.resetAll ? 'ναι' : 'όχι'}`,
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
    'η ποιότητα YouTube είναι σταθερές επιλογές',
    quality.steps.length === 5 && quality.at1080.step === '1080' && quality.at1080.pixels === 1920 && quality.auto === 'auto' && quality.sliderGone,
    quality.steps.join(' / '),
  )

  const curtains = await page.evaluate(async () => {
    const cinema = window.__cinema.handles.scene.cinema
    cinema.setCurtains(0, { immediate: true })
    const open = cinema.curtains
    cinema.setCurtains(1)
    const asked = cinema.curtains
    // Πόσα καρέ θέλει για να διασχίσει: αργό επίτηδες.
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
    'οι κουρτίνες ανοίγουν και κλείνουν',
    curtains.open === 0 && curtains.asked === 1 && curtains.moved,
    `${curtains.open} -> ${curtains.asked}`,
  )

  check('καθαρή κονσόλα', pageErrors.length === 0, pageErrors.join(' | '))

  // Το στιγμιότυπο είναι δώρο, όχι έλεγχος: με SwiftShader είναι το ακριβότερο
  // πράγμα που ζητάμε, και δεν έχει νόημα να ρίχνει έναν έλεγχο που πέρασε.
  try {
    fs.mkdirSync(at('tests/artifacts'), { recursive: true })
    await page.screenshot({ path: at('tests/artifacts/cinema.png'), timeout: 60000 })
    console.log(`\nΣτιγμιότυπο: ${at('tests/artifacts/cinema.png')}`)
  } catch (err) {
    console.log(`\n(χωρίς στιγμιότυπο: ${err.message.split('\n')[0]})`)
  }
} catch (err) {
  check('boot', false, err.message)
} finally {
  clearTimeout(watchdog)
  teardown()
  await sleep(500)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} πέρασαν`)
process.exit(failed.length ? 1 : 0)

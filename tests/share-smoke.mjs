/**
 * One screen, everybody's screen.
 *
 * The claim being checked is that there is nothing to synchronise: a viewer
 * receives the SHARER'S OWN FRAMES. So the proof has to be pixels, not flags -
 * the sharer is given a page of a known colour to share, and the viewer's
 * cinema screen is read back and has to be that colour.
 *
 *   npm run build && npm run server      # then, in another shell:
 *   npm run test:share
 *
 * A fake screen is fed in with Chromium's own capture flags, so nothing has to
 * be clicked in an operating system dialog.
 */
import playwright from 'playwright'

const ORIGIN = process.env.ORIGIN || 'http://127.0.0.1:8787'
const out = []
const errors = []
const check = (name, ok, detail = '') => {
  out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
  return ok
}

const browser = await playwright.chromium.launch({
  headless: process.env.HEADLESS === '1',
  args: [
    '--autoplay-policy=no-user-gesture-required',
    // Share the current tab without a picker, and keep the capture moving so
    // the encoder has real frames to send.
    '--auto-accept-this-tab-capture',
    '--auto-select-desktop-capture-source=Virtual Cinema',
    ...(process.env.HEADLESS === '1' ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] : []),
  ],
})

async function visitor(name, hall) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  page.on('pageerror', (e) => errors.push(`${name} PAGEERROR ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name} ${m.text()}`))
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' })
  for (let i = 0; i < 80; i++) {
    if (await page.evaluate(() => window.__cinema?.ready === true)) break
    await page.waitForTimeout(500)
  }
  await page.fill('.mo-overlay [data-role="name"]', name)
  await page.locator('.mo-overlay .mo-hall').nth(Number(hall.split('-')[1]) - 1).click()
  await page.click('.mo-overlay [data-role="cta"]')
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => window.__cinema.handles.net?.status === 'online')) break
    await page.waitForTimeout(500)
  }
  await page.evaluate(() => document.exitPointerLock?.())
  await page.waitForTimeout(300)
  return page
}

const poll = async (page, fn, tries = 60, arg) => {
  for (let i = 0; i < tries; i++) {
    const value = await page.evaluate(fn, arg)
    if (value) return value
    await page.waitForTimeout(500)
  }
  return page.evaluate(fn, arg)
}

/**
 * An empty hall, chosen at the last moment.
 *
 * Run against the live server and hall one is not reliably empty - a browser
 * left open overnight sits there as a peer, and measured, that is exactly what
 * happened: a stranger called "Reel 62" was in the room and the count was
 * three. The mesh is fine with that; the test is not, because "the picture
 * reached the other side" stops meaning anything when there is more than one
 * other side.
 */
const halls = await fetch(`${ORIGIN}/rooms`).then((r) => r.json()).catch(() => null)
const empty = (halls?.halls ?? []).find((h) => !h.peers)?.id || 'hall-1'
console.log(`  using ${empty}`)
const host = await visitor('HOST', empty)
const guest = await visitor('GUES', empty)
check('both are in the hall, and nobody else', (await host.evaluate(() => window.__cinema.handles.net.count)) === 2)

check('the browser can share a screen', await host.evaluate(() => window.__cinema.handles.net.screen.supported()))
check('the button is on the bar', (await host.locator('.rp-dock [data-role="share"]').count()) === 1)

/**
 * The whole thing, from one named side to the other.
 *
 * Run BOTH WAYS ROUND, and that is the point of it being a function. This
 * test used to share from the first visitor only, and passed - about half the
 * time. Which side of a peer connection you are is decided by comparing two
 * random ids, not by who joined first, and only one of those sides could
 * actually send: the other's m-lines were left receive-only, where putting a
 * track on resolves happily and sends nothing. Measured across four pairs, the
 * outcome followed the id order 8 times out of 8. A test that only ever tries
 * one side is a coin toss wearing a lab coat.
 */
/** Frames this viewer has decoded so far, read fresh: the counter is per
 *  connection and never resets, so each round is a rise from its own start. */
const framesSoFar = (page) =>
  page.evaluate(async () => {
    let best = 0
    for (const conn of window.__cinema.handles.net.voice.connections?.values?.() ?? []) {
      const stats = await conn.pc?.getStats?.()
      stats?.forEach((s) => {
        if (s.type === 'inbound-rtp' && s.kind === 'video') best = Math.max(best, s.framesDecoded || 0)
      })
    }
    return best
  })

async function shareFrom(sharer, viewer, who) {
  const framesAlready = await framesSoFar(viewer)
  // Aim the share at THIS tab. A real person picks in the browser's own dialog,
  // which no test can click; the flag that answers it automatically matches by
  // window title, and both windows here are called "Virtual Cinema" - so
  // without this the sharer cheerfully shared the other's window and the
  // picture that arrived was their own dark room.
  await sharer.evaluate(() => {
    if (navigator.mediaDevices.__aimed) return
    const real = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getDisplayMedia = (opts) => real({ ...opts, preferCurrentTab: true })
    navigator.mediaDevices.__aimed = true
  })

  // Something unmistakable to look at: a full page of one colour, painted over
  // the room, so the frames that arrive can be identified by eye and by number.
  await sharer.evaluate(() => {
    if (document.getElementById('probe-flag')) return
    const flag = document.createElement('div')
    flag.id = 'probe-flag'
    Object.assign(flag.style, { position: 'fixed', inset: '0', zIndex: '999', background: 'rgb(0, 200, 90)' })
    document.body.appendChild(flag)
  })

  // A background tab is throttled, and a throttled tab produces no frames to
  // capture. The sharer is the one looking at their own screen, so this is the
  // honest state to test in.
  await sharer.bringToFront()
  await sharer.waitForTimeout(600)

  const started = await sharer.evaluate(async () => {
    try {
      await window.__cinema.handles.net.screen.start()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: `${err.reason ?? err.name}: ${err.message}` }
    }
  })
  if (!check(`${who}: sharing starts`, started.ok === true, started.error ?? '')) return

  // An encoder that has just been handed a screen needs a moment, and a tab
  // that lost focus in between produces no frames to encode. Both cost a run.
  await sharer.bringToFront()
  await sharer.waitForTimeout(2500)

  const arrived = await poll(viewer, () => {
    const video = document.querySelector('video')
    return !!video?.srcObject && video.videoWidth > 0 ? `${video.videoWidth}x${video.videoHeight}` : ''
  }, 60)
  check(`${who}: the picture reaches the other side`, !!arrived, String(arrived || 'nothing'))

  // The decisive one: read the frames the viewer is actually being sent.
  const colour = await poll(viewer, () => {
    const video = document.querySelector('video')
    if (!video || !video.videoWidth) return ''
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0, 32, 32)
    const { data } = ctx.getImageData(0, 0, 32, 32)
    let r = 0
    let g = 0
    let b = 0
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]
      g += data[i + 1]
      b += data[i + 2]
    }
    const n = data.length / 4
    const avg = [Math.round(r / n), Math.round(g / n), Math.round(b / n)]
    // Wait for something that is not a black first frame.
    return avg[0] + avg[1] + avg[2] > 30 ? avg.join(',') : ''
  }, 40)
  const [r, g, b] = String(colour).split(',').map(Number)
  check(
    `${who}: and they are the sharer's own frames`,
    g > 120 && g > r + 60 && g > b + 40,
    `average colour ${colour || 'black'} (looking for green)`,
  )

  // Frames DECODED, off the connection itself: a still picture on a screen
  // could be a frozen first frame, and this cannot be.
  // Cumulative on the connection, so the SECOND share has to be read as a
  // rise from where the first one left off - not as "more than zero", which
  // stays true long after a share has stopped.
  const decoded = await poll(viewer, async (since) => {
    let best = 0
    for (const conn of window.__cinema.handles.net.voice.connections?.values?.() ?? []) {
      const stats = await conn.pc?.getStats?.()
      stats?.forEach((s) => {
        if (s.type === 'inbound-rtp' && s.kind === 'video') best = Math.max(best, s.framesDecoded || 0)
      })
    }
    return best > since ? best : 0
  }, 30, framesAlready)
  check(`${who}: real frames are being decoded`, Number(decoded) > framesAlready, `${framesAlready} -> ${decoded} frames`)

  check(`${who}: the sharer sees it on the room screen too`, await sharer.evaluate(() => !!document.querySelector('video')?.srcObject))

  await sharer.evaluate(() => window.__cinema.handles.net.screen.stop())
  const gone = await poll(viewer, () => !document.querySelector('video')?.srcObject, 30)
  check(`${who}: stopping takes it off every screen`, gone === true)
  await sharer.evaluate(() => document.getElementById('probe-flag')?.remove())
  await viewer.waitForTimeout(1000)
}

const ids = {
  host: await host.evaluate(() => window.__cinema.handles.net.client.id),
  guest: await guest.evaluate(() => window.__cinema.handles.net.client.id),
}
// Which side offers is decided by comparing these, so both orders are covered
// by running it both ways - and the ids are printed to make that legible when
// one direction fails.
console.log(`  ids: host ${ids.host} · guest ${ids.guest} (the lower one offers)`)
await shareFrom(host, guest, 'the one who joined first')
await shareFrom(guest, host, 'the one who joined second')

// --- a phone has no screen to hand over, so it hands over its camera -------
// `getDisplayMedia` does not exist on iOS or Android at all, and the button
// was simply missing there: sharing was something only the person at a desktop
// could do. Taking it away here is exactly what a phone looks like.
{
  // Its own browser: the fake camera flags below turn desktop capture black,
  // measured, so they must not be in the air while the real share is checked.
  const handset = await playwright.chromium.launch({
    headless: process.env.HEADLESS === '1',
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      ...(process.env.HEADLESS === '1' ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] : []),
    ],
  })
  const phone = await handset.newPage({ viewport: { width: 390, height: 780 } })
  phone.on('pageerror', (e) => errors.push(`PHONE PAGEERROR ${e.message}`))
  await phone.addInitScript(() => {
    // Off the prototype, which is where it actually lives - deleting it from
    // the instance is a no-op and the check silently passes down the desktop
    // road instead.
    delete MediaDevices.prototype.getDisplayMedia
  })
  await phone.goto(ORIGIN, { waitUntil: 'domcontentloaded' })
  for (let i = 0; i < 80; i++) {
    if (await phone.evaluate(() => window.__cinema?.ready === true)) break
    await phone.waitForTimeout(500)
  }
  await phone.fill('.mo-overlay [data-role="name"]', 'PHONE')
  await phone.locator('.mo-overlay .mo-hall').nth(3).click()
  await phone.click('.mo-overlay [data-role="cta"]')
  await phone.waitForTimeout(2500)
  await phone.evaluate(() => document.exitPointerLock?.())
  await phone.evaluate(() => window.__cinema.handles.room.show())
  await phone.waitForTimeout(500)
  check(
    'a phone is still offered the share button',
    await phone.evaluate(() => window.__cinema.handles.net.screen.supported()),
  )
  check(
    'and it is offered as a camera',
    await phone.evaluate(() => window.__cinema.handles.net.screen.cameraOnly()),
  )
  const started = await phone.evaluate(() =>
    window.__cinema.handles.net.screen.start().then(() => true, (e) => e.message),
  )
  check('the camera really opens', started === true, String(started))
  check(
    'and the hall is told somebody is live',
    await phone.evaluate(() => window.__cinema.handles.net.screen.sharing),
  )
  await phone.evaluate(() => window.__cinema.handles.net.screen.stop())
  await handset.close()
}

const real = errors.filter((e) => !/favicon|WebSocket|8787|Permissions policy/i.test(e))
check('no console errors', real.length === 0, real.slice(0, 3).join(' | '))

console.log(out.join('\n'))
await browser.close()
process.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0)

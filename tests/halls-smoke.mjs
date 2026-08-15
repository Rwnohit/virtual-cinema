/**
 * Four halls, one screening each.
 *
 * The thing being proved cannot be checked any other way than with two real
 * browsers: one person starts a film and lets it run, a second walks in
 * afterwards, and has to land inside the same minute rather than at the
 * opening frame. Everything else is the fence around that - halls stay
 * separate, names travel, a film somebody else starts arrives, and a film off
 * your own disk says so.
 *
 *   npm run build && npm run server      # then, in another shell:
 *   npm run test:halls
 *   ORIGIN=https://your-deployment.example.com npm run test:halls
 *
 * Every section opens the browsers it needs and closes them again. A page
 * holding a 3D hall and a YouTube player is expensive, and one kept alive
 * across the whole run died halfway through against the real server - which
 * reads exactly like a broken feature and is not one.
 */
import playwright from 'playwright'

const ORIGIN = process.env.ORIGIN || 'http://127.0.0.1:8787'
/** A film long enough that "deep into it" is a real place. */
const FILM = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'

const out = []
const errors = []
const check = (name, ok, detail = '') => {
  out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
  return ok
}

/**
 * A real window by default, and this is not a preference.
 *
 * Measured: a YouTube player in headless Chromium ignores seekTo entirely -
 * asked for second 300 it stays on second 1 and keeps counting - so every
 * check about walking into a film that is already running would be testing the
 * harness. HEADLESS=1 still runs the rest.
 */
const browser = await playwright.chromium.launch({
  headless: process.env.HEADLESS === '1',
  args:
    process.env.HEADLESS === '1'
      ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']
      : ['--autoplay-policy=no-user-gesture-required'],
})

/** Open the foyer, type a name, pick a hall, walk in. */
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
  // Hand the mouse back, the way a person presses Escape to reach the panel.
  // With the pointer locked the canvas swallows every click.
  await page.evaluate(() => document.exitPointerLock?.())
  await page.waitForTimeout(300)
  return page
}

const poll = async (page, fn, arg, tries = 60) => {
  for (let i = 0; i < tries; i++) {
    const value = await page.evaluate(fn, arg)
    if (value) return value
    await page.waitForTimeout(500)
  }
  return page.evaluate(fn, arg)
}

/** Put a film on the way a person does: paste, press play. */
async function putFilmOn(page, film) {
  await page.fill('.ms-dock [data-role="url"]', film)
  await page.click('.ms-dock [data-role="load"]')
}

const rooms = await fetch(`${ORIGIN}/rooms`).then((r) => r.json())
check('the menu lists four halls', rooms.halls?.length === 4, JSON.stringify(rooms.halls?.map((h) => h.id)))

/* -------------------------------------------------------------------------- */
/* the halls are separate                                                      */
/* -------------------------------------------------------------------------- */
{
  const one = await visitor('ALFA', 'hall-1')
  const two = await visitor('GAMA', 'hall-2')
  check('a visitor lands in the hall they picked', (await one.evaluate(() => window.__cinema.handles.net.room)) === 'hall-1')
  check('the name they typed is theirs', (await one.evaluate(() => window.__cinema.handles.net.client.name)) === 'ALFA')
  check('hall 2 does not see hall 1', (await two.evaluate(() => window.__cinema.handles.net.count)) === 1)
  check('hall 1 does not see hall 2', (await one.evaluate(() => window.__cinema.handles.net.count)) === 1)

  const menu = await fetch(`${ORIGIN}/rooms`).then((r) => r.json())
  const a = menu.halls.find((h) => h.id === 'hall-1')
  const b = menu.halls.find((h) => h.id === 'hall-2')
  check('the menu shows who is where', a.peers === 1 && b.peers === 1, `${a.peers} / ${b.peers}`)
  check('the menu carries the names', a.names.includes('ALFA') && b.names.includes('GAMA'), `${a.names} | ${b.names}`)
  await one.close()
  await two.close()
}

/* -------------------------------------------------------------------------- */
/* a film somebody else starts                                                 */
/* -------------------------------------------------------------------------- */
// The reported case: both already standing in the hall, and then one of them
// puts a film on.
{
  const watcher = await visitor('ALFA', 'hall-3')
  const host = await visitor('BETA', 'hall-3')
  await putFilmOn(host, FILM)
  const followed = await poll(watcher, () => window.__cinema.handles.media?.embedKind === 'youtube', null, 40)
  check('a film started by somebody else reaches the room', followed === true)
  const playing = await poll(watcher, () => window.__cinema.handles.media?.isPlaying === true, null, 30)
  check('and it plays there too', playing === true)
  await host.close()
  await watcher.close()
}

/* -------------------------------------------------------------------------- */
/* the room itself is shared                                                   */
/* -------------------------------------------------------------------------- */
// A hall has ONE curtain, one set of house lights and one set of seats. Two
// people standing in it were each drawing their own private copy, which is
// what "nothing is synced" turned out to mean.
{
  const one = await visitor('ALFA', 'hall-2')
  const two = await visitor('BETA', 'hall-2')

  await one.evaluate(() => window.__cinema.handles.room.setHouseLights(0.9))
  const lights = await poll(two, () => window.__cinema.handles.room.settings.house > 0.8, null, 20)
  check('house lights reach the whole hall', lights === true, `other side: ${await two.evaluate(() => window.__cinema.handles.room.settings.house)}`)

  // Through the panel, not through the wire. Calling sendStage() by hand would
  // only prove that the wire works, which was never in doubt: what broke was
  // that moving something never reached the wire at all.
  await one.evaluate(() => window.__cinema.handles.room.open('screen'))
  await one.waitForTimeout(400)
  await one.locator('.rp-pop .rp-page.is-on .rp-row button').nth(1).click() // "closed"
  const curtain = await poll(two, () => window.__cinema.handles.scene.cinema.curtains > 0.5, null, 20)
  check('the curtain is one curtain', curtain === true, `other side: ${await two.evaluate(() => window.__cinema.handles.scene.cinema.curtains)}`)

  await one.evaluate(() => window.__cinema.handles.room.open('view'))
  await one.waitForTimeout(400)
  await one.evaluate(() => {
    const rows = [...document.querySelectorAll('.rp-pop .rp-page.is-on .rp-field')]
    const row = rows.find((r) => /θεατ|seats/i.test(r.querySelector('.rp-name')?.textContent ?? ''))
    const input = row?.querySelector('input')
    if (!input) throw new Error('no audience slider on the View page')
    input.value = '0.5'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const crowd = await poll(two, () => window.__cinema.handles.audience.share > 0.3, null, 20)
  check('the seats fill for everybody', crowd === true, `other side: ${await two.evaluate(() => window.__cinema.handles.audience.share)}`)

  // And somebody arriving later walks into the room as it stands.
  const late = await visitor('GAMA', 'hall-2')
  const inherited = await poll(late, () => window.__cinema.handles.room.settings.house > 0.8, null, 20)
  check('a latecomer gets the room as it is', inherited === true, `${await late.evaluate(() => window.__cinema.handles.room.settings.house)}`)
  await late.close()
  await two.close()
  await one.close()
}

/* -------------------------------------------------------------------------- */
/* a film off your own disk                                                    */
/* -------------------------------------------------------------------------- */
{
  const solo = await visitor('EPSI', 'hall-4')
  await solo.setInputFiles('.ms-dock [data-role="file"]', 'public/sample.webm')
  const warned = await poll(solo, () => document.querySelector('.rp-notice.is-on')?.textContent?.trim() || '', null, 30)
  check('a private film is called out', /μόνο εσ|only you/i.test(String(warned)), String(warned).slice(0, 40) || 'nothing')
  // Still there once the ceremony has had its say, which is what killed the
  // old one-and-a-half second flash.
  await solo.waitForTimeout(4000)
  check('and the warning does not fade away', (await solo.evaluate(() => !!document.querySelector('.rp-notice.is-on'))) === true)
  await solo.close()
}

/* -------------------------------------------------------------------------- */
/* walking into a screening that is already running                            */
/* -------------------------------------------------------------------------- */
{
  const first = await visitor('ALFA', 'hall-1')
  await putFilmOn(first, FILM)
  check('the film is on', !!(await poll(first, () => window.__cinema.handles.media?.embedKind === 'youtube', null, 40)))

  // Deep, but inside the film: seeking past the end of a ten minute clip lands
  // on nothing, which once read as a broken feature and was a bad number.
  const duration = await poll(first, () => {
    const d = window.__cinema.handles.media?.duration ?? 0
    return d > 30 ? d : 0
  })
  const DEEP = Math.round(duration * 0.7)
  check('the film knows how long it is', duration > 60, `${Math.round(duration)}s`)

  await first.evaluate((at) => window.__cinema.handles.media.seek(at), DEEP)
  await poll(first, (deep) => window.__cinema.handles.media.currentTime > deep - 5, DEEP, 40)
  const running = await first.evaluate(() => window.__cinema.handles.media.currentTime)
  check('the first one is deep into the film', Math.abs(running - DEEP) < 10, `${running.toFixed(0)}s of ${Math.round(duration)}s`)

  // Long enough that anyone ignoring the hall's clock would be far away.
  await first.waitForTimeout(6000)

  const second = await visitor('BETA', 'hall-1')
  const landed = await poll(second, () => {
    const at = window.__cinema.handles.media?.currentTime ?? 0
    return at > 30 ? at : 0
  })
  check(
    'they walk in where the film already is, not at the start',
    landed > DEEP - 30,
    `landed at ${Number(landed).toFixed(0)}s, the hall was at ${DEEP}s`,
  )
  const drift = Math.abs(landed - (await first.evaluate(() => window.__cinema.handles.media.currentTime)))
  check('and they are watching the same moment', drift < 6, `${drift.toFixed(1)}s apart`)

  await second.evaluate(() => window.__cinema.handles.media.pause())
  check('pause reaches the whole hall', (await poll(first, () => window.__cinema.handles.media.isPlaying === false)) === true)

  const menu = await fetch(`${ORIGIN}/rooms`).then((r) => r.json())
  const hall1 = menu.halls.find((h) => h.id === 'hall-1')
  check('the menu shows the hall filled up', hall1.peers === 2, String(hall1.peers))
  check('the menu shows a film is on', hall1.showing === true)
  check('the menu shows how far in it is', hall1.time > DEEP - 30, `${hall1.time}s`)
  check('the menu carries both names', hall1.names.includes('ALFA') && hall1.names.includes('BETA'), hall1.names.join(','))
  await second.close()
  await first.close()
}

// The permissions-policy lines come out of YouTube's own iframe, not our code.
const real = errors.filter((e) => !/favicon|WebSocket|8787|Permissions policy/i.test(e))
check('no console errors', real.length === 0, real.slice(0, 3).join(' | '))

console.log(out.join('\n'))
await browser.close()
process.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0)

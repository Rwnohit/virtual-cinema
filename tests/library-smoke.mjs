/**
 * The programme, and the room it plays to.
 *
 * The catalogue is one file the venue owns, so the checks are about the two
 * things that make it a cinema rather than a list: a poster you can click, and
 * a film that starts for EVERYBODY when you do.
 *
 *   npm run test:library
 *   ORIGIN=https://your-deployment.example.com npm run test:library
 */
import playwright from 'playwright'

const ORIGIN = process.env.ORIGIN || 'http://127.0.0.1:8787'
const out = []
const errors = []
const check = (n, ok, d = '') => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  (${d})` : ''}`); return ok }

const catalogue = await fetch(`${ORIGIN}/library.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
check('the catalogue is served', Array.isArray(catalogue?.films) && catalogue.films.length > 0, `${catalogue?.films?.length ?? 0} films`)
check('every film has a link', (catalogue?.films ?? []).every((f) => /^https?:/.test(f.src || '')))

// A film nobody can fetch is a poster with nothing behind it.
const first = catalogue.films[0]
// With an Origin, the way a browser asks. A CDN only answers the cross-origin
// question when it is actually asked one.
const head = await fetch(first.src, { method: 'HEAD', headers: { origin: ORIGIN } })
const type = head.headers.get('content-type') || ''
check('the first film really is there', head.ok && /video\/|mpegurl/i.test(type), `${head.status} ${type}`)
check('a browser is allowed to fetch it', (head.headers.get('access-control-allow-origin') || '') === '*')

const browser = await playwright.chromium.launch({
  headless: process.env.HEADLESS === '1',
  args: ['--autoplay-policy=no-user-gesture-required'],
})
async function visitor(name, hall) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } })
  page.on('pageerror', (e) => errors.push(`${name} ${e.message}`))
  // A renderer that dies takes every later check with it and says only
  // "target closed", which reads like a broken test rather than a broken tab.
  page.on('crash', () => errors.push(`${name} THE TAB CRASHED`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name} ${m.text()}`))
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' })
  for (let i = 0; i < 80; i++) { if (await page.evaluate(() => window.__cinema?.ready === true)) break; await page.waitForTimeout(500) }
  await page.fill('.mo-overlay [data-role="name"]', name)
  await page.locator('.mo-overlay .mo-hall').nth(hall).click()
  await page.click('.mo-overlay [data-role="cta"]')
  for (let i = 0; i < 40; i++) { if (await page.evaluate(() => window.__cinema.handles.net?.status === 'online')) break; await page.waitForTimeout(500) }
  await page.evaluate(() => document.exitPointerLock?.())
  await page.waitForTimeout(300)
  return page
}
const poll = async (page, fn, tries = 40) => {
  for (let i = 0; i < tries; i++) { const v = await page.evaluate(fn); if (v) return v; await page.waitForTimeout(500) }
  return page.evaluate(fn)
}

const host = await visitor('ALFA', 1)
// What opening the library actually costs, in bytes off the wire. This is the
// check that matters most here: the posters were the publisher's production
// art, 167 MB of it for 88 films, and a tab asked to fetch and decode all of
// that while running a 3D room simply died.
let posterBytes = 0
let posterCount = 0
host.on('response', async (r) => {
  if (r.request().resourceType() !== 'image') return
  posterCount += 1
  try { posterBytes += (await r.body()).length } catch { /* still in flight when the page went */ }
})
const guest = await visitor('BETA', 1)

await host.evaluate(() => window.__cinema.handles.room.open('library'))
await host.waitForTimeout(1800)
const posters = await host.locator('.rp-pop .rp-slide').count()
check('the programme is on the wall', posters >= 3, `${posters} on the rail`)
const hero = await host.evaluate(() => ({
  title: document.querySelector('.rp-hero h3')?.textContent ?? '',
  facts: document.querySelector('.rp-hero-facts')?.textContent ?? '',
  art: !!document.querySelector('.rp-hero-bg')?.style.backgroundImage,
}))
check('the featured film is named', hero.title.length > 2, hero.title)
check('it says how long and by whom', /\d/.test(hero.facts) && hero.facts.length > 6, hero.facts)
check('and it has a poster behind it', hero.art)

// Picking from the rail promotes, it does not start: nobody should change the
// film for a whole hall by brushing past a thumbnail.
await host.locator('.rp-pop .rp-slide').nth(1).click()
await host.waitForTimeout(400)
const promoted = await host.evaluate(() => document.querySelector('.rp-hero h3')?.textContent ?? '')
check('the rail promotes rather than plays', promoted !== hero.title, `${hero.title} -> ${promoted}`)

// The chip row runs: All, Films, Series, The rest | most watched, most liked,
// feature length. Named here rather than counted at each use, because the
// first version of this counted wrong and quietly tested nothing.
const KIND_ALL = 0
const KIND_SERIES = 2
const SORT_VIEWS = 4
const SORT_LENGTH = 6
const chip = (n) => host.locator('.rp-pop .rp-filter').nth(n)

// Sorting reorders the grid rather than reloading it.
const firstByViews = await host.evaluate(() => document.querySelector('.rp-slide b')?.textContent ?? '')
await chip(SORT_LENGTH).click()
await host.waitForTimeout(500)
const firstByLength = await host.evaluate(() => document.querySelector('.rp-slide b')?.textContent ?? '')
await chip(SORT_VIEWS).click()
await host.waitForTimeout(300)
check('the filters reorder the programme', firstByViews !== firstByLength, `${firstByViews} -> ${firstByLength}`)
check(
  'the grid scrolls down rather than sideways',
  await host.evaluate(() => {
    const rail = document.querySelector('.rp-rail')
    return !!rail && rail.scrollHeight > rail.clientHeight + 40
  }),
)

// Categories narrow the programme, search narrows it further.
const all = await host.evaluate(() => document.querySelectorAll('.rp-slide').length)
await chip(KIND_SERIES).click()
await host.waitForTimeout(400)
const series = await host.evaluate(() => document.querySelectorAll('.rp-slide').length)
check('the categories narrow it down', series > 0 && series < all, `${all} -> ${series} series`)
await chip(KIND_ALL).click()
await host.waitForTimeout(300)

await host.fill('.rp-find input', 'hell')
await host.waitForTimeout(500)
const found = await host.evaluate(() => [...document.querySelectorAll('.rp-slide b')].map((b) => b.textContent))
check('search finds a film by name', found.some((n) => /hell/i.test(n)) && found.length < all, `${found.length}: ${found.slice(0, 3)}`)

await host.fill('.rp-find input', 'zzzzqq')
await host.waitForTimeout(500)
check('and says so when nothing matches', await host.evaluate(() => !!document.querySelector('.rp-nohits')))
await host.fill('.rp-find input', '')
await host.waitForTimeout(400)

await host.locator('.rp-hero-play').click()
// Pressing start puts the programme away.
await host.waitForTimeout(900)
check('the panel gets out of the way', await host.evaluate(() => !document.querySelector('.rp-pop.is-open')))
check('the film starts for the one who picked it', !!(await poll(host, () => (window.__cinema.handles.media.currentTime || 0) > 1)))
check('and for everybody else in the hall', !!(await poll(guest, () => (window.__cinema.handles.media.currentTime || 0) > 1)))
check(
  'the hall sound reaches it',
  (await guest.evaluate(() => window.__cinema.handles.media.isSpatial)) === true,
)
const apart = Math.abs(
  (await host.evaluate(() => window.__cinema.handles.media.currentTime)) -
    (await guest.evaluate(() => window.__cinema.handles.media.currentTime)),
)
check('and they are watching the same moment', apart < 6, `${apart.toFixed(1)}s apart`)

// The interval: pauses the hall and brings the lights up.
await host.waitForTimeout(5000)
await host.evaluate(() => window.__cinema.handles.room.open('library'))
await host.waitForTimeout(600)
const lightsBefore = await host.evaluate(() => window.__cinema.handles.room.settings.house)
await host.locator('.rp-hero-hold').click()
await host.waitForTimeout(1200)
check('the interval stops the film for everybody', (await poll(guest, () => window.__cinema.handles.media.isPlaying === false)) === true)
const lightsAfter = await host.evaluate(() => window.__cinema.handles.room.settings.house)
check('and brings the lights up', lightsAfter > lightsBefore, `${lightsBefore} -> ${lightsAfter}`)

// --- the bar: level, interval, queue -------------------------------------
await host.evaluate(() => window.__cinema.handles.room.show())
await host.waitForTimeout(400)
await host.locator('.rp-dock [data-role="mute"]').click()
await host.waitForTimeout(400)
check('the speaker opens a level', await host.evaluate(() => !!document.querySelector('.rp-level.is-open')))
await host.evaluate(() => {
  const r = document.querySelector('.rp-level [data-role="vol"]')
  r.value = '35'
  r.dispatchEvent(new Event('input', { bubbles: true }))
})
await host.waitForTimeout(400)
check(
  'and the slider sets it',
  Math.abs((await host.evaluate(() => window.__cinema.handles.sound.volume)) - 0.35) < 0.02,
  String(await host.evaluate(() => window.__cinema.handles.sound.volume)),
)

check('the bar carries an interval button', (await host.locator('.rp-dock [data-role="interval"]').count()) === 1)
await host.evaluate(() => window.__cinema.handles.media.play())
await host.waitForTimeout(2500)
const litBefore = await host.evaluate(() => window.__cinema.handles.room.settings.house)
await host.locator('.rp-dock [data-role="interval"]').click()
await host.waitForTimeout(1500)
check('it pauses the hall', (await host.evaluate(() => window.__cinema.handles.media.isPlaying)) === false)
check('and lifts the lights', (await host.evaluate(() => window.__cinema.handles.room.settings.house)) > litBefore)

// A film can be queued from its poster without disturbing the screening.
await host.evaluate(() => window.__cinema.handles.room.open('library'))
await host.waitForTimeout(700)
const before = await host.evaluate(() => window.__cinema.handles.room.queue?.length ?? -1)
await host.locator('.rp-pop .rp-slide .rp-queue-add').nth(1).click()
await host.waitForTimeout(600)
check(
  'a poster can be added to the queue',
  (await host.evaluate(() => window.__cinema.handles.room.queue?.length ?? -1)) === before + 1,
  `${before} -> ${await host.evaluate(() => window.__cinema.handles.room.queue?.length ?? -1)}`,
)

// --- what the library weighs ----------------------------------------------
check(
  'the posters are ours and small',
  catalogue.films.filter((f) => String(f.poster).startsWith('/posters/')).length >= catalogue.films.length - 2,
  `${catalogue.films.filter((f) => String(f.poster).startsWith('/posters/')).length} of ${catalogue.films.length}`,
)
const poster = catalogue.films.find((f) => String(f.poster).startsWith('/posters/'))
const posterHead = await fetch(`${ORIGIN}${poster.poster}`, { method: 'HEAD' })
check(
  'a poster is a small webp',
  posterHead.ok && /image\/webp/.test(posterHead.headers.get('content-type') || '') && Number(posterHead.headers.get('content-length')) < 200_000,
  `${Math.round(Number(posterHead.headers.get('content-length')) / 1000)} KB`,
)
check(
  'a poster may be kept for a while',
  /max-age=\d{4,}/.test(posterHead.headers.get('cache-control') || ''),
  posterHead.headers.get('cache-control') || 'none',
)
check(
  'opening it fetches a screenful, not the whole festival',
  posterCount > 0 && posterCount < catalogue.films.length / 2 && posterBytes < 2_000_000,
  `${posterCount} images, ${(posterBytes / 1e6).toFixed(2)} MB`,
)
// The rest arrive when they are scrolled to, rather than never.
const paintedBefore = await host.evaluate(() => [...document.querySelectorAll('.rp-pop .rp-slide .art')].filter((a) => a.style.backgroundImage).length)
await host.evaluate(() => { const r = document.querySelector('.rp-rail'); r.scrollTop = r.scrollHeight })
await host.waitForTimeout(2500)
const paintedAfter = await host.evaluate(() => [...document.querySelectorAll('.rp-pop .rp-slide .art')].filter((a) => a.style.backgroundImage).length)
check('scrolling brings the rest', paintedAfter > paintedBefore, `${paintedBefore} -> ${paintedAfter}`)

// --- the end of a film is not a pause on its last frame -------------------
// Left as one, the hall's clock said "stopped, at the last second", so the
// next press of play put everybody back on that second, hit the end again
// and stopped: the loop.
await host.evaluate(() => {
  const m = window.__cinema.handles.media
  m.seek(Math.max(0, m.duration - 2))
  m.play()
})

await poll(host, () => window.__cinema.handles.media.currentTime < 1 && !window.__cinema.handles.media.isPlaying, 30)
check(
  'a finished film rewinds instead of freezing',
  (await host.evaluate(() => window.__cinema.handles.media.currentTime)) < 1,
  `at ${await host.evaluate(() => window.__cinema.handles.media.currentTime.toFixed(1))}s`,
)
// Rewound to zero, a stream has to refill before it moves again, so this is
// given room rather than a fixed wait.
await host.evaluate(() => window.__cinema.handles.media.play())
const moved = await poll(host, () => window.__cinema.handles.media.currentTime > 0.5, 30)
check(
  'and plays again from the top',
  moved === true && (await host.evaluate(() => window.__cinema.handles.media.isPlaying)),
  `at ${await host.evaluate(() => window.__cinema.handles.media.currentTime.toFixed(1))}s`,
)

const real = errors.filter((e) => !/favicon|WebSocket|8787|Permissions policy/i.test(e))
check('no console errors', real.length === 0, real.slice(0, 2).join(' | '))

console.log(out.join('\n'))
await browser.close()
process.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0)

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

// Filters reorder the grid rather than reloading it.
const firstByViews = await host.evaluate(() => document.querySelector('.rp-slide b')?.textContent ?? '')
await host.locator('.rp-pop .rp-filter').nth(2).click()
await host.waitForTimeout(500)
const firstByLength = await host.evaluate(() => document.querySelector('.rp-slide b')?.textContent ?? '')
check('the filters reorder the programme', firstByViews !== firstByLength, `${firstByViews} -> ${firstByLength}`)
check(
  'the grid scrolls down rather than sideways',
  await host.evaluate(() => {
    const rail = document.querySelector('.rp-rail')
    return !!rail && rail.scrollHeight > rail.clientHeight + 40
  }),
)

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

const real = errors.filter((e) => !/favicon|WebSocket|8787|Permissions policy/i.test(e))
check('no console errors', real.length === 0, real.slice(0, 2).join(' | '))

console.log(out.join('\n'))
await browser.close()
process.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0)

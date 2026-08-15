/**
 * The shipped room, checked the way a visitor meets it.
 *
 * One process serves the page AND runs the room, so everything here talks to
 * that one port and never to Vite. Two browsers open the same address and have
 * to see each other, because that is the whole point of putting it up.
 *
 *   npm run build && npm run server     # then, in another shell:
 *   npm run test:prod
 *   ORIGIN=https://your-deployment.example.com npm run test:prod
 */
import playwright from 'playwright'

const ORIGIN = process.env.ORIGIN || 'http://127.0.0.1:8787'
const out = []
const check = (name, ok, detail = '') => {
  out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
  return ok
}

const health = await fetch(`${ORIGIN}/health`).then((r) => r.json())
check('health answers', health.ok === true, JSON.stringify(health))
check('the build is on disk', health.site === true)

const page404 = await fetch(`${ORIGIN}/some/deep/route`)
check('an unknown route still returns the room', page404.status === 200)

const asset = await fetch(`${ORIGIN}/index.html`)
check('index is never cached hard', /no-cache/.test(asset.headers.get('cache-control') ?? ''))

const escape = await fetch(`${ORIGIN}/../package.json`)
check('cannot read outside the build', escape.status === 200 && !(await escape.text()).includes('"devDependencies"'))

const browser = await playwright.chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
})

const open = async (label) => {
  const page = await browser.newPage({ viewport: { width: 900, height: 620 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(`${label} PAGEERROR ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`${label} ${m.text()}`))
  await page.goto(`${ORIGIN}/?room=premiere&name=${label}`, { waitUntil: 'domcontentloaded' })
  for (let i = 0; i < 80; i++) {
    if (await page.evaluate(() => window.__cinema?.ready === true)) break
    await page.waitForTimeout(500)
  }
  const cta = page.locator('.mo-overlay [data-role="cta"]')
  if (await cta.count()) await cta.click({ timeout: 5000 }).catch(() => {})
  return { page, errors }
}

const a = await open('Alpha')
const b = await open('Beta')

check('the page boots from the server', await a.page.evaluate(() => window.__cinema?.ready === true))

// Both of them have to end up in the same room, seeing one other person.
const seen = async (who) => {
  for (let i = 0; i < 40; i++) {
    const count = await who.page.evaluate(() => window.__cinema.handles.net?.count ?? 0)
    if (count >= 2) return count
    await who.page.waitForTimeout(500)
  }
  return who.page.evaluate(() => window.__cinema.handles.net?.count ?? 0)
}
const countA = await seen(a)
const countB = await seen(b)
check('two people are in the room together', countA >= 2 && countB >= 2, `${countA} / ${countB}`)

const room = await a.page.evaluate(() => window.__cinema.handles.net?.room ?? null)
check('the room name comes from the url', room === 'premiere', String(room))

const version = await a.page.evaluate(() => document.querySelector('.rp-readout')?.textContent ?? '')
const errors = [...a.errors, ...b.errors].filter((e) => !/favicon/i.test(e))
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))

console.log(out.join('\n'))
if (version) console.log(`\nreadout: ${version}`)
await browser.close()
process.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0)

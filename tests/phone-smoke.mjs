/**
 * The cinema on a phone.
 *
 * Everything in this room was built for a mouse and a keyboard, and a phone
 * has neither: no pointer to lock, no W to walk with, and a third of the
 * screen taken by controls sized for a desk. This checks the three things a
 * person holding a phone actually needs - to get in, to move, and to reach
 * every control without anything running off the edge.
 *
 *   npm run test:phone
 *   ORIGIN=https://your-deployment.example.com npm run test:phone
 */
import playwright from 'playwright'

const ORIGIN = process.env.ORIGIN || 'http://127.0.0.1:8787'
const out = []
const errors = []
const check = (name, ok, detail = '') => {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`
  out.push(line)
  if (process.env.VERBOSE) console.log(line)
  return ok
}

const browser = await playwright.chromium.launch({
  headless: process.env.HEADLESS === '1',
  args: ['--autoplay-policy=no-user-gesture-required'],
})
// A real handset profile: the touch flags are what the room reads to decide
// there is no mouse coming.
const context = await browser.newContext({ ...playwright.devices['iPhone 13'], hasTouch: true, isMobile: true })
const page = await context.newPage()
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' })
for (let i = 0; i < 80; i++) {
  if (await page.evaluate(() => window.__cinema?.ready === true)) break
  await page.waitForTimeout(500)
}
await page.fill('.mo-overlay [data-role="name"]', 'PHONE')
await page.locator('.mo-overlay .mo-hall').nth(0).tap()
await page.locator('.mo-overlay [data-role="cta"]').tap()
await page.waitForTimeout(3000)

check('the room knows it is a phone', await page.evaluate(() => window.__cinema.handles.player.touchOnly === true))
// Pointer lock does not exist on iOS, and every gate downstream asks whether
// we are in the room. Without this, nothing below can pass.
check('you are inside the room without a pointer lock', await page.evaluate(() => window.__cinema.handles.player.controls.isLocked === true))
check('there is a stick to walk with', (await page.locator('.tc-stick').count()) === 1)

const box = (selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height) }
  }, selector)

const width = await page.evaluate(() => window.innerWidth)
const height = await page.evaluate(() => window.innerHeight)

// The bar carried 687px of controls on 380px of glass, and everything past
// the middle ran off the right hand edge where it could not be reached.
const spill = await page.evaluate(() => {
  const dock = document.querySelector('.rp-dock')
  return dock ? dock.scrollWidth - dock.clientWidth : -1
})
check('nothing on the bar runs off the screen', spill === 0, `${spill}px past the edge`)
const dock = await box('.rp-dock')
check('the bar fits on the screen', dock.left >= 0 && dock.right <= width, `${dock.left}..${dock.right} of ${width}`)
check('and it does not eat the room', dock.height < height * 0.25, `${dock.height}px of ${height}`)

// The picker was 139px of a 664px window, fixed over the room and over the
// player's own hints.
const picker = await box('.ms-dock')
check('the link box is a line, not a wall', picker.height < 70, `${picker.height}px tall`)

// Nothing may sit on top of anything else down there: measured, the room
// count sat on the bar's left end and swallowed the clicks meant for it.
const stick = await box('.tc-stick')
const hud = await box('.net-hud')
const overlaps = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
check('the stick is clear of the bar', !overlaps(stick, dock), `stick ${stick.top}..${stick.bottom}, bar ${dock.top}..${dock.bottom}`)
check('the room count is clear of both', !overlaps(hud, dock) && !overlaps(hud, stick))

// The point of all of it: a finger moves you.
const before = await page.evaluate(() => ({ ...window.__cinema.handles.player.controls.feet }))
await page.evaluate((point) => {
  const canvas = document.querySelector('canvas')
  const target = document.querySelector('.tc-stick')
  const touch = (type, x, y) =>
    canvas.dispatchEvent(new TouchEvent(type, { bubbles: true, changedTouches: [new Touch({ identifier: 1, target, clientX: x, clientY: y })] }))
  touch('touchstart', point.x, point.y)
  touch('touchmove', point.x, point.y - 40)
}, { x: stick.left + 59, y: stick.top + 59 })
await page.waitForTimeout(1500)
const after = await page.evaluate(() => ({ ...window.__cinema.handles.player.controls.feet }))
const walked = Math.hypot(after.x - before.x, after.z - before.z)
check('pushing the stick walks you across the room', walked > 1, `${walked.toFixed(1)}m`)

// And a finger turns you.
const facing = await page.evaluate(() => window.__cinema.handles.player.controls.yaw)
await page.evaluate(() => {
  const canvas = document.querySelector('canvas')
  const touch = (type, x, y) =>
    canvas.dispatchEvent(new TouchEvent(type, { bubbles: true, changedTouches: [new Touch({ identifier: 2, target: canvas, clientX: x, clientY: y })] }))
  touch('touchstart', 200, 300)
  touch('touchmove', 120, 300)
  touch('touchend', 120, 300)
})
await page.waitForTimeout(300)
const turned = Math.abs((await page.evaluate(() => window.__cinema.handles.player.controls.yaw)) - facing)
check('dragging turns you round', turned > 0.1, `${turned.toFixed(2)} radians`)

// The hints have to be about hands, not keys.
const hint = await page.evaluate(() => document.querySelector('.pl-keys, .pl-hud')?.textContent ?? '')
check('the hints talk about fingers, not W A S D', !/W A S D/.test(hint), hint.slice(0, 60))

const real = errors.filter((e) => !/favicon|WebSocket|8787|Permissions policy/i.test(e))
check('no console errors', real.length === 0, real.slice(0, 2).join(' | '))

console.log(out.join('\n'))
await browser.close()
process.exit(out.some((line) => line.startsWith('FAIL')) ? 1 : 0)

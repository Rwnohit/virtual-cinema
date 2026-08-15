/**
 * Smoke test: every feature module exposes the factory main.js looks for.
 *
 * This is a static check (the modules need WebGL, so they cannot be imported in
 * Node). It catches the most common integration break in a parallel build:
 * a module that exists but exports a name nobody else calls. The real
 * scene/video verification lives in tests/browser-smoke.mjs and QA-MANUAL.md.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { MODULE_ENTRIES, firstExisting, read } from './helpers.mjs'

const FACTORIES = {
  scene: ['createScene', 'initScene', 'setupScene', 'buildScene'],
  player: ['createPlayer', 'initPlayer', 'setupPlayer'],
  media: ['createMedia', 'initMedia', 'setupMedia', 'createScreen'],
  sound: ['createSound', 'initSound'],
  update: ['createUpdater', 'createUpdate'],
  room: ['createRoom', 'createRoomControls'],
  net: ['createNet', 'initNet', 'setupNet', 'connect'],
}

/** Matches `export function X`, `export const X =`, `export { X }` and `export default`. */
function exportsAnyOf(source, names) {
  if (/export\s+default/.test(source)) return true
  return names.some((name) =>
    new RegExp(`export\\s+(async\\s+)?(function|const|let|class)\\s+${name}\\b`).test(source) ||
    new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(source)
  )
}

for (const [name, candidates] of Object.entries(MODULE_ENTRIES)) {
  test(`module "${name}" εκθέτει factory που καλεί το main.js`, (t) => {
    const entry = firstExisting(candidates)
    if (!entry) {
      t.skip(`δεν υπάρχει ακόμη (${candidates.join(' ή ')})`)
      return
    }
    const source = read(entry)
    assert.ok(
      exportsAnyOf(source, FACTORIES[name]),
      `${entry}: χρειάζεται export ${FACTORIES[name].join(' / ')} ή default`
    )
  })
}

test('η σκηνή ορίζει οθόνη και θέσεις', (t) => {
  const entry = firstExisting(['src/scene/constants.js', 'src/scene/index.js', 'src/scene.js'])
  if (!entry) {
    t.skip('δεν υπάρχει ακόμη το module της σκηνής')
    return
  }
  const source = read(entry)
  assert.match(source, /SCREEN|screen/i, `${entry}: δεν βρέθηκε ορισμός οθόνης`)
  assert.match(source, /SEAT|seat/i, `${entry}: δεν βρέθηκε ορισμός θέσεων`)
})

test('το media module παίζει βίντεο σε texture', (t) => {
  const entry = firstExisting(MODULE_ENTRIES.media)
  if (!entry) {
    t.skip('δεν υπάρχει ακόμη το module του βίντεο')
    return
  }
  const source = read(entry)
  assert.match(source, /VideoTexture|createElement\(['"]video['"]\)|<video/i, `${entry}: δεν βρέθηκε στοιχείο βίντεο`)
})

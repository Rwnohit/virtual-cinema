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
  test(`module "${name}" exposes the factory main.js calls`, (t) => {
    const entry = firstExisting(candidates)
    if (!entry) {
      t.skip(`not there yet (${candidates.join(' or ')})`)
      return
    }
    const source = read(entry)
    assert.ok(
      exportsAnyOf(source, FACTORIES[name]),
      `${entry}: wants an export of ${FACTORIES[name].join(' / ')}, or a default`
    )
  })
}

test('the scene defines a screen and seats', (t) => {
  const entry = firstExisting(['src/scene/constants.js', 'src/scene/index.js', 'src/scene.js'])
  if (!entry) {
    t.skip('the scene module is not there yet')
    return
  }
  const source = read(entry)
  assert.match(source, /SCREEN|screen/i, `${entry}: no screen definition found`)
  assert.match(source, /SEAT|seat/i, `${entry}: no seat definition found`)
})

test('the media module plays video into a texture', (t) => {
  const entry = firstExisting(MODULE_ENTRIES.media)
  if (!entry) {
    t.skip('the video module is not there yet')
    return
  }
  const source = read(entry)
  assert.match(source, /VideoTexture|createElement\(['"]video['"]\)|<video/i, `${entry}: no video element found`)
})

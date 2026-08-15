/**
 * Smoke test: the project skeleton is wired correctly.
 * Runs in a second, needs no browser and no server.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { at, exists, read } from './helpers.mjs'

test('package.json έχει τα scripts dev / server / test', () => {
  const pkg = JSON.parse(read('package.json'))
  for (const script of ['dev', 'server', 'test']) {
    assert.ok(pkg.scripts?.[script], `λείπει το npm script "${script}"`)
  }
  assert.match(pkg.scripts.dev, /vite/, 'το dev πρέπει να σηκώνει τον vite')
  assert.match(pkg.scripts.server, /node .*server/, 'το server πρέπει να τρέχει τον node server')
})

test('package.json δηλώνει three και ws', () => {
  const pkg = JSON.parse(read('package.json'))
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  assert.ok(deps.three, 'λείπει το three')
  assert.ok(deps.ws, 'λείπει το ws (χρειάζεται ο server)')
})

test('index.html φορτώνει το src/main.js μέσα σε #app', () => {
  assert.ok(exists('index.html'), 'λείπει το index.html')
  const html = read('index.html')
  assert.match(html, /id="app"/, 'λείπει το <div id="app">')
  assert.match(html, /type="module"[^>]*src="\/src\/main\.js"/, 'λείπει το <script type="module" src="/src/main.js">')
})

test('το main.js ενώνει και τα τέσσερα modules', () => {
  assert.ok(exists('src/main.js'), 'λείπει το src/main.js')
  const source = read('src/main.js')
  for (const name of ['scene', 'player', 'media', 'net']) {
    assert.match(source, new RegExp(`\\./${name}`), `το main.js δεν φορτώνει το module "${name}"`)
  }
  assert.match(source, /window\.__cinema/, 'το main.js πρέπει να εκθέτει το window.__cinema για τα tests')
})

test('υπάρχει σενάριο χειροκίνητου QA', () => {
  assert.ok(exists('tests/QA-MANUAL.md'), `λείπει το ${at('tests/QA-MANUAL.md')}`)
})

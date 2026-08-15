/**
 * Smoke test: the project skeleton is wired correctly.
 * Runs in a second, needs no browser and no server.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { at, exists, read } from './helpers.mjs'

test('package.json has the dev / server / test scripts', () => {
  const pkg = JSON.parse(read('package.json'))
  for (const script of ['dev', 'server', 'test']) {
    assert.ok(pkg.scripts?.[script], `the npm script "${script}" is missing`)
  }
  assert.match(pkg.scripts.dev, /vite/, 'dev should bring up vite')
  assert.match(pkg.scripts.server, /node .*server/, 'server should run the node server')
})

test('package.json declares three and ws', () => {
  const pkg = JSON.parse(read('package.json'))
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  assert.ok(deps.three, 'three is missing')
  assert.ok(deps.ws, 'ws is missing, and the server wants it')
})

test('index.html loads src/main.js inside #app', () => {
  assert.ok(exists('index.html'), 'index.html is missing')
  const html = read('index.html')
  assert.match(html, /id="app"/, '<div id="app"> is missing')
  assert.match(html, /type="module"[^>]*src="\/src\/main\.js"/, '<script type="module" src="/src/main.js"> is missing')
})

test('main.js joins all four modules', () => {
  assert.ok(exists('src/main.js'), 'src/main.js is missing')
  const source = read('src/main.js')
  for (const name of ['scene', 'player', 'media', 'net']) {
    assert.match(source, new RegExp(`\\./${name}`), `main.js does not load the "${name}" module`)
  }
  assert.match(source, /window\.__cinema/, 'main.js should expose window.__cinema for the tests')
})

test('the manual QA script is there', () => {
  assert.ok(exists('tests/QA-MANUAL.md'), `${at('tests/QA-MANUAL.md')} is missing`)
})

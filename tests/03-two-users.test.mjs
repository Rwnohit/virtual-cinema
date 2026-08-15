/**
 * Smoke test: two users can be connected to the room at the same time.
 *
 * Boots the real server on a spare port, opens two WebSocket clients and checks
 * that both stay connected and that the server survives them. The wire protocol
 * belongs to the net module, so relayed frames are reported but not asserted.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SERVER_ENTRIES,
  closeSocket,
  firstExisting,
  openSocket,
  sleep,
  startProcess,
  waitForPort,
} from './helpers.mjs'

const TEST_PORT = 8799
const DEFAULT_PORT = 8787

test('two users connect to the server at the same time', { timeout: 60000 }, async (t) => {
  const entry = firstExisting(SERVER_ENTRIES)
  if (!entry) {
    t.skip(`the server is not there yet (${SERVER_ENTRIES.join(' or ')})`)
    return
  }

  const server = startProcess(process.execPath, [entry], {
    PORT: String(TEST_PORT),
    WS_PORT: String(TEST_PORT),
    SERVER_PORT: String(TEST_PORT),
    NODE_ENV: 'test',
  })

  let alice = null
  let bob = null

  try {
    const port = await waitForPort([TEST_PORT, DEFAULT_PORT], 20000)
    assert.ok(port, `the server opened no port within 20s.\n${server.output()}`)
    // Without this, a server already running on 8787 would pass for ours.
    assert.ok(server.alive(), `the server exited during startup.\n${server.output()}`)

    alice = await openSocket(port)
    assert.ok(alice, `the first user did not connect.\n${server.output()}`)

    const path = new URL(alice.url).pathname
    bob = await openSocket(port, [path === '/' ? '' : path])
    assert.ok(bob, `the second user did not connect.\n${server.output()}`)

    // Both sockets stay open while a join message goes through.
    const hello = JSON.stringify({ type: 'join', room: 'qa', name: 'QA' })
    alice.send(hello)
    bob.send(hello)
    await sleep(1500)

    assert.equal(alice.readyState, WebSocket.OPEN, 'the first user was disconnected')
    assert.equal(bob.readyState, WebSocket.OPEN, 'the second user was disconnected')
    assert.ok(server.alive(), `the server exited with two users on it.\n${server.output()}`)

    const relayed = alice.messages.length + bob.messages.length
    t.diagnostic(`messages from the server: ${relayed}`)
    if (!relayed) {
      t.diagnostic('no messages: see tests/QA-MANUAL.md for the manual presence and voice pass')
    }
  } finally {
    closeSocket(alice)
    closeSocket(bob)
    server.stop()
    await sleep(300)
  }
})

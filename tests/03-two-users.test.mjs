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

test('δύο χρήστες συνδέονται ταυτόχρονα στον server', { timeout: 60000 }, async (t) => {
  const entry = firstExisting(SERVER_ENTRIES)
  if (!entry) {
    t.skip(`δεν υπάρχει ακόμη ο server (${SERVER_ENTRIES.join(' ή ')})`)
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
    assert.ok(port, `ο server δεν άνοιξε πόρτα σε 20s.\n${server.output()}`)
    // Χωρίς αυτό, ένας ήδη ανοιχτός server στην 8787 θα περνούσε για δικός μας.
    assert.ok(server.alive(), `ο server τερμάτισε στο ξεκίνημα.\n${server.output()}`)

    alice = await openSocket(port)
    assert.ok(alice, `ο 1ος χρήστης δεν συνδέθηκε.\n${server.output()}`)

    const path = new URL(alice.url).pathname
    bob = await openSocket(port, [path === '/' ? '' : path])
    assert.ok(bob, `ο 2ος χρήστης δεν συνδέθηκε.\n${server.output()}`)

    // Both sockets stay open while a join message goes through.
    const hello = JSON.stringify({ type: 'join', room: 'qa', name: 'QA' })
    alice.send(hello)
    bob.send(hello)
    await sleep(1500)

    assert.equal(alice.readyState, WebSocket.OPEN, 'ο 1ος χρήστης αποσυνδέθηκε')
    assert.equal(bob.readyState, WebSocket.OPEN, 'ο 2ος χρήστης αποσυνδέθηκε')
    assert.ok(server.alive(), `ο server τερμάτισε με δύο χρήστες.\n${server.output()}`)

    const relayed = alice.messages.length + bob.messages.length
    t.diagnostic(`μηνύματα από τον server: ${relayed}`)
    if (!relayed) {
      t.diagnostic('κανένα μήνυμα: δες το tests/QA-MANUAL.md για τον χειροκίνητο έλεγχο presence/φωνής')
    }
  } finally {
    closeSocket(alice)
    closeSocket(bob)
    server.stop()
    await sleep(300)
  }
})

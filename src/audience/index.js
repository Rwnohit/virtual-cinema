/**
 * The audience: name bubbles sitting in the seats.
 *
 * This room is going to be shown to people, so an empty auditorium sells it
 * short. Each viewer is a small chat style bubble floating at head height in a
 * seat: a coloured avatar with initials, and a name beside it. Sprites, so they
 * always face you from wherever you walk, and one canvas each rather than a
 * shared atlas because there are only ever a few dozen.
 *
 *   const audience = createAudience({ scene, seats, player, sound })
 *   audience.setCount(24)
 *
 * The same dial also fills the sound: a hall with thirty people in it is not
 * silent, and the mixer already knows what to do with an occupancy figure.
 */

import * as THREE from 'three'

/** Names get picked from here, so a full house does not read as a list. */
const NAMES = [
  'Κώστας', 'Μαρία', 'Νίκος', 'Ελένη', 'Γιώργος', 'Δήμητρα', 'Αντώνης', 'Σοφία',
  'Θανάσης', 'Ραφαέλα', 'Παύλος', 'Χριστίνα', 'Στέλιος', 'Αναστασία', 'Μιχάλης',
  'Ιωάννα', 'Βασίλης', 'Κατερίνα', 'Λευτέρης', 'Ζωή', 'Πέτρος', 'Ναταλία',
  'Alex', 'Mika', 'Jonas', 'Nadia', 'Theo', 'Luca', 'Iris', 'Milo', 'Sasha',
  'Remy', 'Nora', 'Kai', 'Juno', 'Vera', 'Otis', 'Pixel', 'Echo', 'Nova',
]

/** Avatar colours. Saturated enough to read in a dark room, never neon. */
const COLORS = [
  '#e0564f', '#e08a3c', '#d8b13a', '#77b255', '#3fae8f',
  '#3f97d8', '#5f6fd6', '#8f5fd0', '#c65fa8', '#b06a4a',
]

const BUBBLE_W = 256
const BUBBLE_H = 88

/** Deterministic shuffle from a seed, so the same count gives the same house. */
function seeded(seed) {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}

function initials(name) {
  const clean = name.trim()
  return clean.slice(0, 1).toUpperCase()
}

/** One bubble, drawn once into a canvas and kept as a texture. */
function drawBubble(name, color) {
  const canvas = document.createElement('canvas')
  canvas.width = BUBBLE_W
  canvas.height = BUBBLE_H
  const ctx = canvas.getContext('2d')
  const radius = BUBBLE_H / 2

  ctx.font = '600 30px system-ui, -apple-system, "Segoe UI", sans-serif'
  const textWidth = ctx.measureText(name).width
  const width = Math.min(BUBBLE_W, 78 + textWidth + 26)

  // The pill.
  ctx.fillStyle = 'rgba(16,17,21,.86)'
  ctx.beginPath()
  ctx.roundRect(0, 0, width, BUBBLE_H, radius)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,.16)'
  ctx.lineWidth = 2
  ctx.stroke()

  // The avatar.
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(radius, radius, radius - 10, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#0d0e12'
  ctx.font = '700 34px system-ui, -apple-system, "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(initials(name), radius, radius + 1)

  // The name.
  ctx.fillStyle = '#f2f2f4'
  ctx.font = '600 30px system-ui, -apple-system, "Segoe UI", sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(name, radius * 2 - 4, radius + 1)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  return { texture, aspect: width / BUBBLE_H }
}

/** What the panel builds its slider from. */
export const AUDIENCE_FIELDS = [
  { key: 'audience', label: 'Θεατές στις θέσεις', min: 0, max: 1, step: 0.02, format: 'people' },
]

/**
 * @param {object} [context] the handle main.js has built so far
 * @param {import('three').Scene} [context.scene]
 * @param {Array} [context.seatData] the plain seat records
 * @param {object} [context.player] so the taken seats cannot be sat on
 * @param {object} [context.sound] so a full house also sounds like one
 */
export function createAudience(context = {}) {
  const scene = context.scene
  const seats = context.seatData ?? context.SEATS ?? context.seats?.seats ?? []
  if (!scene || !seats.length) {
    console.warn('[audience] no seats to sit in')
    return { setCount() {}, update() {}, dispose() {} }
  }

  const group = new THREE.Group()
  group.name = 'Audience'
  scene.add(group)

  /**
   * Who sits where, decided once for every seat in the hall.
   *
   * Fixed up front rather than rolled each time the dial moves: turning the
   * count down and back up has to give you the same room, not a new cast.
   */
  const random = seeded(20260814)
  const order = seats.map((seat, index) => ({ seat, sort: random(), index })).sort((a, b) => a.sort - b.sort)
  const people = order.map(({ seat }, i) => ({
    seat,
    name: NAMES[Math.floor(random() * NAMES.length)],
    color: COLORS[i % COLORS.length],
    sprite: null,
  }))

  let count = 0
  let elapsed = 0

  function spriteFor(person) {
    if (person.sprite) return person.sprite
    const { texture, aspect } = drawBubble(person.name, person.color)
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      // Unlit on purpose: a name tag is interface, not furniture, and it has to
      // stay readable in a room whose whole point is that it is dark.
      toneMapped: false,
      fog: true,
    })
    const sprite = new THREE.Sprite(material)
    // Small and high: a name tag floating over a head, not a speech bubble in
    // your face. At 0.34 the nearest ones filled a third of the screen.
    const height = 0.2
    sprite.scale.set(height * aspect, height, 1)
    const eye = person.seat.eyePosition
    sprite.position.set(eye.x, eye.y + 0.3, eye.z)
    sprite.userData.baseY = sprite.position.y
    sprite.userData.phase = Math.random() * Math.PI * 2
    sprite.renderOrder = 3
    person.sprite = sprite
    group.add(sprite)
    return sprite
  }

  /** @param {number} value how many people, or 0..1 for a share of the hall */
  function setCount(value) {
    const asShare = value > 0 && value <= 1
    const next = Math.round(asShare ? value * people.length : Math.min(Math.max(value, 0), people.length))
    if (next === count) return count
    count = next

    for (let i = 0; i < people.length; i += 1) {
      const person = people[i]
      if (i < count) {
        spriteFor(person).visible = true
      } else if (person.sprite) {
        person.sprite.visible = false
      }
    }

    // Their seats are taken, and the room is no longer empty to the ear.
    context.player?.setOccupiedSeats?.(people.slice(0, count).map((p) => p.seat.id))
    context.sound?.set?.('occupancy', people.length ? count / people.length : 0)
    return count
  }

  /** A room of people is never perfectly still. */
  function update(delta = 0) {
    if (!count) return
    elapsed += delta
    for (let i = 0; i < count; i += 1) {
      const sprite = people[i].sprite
      if (!sprite?.visible) continue
      sprite.position.y = sprite.userData.baseY + Math.sin(elapsed * 0.8 + sprite.userData.phase) * 0.012
    }
  }

  function dispose() {
    for (const person of people) {
      if (!person.sprite) continue
      person.sprite.material.map?.dispose()
      person.sprite.material.dispose()
    }
    group.clear()
    scene.remove(group)
  }

  return {
    group,
    fields: AUDIENCE_FIELDS,
    AUDIENCE_FIELDS,
    get count() {
      return count
    },
    get max() {
      return people.length
    },
    get share() {
      return people.length ? count / people.length : 0
    },
    setCount,
    /** The generic pair the panel drives every slider with. */
    get: () => (people.length ? count / people.length : 0),
    set: (_key, value) => setCount(value),
    update,
    dispose,
  }
}

export default createAudience

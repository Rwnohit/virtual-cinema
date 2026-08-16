/**
 * Make the programme's posters weigh something a browser can carry.
 *
 *   node scripts/build-posters.mjs        # after build-library.mjs
 *
 * The catalogue links each film's poster on the publisher's own CDN, which is
 * the right thing for the film itself - nobody re-hosts anybody's work - but
 * those covers are production art: measured, 88 posters came to 167 MB, one of
 * them 10.3 MB on its own, several 3840x2160 PNGs. Opening the library asked a
 * browser to fetch and decode all of that at once while it was already running
 * a 3D room, and it did exactly what you would expect.
 *
 * Their CDN takes no resizing parameters - ?width=, ?w=, ?format= all come
 * back byte-for-byte identical - so there is nothing to ask for and the
 * smaller copy has to be made here. One 900px WebP per film: wide enough for
 * the hero on a large screen, and the same measured poster comes out at 48 KB
 * instead of 8.6 MB.
 *
 * The original url is kept as `posterSource` in the catalogue, so nothing is
 * lost and the copy can always be traced back to where it came from.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CATALOGUE = path.join(HERE, '..', 'public', 'library.json')
const OUT_DIR = path.join(HERE, '..', 'public', 'posters')

/**
 * Wide enough for the hero, small enough to be free.
 *
 * The hero fills about 980px on a large screen and a tile in the grid about
 * 230px, so one file serves both: the browser downsamples for the grid, which
 * costs nothing next to decoding the original.
 */
const WIDTH = 900
/** Above this the file grows and the picture does not. */
const QUALITY = 78

/** The CDN answers 403 to anything that does not look like a browser. */
const HEADERS = { 'user-agent': 'Mozilla/5.0 (virtual-cinema poster builder)' }

async function shrink(film) {
  // Already ours from a previous run, and the source is still on record.
  const remote = film.posterSource || film.poster
  if (!remote || !/^https?:/.test(remote)) return null

  const response = await fetch(remote, { headers: HEADERS })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const original = Buffer.from(await response.arrayBuffer())

  const small = await sharp(original)
    .rotate() // honour the orientation flag before it is thrown away
    .resize({ width: WIDTH, withoutEnlargement: true })
    .webp({ quality: QUALITY, effort: 6 })
    .toBuffer()

  const name = `${film.id}.webp`
  fs.writeFileSync(path.join(OUT_DIR, name), small)
  return { name, before: original.length, after: small.length, remote }
}

async function main() {
  const catalogue = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'))
  fs.mkdirSync(OUT_DIR, { recursive: true })

  let before = 0
  let after = 0
  let kept = 0

  // A few at a time: enough to keep the line busy, not enough to be rude to
  // somebody else's CDN.
  const queue = [...catalogue.films]
  const worker = async () => {
    while (queue.length) {
      const film = queue.shift()
      try {
        const done = await shrink(film)
        if (!done) continue
        film.posterSource = done.remote
        film.poster = `/posters/${done.name}`
        before += done.before
        after += done.after
      } catch (err) {
        // A poster that cannot be fetched keeps pointing at the publisher's
        // copy: a heavy tile is still better than an empty one.
        kept += 1
        console.warn(`[posters] ${film.title}: ${err.message} - left on their CDN`)
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))

  fs.writeFileSync(CATALOGUE, `${JSON.stringify(catalogue, null, 2)}\n`)
  const mb = (n) => `${(n / 1e6).toFixed(1)} MB`
  console.log(
    `[posters] ${catalogue.films.length - kept} posters: ${mb(before)} -> ${mb(after)}` +
      ` (${(before / Math.max(after, 1)).toFixed(0)}x smaller)${kept ? `, ${kept} left remote` : ''}`,
  )
}

main().catch((err) => {
  console.error('[posters]', err.message)
  process.exit(1)
})

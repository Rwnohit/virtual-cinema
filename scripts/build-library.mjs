/**
 * Build the cinema's programme from a catalogue feed.
 *
 *   node scripts/build-library.mjs
 *
 * Writes `public/library.json`, which is the ONE file the room reads. That is
 * the whole shape of this: a venue with its own catalogue points this script
 * at their feed (or replaces the file by hand) and the cinema fills with their
 * programme. Nothing else in the app knows where a film comes from.
 *
 * The feed here is the Higgsfield film festival's own public listing. Nothing
 * is copied or re-hosted: the entry keeps their stream url, their poster and
 * their author, and every viewer's browser fetches the film from them.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, '..', 'public', 'library.json')

const FEED = process.env.LIBRARY_FEED || 'https://fnf-api-gw.higgsfield.ai/fnf/project-publications'
/** Enough for a programme; the feed is paginated and would go on for a while. */
const WANTED = Number(process.env.LIBRARY_MAX || 36)

/** One published project -> one film, or null when there is nothing to play. */
function toFilm(item) {
  const media = (item?.gallery_media || []).find((m) => m?.type === 'video' && m?.url)
  if (!media) return null
  return {
    id: item.publication_id || item.project_id,
    title: (item.name || '').trim() || 'Untitled',
    description: (item.description || '').trim().slice(0, 400) || null,
    // The poster is the film's own cover where there is one, and a frame of it
    // otherwise, so no tile in the grid is ever empty.
    poster: item.cover?.url || media.thumbnail_url || null,
    src: media.url,
    seconds: Number(media.duration) || null,
    by: item.authors?.[0]?.username || null,
    views: Number(item.views) || 0,
    likes: Number(item.likes) || 0,
    page: item.slug ? `https://higgsfield.ai/@${item.authors?.[0]?.username}/projects/${item.slug}` : null,
  }
}

async function main() {
  const films = []
  const seen = new Set()
  let cursor = null

  while (films.length < WANTED) {
    const url = cursor ? `${FEED}?cursor=${encodeURIComponent(cursor)}` : FEED
    const response = await fetch(url, { headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`${FEED} -> HTTP ${response.status}`)
    const page = await response.json()
    const items = page.items || []
    if (!items.length) break

    for (const item of items) {
      const film = toFilm(item)
      if (!film || seen.has(film.src)) continue
      seen.add(film.src)
      films.push(film)
    }
    cursor = page.next_cursor
    if (!cursor) break
  }

  // Most watched first: a programme should open with what people came for.
  films.sort((a, b) => b.views - a.views)

  const catalogue = {
    title: 'Higgsfield Originals',
    source: FEED,
    built: new Date().toISOString(),
    note: 'Point this at your own feed (LIBRARY_FEED) or replace the file, and the cinema fills with your programme.',
    films: films.slice(0, WANTED),
  }
  fs.writeFileSync(OUT, `${JSON.stringify(catalogue, null, 2)}\n`)
  console.log(`[library] ${catalogue.films.length} films -> ${path.relative(process.cwd(), OUT)}`)
  for (const film of catalogue.films.slice(0, 5)) {
    console.log(`  ${film.title} · ${film.by ?? 'unknown'} · ${Math.round((film.seconds ?? 0) / 60)} min`)
  }
}

main().catch((err) => {
  console.error('[library]', err.message)
  process.exit(1)
})

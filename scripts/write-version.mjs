/**
 * Stamps the build.
 *
 * Writes `public/version.json` and copies the changelog next to it, so a hosted
 * copy of the app can ask "is there anything newer than me?" without a server,
 * and can show what changed without bundling the text into the JavaScript.
 *
 * Runs automatically before `npm run dev` and `npm run build`.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const at = (...parts) => path.join(root, ...parts)

const pkg = JSON.parse(fs.readFileSync(at('package.json'), 'utf8'))
const changelogPath = at('CHANGELOG.md')
const changelog = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : ''

/** The bullet points of the newest entry, for the "what's new" message. */
function latestNotes(text) {
  const section = text.split(/^## /m)[1]
  if (!section) return []
  return section
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).replace(/\*\*/g, '').trim())
    .slice(0, 4)
}

const stamp = {
  version: pkg.version,
  built: new Date().toISOString(),
  notes: latestNotes(changelog),
}

fs.mkdirSync(at('public'), { recursive: true })
fs.writeFileSync(at('public/version.json'), `${JSON.stringify(stamp, null, 2)}\n`)
if (changelog) fs.writeFileSync(at('public/CHANGELOG.md'), changelog)

console.log(`[version] ${stamp.version} · ${stamp.built}`)

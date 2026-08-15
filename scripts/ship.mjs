/**
 * One press: publish the source, put the room up, then check it actually landed.
 *
 *   npm run ship "what changed"
 *
 * The order matters. The source goes out first, so that whatever is running on
 * the address is always something a visitor can also read. Then the deploy.
 * Then we sit and watch the live build stamp until it moves, because a deploy
 * that was accepted is not the same thing as a deploy that is serving.
 *
 * Where it deploys is deliberately NOT in this file. It reads `deploy.env`,
 * which stays on the machine that owns the address:
 *
 *   RAILWAY_SERVICE=<service name>
 *   LIVE_URL=https://<your address>
 *
 * Without that file it still commits and pushes, and simply says it has no
 * address to deploy to.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(join(ROOT, file), 'utf8')

/** `KEY=value` lines, blanks and `#` ignored. Missing file is not an error. */
const localSettings = () => {
  const out = {}
  if (!existsSync(join(ROOT, 'deploy.env'))) return out
  for (const line of read('deploy.env').split('\n')) {
    const at = line.indexOf('=')
    if (at < 1 || line.trim().startsWith('#')) continue
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return out
}

const run = (command, args, { quiet = false } = {}) => {
  const r = spawnSync(command, args, {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
    stdio: quiet ? 'pipe' : 'inherit',
  })
  return { code: r.status ?? 1, out: (r.stdout ?? '').trim() }
}

const say = (line) => process.stdout.write(`${line}\n`)

const stamp = async (url) => {
  try {
    const r = await fetch(`${url}/version.json`, { cache: 'no-store' })
    if (!r.ok) return null
    const body = await r.json()
    return `${body.version} @ ${body.built}`
  } catch {
    return null
  }
}

const settings = { ...localSettings(), ...process.env }
const LIVE_URL = (settings.LIVE_URL ?? '').replace(/\/$/, '')
const SERVICE = settings.RAILWAY_SERVICE ?? ''
const version = JSON.parse(read('package.json')).version
const message = process.argv.slice(2).join(' ').trim() || `Ship v${version}`

say(`\n  Virtual Cinema v${version}`)

// 1. The changelog is the release note, so a version nobody wrote about is
//    almost always a version somebody forgot to bump.
const changelogTop = read('CHANGELOG.md').match(/\d+\.\d+\.\d+/)?.[0]
if (changelogTop !== version) {
  say(`  ! CHANGELOG.md is on ${changelogTop}, package.json on ${version}`)
}

// 2. Source out first.
const dirty = run('git', ['status', '--porcelain'], { quiet: true }).out
if (dirty) {
  say('\n  Committing...')
  if (run('git', ['add', '-A']).code) process.exit(1)
  if (run('git', ['commit', '-m', JSON.stringify(message)]).code) process.exit(1)
} else {
  say('\n  Nothing new to commit.')
}

say('\n  Publishing the source...')
if (run('git', ['push', 'origin', 'HEAD']).code) {
  say('  Push failed. Nothing was deployed.')
  process.exit(1)
}

// 3. Then the address.
if (!LIVE_URL || !SERVICE) {
  say('\n  No deploy.env, so no address to deploy to. Source is published.')
  process.exit(0)
}

const before = await stamp(LIVE_URL)
say(`\n  Live before: ${before ?? 'unreachable'}`)
say('  Deploying...\n')
if (run('railway', ['up', '--ci', '--service', SERVICE]).code) {
  say('\n  Deploy failed. The source is published but the address is unchanged.')
  process.exit(1)
}

// 4. Accepted is not serving. Wait for the build stamp to actually move.
say('\n  Waiting for the new build to answer...')
const deadline = Date.now() + 6 * 60 * 1000
let now = before
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 6000))
  now = await stamp(LIVE_URL)
  if (now && now !== before) break
  process.stdout.write('.')
}
say('')

if (now && now !== before) {
  say(`\n  Live now: ${now}`)
  say(`  ${LIVE_URL}\n`)
} else {
  say('\n  The address is still serving the old build. Check the deploy logs.\n')
  process.exit(1)
}

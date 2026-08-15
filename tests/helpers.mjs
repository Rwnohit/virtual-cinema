/**
 * Shared helpers for the smoke tests.
 *
 * The four feature modules are built in parallel, so every helper here is
 * tolerant: it reports "not there yet" instead of throwing, and the tests
 * decide whether that means "skip" or "fail".
 */

import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Absolute path inside the project. */
export const at = (...parts) => path.join(ROOT, ...parts)

export const exists = (...parts) => fs.existsSync(at(...parts))

export const read = (...parts) => fs.readFileSync(at(...parts), 'utf8')

/** First existing path from a candidate list, or null. */
export function firstExisting(candidates) {
  return candidates.find((candidate) => exists(candidate)) ?? null
}

export const SERVER_ENTRIES = [
  'server/index.js',
  'server/index.mjs',
  'server/server.js',
  'server/main.js',
  'server/app.js',
]

export const MODULE_ENTRIES = {
  scene: ['src/scene/index.js', 'src/scene.js'],
  player: ['src/player/index.js', 'src/player.js'],
  media: ['src/media/index.js', 'src/media.js'],
  sound: ['src/sound/index.js', 'src/sound.js'],
  update: ['src/update/index.js', 'src/update.js'],
  room: ['src/room/index.js', 'src/room.js'],
  net: ['src/net/index.js', 'src/net.js'],
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** True when something is listening on the given local port. */
export function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    const done = (result) => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(700)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/** Waits until one of the ports accepts connections. Returns that port or null. */
export async function waitForPort(ports, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const port of ports) {
      if (await isPortOpen(port)) return port
    }
    await sleep(250)
  }
  return null
}

/**
 * Starts a child process and collects its output.
 * Returns { child, output(), stop() }.
 */
export function startProcess(command, args, env = {}) {
  // On Windows `npm` needs a shell, but a shell also concatenates the args
  // unquoted, which breaks paths with spaces. So: shell only for the launchers.
  const useShell = process.platform === 'win32' && !path.isAbsolute(command)
  const safeArgs = useShell ? args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)) : args

  const child = spawn(command, safeArgs, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    shell: useShell,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout?.on('data', (chunk) => {
    output += chunk
  })
  child.stderr?.on('data', (chunk) => {
    output += chunk
  })

  let exitCode = null
  child.on('exit', (code) => {
    exitCode = code
  })

  return {
    child,
    output: () => output,
    alive: () => exitCode === null && !child.killed,
    exitCode: () => exitCode,
    stop: () => {
      if (exitCode !== null) return
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' })
      } else {
        child.kill('SIGTERM')
      }
    },
  }
}

/** Opens a WebSocket, trying a few common paths. Resolves to the socket or null. */
export async function openSocket(port, paths = ['', '/ws', '/socket', '/signal']) {
  for (const suffix of paths) {
    const socket = await tryOpen(`ws://127.0.0.1:${port}${suffix}`)
    if (socket) return socket
  }
  return null
}

function tryOpen(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let socket
    try {
      socket = new WebSocket(url)
    } catch {
      resolve(null)
      return
    }
    socket.messages = []
    const timer = setTimeout(() => {
      try {
        socket.close()
      } catch {}
      resolve(null)
    }, timeoutMs)

    socket.addEventListener('message', (event) => socket.messages.push(String(event.data)))
    socket.addEventListener('open', () => {
      clearTimeout(timer)
      resolve(socket)
    })
    socket.addEventListener('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
  })
}

export function closeSocket(socket) {
  try {
    socket?.close()
  } catch {}
}

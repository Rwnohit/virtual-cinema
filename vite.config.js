import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))

function readStamp() {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'public/version.json'), 'utf8'))
  } catch {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    return { version: pkg.version, built: new Date(0).toISOString() }
  }
}

const stamp = readStamp()

/**
 * Never reload the page behind the viewer's back.
 *
 * The default behaviour is helpful on a web page and awful inside a room you
 * are standing in: you lose the pointer, the seat and the film every time a
 * file is saved. So the reload is swallowed here and turned into a message,
 * and the app shows a "new version, update when you like" button instead.
 * See src/update/index.js.
 */
function manualUpdates() {
  return {
    name: 'vc-manual-updates',
    apply: 'serve',
    handleHotUpdate({ server, file }) {
      // The stamp file rewrites itself on every start; ignore its own noise.
      if (file.endsWith('version.json') || file.endsWith('public/CHANGELOG.md')) return []
      server.ws.send({
        type: 'custom',
        event: 'vc:update-available',
        data: { file: path.relative(root, file) },
      })
      return []
    },
  }
}

export default defineConfig({
  plugins: [manualUpdates()],
  define: {
    __APP_VERSION__: JSON.stringify(stamp.version),
    __APP_BUILT__: JSON.stringify(stamp.built),
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2020',
    sourcemap: true,
  },
})

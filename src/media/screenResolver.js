/**
 * Finds the cinema screen mesh that src/scene/cinema.js builds, without
 * importing that module: the scene is owned by another part of the app and it
 * can hand us the screen in a few different shapes.
 *
 * Accepted inputs:
 *   - a THREE.Mesh                      -> used as is
 *   - the handle from createCinema()    -> looks at .screen / .screenMesh
 *   - a THREE.Scene / THREE.Group       -> traverses looking for userData.role
 *                                          === 'screen' or a name like
 *                                          'CinemaScreen'
 */

const NAME_HINTS = [
  'cinema-screen',
  'movie-screen',
  'projection-screen',
  'projectionscreen',
  'cinemascreen',
  'moviescreen',
  'screen',
]

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
}

function isScreenMesh(object) {
  if (!object || !object.isMesh) return false

  const data = object.userData || {}
  if (data.isCinemaScreen || data.isScreen || data.screen === true) return true
  if (typeof data.role === 'string' && normalizeName(data.role).includes('screen')) return true

  const name = normalizeName(object.name)
  return NAME_HINTS.some((hint) => name.includes(hint))
}

/**
 * @param {*} source mesh, cinema handle, scene or group
 * @returns {import('three').Mesh|null}
 */
export function resolveScreenMesh(source) {
  if (!source) return null
  if (source.isMesh) return source

  // A handle object such as { screen, screenMaterial, root }.
  for (const key of ['screen', 'screenMesh', 'cinemaScreen', 'movieScreen']) {
    const candidate = source[key]
    if (candidate && candidate.isMesh) return candidate
    if (candidate && candidate.isObject3D) {
      const nested = resolveScreenMesh(candidate)
      if (nested) return nested
    }
  }

  const root = source.isObject3D
    ? source
    : source.scene || source.root || source.group || source.object3D

  if (!root || typeof root.traverse !== 'function') return null

  let found = null
  root.traverse((object) => {
    if (found) return
    if (isScreenMesh(object)) found = object
  })

  return found
}

/**
 * Local size of a plane-ish mesh plus which local axis is its normal.
 * Works for the usual PlaneGeometry screen and for a thin box screen.
 *
 * @returns {{width:number,height:number,depthAxis:'x'|'y'|'z',center:{x:number,y:number,z:number}}}
 */
export function measureScreen(mesh) {
  const geometry = mesh.geometry
  if (geometry && !geometry.boundingBox) geometry.computeBoundingBox()

  const box = geometry && geometry.boundingBox
  const size = box
    ? {
        x: Math.abs(box.max.x - box.min.x),
        y: Math.abs(box.max.y - box.min.y),
        z: Math.abs(box.max.z - box.min.z),
      }
    : { x: 1, y: 1, z: 0 }

  const center = box
    ? {
        x: (box.max.x + box.min.x) / 2,
        y: (box.max.y + box.min.y) / 2,
        z: (box.max.z + box.min.z) / 2,
      }
    : { x: 0, y: 0, z: 0 }

  // Thinnest axis is the screen normal.
  let depthAxis = 'z'
  if (size.x <= size.y && size.x <= size.z) depthAxis = 'x'
  else if (size.y <= size.x && size.y <= size.z) depthAxis = 'y'

  // [horizontal, vertical] axes of the screen face.
  const face = { x: ['z', 'y'], y: ['x', 'z'], z: ['x', 'y'] }[depthAxis]
  const width = size[face[0]] || 1
  const height = size[face[1]] || 1

  return { width, height, depthAxis, center }
}

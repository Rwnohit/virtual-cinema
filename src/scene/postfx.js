/**
 * Bloom: the light the screen spills into the dark hall.
 *
 *   const postfx = createPostFx({ renderer, scene, camera, container })
 *   postfx.render(camera)   // once per frame, instead of renderer.render()
 *
 * An EffectComposer with a RenderPass and an UnrealBloomPass, plus two things
 * this room needs that the stock recipe does not give you.
 *
 * 1. The picture must not change.
 *    A composer normally renders the scene into a linear buffer and tone maps
 *    the whole thing on the way out. That would be wrong here: the movie
 *    surface is deliberately `toneMapped: false` (a film is shown as it was
 *    graded, not rolled through ACES a second time) while the hall around it
 *    wants ACES. Tone mapping at the end applies one rule to both.
 *    So the composer's buffer is marked as an XR render target. That is the one
 *    code path in three.js where a render target behaves exactly like the
 *    canvas: per material tone mapping and the sRGB write are done inside the
 *    scene pass, per material, the way they already are today. The buffer then
 *    holds the finished picture, the bloom is added on top of it, and the last
 *    pass is a straight copy. What the viewer sees under the glow is byte for
 *    byte what they saw before there was a composer.
 *    (three r180: WebGLPrograms.js reads `renderTarget.isXRRenderTarget` for
 *    both the tone mapping and the output colour space, and WebGLTextures.js
 *    uses it to keep the storage plain RGBA8 so the sRGB encode is not applied
 *    twice. If a future three drops the flag the picture goes visibly dark,
 *    which is loud rather than silent.)
 *
 * 2. The YouTube hole must survive.
 *    src/media/embedScreen.js puts a real iframe behind the canvas and punches
 *    a transparent hole through to it. The render target keeps an alpha channel
 *    and the final copy writes alpha straight through, but the bloom itself
 *    blurs light across that hole and would smear glow over the video. So while
 *    an embed is on the screen the composer is skipped entirely and the frame
 *    goes out the plain way. The scene module cannot see the media module, so
 *    the answer arrives as a predicate:
 *
 *      createPostFx({ ..., bypass: () => media.embed?.active })
 *      scene.setPostFxBypass(() => media.embed?.active)   // or later
 */

import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { CopyShader } from 'three/addons/shaders/CopyShader.js'

const clamp = (value, min, max) => (value < min ? min : value > max ? max : value)

const percent = (value) => `${Math.round(value * 100)}%`

/**
 * The dials, in the order a panel should draw them. Same generic shape as the
 * picture fields, so one slider builder can handle both.
 * @type {Array<{key:string,label:string,type:'toggle'|'range',min:number,max:number,step:number,default:(number|boolean),format?:(v:number)=>string}>}
 */
export const BLOOM_FIELDS = [
  {
    key: 'enabled',
    label: 'Λάμψη οθόνης',
    type: 'toggle',
    min: 0,
    max: 1,
    step: 1,
    default: true,
  },
  {
    key: 'strength',
    label: 'Ένταση',
    type: 'range',
    min: 0,
    max: 1.5,
    step: 0.01,
    default: 0.4,
    format: percent,
  },
  {
    key: 'radius',
    label: 'Άπλωμα',
    type: 'range',
    min: 0,
    max: 1.5,
    step: 0.01,
    default: 0.55,
    format: percent,
  },
  {
    key: 'threshold',
    label: 'Όριο φωτεινότητας',
    type: 'range',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.72,
    format: percent,
  },
]

/** Gentle on purpose: one bright screen in a black room, so this reads as spill. */
export const BLOOM_DEFAULTS = Object.freeze(
  Object.fromEntries(BLOOM_FIELDS.map((field) => [field.key, field.default])),
)

function sizeOf(container) {
  const width = container?.clientWidth || window.innerWidth
  const height = container?.clientHeight || window.innerHeight
  return { width, height }
}

function readValues(target, values = {}) {
  for (const field of BLOOM_FIELDS) {
    if (!(field.key in values)) continue
    if (field.type === 'toggle') {
      target[field.key] = !!values[field.key]
      continue
    }
    const number = Number(values[field.key])
    if (Number.isFinite(number)) target[field.key] = clamp(number, field.min, field.max)
  }
  return target
}

/**
 * True when the page is being drawn by the processor rather than a graphics
 * card: SwiftShader in headless Chrome, llvmpipe on a machine with no driver.
 *
 * Worth asking, because the one expensive decision in here is whether the full
 * screen buffer is multisampled, and in software that single choice is the
 * difference between a slow room and a crashed GPU process.
 */
function isSoftwareRenderer(renderer) {
  try {
    const gl = renderer?.getContext?.()
    const info = gl?.getExtension?.('WEBGL_debug_renderer_info')
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ''
    return /swiftshader|llvmpipe|software|basic render/i.test(name)
  } catch {
    return false
  }
}

/**
 * @param {object} options
 * @param {import('three').WebGLRenderer} options.renderer
 * @param {import('three').Scene} options.scene
 * @param {import('three').Camera} options.camera the one used when render() is called bare
 * @param {HTMLElement} [options.container] the element holding the canvas, for sizing
 * @param {() => boolean} [options.bypass] true = skip the composer this frame
 * @param {object} [options.bloom] starting values, see BLOOM_FIELDS
 */
export function createPostFx(options = {}) {
  const {
    renderer,
    scene,
    camera,
    container = renderer?.domElement?.parentNode ?? document.body,
  } = options

  const values = readValues({ ...BLOOM_DEFAULTS }, options.bloom)
  let bypass = typeof options.bypass === 'function' ? options.bypass : () => false

  /** A predicate from another module must never be able to kill the frame loop. */
  function bypassed() {
    try {
      return !!bypass()
    } catch {
      return false
    }
  }

  function setBypass(predicate) {
    bypass = typeof predicate === 'function' ? predicate : () => false
  }

  function getBloom() {
    return { ...values }
  }

  // Without a renderer there is nothing to post process, and the hall must
  // still boot: hand back a handle that just draws the plain way.
  if (!renderer || !scene || !camera) {
    return {
      composer: null,
      bloomPass: null,
      fields: BLOOM_FIELDS,
      get enabled() {
        return false
      },
      render(activeCamera) {
        if (renderer && scene) renderer.render(scene, activeCamera || camera)
      },
      resize() {},
      setBloom(next) {
        readValues(values, next)
        return getBloom()
      },
      getBloom,
      setBypass,
      dispose() {},
    }
  }

  const size = sizeOf(container)

  // Built at logical size: EffectComposer reads width/height off the target it
  // is handed and multiplies by the pixel ratio itself. resize() below settles
  // the real numbers before the first frame.
  const target = new THREE.WebGLRenderTarget(size.width, size.height, {
    // An alpha channel is not decoration here, it is the YouTube hole.
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    // Together with isXRRenderTarget below: the scene pass tone maps per
    // material and writes sRGB, exactly like it does straight to the canvas.
    colorSpace: THREE.SRGBColorSpace,
    // And the storage stays plain, so the driver does not encode sRGB a second
    // time on top of the shader. Without this, three would pick SRGB8_ALPHA8
    // for an sRGB byte texture and the whole hall would wash out.
    internalFormat: 'RGBA8',
    // The renderer asked for antialias:true, and a render target does not get
    // that for free. 150 seats and a hard edged screen say it is worth it.
    // Except on a software renderer, where a multisampled full screen buffer is
    // the most expensive thing in the page: SwiftShader crashes its own GPU
    // process building this with the hall in it. Anyone drawing in software has
    // bigger problems than jaggy edges.
    samples: isSoftwareRenderer(renderer) ? 0 : Math.min(4, renderer.capabilities?.maxSamples ?? 0),
    depthBuffer: true,
    stencilBuffer: false,
  })
  target.texture.name = 'PostFx.scene'
  target.isXRRenderTarget = true

  const composer = new EffectComposer(renderer, target)
  // The composer clones the target for its second buffer and the clone does not
  // carry our flag, so mark both. Only one of them is ever bound (see below).
  composer.renderTarget1.isXRRenderTarget = true
  composer.renderTarget2.isXRRenderTarget = true

  const renderPass = new RenderPass(scene, camera)

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(size.width, size.height),
    values.strength,
    values.radius,
    values.threshold,
  )

  // The picture is already finished when it reaches here, so the last step is a
  // straight copy: no tone mapping, no colour conversion, and alpha untouched.
  const finalPass = new ShaderPass(CopyShader)
  finalPass.material.depthTest = false
  finalPass.material.depthWrite = false
  // Nothing after this pass needs the read and write buffers swapped, and not
  // swapping means the composer keeps using the same one of its two targets
  // forever. The other is never bound, so the driver never allocates it: half
  // the video memory of the effect, for free.
  finalPass.needsSwap = false

  composer.addPass(renderPass)
  composer.addPass(bloomPass)
  composer.addPass(finalPass)

  function resize() {
    const next = sizeOf(container)
    composer.setPixelRatio(renderer.getPixelRatio())
    composer.setSize(next.width, next.height)
  }

  /** @param {Record<string, number|boolean>} [next] any subset of BLOOM_FIELDS */
  function setBloom(next) {
    readValues(values, next)
    bloomPass.strength = values.strength
    bloomPass.radius = values.radius
    bloomPass.threshold = values.threshold
    return getBloom()
  }

  /** Zero strength costs the same as full strength, so treat it as off. */
  function isActive() {
    return values.enabled && values.strength > 0 && !bypassed()
  }

  /**
   * Draw one frame.
   * @param {import('three').Camera} [activeCamera] whoever is looking right now
   */
  function render(activeCamera) {
    const cam = activeCamera || camera
    if (!isActive()) {
      renderer.render(scene, cam)
      return
    }
    // The player can hand over a different camera (the view of the hall), and
    // the pass keeps its own reference to one.
    if (renderPass.camera !== cam) renderPass.camera = cam
    composer.render()
  }

  function dispose() {
    composer.dispose()
    bloomPass.dispose()
    finalPass.dispose()
    renderPass.dispose()
  }

  resize()

  return {
    composer,
    bloomPass,
    /** The dials, so a panel can build itself generically. */
    fields: BLOOM_FIELDS,
    get enabled() {
      return values.enabled
    },
    set enabled(on) {
      setBloom({ enabled: on })
    },
    render,
    resize,
    setBloom,
    getBloom,
    /** Tell the glow when to stand aside, e.g. () => media.embed?.active. */
    setBypass,
    dispose,
  }
}

export default createPostFx

/**
 * The grade on the film: what the picture controls actually do.
 *
 * Kept out of videoScreen.js because this is maths and copy rather than
 * plumbing. The shader snippet, the dials a panel can draw and the named looks
 * all live here, so the screen only has to hand its material over once.
 *
 *   const picture = createPictureGrade()
 *   picture.install(material)
 *   picture.set({ brightness: 1.2 })
 *
 * The grade runs inside the shader of the movie surface, right after the video
 * texture is sampled and decoded to linear light. It is done display referred
 * (roughly gamma 2.2, the space the eye reads) and not in linear light, because
 * that is what makes the dials behave like the picture menu of a television:
 * contrast pivots around mid grey, brightness lifts the whites and leaves black
 * where it is.
 *
 * At the defaults the whole block is skipped with a uniform flag, so a viewer
 * who never touches a slider gets exactly the pixels the room was built around.
 * That is deliberate: the current look is the good one, these dials only exist
 * so it can be pushed.
 *
 * A film from YouTube or Vimeo never reaches that shader: it plays inside an
 * iframe, so the picture is a DOM element rather than pixels we own. The same
 * numbers are translated into a CSS filter by `cssFilterFor()` further down,
 * kept in this file so the two paths cannot drift apart.
 */

import { clamp } from './util.js'

const percent = (value) => `${Math.round(value * 100)}%`

/**
 * Every dial, in the order a panel should draw it. Generic on purpose: a UI can
 * build itself from this without knowing what any of the keys mean.
 * @type {Array<{key:string,label:string,min:number,max:number,step:number,default:number,format:(v:number)=>string}>}
 */
import { t } from '../i18n/index.js'

export const PICTURE_FIELDS = [
  {
    key: 'brightness',
    label: 'Φωτεινότητα',
    min: 0.5,
    max: 1.6,
    step: 0.01,
    default: 1,
    format: percent,
  },
  {
    key: 'contrast',
    label: 'Αντίθεση',
    min: 0.5,
    max: 1.6,
    step: 0.01,
    default: 1,
    format: percent,
  },
  {
    key: 'saturation',
    label: 'Ζωντάνια χρωμάτων',
    min: 0,
    max: 2,
    step: 0.01,
    default: 1,
    format: (value) => (value < 0.02 ? 'Ασπρόμαυρο' : percent(value)),
  },
  {
    key: 'warmth',
    label: 'Ζεστό ή ψυχρό',
    min: -1,
    max: 1,
    step: 0.01,
    default: 0,
    format: (value) =>
      value > 0.05
        ? `${t('value.warm')} ${percent(value)}`
        : value < -0.05
          ? `${t('value.cool')} ${percent(-value)}`
          : t('value.neutral'),
  },
  {
    key: 'gamma',
    label: 'Μεσαίοι τόνοι',
    min: 0.6,
    max: 1.6,
    step: 0.01,
    default: 1,
    format: (value) =>
      value > 1.02
        ? `${t('value.lighter')} ${percent(value)}`
        : value < 0.98
          ? `${t('value.darker')} ${percent(value)}`
          : t('value.neutral'),
  },
]

/** The look of the room today. Anything equal to this is a no-op in the shader. */
export const PICTURE_DEFAULTS = Object.freeze(
  Object.fromEntries(PICTURE_FIELDS.map((field) => [field.key, field.default])),
)

/**
 * Named looks. Every preset carries a full set of values, so picking one is a
 * reset and not an addition to whatever was set before.
 * @type {Array<{key:string,label:string,values:Record<string,number>}>}
 */
export const PICTURE_PRESETS = [
  {
    key: 'normal',
    label: 'Κανονικό',
    values: { ...PICTURE_DEFAULTS },
  },
  {
    key: 'brighter',
    label: 'Πιο φωτεινό',
    values: { brightness: 1.14, contrast: 1.04, saturation: 1.05, warmth: 0, gamma: 1.12 },
  },
  {
    key: 'warm',
    label: t('value.warm'),
    values: { brightness: 1.03, contrast: 1.02, saturation: 1.08, warmth: 0.45, gamma: 1.04 },
  },
  {
    key: 'cool',
    label: t('value.cool'),
    values: { brightness: 1, contrast: 1.08, saturation: 0.94, warmth: -0.4, gamma: 0.98 },
  },
]

/** Keep whatever a caller hands over inside the range of its own dial. */
export function clampPicture(values = {}) {
  const out = {}
  for (const field of PICTURE_FIELDS) {
    if (!(field.key in values)) continue
    const number = Number(values[field.key])
    if (!Number.isFinite(number)) continue
    out[field.key] = clamp(number, field.min, field.max)
  }
  return out
}

/** True when nothing is pushed, which is what lets the shader skip the grade. */
export function isNeutralPicture(values) {
  return PICTURE_FIELDS.every((field) => Math.abs(values[field.key] - field.default) < 1e-4)
}

/* -------------------------------------------------------------------------- */
/* the same grade, for a picture we are not allowed to touch                   */
/* -------------------------------------------------------------------------- */

/**
 * How much sepia one whole unit of warmth is worth.
 *
 * Chosen by matching the red to blue ratio the shader puts on a grey pixel:
 * the tint multiplier (1.14, 1.02, 0.86) gives 1.33, and sepia(0.45) followed
 * by the make up saturation below lands on 1.35.
 */
const CSS_TINT = 0.45
/** Sepia eats most of the chroma on its way in. This puts it back. */
const CSS_TINT_MAKEUP = 0.65
/** Sepia tints towards ~38 degrees, the shader sits on ~34 (tungsten). */
const CSS_TINT_HUE = -4
/** How much of the midtone lift is paid for with brightness, and with contrast. */
const CSS_GAMMA_AS_BRIGHTNESS = 0.65
const CSS_GAMMA_AS_CONTRAST = 0.18

/** Short numbers: a filter string is rebuilt on every drag of a slider. */
const round4 = (value) => String(Number(value.toFixed(4)))

/**
 * The same grade written as a CSS `filter`, for a picture that never becomes a
 * texture: YouTube and Vimeo hand over their video inside an iframe, so the
 * shader above never sees it and the only knob left is the element itself.
 *
 * The mapping lives here, next to the shader it is copying, so the two cannot
 * drift apart. CSS filter functions run display referred in sRGB and in the
 * order they are written, which is the same space and the same order as
 * `vcGrade()`, so most of it is a straight translation:
 *
 *   brightness -> brightness()   identical (gain, black stays black)
 *   contrast   -> contrast()     identical (slope around mid grey)
 *   saturation -> saturate()     same Rec.709 luma weights
 *
 * Where the two differ, and why:
 *
 *   - saturation above 1: the shader holds back on pixels that are already
 *     colourful (vibrance), which no stock CSS filter can do, so `saturate()`
 *     pushes strong colour harder than the shader does.
 *   - warmth: the shader multiplies the channels, and `sepia()` is the only
 *     stock filter that tints a grey pixel while leaving a black one black,
 *     which is exactly that behaviour. Cool is the same move seen inside out
 *     (invert, warm, invert back), and there the tint lands in the shadows
 *     rather than in the highlights: at full cool that lifts absolute black by
 *     about 3%, where the shader would leave it at zero.
 *   - gamma: CSS has no gamma. A curve that lifts the midtones while pinning
 *     both black and white cannot be built out of brightness and contrast,
 *     which are both straight lines, so it is approximated at roughly two
 *     thirds strength: mostly brightness (which keeps black at black) with a
 *     little counter contrast so the highlights do not clip immediately.
 *     Folding it into the leading brightness and contrast also moves it ahead
 *     of the tint instead of after it, which is a small reordering: every step
 *     involved is linear, only the clamping points change.
 *
 * @param {Record<string, number>} [values] partial or full set, as set() takes
 * @returns {string} ready for `element.style.filter`, 'none' when neutral
 */
export function cssFilterFor(values = {}) {
  const live = { ...PICTURE_DEFAULTS, ...clampPicture(values) }
  // Same deal as the shader flag: at the defaults the browser is told to skip
  // the whole thing rather than run an identity filter over a video every frame.
  if (isNeutralPicture(live)) return 'none'

  // Where mid grey ends up under the shader's gamma. Positive lift = lighter.
  const lift = 2 * Math.pow(0.5, 1 / live.gamma) - 1
  const brightness = live.brightness * (1 + CSS_GAMMA_AS_BRIGHTNESS * lift)
  const contrast = live.contrast * (1 - CSS_GAMMA_AS_CONTRAST * lift)
  let saturation = live.saturation

  const parts = [`brightness(${round4(brightness)})`, `contrast(${round4(contrast)})`]

  const warmth = Math.abs(live.warmth)
  if (warmth * CSS_TINT > 0.002) {
    parts.push(
      live.warmth > 0
        ? `sepia(${round4(warmth * CSS_TINT)})`
        : `invert(1) sepia(${round4(warmth * CSS_TINT)}) invert(1)`,
    )
    parts.push(`hue-rotate(${round4(CSS_TINT_HUE * warmth)}deg)`)
    // Two saturate() in a row multiply exactly, so the make up rides on the
    // viewer's own setting instead of being a separate pass.
    saturation *= 1 + CSS_TINT_MAKEUP * warmth
  }

  parts.push(`saturate(${round4(saturation)})`)
  return parts.join(' ')
}

const GRADE_PARS = /* glsl */ `
uniform bool vcGradeOn;
uniform float vcBrightness;
uniform float vcContrast;
uniform float vcSaturation;
uniform float vcWarmth;
uniform float vcGamma;

// The eye reads brightness on a curve, so the grade is done on that curve too.
const float VC_DISPLAY_GAMMA = 2.2;
const vec3 VC_LUMA = vec3( 0.2126, 0.7152, 0.0722 );
// Warm is a light bulb, cool is daylight. This is a multiplier and not an
// addition, so black stays black and only the lit part of the frame takes it.
const vec3 VC_WARM_TINT = vec3( 0.14, 0.02, -0.14 );

vec3 vcToDisplay( vec3 c ) { return pow( max( c, vec3( 0.0 ) ), vec3( 1.0 / VC_DISPLAY_GAMMA ) ); }
vec3 vcToLinear( vec3 c ) { return pow( max( c, vec3( 0.0 ) ), vec3( VC_DISPLAY_GAMMA ) ); }

vec3 vcGrade( vec3 color ) {

	vec3 c = vcToDisplay( color );

	// Gain: the whites move, black stays put.
	c *= vcBrightness;

	// Contrast around mid grey.
	c = ( c - 0.5 ) * vcContrast + 0.5;

	c *= vec3( 1.0 ) + vcWarmth * VC_WARM_TINT;

	// Vibrance on the way up: a pixel that is already colourful moves less than
	// a flat one, so skin and sky keep their shape instead of going neon. On the
	// way down it is a plain desaturate, so 0 really is black and white.
	float luma = dot( max( c, vec3( 0.0 ) ), VC_LUMA );
	float chroma = clamp( max( c.r, max( c.g, c.b ) ) - min( c.r, min( c.g, c.b ) ), 0.0, 1.0 );
	float guard = vcSaturation > 1.0 ? 1.0 - chroma * 0.8 : 1.0;
	c = mix( vec3( luma ), c, 1.0 + ( vcSaturation - 1.0 ) * guard );

	// Clamp before the gamma. Two reasons: pow() of a negative is nonsense, and
	// the screen is a projection rather than a lamp, so the grade must not
	// invent light above white that the bloom would then blow up.
	c = clamp( c, 0.0, 1.0 );
	c = pow( c, vec3( 1.0 / vcGamma ) );

	return vcToLinear( c );

}
`

const GRADE_BODY = /* glsl */ `
	// diffuseColor is the video texel, decoded to linear light. At the defaults
	// the flag is off and this costs one branch and nothing else.
	if ( vcGradeOn ) diffuseColor.rgb = vcGrade( diffuseColor.rgb );
`

/**
 * A grade that can be attached to a material and driven afterwards.
 *
 * The uniform objects are created once and pushed into every compile of the
 * material, so the settings survive a recompile. That matters: swapping the
 * movie source rebuilds the video texture and marks the material for a rebuild,
 * and the viewer's grade must not quietly reset when that happens.
 *
 * @param {Record<string, number>} [initial]
 */
export function createPictureGrade(initial) {
  const values = { ...PICTURE_DEFAULTS }

  const uniforms = {
    vcGradeOn: { value: false },
    vcBrightness: { value: values.brightness },
    vcContrast: { value: values.contrast },
    vcSaturation: { value: values.saturation },
    vcWarmth: { value: values.warmth },
    vcGamma: { value: values.gamma },
  }

  function push() {
    uniforms.vcBrightness.value = values.brightness
    uniforms.vcContrast.value = values.contrast
    uniforms.vcSaturation.value = values.saturation
    uniforms.vcWarmth.value = values.warmth
    uniforms.vcGamma.value = values.gamma
    uniforms.vcGradeOn.value = !isNeutralPicture(values)
  }

  function get() {
    return { ...values }
  }

  /** @param {Record<string, number>} next partial or full set of values */
  function set(next) {
    Object.assign(values, clampPicture(next))
    push()
    return get()
  }

  /** Back to the look the room was built around. */
  function reset() {
    return set(PICTURE_DEFAULTS)
  }

  /**
   * @param {import('three').Material} material the movie surface material
   */
  function install(material) {
    material.onBeforeCompile = (shader) => {
      // Same uniform objects every time, so changing a value needs no recompile.
      Object.assign(shader.uniforms, uniforms)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GRADE_PARS}`)
        .replace('#include <map_fragment>', `#include <map_fragment>\n${GRADE_BODY}`)
    }
    // Without this the graded material could be handed a cached program built
    // for a plain MeshBasicMaterial, and the grade would silently do nothing.
    material.customProgramCacheKey = () => 'vc-picture-grade'
    material.needsUpdate = true
    return material
  }

  if (initial) set(initial)
  else push()

  return {
    uniforms,
    install,
    set,
    get,
    reset,
    /** The same look as a CSS filter, for an embedded player. */
    cssFilter: () => cssFilterFor(values),
    fields: PICTURE_FIELDS,
    presets: PICTURE_PRESETS,
  }
}

export default createPictureGrade

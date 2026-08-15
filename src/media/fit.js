/**
 * How a frame sits on the screen. Pure math, no three.js, so it can be tested
 * on its own.
 *
 *   contain : whole frame visible, black bars on the screen around it
 *   cover   : screen fully covered, frame cropped on the long side
 *   stretch : frame distorted to the screen shape
 */

export const FIT_MODES = ['contain', 'cover', 'stretch']

/**
 * @param {object} input
 * @param {number} input.videoWidth
 * @param {number} input.videoHeight
 * @param {number} input.screenWidth local width of the screen mesh
 * @param {number} input.screenHeight local height of the screen mesh
 * @param {'contain'|'cover'|'stretch'} input.fit
 * @returns {{repeat:{x:number,y:number},offset:{x:number,y:number},
 *            planeWidth:number,planeHeight:number,dimBase:boolean}}
 */
export function computeFit({ videoWidth, videoHeight, screenWidth, screenHeight, fit = 'contain' }) {
  const result = {
    repeat: { x: 1, y: 1 },
    offset: { x: 0, y: 0 },
    planeWidth: screenWidth,
    planeHeight: screenHeight,
    dimBase: false,
  }

  if (!videoWidth || !videoHeight || !screenWidth || !screenHeight) return result

  const videoAspect = videoWidth / videoHeight
  const screenAspect = screenWidth / screenHeight

  if (fit === 'stretch') return result

  if (fit === 'cover') {
    if (videoAspect > screenAspect) {
      result.repeat.x = screenAspect / videoAspect
      result.offset.x = (1 - result.repeat.x) / 2
    } else if (videoAspect < screenAspect) {
      result.repeat.y = videoAspect / screenAspect
      result.offset.y = (1 - result.repeat.y) / 2
    }
    return result
  }

  // contain
  if (videoAspect > screenAspect) {
    result.planeWidth = screenWidth
    result.planeHeight = screenWidth / videoAspect
  } else {
    result.planeHeight = screenHeight
    result.planeWidth = screenHeight * videoAspect
  }
  result.dimBase = true
  return result
}

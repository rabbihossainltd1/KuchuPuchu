/**
 * The viewer's geometry, kept DOM-free so Node can pin it against the phone.
 *
 * Every number here comes from `MediaViewer.kt`; `test/cases/58-web-media-viewers.mjs`
 * parses the Kotlin and compares, so a drift on either side fails in CI rather
 * than in a reader's hands:
 *
 *   pinch clamp                 `(scale * zoom).coerceIn(1f, 6f)`
 *   double-tap target           `if (scale > 1f) 1f else 2.5f`
 *   "not zoomed" threshold      `scale > 1.01f`
 *   pan box                     `maxX = size.width * (scale - 1f) / 2f`
 *   page flip                   zoom resets to 1
 */

/** `coerceIn(1f, 6f)`. */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 6;

/** `val target = if (scale > 1f) 1f else 2.5f`. */
export const DOUBLE_TAP_ZOOM = 2.5;

/** One wheel notch, and one `+` / `-` press. The phone's pinch is continuous. */
export const ZOOM_STEP = 1.25;

/** How far an arrow key pans while zoomed, in CSS pixels. */
export const KEY_PAN_STEP = 64;

/** Past this much downward drag at 1× the viewer closes on release. */
export const DRAG_CLOSE_THRESHOLD = 120;

/** `scale > 1.01f` — below this, a photo counts as not zoomed. */
export const ZOOM_EPSILON = 1.01;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * The pan box: how far the picture may travel at a given scale before its edge
 * reaches the stage's centre line. `maxX = size.width * (scale - 1f) / 2f`, and
 * the same for Y — so at 1× there is nowhere to go, and at 6× the picture can
 * travel 2.5 stage widths in each axis.
 */
export function panLimit(
  boxWidth: number,
  boxHeight: number,
  scale: number,
): { x: number; y: number } {
  const factor = Math.max(0, scale - 1) / 2;
  return { x: boxWidth * factor, y: boxHeight * factor };
}

/** True when a pan is allowed to hold the gesture instead of paging or closing. */
export function isZoomed(scale: number): boolean {
  return scale > ZOOM_EPSILON;
}

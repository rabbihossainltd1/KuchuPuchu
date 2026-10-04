/**
 * The photo editor's model: pure geometry and immutable reducers.
 *
 * Everything here is DOM-free so a contract case can prove the maths — crop
 * clamping, rotation swaps, output size, sticker/text placement — without a
 * canvas. `renderEdits.ts` is the only part that touches pixels.
 *
 * Coordinates are NORMALIZED (0..1 of the source bitmap) rather than pixels: a
 * crop or a sticker placed on a 4000×3000 photo has to land in the same place
 * after the photo is shrunk to a 2048 long edge for upload.
 */

import { longestEdgeFit } from "./uploadContract";

export type NormalizedRect = { x: number; y: number; w: number; h: number };
export type NormalizedPoint = { x: number; y: number };
export type Rotation = 0 | 90 | 180 | 270;

export type StickerPlacement = {
  readonly id: string;
  readonly glyph: string;
  /** Centre of the sticker, normalized against the cropped output. */
  readonly x: number;
  readonly y: number;
  /** 1 = the default size (a sixth of the output width). */
  readonly scale: number;
  readonly rotation: number;
};

export type TextLayer = {
  readonly id: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly color: string;
  readonly rotation: number;
};

export type Stroke = {
  readonly id: string;
  readonly color: string;
  /** Brush width as a fraction of the output's short edge. */
  readonly width: number;
  readonly points: readonly NormalizedPoint[];
};

export type EditModel = {
  readonly crop: NormalizedRect | null;
  readonly rotation: Rotation;
  readonly stickers: readonly StickerPlacement[];
  readonly texts: readonly TextLayer[];
  readonly strokes: readonly Stroke[];
};

export const EMPTY_EDIT: EditModel = Object.freeze({
  crop: null,
  rotation: 0,
  stickers: Object.freeze([]),
  texts: Object.freeze([]),
  strokes: Object.freeze([]),
});

export const STICKER_DEFAULT_SCALE = 1 / 6;
export const MAX_EDIT_LAYERS = 40;
export const MAX_CROP_TEXT_LENGTH = 200;

export const DRAW_COLORS: readonly string[] = Object.freeze([
  "#ffffff",
  "#111827",
  "#ef4444",
  "#f59e0b",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
]);

export const BRUSH_WIDTHS: readonly number[] = Object.freeze([0.006, 0.012, 0.024]);

export type CropPreset = {
  readonly id: string;
  readonly label: string;
  /** null = keep the source's own ratio. */
  readonly ratio: number | null;
};

/** The crop ratios the phone's editor offers; the labels match its sheet. */
export const CROP_PRESETS: readonly CropPreset[] = Object.freeze([
  { id: "original", label: "Original", ratio: null },
  { id: "square", label: "1:1", ratio: 1 },
  { id: "portrait", label: "4:5", ratio: 4 / 5 },
  { id: "wide", label: "16:9", ratio: 16 / 9 },
  { id: "tall", label: "9:16", ratio: 9 / 16 },
  { id: "classic", label: "3:4", ratio: 3 / 4 },
]);

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Force a rect inside the unit square with a non-zero area. Drag handles can
 * easily produce a negative or overflowing rect; the renderer must never see
 * one, or `drawImage` silently paints nothing.
 */
export function clampRect(rect: NormalizedRect): NormalizedRect {
  const x = clamp01(rect.x);
  const y = clamp01(rect.y);
  const w = clamp01(rect.w);
  const h = clamp01(rect.h);
  return {
    x,
    y,
    w: Math.max(0.02, Math.min(w, 1 - x)),
    h: Math.max(0.02, Math.min(h, 1 - y)),
  };
}

/** A centred crop of the given ratio, in normalized source coordinates. */
export function presetCrop(
  sourceWidth: number,
  sourceHeight: number,
  ratio: number | null,
): NormalizedRect | null {
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) return null;
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) return null;

  const sourceRatio = sourceWidth / sourceHeight;
  if (Math.abs(sourceRatio - ratio) < 1e-6) return { x: 0, y: 0, w: 1, h: 1 };

  if (sourceRatio > ratio) {
    // Source is wider: keep the full height, trim the sides.
    const w = ratio / sourceRatio;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }
  const h = sourceRatio / ratio;
  return { x: 0, y: (1 - h) / 2, w: 1, h };
}

/** 90° steps, wrapping. Rotate-left is what the editor's first button does. */
export function rotateBy(rotation: Rotation, delta: 90 | -90): Rotation {
  const next = (((rotation + delta) % 360) + 360) % 360;
  return next as Rotation;
}

/** A quarter or three-quarter turn swaps width and height. */
export function rotatedSize(
  width: number,
  height: number,
  rotation: Rotation,
): { width: number; height: number } {
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height };
}

/**
 * The pixel box the crop covers in the SOURCE bitmap. Integer-rounded, because
 * `drawImage` with fractional source rects blurs the first row and column.
 */
export function cropPixels(
  sourceWidth: number,
  sourceHeight: number,
  crop: NormalizedRect | null,
): { sx: number; sy: number; sw: number; sh: number } {
  if (!crop) return { sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight };
  const rect = clampRect(crop);
  const sx = Math.max(0, Math.min(sourceWidth - 1, Math.round(rect.x * sourceWidth)));
  const sy = Math.max(0, Math.min(sourceHeight - 1, Math.round(rect.y * sourceHeight)));
  const sw = Math.max(1, Math.min(sourceWidth - sx, Math.round(rect.w * sourceWidth)));
  const sh = Math.max(1, Math.min(sourceHeight - sy, Math.round(rect.h * sourceHeight)));
  return { sx, sy, sw, sh };
}

/**
 * The final output box: crop, then rotation, then the upload shrink. This is
 * the pair that goes into `meta.w` / `meta.h`, and it must match what the
 * renderer actually produces or the phone draws the bubble at the wrong ratio.
 */
export function outputSize(
  sourceWidth: number,
  sourceHeight: number,
  edit: EditModel,
  maxEdge = 2048,
): { width: number; height: number; scaled: boolean } {
  const box = cropPixels(sourceWidth, sourceHeight, edit.crop);
  const turned = rotatedSize(box.sw, box.sh, edit.rotation);
  return longestEdgeFit(turned.width, turned.height, maxEdge);
}

export function editIsEmpty(edit: EditModel): boolean {
  return (
    edit.crop === null &&
    edit.rotation === 0 &&
    edit.stickers.length === 0 &&
    edit.texts.length === 0 &&
    edit.strokes.length === 0
  );
}

/* ------------------------------------------------------------------ reducers */

export function withCrop(edit: EditModel, crop: NormalizedRect | null): EditModel {
  return { ...edit, crop: crop ? clampRect(crop) : null };
}

export function withRotation(edit: EditModel, rotation: Rotation): EditModel {
  return { ...edit, rotation };
}

export function addSticker(edit: EditModel, glyph: string, id: string): EditModel {
  if (edit.stickers.length >= MAX_EDIT_LAYERS) return edit;
  const placement: StickerPlacement = {
    id,
    glyph,
    x: 0.5,
    y: 0.5,
    scale: 1,
    rotation: 0,
  };
  return { ...edit, stickers: [...edit.stickers, placement] };
}

export function moveSticker(
  edit: EditModel,
  id: string,
  patch: Partial<Omit<StickerPlacement, "id" | "glyph">>,
): EditModel {
  return {
    ...edit,
    stickers: edit.stickers.map((sticker) =>
      sticker.id === id
        ? {
            ...sticker,
            ...patch,
            x: clamp01(patch.x ?? sticker.x),
            y: clamp01(patch.y ?? sticker.y),
            scale: Math.min(3, Math.max(0.25, patch.scale ?? sticker.scale)),
          }
        : sticker,
    ),
  };
}

export function removeSticker(edit: EditModel, id: string): EditModel {
  return { ...edit, stickers: edit.stickers.filter((sticker) => sticker.id !== id) };
}

export function addText(edit: EditModel, text: string, color: string, id: string): EditModel {
  const trimmed = text.slice(0, MAX_CROP_TEXT_LENGTH);
  if (!trimmed.trim() || edit.texts.length >= MAX_EDIT_LAYERS) return edit;
  const layer: TextLayer = { id, text: trimmed, x: 0.5, y: 0.5, size: 1, color, rotation: 0 };
  return { ...edit, texts: [...edit.texts, layer] };
}

export function updateText(
  edit: EditModel,
  id: string,
  patch: Partial<Omit<TextLayer, "id">>,
): EditModel {
  return {
    ...edit,
    texts: edit.texts.map((layer) =>
      layer.id === id
        ? {
            ...layer,
            ...patch,
            text: (patch.text ?? layer.text).slice(0, MAX_CROP_TEXT_LENGTH),
            x: clamp01(patch.x ?? layer.x),
            y: clamp01(patch.y ?? layer.y),
            size: Math.min(3, Math.max(0.25, patch.size ?? layer.size)),
          }
        : layer,
    ),
  };
}

export function removeText(edit: EditModel, id: string): EditModel {
  return { ...edit, texts: edit.texts.filter((layer) => layer.id !== id) };
}

export function beginStroke(
  edit: EditModel,
  id: string,
  color: string,
  width: number,
  point: NormalizedPoint,
): EditModel {
  if (edit.strokes.length >= MAX_EDIT_LAYERS) return edit;
  const stroke: Stroke = {
    id,
    color,
    width: BRUSH_WIDTHS.includes(width) ? width : (BRUSH_WIDTHS[1] ?? 0.012),
    points: [{ x: clamp01(point.x), y: clamp01(point.y) }],
  };
  return { ...edit, strokes: [...edit.strokes, stroke] };
}

export function extendStroke(edit: EditModel, id: string, point: NormalizedPoint): EditModel {
  return {
    ...edit,
    strokes: edit.strokes.map((stroke) =>
      stroke.id === id
        ? { ...stroke, points: [...stroke.points, { x: clamp01(point.x), y: clamp01(point.y) }] }
        : stroke,
    ),
  };
}

/** Remove whichever layer carries this id, whatever its kind. */
export function removeLayerById(edit: EditModel, id: string): EditModel {
  if (edit.stickers.some((item) => item.id === id)) return removeSticker(edit, id);
  if (edit.texts.some((item) => item.id === id)) return removeText(edit, id);
  return { ...edit, strokes: edit.strokes.filter((stroke) => stroke.id !== id) };
}

/**
 * Undo the last layer added.
 *
 * The model keeps three arrays, so it cannot know insertion order by itself.
 * The caller passes the order it created layers in (`history` in the editor);
 * without it, undo falls back to the most recent sticker, then text, then
 * stroke — documented rather than pretending to be a real undo stack. Crops and
 * rotation are reset by the explicit "Reset" control, not by undo.
 */
export function undoLast(edit: EditModel, order?: readonly string[]): EditModel {
  if (order && order.length) {
    for (let index = order.length - 1; index >= 0; index -= 1) {
      const id = order[index];
      if (!id) continue;
      const present =
        edit.stickers.some((item) => item.id === id) ||
        edit.texts.some((item) => item.id === id) ||
        edit.strokes.some((item) => item.id === id);
      if (present) return removeLayerById(edit, id);
    }
    return edit;
  }

  const lastSticker = edit.stickers[edit.stickers.length - 1];
  if (lastSticker) return removeSticker(edit, lastSticker.id);
  const lastText = edit.texts[edit.texts.length - 1];
  if (lastText) return removeText(edit, lastText.id);
  const lastStroke = edit.strokes[edit.strokes.length - 1];
  if (lastStroke) return { ...edit, strokes: edit.strokes.slice(0, -1) };
  return edit;
}

export function clearLayers(edit: EditModel): EditModel {
  return { ...edit, stickers: [], texts: [], strokes: [] };
}

/**
 * Sticker font size in output pixels. A scale of 1 means the glyph is a sixth
 * of the output width, which is what the phone's sheet lands on by default.
 */
export function stickerFontSize(outputWidth: number, scale: number): number {
  return Math.max(8, Math.round(outputWidth * STICKER_DEFAULT_SCALE * scale));
}

/** Caption font size in output pixels, from the layer's relative size. */
export function textFontSize(outputWidth: number, size: number): number {
  return Math.max(10, Math.round(outputWidth * 0.06 * size));
}

/** Brush width in output pixels, from the fraction of the short edge. */
export function brushWidth(shortEdge: number, width: number): number {
  return Math.max(1, Math.round(shortEdge * width));
}

/**
 * The only part of the photo editor that touches pixels.
 *
 * Order matters and matches what the user sees: crop → rotate → shrink to the
 * upload edge → strokes → stickers → text → JPEG. Strokes, stickers and text
 * are normalized against the OUTPUT box, because that is the box the preview
 * shows; keeping them in source coordinates would make every placement drift
 * the moment the photo is cropped.
 */

import {
  brushWidth,
  cropPixels,
  rotatedSize,
  stickerFontSize,
  textFontSize,
  type EditModel,
} from "./imageEdit";
import { PHOTO_MAX_EDGE, longestEdgeFit } from "./uploadContract";

export const JPEG_QUALITY = 0.86;

export type RenderedPhoto = {
  blob: Blob;
  width: number;
  height: number;
  /** True when the long edge had to come down to fit the upload ceiling. */
  scaled: boolean;
};

/** Decode a picked file. Falls back to an <img> when createImageBitmap is absent. */
export async function decodeImage(
  file: Blob,
): Promise<{ source: CanvasImageSource; width: number; height: number; close(): void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => {
          void bitmap.close?.();
        },
      };
    } catch {
      // A format the browser cannot decode (HEIC from an iPhone, say) falls
      // through to the <img> path, which produces the same failure with a
      // message the caller can show.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("IMAGE_DECODE_FAILED"));
      element.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/** Pixel dimensions of any image file, or null when it cannot be decoded. */
export async function measureImage(file: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const decoded = await decodeImage(file);
    const size = { width: decoded.width, height: decoded.height };
    decoded.close();
    return size;
  } catch {
    return null;
  }
}

/**
 * Width, height and duration of a picked clip or audio file, from the browser's
 * own decoder. This is the web equivalent of Android's `VideoFacts.probe`, and
 * it feeds `meta.w` / `meta.h` / `meta.durMs` / `meta.seconds`.
 */
export async function probeMedia(
  file: Blob,
): Promise<{ width: number; height: number; durationMs: number }> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const element = document.createElement("video");
      element.preload = "metadata";
      element.muted = true;
      element.playsInline = true;
      const finish = () => {
        const duration = Number.isFinite(element.duration) ? element.duration : 0;
        resolve({
          width: element.videoWidth || 0,
          height: element.videoHeight || 0,
          durationMs: Math.max(0, Math.round(duration * 1000)),
        });
      };
      element.onloadedmetadata = finish;
      element.onerror = () => reject(new Error("MEDIA_PROBE_FAILED"));
      // Audio files have no video box; loadedmetadata still carries duration.
      element.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function makeCanvas(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("CANVAS_UNAVAILABLE");
  return { canvas, ctx };
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("ENCODE_FAILED"))),
      "image/jpeg",
      quality,
    );
  });
}

/**
 * Bake an edit into a JPEG at the upload size.
 *
 * `maxEdge` defaults to the shared 2048 long edge; a caller may pass a smaller
 * value for a thumbnail, which is how the composer preview avoids holding a
 * full-size bitmap per pending photo.
 */
export async function renderEdits(
  file: Blob,
  edit: EditModel,
  maxEdge = PHOTO_MAX_EDGE,
  quality = JPEG_QUALITY,
): Promise<RenderedPhoto> {
  const decoded = await decodeImage(file);
  try {
    const box = cropPixels(decoded.width, decoded.height, edit.crop);
    const turned = rotatedSize(box.sw, box.sh, edit.rotation);
    const fit = longestEdgeFit(turned.width, turned.height, maxEdge);
    if (!fit.width || !fit.height) throw new Error("EMPTY_OUTPUT");

    const { canvas, ctx } = makeCanvas(fit.width, fit.height);
    // A JPEG has no alpha: paint white first or transparent PNGs come out black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, fit.width, fit.height);

    const scale = fit.width / turned.width;
    ctx.save();
    ctx.translate(fit.width / 2, fit.height / 2);
    if (edit.rotation) ctx.rotate((edit.rotation * Math.PI) / 180);
    ctx.drawImage(
      decoded.source,
      box.sx,
      box.sy,
      box.sw,
      box.sh,
      -(box.sw * scale) / 2,
      -(box.sh * scale) / 2,
      box.sw * scale,
      box.sh * scale,
    );
    ctx.restore();

    const shortEdge = Math.min(fit.width, fit.height);

    for (const stroke of edit.strokes) {
      if (stroke.points.length === 0) continue;
      ctx.save();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = brushWidth(shortEdge, stroke.width);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      stroke.points.forEach((point, index) => {
        const x = point.x * fit.width;
        const y = point.y * fit.height;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      // A single tap still deserves a dot.
      if (stroke.points.length === 1) {
        const only = stroke.points[0]!;
        ctx.lineTo(only.x * fit.width + 0.01, only.y * fit.height + 0.01);
      }
      ctx.stroke();
      ctx.restore();
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (const sticker of edit.stickers) {
      ctx.save();
      ctx.translate(sticker.x * fit.width, sticker.y * fit.height);
      if (sticker.rotation) ctx.rotate((sticker.rotation * Math.PI) / 180);
      ctx.font = `${stickerFontSize(fit.width, sticker.scale)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", serif`;
      ctx.fillText(sticker.glyph, 0, 0);
      ctx.restore();
    }

    for (const layer of edit.texts) {
      ctx.save();
      ctx.translate(layer.x * fit.width, layer.y * fit.height);
      if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180);
      const size = textFontSize(fit.width, layer.size);
      ctx.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      // A shadow keeps light text readable on a light photo and vice versa.
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = Math.max(2, size / 8);
      ctx.fillStyle = layer.color;
      ctx.fillText(layer.text, 0, 0);
      ctx.restore();
    }

    const blob = await canvasToJpeg(canvas, quality);
    return { blob, width: fit.width, height: fit.height, scaled: fit.scaled };
  } finally {
    decoded.close();
  }
}

/** Shrink an unedited photo for upload — the production PWA's `shrinkImage`. */
export async function shrinkPhoto(file: Blob, maxEdge = PHOTO_MAX_EDGE): Promise<RenderedPhoto> {
  const measured = await measureImage(file);
  if (!measured) throw new Error("IMAGE_DECODE_FAILED");
  const fit = longestEdgeFit(measured.width, measured.height, maxEdge);
  if (!fit.scaled) {
    // Already inside the ceiling: upload the bytes the user picked, untouched.
    return { blob: file, width: measured.width, height: measured.height, scaled: false };
  }
  const decoded = await decodeImage(file);
  try {
    const { canvas, ctx } = makeCanvas(fit.width, fit.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, fit.width, fit.height);
    ctx.drawImage(decoded.source, 0, 0, fit.width, fit.height);
    const blob = await canvasToJpeg(canvas, JPEG_QUALITY);
    return { blob, width: fit.width, height: fit.height, scaled: true };
  } finally {
    decoded.close();
  }
}

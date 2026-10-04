/**
 * The photo editor: crop, rotate, freehand draw, text and stickers.
 *
 * The preview is the real thing — every edit re-bakes a JPEG through
 * `renderEdits` (at a smaller edge for speed) and shows those bytes, so what the
 * user sees is what the phone will receive. The final send bakes again at the
 * 2048 upload edge. A live overlay canvas carries the stroke currently under
 * the pointer, because re-encoding per pointermove would not keep up.
 *
 * Keyboard parity: crop presets, rotate, text, sticker and layer management are
 * all reachable without a pointer, and the crop box answers arrow keys.
 * Freehand drawing is pointer-only and says so rather than pretending.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BRUSH_WIDTHS,
  DRAW_COLORS,
  CROP_PRESETS,
  EMPTY_EDIT,
  addSticker,
  addText,
  beginStroke,
  clearLayers,
  clamp01,
  clampRect,
  editIsEmpty,
  extendStroke,
  moveSticker,
  outputSize,
  removeLayerById,
  presetCrop,
  removeSticker,
  removeText,
  rotateBy,
  undoLast,
  updateText,
  withCrop,
  withRotation,
  type EditModel,
  type NormalizedPoint,
  type Rotation,
} from "./imageEdit";
import { renderEdits } from "./renderEdits";
import { StickerPicker } from "./StickerPicker";

const PREVIEW_EDGE = 1024;

export type PhotoEditorProps = {
  /** The bytes to edit — already shrunk to the upload edge by the composer. */
  file: Blob;
  fileName: string;
  sourceWidth: number;
  sourceHeight: number;
  initialEdit?: EditModel;
  onCancel: () => void;
  onDone: (rendered: { blob: Blob; width: number; height: number }, edit: EditModel) => void;
  onAnnounce?: (message: string) => void;
};

type Tool = "crop" | "draw" | "text" | "sticker";

let layerCounter = 0;
function nextLayerId(prefix: string): string {
  layerCounter += 1;
  return `${prefix}_${layerCounter}`;
}

export function PhotoEditor({
  file,
  fileName,
  sourceWidth,
  sourceHeight,
  initialEdit = EMPTY_EDIT,
  onCancel,
  onDone,
  onAnnounce,
}: PhotoEditorProps) {
  const [edit, setEdit] = useState<EditModel>(initialEdit);
  const [tool, setTool] = useState<Tool>("crop");
  const [previewUrl, setPreviewUrl] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [color, setColor] = useState(DRAW_COLORS[0] ?? "#ffffff");
  const [brush, setBrush] = useState(BRUSH_WIDTHS[1] ?? 0.012);
  const [textDraft, setTextDraft] = useState("");
  const [selected, setSelected] = useState("");
  const [strokeId, setStrokeId] = useState("");
  /** Layer ids in the order they were added, so undo really undoes the last. */
  const [history, setHistory] = useState<readonly string[]>([]);

  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef("");
  const renderToken = useRef(0);

  const box = useMemo(
    () => outputSize(sourceWidth, sourceHeight, edit, PREVIEW_EDGE),
    [edit, sourceHeight, sourceWidth],
  );
  const sendBox = useMemo(
    () => outputSize(sourceWidth, sourceHeight, edit),
    [edit, sourceHeight, sourceWidth],
  );

  /* ------------------------------------------------------------- bake preview */

  useEffect(() => {
    const token = ++renderToken.current;
    setBusy(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const rendered = await renderEdits(file, edit, PREVIEW_EDGE);
          if (token !== renderToken.current) return;
          const url = URL.createObjectURL(rendered.blob);
          if (previewRef.current) URL.revokeObjectURL(previewRef.current);
          previewRef.current = url;
          setPreviewUrl(url);
          setError("");
        } catch {
          if (token !== renderToken.current) return;
          setError("That image could not be edited in this browser.");
        } finally {
          if (token === renderToken.current) setBusy(false);
        }
      })();
    }, 120);

    return () => window.clearTimeout(timer);
  }, [edit, file]);

  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  /* ------------------------------------------------------------------- actions */

  const announce = useCallback(
    (message: string) => {
      onAnnounce?.(message);
    },
    [onAnnounce],
  );

  const applyCropPreset = useCallback(
    (ratio: number | null, label: string) => {
      const crop = ratio === null ? null : presetCrop(sourceWidth, sourceHeight, ratio);
      setEdit((current) => withCrop(current, crop));
      announce(`Crop set to ${label}.`);
    },
    [announce, sourceHeight, sourceWidth],
  );

  const rotate = useCallback(
    (delta: 90 | -90) => {
      setEdit((current) => withRotation(current, rotateBy(current.rotation, delta)));
      announce(delta === -90 ? "Rotated left." : "Rotated right.");
    },
    [announce],
  );

  const nudgeCrop = useCallback((dx: number, dy: number, resize: boolean) => {
    setEdit((current) => {
      const rect = clampRect(current.crop ?? { x: 0, y: 0, w: 1, h: 1 });
      const step = 0.02;
      const next = resize
        ? { ...rect, w: rect.w + dx * step, h: rect.h + dy * step }
        : { ...rect, x: rect.x + dx * step, y: rect.y + dy * step };
      return withCrop(current, clampRect(next));
    });
  }, []);

  const onFrameKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (tool !== "crop") return;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      nudgeCrop(move[0], move[1], event.shiftKey);
    },
    [nudgeCrop, tool],
  );

  const framePoint = useCallback((event: React.PointerEvent<HTMLDivElement>): NormalizedPoint => {
    const frame = frameRef.current;
    if (!frame) return { x: 0.5, y: 0.5 };
    const rect = frame.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - rect.left) / Math.max(1, rect.width)),
      y: clamp01((event.clientY - rect.top) / Math.max(1, rect.height)),
    };
  }, []);

  const drawLiveStroke = useCallback(
    (points: readonly NormalizedPoint[]) => {
      const canvas = overlayRef.current;
      const frame = frameRef.current;
      if (!canvas || !frame) return;
      const rect = frame.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width));
      canvas.height = Math.max(1, Math.round(rect.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (points.length < 1) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, brush * Math.min(canvas.width, canvas.height));
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      points.forEach((point, index) => {
        const x = point.x * canvas.width;
        const y = point.y * canvas.height;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    },
    [brush, color],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (tool !== "draw") return;
      event.preventDefault();
      const id = nextLayerId("stroke");
      const point = framePoint(event);
      setStrokeId(id);
      setEdit((current) => beginStroke(current, id, color, brush, point));
      setHistory((current) => [...current, id]);
      drawLiveStroke([point]);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [brush, color, drawLiveStroke, framePoint, tool],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (tool !== "draw" || !strokeId) return;
      const point = framePoint(event);
      setEdit((current) => extendStroke(current, strokeId, point));
      const stroke = edit.strokes.find((item) => item.id === strokeId);
      drawLiveStroke([...(stroke?.points ?? []), point]);
    },
    [drawLiveStroke, edit.strokes, framePoint, strokeId, tool],
  );

  const onPointerUp = useCallback(() => {
    if (!strokeId) return;
    setStrokeId("");
    drawLiveStroke([]);
  }, [drawLiveStroke, strokeId]);

  const submitText = useCallback(() => {
    const value = textDraft.trim();
    if (!value) return;
    const id = nextLayerId("text");
    setEdit((current) => addText(current, value, color, id));
    setHistory((current) => [...current, id]);
    setTextDraft("");
    setSelected(id);
    announce(`Text "${value}" added.`);
  }, [announce, color, textDraft]);

  const pickSticker = useCallback(
    (glyph: string) => {
      const id = nextLayerId("sticker");
      setEdit((current) => addSticker(current, glyph, id));
      setHistory((current) => [...current, id]);
      setSelected(id);
      setTool("crop");
      announce(`Sticker ${glyph} added to the photo.`);
    },
    [announce],
  );

  const moveSelected = useCallback(
    (dx: number, dy: number) => {
      if (!selected) return;
      const step = 0.02;
      setEdit((current) => {
        if (current.stickers.some((item) => item.id === selected)) {
          const sticker = current.stickers.find((item) => item.id === selected);
          if (!sticker) return current;
          return moveSticker(current, selected, {
            x: sticker.x + dx * step,
            y: sticker.y + dy * step,
          });
        }
        const layer = current.texts.find((item) => item.id === selected);
        if (!layer) return current;
        return updateText(current, selected, { x: layer.x + dx * step, y: layer.y + dy * step });
      });
    },
    [selected],
  );

  const scaleSelected = useCallback(
    (delta: number) => {
      if (!selected) return;
      setEdit((current) => {
        const sticker = current.stickers.find((item) => item.id === selected);
        if (sticker) return moveSticker(current, selected, { scale: sticker.scale + delta });
        const layer = current.texts.find((item) => item.id === selected);
        if (layer) return updateText(current, selected, { size: layer.size + delta });
        return current;
      });
    },
    [selected],
  );

  const removeSelected = useCallback(() => {
    if (!selected) return;
    setEdit((current) => removeLayerById(current, selected));
    setHistory((current) => current.filter((id) => id !== selected));
    setSelected("");
    announce("Layer removed.");
  }, [announce, selected]);

  const finish = useCallback(async () => {
    setBusy(true);
    try {
      const rendered = await renderEdits(file, edit);
      onDone({ blob: rendered.blob, width: rendered.width, height: rendered.height }, edit);
    } catch {
      setBusy(false);
      setError("That image could not be saved. Cancel and send the photo unedited.");
    }
  }, [edit, file, onDone]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const cropRect = clampRect(edit.crop ?? { x: 0, y: 0, w: 1, h: 1 });
  const layerCount = edit.stickers.length + edit.texts.length + edit.strokes.length;

  return (
    <div
      className="photo-editor"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit photo ${fileName}`}
    >
      <header className="photo-editor__head">
        <div>
          <h3 id="photo-editor-title">Edit photo</h3>
          <p className="photo-editor__dims">
            Sends at {sendBox.width} × {sendBox.height}
            {busy ? " · rendering…" : ""}
          </p>
        </div>
        <div className="photo-editor__head-actions">
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setEdit(EMPTY_EDIT);
              setSelected("");
              setHistory([]);
              announce("All edits cleared.");
            }}
            disabled={editIsEmpty(edit)}
          >
            Reset
          </button>
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void finish()}
            disabled={busy || Boolean(error)}
          >
            Save edit
          </button>
        </div>
      </header>

      {error && (
        <p className="photo-editor__error" role="alert">
          {error}
        </p>
      )}

      <div className="photo-editor__body">
        <div className="photo-editor__stage">
          <div
            className="photo-editor__frame"
            ref={frameRef}
            style={{ aspectRatio: `${box.width} / ${box.height}` }}
            tabIndex={0}
            role="group"
            aria-label={`Photo preview, ${box.width} by ${box.height} pixels. ${
              tool === "crop"
                ? "Arrow keys move the crop box, Shift plus arrow keys resize it."
                : ""
            }`}
            onKeyDown={onFrameKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {previewUrl && (
              <img className="photo-editor__preview" src={previewUrl} alt="" aria-hidden="true" />
            )}
            <canvas className="photo-editor__overlay" ref={overlayRef} aria-hidden="true" />
            {tool === "crop" && edit.crop && (
              <div
                className="photo-editor__cropbox"
                style={{
                  left: `${cropRect.x * 100}%`,
                  top: `${cropRect.y * 100}%`,
                  width: `${cropRect.w * 100}%`,
                  height: `${cropRect.h * 100}%`,
                }}
                aria-hidden="true"
              />
            )}
            {tool === "draw" && <div className="photo-editor__draw-hint">Draw with a pointer</div>}
          </div>
        </div>

        <div className="photo-editor__tools">
          <div className="photo-editor__tool-tabs" role="group" aria-label="Editing tools">
            {(["crop", "draw", "text", "sticker"] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={`tool-tab${tool === item ? " is-active" : ""}`}
                aria-pressed={tool === item}
                onClick={() => setTool(item)}
              >
                {item === "crop"
                  ? "Crop & rotate"
                  : item === "draw"
                    ? "Draw"
                    : item === "text"
                      ? "Text"
                      : "Sticker"}
              </button>
            ))}
          </div>

          {tool === "crop" && (
            <div className="tool-panel">
              <p className="tool-panel__label" id="crop-ratio-label">
                Crop ratio
              </p>
              <div className="tool-panel__row" role="group" aria-labelledby="crop-ratio-label">
                {CROP_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyCropPreset(preset.ratio, preset.label)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <p className="tool-panel__label" id="rotate-label">
                Rotate
              </p>
              <div className="tool-panel__row" role="group" aria-labelledby="rotate-label">
                <button type="button" onClick={() => rotate(-90)}>
                  Rotate left
                </button>
                <button type="button" onClick={() => rotate(90)}>
                  Rotate right
                </button>
              </div>
              <p className="tool-panel__hint">
                Current rotation {edit.rotation}°. The crop box answers arrow keys when the preview
                has focus.
              </p>
            </div>
          )}

          {tool === "draw" && (
            <div className="tool-panel">
              <p className="tool-panel__label" id="draw-color-label">
                Brush colour
              </p>
              <div className="tool-panel__row" role="group" aria-labelledby="draw-color-label">
                {DRAW_COLORS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`swatch${color === item ? " is-active" : ""}`}
                    style={{ background: item }}
                    aria-label={`Brush colour ${item}`}
                    aria-pressed={color === item}
                    onClick={() => setColor(item)}
                  />
                ))}
              </div>
              <p className="tool-panel__label" id="draw-width-label">
                Brush width
              </p>
              <div className="tool-panel__row" role="group" aria-labelledby="draw-width-label">
                {BRUSH_WIDTHS.map((item, index) => (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={brush === item}
                    onClick={() => setBrush(item)}
                  >
                    {["Fine", "Medium", "Wide"][index]}
                  </button>
                ))}
              </div>
              <p className="tool-panel__hint">
                Freehand drawing needs a pointer device — a mouse, trackpad or touch. Stickers and
                text can be placed entirely from the keyboard.
              </p>
            </div>
          )}

          {tool === "text" && (
            <div className="tool-panel">
              <label className="tool-panel__label" htmlFor="editor-text-input">
                Text on the photo
              </label>
              <div className="tool-panel__row">
                <input
                  id="editor-text-input"
                  value={textDraft}
                  maxLength={200}
                  onChange={(event) => setTextDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitText();
                    }
                  }}
                  placeholder="Type a line, then Add"
                />
                <button
                  type="button"
                  className="primary-button"
                  onClick={submitText}
                  disabled={!textDraft.trim()}
                >
                  Add
                </button>
              </div>
              <div className="tool-panel__row" role="group" aria-label="Text colour">
                {DRAW_COLORS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`swatch${color === item ? " is-active" : ""}`}
                    style={{ background: item }}
                    aria-label={`Text colour ${item}`}
                    aria-pressed={color === item}
                    onClick={() => setColor(item)}
                  />
                ))}
              </div>
            </div>
          )}

          {tool === "sticker" && (
            <StickerPicker
              onPick={pickSticker}
              onClose={() => setTool("crop")}
              onAnnounce={announce}
            />
          )}

          <div className="tool-panel">
            <p className="tool-panel__label" id="layers-label">
              Layers ({layerCount})
            </p>
            {layerCount === 0 ? (
              <p className="tool-panel__hint">Nothing added yet.</p>
            ) : (
              <ul className="layer-list" aria-labelledby="layers-label">
                {edit.stickers.map((sticker) => (
                  <li key={sticker.id}>
                    <button
                      type="button"
                      className={`layer-chip${selected === sticker.id ? " is-selected" : ""}`}
                      aria-pressed={selected === sticker.id}
                      onClick={() => setSelected(sticker.id)}
                    >
                      <span aria-hidden="true">{sticker.glyph}</span> Sticker {sticker.glyph}
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      aria-label={`Remove sticker ${sticker.glyph}`}
                      onClick={() => {
                        setEdit((current) => removeSticker(current, sticker.id));
                        setHistory((current) => current.filter((id) => id !== sticker.id));
                        if (selected === sticker.id) setSelected("");
                      }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
                {edit.texts.map((layer) => (
                  <li key={layer.id}>
                    <button
                      type="button"
                      className={`layer-chip${selected === layer.id ? " is-selected" : ""}`}
                      aria-pressed={selected === layer.id}
                      onClick={() => setSelected(layer.id)}
                    >
                      Text “{layer.text}”
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      aria-label={`Remove text ${layer.text}`}
                      onClick={() => {
                        setEdit((current) => removeText(current, layer.id));
                        setHistory((current) => current.filter((id) => id !== layer.id));
                        if (selected === layer.id) setSelected("");
                      }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
                {edit.strokes.map((stroke) => (
                  <li key={stroke.id}>
                    <span className="layer-chip layer-chip--static">
                      Drawing, {stroke.points.length} points
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {selected && (
              <div className="tool-panel__row" role="group" aria-label="Move the selected layer">
                <button
                  type="button"
                  onClick={() => moveSelected(-1, 0)}
                  aria-label="Move layer left"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => moveSelected(0, -1)}
                  aria-label="Move layer up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveSelected(0, 1)}
                  aria-label="Move layer down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => moveSelected(1, 0)}
                  aria-label="Move layer right"
                >
                  →
                </button>
                <button type="button" onClick={() => scaleSelected(0.1)} aria-label="Enlarge layer">
                  Larger
                </button>
                <button type="button" onClick={() => scaleSelected(-0.1)} aria-label="Shrink layer">
                  Smaller
                </button>
                <button type="button" className="text-button" onClick={removeSelected}>
                  Delete layer
                </button>
              </div>
            )}

            <div className="tool-panel__row">
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setEdit((current) => undoLast(current, history));
                  setHistory((current) => current.slice(0, -1));
                  announce("Last layer removed.");
                }}
                disabled={layerCount === 0}
              >
                Undo last layer
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setEdit((current) => clearLayers(current));
                  setSelected("");
                  setHistory([]);
                  announce("All layers removed.");
                }}
                disabled={layerCount === 0}
              >
                Clear layers
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

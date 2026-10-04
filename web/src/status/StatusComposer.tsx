import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import type { ApiClient } from "../auth/authApi";
import { PhotoEditor } from "../media/PhotoEditor";
import { uploadFile } from "../messaging/filesApi";
import {
  STATUS_BG_STYLES,
  STATUS_COPY,
  STATUS_DEFAULT_BG,
  STATUS_PHOTO_STEPS,
  STATUS_TEXT_MAX,
  STATUS_VIDEO_SECONDS_MAX,
  statusBgStyle,
  statusGradientCss,
  statusSecondsOf,
} from "./statusModel";
import { prepareStatusPhoto, readVideoSeconds, type StatusesController } from "./useStatuses";

/**
 * The two composers the phone has, as one dialog with two modes.
 *
 * Text mode is `StatusComposer` in StatusScreens.kt: a live gradient card, the
 * six backgrounds as a real radio group, a 500-character field and "Post
 * status" that is disabled until there is something to post.
 *
 * Media mode is the phone's picker plus its editor: a photo goes through the
 * same `PhotoEditor` the chat uses (crop, rotate, filter, pen, text, stickers —
 * the phone's status mode is `MediaEditScreen` too), and the baked picture is
 * then shrunk down a fixed ladder until it fits the Worker's inline cap, or
 * uploaded and posted by key when it never will. A clip is uploaded whole: a
 * browser cannot trim or re-encode video, and the notice says so instead of
 * drawing a trimmer that does nothing.
 */
export function StatusComposer({
  mode,
  api,
  controller,
  onClose,
  onPosted,
}: {
  readonly mode: "text" | "media";
  readonly api: ApiClient | null;
  readonly controller: StatusesController;
  readonly onClose: () => void;
  readonly onPosted: () => void;
}) {
  const [text, setText] = useState("");
  const [bgStyle, setBgStyle] = useState<string>(STATUS_DEFAULT_BG);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const [picked, setPicked] = useState<{
    kind: "IMAGE" | "VIDEO";
    blob: Blob;
    name: string;
    seconds: number;
  } | null>(null);
  const [editing, setEditing] = useState<{
    blob: Blob;
    name: string;
    width: number;
    height: number;
  } | null>(null);
  const photoInput = useRef<HTMLInputElement | null>(null);
  const videoInput = useRef<HTMLInputElement | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || editing) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, onClose]);

  useEffect(() => {
    if (mode === "text") fieldRef.current?.focus();
  }, [mode]);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const showPreview = useCallback((blob: Blob) => {
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(blob);
    });
  }, []);

  const pickPhoto = useCallback(async (file: File) => {
    setError("");
    // The phone hands the pick to its editor; so does this, with the same
    // editor the chat composer uses.
    const { width, height } = await imageBox(file);
    setEditing({ blob: file, name: file.name || "status.jpg", width, height });
  }, []);

  const pickVideo = useCallback(
    async (file: File) => {
      setError("");
      setBusy(true);
      try {
        const seconds = await readVideoSeconds(file);
        setPicked({ kind: "VIDEO", blob: file, name: file.name || "status.mp4", seconds });
        showPreview(file);
      } finally {
        setBusy(false);
      }
    },
    [showPreview],
  );

  const submitText = useCallback(async () => {
    if (!api || busy) return;
    setBusy(true);
    setError("");
    const result = await controller.post({ kind: "TEXT", text, bgStyle });
    setBusy(false);
    if (!result.ok) {
      setError(result.reason || STATUS_COPY.postFailed);
      return;
    }
    onPosted();
  }, [api, bgStyle, busy, controller, onPosted, text]);

  const submitMedia = useCallback(async () => {
    if (!api || busy || !picked) return;
    setBusy(true);
    setError("");
    try {
      if (picked.kind === "IMAGE") {
        const prepared = await prepareStatusPhoto(api, picked.blob, STATUS_PHOTO_STEPS);
        if (prepared.kind === "refused") {
          setError(prepared.reason);
          return;
        }
        const result = await controller.post({
          kind: "IMAGE",
          imageData: prepared.kind === "inline" ? prepared.imageData : "",
          fileKey: prepared.kind === "uploaded" ? prepared.fileKey : "",
        });
        if (!result.ok) {
          setError(result.reason || STATUS_COPY.postFailed);
          return;
        }
      } else {
        // A clip is uploaded whole — no trim, no re-encode, and the seconds the
        // server stores are the clip's own, capped at 120.
        const uploaded = await uploadFile(api, {
          name: picked.name || `status_${Date.now()}.mp4`,
          type: picked.blob.type || "video/mp4",
          blob: picked.blob,
        });
        const result = await controller.post({
          kind: "VIDEO",
          fileKey: uploaded.fileKey,
          seconds: statusSecondsOf(picked.seconds),
        });
        if (!result.ok) {
          setError(result.reason || STATUS_COPY.postFailed);
          return;
        }
      }
      onPosted();
    } catch (cause) {
      setError((cause as Error)?.message || STATUS_COPY.postFailed);
    } finally {
      setBusy(false);
    }
  }, [api, busy, controller, onPosted, picked]);

  if (editing) {
    return (
      <PhotoEditor
        file={editing.blob}
        fileName={editing.name}
        sourceWidth={editing.width}
        sourceHeight={editing.height}
        onCancel={() => setEditing(null)}
        onDone={(rendered) => {
          setEditing(null);
          setPicked({ kind: "IMAGE", blob: rendered.blob, name: editing.name, seconds: 0 });
          showPreview(rendered.blob);
        }}
        onAnnounce={controller.announce}
      />
    );
  }

  const style = statusBgStyle(bgStyle);
  const remaining = STATUS_TEXT_MAX - text.length;

  return (
    <div className="status-overlay" onClick={onClose}>
      <div
        className="status-composer"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "text" ? STATUS_COPY.composerTitle : STATUS_COPY.mediaStatus}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="status-composer__head">
          <h2>{mode === "text" ? STATUS_COPY.composerTitle : STATUS_COPY.mediaStatus}</h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label={STATUS_COPY.close}
            title={STATUS_COPY.close}
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        {mode === "text" ? (
          <>
            <div className="status-composer__card" style={{ background: statusGradientCss(style) }}>
              <p className={text ? "status-composer__preview" : "status-composer__hint"}>
                {text || STATUS_COPY.composerHint}
              </p>
            </div>

            <div className="status-composer__styles" role="radiogroup" aria-label="Background">
              {STATUS_BG_STYLES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={option.id === style.id}
                  aria-label={`Background ${option.id}`}
                  className={`status-composer__swatch${option.id === style.id ? " is-on" : ""}`}
                  style={{ background: statusGradientCss(option) }}
                  onClick={() => setBgStyle(option.id)}
                />
              ))}
            </div>

            <label className="sr-only" htmlFor="status-text">
              {STATUS_COPY.composerField}
            </label>
            <textarea
              id="status-text"
              ref={fieldRef}
              className="status-composer__field"
              value={text}
              maxLength={STATUS_TEXT_MAX}
              placeholder={STATUS_COPY.composerField}
              rows={3}
              onChange={(event) => {
                setText(event.target.value.slice(0, STATUS_TEXT_MAX));
                setError("");
              }}
            />
            <p className="status-composer__count" aria-live="polite">
              {remaining} character{remaining === 1 ? "" : "s"} left
            </p>
          </>
        ) : (
          <>
            {picked ? (
              <div className="status-composer__media">
                {picked.kind === "IMAGE" ? (
                  <img
                    src={preview}
                    alt={`The picture you picked for your status, ${picked.name}`}
                  />
                ) : (
                  // eslint-disable-next-line jsx-a11y/media-has-caption -- a clip
                  // the reader just picked from their own device; there are no
                  // captions to attach and none are claimed.
                  <video
                    src={preview}
                    controls
                    muted
                    playsInline
                    aria-label={`The clip you picked for your status, ${picked.name}`}
                  />
                )}
                <p className="status-composer__facts">
                  {picked.name}
                  {picked.kind === "VIDEO"
                    ? ` · ${statusSecondsOf(picked.seconds)} s${
                        picked.seconds > STATUS_VIDEO_SECONDS_MAX
                          ? ` (the server times it to ${STATUS_VIDEO_SECONDS_MAX} s)`
                          : ""
                      }`
                    : ""}
                </p>
                <p className="status-composer__note">{STATUS_COPY.browserNotice}</p>
                <div className="status-composer__row">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setPicked(null)}
                  >
                    Pick another
                  </button>
                  {picked.kind === "IMAGE" ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        imageBox(picked.blob).then((box) =>
                          setEditing({
                            blob: picked.blob,
                            name: picked.name,
                            width: box.width,
                            height: box.height,
                          }),
                        )
                      }
                    >
                      <Icon name="pencil" size={16} /> Edit
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="status-composer__chooser">
                <p>{STATUS_COPY.noStatusYetBody}</p>
                <div className="status-composer__row">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => photoInput.current?.click()}
                  >
                    <Icon name="photo" size={17} /> Choose a photo
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => videoInput.current?.click()}
                  >
                    <Icon name="video" size={17} /> Choose a video
                  </button>
                </div>
                <p className="status-composer__note">{STATUS_COPY.browserNotice}</p>
              </div>
            )}

            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              className="sr-only"
              aria-label="Photo for your status"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void pickPhoto(file);
              }}
            />
            <input
              ref={videoInput}
              type="file"
              accept="video/*"
              className="sr-only"
              aria-label="Video for your status"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void pickVideo(file);
              }}
            />
          </>
        )}

        {error ? (
          <p className="status-composer__error" role="alert">
            {error}
          </p>
        ) : null}

        <footer className="status-composer__foot">
          {mode === "text" ? (
            <button
              type="button"
              className="primary-button"
              disabled={busy || !text.trim()}
              onClick={() => void submitText()}
            >
              {busy ? STATUS_COPY.sharing : STATUS_COPY.post}
            </button>
          ) : (
            <button
              type="button"
              className="primary-button"
              disabled={busy || !picked}
              onClick={() => void submitMedia()}
            >
              {busy ? STATUS_COPY.sharing : STATUS_COPY.post}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

/** A picture's own box, for the editor: 0×0 when the bytes are not a picture. */
async function imageBox(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap !== "function") return { width: 0, height: 0 };
  try {
    const bitmap = await createImageBitmap(blob);
    const box = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return box;
  } catch {
    return { width: 0, height: 0 };
  }
}

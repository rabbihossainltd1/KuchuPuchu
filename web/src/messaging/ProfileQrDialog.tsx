/**
 * The profile QR card — the phone's `QrScreen.kt` "My code" pane, on the web
 * (owner 2026-10-19, the missing piece next to Nicknames: "web a profile a qr
 * option nai"). Every profile carries a share code in the Worker's user shape:
 * mine and a friend's alike. This shows the code, the picture and the name,
 * and — like the phone's Copy / Share row — the code's link as an action row,
 * with Reset on your own account only (one tap rotates it, invalidating the
 * old one).
 *
 * A code can MINT on open the way the phone's pane does: accounts that predate
 * QR profiles were never backfilled, so the panes used to spin forever; the
 * app mints `/api/users/me/qr-code/reset` when it finds its own account bare,
 * and so does this card (own profile only).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { authApi, type ApiClient } from "../auth/authApi";
import { apiErrorMessage } from "../api";
import { Icon } from "../icons";
import { useAvatar } from "./avatars";
import { UserBadges } from "./Badges";

export type QrProfileUser = {
  readonly id: string;
  readonly displayName: string;
  readonly username: string;
  readonly qrCode?: string | null;
  readonly avatarRef: string;
  readonly verified?: boolean;
  readonly moderator?: boolean;
  readonly badge?: string | null;
};

type Props = {
  readonly api: ApiClient;
  readonly user: QrProfileUser;
  /** Own account: enable reset + mint-on-demand. A friend's card is read-only. */
  readonly self: boolean;
  readonly onClose: () => void;
};

/* Owner round 120 (2026-10-21: "QR code ta jodi ami kono scanner dia scan
 * kori to tahole kichu text thake / QR code ta dekhlam ekta QR code sedaw
 * asha uchit https://kuchupuchu.web.app/@rabbihossainltd"): the QR ITSELF
 * now carries the pretty public link — any camera or scanner in the world
 * opens the same share card as a copied link. The in-app scanner parses that
 * URL back to the handle (QrScanPolicy), and the legacy token shape stays
 * understood so a code printed before this change still resolves through
 * /api/users/by-qr — a Reset still retires an old leak. The link you COPY
 * OUT is the same URL (see shareUrl below). */
function qrPayload(code: string, username: string): string {
  const handle = username.replace(/^@/, "").trim();
  if (!handle) return `kuchupuchu://user/${code}`;
  return `https://kuchupuchu.web.app/@${handle}`;
}

function shareUrl(code: string, username: string): string {
  const handle = username.replace(/^@/, "").trim();
  if (!handle) return `kuchupuchu://user/${code}`;
  return `https://kuchupuchu.web.app/@${handle}`;
}

/* WhatsApp-style: a white ROUNDED-SQUARE chip (≈ 26% of the code width) in
 * the middle of the QR, carrying the brand glyph with its background removed
 * (dark bubble + blue tail on transparent — the white bubble variant was
 * invisible on a white plate). Error correction H tolerates the ~7% covered
 * modules, so the chip never costs a scan. Owner 2026-10-21: the old circle
 * plate let the square logo's corners poke out — "alignment nai, background
 * remove nai". */
const QR_WIDTH = 512;
const PLATE = Math.round(QR_WIDTH * 0.26);
const PLATE_CORNER = PLATE * 0.3;
/* Round 121 (owner: "gap fill hoini"): no inset — the glyph reaches the
 * chip's own edge like WhatsApp's mark. */
const GLYPH_INSET = 0;

function platePath(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, PLATE, PLATE, PLATE_CORNER);
  } else {
    ctx.rect(x, y, PLATE, PLATE);
  }
}

async function drawQrWithBadge(canvas: HTMLCanvasElement, payload: string): Promise<void> {
  await QRCode.toCanvas(canvas, payload, {
    errorCorrectionLevel: "H",
    margin: 1,
    width: QR_WIDTH,
    color: { dark: "#0b1324", light: "#ffffff" },
  });
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const glyph = new Image();
  glyph.src = "/qr-badge.png";
  try {
    await glyph.decode();
  } catch {
    return; // the QR alone still scans; the badge is decorative
  }
  const x = (QR_WIDTH - PLATE) / 2;
  const y = (QR_WIDTH - PLATE) / 2;
  ctx.save();
  platePath(ctx, x, y);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.drawImage(
    glyph,
    x + GLYPH_INSET,
    y + GLYPH_INSET,
    PLATE - GLYPH_INSET * 2,
    PLATE - GLYPH_INSET * 2,
  );
  ctx.restore();
}

export function ProfileQrDialog({ api, user, self, onClose }: Props) {
  const avatar = useAvatar(api, user.avatarRef || "");
  const [code, setCode] = useState(user.qrCode ?? "");
  const [drawn, setDrawn] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "mint" | "reset">("");
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [notice, setNotice] = useState("");

  const resetCode = useCallback(async () => {
    const result = await api.request<{ qrCode?: string }>("/api/users/me/qr-code/reset", {
      method: "POST",
      body: JSON.stringify({}),
    });
    return result?.qrCode ?? "";
  }, [api]);

  // Mint-on-demand for a bare self account, exactly like the phone's pane —
  // but read the CURRENT code first so a working one is never rotated just
  // for opening this card.
  useEffect(() => {
    if (code || !self) return;
    let cancelled = false;
    setBusy("mint");
    setError("");
    void (async () => {
      try {
        const me = await authApi.getMe(api);
        const existing = (me?.user as { qrCode?: string | null } | undefined)?.qrCode ?? "";
        if (cancelled) return;
        if (existing) {
          setCode(existing);
          return;
        }
        const fresh = await resetCode();
        if (cancelled) return;
        if (fresh) setCode(fresh);
        else setError("Your code could not be created right now. Try again in a minute.");
      } catch (cause) {
        if (!cancelled) {
          setError(
            apiErrorMessage(cause) ||
              "Your code could not be created right now. Try again in a minute.",
          );
        }
      }
    })().finally(() => {
      if (!cancelled) setBusy("");
    });
    return () => {
      cancelled = true;
    };
  }, [api, code, resetCode, self]);

  useEffect(() => {
    if (!code) {
      setDrawn(false);
      return;
    }
    let cancelled = false;
    setDrawn(false);
    const run = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        window.requestAnimationFrame(run);
        return;
      }
      void drawQrWithBadge(canvas, qrPayload(code, user.username))
        .then(() => {
          if (!cancelled) setDrawn(true);
        })
        .catch(() => {
          if (!cancelled) setError("The code could not be drawn. Try again.");
        });
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [code, user.username]);

  const copyLink = useCallback(async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(shareUrl(code, user.username));
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2_000);
    } catch {
      setError("The link could not be copied — select it by hand.");
    }
  }, [code]);

  const shareLink = useCallback(async () => {
    if (!code) return;
    const text = `Add me on KuchuPuchu: ${shareUrl(code, user.username)}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text });
        return;
      } catch (cause) {
        if ((cause as Error)?.name === "AbortError") return; // the user closed the sheet
      }
    }
    await copyLink();
    setNotice("This browser has no share sheet — the link is copied instead.");
  }, [code, copyLink]);

  const doReset = useCallback(async () => {
    if (!self || busy) return;
    setBusy("reset");
    setError("");
    try {
      const fresh = await resetCode();
      if (fresh) {
        setCode(fresh);
        setNotice("New code created. The old one stopped working.");
      } else {
        setError("Could not reset the code.");
      }
    } catch (cause) {
      setError(apiErrorMessage(cause) || "Could not reset the code.");
    } finally {
      setBusy("");
    }
  }, [busy, resetCode, self]);

  const closeOnBackdrop = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onClose();
    },
    [onClose],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const title = user.displayName || "KuchuPuchu";
  const username = useMemo(() => (user.username ? `@${user.username}` : ""), [user.username]);

  return (
    <div
      className="profile-qr"
      role="dialog"
      aria-modal="true"
      aria-label={`${title}'s QR code`}
      onClick={closeOnBackdrop}
    >
      <div className="profile-qr__card" role="document">
        <button
          type="button"
          className="icon-button profile-qr__close"
          aria-label="Close QR code"
          onClick={onClose}
        >
          <Icon name="close" size={18} />
        </button>

        <span className="profile-qr__avatar" aria-hidden="true">
          {avatar ? (
            <img className="profile-qr__avatar-img" src={avatar} alt="" draggable={false} />
          ) : (
            title.charAt(0).toUpperCase() || "?"
          )}
        </span>
        <p className="profile-qr__name">
          {title}
          <UserBadges
            verified={user.verified ?? false}
            moderator={user.moderator ?? false}
            badge={user.badge ?? null}
            size={16}
          />
        </p>
        {username ? <p className="profile-qr__username">{username}</p> : null}

        {code ? (
          <span className="profile-qr__code" aria-label="QR code">
            <canvas
              ref={canvasRef}
              className="profile-qr__canvas"
              width={QR_WIDTH}
              height={QR_WIDTH}
              aria-hidden="true"
            />
            {!drawn ? <span className="profile-qr__loading">Drawing the code…</span> : null}
          </span>
        ) : (
          <span className="profile-qr__statebox">
            {busy === "mint" ? (
              <span className="profile-qr__loading">Creating your code…</span>
            ) : null}
            {error ? <span className="profile-qr__error">{error}</span> : null}
            {!busy && !error && !self ? (
              <span className="profile-qr__error">This person has no QR code yet.</span>
            ) : null}
            {!busy && error && self ? (
              <button type="button" className="text-button" onClick={doReset}>
                Try again
              </button>
            ) : null}
          </span>
        )}

        {code ? (
          <div className="profile-qr__actions" aria-label="QR actions">
            <button type="button" className="profile-qr__action" onClick={() => void copyLink()}>
              <span className="profile-qr__action-icon" aria-hidden="true">
                <Icon name="copy" size={18} />
              </span>
              <span>{copyState === "copied" ? "Copied" : "Copy link"}</span>
            </button>
            <button type="button" className="profile-qr__action" onClick={() => void shareLink()}>
              <span className="profile-qr__action-icon" aria-hidden="true">
                <Icon name="share" size={18} />
              </span>
              <span>Share</span>
            </button>
            {self ? (
              <button
                type="button"
                className="profile-qr__action"
                disabled={busy === "reset"}
                onClick={() => void doReset()}
              >
                <span className="profile-qr__action-icon" aria-hidden="true">
                  <Icon name="refresh" size={18} />
                </span>
                <span>{busy === "reset" ? "Resetting…" : "Reset code"}</span>
              </button>
            ) : null}
          </div>
        ) : null}

        {notice ? (
          <p className="profile-qr__notice" role="status">
            {notice}
          </p>
        ) : null}
        {error && code ? (
          <p className="profile-qr__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

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

/* The code INSIDE the QR keeps its token shape (kuchupuchu://user/<code>) so
 * the in-app scanner resolves it through /api/users/by-qr and a Reset still
 * kills a leaked code. The link you COPY OUT is the pretty handle URL the
 * owner asked for (2026-10-20): https://kuchupuchu.web.app/@handle — Android
 * opens the app straight away (App Links); everyone else sees the web card. */
function qrPayload(code: string): string {
  return `kuchupuchu://user/${code}`;
}

function shareUrl(code: string, username: string): string {
  const handle = username.replace(/^@/, "").trim();
  if (!handle) return `kuchupuchu://user/${code}`;
  return `https://kuchupuchu.web.app/@${handle}`;
}

/* WhatsApp-style: the brand mark floats on a white plate in the middle of the
 * code. Error correction H tolerates the covered modules (~30%), so the plate
 * may carry the logo without sacrificing scan-ability. */
const QR_WIDTH = 512;

async function drawQrWithBadge(canvas: HTMLCanvasElement, payload: string): Promise<void> {
  await QRCode.toCanvas(canvas, payload, {
    errorCorrectionLevel: "H",
    margin: 1,
    width: QR_WIDTH,
    color: { dark: "#0b1324", light: "#ffffff" },
  });
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const plate = QR_WIDTH * 0.15; // plate radius — 30% diam matches the WhatsApp look
  const cx = QR_WIDTH / 2;
  const cy = QR_WIDTH / 2;
  const logo = new Image();
  logo.src = "/logo.png";
  try {
    await logo.decode();
  } catch {
    return; // the QR alone still scans; the badge is decorative
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, plate, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.clip();
  const inner = plate * 1.7; // logo slightly overfills the plate — brand reads crisp
  ctx.drawImage(logo, cx - inner / 2, cy - inner / 2, inner, inner);
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
      void drawQrWithBadge(canvas, qrPayload(code))
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
  }, [code]);

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
            <img className="avatar-img" src={avatar} alt="" draggable={false} />
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

import { useEffect, useState } from "react";
import { externalApiOrigin } from "../api";

const APK_URL = "/download/apk";
/* Every hard reference to the static logo carries the version query so a
 * stale service-worker precache can never hand back the previous branding
 * (owner 2026-10-21: "logo ekhono shob jaigay old ta keno?"). */
export const LOGO_SRC = "/logo.png?v=3.9.216";

type CardUser = {
  displayName?: string;
  username?: string;
  verified?: boolean;
  moderator?: boolean;
  avatarUrl?: string | null;
};

/* Four fetch outcomes, kept apart so a SLOW lookup never paints the invalid
 * state on top of a slower-but-valid one, and a failed/offline lookup never
 * shows the invalid view for a perfectly good handle (owner round 120,
 * 2026-10-21: "invalid username hole invalid-URL dekhabeto"). Only a REAL
 * API "user: null" verdict flips the page to the invalid view. */
type CardState = "loading" | "unknown" | "invalid" | "user";

/** The shared profile link (https://kuchupuchu.web.app/@handle) in a browser:
 * equivalent to WhatsApp's wa.me landing — a card that shows THE USER's photo
 * and name (owner 2026-10-21: "app er logo er jaigai oi user er profile
 * picture dekhabe"), and hands the visitor to the Android app when it is
 * installed and to the download when it is not, instead of a bare 404. The
 * card lookup is the public /api/users/card route: photo only when the owner
 * left avatar privacy at "everyone"; the logo stays as the fallback. */
export function UserLinkPage({ handle }: { handle: string }) {
  const path = `/@${handle}`;
  // Android: ask the system to hand this very URL to the app. With App Links
  // verified the OS would already have done this before the page even loaded;
  // the intent URL is the manual fallback (older Chrome / in-app browsers).
  // Owner round 120: end the silent dead-end when the app is NOT installed —
  // carry S.browser_fallback_url so Chrome walks to the app download instead
  // of mutely closing the tap.
  const appUrl =
    `intent://kuchupuchu.web.app${encodeURI(path)}#Intent;scheme=https;` +
    `package=app.kuchupuchu.android;S.browser_fallback_url=${encodeURIComponent(
      "https://kuchupuchu.web.app/download/apk",
    )};end`;

  const [card, setCard] = useState<CardUser | null>(null);
  const [state, setState] = useState<CardState>("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    fetch(`${externalApiOrigin()}/api/users/card/${encodeURIComponent(handle)}`)
      .then(async (res) => {
        if (cancelled) return;
        // Not-ok (offline preview, proxy hiccup, 5xx): fall back to the
        // generic card — only a parsed 200 with user:null proves "invalid".
        if (!res.ok) {
          setCard(null);
          setState("unknown");
          return;
        }
        const body = (await res.json().catch(() => null)) as { user?: CardUser | null } | null;
        if (cancelled) return;
        // A malformed/unparseable body is indistinguishable from an API
        // blip: stay generic, never cry invalid on it.
        if (!body || typeof body !== "object") {
          setCard(null);
          setState("unknown");
          return;
        }
        const user = body.user ?? null;
        setCard(user);
        setState(user ? "user" : "invalid");
      })
      .catch(() => {
        if (!cancelled) {
          setCard(null);
          setState("unknown");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  useEffect(() => {
    const name = card?.displayName?.trim();
    document.title =
      state === "invalid"
        ? "This link isn't a KuchuPuchu profile"
        : name
          ? `${name} (@${handle}) — KuchuPuchu`
          : `KuchuPuchu — @${handle}`;
    return () => {
      document.title = "KuchuPuchu";
    };
  }, [handle, card, state]);

  const displayName = card?.displayName?.trim() || "";

  if (state === "invalid") {
    return (
      <div className="user-link-page">
        <main className="user-link-card" aria-labelledby="user-link-title">
          <img
            className="user-link-logo"
            src={LOGO_SRC}
            alt="KuchuPuchu logo"
            width={72}
            height={72}
          />
          <h1 id="user-link-title">This link doesn&rsquo;t go anywhere</h1>
          <p className="user-link-sub user-link-sub--sentence">
            No KuchuPuchu user exists as &ldquo;@{handle}&rdquo; — the URL may be mistyped.
          </p>
          <div className="user-link-alt">
            <a href="/">Open KuchuPuchu Web</a>
            <span aria-hidden="true">·</span>
            <a href={APK_URL}>Download the app (Android)</a>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="user-link-page">
      <main className="user-link-card" aria-labelledby="user-link-title">
        {card?.avatarUrl ? (
          <img
            className="user-link-avatar"
            src={card.avatarUrl}
            alt={`${displayName || handle}'s photo`}
            width={96}
            height={96}
          />
        ) : (
          <img
            className="user-link-logo"
            src={LOGO_SRC}
            alt="KuchuPuchu logo"
            width={72}
            height={72}
          />
        )}
        <h1 id="user-link-title">
          {displayName || `@${handle}`}
          {/* Owner round 120 (2026-10-21: "verified account hole verified tick
              thakbeto") — the same blue badge the app draws next to the same
              account's name. */}
          {card?.verified ? (
            <svg
              className="user-link-tick"
              viewBox="0 0 24 24"
              width={20}
              height={20}
              aria-label="Verified"
              role="img"
            >
              <circle cx="12" cy="12" r="10" fill="#3b82f6" />
              <path
                d="M7 12.5l3.2 3.2L17.3 9"
                fill="none"
                stroke="#fff"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
        </h1>
        {displayName ? <p className="user-link-sub">@{handle}</p> : null}
        <p className="user-link-sub">KuchuPuchu contact</p>
        <a className="user-link-cta" href={appUrl}>
          Open in the KuchuPuchu app
        </a>
        <div className="user-link-alt">
          <a href={APK_URL}>Download the app (Android)</a>
          <span aria-hidden="true">·</span>
          <a href="/">Open KuchuPuchu Web</a>
        </div>
      </main>
    </div>
  );
}

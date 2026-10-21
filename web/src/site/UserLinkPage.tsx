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
  const appUrl = `intent://kuchupuchu.web.app${encodeURI(path)}#Intent;scheme=https;package=app.kuchupuchu.android;end`;

  const [card, setCard] = useState<CardUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${externalApiOrigin()}/api/users/card/${encodeURIComponent(handle)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled) setCard((body as { user?: CardUser | null } | null)?.user ?? null);
      })
      .catch(() => {
        if (!cancelled) setCard(null);
      });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  useEffect(() => {
    const name = card?.displayName?.trim();
    document.title = name ? `${name} (@${handle}) — KuchuPuchu` : `KuchuPuchu — @${handle}`;
    return () => {
      document.title = "KuchuPuchu";
    };
  }, [handle, card]);

  const displayName = card?.displayName?.trim() || "";

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
        <h1 id="user-link-title">{displayName || `@${handle}`}</h1>
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

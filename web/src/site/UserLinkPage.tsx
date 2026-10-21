import { useEffect } from "react";

const APK_URL = "/download/apk";

/** The shared profile link (https://kuchupuchu.web.app/@handle) in a browser:
 * equivalent to WhatsApp's wa.me landing — a branded card that hands the
 * visitor to the Android app when it is installed and to the download when it
 * is not, instead of a bare 404. Signed-in owners of the handle still get the
 * normal app below this page only when they navigate away. */
export function UserLinkPage({ handle }: { handle: string }) {
  const path = `/@${handle}`;
  // Android: ask the system to hand this very URL to the app. With App Links
  // verified the OS would already have done this before the page even loaded;
  // the intent URL is the manual fallback (older Chrome / in-app browsers).
  const appUrl = `intent://kuchupuchu.web.app${encodeURI(path)}#Intent;scheme=https;package=app.kuchupuchu.android;end`;

  useEffect(() => {
    document.title = `KuchuPuchu — @${handle}`;
    return () => {
      document.title = "KuchuPuchu";
    };
  }, [handle]);

  return (
    <div className="user-link-page">
      <main className="user-link-card" aria-labelledby="user-link-title">
        <img
          className="user-link-logo"
          src="/logo.png"
          alt="KuchuPuchu logo"
          width={72}
          height={72}
        />
        <h1 id="user-link-title">@{handle}</h1>
        <p className="user-link-sub">KuchuPuchu contact</p>
        <p className="user-link-body">
          This is a KuchuPuchu share link. Open the app to add and chat with @{handle} — sealed
          chats, calls and status in one place.
        </p>
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

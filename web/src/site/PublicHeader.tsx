import { RouteLink } from "../RouteLink";
import { type SitePageId } from "../router";
import type { Navigate } from "../useBrowserRouter";

export const HEADER_PAGES: readonly SitePageId[] = [
  "features",
  "encryption",
  "privacy",
  "data",
  "terms",
];

export const SITE_PAGE_LABELS: Record<SitePageId, string> = {
  features: "Features",
  encryption: "Encryption",
  architecture: "Architecture",
  faq: "FAQ",
  privacy: "Privacy",
  data: "Data",
  terms: "Terms",
};

type PublicHeaderProps = {
  navigate?: Navigate;
  onSignIn: () => void;
  onHome?: () => void;
  active: "welcome" | SitePageId;
};

export function PublicHeader({ navigate, onSignIn, onHome, active }: PublicHeaderProps) {
  const brand = (
    <>
      <img src="/logo.png" alt="KuchuPuchu logo" />
      <span>KuchuPuchu</span>
    </>
  );

  return (
    <header className="kp-welcome__top">
      <div className="kp-welcome__top-bar">
        {navigate ? (
          <RouteLink
            route={{ kind: "section", section: "chats" }}
            navigate={navigate}
            className="kp-welcome__brand kp-welcome__brand--link"
          >
            {brand}
          </RouteLink>
        ) : onHome ? (
          <button
            type="button"
            className="kp-welcome__brand kp-welcome__brand--button"
            onClick={onHome}
          >
            {brand}
          </button>
        ) : (
          <span className="kp-welcome__brand">{brand}</span>
        )}
        <button type="button" className="kp-welcome__signin" onClick={onSignIn}>
          Sign in
        </button>
      </div>

      <nav className="kp-welcome__nav" aria-label="Site pages">
        {navigate ? (
          <>
            <RouteLink
              route={{ kind: "section", section: "chats" }}
              navigate={navigate}
              className={`kp-welcome__page-tab${active === "welcome" ? " is-active" : ""}`}
              aria-current={active === "welcome" ? "page" : undefined}
            >
              Overview
            </RouteLink>
            {HEADER_PAGES.map((page) => (
              <RouteLink
                key={page}
                route={{ kind: "site", page }}
                navigate={navigate}
                className={`kp-welcome__page-tab${active === page ? " is-active" : ""}`}
                aria-current={active === page ? "page" : undefined}
              >
                {SITE_PAGE_LABELS[page]}
              </RouteLink>
            ))}
          </>
        ) : (
          <>
            <a
              href="/chats"
              className={`kp-welcome__page-tab${active === "welcome" ? " is-active" : ""}`}
            >
              Overview
            </a>
            {HEADER_PAGES.map((page) => (
              <a
                key={page}
                href={`/${page}`}
                className={`kp-welcome__page-tab${active === page ? " is-active" : ""}`}
              >
                {SITE_PAGE_LABELS[page]}
              </a>
            ))}
          </>
        )}
      </nav>
    </header>
  );
}

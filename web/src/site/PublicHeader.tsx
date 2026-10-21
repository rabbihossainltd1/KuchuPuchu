import { RouteLink } from "../RouteLink";
import { useIsMobileViewport } from "../auth/WelcomePage";
import type { SitePageId } from "../router";
import type { Navigate } from "../useBrowserRouter";

const APK_URL = "/download/apk";

export const SITE_PAGE_LABELS: Record<SitePageId, string> = {
  features: "Features",
  encryption: "Encryption",
  architecture: "Architecture",
  faq: "FAQ",
  privacy: "Privacy",
  data: "Data",
  terms: "Terms",
};

/** Product & technical tabs shown in the top navigation bar (no legal notices here). */
export const HEADER_PAGES: readonly SitePageId[] = [
  "features",
  "encryption",
  "architecture",
  "faq",
];

/** Legal pages stay exclusively in the footer. */
export const LEGAL_PAGES: readonly SitePageId[] = ["privacy", "data", "terms"];

type PublicHeaderProps = {
  active: "welcome" | SitePageId;
  navigate?: Navigate;
  onSignIn?: () => void;
  onHome?: () => void;
};

export function PublicHeader({ active, navigate, onSignIn, onHome }: PublicHeaderProps) {
  const isMobile = useIsMobileViewport();

  return (
    <header className="kp-welcome__top">
      <div className="kp-welcome__top-bar">
        {navigate ? (
          <RouteLink
            route={{ kind: "home" }}
            navigate={navigate}
            className="kp-welcome__brand"
            aria-label="KuchuPuchu Home"
          >
            <img src="/logo.png?v=3.9.216" alt="KuchuPuchu logo" />
            <span>KuchuPuchu</span>
          </RouteLink>
        ) : onHome ? (
          <button
            type="button"
            className="kp-welcome__brand kp-welcome__brand--button"
            onClick={onHome}
          >
            <img src="/logo.png?v=3.9.216" alt="KuchuPuchu logo" />
            <span>KuchuPuchu</span>
          </button>
        ) : (
          <a className="kp-welcome__brand" href="/">
            <img src="/logo.png?v=3.9.216" alt="KuchuPuchu logo" />
            <span>KuchuPuchu</span>
          </a>
        )}

        {!isMobile && onSignIn ? (
          <button type="button" className="kp-welcome__signin kp-desktop-only" onClick={onSignIn}>
            Sign in
          </button>
        ) : (
          <a className="kp-welcome__apk-top" href={APK_URL}>
            Get APK
          </a>
        )}
      </div>

      <nav className="kp-welcome__nav" aria-label="Site pages">
        {navigate ? (
          <RouteLink
            route={{ kind: "home" }}
            navigate={navigate}
            className={`kp-welcome__page-tab${active === "welcome" ? " is-active" : ""}`}
            aria-current={active === "welcome" ? "page" : undefined}
          >
            Overview
          </RouteLink>
        ) : (
          <a
            href="/"
            className={`kp-welcome__page-tab${active === "welcome" ? " is-active" : ""}`}
            aria-current={active === "welcome" ? "page" : undefined}
          >
            Overview
          </a>
        )}
        {HEADER_PAGES.map((page) =>
          navigate ? (
            <RouteLink
              key={page}
              route={{ kind: "site", page }}
              navigate={navigate}
              className={`kp-welcome__page-tab${active === page ? " is-active" : ""}`}
              aria-current={active === page ? "page" : undefined}
            >
              {SITE_PAGE_LABELS[page]}
            </RouteLink>
          ) : (
            <a
              key={page}
              href={`/${page}`}
              className={`kp-welcome__page-tab${active === page ? " is-active" : ""}`}
              aria-current={active === page ? "page" : undefined}
            >
              {SITE_PAGE_LABELS[page]}
            </a>
          ),
        )}
      </nav>
    </header>
  );
}

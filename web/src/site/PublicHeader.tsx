import { RouteLink } from "../RouteLink";
import { SITE_PAGES, type SitePageId } from "../router";
import type { Navigate } from "../useBrowserRouter";

/**
 * Owner (2026-10-13): the landing page and the five static pages all share one
 * header, so the policy pages feel like the same site instead of a detour.
 */

export const SITE_PAGE_LABELS: Record<SitePageId, string> = {
  features: "Features",
  encryption: "Encryption",
  privacy: "Privacy",
  data: "Data",
  terms: "Terms",
};

type PublicHeaderProps = {
  readonly navigate: Navigate;
  readonly onSignIn: () => void;
  /** Present when the brand should lead back to the landing page. */
  readonly onHome?: () => void;
  readonly active?: "welcome" | SitePageId;
};

export function PublicHeader({ navigate, onSignIn, onHome, active }: PublicHeaderProps) {
  const brand = (
    <>
      <img src="/logo.png" alt="KuchuPuchu logo" />
      KuchuPuchu
    </>
  );

  return (
    <header className="kp-welcome__top">
      {onHome ? (
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
      <nav className="kp-welcome__nav" aria-label="Page sections">
        <RouteLink
          route={{ kind: "section", section: "chats" }}
          navigate={navigate}
          className={active === "welcome" ? "is-active" : undefined}
          aria-current={active === "welcome" ? "page" : undefined}
        >
          Overview
        </RouteLink>
        {SITE_PAGES.map((page) => (
          <RouteLink
            key={page}
            route={{ kind: "site", page }}
            navigate={navigate}
            className={active === page ? "is-active" : undefined}
            aria-current={active === page ? "page" : undefined}
          >
            {SITE_PAGE_LABELS[page]}
          </RouteLink>
        ))}
      </nav>
      <button type="button" className="kp-welcome__signin" onClick={onSignIn}>
        Sign in
      </button>
    </header>
  );
}

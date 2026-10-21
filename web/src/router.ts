export const SECTIONS = [
  "chats",
  "statuses",
  "calls",
  "classroom",
  "search",
  "contacts",
  "newcontact",
  "account",
] as const;

export type SectionId = (typeof SECTIONS)[number];

/* Owner (2026-10-13): the landing page's policy and overview sections are real,
 * separate static pages now (/features, /encryption, /architecture, /faq,
 * /privacy, /data, /terms) instead of one endless scroll with #anchors or fake
 * in-page state — each has its own URL that can be shared or linked directly. */
export const SITE_PAGES = [
  "features",
  "encryption",
  "architecture",
  "faq",
  "privacy",
  "data",
  "terms",
] as const;

export type SitePageId = (typeof SITE_PAGES)[number];

export type AppRoute =
  | { kind: "home" }
  | { kind: "section"; section: SectionId }
  | { kind: "conversation"; conversationId: string }
  | { kind: "site"; page: SitePageId }
  | { kind: "user-link"; handle: string }
  | { kind: "not-found" };

export type NavigableRoute = Exclude<AppRoute, { kind: "not-found" }>;

const sectionSet = new Set<string>(SECTIONS);
const sitePageSet = new Set<string>(SITE_PAGES);
const invalidSegmentCharacters = /[\\/?#\u0000-\u001f\u007f]/;

function decodeSegment(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment);
    if (
      decoded.length === 0 ||
      decoded.trim().length === 0 ||
      decoded === "." ||
      decoded === ".." ||
      invalidSegmentCharacters.test(decoded)
    ) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

/** Parse only app route paths; query strings are deliberately not route state. */
export function parseRoute(pathname: string): AppRoute {
  if (!pathname.startsWith("/")) return { kind: "not-found" };

  const segments = pathname.slice(1).split("/");
  while (segments.at(-1) === "") segments.pop();
  if (segments.some((segment) => segment.length === 0)) return { kind: "not-found" };
  if (segments.length === 0) return { kind: "home" };

  const rawSection = decodeSegment(segments[0]!);
  if (!rawSection) return { kind: "not-found" };

  /* Owner (2026-10-20): the shared profile code / link is
   * https://kuchupuchu.web.app/@handle — one segment beginning with "@", same
   * shape as the handle QrScreen and the QR dialog copy out. Android App Links
   * hand this URL to the app straight away; here it renders the public
   * open-the-app landing instead of a 404. */
  if (segments.length === 1 && rawSection.startsWith("@")) {
    const handle = rawSection.slice(1);
    // KuchuPuchu handles are lowercase slugs (login gates them to ^[a-z0-9_]{3,20};
    // a little slack kept for legacy rows).
    if (/^[a-z0-9_]{3,30}$/.test(handle)) return { kind: "user-link", handle };
    return { kind: "not-found" };
  }

  const section = rawSection.toLowerCase();

  if (segments.length === 1 && sectionSet.has(section)) {
    return { kind: "section", section: section as SectionId };
  }

  // The public static pages resolve before the app sections so their URLs are
  // plain, shareable paths with no anchors.
  if (segments.length === 1 && sitePageSet.has(section)) {
    return { kind: "site", page: section as SitePageId };
  }

  if (section === "chats" && segments.length === 2) {
    const conversationId = decodeSegment(segments[1]!);
    if (conversationId) return { kind: "conversation", conversationId };
  }

  return { kind: "not-found" };
}

/** Account and conversation URLs never expose private data before a valid session. */
export function routeRequiresAuthentication(route: AppRoute): boolean {
  return (
    route.kind === "conversation" ||
    (route.kind === "section" && (route.section === "account" || route.section === "classroom"))
  );
}

/** Build a canonical same-origin path. Route IDs are opaque path segments. */
export function pathForRoute(route: NavigableRoute): string {
  if (route.kind === "home") return "/";
  if (route.kind === "section") return `/${route.section}`;
  if (route.kind === "site") return `/${route.page}`;
  if (route.kind === "user-link") return `/@${route.handle}`;
  return `/chats/${encodeURIComponent(route.conversationId)}`;
}

/** Unknown paths stay intact so a 404 view does not disguise the requested URL. */
export function canonicalPath(pathname: string): string | null {
  const route = parseRoute(pathname);
  return route.kind === "not-found" ? null : pathForRoute(route);
}

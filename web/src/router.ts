export const SECTIONS = ["chats", "statuses", "calls", "search"] as const;

export type SectionId = (typeof SECTIONS)[number];

export type AppRoute =
  | { kind: "section"; section: SectionId }
  | { kind: "conversation"; conversationId: string }
  | { kind: "not-found" };

export type NavigableRoute = Exclude<AppRoute, { kind: "not-found" }>;

const sectionSet = new Set<string>(SECTIONS);
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
  if (segments.length === 0) return { kind: "section", section: "chats" };

  const rawSection = decodeSegment(segments[0]!);
  if (!rawSection) return { kind: "not-found" };
  const section = rawSection.toLowerCase();

  if (segments.length === 1 && sectionSet.has(section)) {
    return { kind: "section", section: section as SectionId };
  }

  if (section === "chats" && segments.length === 2) {
    const conversationId = decodeSegment(segments[1]!);
    if (conversationId) return { kind: "conversation", conversationId };
  }

  return { kind: "not-found" };
}

/** Build a canonical same-origin path. Route IDs are opaque path segments. */
export function pathForRoute(route: NavigableRoute): string {
  if (route.kind === "section") return `/${route.section}`;
  return `/chats/${encodeURIComponent(route.conversationId)}`;
}

/** Unknown paths stay intact so a 404 view does not disguise the requested URL. */
export function canonicalPath(pathname: string): string | null {
  const route = parseRoute(pathname);
  return route.kind === "not-found" ? null : pathForRoute(route);
}

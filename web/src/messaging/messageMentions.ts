/** Composer mention suggestions for usernames the Worker recognizes in group alerts. */

export type MentionCandidate = {
  readonly id: string;
  readonly displayName: string;
  readonly username: string;
};

export type MentionQuery = {
  readonly start: number;
  readonly cursor: number;
  readonly query: string;
};

/** Find the active @token immediately before the caret; email addresses are ignored. */
export function activeMentionQuery(value: string, cursor = value.length): MentionQuery | null {
  const end = Math.max(0, Math.min(value.length, cursor));
  const before = value.slice(0, end);
  const match = /(^|[^A-Za-z0-9_])@([A-Za-z0-9_]{0,30})$/.exec(before);
  if (!match) return null;
  const query = match[2] ?? "";
  return { start: end - query.length - 1, cursor: end, query };
}

/** Match usernames by prefix and display names by substring, then cap the menu. */
export function matchingMentionCandidates(
  query: string,
  candidates: readonly MentionCandidate[],
  limit = 6,
): MentionCandidate[] {
  const needle = query.trim().toLocaleLowerCase();
  const seen = new Set<string>();
  return candidates
    .filter((candidate) => {
      const username = candidate.username.trim().replace(/^@/, "");
      const id = candidate.id.trim();
      if (!id || !/^[A-Za-z0-9_]{3,30}$/.test(username) || seen.has(username.toLowerCase())) {
        return false;
      }
      const matches =
        !needle ||
        username.toLocaleLowerCase().startsWith(needle) ||
        candidate.displayName.toLocaleLowerCase().includes(needle);
      if (matches) seen.add(username.toLowerCase());
      return matches;
    })
    .slice(0, Math.max(0, limit));
}

/** Replace the active mention token with the chosen username and a trailing space. */
export function insertMention(
  value: string,
  username: string,
  cursor = value.length,
): { readonly value: string; readonly cursor: number } | null {
  const query = activeMentionQuery(value, cursor);
  const cleanUsername = username.trim().replace(/^@/, "");
  if (!query || !/^[A-Za-z0-9_]{3,30}$/.test(cleanUsername)) return null;
  const inserted = `@${cleanUsername} `;
  const next = value.slice(0, query.start) + inserted + value.slice(query.cursor);
  return { value: next, cursor: query.start + inserted.length };
}

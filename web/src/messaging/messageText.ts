/** Plain-text rendering rules shared by message bubbles, quotes and contract tests. */

export type MessageTextPart = {
  readonly text: string;
  readonly bold: boolean;
  /** Present when this is a clickable @username in any conversation. */
  readonly mention?: string;
};

type Range = { start: number; end: number };
type MentionRange = Range & { username: string };

const BOLD_MARKERS = /\*{1,2}([^*\n]+?)\*{1,2}/g;
const USERNAME_MENTION = /(^|[^A-Za-z0-9_])@([A-Za-z0-9_]{3,30})(?![A-Za-z0-9_])/g;
const URL_TOKEN = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;

function urlRangesIn(value: string): Range[] {
  const ranges: Range[] = [];
  URL_TOKEN.lastIndex = 0;
  for (const match of value.matchAll(URL_TOKEN)) {
    const raw = match[0] ?? "";
    const start = match.index ?? 0;
    let length = raw.length;
    while (length > 0 && ".,;:!?".includes(raw[length - 1]!)) length -= 1;
    const candidate = raw.slice(0, length);
    if (
      candidate.endsWith(")") &&
      (candidate.match(/\(/g)?.length ?? 0) < (candidate.match(/\)/g)?.length ?? 0)
    ) {
      length -= 1;
    }
    if (length > 0) ranges.push({ start, end: start + length });
  }
  return ranges;
}

function stripBoldWithRanges(value: string): { text: string; bold: Range[] } {
  let text = "";
  let cursor = 0;
  const bold: Range[] = [];
  BOLD_MARKERS.lastIndex = 0;
  for (const match of value.matchAll(BOLD_MARKERS)) {
    const index = match.index ?? 0;
    text += value.slice(cursor, index);
    const content = match[1] ?? match[2] ?? "";
    const start = text.length;
    text += content;
    bold.push({ start, end: text.length });
    cursor = index + match[0].length;
  }
  text += value.slice(cursor);
  return { text, bold };
}

/** Strip only the supported single- and double-asterisk bold delimiters. */
export function stripBoldMarkers(value: string): string {
  return stripBoldWithRanges(value).text;
}

/**
 * Turn bold markup into visible spans and optionally identify @usernames. The
 * mention span excludes punctuation; email-like text and URL paths are not mentions.
 */
export function parseMessageText(value: string, clickableMentions = false): MessageTextPart[] {
  const { text, bold } = stripBoldWithRanges(value);
  if (!text) return [];

  const mentions: MentionRange[] = [];
  if (clickableMentions) {
    const urls = urlRangesIn(text);
    USERNAME_MENTION.lastIndex = 0;
    for (const match of text.matchAll(USERNAME_MENTION)) {
      const prefix = match[1] ?? "";
      const username = match[2] ?? "";
      const start = (match.index ?? 0) + prefix.length;
      const end = start + username.length + 1;
      if (urls.some((range) => start < range.end && end > range.start)) continue;
      mentions.push({ start, end, username });
    }
  }

  const boundaries = new Set<number>([0, text.length]);
  for (const range of [...bold, ...mentions]) {
    boundaries.add(range.start);
    boundaries.add(range.end);
  }
  const points = [...boundaries].sort((a, b) => a - b);
  const parts: MessageTextPart[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]!;
    const end = points[i + 1]!;
    if (start === end) continue;
    const partText = text.slice(start, end);
    const isBold = bold.some((range) => range.start <= start && range.end >= end);
    const mention = mentions.find((range) => range.start <= start && range.end >= end);
    const previous = parts.at(-1);
    if (previous && previous.bold === isBold && previous.mention === mention?.username) {
      parts[parts.length - 1] = { ...previous, text: previous.text + partText };
    } else {
      parts.push({
        text: partText,
        bold: isBold,
        ...(mention ? { mention: mention.username } : {}),
      });
    }
  }
  return parts;
}

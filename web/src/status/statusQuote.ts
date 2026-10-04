/**
 * The status quote a chat bubble draws, kept in its own tiny module.
 *
 * `protocol.ts` parses `meta.status` into one of these, and `mediaUrl.ts`
 * resolves a quote's thumbnail — both live in the messaging chunk, so this file
 * deliberately carries nothing else: no copy catalog, no viewer maths, no
 * imports beyond the type. A reply to a status must not make the chat bundle
 * pay for the whole status feature.
 */

export type StatusQuote = {
  readonly id: string;
  readonly kind: "TEXT" | "IMAGE" | "VIDEO";
  readonly text: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The Worker's `statusQuote`: `{id, kind, text}` with the text cut at 80. */
export function parseStatusQuote(value: unknown): StatusQuote | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id.slice(0, 64) : "";
  if (!id) return null;
  const rawKind = typeof value.kind === "string" ? value.kind.toUpperCase() : "";
  const kind = rawKind === "IMAGE" || rawKind === "VIDEO" ? rawKind : "TEXT";
  const text = typeof value.text === "string" ? value.text.slice(0, 80) : "";
  return { id, kind, text };
}

/** The quote's second line: the caption, or the kind's word, cut at 64. */
export function statusQuoteCaption(quote: StatusQuote): string {
  if (quote.text.trim()) return quote.text.slice(0, 64);
  if (quote.kind === "VIDEO") return "Video";
  if (quote.kind === "IMAGE") return "Photo";
  return "Status";
}

/** A photo or video status quotes with a thumbnail; a text one does not. */
export function statusQuoteHasThumb(quote: StatusQuote): boolean {
  return quote.kind === "IMAGE" || quote.kind === "VIDEO";
}

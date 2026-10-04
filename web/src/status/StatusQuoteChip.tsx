import type { ApiClient } from "../auth/authApi";
import { Icon } from "../icons";
import { useMediaUrl } from "../messaging/mediaUrl";
import { statusQuoteCaption, statusQuoteHasThumb, type StatusQuote } from "./statusModel";

/**
 * The quote a chat bubble draws when the message answered a status.
 *
 * `StatusQuote` in ChatScreen.kt: a "Status" label, the caption (or the kind's
 * word when a photo or a clip has none — never the word "null"), and a small
 * thumbnail for a picture or a clip. The thumbnail is the same bearer-gated
 * fetch the viewer uses, so it shares that cache: a chat with three replies to
 * one status downloads it once.
 */
export function StatusQuoteChip({
  quote,
  api,
}: {
  readonly quote: StatusQuote;
  readonly api: ApiClient | null;
}) {
  const wantsThumb = statusQuoteHasThumb(quote);
  const media = useMediaUrl(
    api,
    api !== null && wantsThumb,
    wantsThumb ? `status:${quote.id}` : "",
  );
  return (
    <span className="bubble__status-quote">
      <span className="bubble__status-stripe" aria-hidden="true" />
      <span className="bubble__status-copy">
        <strong>Status</strong>
        <span>{statusQuoteCaption(quote)}</span>
      </span>
      {wantsThumb && media.url ? (
        <span className="bubble__status-thumb">
          {quote.kind === "VIDEO" ? (
            // A clip quotes as its first frame with a play mark over it, the
            // way the phone does; the bytes are the clip's own.
            <video
              src={media.url}
              muted
              playsInline
              preload="metadata"
              aria-hidden="true"
              tabIndex={-1}
            />
          ) : (
            <img src={media.url} alt="" />
          )}
          {quote.kind === "VIDEO" ? (
            <span className="bubble__status-play" aria-hidden="true">
              <Icon name="play" size={11} />
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

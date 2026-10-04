/**
 * Static copy and small catalogs for the messaging surfaces.
 *
 * Kept apart from the components so a contract case can assert on them without
 * a DOM, and so wording changes stay reviewable on their own.
 */

import { UNOPENABLE_BODY } from "./e2ee";

/** Shown when an envelope cannot be opened with this device's identity. */
export const LOCKED_BODY_PLACEHOLDER = UNOPENABLE_BODY;

export type QuickReaction = {
  readonly emoji: string;
  readonly label: string;
};

/**
 * The quick-reaction row. The Android sheet offers these plus a full emoji
 * picker; the picker is a later slice, so only what is wired to
 * `POST /api/messages/:id/react` is offered here.
 */
export const QUICK_REACTIONS: readonly QuickReaction[] = Object.freeze([
  { emoji: "\u{1F44D}", label: "thumbs up" },
  { emoji: "\u2764\uFE0F", label: "red heart" },
  { emoji: "\u{1F602}", label: "tears of joy" },
  { emoji: "\u{1F62E}", label: "open mouth" },
  { emoji: "\u{1F622}", label: "crying face" },
  { emoji: "\u{1F64F}", label: "folded hands" },
]);

export const QUICK_REACTION_EMOJI = Object.freeze(QUICK_REACTIONS.map((item) => item.emoji));

/** Copy that must stay truthful about what this slice can and cannot do. */
export const CAPABILITY_COPY = {
  /**
   * Attachments send now; what is still missing is the viewing surface around
   * them. Stating the gap is the point — a thumbnail that cannot be opened
   * full-screen must not look like a finished feature.
   */
  mediaViewerPending:
    "Photos, clips, audio and documents send and display inline. The full-screen viewer with zoom and swipe, the shared-media tab, view-once reveal, voice-note recording and document preview arrive in a later slice.",
  captureWarning:
    "A browser cannot block or detect screenshots or screen recording. Save and forward still follow the sender's consent.",
  draftsNotDurable:
    "This browser has no usable IndexedDB, so drafts and unsent messages live in memory only and are lost on reload.",
  mediaNotEncrypted:
    "Message text in a personal chat is sealed end-to-end. Media bytes are account-controlled, not end-to-end encrypted.",
} as const;

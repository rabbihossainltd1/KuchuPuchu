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
   * What is still missing, stated plainly. The viewer, the shared-media panel,
   * view-once, voice notes, document preview and forwarding are all built now;
   * naming any of them as pending would be as dishonest as hiding the gaps that
   * remain.
   */
  stillPending:
    "Calls, status and push notifications arrive in a later slice. Text, stickers, photos, clips, documents, voice notes, shared media, view once, multi-select and forwarding all work here now.",
  /**
   * Voice recording, in the words the recorder panel shows. A browser has no
   * `MediaRecorder.maxAmplitude`, so the live strip is an analyser window
   * scaled onto the phone's 0…32767 range rather than a claim of parity.
   */
  voiceRecorderNotice:
    "Recorded in this browser's own audio container (webm/opus, or mp4/aac in Safari) and capped at 100 MB. A take under one second is thrown away. Safari cannot pause a recording, so no Pause button is drawn there.",
  /**
   * Document preview. The kinds a browser cannot render are named here and in
   * the reader itself, so nobody discovers the gap by staring at a blank pane.
   */
  documentPreviewNotice:
    "Documents open in a reader: PDFs in your browser's own viewer, text and code as selectable text (the first 400 KB), pictures and clips inline. HTML, SVG and Markdown are shown as source and never rendered, and a TIFF or an archive has no browser reader — those are download-only here.",
  /**
   * Forwarding, including the two rules that make it refuse: the sender's
   * consent and the one-opening nature of a view-once message.
   */
  forwardingNotice:
    "Forwarding copies a message into other chats: a stored file is re-used by its key, a hosted photo is re-uploaded so each chat owns its own copy, and a caption is re-sealed for the new recipient. Nothing leaves a private chat, and a view-once message is one opening — it cannot be forwarded.",
  captureWarning:
    "A browser cannot block or detect screenshots or screen recording. Save and forward still follow the sender's consent.",
  draftsNotDurable:
    "This browser has no usable IndexedDB, so drafts and unsent messages live in memory only and are lost on reload.",
  mediaNotEncrypted:
    "Message text in a personal chat is sealed end-to-end. Media bytes are account-controlled, not end-to-end encrypted.",
} as const;

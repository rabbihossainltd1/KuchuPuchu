/**
 * The chat header's call gate — and nothing else.
 *
 * This is the calls feature's equivalent of `statusQuote.ts` and `statusMedia.ts`
 * in the status slice: the one tiny, DOM-free module the MESSAGING chunk is
 * allowed to import, so drawing two call buttons in a chat header does not drag
 * the call model, the engine or the peer runtime into the messaging bundle.
 *
 * The rule is ChatScreen.kt:3799, transcribed:
 *
 *     if (!isGroup && c != null && !botChat && !requestOpen && !blockWall && !callMuted) {
 *         if (otherId.isNotBlank()) { …voice + video buttons… }
 *     }
 *
 * and, for a group, ChatScreen.kt:3780:
 *
 *     if (isGroup && c != null && !callMuted) { …group voice + video buttons… }
 *
 * The Web draws the 1:1 pair when the gate opens. It draws the group pair
 * DISABLED, with the reason in the label, because a group call is a mesh the Web
 * does not run yet (no measured participant cap — see `callsModel.ts`), and a
 * button that silently did nothing is worse than one that says why. r69 is the
 * reason `callMuted` removes the buttons entirely rather than dimming them: "mute
 * korle chat screen a ekhon kichui dekhai na".
 */

export type CallPlacement = {
  readonly isGroup: boolean;
  readonly botChat: boolean;
  readonly requestOpen: boolean;
  readonly blockWall: boolean;
  readonly callMuted: boolean;
  readonly peerId: string;
  readonly callsEnabled: boolean;
};

export type CallPlacementVerdict = {
  readonly show: boolean;
  readonly group: boolean;
  /** Empty when the buttons are live; otherwise why they are absent or disabled. */
  readonly reason: string;
};

export const CALL_GATE_REASONS = {
  flagOff: "flag-off",
  groupUnsupported: "group-unsupported",
  bot: "bot",
  request: "request",
  blocked: "blocked",
  muted: "muted",
  noPeer: "no-peer",
} as const;

export function callPlacement(placement: CallPlacement): CallPlacementVerdict {
  if (!placement.callsEnabled) {
    return { show: false, group: placement.isGroup, reason: CALL_GATE_REASONS.flagOff };
  }
  if (placement.isGroup) {
    // A call-muted group shows nothing at all, exactly like a muted 1:1.
    if (placement.callMuted) {
      return { show: false, group: true, reason: CALL_GATE_REASONS.muted };
    }
    return { show: true, group: true, reason: CALL_GATE_REASONS.groupUnsupported };
  }
  if (placement.botChat) return { show: false, group: false, reason: CALL_GATE_REASONS.bot };
  if (placement.requestOpen)
    return { show: false, group: false, reason: CALL_GATE_REASONS.request };
  if (placement.blockWall) return { show: false, group: false, reason: CALL_GATE_REASONS.blocked };
  if (placement.callMuted) return { show: false, group: false, reason: CALL_GATE_REASONS.muted };
  if (!placement.peerId) return { show: false, group: false, reason: CALL_GATE_REASONS.noPeer };
  return { show: true, group: false, reason: "" };
}

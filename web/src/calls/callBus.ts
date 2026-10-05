/**
 * The bridge between a chat header and the call engine.
 *
 * The engine lives in the calls chunk (lazy, flag-gated) and the chat header
 * lives in the messaging chunk. A direct import would pull the WebRTC engine,
 * the peer runtime and the call CSS into the messaging bundle — the exact
 * coupling the status slice avoided by exposing only `statusQuote.ts` and
 * `statusMedia.ts`. So this module is the whole contract: two functions and a
 * type, no engine, no DOM.
 *
 * The calls layer registers its launcher when it mounts and clears it when it
 * unmounts, so a chat rendered without the calls flag (or before the layer is
 * up) gets `false` from `launchCall` and shows nothing rather than a button that
 * silently does nothing.
 */

import type { CallKind } from "./callsModel";

export type CallLaunchTarget = {
  readonly id: string;
  readonly name: string;
  readonly avatar?: string;
  readonly online?: boolean;
};

export type CallLauncher = (target: CallLaunchTarget, kind: CallKind) => void;

let launcher: CallLauncher | null = null;

export function registerCallLauncher(next: CallLauncher | null): void {
  launcher = next;
}

/** True when a call engine is mounted and would accept a launch. */
export function callLauncherReady(): boolean {
  return launcher !== null;
}

export function launchCall(target: CallLaunchTarget, kind: CallKind): boolean {
  if (!launcher || !target.id) return false;
  launcher(target, kind);
  return true;
}

/**
 * The Calls tab controller.
 *
 * The rules it copies from `CallsTabScreen.kt`:
 *
 * - The history is CACHED and shown at once; the network is only hit when the
 *   cache is empty or older than 20 s (owner round 13 — refetching on every
 *   visit read as lag).
 * - A call that just ended bumps `callsVersion` on the phone and forces a
 *   refetch, so the new row does not wait for the next visit past the cache
 *   (owner round 33, item 2). Here the engine's teardown is that bump.
 * - Rows are grouped into day sections — Today, Yesterday, weekday inside seven
 *   days, then "5 Oct" — cut in Asia/Dhaka, never in the browser's own zone.
 *
 * Unlike the phone, nothing is filtered out for a hidden chat: this browser has
 * no Hidden screen, and the copy says so instead of quietly dropping rows.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../auth/authApi";
import { apiErrorMessage } from "../api";
import { callsApi } from "./callsApi";
import {
  CALLS_HISTORY_STALE_MS,
  CALL_COPY,
  callHistoryLabel,
  callPeerAvatar,
  callPeerId,
  callPeerName,
  groupCallsByDay,
  listStamp,
  type CallDaySection,
  type CallRow,
} from "./callsModel";

export type CallsHistoryState = "loading" | "ready" | "error";

export type CallsController = {
  readonly rows: readonly CallRow[];
  readonly sections: readonly CallDaySection[];
  readonly state: CallsHistoryState;
  readonly error: string;
  /** Bumped when the list was read from the network, for the live region. */
  readonly loadedAt: number;
  refresh(force?: boolean): Promise<void>;
  /** A call ended elsewhere in the app: drop the cache and re-read at once. */
  invalidate(): void;
  announce(notice: string): void;
  readonly notice: string;
};

type Options = {
  readonly api: ApiClient | null;
  readonly meId: string;
  readonly enabled: boolean;
};

export function useCalls(options: Options): CallsController {
  const { api, meId, enabled } = options;
  const [rows, setRows] = useState<readonly CallRow[]>([]);
  const [state, setState] = useState<CallsHistoryState>("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadedAt, setLoadedAt] = useState(0);
  const [version, setVersion] = useState(0);
  const fetchedAt = useRef(0);
  const fetchedVersion = useRef(0);
  const inFlight = useRef(false);

  const refresh = useCallback(
    async (force = false) => {
      if (!api || !enabled || inFlight.current) return;
      // The phone's cache rule, exactly: a non-forced visit inside 20 s with a
      // non-empty list paints what it has and spends no request.
      const fresh =
        !force &&
        rows.length > 0 &&
        Date.now() - fetchedAt.current < CALLS_HISTORY_STALE_MS &&
        version === fetchedVersion.current;
      if (fresh) {
        setState("ready");
        return;
      }
      inFlight.current = true;
      if (rows.length === 0) setState("loading");
      try {
        const items = await callsApi.history(api);
        setRows(items);
        setError("");
        setState("ready");
        fetchedAt.current = Date.now();
        fetchedVersion.current = version;
        setLoadedAt(Date.now());
      } catch (cause) {
        // A failed read keeps the cached list on screen — the phone swallows the
        // error for the same reason: an empty tab is worse than a stale one.
        setState(rows.length > 0 ? "ready" : "error");
        setError(apiErrorMessage(cause) || CALL_COPY.historyError);
      } finally {
        inFlight.current = false;
      }
    },
    [api, enabled, rows.length, version],
  );

  useEffect(() => {
    if (!enabled) return;
    void refresh(version !== fetchedVersion.current);
  }, [enabled, refresh, version]);

  const invalidate = useCallback(() => {
    fetchedAt.current = 0;
    setVersion((value) => value + 1);
  }, []);

  const announce = useCallback((text: string) => setNotice(text), []);

  const sections = useMemo(() => groupCallsByDay(rows), [rows]);

  return useMemo(
    () => ({
      rows,
      sections,
      state,
      error,
      loadedAt,
      refresh,
      invalidate,
      announce,
      notice,
    }),
    [rows, sections, state, error, loadedAt, refresh, invalidate, announce, notice],
  );
}

/** Everything a history row needs to render, derived once per row. */
export type CallRowView = {
  readonly row: CallRow;
  readonly name: string;
  readonly avatar: string;
  readonly label: string;
  readonly stamp: string;
  readonly missed: boolean;
  readonly incoming: boolean;
  readonly video: boolean;
  readonly peerId: string;
  readonly group: boolean;
};

export function callRowView(row: CallRow, meId: string, nowMs: number = Date.now()): CallRowView {
  return {
    row,
    name: callPeerName(row),
    avatar: callPeerAvatar(row),
    label: callHistoryLabel(row),
    stamp: listStamp(row.createdAt, nowMs),
    missed: row.status === "MISSED" || row.status === "DECLINED",
    incoming: row.incoming,
    video: row.kind === "VIDEO",
    peerId: callPeerId(row, meId),
    group: row.group,
  };
}

export { CALL_COPY };

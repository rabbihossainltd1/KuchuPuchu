/**
 * Managed WebSocket connection for `/ws/user` and `/ws/chat/:id`.
 *
 * The Android client and the production PWA both keep a 20-second heartbeat
 * frame and reconnect after a drop; this reproduces that with a capped
 * exponential backoff. Browsers cannot set WebSocket headers, so the bearer
 * travels as a query parameter — the Worker accepts that on `/ws/*` only, and
 * `test/cases/48-r104-web.mjs` pins that boundary.
 *
 * The socket implementation and the scheduler are injectable so the reconnect
 * and heartbeat behaviour can be driven deterministically from a test.
 */

import { parseSocketFrame, socketUrl, type SocketFrame } from "./protocol";

export type SocketStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export const HEARTBEAT_INTERVAL_MS = 20_000;
export const BASE_RECONNECT_MS = 2_500;
export const MAX_RECONNECT_MS = 30_000;

export type TimerHandle = { cancel(): void };

export type ManagedSocketOptions<TFrame = SocketFrame> = {
  readonly path: string;
  readonly token: string;
  readonly onFrame: (frame: TFrame) => void;
  readonly onStatus?: (status: SocketStatus) => void;
  readonly webSocketImpl?: typeof WebSocket;
  readonly now?: () => number;
  readonly schedule?: (callback: () => void, delayMs: number) => TimerHandle;
  readonly heartbeatMs?: number;
  readonly baseReconnectMs?: number;
  readonly maxReconnectMs?: number;
  /** Called before a reconnect attempt; return false to stop retrying. */
  readonly shouldReconnect?: () => boolean;
  /**
   * How a raw socket frame becomes a typed one. Defaults to the messaging
   * parser; `/ws/call/:id` carries a different frame vocabulary but needs the
   * SAME heartbeat and backoff — the CallSignal Durable Object counts a socket
   * as alive only if it sent a data frame inside its own 45 s window, so a
   * second hand-rolled socket would be a second way to get that wrong.
   */
  readonly parseFrame?: (raw: unknown) => TFrame | null;
};

export type ManagedSocket = {
  status(): SocketStatus;
  send(payload: unknown): boolean;
  close(): void;
};

export function backoffDelayMs(
  attempt: number,
  baseMs: number = BASE_RECONNECT_MS,
  maxMs: number = MAX_RECONNECT_MS,
): number {
  const safe = Math.max(0, Math.trunc(attempt));
  return Math.min(maxMs, baseMs * 2 ** Math.min(safe, 6));
}

function browserScheduler(): (callback: () => void, delayMs: number) => TimerHandle {
  return (callback, delayMs) => {
    const id = window.setTimeout(callback, delayMs);
    return { cancel: () => window.clearTimeout(id) };
  };
}

function browserInterval(callback: () => void, delayMs: number): TimerHandle {
  const id = window.setInterval(callback, delayMs);
  return { cancel: () => window.clearInterval(id) };
}

export function createManagedSocket<TFrame = SocketFrame>(
  options: ManagedSocketOptions<TFrame>,
): ManagedSocket {
  const WebSocketImpl = options.webSocketImpl ?? WebSocket;
  const now = options.now ?? (() => Date.now());
  const schedule = options.schedule ?? browserScheduler();
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_INTERVAL_MS;
  const baseReconnectMs = options.baseReconnectMs ?? BASE_RECONNECT_MS;
  const maxReconnectMs = options.maxReconnectMs ?? MAX_RECONNECT_MS;
  const parseFrame =
    options.parseFrame ?? ((raw: unknown) => parseSocketFrame(raw) as TFrame | null);

  let current: WebSocket | null = null;
  let status: SocketStatus = "idle";
  let attempts = 0;
  let closed = false;
  let heartbeat: TimerHandle | null = null;
  let reconnectTimer: TimerHandle | null = null;

  const publish = (next: SocketStatus) => {
    status = next;
    options.onStatus?.(next);
  };

  const stopHeartbeat = () => {
    heartbeat?.cancel();
    heartbeat = null;
  };

  const startHeartbeat = (socket: WebSocket) => {
    stopHeartbeat();
    heartbeat = browserInterval(() => {
      if (socket.readyState !== 1) {
        stopHeartbeat();
        return;
      }
      try {
        socket.send(JSON.stringify({ type: "hb", at: now() }));
      } catch {
        // A failed heartbeat is reported by the socket's own close event.
      }
    }, heartbeatMs);
  };

  const connect = () => {
    if (closed || !options.token) {
      publish("closed");
      return;
    }

    publish(attempts === 0 ? "connecting" : "reconnecting");
    let socket: WebSocket;
    try {
      socket = new WebSocketImpl(socketUrl(options.path, options.token));
    } catch {
      queueReconnect();
      return;
    }
    current = socket;

    socket.onopen = () => {
      if (current !== socket) return;
      attempts = 0;
      publish("open");
      startHeartbeat(socket);
    };

    socket.onmessage = (event: MessageEvent) => {
      if (current !== socket) return;
      const frame = parseFrame(event.data);
      if (frame) options.onFrame(frame);
    };

    socket.onerror = () => {
      // The close handler owns recovery; an error alone is not a state change.
    };

    socket.onclose = () => {
      if (current !== socket) return;
      current = null;
      stopHeartbeat();
      if (closed) {
        publish("closed");
        return;
      }
      queueReconnect();
    };
  };

  const queueReconnect = () => {
    if (closed) return;
    if (options.shouldReconnect && !options.shouldReconnect()) {
      publish("closed");
      return;
    }
    const delay = backoffDelayMs(attempts, baseReconnectMs, maxReconnectMs);
    attempts += 1;
    publish("reconnecting");
    reconnectTimer?.cancel();
    reconnectTimer = schedule(connect, delay);
  };

  connect();

  return {
    status: () => status,
    send(payload: unknown) {
      if (!current || current.readyState !== 1) return false;
      try {
        current.send(JSON.stringify(payload));
        return true;
      } catch {
        return false;
      }
    },
    close() {
      closed = true;
      reconnectTimer?.cancel();
      reconnectTimer = null;
      stopHeartbeat();
      const socket = current;
      current = null;
      if (socket) {
        try {
          socket.close();
        } catch {
          // Already closing; nothing else to clean up.
        }
      }
      publish("closed");
    },
  };
}

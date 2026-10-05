/**
 * The browser's socket factory for the call engine.
 *
 * It is a thin adapter over messaging's `createManagedSocket`, which is the same
 * 20 s heartbeat and capped backoff the chat sockets use. Reusing it matters:
 * the `CallSignal` Durable Object counts a socket as live only if it sent a data
 * frame inside its own 45 s window (`liveness.ts`), and the worker's
 * `pushToUser` decides between a live relay and a system notification from that
 * count. A hand-rolled socket without the heartbeat would make every call look
 * like a dead process to the server.
 *
 * `/ws/call/:id` sockets are receive-only by design (the DO's own header: the
 * worker writes, participants read), so the only thing this client sends is the
 * heartbeat `createManagedSocket` already sends.
 */

import { createManagedSocket, type SocketStatus } from "../messaging/sockets";
import type { SocketFactory, SocketHandle } from "./callEngine";

export function browserSocketFactory(): SocketFactory {
  return (options) => {
    const socket = createManagedSocket<unknown>({
      path: options.path,
      token: options.token,
      parseFrame: options.parseFrame,
      onFrame: options.onFrame,
      onStatus: (status: SocketStatus) => options.onStatus(status),
    });
    return {
      status: () => socket.status(),
      close: () => socket.close(),
    } satisfies SocketHandle;
  };
}

/**
 * Socket ticket acquisition (plan §7.2).
 *
 * A browser cannot attach headers to a WebSocket handshake, and putting the
 * long-lived session token in the socket URL leaks it into logs and history.
 * Instead the client asks the worker for a 60-second, single-use ticket with
 * its ordinary header-authenticated request, then opens the socket with THAT.
 * Every (re)connect mints a fresh ticket — tickets are one-shot by design.
 */

/** Mint one socket ticket. Throws on any non-success so callers can retry. */
export async function requestWsTicket(
  token: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<string> {
  const res = await fetcher("/api/ws/ticket", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`ticket ${res.status}`);
  const body = (await res.json()) as { ticket?: unknown };
  if (typeof body.ticket !== "string" || !body.ticket) throw new Error("ticket missing");
  return body.ticket;
}

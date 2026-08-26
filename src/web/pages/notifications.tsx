import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, peekCache } from "../lib/api";
import { Avatar, Empty, Spinner } from "../components/ui";
import { type PublicUser } from "../lib/types";
import { timeAgo } from "../lib/time";

type Note = {
  id: string;
  title: string;
  body: string;
  link?: string;
  kind?: string;
  readAt: string | null;
  createdAt: string;
};

type RequestItem = { id: string; createdAt?: string; from: PublicUser };

type Row =
  | { kind: "request"; id: string; createdAt: string; from: PublicUser }
  | { kind: "note"; note: Note }
  | { kind: "more" };

export function NotificationsPage() {
  const [requests, setRequests] = useState<RequestItem[] | null>(
    () => peekCache<{ items: RequestItem[] }>("/api/friend-requests")?.items ?? null,
  );
  const [items, setItems] = useState<Note[]>(
    () => peekCache<{ items: Note[] }>("/api/notifications")?.items ?? [],
  );

  async function load() {
    const [friends, notes] = await Promise.all([
      api<{ items: RequestItem[] }>("/api/friend-requests"),
      api<{ items: Note[] }>("/api/notifications"),
    ]);
    setRequests(friends.items);
    setItems(
      notes.items.filter((item) => {
        const title = (item.title || "").toLowerCase();
        const link = item.link || "";
        if (item.kind === "calls" || item.kind === "messaging") return false;
        if (link.startsWith("/messages/")) return false;
        if (title === "friend request") return false;
        return !title.includes("incoming call") && !title.includes("incoming video");
      }),
    );
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load().catch(() => undefined), 4000);
    return () => window.clearInterval(timer);
  }, []);

  const rows = useMemo(() => {
    const preview = (requests ?? []).slice(0, 3);
    const extra = (requests?.length ?? 0) > 3;
    const merged: Row[] = [
      ...preview.map((item) => ({
        kind: "request" as const,
        id: item.id,
        createdAt: item.createdAt ?? new Date().toISOString(),
        from: item.from,
      })),
      ...items.map((note) => ({ kind: "note" as const, note })),
    ];
    merged.sort((a, b) => {
      const left = a.kind === "note" ? a.note.createdAt : a.kind === "request" ? a.createdAt : "";
      const right = b.kind === "note" ? b.note.createdAt : b.kind === "request" ? b.createdAt : "";
      return right.localeCompare(left);
    });
    if (extra) merged.push({ kind: "more" });
    return merged;
  }, [requests, items]);

  if (!requests) return <Spinner />;

  return (
    <div>
      <div className="topbar">
        <h1 className="page-title">Notifications</h1>
        <button
          className="btn-ghost"
          type="button"
          onClick={() =>
            void api("/api/notifications/read", { method: "POST", body: "{}" }).then(load)
          }
        >
          Mark all read
        </button>
      </div>
      {rows.length === 0 ? (
        <Empty title="No notifications" />
      ) : (
        <div className="grid">
          {rows.map((row) => {
            if (row.kind === "more") {
              return (
                <Link key="more-requests" className="card note-row" to="/requests">
                  <strong>See all friend requests</strong>
                  <p className="meta">{requests.length} pending</p>
                </Link>
              );
            }
            if (row.kind === "request") {
              return (
                <article key={row.id} className="card note-row unread-note">
                  <div className="player-head">
                    <Avatar
                      name={row.from.displayName}
                      url={row.from.avatarUrl}
                      online={row.from.online}
                    />
                    <div style={{ flex: 1 }}>
                      <strong>{row.from.displayName} sent you a friend request</strong>
                      <p className="meta">
                        @{row.from.username} · {timeAgo(row.createdAt)}
                      </p>
                      <div className="row" style={{ marginTop: 8 }}>
                        <button
                          className="btn"
                          type="button"
                          onClick={() => {
                            setRequests((current) =>
                              (current ?? []).filter((item) => item.id !== row.id),
                            );
                            void api(`/api/friend-requests/${row.id}/accept`, {
                              method: "POST",
                            }).then(load);
                          }}
                        >
                          Accept
                        </button>
                        <button
                          className="btn-ghost"
                          type="button"
                          onClick={() => {
                            setRequests((current) =>
                              (current ?? []).filter((item) => item.id !== row.id),
                            );
                            void api(`/api/friend-requests/${row.id}/decline`, {
                              method: "POST",
                            }).then(load);
                          }}
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            }
            return (
              <Link
                key={row.note.id}
                className={`card note-row${row.note.readAt ? "" : " unread-note"}`}
                to={row.note.link || "/home"}
              >
                <strong>{row.note.title}</strong>
                <p className="meta">{row.note.body}</p>
                {row.note.createdAt ? <p className="meta">{timeAgo(row.note.createdAt)}</p> : null}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

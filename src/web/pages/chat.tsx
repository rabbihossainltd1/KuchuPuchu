import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Phone, Send, Video } from "lucide-react";
import { api, RequestError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCall } from "../lib/calls";
import { timeAgo } from "../lib/time";
import { Avatar, Empty, Notice, Spinner } from "../components/ui";
import type { PublicUser } from "../lib/types";

type Conversation = {
  id: string;
  other: PublicUser;
  lastMessage: { body: string; createdAt?: string } | null;
  unread: number;
  lastMessageAt?: string;
};

type ChatMessage = { id: string; senderId: string; body: string; createdAt?: string };

function stamp(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date
    .toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
    .toUpperCase();
}

function dayKey(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function MessagesPage() {
  const [items, setItems] = useState<Conversation[] | null>(null);
  useEffect(() => {
    void api<{ items: Conversation[] }>("/api/conversations").then((data) =>
      setItems(data.items ?? []),
    );
  }, []);
  return (
    <div>
      <h1 className="page-title">Messages</h1>
      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Empty title="No conversations yet" />
      ) : (
        <div className="inbox">
          {items.map((item) => (
            <Link key={item.id} className="inbox-row" to={`/messages/${item.id}`}>
              <Avatar
                name={item.other.displayName}
                url={item.other.avatarUrl}
                online={item.other.online}
              />
              <div className="inbox-copy">
                <div className="inbox-top">
                  <strong>{item.other.displayName}</strong>
                  <span className="meta">
                    {item.lastMessageAt ? timeAgo(item.lastMessageAt) : ""}
                  </span>
                </div>
                <p className="meta">{item.lastMessage?.body || "No messages yet"}</p>
              </div>
              {item.unread ? <span className="unread">{item.unread}</span> : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function ConversationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { startCall } = useCall();
  const [other, setOther] = useState<PublicUser | null>(null);
  const [items, setItems] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    if (!id) return;
    const [thread, inbox] = await Promise.all([
      api<{ items: ChatMessage[] }>(`/api/conversations/${id}/messages`),
      api<{ items: Conversation[] }>("/api/conversations"),
    ]);
    setItems(thread.items);
    setOther(inbox.items.find((item) => item.id === id)?.other ?? null);
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load().catch(() => undefined), 2500);
    return () => window.clearInterval(timer);
  }, [id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [items.length]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    try {
      const data = await api<{ message: ChatMessage }>(`/api/conversations/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      setItems((current) => [...current, data.message]);
      setDraft("");
      setError("");
    } catch (err) {
      setError(err instanceof RequestError ? err.body.message : "Could not send.");
    }
  }

  const rows = useMemo(() => {
    const out: Array<{ type: "day"; label: string } | { type: "msg"; item: ChatMessage }> = [];
    let last = "";
    for (const item of items) {
      const key = dayKey(item.createdAt);
      if (key && key !== last) {
        out.push({ type: "day", label: stamp(item.createdAt) });
        last = key;
      }
      out.push({ type: "msg", item });
    }
    return out;
  }, [items]);

  return (
    <div className="chat-page">
      <header className="chat-head">
        <button
          className="icon-plain"
          type="button"
          aria-label="Back"
          onClick={() => navigate("/messages")}
        >
          <ChevronLeft size={26} />
        </button>
        {other ? (
          <>
            <Link className="chat-person" to={`/players/${other.userId}`}>
              <Avatar name={other.displayName} url={other.avatarUrl} online={other.online} />
              <div>
                <strong>{other.displayName}</strong>
                <p className="meta">{other.online ? "Active now" : `@${other.username}`}</p>
              </div>
            </Link>
            <button
              className="icon-plain"
              type="button"
              aria-label="Voice call"
              onClick={() => void startCall(other.userId, "AUDIO")}
            >
              <Phone size={22} />
            </button>
            <button
              className="icon-plain"
              type="button"
              aria-label="Video call"
              onClick={() => void startCall(other.userId, "VIDEO")}
            >
              <Video size={22} />
            </button>
          </>
        ) : (
          <strong className="header-title">Conversation</strong>
        )}
      </header>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="thread chat-thread">
        {rows.map((row, index) =>
          row.type === "day" ? (
            <div key={`day-${row.label}-${index}`} className="chat-day">
              {row.label}
            </div>
          ) : (
            <div
              key={row.item.id}
              className={row.item.senderId === user?.id ? "bubble-row mine" : "bubble-row"}
            >
              {row.item.senderId !== user?.id && other ? (
                <Avatar name={other.displayName} url={other.avatarUrl} />
              ) : null}
              <div className={row.item.senderId === user?.id ? "bubble mine" : "bubble"}>
                {row.item.body}
              </div>
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>
      <form className="chat-compose" onSubmit={onSubmit}>
        <input
          name="body"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          required
          placeholder="Message"
          aria-label="Message"
          autoComplete="off"
        />
        <button className="chat-send" type="submit" aria-label="Send" disabled={!draft.trim()}>
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}

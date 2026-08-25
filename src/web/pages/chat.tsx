import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Phone, Send, Video } from "lucide-react";
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

export function MessagesPage() {
  const [items, setItems] = useState<Conversation[] | null>(null);
  useEffect(() => {
    void api<{ items: Conversation[] }>("/api/conversations").then((data) => setItems(data.items ?? []));
  }, []);
  return (
    <div>
      <h1 className="page-title">Messages</h1>
      <p className="lede">Chat, voice, and video with players who allow messages.</p>
      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Empty title="No conversations yet" body="Open a profile and tap Message to start a thread." />
      ) : (
        <div className="inbox">
          {items.map((item) => (
            <Link key={item.id} className="inbox-row" to={`/messages/${item.id}`}>
              <Avatar name={item.other.displayName} url={item.other.avatarUrl} online={item.other.online} />
              <div className="inbox-copy">
                <div className="inbox-top">
                  <strong>{item.other.displayName}</strong>
                  <span className="meta">{item.lastMessageAt ? timeAgo(item.lastMessageAt) : ""}</span>
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
  const { user } = useAuth();
  const { startCall } = useCall();
  const [other, setOther] = useState<PublicUser | null>(null);
  const [items, setItems] = useState<ChatMessage[]>([]);
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
    const form = event.currentTarget;
    const body = String(new FormData(form).get("body") || "");
    try {
      const data = await api<{ message: ChatMessage }>(`/api/conversations/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      setItems((current) => [...current, data.message]);
      form.reset();
      setError("");
    } catch (err) {
      setError(err instanceof RequestError ? err.body.message : "Could not send.");
    }
  }

  return (
    <div className="chat-page">
      <header className="chat-head card">
        {other ? (
          <>
            <Avatar name={other.displayName} url={other.avatarUrl} online={other.online} />
            <div style={{ flex: 1 }}>
              <h1 className="page-title" style={{ fontSize: 20 }}>
                {other.displayName}
              </h1>
              <p className="meta">
                @{other.username}
                {other.online ? " · online" : ""}
              </p>
            </div>
            <button className="icon-btn" type="button" onClick={() => void startCall(other.userId, "AUDIO")}>
              <Phone size={18} />
              Call
            </button>
            <button className="icon-btn" type="button" onClick={() => void startCall(other.userId, "VIDEO")}>
              <Video size={18} />
              Video
            </button>
          </>
        ) : (
          <h1 className="page-title">Conversation</h1>
        )}
      </header>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="thread chat-thread">
        {items.map((item) => (
          <div key={item.id} className={item.senderId === user?.id ? "bubble mine" : "bubble"}>
            {item.body}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form className="composer-bar chat-compose" onSubmit={onSubmit}>
        <input name="body" required placeholder="Write a message" aria-label="Message" autoComplete="off" />
        <button className="btn" type="submit">
          <Send size={16} />
          Send
        </button>
      </form>
    </div>
  );
}

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Download, ImagePlus, Phone, Send, Smile, Video, X } from "lucide-react";
import { api, peekCache, RequestError } from "../lib/api";
import { readPhoto, savePhoto } from "../lib/photo";
import { useAuth } from "../lib/auth";
import { useCall } from "../lib/calls";
import { lastSeenLabel, timeAgo } from "../lib/time";
import { STICKERS, stickerSrc } from "../lib/stickers";
import { Avatar, Empty, Notice, Spinner } from "../components/ui";
import type { PublicUser } from "../lib/types";

type Conversation = {
  id: string;
  other: PublicUser;
  lastMessage: { body: string; createdAt?: string } | null;
  unread: number;
  lastMessageAt?: string;
};

type ChatMessage = {
  id: string;
  senderId: string;
  body: string;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  sticker?: string | null;
  call?: string | null;
  reaction?: string | null;
  createdAt?: string;
};

function mediaOf(item: ChatMessage) {
  const imageUrls = item.imageUrls?.length ? item.imageUrls : item.imageUrl ? [item.imageUrl] : [];
  return { imageUrls, sticker: item.sticker ?? null, call: item.call ?? null };
}

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
  const [items, setItems] = useState<Conversation[] | null>(
    () => peekCache<{ items: Conversation[] }>("/api/conversations")?.items ?? null,
  );
  useEffect(() => {
    function apply(data: { items: Conversation[] }) {
      const list = data.items ?? [];
      setItems(list);
      for (const row of list.slice(0, 8)) {
        void api<{ items: ChatMessage[] }>(`/api/conversations/${row.id}/messages`).catch(
          () => undefined,
        );
      }
    }
    void api<{ items: Conversation[] }>("/api/conversations").then(apply);
    const timer = window.setInterval(() => {
      void api<{ items: Conversation[] }>("/api/conversations")
        .then(apply)
        .catch(() => undefined);
    }, 6000);
    return () => window.clearInterval(timer);
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
  const [other, setOther] = useState<PublicUser | null>(() => {
    const inbox = peekCache<{ items: Conversation[] }>("/api/conversations");
    return inbox?.items.find((item) => item.id === id)?.other ?? null;
  });
  const [items, setItems] = useState<ChatMessage[]>(
    () => peekCache<{ items: ChatMessage[] }>(`/api/conversations/${id}/messages`)?.items ?? [],
  );
  const [draft, setDraft] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [viewer, setViewer] = useState<{ src: string; message: ChatMessage } | null>(null);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [inbox, setInbox] = useState<Conversation[]>(
    () => peekCache<{ items: Conversation[] }>("/api/conversations")?.items ?? [],
  );
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const thread = await api<{ items: ChatMessage[] }>(`/api/conversations/${id}/messages`);
    setItems((current) => {
      const prev = new Map(current.map((item) => [item.id, item]));
      return thread.items.map((item) => {
        const older = prev.get(item.id);
        const media = mediaOf(item);
        if (older && !media.imageUrls.length && !media.sticker && !media.call) {
          const keep = mediaOf(older);
          if (keep.imageUrls.length || keep.sticker || keep.call) {
            return {
              ...item,
              ...keep,
              imageUrl: keep.imageUrls[0] ?? null,
              reaction: item.reaction ?? older.reaction,
            };
          }
        }
        return {
          ...item,
          imageUrls: media.imageUrls,
          sticker: media.sticker,
          call: media.call,
          reaction: item.reaction ?? older?.reaction ?? null,
        };
      });
    });
    const inbox = peekCache<{ items: Conversation[] }>("/api/conversations");
    const found = inbox?.items.find((item) => item.id === id)?.other;
    if (found) setOther(found);
  }, [id]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load().catch(() => undefined), 900);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [items.length]);

  async function sendPayload(payload: { body?: string; imageData?: string[]; sticker?: string }) {
    if (!id || sending) return;
    setSending(true);
    try {
      const data = await api<{ message: ChatMessage }>(`/api/conversations/${id}/messages`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const media = mediaOf(data.message);
      setItems((current) => [
        ...current,
        { ...data.message, imageUrls: media.imageUrls, sticker: media.sticker },
      ]);
      setDraft("");
      setPhotos([]);
      setStickersOpen(false);
      setError("");
    } catch (err) {
      setError(err instanceof RequestError ? err.body.message : "Could not send.");
    } finally {
      setSending(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body && !photos.length) return;
    await sendPayload({
      body: body || undefined,
      imageData: photos,
    });
  }

  async function reactTo(messageId: string, emoji: string) {
    if (!id) return;
    try {
      await api(`/api/conversations/${id}/messages/${messageId}/react`, {
        method: "POST",
        body: JSON.stringify({ emoji }),
      });
      setItems((current) =>
        current.map((item) => (item.id === messageId ? { ...item, reaction: emoji } : item)),
      );
    } catch {
      setError("Could not react.");
    }
  }

  async function forwardTo(conversationId: string) {
    if (!viewer) return;
    try {
      await api(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        body: JSON.stringify({ imageData: [viewer.src] }),
      });
      setForwardOpen(false);
      setViewer(null);
      if (conversationId === id) await load();
    } catch {
      setError("Could not forward.");
    }
  }

  useEffect(() => {
    void api<{ items: Conversation[] }>("/api/conversations")
      .then((data) => setInbox(data.items ?? []))
      .catch(() => undefined);
  }, []);

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
                <p className="meta">{lastSeenLabel(other.lastActiveAt, other.online)}</p>
              </div>
            </Link>
            <button
              className="icon-plain"
              type="button"
              aria-label="Voice call"
              onClick={() => void startCall(other.userId, "AUDIO", other)}
            >
              <Phone size={22} />
            </button>
            <button
              className="icon-plain"
              type="button"
              aria-label="Video call"
              onClick={() => void startCall(other.userId, "VIDEO", other)}
            >
              <Video size={22} />
            </button>
          </>
        ) : (
          <strong className="header-title">Conversation</strong>
        )}
      </header>
      <div className="thread chat-thread">
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {rows.map((row, index) => {
          if (row.type === "day") {
            return (
              <div key={`day-${row.label}-${index}`} className="chat-day">
                {row.label}
              </div>
            );
          }
          const media = mediaOf(row.item);
          if (media.call) {
            const parts = media.call.split(":");
            const kind = parts[1] === "VIDEO" ? "Video" : "Voice";
            const status = parts[2] ?? "";
            const sec = Number(parts[3] || 0);
            const mins = Math.floor(sec / 60);
            const clock = `${mins}:${String(sec % 60).padStart(2, "0")}`;
            const label =
              status === "ENDED"
                ? `${kind} call · ${clock}`
                : status === "DECLINED"
                  ? `Declined ${kind.toLowerCase()} call`
                  : `Missed ${kind.toLowerCase()} call`;
            return (
              <div key={row.item.id} className="chat-call-log">
                {label}
              </div>
            );
          }
          const stickerOnly = Boolean(media.sticker);
          const photoOnly = Boolean(
            media.imageUrls.length && (!row.item.body || row.item.body === "Photo"),
          );
          return (
            <div
              key={row.item.id}
              className={row.item.senderId === user?.id ? "bubble-row mine" : "bubble-row"}
            >
              {row.item.senderId !== user?.id && other ? (
                <Avatar name={other.displayName} url={other.avatarUrl} />
              ) : null}
              <div
                className={`${row.item.senderId === user?.id ? "bubble mine" : "bubble"}${
                  stickerOnly ? " sticker-only" : photoOnly ? " photo-only" : ""
                }`}
              >
                {media.sticker ? (
                  stickerSrc(media.sticker) ? (
                    <img className="bubble-sticker-img" src={stickerSrc(media.sticker)!} alt="" />
                  ) : (
                    <span className="bubble-sticker">{media.sticker}</span>
                  )
                ) : null}
                {media.imageUrls.length ? (
                  <div className={media.imageUrls.length > 1 ? "bubble-album" : "bubble-album one"}>
                    {media.imageUrls.map((src) => (
                      <button
                        key={src.slice(0, 48)}
                        className="bubble-photo-btn"
                        type="button"
                        onClick={() => setViewer({ src, message: row.item })}
                      >
                        <img className="bubble-photo" src={src} alt="" />
                      </button>
                    ))}
                  </div>
                ) : null}
                {row.item.body &&
                !media.sticker &&
                !(media.imageUrls.length && row.item.body === "Photo") ? (
                  <span>{row.item.body}</span>
                ) : null}
                {row.item.reaction ? <em className="bubble-react">{row.item.reaction}</em> : null}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <div className="chat-dock">
        {stickersOpen ? (
          <div className="sticker-tray" role="listbox" aria-label="Stickers">
            {STICKERS.map((item) => (
              <button
                key={item.id}
                className="sticker-btn"
                type="button"
                onClick={() => void sendPayload({ sticker: item.id, body: item.name })}
              >
                <img src={item.src} alt={item.name} />
              </button>
            ))}
          </div>
        ) : null}
        {photos.length ? (
          <div className="chat-previews">
            {photos.map((src, index) => (
              <span key={`${index}-${src.length}`} className="chat-preview-wrap">
                <img className="chat-preview" src={src} alt="" />
                <button
                  className="icon-plain"
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => setPhotos((current) => current.filter((_, i) => i !== index))}
                >
                  <X size={14} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <form className="chat-compose" onSubmit={onSubmit}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = "";
              if (!files.length) return;
              const room = Math.max(0, 4 - photos.length);
              void Promise.all(files.slice(0, room).map((file) => readPhoto(file, 360, 70000)))
                .then((next) => setPhotos((current) => [...current, ...next].slice(0, 4)))
                .catch(() => setError("Could not read that photo."));
            }}
          />
          <button
            className="icon-plain"
            type="button"
            aria-label="Attach photos"
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus size={22} />
          </button>
          <button
            className={stickersOpen ? "icon-plain on" : "icon-plain"}
            type="button"
            aria-label="Stickers"
            onClick={() => setStickersOpen((open) => !open)}
          >
            <Smile size={22} />
          </button>
          <input
            name="body"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Message"
            aria-label="Message"
            autoComplete="off"
          />
          <button
            className="chat-send"
            type="submit"
            aria-label="Send"
            disabled={sending || (!draft.trim() && !photos.length)}
          >
            <Send size={18} />
          </button>
        </form>
      </div>
      {viewer ? (
        <div className="photo-lightbox" role="dialog" aria-label="Photo">
          <button className="icon-plain photo-close" type="button" onClick={() => setViewer(null)}>
            <X size={24} />
          </button>
          <img src={viewer.src} alt="" />
          <div className="photo-actions">
            <button type="button" onClick={() => void savePhoto(viewer.src)}>
              <Download size={16} /> Save
            </button>
            <button
              type="button"
              onClick={() => {
                setForwardOpen(true);
                void api<{ items: Conversation[] }>("/api/conversations")
                  .then((data) => setInbox(data.items ?? []))
                  .catch(() => undefined);
              }}
            >
              <Send size={16} /> Forward
            </button>
            {["❤️", "😂", "😮", "😢", "👍"].map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => void reactTo(viewer.message.id, emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
          {forwardOpen ? (
            <div className="forward-sheet">
              <strong>Forward to</strong>
              {inbox.map((row) => (
                <button key={row.id} type="button" onClick={() => void forwardTo(row.id)}>
                  {row.other.displayName}
                </button>
              ))}
              <button type="button" onClick={() => setForwardOpen(false)}>
                Cancel
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

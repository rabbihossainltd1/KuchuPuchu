/* HOME UI LOCKED — do not restyle, resize, or rewrite this screen unless the user explicitly unlocks it. */
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Globe, Heart, ImagePlus, Lock, MessageCircle, Plus, Send, X } from "lucide-react";
import { api, RequestError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { timeAgo } from "../lib/time";
import { Avatar, Empty, Notice } from "../components/ui";
import { PlayerActions } from "../components/actions";
import { label, type PublicUser } from "../lib/types";
import "./home.css";

export type FeedPost = {
  id: string;
  body: string;
  visibility: "PUBLIC" | "FRIENDS";
  createdAt: string;
  author: PublicUser;
  likeCount: number;
  liked: boolean;
  commentCount: number;
  comments: Array<{ id: string; body: string; createdAt: string; author: PublicUser | null }>;
};

type StoryItem = {
  id: string;
  body: string | null;
  imageUrl: string | null;
  createdAt: string;
  expiresAt: string;
  seen: boolean;
  mine: boolean;
};

type StoryGroup = {
  author: PublicUser;
  seen: boolean;
  stories: StoryItem[];
};

async function readPhoto(file: File) {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    const max = 720;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not read that photo.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that photo."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

export function HomePage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const composing = params.get("compose") === "1";
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [recs, setRecs] = useState<PublicUser[]>([]);
  const [people, setPeople] = useState<PublicUser[]>([]);
  const [storyGroups, setStoryGroups] = useState<StoryGroup[]>([]);
  const [visibility, setVisibility] = useState<"PUBLIC" | "FRIENDS">("PUBLIC");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);
  const [viewer, setViewer] = useState<{ group: number; index: number } | null>(null);

  async function load() {
    const [feed, rec, stories, search] = await Promise.all([
      api<{ items: FeedPost[] }>("/api/feed"),
      api<{ items: PublicUser[] }>("/api/discover/recommendations"),
      api<{ items: StoryGroup[] }>("/api/stories"),
      q
        ? api<{ items: PublicUser[] }>(`/api/discover?q=${encodeURIComponent(q)}`)
        : Promise.resolve({ items: [] as PublicUser[] }),
    ]);
    setPosts(feed.items);
    setRecs(rec.items);
    setStoryGroups(stories.items);
    setPeople(search.items);
  }

  useEffect(() => {
    void load().catch((err) => {
      if (err instanceof RequestError && err.status === 401) return;
      setError(err instanceof Error ? err.message : "Could not load feed");
    });
  }, [q]);

  const visiblePosts = useMemo(() => {
    if (!posts) return [];
    if (!q) return posts;
    const needle = q.toLowerCase();
    return posts.filter(
      (post) =>
        post.body.toLowerCase().includes(needle) ||
        post.author.displayName.toLowerCase().includes(needle) ||
        post.author.username.toLowerCase().includes(needle),
    );
  }, [posts, q]);

  const feedItems = useMemo(() => {
    const items: Array<{ type: "post"; post: FeedPost } | { type: "recs"; people: PublicUser[] }> = [];
    visiblePosts.forEach((post, index) => {
      items.push({ type: "post", post });
      if ((index + 1) % 3 === 0 && recs.length) {
        const start = Math.floor(index / 3) * 2;
        items.push({ type: "recs", people: recs.slice(start, start + 2) });
      }
    });
    if (visiblePosts.length < 3 && recs.length) {
      items.push({ type: "recs", people: recs.slice(0, 3) });
    }
    return items.filter((item) => item.type === "post" || item.people.length);
  }, [visiblePosts, recs]);

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = String(new FormData(form).get("body") || "").trim();
    if (!body) return;
    setPending(true);
    setError("");
    try {
      const data = await api<{ post: FeedPost }>("/api/posts", {
        method: "POST",
        body: JSON.stringify({ body, visibility }),
      });
      setPosts((current) => [data.post, ...(current ?? [])]);
      form.reset();
      const next = new URLSearchParams(params);
      next.delete("compose");
      setParams(next);
    } catch (err) {
      setError(err instanceof RequestError ? err.body.message : "Could not publish.");
    } finally {
      setPending(false);
    }
  }

  function replacePost(post: FeedPost) {
    setPosts((current) => current?.map((item) => (item.id === post.id ? post : item)) ?? null);
  }

  function closeComposer() {
    const next = new URLSearchParams(params);
    next.delete("compose");
    setParams(next);
  }

  async function shareStory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = String(new FormData(form).get("body") || "").trim();
    const file = (form.elements.namedItem("photo") as HTMLInputElement | null)?.files?.[0];
    setPending(true);
    setError("");
    try {
      const imageData = file ? await readPhoto(file) : null;
      const data = await api<{ items: StoryGroup[] }>("/api/stories", {
        method: "POST",
        body: JSON.stringify({ body: body || null, imageData }),
      });
      setStoryGroups(data.items);
      setStoryOpen(false);
      form.reset();
    } catch (err) {
      setError(err instanceof RequestError ? err.body.message : "Could not share story.");
    } finally {
      setPending(false);
    }
  }

  const currentGroup = viewer ? storyGroups[viewer.group] : undefined;
  const activeStory = viewer ? currentGroup?.stories[viewer.index] : undefined;

  useEffect(() => {
    if (!viewer || !activeStory) return;
    void api(`/api/stories/${activeStory.id}/view`, { method: "POST", body: "{}" }).catch(() => undefined);
    const timer = window.setTimeout(() => stepViewer(1), 5000);
    return () => window.clearTimeout(timer);
  }, [viewer?.group, viewer?.index, activeStory?.id]);

  function stepViewer(delta: number) {
    setViewer((current) => {
      if (!current) return current;
      const group = storyGroups[current.group];
      if (!group) return null;
      const nextIndex = current.index + delta;
      if (nextIndex >= 0 && nextIndex < group.stories.length) {
        return { group: current.group, index: nextIndex };
      }
      const nextGroup = current.group + delta;
      const nextStories = storyGroups[nextGroup]?.stories;
      if (nextStories?.length) {
        return { group: nextGroup, index: delta > 0 ? 0 : nextStories.length - 1 };
      }
      return null;
    });
  }

  return (
    <div className="feed-page">
      <div className="home-top">
        <button className="mind-bar" type="button" onClick={() => setParams({ compose: "1" })}>
          <Avatar name={user?.displayName ?? "You"} url={user?.avatarUrl} />
          <span className="mind-pill">What's on your mind?</span>
          <ImagePlus size={20} aria-hidden="true" />
        </button>

        <div className="story-rail" aria-label="Stories">
          <button className="story-card create" type="button" onClick={() => setStoryOpen(true)}>
            <div className="story-art">
              <div className="story-create-photo">
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" />
                ) : (
                  <Avatar name={user?.displayName ?? "You"} url={user?.avatarUrl} />
                )}
              </div>
              <span className="story-plus">
                <Plus size={18} strokeWidth={2.75} />
              </span>
              <em>Create story</em>
            </div>
          </button>
          {storyGroups.map((group, groupIndex) => (
            <button
              key={group.author.userId}
              className={`story-card${group.seen ? " seen" : ""}`}
              type="button"
              onClick={() => setViewer({ group: groupIndex, index: 0 })}
            >
              <div className="story-art">
                {group.stories[0]?.imageUrl ? (
                  <img className="story-cover" src={group.stories[0].imageUrl} alt="" />
                ) : (
                  <span className="story-text-fill">{group.stories[0]?.body || group.author.displayName}</span>
                )}
                <span className="story-avatar">
                  <Avatar name={group.author.displayName} url={group.author.avatarUrl} />
                </span>
                <em>{group.author.userId === user?.id ? "Your story" : group.author.displayName}</em>
              </div>
            </button>
          ))}
        </div>
      </div>

      {q ? (
        <section className="soft-block rec-strip">
          <div className="strip-head">
            <h3>Players matching “{q}”</h3>
            <Link to="/friends">See all</Link>
          </div>
          {people.length === 0 ? (
            <p className="meta">No players matched that search.</p>
          ) : (
            people.slice(0, 6).map((player) => <SuggestCard key={player.userId} player={player} />)
          )}
        </section>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {!posts ? (
        <div className="post-card">
          <p className="meta">Loading posts…</p>
        </div>
      ) : feedItems.length === 0 ? (
        <Empty
          title="Your feed is quiet"
          body="Share what’s on your mind, or add a 24-hour story."
          action={
            <button className="btn" type="button" onClick={() => setParams({ compose: "1" })}>
              Create post
            </button>
          }
        />
      ) : (
        <div className="feed">
          {feedItems.map((item, index) =>
            item.type === "post" ? (
              <PostCard
                key={item.post.id}
                post={item.post}
                onChange={replacePost}
                mine={item.post.author.userId === user?.id}
              />
            ) : (
              <section key={`recs-${index}`} className="people-block rec-strip">
                <div className="strip-head">
                  <h3>People you may know</h3>
                  <Link to="/friends">See all</Link>
                </div>
                {item.people.map((player) => (
                  <SuggestCard key={player.userId} player={player} />
                ))}
              </section>
            ),
          )}
        </div>
      )}

      {composing ? (
        <div className="composer-overlay">
          <form className="composer-sheet" onSubmit={publish}>
            <div className="strip-head">
              <h3>Create post</h3>
              <button className="icon-plain" type="button" onClick={closeComposer} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="player-head">
              <Avatar name={user?.displayName ?? "You"} url={user?.avatarUrl} />
              <textarea
                name="body"
                rows={5}
                maxLength={500}
                required
                autoFocus
                placeholder="What's on your mind?"
                aria-label="Write a post"
              />
            </div>
            <div className="composer-bar">
              <div className="vis-toggle" role="group" aria-label="Who can see this">
                <button
                  type="button"
                  className={visibility === "PUBLIC" ? "tab active" : "tab"}
                  onClick={() => setVisibility("PUBLIC")}
                >
                  <Globe size={14} /> Public
                </button>
                <button
                  type="button"
                  className={visibility === "FRIENDS" ? "tab active" : "tab"}
                  onClick={() => setVisibility("FRIENDS")}
                >
                  <Lock size={14} /> Friends
                </button>
              </div>
              <button className="btn" disabled={pending}>
                <Send size={16} />
                {pending ? "Posting…" : "Post"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {storyOpen ? (
        <div className="composer-overlay">
          <form className="composer-sheet" onSubmit={(event) => void shareStory(event)}>
            <div className="strip-head">
              <h3>Create story</h3>
              <button className="icon-plain" type="button" onClick={() => setStoryOpen(false)} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <p className="meta">Stories disappear after 24 hours. Photo or a short caption is enough.</p>
            <label className="field">
              <span>Photo</span>
              <input name="photo" type="file" accept="image/*" />
            </label>
            <label className="field">
              <span>Caption</span>
              <textarea name="body" rows={3} maxLength={200} placeholder="Say something…" />
            </label>
            <button className="btn" disabled={pending}>
              {pending ? "Sharing…" : "Share story"}
            </button>
          </form>
        </div>
      ) : null}

      {viewer && currentGroup && activeStory ? (
        <div className="story-viewer" role="dialog" aria-label="Story">
          <div className="story-progress">
            {currentGroup.stories.map((item, index) => (
              <b key={item.id} className={index <= viewer.index ? "on" : ""} />
            ))}
          </div>
          <div className="story-viewer-head">
            <Avatar name={currentGroup.author.displayName} url={currentGroup.author.avatarUrl} />
            <div>
              <strong>{currentGroup.author.displayName}</strong>
              <div className="meta">{timeAgo(activeStory.createdAt)} · 24h</div>
            </div>
            {activeStory.mine ? (
              <button
                className="btn-ghost"
                type="button"
                onClick={() =>
                  void api(`/api/stories/${activeStory.id}`, { method: "DELETE" }).then(() => {
                    setViewer(null);
                    void load();
                  })
                }
              >
                Delete
              </button>
            ) : null}
            <button className="icon-plain" type="button" onClick={() => setViewer(null)} aria-label="Close story">
              <X size={20} />
            </button>
          </div>
          <button className="story-hit left" type="button" aria-label="Previous" onClick={() => stepViewer(-1)} />
          <button className="story-hit right" type="button" aria-label="Next" onClick={() => stepViewer(1)} />
          <div className="story-stage">
            {activeStory.imageUrl ? <img src={activeStory.imageUrl} alt="" /> : null}
            {activeStory.body ? <p>{activeStory.body}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SuggestCard({ player }: { player: PublicUser }) {
  return (
    <article className="suggest-card">
      <Link className="mini-person" to={`/players/${player.userId}`}>
        <Avatar name={player.displayName} url={player.avatarUrl} online={player.online} />
        <div>
          <strong>{player.displayName}</strong>
          <div className="meta">
            @{player.username}
            {player.rank ? ` · ${label(player.rank)}` : ""}
            {player.reasons?.length ? ` · ${player.reasons[0]}` : ""}
          </div>
        </div>
      </Link>
      <PlayerActions player={player} compact />
    </article>
  );
}

function PostCard({
  post,
  onChange,
  mine,
}: {
  post: FeedPost;
  onChange: (post: FeedPost) => void;
  mine: boolean;
}) {
  const [open, setOpen] = useState(false);

  async function like() {
    const data = await api<{ post: FeedPost }>(`/api/posts/${post.id}/like`, { method: "POST" });
    onChange(data.post);
  }

  async function comment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = String(new FormData(form).get("body") || "").trim();
    if (!body) return;
    const data = await api<{ post: FeedPost }>(`/api/posts/${post.id}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
    onChange(data.post);
    form.reset();
    setOpen(true);
  }

  async function remove() {
    if (!confirm("Delete this post?")) return;
    await api(`/api/posts/${post.id}`, { method: "DELETE" });
    onChange({ ...post, body: "" });
  }

  if (!post.body) return null;

  return (
    <article className="soft-block post-card">
      <div className="player-head">
        <Avatar name={post.author.displayName} url={post.author.avatarUrl} online={post.author.online} />
        <div style={{ flex: 1 }}>
          <strong>
            <Link to={`/players/${post.author.userId}`}>{post.author.displayName}</Link>
          </strong>
          <div className="meta">
            @{post.author.username} · {timeAgo(post.createdAt)} ·{" "}
            {post.visibility === "FRIENDS" ? "Friends" : "Public"}
          </div>
        </div>
        {mine ? (
          <button className="icon-plain" type="button" onClick={() => void remove()} aria-label="Delete post">
            <X size={16} />
          </button>
        ) : null}
      </div>
      <p className="post-body">{post.body}</p>
      <div className="post-actions">
        <button className={post.liked ? "text-btn liked" : "text-btn"} type="button" onClick={() => void like()}>
          <Heart size={18} fill={post.liked ? "currentColor" : "none"} />
          {post.likeCount}
        </button>
        <button className="text-btn" type="button" onClick={() => setOpen((v) => !v)}>
          <MessageCircle size={18} />
          {post.commentCount}
        </button>
      </div>
      {open ? (
        <div className="comments">
          {post.comments.map((item) =>
            item.author ? (
              <div key={item.id} className="comment">
                <Avatar name={item.author.displayName} url={item.author.avatarUrl} />
                <div>
                  <strong>{item.author.displayName}</strong>
                  <span className="meta"> {timeAgo(item.createdAt)}</span>
                  <p>{item.body}</p>
                </div>
              </div>
            ) : null,
          )}
          <form className="comment-form" onSubmit={comment}>
            <input name="body" required maxLength={280} placeholder="Write a comment" aria-label="Comment" />
            <button className="btn" type="submit">
              Reply
            </button>
          </form>
        </div>
      ) : null}
    </article>
  );
}

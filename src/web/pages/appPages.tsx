import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, RequestError, idempotencyKey } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Empty, Notice, PlayerCard, Spinner, Avatar } from "../components/ui";
import { PlayerActions } from "../components/actions";
import { label, type PublicUser } from "../lib/types";
import { ItemPreview } from "../components/ItemPreview";
import {
  AGE_RANGES,
  GAME_MODES,
  GENDERS,
  GENDER_PREFERENCES,
  LANGUAGES,
  MIC_PREFERENCES,
  PLAY_STYLES,
  PRODUCT_CATEGORIES,
  RANKS,
  RELATIONSHIP_STATUSES,
  SERVER_REGIONS,
} from "../../shared/constants";
import "./store.css";

const AVAILABILITY = ["morning", "afternoon", "evening", "night", "weekend"] as const;

export function OnboardingPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/me/profile", {
        method: "PATCH",
        body: JSON.stringify({
          country: form.get("country") || "Bangladesh",
          district: form.get("district") || null,
          ffIgn: form.get("ffIgn") || null,
          ffUid: form.get("ffUid") || null,
          serverRegion: form.get("serverRegion"),
          rank: form.get("rank"),
          level: form.get("level") ? Number(form.get("level")) : null,
          preferredModes: [String(form.get("mode"))],
          playStyle: form.get("playStyle"),
          languages: [String(form.get("language"))],
          micPreference: form.get("micPreference"),
          ageRange: form.get("ageRange") || null,
          gender: form.get("gender") || null,
          genderPreference: form.get("genderPreference") || "ANY",
          availability: [String(form.get("availability") || "evening")],
        }),
      });
      await refresh();
      navigate("/home");
    } catch (err) {
      setError(err instanceof RequestError ? err.body.message : "Could not save profile.");
    }
  }

  return (
    <div>
      <h1 className="page-title">Profile setup</h1>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <form className="card grid" style={{ marginTop: 18 }} onSubmit={onSubmit}>
        <label className="field">
          <span>Country</span>
          <input name="country" defaultValue="Bangladesh" />
        </label>
        <label className="field">
          <span>District (approximate)</span>
          <input name="district" placeholder="Rajshahi" />
        </label>
        <label className="field">
          <span>Free Fire IGN</span>
          <input name="ffIgn" />
        </label>
        <label className="field">
          <span>Free Fire UID (private by default)</span>
          <input name="ffUid" />
        </label>
        <label className="field">
          <span>Server</span>
          <select name="serverRegion" defaultValue="SOUTH_ASIA">
            {SERVER_REGIONS.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Rank</span>
          <select name="rank" defaultValue="GOLD">
            {RANKS.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Level</span>
          <input name="level" type="number" min={1} max={100} />
        </label>
        <label className="field">
          <span>Main mode</span>
          <select name="mode" defaultValue="CLASH_SQUAD">
            {GAME_MODES.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Play style</span>
          <select name="playStyle" defaultValue="FLEX">
            {PLAY_STYLES.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Language</span>
          <select name="language" defaultValue="bn">
            {LANGUAGES.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Availability</span>
          <select name="availability" defaultValue="evening">
            {AVAILABILITY.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Mic</span>
          <select name="micPreference" defaultValue="OPTIONAL">
            {MIC_PREFERENCES.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Age range (for matching only)</span>
          <select name="ageRange" defaultValue="">
            <option value="">Skip</option>
            {AGE_RANGES.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Gender (optional)</span>
          <select name="gender" defaultValue="UNDISCLOSED">
            {GENDERS.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Show me</span>
          <select name="genderPreference" defaultValue="ANY">
            {GENDER_PREFERENCES.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <button className="btn">Save and continue</button>
      </form>
    </div>
  );
}

export function HomePage() {
  const { user } = useAuth();
  const [recs, setRecs] = useState<PublicUser[] | null>(null);
  const [online, setOnline] = useState<PublicUser[]>([]);
  const [requests, setRequests] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    void Promise.all([
      api<{ items: PublicUser[] }>("/api/discover/recommendations"),
      api<{ items: PublicUser[] }>("/api/discover?online=true"),
      api<{ items: Array<Record<string, unknown>> }>("/api/duo-requests"),
    ])
      .then(([r, o, d]) => {
        setRecs(r.items);
        setOnline(o.items);
        setRequests(d.items.filter((item) => String(item.status) === "PENDING"));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load home"));
  }, []);

  return (
    <div>
      <h1 className="page-title">Home</h1>
      <p className="lede">
        Hello {user?.displayName}. Recommendations are ranked for compatibility.
      </p>
      <div className="grid cols-3" style={{ margin: "16px 0" }}>
        <Link className="card" to="/discover">
          <h3>Discover</h3>
          <p className="meta">Filter the full player list.</p>
        </Link>
        <Link className="card" to="/wallet">
          <h3>{user?.wallet.balance ?? 0} coins</h3>
          <p className="meta">Buy, earn, or review the ledger.</p>
        </Link>
        <Link className="card" to="/referrals">
          <h3>{user?.referralCode}</h3>
          <p className="meta">Share your referral code.</p>
        </Link>
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <h2 className="section-title">Recommended players</h2>
      {!recs ? (
        <Spinner />
      ) : recs.length === 0 ? (
        <Empty
          title="No recommendations yet"
          body="Finish your profile and check back. Recommendations appear when other eligible players exist."
          action={
            <Link className="btn" to="/onboarding">
              Complete profile
            </Link>
          }
        />
      ) : (
        <div className="grid cols-2">
          {recs.map((player) => (
            <PlayerCard key={player.userId} player={player} />
          ))}
        </div>
      )}

      <h2 className="section-title">Online / available</h2>
      {online.length === 0 ? (
        <p className="meta">No one is marked online right now.</p>
      ) : (
        <div className="grid cols-2">
          {online.map((player) => (
            <PlayerCard key={player.userId} player={player} />
          ))}
        </div>
      )}

      <h2 className="section-title">Active Duo / Squad requests</h2>
      {requests.length === 0 ? (
        <p className="meta">
          No pending requests. <Link to="/discover">Invite someone from Discover</Link>.
        </p>
      ) : (
        <div className="grid">
          {requests.map((item) => {
            const requester = item.requester as PublicUser | undefined;
            return (
              <article key={String(item.id)} className="card">
                <strong>{requester?.displayName ?? "Player"}</strong>
                <div className="meta">
                  {label(String(item.mode))} · {String(item.status).toLowerCase()}
                </div>
                <Link className="btn-secondary" to="/requests" style={{ marginTop: 10 }}>
                  Review
                </Link>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

type DiscoverFilters = {
  q: string;
  serverRegion: string;
  country: string;
  district: string;
  rankMin: string;
  rankMax: string;
  mode: string;
  playStyle: string;
  language: string;
  availability: string;
  micPreference: string;
  ageRange: string;
  genderPreference: string;
  online: string;
  verified: string;
};

const emptyFilters: DiscoverFilters = {
  q: "",
  serverRegion: "",
  country: "",
  district: "",
  rankMin: "",
  rankMax: "",
  mode: "",
  playStyle: "",
  language: "",
  availability: "",
  micPreference: "",
  ageRange: "",
  genderPreference: "",
  online: "",
  verified: "",
};

export function DiscoverPage() {
  const [items, setItems] = useState<PublicUser[] | null>(null);
  const [filters, setFilters] = useState<DiscoverFilters>(emptyFilters);
  const [error, setError] = useState("");

  function set<K extends keyof DiscoverFilters>(key: K, value: DiscoverFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  async function load(next = filters) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
    }
    try {
      const data = await api<{ items: PublicUser[] }>(`/api/discover?${params}`);
      setItems(data.items);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div>
      <h1 className="page-title">Discover</h1>
      <p className="lede">Blocked accounts and hidden profiles never appear here.</p>
      <form
        className="filters"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <input
          placeholder="Search name or IGN"
          value={filters.q}
          onChange={(e) => set("q", e.target.value)}
          aria-label="Search name or IGN"
        />
        <select
          value={filters.serverRegion}
          onChange={(e) => set("serverRegion", e.target.value)}
          aria-label="Server"
        >
          <option value="">Any server</option>
          {SERVER_REGIONS.map((item) => (
            <option key={item} value={item}>
              {label(item)}
            </option>
          ))}
        </select>
        <input
          placeholder="Country"
          value={filters.country}
          onChange={(e) => set("country", e.target.value)}
          aria-label="Country"
        />
        <input
          placeholder="District"
          value={filters.district}
          onChange={(e) => set("district", e.target.value)}
          aria-label="District"
        />
        <select
          value={filters.rankMin}
          onChange={(e) => set("rankMin", e.target.value)}
          aria-label="Minimum rank"
        >
          <option value="">Rank min</option>
          {RANKS.map((item) => (
            <option key={item} value={item}>
              {label(item)}
            </option>
          ))}
        </select>
        <select
          value={filters.rankMax}
          onChange={(e) => set("rankMax", e.target.value)}
          aria-label="Maximum rank"
        >
          <option value="">Rank max</option>
          {RANKS.map((item) => (
            <option key={item} value={item}>
              {label(item)}
            </option>
          ))}
        </select>
        <select
          value={filters.mode}
          onChange={(e) => set("mode", e.target.value)}
          aria-label="Game mode"
        >
          <option value="">Any mode</option>
          {GAME_MODES.map((item) => (
            <option key={item} value={item}>
              {label(item)}
            </option>
          ))}
        </select>
        <select
          value={filters.playStyle}
          onChange={(e) => set("playStyle", e.target.value)}
          aria-label="Play style"
        >
          <option value="">Any play style</option>
          {PLAY_STYLES.map((item) => (
            <option key={item} value={item}>
              {label(item)}
            </option>
          ))}
        </select>
        <select
          value={filters.language}
          onChange={(e) => set("language", e.target.value)}
          aria-label="Language"
        >
          <option value="">Any language</option>
          {LANGUAGES.map((item) => (
            <option key={item} value={item}>
              {label(item)}
            </option>
          ))}
        </select>
        <select
          value={filters.availability}
          onChange={(e) => set("availability", e.target.value)}
          aria-label="Availability"
        >
          <option value="">Any availability</option>
          {AVAILABILITY.map((item) => (
            <option key={item} value={item}>
              {label(item)}
            </option>
          ))}
        </select>
        <select
          value={filters.micPreference}
          onChange={(e) => set("micPreference", e.target.value)}
          aria-label="Mic preference"
        >
          <option value="">Any mic</option>
          {MIC_PREFERENCES.map((item) => (
            <option key={item} value={item}>
              {label(item)}
            </option>
          ))}
        </select>
        <select
          value={filters.ageRange}
          onChange={(e) => set("ageRange", e.target.value)}
          aria-label="Age range"
        >
          <option value="">Any age range</option>
          {AGE_RANGES.map((item) => (
            <option key={item} value={item}>
              {label(item)}
            </option>
          ))}
        </select>
        <select
          value={filters.genderPreference}
          onChange={(e) => set("genderPreference", e.target.value)}
          aria-label="Gender preference"
        >
          <option value="">Any gender preference</option>
          {GENDER_PREFERENCES.map((item) => (
            <option key={item} value={item}>
              {label(item)}
            </option>
          ))}
        </select>
        <select
          value={filters.online}
          onChange={(e) => set("online", e.target.value)}
          aria-label="Online status"
        >
          <option value="">Any status</option>
          <option value="true">Online now</option>
          <option value="false">Offline</option>
        </select>
        <select
          value={filters.verified}
          onChange={(e) => set("verified", e.target.value)}
          aria-label="Verified status"
        >
          <option value="">Any verification</option>
          <option value="true">Verified IGN</option>
        </select>
        <button className="btn" type="submit">
          Apply filters
        </button>
        <button
          className="btn-secondary"
          type="button"
          onClick={() => {
            setFilters(emptyFilters);
            void load(emptyFilters);
          }}
        >
          Reset
        </button>
      </form>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Empty
          title="No players match"
          body="Try fewer filters. New players appear as they finish onboarding."
        />
      ) : (
        <div className="grid cols-2">
          {items.map((player) => (
            <PlayerCard
              key={player.userId}
              player={player}
              extra={<PlayerActions player={player} />}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function PlayerPage() {
  const { id } = useParams();
  const [player, setPlayer] = useState<PublicUser | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!id) return;
    void api<{ user: PublicUser }>(`/api/users/${id}`)
      .then((data) => setPlayer(data.user))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed"));
  }, [id]);

  async function act(path: string, body?: unknown) {
    try {
      await api(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
      setNotice("Done.");
      setError("");
    } catch (err) {
      setError(err instanceof RequestError ? err.body.message : "Action failed.");
    }
  }

  if (!player && !error) return <Spinner />;
  if (!player) return <Notice tone="danger">{error}</Notice>;

  const location = [player.approximateArea, player.district, player.country]
    .filter(Boolean)
    .join(" · ");

  return (
    <div>
      <div className="card" style={{ display: "grid", gap: 14 }}>
        <div className="player-head" style={{ marginTop: 0, padding: 0 }}>
          <Avatar name={player.displayName} url={player.avatarUrl} online={player.online} large />
          <div>
            <h1 className="page-title">{player.displayName}</h1>
            <div className="meta">
              @{player.username} · reputation {player.reputation}
              {player.online ? " · online" : ""}
            </div>
            <p className="lede">{player.bio || "No bio yet."}</p>
          </div>
        </div>
        <div className="chips">
          {player.verifiedFf ? <span className="chip accent">Verified IGN</span> : null}
          {player.verifiedIdentity ? <span className="chip accent">Identity verified</span> : null}
          <span className="chip">{label(player.rank)}</span>
          {player.level ? <span className="chip">Lv {player.level}</span> : null}
          <span className="chip">{label(player.serverRegion)}</span>
          {player.ffIgn ? <span className="chip">IGN {player.ffIgn}</span> : null}
          {player.ffUid ? <span className="chip">UID {player.ffUid}</span> : null}
          {player.playStyle ? <span className="chip">{label(player.playStyle)}</span> : null}
          {player.micPreference ? (
            <span className="chip">{label(player.micPreference)}</span>
          ) : null}
          {player.relationshipStatus ? (
            <span className="chip">{label(player.relationshipStatus)}</span>
          ) : null}
          {player.facebookId ? <span className="chip">Facebook {player.facebookId}</span> : null}
          {player.whatsapp ? <span className="chip">WhatsApp {player.whatsapp}</span> : null}
          {player.instagram ? <span className="chip">Instagram {player.instagram}</span> : null}
          {player.preferredModes.map((mode) => (
            <span className="chip" key={mode}>
              {label(mode)}
            </span>
          ))}
          {player.languages.map((lang) => (
            <span className="chip" key={lang}>
              {label(lang)}
            </span>
          ))}
          {player.availability.map((slot) => (
            <span className="chip" key={slot}>
              {label(slot)}
            </span>
          ))}
        </div>
        {location ? <p className="meta">Approximate location: {location}</p> : null}
        {notice ? <Notice tone="ok">{notice}</Notice> : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <PlayerActions player={player} />
        <div className="row">
          <button className="btn" onClick={() => void act(`/api/users/${player.userId}/follow`)}>
            Follow
          </button>
          <button
            className="btn-secondary"
            onClick={() =>
              void act("/api/duo-requests", {
                targetId: player.userId,
                mode: player.preferredModes[0] || "CLASH_SQUAD",
              })
            }
          >
            Invite
          </button>
          <Link className="btn-secondary" to={`/inventory?gift=${player.userId}`}>
            Gift
          </Link>
          <button
            className="btn-danger"
            onClick={() => {
              if (confirm("Block this player? They will disappear from discovery and chat.")) {
                void act(`/api/users/${player.userId}/block`);
              }
            }}
          >
            Block
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              const details = prompt("Describe the issue (required)");
              if (details)
                void act("/api/reports", {
                  targetUserId: player.userId,
                  category: "other",
                  details,
                });
            }}
          >
            Report
          </button>
        </div>
      </div>
    </div>
  );
}

export function RequestsPage() {
  const [duo, setDuo] = useState<Array<Record<string, unknown>> | null>(null);
  const [friends, setFriends] = useState<Array<{ id: string; fromUserId: string }>>([]);

  async function load() {
    const [d, f] = await Promise.all([
      api<{ items: Array<Record<string, unknown>> }>("/api/duo-requests"),
      api<{ items: Array<{ id: string; fromUserId: string }> }>("/api/friend-requests"),
    ]);
    setDuo(d.items);
    setFriends(f.items);
  }
  useEffect(() => {
    void load();
  }, []);

  return (
    <div>
      <h1 className="page-title">Requests</h1>
      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <section className="card">
          <h3>Friend requests</h3>
          {friends.length === 0 ? <p className="meta">None pending.</p> : null}
          {friends.map((item) => (
            <div key={item.id} className="row" style={{ marginTop: 10 }}>
              <span className="meta">{item.fromUserId}</span>
              <button
                className="btn"
                onClick={() =>
                  void api(`/api/friend-requests/${item.id}/accept`, { method: "POST" }).then(load)
                }
              >
                Accept
              </button>
              <button
                className="btn-secondary"
                onClick={() =>
                  void api(`/api/friend-requests/${item.id}/decline`, { method: "POST" }).then(load)
                }
              >
                Decline
              </button>
            </div>
          ))}
        </section>
        <section className="card">
          <h3>Duo / Squad</h3>
          {!duo ? <Spinner /> : duo.length === 0 ? <p className="meta">No requests yet.</p> : null}
          {duo?.map((item) => {
            const requester = item.requester as PublicUser;
            const status = String(item.status);
            return (
              <article key={String(item.id)} style={{ marginTop: 12 }}>
                <strong>{requester.displayName}</strong>
                <div className="meta">
                  {label(String(item.mode))} · {status.toLowerCase()}
                </div>
                {status === "PENDING" ? (
                  <div className="row" style={{ marginTop: 8 }}>
                    <button
                      className="btn"
                      onClick={() =>
                        void api(`/api/duo-requests/${item.id}/accept`, { method: "POST" }).then(
                          load,
                        )
                      }
                    >
                      Accept
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() =>
                        void api(`/api/duo-requests/${item.id}/decline`, { method: "POST" }).then(
                          load,
                        )
                      }
                    >
                      Decline
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() =>
                        void api(`/api/duo-requests/${item.id}/cancel`, { method: "POST" }).then(
                          load,
                        )
                      }
                    >
                      Cancel
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      </div>
    </div>
  );
}

export function MessagesPage() {
  const [items, setItems] = useState<Array<{
    id: string;
    other: PublicUser;
    lastMessage: { body: string } | null;
    unread: number;
  }> | null>(null);
  useEffect(() => {
    void api<{ items: typeof items }>("/api/conversations").then((data) =>
      setItems(data.items ?? []),
    );
  }, []);
  return (
    <div>
      <h1 className="page-title">Messages</h1>
      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Empty
          title="No conversations"
          body="Open a player profile and send a message when they allow it."
        />
      ) : (
        <div className="grid" style={{ marginTop: 16 }}>
          {items.map((item) => (
            <Link key={item.id} className="card" to={`/messages/${item.id}`}>
              <strong>{item.other.displayName}</strong>
              <div className="meta">{item.lastMessage?.body || "No messages yet"}</div>
              {item.unread ? <span className="chip accent">{item.unread} unread</span> : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function ConversationPage() {
  const { id } = useParams();
  const [items, setItems] = useState<Array<{ id: string; senderId: string; body: string }>>([]);
  const { user } = useAuth();
  const [error, setError] = useState("");

  async function load() {
    if (!id) return;
    const data = await api<{ items: typeof items }>(`/api/conversations/${id}/messages`);
    setItems(data.items);
  }
  useEffect(() => {
    void load();
  }, [id]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = String(new FormData(form).get("body") || "");
    try {
      await api(`/api/conversations/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      form.reset();
      await load();
    } catch (err) {
      setError(err instanceof RequestError ? err.body.message : "Could not send.");
    }
  }

  return (
    <div>
      <h1 className="page-title">Conversation</h1>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="thread" style={{ margin: "16px 0" }}>
        {items.map((item) => (
          <div key={item.id} className={item.senderId === user?.id ? "bubble mine" : "bubble"}>
            {item.body}
          </div>
        ))}
      </div>
      <form className="row" onSubmit={onSubmit}>
        <input name="body" required placeholder="Write a message" aria-label="Message" />
        <button className="btn">Send</button>
      </form>
    </div>
  );
}

export function ProfilePage() {
  const { user, refresh } = useAuth();
  const [saved, setSaved] = useState(false);
  if (!user) return <Spinner />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/me/profile", {
      method: "PATCH",
      body: JSON.stringify({
        displayName: form.get("displayName"),
        bio: form.get("bio"),
        ffIgn: form.get("ffIgn") || null,
        rank: form.get("rank"),
        relationshipStatus: form.get("relationshipStatus"),
      }),
    });
    await refresh();
    setSaved(true);
  }

  return (
    <div>
      <h1 className="page-title">Your profile</h1>
      <p className="meta">
        Reputation {user.reputation} · @{user.username}
      </p>
      {saved ? <Notice tone="ok">Saved.</Notice> : null}
      <form className="card grid" style={{ marginTop: 16 }} onSubmit={onSubmit}>
        <label className="field">
          <span>Display name</span>
          <input name="displayName" defaultValue={user.displayName} />
        </label>
        <label className="field">
          <span>Bio</span>
          <textarea name="bio" defaultValue={user.bio ?? ""} rows={4} />
        </label>
        <label className="field">
          <span>IGN</span>
          <input name="ffIgn" defaultValue={user.profile.ffIgn ?? ""} />
        </label>
        <label className="field">
          <span>Rank</span>
          <select name="rank" defaultValue={user.profile.rank ?? "GOLD"}>
            {RANKS.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Relationship status</span>
          <select
            name="relationshipStatus"
            defaultValue={user.profile.relationshipStatus ?? "PREFER_NOT"}
          >
            {RELATIONSHIP_STATUSES.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <button className="btn">Save profile</button>
      </form>
    </div>
  );
}

type StoreProduct = {
  id: string;
  name: string;
  description: string;
  category: string;
  priceCoins: number;
  rarity: string;
  imageKey: string;
};

export function StorePage() {
  const { refresh } = useAuth();
  const [items, setItems] = useState<StoreProduct[] | null>(null);
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load(next = category) {
    const query = next ? `?category=${encodeURIComponent(next)}` : "";
    const data = await api<{ items: StoreProduct[] }>(`/api/store/products${query}`);
    setItems(data.items);
  }

  useEffect(() => {
    void load();
  }, []);

  async function buy(productId: string) {
    setError("");
    try {
      await api("/api/store/orders", {
        method: "POST",
        body: JSON.stringify({ productId, idempotencyKey: idempotencyKey("store") }),
      });
      setNotice("Added to inventory.");
      await refresh();
    } catch (err) {
      setError(err instanceof RequestError ? err.body.message : "Purchase failed.");
    }
  }

  return (
    <div className="store-page">
      <h1 className="page-title">Store</h1>
      <p className="lede">
        Prices are taken from the server at purchase time. The client price is display-only.
      </p>
      <div className="tabs" style={{ margin: "14px 0" }}>
        <button
          className={category === "" ? "tab active" : "tab"}
          type="button"
          onClick={() => {
            setCategory("");
            void load("");
          }}
        >
          All
        </button>
        {PRODUCT_CATEGORIES.map((item) => (
          <button
            key={item}
            className={category === item ? "tab active" : "tab"}
            type="button"
            onClick={() => {
              setCategory(item);
              void load(item);
            }}
          >
            {label(item)}
          </button>
        ))}
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {notice ? <Notice tone="ok">{notice}</Notice> : null}
      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Empty title="Nothing in this category" body="Try another category or check back later." />
      ) : (
        <div className="store-grid" style={{ marginTop: 16 }}>
          {items.map((item) => (
            <article key={item.id} className="card store-card">
              <ItemPreview imageKey={item.imageKey} name={item.name} />
              <h3>{item.name}</h3>
              <p className="meta">{item.description}</p>
              <div className="row">
                <span className="chip">{item.priceCoins} coins</span>
                <span className={`chip rarity-${item.rarity}`}>{label(item.rarity)}</span>
              </div>
              <button className="btn" onClick={() => void buy(item.id)}>
                Buy
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

type InventoryItem = {
  id: string;
  equipped: boolean;
  giftable: boolean;
  product: { name: string; category: string; imageKey?: string };
};

export function InventoryPage() {
  const [params] = useSearchParams();
  const giftTo = params.get("gift");
  const [tab, setTab] = useState<"owned" | "equipped" | "giftable" | "history">("owned");
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [orders, setOrders] = useState<
    Array<{ id: string; createdAt: string; product: { name: string } }>
  >([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const data = await api<{ items: InventoryItem[] }>("/api/inventory");
    setItems(data.items);
    const history = await api<{ items: typeof orders }>("/api/store/orders");
    setOrders(history.items);
  }
  useEffect(() => {
    void load();
  }, []);

  const visible = useMemo(() => {
    if (!items) return [];
    if (tab === "equipped") return items.filter((item) => item.equipped);
    if (tab === "giftable") return items.filter((item) => item.giftable);
    return items;
  }, [items, tab]);

  return (
    <div>
      <h1 className="page-title">Inventory</h1>
      {giftTo ? <Notice>Select a giftable item to send.</Notice> : null}
      {notice ? <Notice tone="ok">{notice}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="tabs" style={{ margin: "14px 0" }}>
        {(["owned", "equipped", "giftable", "history"] as const).map((item) => (
          <button
            key={item}
            className={tab === item ? "tab active" : "tab"}
            type="button"
            onClick={() => setTab(item)}
          >
            {item === "owned"
              ? "Owned"
              : item === "equipped"
                ? "Equipped"
                : item === "giftable"
                  ? "Giftable"
                  : "Purchase history"}
          </button>
        ))}
      </div>
      {tab === "history" ? (
        orders.length === 0 ? (
          <Empty
            title="No purchases yet"
            body="Visit the store to buy banners, frames and boosts."
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>{order.product.name}</td>
                  <td className="meta">{new Date(order.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : !items ? (
        <Spinner />
      ) : visible.length === 0 ? (
        <Empty
          title="Nothing here yet"
          body="Visit the store to buy banners, frames and boosts."
          action={
            <Link className="btn" to="/store">
              Open store
            </Link>
          }
        />
      ) : (
        <div className="grid cols-2" style={{ marginTop: 16 }}>
          {visible.map((item) => (
            <article key={item.id} className="card">
              <div className="item-art">{label(item.product.category)}</div>
              <h3>{item.product.name}</h3>
              <p className="meta">
                {label(item.product.category)} {item.equipped ? "· equipped" : ""}
                {item.giftable ? " · giftable" : ""}
              </p>
              <div className="row">
                <button
                  className="btn-secondary"
                  onClick={() =>
                    void api(`/api/inventory/${item.id}/${item.equipped ? "unequip" : "equip"}`, {
                      method: "POST",
                    }).then(load)
                  }
                >
                  {item.equipped ? "Unequip" : "Equip"}
                </button>
                {giftTo && item.giftable ? (
                  <button
                    className="btn"
                    onClick={() =>
                      void api("/api/gifts", {
                        method: "POST",
                        body: JSON.stringify({
                          inventoryId: item.id,
                          receiverId: giftTo,
                          idempotencyKey: idempotencyKey("gift"),
                        }),
                      })
                        .then(() => setNotice("Gift sent."))
                        .catch((err) =>
                          setError(err instanceof RequestError ? err.body.message : "Gift failed."),
                        )
                    }
                  >
                    Send gift
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function WalletPage() {
  const { user, refresh } = useAuth();
  const [packs, setPacks] = useState<
    Array<{ id: string; name: string; coins: number; priceBdt: number }>
  >([]);
  const [tx, setTx] = useState<
    Array<{ id: string; type: string; amount: number; source: string; createdAt: string }>
  >([]);
  const [payments, setPayments] = useState<
    Array<{ id: string; status: string; amountBdt?: number; createdAt: string }>
  >([]);
  const [referrals, setReferrals] = useState<
    Array<{ id: string; status: string; rewardAmount: number }>
  >([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const [p, t, pay, refs] = await Promise.all([
      api<{ items: typeof packs }>("/api/payments/packages"),
      api<{ items: typeof tx }>("/api/wallet/transactions"),
      api<{ items: typeof payments }>("/api/payments/orders"),
      api<{ items: typeof referrals }>("/api/wallet/referrals"),
    ]);
    setPacks(p.items);
    setTx(t.items);
    setPayments(pay.items);
    setReferrals(refs.items);
  }

  useEffect(() => {
    void load();
  }, []);

  const pending = payments.filter((row) => row.status === "CREATED" || row.status === "PENDING");
  const referralEarned = referrals
    .filter((row) => row.status === "REWARDED" || row.status === "PAID")
    .reduce((sum, row) => sum + (row.rewardAmount || 0), 0);

  async function daily() {
    try {
      await api("/api/wallet/daily-reward", { method: "POST" });
      await refresh();
      await load();
      setNotice("Daily reward credited.");
      setError("");
    } catch (err) {
      setError(err instanceof RequestError ? err.body.message : "Could not claim.");
    }
  }

  async function buy(packageId: string) {
    const order = await api<{ order: { id: string; checkoutUrl: string } }>(
      "/api/payments/orders",
      {
        method: "POST",
        body: JSON.stringify({ packageId, idempotencyKey: idempotencyKey("pay") }),
      },
    );
    window.location.href = order.order.checkoutUrl;
  }

  return (
    <div>
      <h1 className="page-title">Wallet</h1>
      <p className="lede">
        Credits only happen after server verification. The client never changes balances.
      </p>
      <div className="grid cols-3" style={{ margin: "16px 0" }}>
        <article className="card">
          <h3>{user?.wallet.balance ?? 0} coins</h3>
          <p className="meta">Current balance</p>
        </article>
        <article className="card">
          <h3>{referralEarned}</h3>
          <p className="meta">Referral earnings</p>
        </article>
        <article className="card">
          <h3>Earn</h3>
          <p className="meta">Claim the daily reward once per day.</p>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => void daily()}>
            Claim daily reward
          </button>
        </article>
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {notice ? <Notice tone="ok">{notice}</Notice> : null}

      <h2 className="section-title">Buy coins</h2>
      <div className="grid cols-2">
        {packs.map((pack) => (
          <article key={pack.id} className="card">
            <h3>{pack.name}</h3>
            <p className="meta">
              {pack.coins} coins · ৳{pack.priceBdt}
            </p>
            <button className="btn" onClick={() => void buy(pack.id)}>
              Pay with SPV
            </button>
          </article>
        ))}
      </div>

      <h2 className="section-title">Pending transactions</h2>
      {pending.length === 0 ? (
        <p className="meta">No pending payments.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Status</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((row) => (
              <tr key={row.id}>
                <td>{row.status}</td>
                <td className="meta">{new Date(row.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="section-title">Ledger</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Amount</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {tx.map((row) => (
            <tr key={row.id}>
              <td>{row.type}</td>
              <td>{row.amount}</td>
              <td>{row.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="meta" style={{ marginTop: 16 }}>
        Invite friends from <Link to="/referrals">Referrals</Link> to earn after they verify email.
      </p>
    </div>
  );
}

export function PaymentReturnPage() {
  const { id } = useParams();
  const [status, setStatus] = useState("Checking payment…");
  useEffect(() => {
    if (!id) return;
    void api<{ order: { status: string } }>(`/api/payments/orders/${id}/sync`, { method: "POST" })
      .then((data) =>
        setStatus(
          `Order ${data.order.status.toLowerCase()}. Coins are added only after verification.`,
        ),
      )
      .catch(() =>
        setStatus("Could not confirm this payment yet. It will be reconciled automatically."),
      );
  }, [id]);
  return (
    <div className="card">
      <h1 className="page-title">Payment result</h1>
      <p className="lede">{status}</p>
      <Link className="btn" to="/wallet">
        Back to wallet
      </Link>
    </div>
  );
}

export function SandboxPayPage() {
  const { id } = useParams();
  const [secret, setSecret] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [done, setDone] = useState("");
  useEffect(() => {
    if (!id) return;
    void api<{ secret: string; amount: number }>(`/api/sandbox/payments/${id}`).then((data) => {
      setSecret(data.secret);
      setAmount(data.amount);
    });
  }, [id]);
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="kicker">SPV sandbox</div>
        <h1 className="page-title">Confirm test payment</h1>
        <p className="lede">
          This is the server-side sandbox checkout used when live SPV credentials are not
          configured. Completing it still goes through the same settlement path as a live verified
          payment.
        </p>
        <p className="meta">Amount ৳{amount ?? "…"}</p>
        {done ? <Notice tone="ok">{done}</Notice> : null}
        <div className="row" style={{ marginTop: 16 }}>
          <button
            className="btn"
            onClick={() =>
              void api(`/api/sandbox/payments/${id}/complete`, {
                method: "POST",
                body: JSON.stringify({ secret }),
              }).then(() => setDone("Verified. You can return to the wallet."))
            }
          >
            Mark verified
          </button>
          <button
            className="btn-secondary"
            onClick={() =>
              void api(`/api/sandbox/payments/${id}/fail`, { method: "POST" }).then(() =>
                setDone("Marked failed."),
              )
            }
          >
            Fail payment
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReferralsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Array<{ id: string; status: string; rewardAmount: number }>>(
    [],
  );
  useEffect(() => {
    void api<{ items: typeof items }>("/api/wallet/referrals").then((d) => setItems(d.items));
  }, []);
  return (
    <div>
      <h1 className="page-title">Referrals</h1>
      <div className="card">
        <strong>{user?.referralCode}</strong>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Reward</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.status}</td>
              <td>{item.rewardAmount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function NotificationsPage() {
  const [items, setItems] = useState<
    Array<{ id: string; title: string; body: string; link?: string; readAt: string | null }>
  >([]);
  async function load() {
    const data = await api<{ items: typeof items }>("/api/notifications");
    setItems(data.items);
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <div>
      <div className="topbar">
        <h1 className="page-title">Notifications</h1>
        <button
          className="btn-secondary"
          onClick={() =>
            void api("/api/notifications/read", { method: "POST", body: "{}" }).then(load)
          }
        >
          Mark all read
        </button>
      </div>
      <div className="grid">
        {items.map((item) => (
          <Link key={item.id} className="card" to={item.link || "/home"}>
            <strong>{item.title}</strong>
            <p className="meta">{item.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { user, refresh, logout } = useAuth();
  const [mail, setMail] = useState<Array<{ subject: string; body: string }>>([]);
  if (!user) return <Spinner />;

  async function savePrivacy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/me/privacy", {
      method: "PATCH",
      body: JSON.stringify({
        showDistrict: form.get("showDistrict") === "on",
        showFfUid: form.get("showFfUid") === "on",
        showRelationship: form.get("showRelationship") === "on",
        discoverable: form.get("discoverable") === "on",
        allowMessages: form.get("allowMessages"),
      }),
    });
    await refresh();
  }

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <form className="card grid" onSubmit={savePrivacy}>
        <label className="switch">
          <span>Show district</span>
          <input name="showDistrict" type="checkbox" defaultChecked={user.privacy.showDistrict} />
        </label>
        <label className="switch">
          <span>Show Free Fire UID</span>
          <input name="showFfUid" type="checkbox" defaultChecked={user.privacy.showFfUid} />
        </label>
        <label className="switch">
          <span>Show relationship status</span>
          <input
            name="showRelationship"
            type="checkbox"
            defaultChecked={user.privacy.showRelationship}
          />
        </label>
        <label className="switch">
          <span>Appear in discovery</span>
          <input name="discoverable" type="checkbox" defaultChecked={user.privacy.discoverable} />
        </label>
        <label className="field">
          <span>Who can message you</span>
          <select name="allowMessages" defaultValue={user.privacy.allowMessages}>
            <option value="EVERYONE">Everyone</option>
            <option value="FRIENDS">Friends</option>
            <option value="NONE">No one</option>
          </select>
        </label>
        <button className="btn">Save privacy</button>
      </form>
      <div className="row" style={{ marginTop: 16 }}>
        <button
          className="btn-secondary"
          onClick={() => void api("/api/auth/verify-email/resend", { method: "POST" })}
        >
          Resend verification
        </button>
        <button
          className="btn-secondary"
          onClick={() =>
            void api<{ items: typeof mail }>("/api/dev/mailbox").then((d) => setMail(d.items))
          }
        >
          Open local mailbox
        </button>
        <a className="btn-secondary" href="/api/me/export">
          Export my data
        </a>
        <button
          className="btn-secondary"
          onClick={() => void api("/api/auth/logout-all", { method: "POST" }).then(logout)}
        >
          Sign out everywhere
        </button>
        <button className="btn-ghost" onClick={() => void logout()}>
          Sign out
        </button>
        <button
          className="btn-danger"
          onClick={() => {
            if (confirm("Delete your account? This hides personal data and ends sessions.")) {
              void api("/api/account", { method: "DELETE" }).then(() => {
                window.location.href = "/";
              });
            }
          }}
        >
          Delete account
        </button>
      </div>
      {mail.length ? (
        <div className="card" style={{ marginTop: 16 }}>
          {mail.map((item) => (
            <article key={item.subject}>
              <strong>{item.subject}</strong>
              <pre className="meta">{item.body}</pre>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function HelpPage() {
  return (
    <div>
      <h1 className="page-title">Help & Safety</h1>
      <div className="card">
        <p>Never share OTPs or your home address. Use block and report if someone harasses you.</p>
      </div>
    </div>
  );
}

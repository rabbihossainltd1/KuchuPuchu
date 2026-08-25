import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Facebook, Instagram, Mail, MessageCircle } from "lucide-react";
import { api, RequestError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Avatar, Notice, Spinner } from "../components/ui";
import { label, type PublicUser } from "../lib/types";
import {
  AGE_RANGES,
  GAME_MODES,
  GENDERS,
  GENDER_PREFERENCES,
  LANGUAGES,
  MIC_PREFERENCES,
  PLAY_STYLES,
  RANKS,
  RELATIONSHIP_STATUSES,
  SERVER_REGIONS,
} from "../../shared/constants";

function socialHref(kind: "facebook" | "instagram" | "whatsapp", value: string) {
  if (kind === "whatsapp") {
    const digits = value.replace(/[^\d+]/g, "");
    return `https://wa.me/${digits.replace(/^\+/, "")}`;
  }
  if (value.startsWith("http")) return value;
  const handle = value.replace(/^@/, "");
  return kind === "facebook" ? `https://facebook.com/${handle}` : `https://instagram.com/${handle}`;
}

export function ProfilePage() {
  const { user } = useAuth();
  const [friends, setFriends] = useState<PublicUser[]>([]);

  useEffect(() => {
    void api<{ items: PublicUser[] }>("/api/friends")
      .then((data) => setFriends(data.items))
      .catch(() => undefined);
  }, []);

  if (!user) return <Spinner />;

  const profile = user.profile;
  const location = [user.district, user.country].filter(Boolean).join(" · ");

  return (
    <div className="profile-page">
      <section className="profile-hero">
        <div className="profile-cover" />
        <div className="profile-hero-body">
          <Avatar name={user.displayName} url={user.avatarUrl} large />
          <div>
            <h1 className="page-title">{user.displayName}</h1>
            <p className="meta">
              @{user.username}
              {profile.verifiedFf ? " · Verified IGN" : ""}
            </p>
            {user.bio ? <p className="lede">{user.bio}</p> : null}
            <div className="profile-stats">
              <Link to="/friends">
                <strong>{friends.length}</strong> friends
              </Link>
              <span>
                <strong>{user.reputation}</strong> reputation
              </span>
              <span>
                <strong>{user.wallet.balance}</strong> coins
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="card profile-about">
        <h2 className="section-title" style={{ marginTop: 0 }}>
          About
        </h2>
        <dl className="info-list">
          {profile.ffUid ? (
            <div>
              <dt>Free Fire UID</dt>
              <dd>{profile.ffUid}</dd>
            </div>
          ) : null}
          {profile.ffIgn ? (
            <div>
              <dt>IGN</dt>
              <dd>{profile.ffIgn}</dd>
            </div>
          ) : null}
          {user.email ? (
            <div>
              <dt>
                <Mail size={14} /> Email
              </dt>
              <dd>{user.email}</dd>
            </div>
          ) : null}
          {profile.facebookId ? (
            <div>
              <dt>
                <Facebook size={14} /> Facebook
              </dt>
              <dd>
                <a
                  href={socialHref("facebook", profile.facebookId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {profile.facebookId}
                </a>
              </dd>
            </div>
          ) : null}
          {profile.whatsapp ? (
            <div>
              <dt>
                <MessageCircle size={14} /> WhatsApp
              </dt>
              <dd>
                <a href={socialHref("whatsapp", profile.whatsapp)} target="_blank" rel="noreferrer">
                  {profile.whatsapp}
                </a>
              </dd>
            </div>
          ) : null}
          {profile.instagram ? (
            <div>
              <dt>
                <Instagram size={14} /> Instagram
              </dt>
              <dd>
                <a
                  href={socialHref("instagram", profile.instagram)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {profile.instagram}
                </a>
              </dd>
            </div>
          ) : null}
          {profile.rank ? (
            <div>
              <dt>Rank</dt>
              <dd>
                {label(profile.rank)}
                {profile.level ? ` · Lv ${profile.level}` : ""}
              </dd>
            </div>
          ) : null}
          {profile.serverRegion ? (
            <div>
              <dt>Server</dt>
              <dd>{label(profile.serverRegion)}</dd>
            </div>
          ) : null}
          {location ? (
            <div>
              <dt>Area</dt>
              <dd>{location}</dd>
            </div>
          ) : null}
          {profile.relationshipStatus ? (
            <div>
              <dt>Relationship</dt>
              <dd>{label(profile.relationshipStatus)}</dd>
            </div>
          ) : null}
        </dl>
        <div className="chips" style={{ marginTop: 12 }}>
          {profile.preferredModes.map((mode) => (
            <span className="chip" key={mode}>
              {label(mode)}
            </span>
          ))}
          {profile.languages.map((lang) => (
            <span className="chip" key={lang}>
              {label(lang)}
            </span>
          ))}
          {profile.playStyle ? <span className="chip">{label(profile.playStyle)}</span> : null}
          {profile.micPreference ? (
            <span className="chip">{label(profile.micPreference)}</span>
          ) : null}
        </div>
      </section>

      {friends.length ? (
        <section className="card">
          <div className="strip-head">
            <h3>Friends</h3>
            <Link to="/friends">See all</Link>
          </div>
          <div className="friend-grid">
            {friends.slice(0, 6).map((friend) => (
              <Link key={friend.userId} className="friend-tile" to={`/players/${friend.userId}`}>
                <Avatar name={friend.displayName} url={friend.avatarUrl} />
                <span>{friend.displayName}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function ProfileEditPage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  if (!user) return <Spinner />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const empty = (key: string) => {
      const value = String(form.get(key) || "").trim();
      return value || null;
    };
    setPending(true);
    setError("");
    try {
      await api("/api/me/profile", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: form.get("displayName"),
          username: form.get("username"),
          bio: form.get("bio") || "",
          avatarUrl: empty("avatarUrl"),
          country: empty("country"),
          district: empty("district"),
          ffIgn: empty("ffIgn"),
          ffUid: empty("ffUid"),
          serverRegion: form.get("serverRegion") || null,
          rank: form.get("rank") || null,
          level: form.get("level") ? Number(form.get("level")) : null,
          playStyle: form.get("playStyle") || null,
          micPreference: form.get("micPreference") || null,
          ageRange: form.get("ageRange") || null,
          gender: form.get("gender") || null,
          genderPreference: form.get("genderPreference") || "ANY",
          relationshipStatus: form.get("relationshipStatus") || null,
          facebookId: empty("facebookId"),
          instagram: empty("instagram"),
          whatsapp: empty("whatsapp"),
          preferredModes: [String(form.get("mode") || "CLASH_SQUAD")],
          languages: [String(form.get("language") || "bn")],
          availability: [String(form.get("availability") || "evening")],
        }),
      });
      await refresh();
      navigate("/profile");
    } catch (err) {
      setError(err instanceof RequestError ? err.body.message : "Could not save profile.");
    } finally {
      setPending(false);
    }
  }

  const profile = user.profile;
  return (
    <div>
      <h1 className="page-title">Edit profile</h1>
      <p className="lede">Photo, UID, contact links, and matching details all live here.</p>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <form className="card grid" style={{ marginTop: 16 }} onSubmit={onSubmit}>
        <label className="field">
          <span>Display name</span>
          <input name="displayName" defaultValue={user.displayName} required />
        </label>
        <label className="field">
          <span>Username</span>
          <input name="username" defaultValue={user.username} required />
        </label>
        <label className="field">
          <span>Photo URL</span>
          <input name="avatarUrl" defaultValue={user.avatarUrl ?? ""} placeholder="https://…" />
        </label>
        <label className="field">
          <span>Bio</span>
          <textarea name="bio" defaultValue={user.bio ?? ""} rows={4} />
        </label>
        <label className="field">
          <span>Free Fire UID</span>
          <input name="ffUid" defaultValue={profile.ffUid ?? ""} />
        </label>
        <label className="field">
          <span>Free Fire IGN</span>
          <input name="ffIgn" defaultValue={profile.ffIgn ?? ""} />
        </label>
        <label className="field">
          <span>Facebook</span>
          <input
            name="facebookId"
            defaultValue={profile.facebookId ?? ""}
            placeholder="username or URL"
          />
        </label>
        <label className="field">
          <span>WhatsApp</span>
          <input name="whatsapp" defaultValue={profile.whatsapp ?? ""} placeholder="+8801…" />
        </label>
        <label className="field">
          <span>Instagram</span>
          <input name="instagram" defaultValue={profile.instagram ?? ""} placeholder="@handle" />
        </label>
        <label className="field">
          <span>Country</span>
          <input name="country" defaultValue={user.country ?? "Bangladesh"} />
        </label>
        <label className="field">
          <span>District</span>
          <input name="district" defaultValue={user.district ?? ""} />
        </label>
        <label className="field">
          <span>Server</span>
          <select name="serverRegion" defaultValue={profile.serverRegion ?? "SOUTH_ASIA"}>
            {SERVER_REGIONS.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Rank</span>
          <select name="rank" defaultValue={profile.rank ?? "GOLD"}>
            {RANKS.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Level</span>
          <input name="level" type="number" min={1} max={100} defaultValue={profile.level ?? ""} />
        </label>
        <label className="field">
          <span>Main mode</span>
          <select name="mode" defaultValue={profile.preferredModes[0] ?? "CLASH_SQUAD"}>
            {GAME_MODES.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Play style</span>
          <select name="playStyle" defaultValue={profile.playStyle ?? "FLEX"}>
            {PLAY_STYLES.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Language</span>
          <select name="language" defaultValue={profile.languages[0] ?? "bn"}>
            {LANGUAGES.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Availability</span>
          <select name="availability" defaultValue={profile.availability[0] ?? "evening"}>
            {["morning", "afternoon", "evening", "night", "weekend"].map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Mic</span>
          <select name="micPreference" defaultValue={profile.micPreference ?? "OPTIONAL"}>
            {MIC_PREFERENCES.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Age range</span>
          <select name="ageRange" defaultValue={profile.ageRange ?? ""}>
            <option value="">Skip</option>
            {AGE_RANGES.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Gender</span>
          <select name="gender" defaultValue={profile.gender ?? "UNDISCLOSED"}>
            {GENDERS.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Show me</span>
          <select name="genderPreference" defaultValue={profile.genderPreference ?? "ANY"}>
            {GENDER_PREFERENCES.map((item) => (
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
            defaultValue={profile.relationshipStatus ?? "PREFER_NOT"}
          >
            {RELATIONSHIP_STATUSES.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <button className="btn" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </button>
          <Link className="btn-secondary" to="/profile">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

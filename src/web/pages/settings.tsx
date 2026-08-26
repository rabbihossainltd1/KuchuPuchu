import { FormEvent, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { askNotifyPermission, setNotifPrefs, type NotifKind } from "../lib/notify";
import { Spinner } from "../components/ui";

const NOTIF_ROWS: Array<{ key: NotifKind; label: string }> = [
  { key: "messaging", label: "Messages" },
  { key: "calls", label: "Calls" },
  { key: "requests", label: "Friend requests" },
  { key: "likes", label: "Likes" },
  { key: "comments", label: "Comments" },
  { key: "follow", label: "Follows" },
  { key: "gifting", label: "Gifts" },
  { key: "wallet", label: "Wallet" },
];

export function SettingsPage() {
  const { user, refresh, logout } = useAuth();
  const [saving, setSaving] = useState(false);
  if (!user) return <Spinner />;

  const prefs = {
    messaging: true,
    calls: true,
    requests: true,
    likes: true,
    comments: true,
    follow: true,
    gifting: true,
    wallet: true,
    ...user.notificationPreferences,
  };

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

  async function saveNotifs(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = Object.fromEntries(
      NOTIF_ROWS.map((row) => [row.key, form.get(row.key) === "on"]),
    ) as Record<NotifKind, boolean>;
    setSaving(true);
    try {
      await askNotifyPermission();
      setNotifPrefs(next);
      await api("/api/me/notifications", { method: "PATCH", body: JSON.stringify(next) });
      await refresh();
    } finally {
      setSaving(false);
    }
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
          <span>Show UID</span>
          <input name="showFfUid" type="checkbox" defaultChecked={user.privacy.showFfUid} />
        </label>
        <label className="switch">
          <span>Show relationship</span>
          <input
            name="showRelationship"
            type="checkbox"
            defaultChecked={user.privacy.showRelationship}
          />
        </label>
        <label className="switch">
          <span>Show in Find duo</span>
          <input name="discoverable" type="checkbox" defaultChecked={user.privacy.discoverable} />
        </label>
        <label className="field">
          <span>Messages</span>
          <select name="allowMessages" defaultValue={user.privacy.allowMessages}>
            <option value="EVERYONE">Everyone</option>
            <option value="FRIENDS">Friends</option>
            <option value="NONE">No one</option>
          </select>
        </label>
        <button className="btn">Save privacy</button>
      </form>
      <form className="card grid" style={{ marginTop: 16 }} onSubmit={saveNotifs}>
        <h2 className="section-title" style={{ marginTop: 0 }}>
          Notifications
        </h2>
        {NOTIF_ROWS.map((row) => (
          <label className="switch" key={row.key}>
            <span>{row.label}</span>
            <input name={row.key} type="checkbox" defaultChecked={prefs[row.key] !== false} />
          </label>
        ))}
        <button className="btn" disabled={saving}>
          {saving ? "Saving…" : "Save notifications"}
        </button>
      </form>
      <div className="grid" style={{ marginTop: 16 }}>
        <button className="btn-ghost" type="button" onClick={() => void logout()}>
          Sign out
        </button>
        <button
          className="btn-danger"
          type="button"
          onClick={() => {
            if (confirm("Delete account?")) {
              void api("/api/account", { method: "DELETE" }).then(() => {
                window.location.href = "/";
              });
            }
          }}
        >
          Delete account
        </button>
      </div>
    </div>
  );
}

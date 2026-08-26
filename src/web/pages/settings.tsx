import { FormEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Spinner } from "../components/ui";

export function SettingsPage() {
  const { user, refresh, logout } = useAuth();
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
        <button className="btn">Save</button>
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

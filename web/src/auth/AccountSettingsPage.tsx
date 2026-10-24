import { RealmBadge } from "../messaging/RealmBadge";
import { originRealmOf } from "../messaging/realmBadge";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ApiError } from "../api";
import { isWebFeatureEnabled } from "../featureFlags";
import { BrandMark, Icon } from "../icons";
import { ProfileQrDialog } from "../messaging/ProfileQrDialog";
import { CallSettingsSection } from "../calls/CallSettingsSection";
import {
  generateIdentity,
  isPassphraseBackup,
  parseStoredIdentity,
  sealPassphraseBackup,
} from "../messaging/e2ee";
import { PushSettingsSection } from "../push/PushSettingsSection";
import { RouteLink } from "../RouteLink";
import { useAuth } from "./AuthContext";
import { E2EE_STORAGE_KEY } from "./storage";
import { useProfileAvatar } from "./useProfileAvatar";
import {
  authApi,
  authErrorCopy,
  type AuthDevice,
  type AuthPrivacy,
  type AuthUser,
} from "./authApi";

type PrivacyValue = "nobody" | "contacts" | "public";
type PrivacyField =
  "privPhone" | "privAvatar" | "privMessages" | "privLastSeen" | "privGroups" | "privStatus";
type BooleanPrivacyField = "privateProfile";

const defaultPrivacy: AuthPrivacy = {
  phone: "contacts",
  avatar: "public",
  messages: "public",
  lastSeen: "public",
  groups: "public",
  status: "public",
  privateProfile: false,
};

const privacyOptions: Array<{ field: PrivacyField; key: keyof AuthPrivacy; label: string }> = [
  { field: "privPhone", key: "phone", label: "Phone number" },
  { field: "privAvatar", key: "avatar", label: "Profile photo" },
  { field: "privMessages", key: "messages", label: "New messages and calls" },
  { field: "privLastSeen", key: "lastSeen", label: "Last seen" },
  { field: "privGroups", key: "groups", label: "Group invites" },
  { field: "privStatus", key: "status", label: "Status updates" },
];

function initials(user: AuthUser): string {
  const source = user.displayName.trim() || user.username || "KP";
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function safeProfileError(error: unknown): string {
  if (error instanceof ApiError && error.status === 400) {
    return "The profile update was rejected. Check the name and username, then try again.";
  }
  return authErrorCopy(error);
}

async function readAvatarDataUrl(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.readAsDataURL(file);
  });
  if (raw.startsWith("data:image/") && raw.length <= 75_000) {
    return raw;
  }
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Unsupported image format."));
    el.src = raw;
  });
  const maxSide = 256;
  const scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
  const width = Math.max(1, Math.round((img.width || 1) * scale));
  const height = Math.max(1, Math.round((img.height || 1) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image processing is unavailable.");
  ctx.drawImage(img, 0, 0, width, height);
  const jpeg = canvas.toDataURL("image/jpeg", 0.82);
  if (jpeg.length > 80_000) {
    return canvas.toDataURL("image/jpeg", 0.6);
  }
  return jpeg;
}

export function AccountSettingsPage({
  onBackToChats,
  onLogout,
}: {
  onBackToChats: () => void;
  onLogout: () => void;
}) {
  const { api, user, updateUser } = useAuth();
  const profileAvatar = useProfileAvatar(api, user);
  // The phone's top-right QR on MY profile (owner 2026-10-19: "web a profile a
  // qr option nai" — own card included). Own code mints on first open, same as
  // the phone's pane.
  const [qrOpen, setQrOpen] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [about, setAbout] = useState(user?.about ?? "");
  const [usernameState, setUsernameState] = useState<
    "same" | "checking" | "available" | "taken" | "invalid"
  >("same");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMessage, setAvatarMessage] = useState("");
  const [devices, setDevices] = useState<AuthDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [devicesError, setDevicesError] = useState("");
  const [privacyBusy, setPrivacyBusy] = useState<string | null>(null);
  const [privacyError, setPrivacyError] = useState("");
  const [backupPassphrase, setBackupPassphrase] = useState("");
  const [backupHasServerCopy, setBackupHasServerCopy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState("");
  const [backupSaved, setBackupSaved] = useState("");

  const privacy = useMemo(() => ({ ...defaultPrivacy, ...(user?.privacy ?? {}) }), [user?.privacy]);
  const profileChanged =
    displayName.trim() !== (user?.displayName ?? "") ||
    username.trim().toLowerCase() !== (user?.username ?? "") ||
    about !== (user?.about ?? "");
  const usernameValid = /^[a-z0-9_]{3,30}$/.test(username.trim().toLowerCase());
  const canSaveProfile =
    profileChanged &&
    !profileBusy &&
    displayName.trim().length > 0 &&
    displayName.trim().length <= 40 &&
    usernameValid &&
    (username.trim().toLowerCase() === (user?.username ?? "") || usernameState === "available");

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName ?? "");
    setUsername(user.username ?? "");
    setAbout(user.about ?? "");
    setProfileError("");
  }, [user?.id]);

  useEffect(() => {
    const normalized = username.trim().toLowerCase();
    if (normalized === (user?.username ?? "")) {
      setUsernameState("same");
      return;
    }
    if (!/^[a-z0-9_]{3,30}$/.test(normalized)) {
      setUsernameState("invalid");
      return;
    }

    setUsernameState("checking");
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void authApi
        .checkUsername(api, normalized, controller.signal)
        .then((result) => setUsernameState(result.available ? "available" : "taken"))
        .catch((error) => {
          if (!(error instanceof ApiError && error.kind === "aborted")) setUsernameState("invalid");
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [api, username, user?.username]);

  async function loadDevices() {
    setDevicesLoading(true);
    setDevicesError("");
    try {
      const result = await authApi.getDevices(api);
      setDevices(Array.isArray(result.items) ? result.items : []);
    } catch (error) {
      setDevicesError(authErrorCopy(error));
    } finally {
      setDevicesLoading(false);
    }
  }

  useEffect(() => {
    void loadDevices();
    let active = true;
    void authApi
      .getE2eeBackup(api)
      .then((res) => {
        if (active) setBackupHasServerCopy(isPassphraseBackup(res.blob ?? ""));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, user?.id]);

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || avatarBusy) return;
    setAvatarBusy(true);
    setProfileError("");
    setAvatarMessage("");
    try {
      const dataUrl = await readAvatarDataUrl(file);
      const result = await authApi.updateMe(api, { avatarUrl: dataUrl });
      updateUser(result.user);
      setAvatarMessage("Profile photo updated.");
    } catch (error) {
      setProfileError(safeProfileError(error));
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleAvatarRemove() {
    if (avatarBusy) return;
    setAvatarBusy(true);
    setProfileError("");
    setAvatarMessage("");
    try {
      const result = await authApi.updateMe(api, { avatarUrl: "" });
      updateUser(result.user);
      setAvatarMessage("Profile photo removed.");
    } catch (error) {
      setProfileError(safeProfileError(error));
    } finally {
      setAvatarBusy(false);
    }
  }

  async function saveE2eeBackup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (backupBusy || backupPassphrase.length < 6) return;
    setBackupBusy(true);
    setBackupError("");
    setBackupSaved("");
    try {
      let identity = parseStoredIdentity(window.localStorage.getItem(E2EE_STORAGE_KEY));
      if (!identity) {
        identity = await generateIdentity();
        window.localStorage.setItem(E2EE_STORAGE_KEY, JSON.stringify(identity));
      }
      if (user?.e2eePublicKey !== identity.u) {
        const updated = await authApi.updateMe(api, { e2eePublicKey: identity.u });
        updateUser(updated.user);
      }
      const sealed = await sealPassphraseBackup(identity, backupPassphrase);
      if (!sealed) throw new Error("Could not encrypt key backup.");
      await authApi.putE2eeBackup(api, sealed);
      setBackupHasServerCopy(true);
      setBackupPassphrase("");
      setBackupSaved("Encrypted KP2 key backup saved.");
    } catch (error) {
      setBackupError(authErrorCopy(error));
    } finally {
      setBackupBusy(false);
    }
  }

  async function clearE2eeBackup() {
    if (backupBusy) return;
    setBackupBusy(true);
    setBackupError("");
    setBackupSaved("");
    try {
      await authApi.putE2eeBackup(api, "");
      setBackupHasServerCopy(false);
      setBackupSaved("Server key backup cleared.");
    } catch (error) {
      setBackupError(authErrorCopy(error));
    } finally {
      setBackupBusy(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSaveProfile) return;
    setProfileBusy(true);
    setProfileError("");
    setProfileSaved(false);
    try {
      const result = await authApi.updateMe(api, {
        displayName: displayName.trim(),
        username: username.trim().toLowerCase(),
        about,
      });
      updateUser(result.user);
      setProfileSaved(true);
    } catch (error) {
      setProfileError(safeProfileError(error));
    } finally {
      setProfileBusy(false);
    }
  }

  async function updatePrivacy(
    field: PrivacyField | BooleanPrivacyField,
    value: PrivacyValue | boolean,
  ) {
    setPrivacyBusy(field);
    setPrivacyError("");
    try {
      const result = await authApi.updateMe(api, { [field]: value });
      updateUser(result.user);
    } catch (error) {
      setPrivacyError(authErrorCopy(error));
    } finally {
      setPrivacyBusy(null);
    }
  }

  if (!user) {
    return (
      <main className="settings-page">
        <div className="settings-surface settings-surface--message">
          <p role="status">Loading account…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="settings-page">
      <div className="settings-shell">
        <header className="settings-header">
          <div className="settings-header__brand">
            <BrandMark size={40} />
            <div>
              <p className="eyebrow">KUCHUPUCHU WEB</p>
              <h1>Account &amp; settings</h1>
            </div>
          </div>
          <div className="settings-header__actions">
            <button
              className="secondary-button secondary-button--compact"
              type="button"
              onClick={onBackToChats}
            >
              <Icon name="arrow" size={15} /> Back to Chats
            </button>
            <button className="text-button" type="button" onClick={onLogout}>
              Sign out
            </button>
          </div>
        </header>

        <section className="account-hero" aria-label="Your account">
          <div className="account-avatar" aria-hidden="true">
            {profileAvatar.src ? (
              <img
                className="avatar-img"
                src={profileAvatar.src}
                alt=""
                draggable={false}
                onError={profileAvatar.onError}
              />
            ) : (
              initials(user)
            )}
          </div>
          <div className="account-hero__identity">
            <p className="eyebrow">SIGNED-IN ACCOUNT</p>
            <h2>
              {user.displayName || user.username}
              <RealmBadge realm={originRealmOf(user)} />
            </h2>
            <p>@{user.username}</p>
          </div>
          <div className="account-hero__details">
            {user.phone && (
              <span>
                <strong>Phone</strong>
                {user.phone}
              </span>
            )}
            {user.email && (
              <span>
                <strong>Email</strong>
                {user.email}
              </span>
            )}
            <span>
              <strong>Google</strong>
              {user.googleLinked ? "Linked" : "Not linked"}
            </span>
          </div>
        </section>

        <div className="settings-grid">
          <section className="settings-card" aria-labelledby="profile-heading">
            <div className="settings-card__heading">
              <div>
                <p className="eyebrow">YOUR IDENTITY</p>
                <h2 id="profile-heading">Profile</h2>
              </div>
              <span className="settings-card__icon">
                <Icon name="profile" size={19} />
              </span>
            </div>
            <div className="settings-avatar-controls">
              <input
                ref={avatarInputRef}
                id="profile-avatar-upload"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                aria-label="Upload profile photo"
                onChange={(event) => void handleAvatarChange(event)}
              />
              <button
                type="button"
                className="secondary-button secondary-button--compact"
                disabled={avatarBusy}
                onClick={() => avatarInputRef.current?.click()}
              >
                {avatarBusy ? "Updating photo…" : "Change photo"}
              </button>
              <button
                type="button"
                className="secondary-button secondary-button--compact"
                onClick={() => setQrOpen(true)}
              >
                <Icon name="link" size={15} /> QR code
              </button>
              {(profileAvatar.src || user.avatarUrl || user.avatarRef) && (
                <button
                  type="button"
                  className="text-button"
                  disabled={avatarBusy}
                  onClick={() => void handleAvatarRemove()}
                >
                  Remove photo
                </button>
              )}
              {avatarMessage && (
                <span className="settings-success" role="status">
                  {avatarMessage}
                </span>
              )}
            </div>
            <form className="settings-form" onSubmit={saveProfile}>
              <label className="field-label" htmlFor="profile-display-name">
                Display name
              </label>
              <input
                id="profile-display-name"
                className="auth-input"
                value={displayName}
                maxLength={40}
                autoComplete="name"
                onChange={(event) => {
                  setDisplayName(event.target.value);
                  setProfileSaved(false);
                }}
              />

              <label className="field-label" htmlFor="profile-username">
                Username
              </label>
              <input
                id="profile-username"
                className="auth-input"
                value={username}
                maxLength={30}
                autoComplete="username"
                onChange={(event) => {
                  setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""));
                  setProfileSaved(false);
                }}
                aria-describedby="username-help"
              />
              <p id="username-help" className={`field-help field-help--${usernameState}`}>
                {usernameState === "same"
                  ? "Your current username."
                  : usernameState === "checking"
                    ? "Checking availability…"
                    : usernameState === "available"
                      ? "Username is available."
                      : usernameState === "taken"
                        ? "That username is already in use."
                        : "Use 3–30 lowercase letters, numbers or underscores."}
              </p>

              <label className="field-label" htmlFor="profile-about">
                About
              </label>
              <textarea
                id="profile-about"
                className="auth-input settings-textarea"
                value={about}
                maxLength={160}
                rows={3}
                onChange={(event) => {
                  setAbout(event.target.value);
                  setProfileSaved(false);
                }}
              />
              <div className="form-footer-row">
                <span className="field-help">{about.length}/160</span>
                <button
                  className="primary-button primary-button--small"
                  type="submit"
                  disabled={!canSaveProfile}
                >
                  {profileBusy ? "Saving…" : "Save profile"}
                </button>
              </div>
              {profileError && (
                <p className="settings-error" role="alert">
                  {profileError}
                </p>
              )}
              {profileSaved && (
                <p className="settings-success" role="status">
                  Profile saved.
                </p>
              )}
            </form>
          </section>

          <section className="settings-card" aria-labelledby="privacy-heading">
            <div className="settings-card__heading">
              <div>
                <p className="eyebrow">CONTROL YOUR VISIBILITY</p>
                <h2 id="privacy-heading">Privacy</h2>
              </div>
              <span className="settings-card__icon">
                <Icon name="lock" size={18} />
              </span>
            </div>
            <div className="privacy-list">
              {privacyOptions.map(({ field, key, label }) => (
                <label className="privacy-row" key={field}>
                  <span>{label}</span>
                  <select
                    className="privacy-select"
                    aria-label={`${label} visibility`}
                    value={privacy[key] as PrivacyValue}
                    onChange={(event) =>
                      void updatePrivacy(field, event.target.value as PrivacyValue)
                    }
                    disabled={privacyBusy !== null}
                  >
                    <option value="public">Everyone</option>
                    <option value="contacts">Contacts</option>
                    <option value="nobody">Nobody</option>
                  </select>
                </label>
              ))}
              <label className="privacy-row privacy-row--toggle">
                <span>Private profile</span>
                <input
                  type="checkbox"
                  checked={privacy.privateProfile}
                  onChange={(event) => void updatePrivacy("privateProfile", event.target.checked)}
                  disabled={privacyBusy !== null}
                />
              </label>
            </div>
            {privacyBusy && (
              <p className="field-help" role="status">
                Saving privacy setting…
              </p>
            )}
            {privacyError && (
              <p className="settings-error" role="alert">
                {privacyError}
              </p>
            )}
          </section>

          <section className="settings-card settings-card--wide" aria-labelledby="devices-heading">
            <div className="settings-card__heading">
              <div>
                <p className="eyebrow">SIGNED-IN SESSIONS</p>
                <h2 id="devices-heading">Devices</h2>
              </div>
              <button
                className="text-button"
                type="button"
                onClick={() => void loadDevices()}
                disabled={devicesLoading}
              >
                {devicesLoading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            {devicesLoading ? (
              <p className="settings-empty" role="status">
                Loading devices…
              </p>
            ) : devicesError ? (
              <div className="settings-error-block">
                <p role="alert">{devicesError}</p>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void loadDevices()}
                >
                  Try again
                </button>
              </div>
            ) : devices.length === 0 ? (
              <p className="settings-empty">No device sessions were returned for this account.</p>
            ) : (
              <ul className="device-list">
                {devices.map((device) => (
                  <li className="device-row" key={device.deviceId}>
                    <div
                      className={`device-glyph${device.active ? " is-active" : ""}`}
                      aria-hidden="true"
                    >
                      <Icon
                        name={device.platform.toUpperCase() === "WEB" ? "profile" : "settings"}
                        size={18}
                      />
                    </div>
                    <div className="device-row__main">
                      <div className="device-row__title">
                        <strong>
                          {device.name ||
                            (device.platform.toUpperCase() === "WEB"
                              ? "Web browser"
                              : "Android device")}
                        </strong>
                        {device.current && (
                          <span className="current-device-badge">This browser</span>
                        )}
                      </div>
                      <p>
                        {device.platform.toUpperCase()} · Last active{" "}
                        {formatTimestamp(device.lastSeenAt)}
                      </p>
                      {device.place && (
                        <p className="device-row__place">Last location: {device.place}</p>
                      )}
                    </div>
                    <span className={`device-status${device.active ? " is-active" : ""}`}>
                      {device.active ? "Active" : "Signed out"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="settings-footnote">
              This Worker contract exposes session listing and sign-out for this browser. Remote
              device revocation is not available here; sign out on that device to end its session.
            </p>
          </section>

          <section className="settings-card" aria-labelledby="e2ee-backup-heading">
            <div className="settings-card__heading">
              <div>
                <p className="eyebrow">END-TO-END ENCRYPTION</p>
                <h2 id="e2ee-backup-heading">Message key backup</h2>
              </div>
              <span className="settings-card__icon">
                <Icon name="lock" size={18} />
              </span>
            </div>
            <p className="field-help">
              {backupHasServerCopy
                ? "An encrypted KP2 key backup is stored on the server."
                : "Seal your P-256 message identity with a passphrase (PBKDF2-SHA256 + AES-GCM) so another browser or phone can adopt the same keypair."}
            </p>
            <form className="settings-form" onSubmit={saveE2eeBackup}>
              <label className="field-label" htmlFor="e2ee-backup-passphrase">
                Backup passphrase (6+ characters)
              </label>
              <input
                id="e2ee-backup-passphrase"
                type="password"
                className="auth-input"
                value={backupPassphrase}
                minLength={6}
                autoComplete="new-password"
                placeholder="Enter a strong passphrase"
                onChange={(event) => {
                  setBackupPassphrase(event.target.value);
                  setBackupSaved("");
                }}
              />
              <div className="form-footer-row">
                {backupHasServerCopy ? (
                  <button
                    type="button"
                    className="text-button"
                    disabled={backupBusy}
                    onClick={() => void clearE2eeBackup()}
                  >
                    Remove backup
                  </button>
                ) : (
                  <span className="field-help">Passphrase never leaves this browser</span>
                )}
                <button
                  className="primary-button primary-button--small"
                  type="submit"
                  disabled={backupBusy || backupPassphrase.length < 6}
                >
                  {backupBusy ? "Sealing…" : "Save key backup"}
                </button>
              </div>
              {backupError && (
                <p className="settings-error" role="alert">
                  {backupError}
                </p>
              )}
              {backupSaved && (
                <p className="settings-success" role="status">
                  {backupSaved}
                </p>
              )}
            </form>
          </section>

          {isWebFeatureEnabled("push") && <PushSettingsSection api={api} />}

          {isWebFeatureEnabled("calls") && <CallSettingsSection />}
        </div>

        <footer className="settings-footer">
          <RouteLink
            route={{ kind: "section", section: "chats" }}
            navigate={() => onBackToChats()}
            className="settings-footer__link"
          >
            {isWebFeatureEnabled("messaging") ? "Return to Chats" : "Return to Chats preview"}
          </RouteLink>
          <span>Account data is loaded from the KuchuPuchu Worker.</span>
        </footer>
      </div>

      {qrOpen && api && user ? (
        <ProfileQrDialog
          api={api}
          user={{
            id: user.id,
            originRealm: originRealmOf(user),
            displayName: user.displayName,
            username: user.username,
            qrCode: (user as { qrCode?: string | null }).qrCode ?? null,
            avatarRef: user.avatarRef ?? "",
            verified: user.verified,
            moderator: user.moderator,
            badge: user.badge ?? null,
          }}
          self={true}
          onClose={() => setQrOpen(false)}
        />
      ) : null}
    </main>
  );
}

import { Suspense, lazy, useState, type ReactNode } from "react";
import { isWebFeatureEnabled } from "./featureFlags";
import { BrandMark, Icon, type IconName } from "./icons";
import { RouteLink } from "./RouteLink";
import { useBrowserRouter } from "./useBrowserRouter";
import { useConnectivity } from "./useConnectivity";
import { AccountSettingsPage } from "./auth/AccountSettingsPage";
import { AuthScreen } from "./auth/AuthScreen";
import { useAuth } from "./auth/AuthContext";

import { routeRequiresAuthentication, type AppRoute, type SectionId } from "./router";

/**
 * The messaging workspace is a lazy chunk: a build with the messaging flag off
 * — which is every production build today — never downloads or parses the chat
 * list, the crypto or the 1,150-glyph sticker catalog. The service worker
 * precaches every emitted chunk, so an opt-in build still works offline.
 */
const MessagingWorkspace = lazy(() =>
  import("./messaging/MessagingWorkspace").then((module) => ({
    default: module.MessagingWorkspace,
  })),
);

type View = {
  id: Exclude<SectionId, "account">;
  label: string;
  icon: IconName;
};

const views: View[] = [
  { id: "chats", label: "Chats", icon: "chats" },
  { id: "statuses", label: "Status", icon: "status" },
  { id: "calls", label: "Calls", icon: "calls" },
  { id: "search", label: "Search", icon: "search" },
];

const viewDescriptions: Record<Exclude<SectionId, "account">, string> = {
  chats: "Messaging is not enabled in this Web rollout. No chats or messages are loaded here.",
  statuses: "Status feed and viewer integration remain disabled in this Web rollout.",
  calls: "Call history and browser calling remain disabled in this Web rollout.",
  search: "Search is not connected to KuchuPuchu accounts or conversations in this build.",
};

function routeIsAccount(route: AppRoute): boolean {
  return route.kind === "section" && route.section === "account";
}

function FullPageNotice({
  eyebrow,
  title,
  body,
  onBack,
  action,
}: {
  eyebrow: string;
  title: string;
  body: string;
  onBack: () => void;
  action?: ReactNode;
}) {
  return (
    <main className="auth-page">
      <div className="auth-background-glow auth-background-glow--blue" />
      <section className="auth-card notice-card" aria-labelledby="notice-heading">
        <div className="notice-brand">
          <BrandMark size={46} />
        </div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 id="notice-heading">{title}</h1>
        <p className="auth-copy">{body}</p>
        {action}
        <button className="text-button" type="button" onClick={onBack}>
          Back to Chats preview
        </button>
      </section>
    </main>
  );
}

function AccountRolloutGate({ onBack }: { onBack: () => void }) {
  return (
    <FullPageNotice
      eyebrow="ACCOUNT ROLLOUT"
      title="Account tools are off in this build"
      body="Browser sign-in, profile and device settings are protected by the default-off account rollout flag. This page makes no account API calls while the flag is off. Messaging, status, media and calls are also disabled."
      onBack={onBack}
    />
  );
}

function SessionRestoreFailure({
  onBack,
  onSignOut,
}: {
  onBack: () => void;
  onSignOut: () => void;
}) {
  const { restoreError, retryRestore } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function retry() {
    setBusy(true);
    setError("");
    const restored = await retryRestore();
    if (!restored)
      setError(
        "The saved session could not be verified. Check your connection, retry, or sign in again.",
      );
    setBusy(false);
  }

  return (
    <FullPageNotice
      eyebrow="SESSION CHECK"
      title="We could not verify this session"
      body={
        restoreError ||
        "Protected account data will stay hidden until the saved session is verified."
      }
      onBack={onBack}
      action={
        <div className="notice-actions">
          <button
            className="primary-button"
            type="button"
            onClick={() => void retry()}
            disabled={busy}
          >
            {busy ? "Checking…" : "Retry session check"}
          </button>
          <button className="secondary-button" type="button" onClick={onSignOut} disabled={busy}>
            Sign out saved session
          </button>
          {error && (
            <p className="settings-error" role="alert">
              {error}
            </p>
          )}
        </div>
      }
    />
  );
}

export default function App() {
  const { route, navigate } = useBrowserRouter();
  const { status: authStatus, user, logout } = useAuth();
  const [sessionNotice, setSessionNotice] = useState("");
  const isOnline = useConnectivity();
  const accountEnabled = isWebFeatureEnabled("accountIntegration");
  const messagingEnabled = isWebFeatureEnabled("messaging");
  const isNotFound = route.kind === "not-found";
  const isConversation = route.kind === "conversation";
  const isAccountRoute = routeIsAccount(route);
  const protectedRoute = routeRequiresAuthentication(route);
  const isChatsArea =
    route.kind === "conversation" || (route.kind === "section" && route.section === "chats");
  // With messaging on, the chat list itself carries private data, so it needs a
  // verified session too — not just the deep-link and account routes.
  const needsSession = protectedRoute || (messagingEnabled && isChatsArea);
  const goToChats = () => navigate({ kind: "section", section: "chats" });
  const logOutToChats = () => {
    navigate({ kind: "section", section: "chats" }, { replace: true });
    setSessionNotice("");
    void logout().then((remoteRevoked) => {
      setSessionNotice(
        remoteRevoked
          ? "This browser is signed out."
          : "This browser was signed out locally, but the service could not confirm revocation. Reconnect and retry if needed.",
      );
    });
  };

  if (isAccountRoute && !accountEnabled) {
    return <AccountRolloutGate onBack={goToChats} />;
  }

  if (messagingEnabled && needsSession && !accountEnabled) {
    return (
      <FullPageNotice
        eyebrow="MESSAGING ROLLOUT"
        title="Chats need account access"
        body="Messaging loads private conversation data, so it requires a verified browser session. That session lives behind the account rollout flag, which is off in this build. No conversation request is made until both flags are on."
        onBack={goToChats}
      />
    );
  }

  if ((accountEnabled || messagingEnabled) && needsSession) {
    if (authStatus === "restoring") {
      return (
        <main className="auth-page">
          <section className="auth-card settings-surface--message" role="status" aria-live="polite">
            <BrandMark size={46} />
            <p className="eyebrow">SESSION CHECK</p>
            <h1>Checking your session…</h1>
            <p className="auth-copy">
              Protected account data stays hidden until the Worker confirms this browser session.
            </p>
          </section>
        </main>
      );
    }
    if (authStatus === "unverified")
      return <SessionRestoreFailure onBack={goToChats} onSignOut={logOutToChats} />;
    if (authStatus !== "signed-in") return <AuthScreen onBackToChats={goToChats} />;

    if (isAccountRoute) {
      return <AccountSettingsPage onBackToChats={goToChats} onLogout={logOutToChats} />;
    }
  }

  const activeViewId =
    route.kind === "section" && route.section !== "account"
      ? route.section
      : isConversation
        ? "chats"
        : null;
  const active = views.find((view) => view.id === activeViewId) ?? views[0]!;
  const sectionHeading = isNotFound ? "Not found" : active.label;
  const bannerCopy = messagingEnabled
    ? "Messaging is enabled for this opt-in build: chats, live updates and sealed text are on. Status, media and calls remain disabled."
    : accountEnabled
      ? "Account flows are enabled for this opt-in build; messaging, status, media and calls remain disabled."
      : "Account sign-in remains behind a default-off rollout flag; messaging, status, media and calls are disabled.";
  const accountChipLabel = user
    ? `${user.displayName || user.username} account signed in`
    : "No account signed in";
  const accountInitials = user
    ? (user.displayName || user.username).trim().slice(0, 2).toUpperCase()
    : "KP";

  return (
    <div className="kp-app">
      <div className="preview-banner" role="status">
        <span className="preview-banner__dot" />
        <strong>Foundation preview</strong>
        <span className="preview-banner__divider" />
        <span>{bannerCopy}</span>
      </div>

      <div className="workspace">
        <aside className="nav-rail" aria-label="KuchuPuchu navigation">
          <div className="brand-lockup" role="img" aria-label="KuchuPuchu Web">
            <BrandMark />
            <span className="brand-wordmark">kp</span>
          </div>

          <nav className="primary-nav" aria-label="Main sections">
            {views.map((view) => (
              <RouteLink
                key={view.id}
                route={{ kind: "section", section: view.id }}
                navigate={navigate}
                className={`nav-button${activeViewId === view.id ? " is-active" : ""}`}
                aria-label={view.label}
                aria-current={activeViewId === view.id ? "page" : undefined}
                title={view.label}
              >
                <Icon name={view.icon} size={21} />
                <span>{view.label}</span>
              </RouteLink>
            ))}
          </nav>

          <div className="rail-bottom">
            <RouteLink
              route={{ kind: "section", section: "account" }}
              navigate={navigate}
              className={`nav-button nav-button--muted${isAccountRoute ? " is-active" : ""}`}
              aria-label="Account settings"
              aria-current={isAccountRoute ? "page" : undefined}
              title="Account settings"
            >
              <Icon name="settings" size={20} />
              <span>Settings</span>
            </RouteLink>
            <div className="account-chip" role="img" aria-label={accountChipLabel}>
              <div className="account-chip__avatar">{accountInitials}</div>
              <span className={`account-chip__status${user ? " is-signed-in" : ""}`} />
            </div>
          </div>
        </aside>

        {messagingEnabled && isChatsArea ? (
          <Suspense fallback={<p className="welcome-card__body">Loading chats…</p>}>
            <MessagingWorkspace route={route} navigate={navigate} isOnline={isOnline} />
          </Suspense>
        ) : (
          <>
            <section
              className={`list-pane${isConversation ? " is-mobile-hidden" : ""}`}
              aria-labelledby="list-heading"
            >
              <header className="list-header">
                <div>
                  <p className="eyebrow">KUCHUPUCHU WEB</p>
                  <h1 id="list-heading">{sectionHeading}</h1>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={
                    messagingEnabled
                      ? "New chat arrives in a later slice"
                      : "Start a new chat; messaging is disabled"
                  }
                  title={
                    messagingEnabled
                      ? "Contact search and New chat arrive in a later slice"
                      : "Messaging is not enabled in this build"
                  }
                  disabled
                >
                  <Icon name="plus" size={21} />
                </button>
              </header>

              {sessionNotice && (
                <p className="workspace-notice" role="status">
                  {sessionNotice}
                </p>
              )}

              <label className="search-field">
                <Icon name="search" size={18} />
                <input
                  type="search"
                  aria-label={
                    isNotFound ? "Search unavailable" : `Search ${active.label.toLowerCase()}`
                  }
                  placeholder={
                    isNotFound ? "Search unavailable" : `Search ${active.label.toLowerCase()}`
                  }
                  disabled
                />
                <kbd>/</kbd>
              </label>

              <div className="list-content">
                <div className="empty-list-icon">
                  <Icon name={isNotFound ? "search" : active.icon} size={22} />
                </div>
                <h2>
                  {isNotFound ? "That page isn't here" : `No ${active.label.toLowerCase()} loaded`}
                </h2>
                <p>
                  {isNotFound
                    ? "This address does not match a page in the Web preview."
                    : viewDescriptions[active.id]}
                </p>
                {isNotFound ? (
                  <RouteLink
                    route={{ kind: "section", section: "chats" }}
                    navigate={navigate}
                    className="route-action-link"
                  >
                    <span>Return to Chats</span>
                    <Icon name="arrow" size={15} />
                  </RouteLink>
                ) : (
                  <span className="integration-badge">
                    <Icon name="lock" size={13} />
                    <span>
                      {user
                        ? "Account connected; product data remains gated"
                        : "No private account data loaded"}
                    </span>
                  </span>
                )}
              </div>

              <footer className="list-footer" role="status" aria-live="polite">
                <span className={`connection-indicator${isOnline ? "" : " is-offline"}`} />
                <span>
                  {!isOnline ? "Browser offline" : user ? "Account connected" : "Preview only"}
                </span>
                <span className="list-footer__spacer" />
                <span className="footer-version">Web P2 preview</span>
              </footer>
            </section>

            <main
              className={`conversation-pane${isConversation ? " is-mobile-visible" : ""}`}
              aria-labelledby="conversation-heading"
            >
              <header className="conversation-header">
                <div className="conversation-header__identity">
                  {isConversation && (
                    <RouteLink
                      route={{ kind: "section", section: "chats" }}
                      navigate={navigate}
                      className="conversation-back"
                      aria-label="Back to Chats"
                      title="Back to Chats"
                    >
                      <Icon name="arrow" size={19} />
                    </RouteLink>
                  )}
                  <div className="conversation-avatar conversation-avatar--empty">
                    <Icon name="message" size={20} />
                  </div>
                  <div className="conversation-header__copy">
                    <h2 id="conversation-heading">
                      {isConversation
                        ? "Conversation preview"
                        : isNotFound
                          ? "Page not found"
                          : "Choose a conversation"}
                    </h2>
                    <p>
                      {isConversation
                        ? user
                          ? "This protected route is open; messaging is still disabled"
                          : "This address requires a signed-in account"
                        : isNotFound
                          ? "This address is not defined in the preview"
                          : user
                            ? "Account signed in; message data is not connected"
                            : "No KuchuPuchu account is signed in"}
                    </p>
                  </div>
                </div>
                <div className="conversation-actions" aria-label="Conversation actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Search in conversation"
                    disabled
                  >
                    <Icon name="search" size={19} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="More conversation actions"
                    disabled
                  >
                    <Icon name="more" size={20} />
                  </button>
                </div>
              </header>

              <section
                className="conversation-canvas"
                aria-label={isNotFound ? "Not found preview" : "Conversation preview"}
              >
                <div className="canvas-glow canvas-glow--blue" />
                <div className="canvas-glow canvas-glow--amber" />
                <div className="welcome-card">
                  <div className="welcome-card__mark">
                    <BrandMark size={52} />
                    <span className="welcome-card__sparkle">
                      <Icon name="sparkle" size={19} />
                    </span>
                  </div>
                  <p className="eyebrow">
                    {isConversation
                      ? "PROTECTED DEEP LINK"
                      : isNotFound
                        ? "ROUTE NOT FOUND"
                        : "DESKTOP WORKSPACE"}
                  </p>
                  <h3>
                    {isConversation
                      ? "Conversation route recognized."
                      : isNotFound
                        ? "This route isn't available."
                        : "Conversation, contacts and context—together."}
                  </h3>
                  <p className="welcome-card__body">
                    {isConversation
                      ? user
                        ? "This browser session is verified, but this rollout does not fetch chats or messages. No conversation content is displayed."
                        : "This URL is protected. Sign in before any conversation data can be requested."
                      : isNotFound
                        ? "The requested address is not part of this preview. Return to Chats to continue exploring the shell."
                        : "The browser account flow is separate from this production PWA. Messaging and conversation data remain disabled in this build."}
                  </p>
                  {!isNotFound && (
                    <div className="welcome-points" aria-label="Current rollout status">
                      <span>
                        <i /> Account settings
                      </span>
                      <span>
                        <i /> Protected routes
                      </span>
                      <span>
                        <i /> No messages loaded
                      </span>
                    </div>
                  )}
                  {isNotFound && (
                    <RouteLink
                      route={{ kind: "section", section: "chats" }}
                      navigate={navigate}
                      className="route-action-link"
                    >
                      <span>Go to Chats</span>
                      <Icon name="arrow" size={15} />
                    </RouteLink>
                  )}
                  <div className="welcome-card__note">
                    <Icon name="lock" size={15} />
                    <span>Messages, media, status and calls are not enabled.</span>
                  </div>
                </div>
              </section>

              <footer className="composer-preview" aria-disabled="true">
                <button
                  type="button"
                  className="icon-button composer-preview__attach"
                  aria-label="Attachments not connected"
                  disabled
                >
                  <Icon name="plus" size={20} />
                </button>
                <div className="composer-preview__input">
                  Messaging is not enabled in this rollout
                </div>
                <button
                  type="button"
                  className="send-button"
                  aria-label="Send message not connected"
                  disabled
                >
                  <Icon name="message" size={18} />
                </button>
              </footer>
            </main>
          </>
        )}
      </div>

      <nav className="mobile-nav" aria-label="Mobile sections">
        {views.map((view) => (
          <RouteLink
            key={view.id}
            route={{ kind: "section", section: view.id }}
            navigate={navigate}
            className={`mobile-nav__item${activeViewId === view.id ? " is-active" : ""}`}
            aria-current={activeViewId === view.id ? "page" : undefined}
          >
            <Icon name={view.icon} size={20} />
            <span>{view.label}</span>
          </RouteLink>
        ))}
        <RouteLink
          route={{ kind: "section", section: "account" }}
          navigate={navigate}
          className={`mobile-nav__item${isAccountRoute ? " is-active" : ""}`}
          aria-label="Account settings"
          aria-current={isAccountRoute ? "page" : undefined}
          title="Account settings"
        >
          <Icon name="settings" size={20} />
          <span>Account</span>
        </RouteLink>
      </nav>
    </div>
  );
}

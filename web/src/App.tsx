import { BrandMark, Icon, type IconName } from "./icons";
import { RouteLink } from "./RouteLink";
import { useBrowserRouter } from "./useBrowserRouter";
import type { SectionId } from "./router";

type View = {
  id: SectionId;
  label: string;
  icon: IconName;
};

const views: View[] = [
  { id: "chats", label: "Chats", icon: "chats" },
  { id: "statuses", label: "Status", icon: "status" },
  { id: "calls", label: "Calls", icon: "calls" },
  { id: "search", label: "Search", icon: "search" },
];

const viewDescriptions: Record<SectionId, string> = {
  chats: "Your conversations will appear here after account and API integration.",
  statuses: "Status feed and viewer integration is part of the next parity phase.",
  calls: "Call history and browser calling integration is part of a later phase.",
  search: "Search will connect to KuchuPuchu accounts and conversations in a later step.",
};

export default function App() {
  const { route, navigate } = useBrowserRouter();
  const isNotFound = route.kind === "not-found";
  const isConversation = route.kind === "conversation";
  const activeViewId = route.kind === "section" ? route.section : isConversation ? "chats" : null;
  const active = views.find((view) => view.id === activeViewId) ?? views[0]!;
  const sectionHeading = isNotFound ? "Not found" : active.label;

  return (
    <div className="kp-app">
      <div className="preview-banner" role="status">
        <span className="preview-banner__dot" />
        <strong>Foundation preview</strong>
        <span className="preview-banner__divider" />
        <span>
          Sign-in and account data are not connected yet. The current Web app remains unchanged.
        </span>
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
            <button
              type="button"
              className="nav-button nav-button--muted"
              aria-label="Settings integration is planned"
              title="Settings · integration planned"
              disabled
            >
              <Icon name="settings" size={20} />
              <span>Settings</span>
            </button>
            <div className="account-chip" role="img" aria-label="No account signed in">
              <div className="account-chip__avatar">KP</div>
              <span className="account-chip__status" />
            </div>
          </div>
        </aside>

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
              aria-label="Start a new chat after sign-in integration"
              title="New chat · integration planned"
              disabled
            >
              <Icon name="plus" size={21} />
            </button>
          </header>

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
                ? "This address does not match a page in the Web foundation preview."
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
                <span>Waiting for account integration</span>
              </span>
            )}
          </div>

          <footer className="list-footer">
            <span className="connection-indicator" />
            <span>Preview only</span>
            <span className="list-footer__spacer" />
            <span className="footer-version">Web foundation</span>
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
                    ? "The route is recognized; account data is not connected"
                    : isNotFound
                      ? "This address is not defined in the preview"
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
                  ? "DEEP LINK PREVIEW"
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
                  ? "This URL identifies a conversation route, but this preview has no account session or message data to load."
                  : isNotFound
                    ? "The requested address is not part of this preview. Return to Chats to continue exploring the shell."
                    : "This step establishes the responsive, keyboard-ready shell. Account, message and media data will be wired in without changing the existing production Web client."}
              </p>
              {!isNotFound && (
                <div className="welcome-points" aria-label="Foundation goals">
                  <span>
                    <i /> Multi-pane layout
                  </span>
                  <span>
                    <i /> Keyboard-ready controls
                  </span>
                  <span>
                    <i /> Same-origin API design
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
                <span>No messages or account data are shown in this preview.</span>
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
            <div className="composer-preview__input">Message integration comes in a later step</div>
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
      </nav>
    </div>
  );
}

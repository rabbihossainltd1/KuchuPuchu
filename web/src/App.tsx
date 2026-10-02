import { useState } from "react";
import { BrandMark, Icon, type IconName } from "./icons";

type ViewId = "chats" | "statuses" | "calls" | "search";

type View = {
  id: ViewId;
  label: string;
  icon: IconName;
};

const views: View[] = [
  { id: "chats", label: "Chats", icon: "chats" },
  { id: "statuses", label: "Status", icon: "status" },
  { id: "calls", label: "Calls", icon: "calls" },
  { id: "search", label: "Search", icon: "search" },
];

const viewDescriptions: Record<ViewId, string> = {
  chats: "Your conversations will appear here after account and API integration.",
  statuses: "Status feed and viewer integration is part of the next parity phase.",
  calls: "Call history and browser calling integration is part of a later phase.",
  search: "Search will connect to KuchuPuchu accounts and conversations in a later step.",
};

export default function App() {
  const [activeView, setActiveView] = useState<ViewId>("chats");
  const active = views.find((view) => view.id === activeView) ?? views[0]!;

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
              <button
                key={view.id}
                type="button"
                className={`nav-button${activeView === view.id ? " is-active" : ""}`}
                aria-label={view.label}
                aria-current={activeView === view.id ? "page" : undefined}
                title={view.label}
                onClick={() => setActiveView(view.id)}
              >
                <Icon name={view.icon} size={21} />
                <span>{view.label}</span>
              </button>
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

        <section className="list-pane" aria-labelledby="list-heading">
          <header className="list-header">
            <div>
              <p className="eyebrow">KUCHUPUCHU WEB</p>
              <h1 id="list-heading">{active.label}</h1>
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
              aria-label={`Search ${active.label.toLowerCase()}`}
              placeholder={`Search ${active.label.toLowerCase()}`}
              disabled
            />
            <kbd>/</kbd>
          </label>

          <div className="list-content">
            <div className="empty-list-icon">
              <Icon name={active.icon} size={22} />
            </div>
            <h2>No {active.label.toLowerCase()} loaded</h2>
            <p>{viewDescriptions[activeView]}</p>
            <span className="integration-badge">
              <Icon name="lock" size={13} />
              <span>Waiting for account integration</span>
            </span>
          </div>

          <footer className="list-footer">
            <span className="connection-indicator" />
            <span>Preview only</span>
            <span className="list-footer__spacer" />
            <span className="footer-version">Web foundation</span>
          </footer>
        </section>

        <main className="conversation-pane" aria-labelledby="conversation-heading">
          <header className="conversation-header">
            <div className="conversation-header__identity">
              <div className="conversation-avatar conversation-avatar--empty">
                <Icon name="message" size={20} />
              </div>
              <div className="conversation-header__copy">
                <h2 id="conversation-heading">Choose a conversation</h2>
                <p>No KuchuPuchu account is signed in</p>
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

          <section className="conversation-canvas" aria-label="Conversation preview">
            <div className="canvas-glow canvas-glow--blue" />
            <div className="canvas-glow canvas-glow--amber" />
            <div className="welcome-card">
              <div className="welcome-card__mark">
                <BrandMark size={52} />
                <span className="welcome-card__sparkle">
                  <Icon name="sparkle" size={19} />
                </span>
              </div>
              <p className="eyebrow">DESKTOP WORKSPACE</p>
              <h3>Conversation, contacts and context—together.</h3>
              <p className="welcome-card__body">
                This first step establishes the responsive, keyboard-ready shell. Account, message
                and media data will be wired in without changing the existing production Web client.
              </p>
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
          <button
            key={view.id}
            type="button"
            className={`mobile-nav__item${activeView === view.id ? " is-active" : ""}`}
            aria-current={activeView === view.id ? "page" : undefined}
            onClick={() => setActiveView(view.id)}
          >
            <Icon name={view.icon} size={20} />
            <span>{view.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

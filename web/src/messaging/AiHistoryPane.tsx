/**
 * Slice AI — the phone's AIHistoryScreen: "AI History / Your past KuchuPuchu
 * AI sessions" lists the archived runs (every "New chat" / incognito wipe
 * lands here), newest first; a row opens "Session / Read-only archive" with
 * the phone's capped bubbles. Copy is verbatim from the phone.
 */

import { useEffect, useState } from "react";
import type { ApiClient } from "../auth/authApi";
import { messagingApi } from "./messagingApi";
import { infoStamp } from "./MessageSheets";
import { Icon } from "../icons";

type Session = {
  id: string;
  startedAt: string;
  endedAt: string;
  messages: number;
};

type ArchivedRow = { senderId: string; kind: string; body: string; createdAt: string };

export function AiHistoryPane({
  api,
  meId,
  onClose,
}: {
  api: ApiClient | null;
  meId: string;
  onClose: () => void;
}) {
  const [sessions, setSessions] = useState<readonly Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Session | null>(null);
  const [rows, setRows] = useState<readonly ArchivedRow[]>([]);

  useEffect(() => {
    if (!api) return;
    let live = true;
    void messagingApi
      .listAiSessions(api)
      .then((list) => {
        if (live) setSessions(list);
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [api]);

  useEffect(() => {
    if (!api || !open) {
      setRows([]);
      return;
    }
    let live = true;
    void messagingApi
      .getAiSession(api, open.id)
      .then((list) => {
        if (live) setRows(list);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, open]);

  return (
    <div className="ai-history-overlay" role="presentation" onClick={onClose}>
      <section
        className="ai-history"
        role="dialog"
        aria-label={open ? "Session" : "AI History"}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ai-history__header">
          <button
            type="button"
            className="icon-button contacts-pane__back"
            aria-label="Back"
            onClick={() => {
              if (open) setOpen(null);
              else onClose();
            }}
          >
            <Icon name="arrow" size={22} />
          </button>
          <div>
            <p className="ai-history__title">{open ? "Session" : "AI History"}</p>
            <p className="ai-history__sub">
              {open ? "Read-only archive" : "Your past KuchuPuchu AI sessions"}
            </p>
          </div>
        </header>

        {!open && loading && (
          <p className="list-state" role="status">
            Loading your sessions…
          </p>
        )}

        {!open && !loading && sessions.length === 0 && (
          <p className="ai-history__empty">
            No past sessions yet.
            <br />
            Start a chat and pick “New chat” —
            <br />
            the old one lands here.
          </p>
        )}

        {!open && sessions.length > 0 && (
          <ul className="ai-history__list">
            {sessions.map((session) => (
              <li key={session.id}>
                <button type="button" className="ai-history__row" onClick={() => setOpen(session)}>
                  <span className="ai-history__clock" aria-hidden="true">
                    <Icon name="schedule" size={18} />
                  </span>
                  <span className="ai-history__row-body">
                    <span className="ai-history__row-title">{infoStamp(session.endedAt)}</span>
                    <span className="ai-history__row-sub">{session.messages} messages</span>
                  </span>
                  <span className="ai-history__view">View</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {open && (
          <div className="ai-history__transcript">
            {rows
              .filter((row) => row.body.trim() !== "")
              .map((row, index) => (
                <div
                  key={`${row.createdAt}-${index}`}
                  className={`ai-history__bubble-row${row.senderId === meId ? " is-own" : ""}`}
                >
                  <span className="ai-history__bubble">{row.body}</span>
                </div>
              ))}
          </div>
        )}
      </section>
    </div>
  );
}

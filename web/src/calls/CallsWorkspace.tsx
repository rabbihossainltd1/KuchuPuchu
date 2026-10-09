/**
 * The Calls tab: the finished-call history, in the phone's day sections, with a
 * call-back button on every row.
 *
 * `CallsTabScreen.kt` is the design being matched — date sections (Today /
 * Yesterday / weekday), a direction arrow, the missed-call red, and the gold
 * call-back circle. Two deliberate desktop changes, both required by the parity
 * plan:
 *
 * - The phone's icon-only call-back circle becomes a labelled button ("Voice" /
 *   "Video" with its glyph). No unlabeled icon-only control, and nothing that
 *   only exists on hover.
 * - A row is a real `<button>` that opens the chat, so it is reachable by
 *   keyboard, middle-click and screen reader alike.
 *
 * What the browser cannot do is stated here rather than hidden: calls from a
 * hidden chat are not filtered away (there is no Hidden screen in this build),
 * and a group row's call-back is refused with the reason, because no measured
 * participant cap exists yet for a Web mesh.
 */

import { useCallback } from "react";
import { Icon } from "../icons";
import { CALL_COPY, callBackTarget, type CallDaySection, type CallRow } from "./callsModel";
import { callRowView, type CallsController } from "./useCalls";

type Props = {
  readonly controller: CallsController;
  readonly meId: string;
  readonly onOpenChat: (peerId: string, conversationId: string) => void;
  readonly onCall: (row: CallRow) => void;
};

export function CallsWorkspace({ controller, meId, onOpenChat, onCall }: Props) {
  const { sections, rows, state, error, notice } = controller;

  const retry = useCallback(() => void controller.refresh(true), [controller]);

  return (
    <section className="calls-tab" aria-labelledby="calls-heading">
      <header className="calls-tab__head">
        <div>
          <p className="eyebrow">KUCHUPUCHU WEB</p>
          <h2 id="calls-heading">Calls</h2>
        </div>
        <button type="button" className="text-button" onClick={retry}>
          Refresh
        </button>
      </header>

      <p className="calls-tab__note">{CALL_COPY.historyHiddenNote}</p>

      {error && state === "error" ? (
        <div className="calls-tab__error" role="alert">
          <p>{error || CALL_COPY.historyError}</p>
          <button type="button" className="secondary-button" onClick={retry}>
            {CALL_COPY.historyRetry}
          </button>
        </div>
      ) : null}

      <div className="calls-tab__scroll">
        {rows.length === 0 && state === "loading" ? (
          <ul className="calls-tab__skeleton" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((index) => (
              <li key={index} />
            ))}
          </ul>
        ) : null}

        {rows.length === 0 && state === "loading" ? (
          <p className="sr-only" role="status">
            {CALL_COPY.historyLoading}
          </p>
        ) : null}

        {rows.length === 0 && state !== "loading" ? (
          <div className="calls-tab__empty">
            <Icon name="calls" size={26} />
            <h3>{CALL_COPY.historyEmptyTitle}</h3>
            <p>{CALL_COPY.historyEmptyNote}</p>
          </div>
        ) : null}

        {sections.map((section) => (
          <CallDay
            key={section.label}
            section={section}
            meId={meId}
            onOpenChat={onOpenChat}
            onCall={onCall}
          />
        ))}
      </div>

      <footer className="calls-tab__foot">
        <details className="chat-notes">
          <summary>{CALL_COPY.limitsTitle}</summary>
          <ul>
            <li>{CALL_COPY.limitRing}</li>
            <li>{CALL_COPY.limitTakeover}</li>
            <li>{CALL_COPY.limitBackground}</li>
            <li>{CALL_COPY.limitRoutes}</li>
            <li>{CALL_COPY.limitCapture}</li>
            <li>{CALL_COPY.groupRefused}</li>
          </ul>
        </details>
        {notice ? (
          <p className="calls-tab__notice" role="status">
            {notice}
          </p>
        ) : null}
      </footer>
    </section>
  );
}

function CallDay({
  section,
  meId,
  onOpenChat,
  onCall,
}: {
  readonly section: CallDaySection;
  readonly meId: string;
  readonly onOpenChat: (peerId: string, conversationId: string) => void;
  readonly onCall: (row: CallRow) => void;
}) {
  return (
    <>
      <h3 className="calls-tab__day">{section.label}</h3>
      <ul className="calls-tab__list">
        {section.rows.map((row) => (
          <CallHistoryRow
            key={row.id}
            row={row}
            meId={meId}
            onOpenChat={onOpenChat}
            onCall={onCall}
          />
        ))}
      </ul>
    </>
  );
}

function CallHistoryRow({
  row,
  meId,
  onOpenChat,
  onCall,
}: {
  readonly row: CallRow;
  readonly meId: string;
  readonly onOpenChat: (peerId: string, conversationId: string) => void;
  readonly onCall: (row: CallRow) => void;
}) {
  const view = callRowView(row, meId);
  const target = callBackTarget(row, meId);
  const video = view.video;

  return (
    <li className={`call-row${view.missed ? " call-row--missed" : ""}`}>
      <button
        type="button"
        className="call-row__open"
        onClick={() => onOpenChat(view.peerId, row.conversationId)}
        aria-label={`Open the chat with ${view.name}`}
      >
        <span className="call-row__avatar" aria-hidden="true">
          {view.avatar ? (
            <img src={view.avatar} alt="" />
          ) : (
            view.name.trim().charAt(0).toUpperCase() || "?"
          )}
        </span>
        <span className="call-row__copy">
          <span className="call-row__name">{view.name}</span>
          <span className="call-row__line">
            <Icon name={view.incoming ? "callIn" : "callOut"} size={13} />
            <span>
              {view.label} · {view.stamp}
            </span>
          </span>
        </span>
      </button>

      {/* The phone's gold call-back circle. A GROUP row keeps the button but
          refuses with the reason: no measured participant cap exists for a Web
          mesh yet, and a button that silently did nothing would be worse. */}
      {target ? (
        <button
          type="button"
          className="call-row__back"
          onClick={() => onCall(row)}
          aria-label={
            row.group
              ? `Group ${video ? "video" : "voice"} call is not available on the Web`
              : `Call ${view.name} back on ${video ? "video" : "voice"}`
          }
          title={row.group ? CALL_COPY.groupRefused : undefined}
        >
          <Icon name={video ? "videoCall" : "phone"} size={17} />
          <span>{video ? "Video" : "Voice"}</span>
        </button>
      ) : null}
    </li>
  );
}

/**
 * Conversation list pane.
 *
 * Rows are real links, so a chat is reachable by keyboard, middle-click and
 * deep link alike — the parity plan rules out hover-only or gesture-only
 * access. The filter only narrows chats already loaded, and says so.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../auth/authApi";
import { Icon } from "../icons";
import { RouteLink } from "../RouteLink";
import type { Navigate } from "../useBrowserRouter";
import { ArchivePane } from "./ArchivePane";
import { ConversationAvatar } from "./Avatar";
import { useArchivePullOpen } from "./useArchivePullOpen";
import { setArchivedFlag, setPinnedFlag, useConvFlags } from "./convFlags";
import { DeleteChatsDialog } from "./DeleteChatsDialog";
import { GroupCreatePane } from "./GroupCreatePane";
import { messagingApi } from "./messagingApi";
import { MuteChooser } from "./MuteChooser";
import { isBotConversation } from "./protocol";
import {
  clockTime,
  conversationPreviewText,
  conversationTitle,
  isOneWayConversation,
  type ConversationRow,
} from "./protocol";
import type { MessagingController } from "./useMessaging";

const ARCHIVE_PULL_RING = 2 * Math.PI * 21;

type Props = {
  controller: MessagingController;
  selectedId: string;
  navigate: Navigate;
  isOnline: boolean;
  api: ApiClient | null;
};

export function ConversationList({ controller, selectedId, navigate, isOnline, api }: Props) {
  const filterId = useId();
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selIds, setSelIds] = useState<readonly string[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [muteOpen, setMuteOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [createWith, setCreateWith] = useState<readonly string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const flags = useConvFlags();
  const listPaneRef = useRef<HTMLElement | null>(null);
  const listContentRef = useRef<HTMLDivElement | null>(null);
  const archivePullEnabled =
    !archiveOpen &&
    !menuOpen &&
    !createOpen &&
    !createWith &&
    !rowMenu &&
    !selecting &&
    !sheetOpen &&
    !muteOpen &&
    !deleteOpen;
  const archivePull = useArchivePullOpen({
    hostRef: listPaneRef,
    listRef: listContentRef,
    enabled: archivePullEnabled,
    onOpen: () => setArchiveOpen(true),
  });

  const selRows = controller.conversations.filter((row) => selIds.includes(row.id));
  const allPinned = selRows.length > 0 && selRows.every((row) => flags.pinned.includes(row.id));
  const allMuted = selRows.length > 0 && selRows.every((row) => row.muted);
  const firstSel = selRows[0];
  const canGroup = firstSel ? !firstSel.isGroup && !isBotConversation(firstSel) : false;
  const groupHandle = firstSel?.other?.username || firstSel?.other?.displayName || "";

  const clearSelect = () => {
    setSelecting(false);
    setSelIds([]);
    setSheetOpen(false);
    setMuteOpen(false);
    setDeleteOpen(false);
  };

  const toggleSel = (id: string) =>
    setSelIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  const muteSel = (call: boolean, msg: boolean) => {
    if (!api || selIds.length === 0) return;
    setBusy(true);
    void Promise.all(selIds.map((id) => messagingApi.setMute(api, id, { call, msg })))
      .then(() => controller.refreshList())
      .catch(() => controller.announce("That did not work. Check your connection and try again."))
      .finally(() => {
        setBusy(false);
        setMuteOpen(false);
        clearSelect();
      });
  };

  const deleteSel = (also: boolean) => {
    if (!api || selRows.length === 0) return;
    setBusy(true);
    void Promise.all(selRows.map((row) => messagingApi.deleteConversation(api, row.id, also)))
      .then(() => {
        controller.announce(selRows.length > 1 ? "Chats deleted" : "Chat deleted");
        return controller.refreshList();
      })
      .catch(() => controller.announce("That did not work. Check your connection and try again."))
      .finally(() => {
        setBusy(false);
        setDeleteOpen(false);
        clearSelect();
      });
  };

  // The phone's main list hides archived chats and floats pinned ones to
  // the top (ScreenStore order otherwise).
  const visible = useMemo(() => {
    const rows = controller.conversations.filter((row) => !flags.archived.includes(row.id));
    rows.sort((a, b) => Number(flags.pinned.includes(b.id)) - Number(flags.pinned.includes(a.id)));
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => conversationTitle(row).toLowerCase().includes(needle));
  }, [controller.conversations, query, flags]);

  const archivedCount = controller.conversations.filter(
    (row) => flags.archived.includes(row.id) && !row.hidden,
  ).length;

  useEffect(() => {
    if (!selecting) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearSelect();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting]);

  const unreadLabel = (row: ConversationRow) =>
    row.unread > 0 ? `, ${row.unread > 99 ? "more than 99" : row.unread} unread` : "";

  return (
    <section
      ref={listPaneRef}
      className={`list-pane${selectedId ? " is-mobile-hidden" : ""}`}
      aria-labelledby="list-heading"
      onClickCapture={archivePull.onClickCapture}
    >
      <header className="list-header">
        {selecting && (
          <>
            <button type="button" className="icon-button" aria-label="Close" onClick={clearSelect}>
              <Icon name="close" size={21} />
            </button>
            <h1 className="select-bar__count" id="list-heading">
              {selIds.length} selected
            </h1>
            <div className="list-header__menu">
              <button
                type="button"
                className="icon-button"
                aria-label="Menu"
                aria-haspopup="menu"
                aria-expanded={sheetOpen}
                disabled={selIds.length === 0}
                onClick={() => setSheetOpen((value) => !value)}
              >
                <Icon name="more" size={21} />
              </button>
              {sheetOpen && (
                <>
                  <button
                    type="button"
                    className="menu-backdrop"
                    aria-label="Close menu"
                    tabIndex={-1}
                    onClick={() => setSheetOpen(false)}
                  />
                  <div className="list-menu" role="menu" aria-label="Selected chats menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setSheetOpen(false);
                        setDeleteOpen(true);
                      }}
                    >
                      <Icon name="trash" size={18} />
                      Delete
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setSheetOpen(false);
                        setMuteOpen(true);
                      }}
                    >
                      <Icon name="bellOff" size={18} />
                      {allMuted ? "Unmute…" : "Mute…"}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        selIds.forEach((id) => setPinnedFlag(id, !allPinned));
                        clearSelect();
                      }}
                    >
                      <Icon name="pin" size={18} />
                      {allPinned ? "Unpin" : "Pin"}
                    </button>
                    {canGroup && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          const peers = selRows
                            .filter((row) => !row.isGroup && !isBotConversation(row))
                            .map((row) => row.other?.id ?? "")
                            .filter((id) => id !== "");
                          setCreateWith(
                            peers.length > 0 ? [...new Set(peers)] : [firstSel?.other?.id ?? ""],
                          );
                          clearSelect();
                        }}
                      >
                        <Icon name="group" size={18} />
                        Create group with {groupHandle}
                      </button>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        if (firstSel && !selIds.includes(firstSel.id)) toggleSel(firstSel.id);
                        setSheetOpen(false);
                      }}
                    >
                      <Icon name="check" size={18} />
                      Select
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
        {!selecting && (
          <>
            <div>
              <p className="eyebrow">KUCHUPUCHU WEB</p>
              <h1 id="list-heading">Chats</h1>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="New chat"
              title="New chat"
              onClick={() => navigate({ kind: "section", section: "search" })}
            >
              <Icon name="plus" size={21} />
            </button>
            {/* The phone's HomeMenuSheet rows, in the phone's order. */}
            <div className="list-header__menu">
              <button
                type="button"
                className="icon-button"
                aria-label="Menu"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((value) => !value)}
              >
                <Icon name="more" size={21} />
              </button>
              {menuOpen && (
                <>
                  <button
                    type="button"
                    className="menu-backdrop"
                    aria-label="Close menu"
                    tabIndex={-1}
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="list-menu" role="menu" aria-label="Chat list menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        navigate({ kind: "section", section: "account" });
                      }}
                    >
                      <Icon name="profile" size={18} />
                      My Profile
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        navigate({ kind: "section", section: "newcontact" });
                      }}
                    >
                      <Icon name="personAdd" size={18} />
                      New contact
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        navigate({ kind: "section", section: "contacts" });
                      }}
                    >
                      <Icon name="contactsBook" size={18} />
                      All contacts
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        setCreateOpen(true);
                      }}
                    >
                      <Icon name="group" size={18} />
                      New group
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        navigate({ kind: "section", section: "account" });
                      }}
                    >
                      <Icon name="settings" size={18} />
                      Settings
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </header>

      {(createOpen || createWith) && api && (
        <GroupCreatePane
          controller={controller}
          api={api}
          navigate={navigate}
          initialPeerIds={createWith ?? []}
          onClose={() => {
            setCreateOpen(false);
            setCreateWith(null);
          }}
        />
      )}

      <label className="search-field" htmlFor={filterId}>
        <Icon name="search" size={18} />
        <input
          id={filterId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Filter loaded chats by name"
          placeholder="Filter loaded chats"
        />
      </label>

      <div ref={listContentRef} className="list-content">
        <button type="button" className="archive-entry" onClick={() => setArchiveOpen(true)}>
          <Icon name="archive" size={18} />
          <span>Archived</span>
          <span className="archive-entry__count">({archivedCount})</span>
        </button>

        {archiveOpen && (
          <ArchivePane
            controller={controller}
            navigate={navigate}
            api={api}
            onClose={() => setArchiveOpen(false)}
          />
        )}

        {muteOpen && (
          <div
            className="ai-history-overlay"
            role="presentation"
            onClick={() => setMuteOpen(false)}
          >
            <section
              className="ai-history"
              role="dialog"
              aria-label="Mute"
              onClick={(event) => event.stopPropagation()}
            >
              <p className="chat-menu__title">Mute…</p>
              <MuteChooser
                callMuted={selRows.every((row) => row.mutedCall)}
                msgMuted={selRows.every((row) => row.mutedMsg)}
                onPick={muteSel}
              />
            </section>
          </div>
        )}

        {deleteOpen && (
          <DeleteChatsDialog
            rows={selRows}
            busy={busy}
            onConfirm={deleteSel}
            onClose={() => setDeleteOpen(false)}
          />
        )}

        {controller.listStatus === "loading" && controller.conversations.length === 0 && (
          <p className="list-state" role="status">
            Loading your chats…
          </p>
        )}

        {controller.listStatus === "error" && (
          <div className="list-state list-state--error" role="alert">
            <p>{controller.listError || "Chats could not be loaded."}</p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void controller.refreshList()}
            >
              Try again
            </button>
          </div>
        )}

        {controller.listStatus === "ready" && visible.length === 0 && (
          <div className="list-state">
            <div className="empty-list-icon">
              <Icon name="chats" size={22} />
            </div>
            <h2>{query ? "No loaded chat matches" : "No chats yet"}</h2>
            <p>
              {query
                ? "Clear the filter to see every loaded chat."
                : "Start one with the New chat button. Hidden chats never appear here."}
            </p>
            {query && (
              <button type="button" className="secondary-button" onClick={() => setQuery("")}>
                Clear filter
              </button>
            )}
          </div>
        )}

        {visible.length > 0 && (
          <ul className="conversation-rows" aria-label="Conversations">
            {visible.map((row) => {
              const isSelected = row.id === selectedId;
              const pinned = flags.pinned.includes(row.id);
              if (selecting) {
                const ticked = selIds.includes(row.id);
                return (
                  <li key={row.id} className="conversation-rows__item">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={ticked}
                      className={`conversation-row select-row${ticked ? " is-ticked" : ""}`}
                      aria-label={`${conversationTitle(row)}${unreadLabel(row)}`}
                      onClick={() => toggleSel(row.id)}
                    >
                      <span className={`select-row__box${ticked ? " on" : ""}`} aria-hidden="true">
                        {ticked ? <Icon name="check" size={14} /> : null}
                      </span>
                      <ConversationAvatar
                        api={api}
                        conversation={row}
                        className="conversation-row__avatar"
                      />
                      <span className="conversation-row__body">
                        <span className="conversation-row__line">
                          <span className="conversation-row__name">
                            {conversationTitle(row)}
                            {pinned && (
                              <span className="conversation-row__pin" title="Pinned">
                                <Icon name="pin" size={13} />
                                <span className="sr-only">Pinned</span>
                              </span>
                            )}
                          </span>
                          <span className="conversation-row__time">
                            {clockTime(row.lastMessageAt)}
                          </span>
                        </span>
                        <span className="conversation-row__line">
                          <span className="conversation-row__preview">
                            {isOneWayConversation(row) && (
                              <span className="conversation-row__tag">Notifications</span>
                            )}
                            {row.muted && <span className="conversation-row__tag">Muted</span>}
                            {conversationPreviewText(row)}
                          </span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              }
              return (
                <li key={row.id} className="conversation-rows__item">
                  <RouteLink
                    route={{ kind: "conversation", conversationId: row.id }}
                    navigate={navigate}
                    className={`conversation-row${isSelected ? " is-selected" : ""}`}
                    aria-current={isSelected ? "true" : undefined}
                    aria-label={`${conversationTitle(row)}${unreadLabel(row)}`}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setRowMenu((current) => (current === row.id ? null : row.id));
                    }}
                  >
                    <ConversationAvatar
                      api={api}
                      conversation={row}
                      className="conversation-row__avatar"
                    />
                    <span className="conversation-row__body">
                      <span className="conversation-row__line">
                        <span className="conversation-row__name">
                          {conversationTitle(row)}
                          {pinned && (
                            <span className="conversation-row__pin" title="Pinned">
                              <Icon name="pin" size={13} />
                              <span className="sr-only">Pinned</span>
                            </span>
                          )}
                        </span>
                        <span className="conversation-row__time">
                          {clockTime(row.lastMessageAt)}
                        </span>
                      </span>
                      <span className="conversation-row__line">
                        <span className="conversation-row__preview">
                          {isOneWayConversation(row) && (
                            <span className="conversation-row__tag">Notifications</span>
                          )}
                          {row.muted && <span className="conversation-row__tag">Muted</span>}
                          {conversationPreviewText(row)}
                        </span>
                      </span>
                    </span>
                  </RouteLink>
                  <button
                    type="button"
                    className="icon-button conversation-row__more"
                    aria-label={`Options for ${conversationTitle(row)}`}
                    aria-haspopup="menu"
                    aria-expanded={rowMenu === row.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      setRowMenu((current) => (current === row.id ? null : row.id));
                    }}
                  >
                    <Icon name="more" size={18} />
                  </button>
                  {rowMenu === row.id && (
                    <>
                      <button
                        type="button"
                        className="menu-backdrop"
                        aria-label="Close menu"
                        tabIndex={-1}
                        onClick={() => setRowMenu(null)}
                      />
                      <div
                        className="list-menu row-menu"
                        role="menu"
                        aria-label={`Options for ${conversationTitle(row)}`}
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setPinnedFlag(row.id, !pinned);
                            setRowMenu(null);
                          }}
                        >
                          <Icon name="pin" size={18} />
                          {pinned ? "Unpin" : "Pin"}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setArchivedFlag(row.id, true);
                            setRowMenu(null);
                          }}
                        >
                          <Icon name="archive" size={18} />
                          Archive
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setSelecting(true);
                            setSelIds([row.id]);
                            setRowMenu(null);
                          }}
                        >
                          <Icon name="check" size={18} />
                          Select
                        </button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {(archivePull.pull > 27 || archivePull.phase === "opening") && (
        <div
          className={`archive-pull-indicator${archivePull.phase === "opening" ? " is-opening" : ""}`}
          role="progressbar"
          aria-label="Opening archived chats"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(archivePull.progress * 100)}
        >
          <svg className="archive-pull-indicator__ring" viewBox="0 0 46 46" aria-hidden="true">
            <circle className="archive-pull-indicator__track" cx="23" cy="23" r="21" />
            <circle
              className="archive-pull-indicator__progress"
              cx="23"
              cy="23"
              r="21"
              strokeDasharray={ARCHIVE_PULL_RING}
              strokeDashoffset={ARCHIVE_PULL_RING * (1 - archivePull.progress)}
            />
          </svg>
          <Icon name="archive" size={22} />
        </div>
      )}

      <footer className="list-footer">
        <span className="list-footer__live" role="status" aria-live="polite">
          <span
            className={`connection-indicator${
              isOnline && controller.listSocket === "open" ? "" : " is-offline"
            }`}
          />
          <span>
            {!isOnline
              ? "Browser offline"
              : controller.listSocket === "open"
                ? "Live"
                : controller.listSocket === "reconnecting"
                  ? "Reconnecting…"
                  : "Connected"}
          </span>
          <span className="list-footer__spacer" />
          <span className="footer-version">
            {controller.durable ? "Drafts saved" : "Drafts in memory only"}
          </span>
        </span>
      </footer>
    </section>
  );
}

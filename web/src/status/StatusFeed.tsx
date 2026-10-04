import { useCallback } from "react";
import { Icon } from "../icons";
import { StatusRing } from "./StatusRing";
import {
  STATUS_COPY,
  groupSeen,
  myStatusSubtitle,
  newestCreatedAt,
  statusRowSubtitle,
  statusStampShort,
  type StatusGroup,
  type StatusesTarget,
} from "./statusModel";
import type { StatusesController } from "./useStatuses";

/**
 * The status feed: "My status" on top, then Recent updates, newest update
 * first — the phone's list, with the phone's rows.
 *
 * Desktop-first means the two floating circles the phone has (a media picker
 * and a text pencil) become labelled buttons in a bar, and every row is a real
 * `<button>` a keyboard can reach: no hover-only affordance, no icon-only
 * control without a name.
 */
export function StatusFeed({
  controller,
  myName,
  myAvatarUrl,
  onOpen,
  onComposeText,
  onComposeMedia,
}: {
  readonly controller: StatusesController;
  readonly myName: string;
  readonly myAvatarUrl: string;
  readonly onOpen: (target: StatusesTarget) => void;
  readonly onComposeText: () => void;
  readonly onComposeMedia: () => void;
}) {
  const { feed, state, error, hiddenAuthorIds } = controller;
  const mine = feed.mine;
  const myStatuses = mine?.statuses ?? [];
  const myViews = myStatuses.reduce((total, item) => total + item.viewers, 0);

  const retry = useCallback(() => void controller.refresh(true), [controller]);

  return (
    <section className="status-feed" aria-label="Status updates">
      <header className="status-feed__head">
        <h2 id="status-heading">Status</h2>
        <p>{STATUS_COPY.expiredNotice}</p>
      </header>

      <div className="status-feed__scroll">
        <button
          type="button"
          className="status-row"
          onClick={() => (mine ? onOpen({ kind: "mine" }) : onComposeMedia())}
        >
          {myStatuses.length > 0 ? (
            <StatusRing
              name={myName}
              avatarUrl={myAvatarUrl}
              segments={myStatuses.length}
              seen={false}
            />
          ) : (
            <span className="status-ring status-ring--plain">
              <span className="status-ring__avatar status-ring__avatar--plain">
                {myAvatarUrl ? (
                  <img src={myAvatarUrl} alt="" />
                ) : (
                  <span aria-hidden="true">{myName.trim().charAt(0).toUpperCase() || "?"}</span>
                )}
              </span>
              <span className="status-row__add" aria-hidden="true">
                <Icon name="plus" size={13} />
              </span>
            </span>
          )}
          <span className="status-row__copy">
            <span className="status-row__name">{STATUS_COPY.myStatus}</span>
            <span className="status-row__meta">
              {myStatuses.length === 0
                ? STATUS_COPY.addPlaceholder
                : myStatusSubtitle(statusStampShort(newestCreatedAt(mine as StatusGroup)), myViews)}
            </span>
          </span>
        </button>

        {feed.others.length > 0 ? (
          <>
            <h3 className="status-feed__section">{STATUS_COPY.recentUpdates}</h3>
            <ul className="status-feed__list">
              {feed.others.map((group) => {
                const seen = groupSeen(group);
                return (
                  <li key={group.author.id}>
                    <button
                      type="button"
                      className={`status-row${seen ? " status-row--seen" : ""}`}
                      onClick={() => onOpen({ kind: "author", authorId: group.author.id })}
                    >
                      <StatusRing
                        name={group.author.displayName}
                        avatarUrl={group.author.avatarUrl}
                        segments={group.statuses.length}
                        seen={seen}
                      />
                      <span className="status-row__copy">
                        <span className="status-row__name">
                          {group.author.displayName || group.author.username || "Status"}
                          {group.author.verified ? (
                            <em className="status-row__badge" title="Verified account">
                              ✓
                            </em>
                          ) : null}
                          {group.author.privateProfile ? (
                            <em className="status-row__badge">
                              <Icon name="lock" size={11} /> private
                            </em>
                          ) : null}
                        </span>
                        <span className="status-row__meta">
                          {statusRowSubtitle(
                            group.statuses.length,
                            statusStampShort(newestCreatedAt(group)),
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}

        {state === "loading" ? (
          <p className="status-feed__state" role="status">
            {STATUS_COPY.loading}
          </p>
        ) : null}

        {state === "error" ? (
          <div className="status-feed__state status-feed__state--error" role="alert">
            <p>{error || STATUS_COPY.postFailed}</p>
            <button type="button" className="secondary-button" onClick={retry}>
              Try again
            </button>
          </div>
        ) : null}

        {state === "ready" && !mine && feed.others.length === 0 ? (
          <div className="status-feed__empty">
            <Icon name="status" size={30} />
            <strong>{STATUS_COPY.noStatusYet}</strong>
            <p>{STATUS_COPY.noStatusYetBody}</p>
          </div>
        ) : null}

        <details className="status-notes">
          <summary>Status notes</summary>
          <ul>
            <li>{STATUS_COPY.browserNotice}</li>
            <li>{STATUS_COPY.expiredNotice}</li>
            <li>
              {STATUS_COPY.hiddenNotice}
              {hiddenAuthorIds.length > 0 ? ` (${hiddenAuthorIds.length} hidden)` : ""}
            </li>
            <li>
              Who can see yours follows your account's status privacy setting:{" "}
              {STATUS_COPY.privacyPublic}, {STATUS_COPY.privacyContacts} or{" "}
              {STATUS_COPY.privacyNobody}.
            </li>
          </ul>
        </details>
      </div>

      <footer className="status-feed__actions">
        <button type="button" className="primary-button" onClick={onComposeMedia}>
          <Icon name="photo" size={17} /> {STATUS_COPY.mediaStatus}
        </button>
        <button type="button" className="secondary-button" onClick={onComposeText}>
          <Icon name="pencil" size={17} /> {STATUS_COPY.textStatus}
        </button>
      </footer>

      <p className="sr-only" role="status" aria-live="polite">
        {controller.notice}
      </p>
    </section>
  );
}

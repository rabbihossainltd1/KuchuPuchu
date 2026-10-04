/**
 * Container for the status surfaces.
 *
 * It owns the two hooks the feed and the viewer need — the roaming E2EE identity
 * (a reply is a sealed 1:1 message) and the status controller — and keeps the
 * viewer and the composers as overlays on top of the feed, the way the phone
 * keeps them as screens on top of the tab.
 *
 * The subtree is mounted only when the `statuses` rollout flag is on and a
 * session is verified, so a default build makes no status request at all.
 */

import { useCallback, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { useE2eeIdentity } from "../messaging/useE2eeIdentity";
import { StatusComposer } from "./StatusComposer";
import { StatusFeed } from "./StatusFeed";
import { StatusViewer } from "./StatusViewer";
import { STATUS_COPY, type StatusesTarget } from "./statusModel";
import { useStatuses } from "./useStatuses";
import "./status.css";

type Props = {
  /** Present when the messaging flag is on: a viewer row can open the chat. */
  readonly onOpenChat?: (conversationId: string) => void;
  /** Bumped by the app when a socket frame says something changed. */
  readonly poke?: number;
};

export function StatusWorkspace({ onOpenChat, poke = 0 }: Props) {
  const { api, token, user } = useAuth();
  const meName = user ? user.displayName || user.username || "Me" : "";
  const meAvatar = typeof user?.avatarUrl === "string" ? user.avatarUrl : "";

  const identity = useE2eeIdentity(api, Boolean(token && user?.id), user?.e2eePublicKey ?? "");
  const controller = useStatuses({ api: token ? api : null, identity: identity.identity, poke });

  const [target, setTarget] = useState<StatusesTarget | null>(null);
  const [composer, setComposer] = useState<"text" | "media" | null>(null);

  const group = target
    ? target.kind === "mine"
      ? controller.feed.mine
      : (controller.feed.others.find((row) => row.author.id === target.authorId) ?? null)
    : null;

  const openChat = useCallback(
    (conversationId: string) => {
      if (!conversationId) return;
      if (onOpenChat) {
        setTarget(null);
        onOpenChat(conversationId);
        return;
      }
      // Chats are a different rollout flag: say so instead of doing nothing.
      controller.announce(
        "That chat is not open in this build — messaging is behind its own rollout flag.",
      );
    },
    [controller, onOpenChat],
  );

  const posted = useCallback(() => {
    setComposer(null);
    controller.announce("Your status is up. It lives for 24 hours.");
    setTarget({ kind: "mine" });
  }, [controller]);

  return (
    <>
      <StatusFeed
        controller={controller}
        myName={meName}
        myAvatarUrl={meAvatar}
        onOpen={setTarget}
        onComposeText={() => setComposer("text")}
        onComposeMedia={() => setComposer("media")}
      />

      {group && target ? (
        <StatusViewer
          api={token ? api : null}
          group={group}
          myName={meName}
          controller={controller}
          onClose={() => setTarget(null)}
          onOpenChat={openChat}
        />
      ) : null}

      {composer ? (
        <StatusComposer
          mode={composer}
          api={token ? api : null}
          controller={controller}
          onClose={() => setComposer(null)}
          onPosted={posted}
        />
      ) : null}

      {/* The identity's own words, when a reply cannot be sealed: a locked
          backup is a real state the reader has to be told about, not a silent
          failure of the Send button. */}
      {identity.status === "locked" ? (
        <p className="status-identity" role="status">
          {STATUS_COPY.replyPlaceholder} — secure chat is locked, so a reply cannot be sealed yet.
          Unlock it in Chats with your backup passphrase.
        </p>
      ) : null}
    </>
  );
}

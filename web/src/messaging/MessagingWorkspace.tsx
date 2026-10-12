/**
 * Container for the two messaging panes.
 *
 * It owns the three hooks the surfaces need — session, roaming E2EE identity
 * and messaging state — so the panes stay presentational. The whole subtree is
 * mounted only when the `messaging` rollout flag is on and a session is
 * verified, which keeps the default build free of private API calls.
 */

import { useEffect, useMemo } from "react";
import { useAuth } from "../auth/AuthContext";
import type { AppRoute } from "../router";
import type { Navigate } from "../useBrowserRouter";
import { ChatPane } from "./ChatPane";
import { ContactsPane } from "./ContactsPane";
import { ConversationList } from "./ConversationList";
import { NewContactPane } from "./NewContactPane";
import { SearchPane } from "./SearchPane";
import { useE2eeIdentity } from "./useE2eeIdentity";
import { useMessaging } from "./useMessaging";
import "./messaging.css";

type Props = {
  route: AppRoute;
  navigate: Navigate;
  isOnline: boolean;
  onUnreadChatsChange: (count: number) => void;
};

export function MessagingWorkspace({ route, navigate, isOnline, onUnreadChatsChange }: Props) {
  const { api, token, user } = useAuth();
  const meId = user?.id ?? "";
  const meName = user ? user.displayName || user.username : "";

  const identity = useE2eeIdentity(api, Boolean(token && meId), user?.e2eePublicKey ?? "");

  const selectedId = route.kind === "conversation" ? route.conversationId : "";

  const controller = useMessaging({
    api,
    enabled: Boolean(token && meId),
    token,
    meId,
    identity: identity.identity,
    selectedId,
  });

  const unreadChats = controller.conversations.filter((row) => row.unread > 0).length;

  useEffect(() => {
    onUnreadChatsChange(unreadChats);
  }, [onUnreadChatsChange, unreadChats]);

  const selected = useMemo(() => {
    const listed = controller.conversations.find((row) => row.id === selectedId) ?? null;
    const detailed = controller.selected?.id === selectedId ? controller.selected : null;
    if (!listed) return detailed;
    if (!detailed) return listed;

    // Keep the fresh list fields while retaining secure peer material fetched
    // from the detail endpoint when the compact list omits it.
    const other =
      listed.other && detailed.other
        ? {
            ...detailed.other,
            ...listed.other,
            e2eePublicKey: listed.other.e2eePublicKey || detailed.other.e2eePublicKey,
          }
        : (listed.other ?? detailed.other);
    return { ...detailed, ...listed, other };
  }, [controller.conversations, controller.selected, selectedId]);

  const isSearch = route.kind === "section" && route.section === "search";
  const isContacts = route.kind === "section" && route.section === "contacts";
  const isNewContact = route.kind === "section" && route.section === "newcontact";

  return (
    <>
      {isSearch ? (
        <SearchPane api={token ? api : null} navigate={navigate} controller={controller} />
      ) : isContacts ? (
        <ContactsPane api={token ? api : null} navigate={navigate} controller={controller} />
      ) : isNewContact ? (
        <NewContactPane api={token ? api : null} navigate={navigate} controller={controller} />
      ) : (
        <ConversationList
          controller={controller}
          selectedId={selected?.id ?? ""}
          navigate={navigate}
          isOnline={isOnline}
          api={token ? api : null}
        />
      )}
      <ChatPane
        controller={selected ? { ...controller, selected } : controller}
        selectedId={selectedId}
        navigate={navigate}
        identityStatus={identity.status}
        identityError={identity.error}
        identityNotice={identity.notice}
        onUnlock={identity.unlock}
        onReloadIdentity={identity.load}
        onDismissIdentityNotice={identity.dismissNotice}
        meId={meId}
        meName={meName}
        api={token ? api : null}
      />
    </>
  );
}

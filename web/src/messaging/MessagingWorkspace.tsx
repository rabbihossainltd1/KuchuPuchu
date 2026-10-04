/**
 * Container for the two messaging panes.
 *
 * It owns the three hooks the surfaces need — session, roaming E2EE identity
 * and messaging state — so the panes stay presentational. The whole subtree is
 * mounted only when the `messaging` rollout flag is on and a session is
 * verified, which keeps the default build free of private API calls.
 */

import { useMemo } from "react";
import { useAuth } from "../auth/AuthContext";
import type { AppRoute } from "../router";
import type { Navigate } from "../useBrowserRouter";
import { ChatPane } from "./ChatPane";
import { ConversationList } from "./ConversationList";
import { useE2eeIdentity } from "./useE2eeIdentity";
import { useMessaging } from "./useMessaging";
import "./messaging.css";

type Props = {
  route: AppRoute;
  navigate: Navigate;
  isOnline: boolean;
};

export function MessagingWorkspace({ route, navigate, isOnline }: Props) {
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

  const selected = useMemo(
    () => controller.conversations.find((row) => row.id === selectedId) ?? controller.selected,
    [controller.conversations, controller.selected, selectedId],
  );

  return (
    <>
      <ConversationList
        controller={controller}
        selectedId={selected?.id ?? ""}
        navigate={navigate}
        isOnline={isOnline}
      />
      <ChatPane
        controller={selected ? { ...controller, selected } : controller}
        selectedId={selectedId}
        navigate={navigate}
        identityStatus={identity.status}
        identityError={identity.error}
        identityNotice={identity.notice}
        onUnlock={identity.unlock}
        onDismissIdentityNotice={identity.dismissNotice}
        meId={meId}
        meName={meName}
        api={token ? api : null}
      />
    </>
  );
}

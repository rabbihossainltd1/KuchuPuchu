import type { ApiClient } from "../auth/authApi";
import { conversationAvatarRef, useAvatar } from "./avatars";
import {
  conversationInitial,
  isBotConversation,
  isOneWayConversation,
  type ConversationRow,
} from "./protocol";

/**
 * The conversation's profile picture, phone-parity: the row / header tile
 * shows the cached picture when the peer (or the group) has one this viewer
 * is allowed to see, the official KuchuPuchu logo for system/bot conversations,
 * and the initials tile otherwise. The data-URI is fetched once per avatarRef
 * by `useAvatar` — never on every poll.
 */
export function ConversationAvatar({
  api,
  conversation,
  className,
}: {
  api: ApiClient | null;
  conversation: ConversationRow;
  className: string;
}) {
  const ref = conversationAvatarRef(conversation);
  const url = useAvatar(api, ref);
  const officialLogo =
    !url && (isBotConversation(conversation) || isOneWayConversation(conversation))
      ? "/logo.png"
      : null;
  const resolvedUrl = url || officialLogo;

  return (
    <span className={`${className}${resolvedUrl ? " has-avatar" : ""}`} aria-hidden="true">
      {resolvedUrl ? (
        <img className="avatar-img" src={resolvedUrl} alt="" draggable={false} />
      ) : (
        conversationInitial(conversation)
      )}
    </span>
  );
}

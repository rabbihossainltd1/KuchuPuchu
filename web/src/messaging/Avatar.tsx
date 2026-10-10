import type { ApiClient } from "../auth/authApi";
import { conversationAvatarRef, useAvatar } from "./avatars";
import { conversationInitial, type ConversationRow } from "./protocol";

/**
 * The conversation's profile picture, phone-parity: the row / header tile
 * shows the cached picture when the peer (or the group) has one this viewer
 * is allowed to see, and the initials tile otherwise. The data-URI is
 * fetched once per avatarRef by `useAvatar` — never on every poll.
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

  return (
    <span className={`${className}${url ? " has-avatar" : ""}`} aria-hidden="true">
      {url ? (
        <img className="avatar-img" src={url} alt="" draggable={false} />
      ) : (
        conversationInitial(conversation)
      )}
    </span>
  );
}

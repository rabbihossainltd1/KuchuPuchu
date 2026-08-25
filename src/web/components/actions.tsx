import { Link, useNavigate } from "react-router-dom";
import { MessageCircle, Phone, UserPlus } from "lucide-react";
import { api, RequestError } from "../lib/api";
import { useCall } from "../lib/calls";
import type { PublicUser } from "../lib/types";
import { useState } from "react";

export function PlayerActions({
  player,
  compact = false,
}: {
  player: PublicUser;
  compact?: boolean;
}) {
  const { startCall } = useCall();
  const navigate = useNavigate();
  const [notice, setNotice] = useState("");

  async function message() {
    const data = await api<{ conversation: { id: string } }>("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ userId: player.userId }),
    });
    navigate(`/messages/${data.conversation.id}`);
  }

  async function addFriend() {
    try {
      await api("/api/friend-requests", {
        method: "POST",
        body: JSON.stringify({ userId: player.userId }),
      });
      setNotice("Friend request sent");
    } catch (err) {
      setNotice(err instanceof RequestError ? err.body.message : "Could not send request");
    }
  }

  return (
    <div>
      <div className="action-bar">
        <button className="icon-plain" type="button" onClick={() => void message()} title="Message">
          <MessageCircle size={18} />
          {compact ? null : <span>Message</span>}
        </button>
        <button
          className="icon-plain"
          type="button"
          onClick={() => void startCall(player.userId, "AUDIO")}
          title="Voice call"
        >
          <Phone size={18} />
          {compact ? null : <span>Call</span>}
        </button>
        <button
          className="icon-plain"
          type="button"
          onClick={() => void addFriend()}
          title="Add friend"
        >
          <UserPlus size={18} />
          {compact ? null : <span>Add</span>}
        </button>
        {compact ? null : (
          <Link className="icon-plain" to={`/players/${player.userId}`} title="Profile">
            Profile
          </Link>
        )}
      </div>
      {notice ? (
        <p className="meta" style={{ marginTop: 8 }}>
          {notice}
        </p>
      ) : null}
    </div>
  );
}

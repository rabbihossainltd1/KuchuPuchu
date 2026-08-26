import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { mediaUrl } from "../lib/config";
import { label, type PublicUser } from "../lib/types";

export function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

export function Avatar({
  name,
  url,
  online,
  large,
  className,
}: {
  name: string;
  url?: string | null;
  online?: boolean;
  large?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`${large ? "avatar lg" : "avatar"}${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    >
      {url ? <img src={mediaUrl(url) ?? url} alt="" /> : initials(name)}
      {online ? <span className="dot" /> : null}
    </div>
  );
}

export function Notice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "danger" | "ok";
}) {
  return <div className={tone === "info" ? "banner" : `banner ${tone}`}>{children}</div>;
}

export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty card">
      <h3>{title}</h3>
      {body ? (
        <p className="lede" style={{ margin: "8px auto 16px" }}>
          {body}
        </p>
      ) : null}
      {action}
    </div>
  );
}

export function PlayerCard({ player, extra }: { player: PublicUser; extra?: ReactNode }) {
  return (
    <article className="card player-card">
      <div className="player-head">
        <Avatar name={player.displayName} url={player.avatarUrl} online={player.online} />
        <div style={{ flex: 1 }}>
          <strong>
            <Link to={`/players/${player.userId}`}>{player.displayName}</Link>
          </strong>
          <div className="meta">
            @{player.username}
            {player.rank ? ` · ${label(player.rank)}` : ""}
            {player.level ? ` · Lv ${player.level}` : ""}
            {player.serverRegion ? ` · ${label(player.serverRegion)}` : ""}
          </div>
          {player.reasons?.length ? <div className="meta">{player.reasons.join(" · ")}</div> : null}
        </div>
      </div>
      <div className="chips">
        {player.preferredModes.slice(0, 3).map((mode) => (
          <span className="chip" key={mode}>
            {label(mode)}
          </span>
        ))}
        {player.playStyle ? <span className="chip">{label(player.playStyle)}</span> : null}
        {player.verifiedFf ? <span className="chip accent">Verified IGN</span> : null}
        {player.online ? <span className="chip accent">Online</span> : null}
      </div>
      {extra}
    </article>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <div className="field-error">{message}</div>;
}

export function Spinner() {
  return (
    <div className="center" role="status">
      Loading…
    </div>
  );
}

export function BrandMark({ to = "/" }: { to?: string }) {
  return (
    <Link className="brand" to={to}>
      <img className="brand-logo" src="/brand/logo-horizontal.png" alt="KuchuPuchu" />
    </Link>
  );
}

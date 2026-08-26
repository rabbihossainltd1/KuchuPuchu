import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Empty, PlayerCard, Spinner } from "../components/ui";
import { PlayerActions } from "../components/actions";
import type { PublicUser } from "../lib/types";

export function DiscoverPage() {
  const [items, setItems] = useState<PublicUser[] | null>(null);

  useEffect(() => {
    void api<{ items: PublicUser[] }>("/api/discover/recommendations")
      .then((data) => setItems(data.items))
      .catch(() => setItems([]));
  }, []);

  if (!items) return <Spinner />;

  return (
    <div>
      <h1 className="page-title">Find duo</h1>
      {items.length === 0 ? (
        <Empty title="No players yet" />
      ) : (
        <div className="grid" style={{ marginTop: 12 }}>
          {items.map((player) => (
            <PlayerCard
              key={player.userId}
              player={player}
              extra={<PlayerActions player={player} />}
            />
          ))}
        </div>
      )}
    </div>
  );
}

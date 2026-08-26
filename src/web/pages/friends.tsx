import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Avatar, Empty, Spinner } from "../components/ui";
import { PlayerActions } from "../components/actions";
import { label, type PublicUser } from "../lib/types";

export function FriendsPage() {
  const [friends, setFriends] = useState<PublicUser[] | null>(null);
  const [people, setPeople] = useState<PublicUser[]>([]);
  const [query, setQuery] = useState("");

  async function load(q = query) {
    const [mine, recs, search] = await Promise.all([
      api<{ items: PublicUser[] }>("/api/friends"),
      api<{ items: PublicUser[] }>("/api/discover/recommendations"),
      api<{ items: PublicUser[] }>(`/api/discover?q=${encodeURIComponent(q)}`),
    ]);
    const friendIds = new Set(mine.items.map((item) => item.userId));
    const extras = [...recs.items, ...search.items].filter(
      (item, index, list) =>
        !friendIds.has(item.userId) &&
        list.findIndex((row) => row.userId === item.userId) === index,
    );
    setFriends(mine.items);
    setPeople(extras);
  }

  useEffect(() => {
    void load("");
  }, []);

  function search(event: FormEvent) {
    event.preventDefault();
    void load(query);
  }

  return (
    <div>
      <h1 className="page-title">Friends</h1>
      <form className="search-row" onSubmit={search}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search players"
          aria-label="Search players"
        />
        <button className="btn" type="submit">
          Search
        </button>
      </form>

      <h2 className="section-title">Your friends</h2>
      {!friends ? (
        <Spinner />
      ) : friends.length === 0 ? (
        <Empty title="No friends yet" />
      ) : (
        <div className="grid">
          {friends.map((player) => (
            <article key={player.userId} className="card suggest-card">
              <Link className="mini-person" to={`/players/${player.userId}`}>
                <Avatar name={player.displayName} url={player.avatarUrl} online={player.online} />
                <div>
                  <strong>{player.displayName}</strong>
                  <div className="meta">
                    @{player.username}
                    {player.rank ? ` · ${label(player.rank)}` : ""}
                  </div>
                </div>
              </Link>
              <PlayerActions player={player} compact />
            </article>
          ))}
        </div>
      )}

      <h2 className="section-title">People you may know</h2>
      {people.length === 0 ? (
        <p className="meta">—</p>
      ) : (
        <div className="grid">
          {people.map((player) => (
            <article key={player.userId} className="card suggest-card">
              <Link className="mini-person" to={`/players/${player.userId}`}>
                <Avatar name={player.displayName} url={player.avatarUrl} online={player.online} />
                <div>
                  <strong>{player.displayName}</strong>
                  <div className="meta">
                    @{player.username}
                    {player.rank ? ` · ${label(player.rank)}` : ""}
                    {player.reasons?.length ? ` · ${player.reasons[0]}` : ""}
                  </div>
                </div>
              </Link>
              <PlayerActions player={player} compact />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Avatar, Empty, Spinner } from "../components/ui";
import { PlayerActions } from "../components/actions";
import { label, type PublicUser } from "../lib/types";

export function RequestsPage() {
  const [duo, setDuo] = useState<Array<Record<string, unknown>> | null>(null);
  const [friends, setFriends] = useState<Array<{ id: string; from: PublicUser }>>([]);

  async function load() {
    const [d, f] = await Promise.all([
      api<{ items: Array<Record<string, unknown>> }>("/api/duo-requests"),
      api<{ items: Array<{ id: string; from: PublicUser }> }>("/api/friend-requests"),
    ]);
    setDuo(d.items);
    setFriends(f.items);
  }
  useEffect(() => {
    void load();
  }, []);

  return (
    <div>
      <h1 className="page-title">Requests</h1>
      <p className="lede">Friend requests and Duo / Squad invites live here.</p>
      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <section>
          <h2 className="section-title">Friend requests</h2>
          {friends.length === 0 ? (
            <Empty
              title="No friend requests"
              body="When someone adds you, they will show up here with their profile."
            />
          ) : (
            friends.map((item) => (
              <article key={item.id} className="card request-card">
                <div className="player-head">
                  <Avatar
                    name={item.from.displayName}
                    url={item.from.avatarUrl}
                    online={item.from.online}
                    large
                  />
                  <div>
                    <h3>{item.from.displayName}</h3>
                    <p className="meta">
                      @{item.from.username}
                      {item.from.rank ? ` · ${label(item.from.rank)}` : ""}
                    </p>
                  </div>
                </div>
                <PlayerActions player={item.from} />
                <div className="row" style={{ marginTop: 12 }}>
                  <button
                    className="btn"
                    onClick={() =>
                      void api(`/api/friend-requests/${item.id}/accept`, { method: "POST" }).then(
                        load,
                      )
                    }
                  >
                    Accept
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() =>
                      void api(`/api/friend-requests/${item.id}/decline`, { method: "POST" }).then(
                        load,
                      )
                    }
                  >
                    Decline
                  </button>
                </div>
              </article>
            ))
          )}
        </section>
        <section>
          <h2 className="section-title">Duo / Squad</h2>
          {!duo ? (
            <Spinner />
          ) : duo.length === 0 ? (
            <Empty
              title="No match requests"
              body="Invite someone from Discover when you want to queue."
            />
          ) : (
            duo.map((item) => {
              const requester = item.requester as PublicUser;
              const status = String(item.status);
              return (
                <article key={String(item.id)} className="card request-card">
                  <div className="player-head">
                    <Avatar
                      name={requester.displayName}
                      url={requester.avatarUrl}
                      online={requester.online}
                    />
                    <div>
                      <h3>{requester.displayName}</h3>
                      <p className="meta">
                        {label(String(item.mode))} · {status.toLowerCase()}
                      </p>
                    </div>
                  </div>
                  {status === "PENDING" ? (
                    <div className="row" style={{ marginTop: 12 }}>
                      <button
                        className="btn"
                        onClick={() =>
                          void api(`/api/duo-requests/${item.id}/accept`, { method: "POST" }).then(
                            load,
                          )
                        }
                      >
                        Accept
                      </button>
                      <button
                        className="btn-secondary"
                        onClick={() =>
                          void api(`/api/duo-requests/${item.id}/decline`, { method: "POST" }).then(
                            load,
                          )
                        }
                      >
                        Decline
                      </button>
                      <button
                        className="btn-ghost"
                        onClick={() =>
                          void api(`/api/duo-requests/${item.id}/cancel`, { method: "POST" }).then(
                            load,
                          )
                        }
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })
          )}
        </section>
      </div>
    </div>
  );
}

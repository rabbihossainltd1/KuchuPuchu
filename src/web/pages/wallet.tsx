import { useEffect, useState } from "react";
import { api, RequestError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Notice } from "../components/ui";

const PACKS = [
  { id: "pkg_80", name: "Starter", coins: 80, priceBdt: 49 },
  { id: "pkg_200", name: "Squad", coins: 200, priceBdt: 99 },
  { id: "pkg_500", name: "Custom", coins: 500, priceBdt: 199 },
  { id: "pkg_1200", name: "Season", coins: 1200, priceBdt: 399 },
];

export function WalletPage() {
  const { user, refresh } = useAuth();
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tx, setTx] = useState<Array<{ id: string; type: string; amount: number; source: string }>>(
    [],
  );

  async function load() {
    const data = await api<{ items: typeof tx }>("/api/wallet/transactions").catch(() => ({
      items: [] as typeof tx,
    }));
    setTx(data.items);
  }

  useEffect(() => {
    void load();
  }, []);

  async function add(packageId: string) {
    setPending(packageId);
    setError("");
    try {
      await api("/api/wallet/topup", {
        method: "POST",
        body: JSON.stringify({ packageId }),
      });
      await refresh();
      await load();
      setNotice("Coins added.");
    } catch (err) {
      setError(err instanceof RequestError ? err.body.message : "Could not add coins.");
    } finally {
      setPending("");
    }
  }

  async function daily() {
    setError("");
    try {
      await api("/api/wallet/daily-reward", { method: "POST" });
      await refresh();
      await load();
      setNotice("Daily +20 coins.");
    } catch (err) {
      setError(err instanceof RequestError ? err.body.message : "Already claimed.");
    }
  }

  return (
    <div>
      <h1 className="page-title">Add funds</h1>
      <div className="wallet-balance">{user?.wallet.balance ?? 0} coins</div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {notice ? <Notice tone="ok">{notice}</Notice> : null}
      <div className="pack-grid">
        {PACKS.map((pack) => (
          <button
            key={pack.id}
            className="pack-card"
            type="button"
            disabled={Boolean(pending)}
            onClick={() => void add(pack.id)}
          >
            <strong>{pack.coins}</strong>
            <span>coins</span>
            <em>৳{pack.priceBdt}</em>
            <b>{pending === pack.id ? "Adding…" : "Add"}</b>
          </button>
        ))}
      </div>
      <button className="btn-secondary" type="button" onClick={() => void daily()}>
        Daily +20
      </button>
      {tx.length ? (
        <table className="table" style={{ marginTop: 18 }}>
          <tbody>
            {tx.slice(0, 8).map((row) => (
              <tr key={row.id}>
                <td>{row.source}</td>
                <td>{row.amount > 0 ? `+${row.amount}` : row.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

import { FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";
import { Notice } from "../components/ui";

export function AdminPage() {
  const [tab, setTab] = useState("dashboard");
  const [dash, setDash] = useState<Record<string, number> | null>(null);
  const [users, setUsers] = useState<
    Array<{ id: string; displayName: string; email: string | null; status: string }>
  >([]);
  const [reports, setReports] = useState<
    Array<{ id: string; category: string; details: string; status: string }>
  >([]);
  const [ledger, setLedger] = useState<
    Array<{ id: string; userId: string; type: string; amount: number }>
  >([]);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void api<Record<string, number>>("/api/admin/dashboard").then(setDash);
    void api<{ items: typeof users }>("/api/admin/users").then((d) => setUsers(d.items));
    void api<{ items: typeof reports }>("/api/admin/reports").then((d) => setReports(d.items));
    void api<{ items: typeof ledger }>("/api/admin/ledger").then((d) => setLedger(d.items));
  }, []);

  async function moderate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/api/admin/users/${form.get("userId")}/action`, {
      method: "POST",
      body: JSON.stringify({ action: form.get("action"), reason: form.get("reason") }),
    });
    setNotice("Moderation action recorded.");
  }

  async function grant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/admin/ledger/grant", {
      method: "POST",
      body: JSON.stringify({
        userId: form.get("userId"),
        amount: Number(form.get("amount")),
        reason: form.get("reason"),
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    setNotice("Grant posted to the ledger.");
  }

  return (
    <div>
      <h1 className="page-title">Admin</h1>
      <p className="lede">
        Privileged actions are authorized by role and written to the audit log.
      </p>
      <div className="row" style={{ margin: "12px 0" }}>
        {["dashboard", "users", "reports", "ledger"].map((item) => (
          <button
            key={item}
            className={tab === item ? "btn" : "btn-secondary"}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </div>
      {notice ? <Notice tone="ok">{notice}</Notice> : null}
      {tab === "dashboard" && dash ? (
        <div className="grid cols-3">
          <article className="card">
            <h3>{dash.users}</h3>
            <p className="meta">Users</p>
          </article>
          <article className="card">
            <h3>{dash.openReports}</h3>
            <p className="meta">Open reports</p>
          </article>
          <article className="card">
            <h3>{dash.coinsInCirculation}</h3>
            <p className="meta">Coins in circulation</p>
          </article>
        </div>
      ) : null}
      {tab === "users" ? (
        <div className="grid">
          <form className="card grid" onSubmit={moderate}>
            <h3>Moderate</h3>
            <input name="userId" placeholder="User id" required />
            <select name="action">
              <option value="warn">Warn</option>
              <option value="restrict">Restrict</option>
              <option value="suspend">Suspend</option>
              <option value="ban">Ban</option>
              <option value="restore">Restore</option>
            </select>
            <input name="reason" placeholder="Reason" required />
            <button className="btn">Apply</button>
          </form>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Status</th>
                <th>Id</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.displayName}</td>
                  <td>{user.email}</td>
                  <td>{user.status}</td>
                  <td className="meta">{user.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {tab === "reports" ? (
        <table className="table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Details</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => (
              <tr key={report.id}>
                <td>{report.category}</td>
                <td>{report.details}</td>
                <td>{report.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {tab === "ledger" ? (
        <div>
          <form className="card grid" onSubmit={grant}>
            <h3>Grant coins</h3>
            <input name="userId" placeholder="User id" required />
            <input name="amount" type="number" min={1} required />
            <input name="reason" placeholder="Reason" required />
            <button className="btn">Grant</button>
          </form>
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Type</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((row) => (
                <tr key={row.id}>
                  <td className="meta">{row.userId}</td>
                  <td>{row.type}</td>
                  <td>{row.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

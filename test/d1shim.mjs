// D1-shaped shim over better-sqlite3 so we can run the real worker code.
import Database from "better-sqlite3";

export function makeD1() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");

  function toJs(v) {
    if (v instanceof Uint8Array) return v;
    return v;
  }

  // Round-trip counters, so tests can assert on how many statements a route
  // issues rather than just on its output. Every statement is one D1 round
  // trip in production, so this is what an N+1 looks like from the outside.
  const _stats = { reads: 0, writes: 0 };
  _stats.reset = () => {
    _stats.reads = 0;
    _stats.writes = 0;
  };

  return {
    _db: db,
    _stats,
    // D1's batch: run prepared statements in one round-trip.
    async batch(stmts) {
      const out = [];
      for (const st of stmts) {
        if (st && typeof st.run === "function") out.push(await st.run());
        else if (st && typeof st.all === "function") out.push(await st.all());
        else if (st && typeof st.first === "function") out.push(await st.first());
      }
      return out;
    },
    prepare(sql) {
      const bound = [];
      const stmt = () => db.prepare(sql);
      const api = {
        sql,
        bind(...values) {
          bound.push(...values);
          return api;
        },
        async first() {
          _stats.reads++;
          const row = stmt().get(...bound.map((v) => (v === undefined ? null : v)));
          return row === undefined ? null : row;
        },
        async all() {
          _stats.reads++;
          const rows = stmt().all(...bound.map((v) => (v === undefined ? null : v)));
          return { results: rows, meta: {} };
        },
        async run() {
          _stats.writes++;
          const info = stmt().run(...bound.map((v) => (v === undefined ? null : v)));
          return { meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
        },
      };
      return api;
    },
  };
}

export function makeR2() {
  const store = new Map();
  return {
    async put(key, data, opts = {}) {
      const buf = Buffer.from(data);
      store.set(key, { body: buf, httpMetadata: opts.httpMetadata || {} });
    },
    async get(key) {
      const o = store.get(key);
      if (!o) return null;
      return {
        body: new Uint8Array(o.body).buffer,
        httpMetadata: o.httpMetadata,
        writeHttpMetadata(h) {
          if (o.httpMetadata?.contentType) h.set("content-type", o.httpMetadata.contentType);
        },
      };
    },
    async delete(key) {
      store.delete(key);
    },
    _store: store,
  };
}

export function makeCtx() {
  const tasks = [];
  return {
    waitUntil(p) {
      tasks.push(p);
    },
    async drain() {
      await Promise.allSettled(tasks);
      tasks.length = 0;
    },
  };
}

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
  // `trips` is the number of D1 round trips (each awaited statement is one;
  // a batch of N statements is ONE), `waves` how many of them ran one after
  // another (a Promise.all of several trips is ONE wave — one trip-time of
  // latency however many statements it carries), and `concurrent` the
  // largest number of trips in flight at once (the runtime allows six).
  const _stats = { reads: 0, writes: 0, trips: 0, waves: 0, concurrent: 0 };
  let inFlight = 0;
  _stats.reset = () => {
    _stats.reads = 0;
    _stats.writes = 0;
    _stats.trips = 0;
    _stats.waves = 0;
    _stats.concurrent = 0;
  };
  // Every real D1 call crosses the network, so each shim call yields once
  // before touching SQLite: concurrent callers overlap here, exactly where
  // their wire time would overlap in production.
  const trip = async (fn) => {
    _stats.trips++;
    if (inFlight === 0) _stats.waves++;
    inFlight++;
    if (inFlight > _stats.concurrent) _stats.concurrent = inFlight;
    try {
      await new Promise((r) => setImmediate(r));
      return fn();
    } finally {
      inFlight--;
    }
  };

  return {
    _db: db,
    _stats,
    // D1's batch: run prepared statements in one round-trip.
    async batch(stmts) {
      return trip(() => {
        const out = [];
        for (const st of stmts) {
          if (st && typeof st._run === "function") out.push(st._run());
          else if (st && typeof st._all === "function") out.push(st._all());
          else if (st && typeof st._first === "function") out.push(st._first());
        }
        return out;
      });
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
        // The synchronous bodies (statement counters live here, so a batch
        // still counts every statement it carries) …
        _first() {
          _stats.reads++;
          const row = stmt().get(...bound.map((v) => (v === undefined ? null : v)));
          return row === undefined ? null : row;
        },
        _all() {
          _stats.reads++;
          const rows = stmt().all(...bound.map((v) => (v === undefined ? null : v)));
          return { results: rows, meta: {} };
        },
        _run() {
          _stats.writes++;
          const info = stmt().run(...bound.map((v) => (v === undefined ? null : v)));
          return { meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
        },
        // … and the D1 surface: one round trip each.
        first: () => trip(() => api._first()),
        all: () => trip(() => api._all()),
        run: () => trip(() => api._run()),
      };
      return api;
    },
  };
}

/**
 * v163: the multipart part route hands the shim `request.body` — a live
 * ReadableStream in workerd, and (in Node) one that undici refuses to wrap in a
 * new Response once the worker has touched it ("Response body object should not
 * be disturbed or locked"). Read it through its own reader instead, which is
 * what the real bucket does: bytes flow through, nothing is buffered twice.
 */
async function readStreamAll(value) {
  if (typeof value === "string") return Buffer.from(value);
  if (value && typeof value.getReader === "function") {
    const chunks = [];
    const reader = value.getReader();
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  if (value && typeof value.arrayBuffer === "function")
    return Buffer.from(await value.arrayBuffer());
  return Buffer.from(value ?? []);
}

export function makeR2() {
  const store = new Map();
  // v163: multipart sessions (the large-file upload path) — the binding API,
  // in memory, so the tests drive the same calls the worker makes.
  const multiparts = new Map();
  let mpSeq = 0;
  const mpApi = {
    async createMultipartUpload(key, opts = {}) {
      const uploadId = `mpu_${++mpSeq}`;
      multiparts.set(uploadId, { key, opts, parts: new Map() });
      return {
        uploadId,
        async uploadPart(n, value) {
          const sess = multiparts.get(uploadId);
          const buf = await readStreamAll(value);
          sess.parts.set(n, buf);
          return { partNumber: n, etag: `etag-${n}-${buf.length}` };
        },
        async complete(parts) {
          const sess = multiparts.get(uploadId);
          let total = 0;
          for (const p of [...parts].sort((a, b) => a.partNumber - b.partNumber)) {
            const b = sess.parts.get(p.partNumber);
            if (!b) throw new Error(`missing part ${p.partNumber}`);
            total += b.length;
          }
          const body = Buffer.concat(
            [...parts]
              .sort((a, b) => a.partNumber - b.partNumber)
              .map((p) => sess.parts.get(p.partNumber)),
          );
          store.set(key, { body, httpMetadata: sess.opts.httpMetadata || {} });
          multiparts.delete(uploadId);
          return { size: body.length, total };
        },
        async abort() {
          multiparts.delete(uploadId);
        },
      };
    },
    resumeMultipartUpload(key, uploadId) {
      const sess = multiparts.get(uploadId);
      if (!sess) throw new Error("no such multipart upload");
      return mpApi.createMultipartUpload_fake(key, uploadId, sess);
    },
    createMultipartUpload_fake(key, uploadId, sess) {
      return {
        uploadId,
        async uploadPart(n, value) {
          const buf = await readStreamAll(value);
          sess.parts.set(n, buf);
          return { partNumber: n, etag: `etag-${n}-${buf.length}` };
        },
        async complete(parts) {
          let total = 0;
          for (const p of parts) {
            const b = sess.parts.get(p.partNumber);
            if (!b) throw new Error(`missing part ${p.partNumber}`);
            total += b.length;
          }
          const body = Buffer.concat(
            [...parts]
              .sort((a, b) => a.partNumber - b.partNumber)
              .map((p) => sess.parts.get(p.partNumber)),
          );
          store.set(key, { body, httpMetadata: sess.opts.httpMetadata || {} });
          multiparts.delete(uploadId);
          return { size: body.length, total };
        },
        async abort() {
          multiparts.delete(uploadId);
        },
      };
    },
  };
  return {
    ...mpApi,
    _multiparts: multiparts,
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

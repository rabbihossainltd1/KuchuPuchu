// Media dimensions in the message payload (regression guard for the
// "first scroll is laggy, the second one is smooth" report).
//
// A photo bubble has to be laid out at the photo's real aspect ratio on its FIRST
// frame. Until now the ratio only existed once an image had been decoded on that
// device, so every cold start drew bubbles at the generic placeholder size and
// snapped them to the real size as decodes landed — a layout cascade through the
// whole visible LazyColumn, precisely during the user's first scroll.
//
// The sender knows the size before anything is uploaded (it bounds-decodes the
// bytes anyway), so the worker stores them in meta_json and echoes mediaW/mediaH
// on the message shape: a brand-new device, or a recipient who has never seen the
// photo, reserves the exact box with zero pixels fetched.
//
// These run against the real worker: the clamping rules are security-relevant
// (client-supplied display metadata must not be able to blow up a layout) and the
// persistence through meta_json — surviving an edit, a duplicate send and the list
// endpoint — is the part that cannot be eyeballed.

import { makeD1, makeR2, makeCtx } from "../d1shim.mjs";

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;
let n = 0;
const freshWorker = async () => (await import(`${WORKER}?v=${n++}`)).default;

const lines = [];
const check = (name, cond, detail) =>
  lines.push(
    `  ${cond ? "OK     " : "BROKEN "}  ${name}${!cond && detail ? `  -> ${detail}` : ""}`,
  );

async function mk() {
  const worker = await freshWorker();
  const env = { DB: makeD1(), MEDIA: makeR2() };
  const ctx = makeCtx();
  // Auth routes are rate limited per client IP (see case 13 for the same
  // pattern): a dozen registrations from one address returns 429 instead of a
  // token, and the failure then surfaces as "cannot read id of undefined".
  let ipSeq = 0;
  const call = async (method, path, body, token) => {
    const raw = body instanceof Uint8Array;
    const headers = { "content-type": raw ? "application/octet-stream" : "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    if (path.startsWith("/api/auth/register"))
      headers["cf-connecting-ip"] = `203.0.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
    const init = { method, headers };
    if (body !== undefined && method !== "GET") init.body = raw ? body : JSON.stringify(body);
    const res = await worker.fetch(new Request(`https://kp.test${path}`, init), env, ctx);
    const t = await res.text();
    await ctx.drain();
    let j = {};
    try {
      j = t ? JSON.parse(t) : {};
    } catch {
      j = { _raw: t.slice(0, 60) };
    }
    return { status: res.status, json: j, headers: res.headers };
  };
  const reg = async (e, u) =>
    (
      await call("POST", "/api/auth/register", {
        email: e,
        password: "secret123",
        username: u,
        displayName: u,
      })
    ).json;
  return { env, ctx, call, reg };
}

async function twoUsers(h, tag) {
  const A = await h
    .call("POST", "/api/auth/register", {
      email: `${tag}a@x.com`,
      password: "secret123",
      username: `${tag}a`,
      displayName: `${tag}a`,
    })
    .then((r) => r.json);
  const B = await h
    .call("POST", "/api/auth/register", {
      email: `${tag}b@x.com`,
      password: "secret123",
      username: `${tag}b`,
      displayName: `${tag}b`,
    })
    .then((r) => r.json);
  if (!A.user || !B.user)
    throw new Error(`register failed for ${tag}: ${JSON.stringify(A).slice(0, 80)}`);
  const conv = await h.call("POST", "/api/conversations", { userId: B.user.id }, A.token);
  if (!conv.json.conversation)
    throw new Error(`conversation failed for ${tag}: ${JSON.stringify(conv.json).slice(0, 80)}`);
  return { A, B, cid: conv.json.conversation.id };
}

async function main() {
  const h = await mk();

  // ── 1. an uploaded photo carries its size, both in the send response and on the list
  {
    const { A, cid } = await twoUsers(h, "d1");
    const up = await h.call(
      "POST",
      "/api/files?name=photo.jpg&type=image/jpeg",
      new Uint8Array([1, 2, 3, 4]),
      A.token,
    );
    const key = up.json.fileKey;
    check("upload works", !!key, JSON.stringify(up.json).slice(0, 60));
    const msg = await h.call(
      "POST",
      `/api/conversations/${cid}/messages`,
      {
        kind: "FILE",
        fileKey: key,
        fileName: "photo.jpg",
        fileType: "image/jpeg",
        fileSize: 4,
        clientId: "c-dims",
        meta: { w: 1600, h: 1200 },
      },
      A.token,
    );
    const m = msg.json.message ?? {};
    check(
      "send returns mediaW/mediaH",
      m.mediaW === 1600 && m.mediaH === 1200,
      JSON.stringify({ w: m.mediaW, h: m.mediaH }),
    );
    const list = await h.call("GET", `/api/conversations/${cid}/messages`, undefined, A.token);
    const row = (list.json.items ?? []).find((x) => x.id === m.id) ?? {};
    check(
      "the list endpoint persists them (meta_json round-trip)",
      row.mediaW === 1600 && row.mediaH === 1200,
      JSON.stringify({ w: row.mediaW, h: row.mediaH }),
    );
    check(
      "hasImage still true (no regression for the image fast path)",
      row.hasImage === true,
      `${row.hasImage}`,
    );
    check(
      "mediaUrl still present for IMAGE-shaped sizing",
      row.fileKey === key || !!row.mediaUrl,
      JSON.stringify({ k: row.fileKey, u: row.mediaUrl }),
    );
  }

  // ── 2. an inline IMAGE message (the no-upload fallback) is sized too
  {
    const { A, cid } = await twoUsers(h, "d2");
    const msg = await h.call(
      "POST",
      `/api/conversations/${cid}/messages`,
      {
        kind: "IMAGE",
        imageData: "data:image/jpeg;base64,AAAA",
        clientId: "c-inline",
        meta: { w: 640, h: 960 },
      },
      A.token,
    );
    const m = msg.json.message ?? {};
    check(
      "inline image send keeps the ratio (portrait, 2:3)",
      m.mediaW === 640 && m.mediaH === 960,
      JSON.stringify({ w: m.mediaW, h: m.mediaH }),
    );
  }

  // ── 3. junk must be dropped, never stored — and never break the send
  {
    const { A, cid } = await twoUsers(h, "d3");
    const bad = [
      ["negative", { w: -3, h: 1200 }],
      ["zero", { w: 0, h: 0 }],
      ["absurd", { w: 1e9, h: 7 }],
      ["string", { w: "wide", h: "tall" }],
      ["missing h", { w: 800 }],
      ["float ok", { w: 1000.7, h: 500.2 }],
    ];
    for (const [label, meta] of bad) {
      const msg = await h.call(
        "POST",
        `/api/conversations/${cid}/messages`,
        { kind: "IMAGE", imageData: "data:image/jpeg;base64,AAAA", clientId: `c-${label}`, meta },
        A.token,
      );
      const m = msg.json.message ?? {};
      const ok = msg.status === 201;
      if (label === "float ok") {
        check(
          `float dims are floored, not rejected (${label})`,
          ok && m.mediaW === 1000 && m.mediaH === 500,
          JSON.stringify({ s: msg.status, w: m.mediaW, h: m.mediaH }),
        );
      } else {
        check(
          `unusable dims dropped without breaking the send (${label})`,
          ok && m.mediaW === undefined && m.mediaH === undefined,
          JSON.stringify({ s: msg.status, w: m.mediaW, h: m.mediaH }),
        );
      }
    }
  }

  // ── 4. non-image messages never get them, so the light shapes stay light
  {
    const { A, cid } = await twoUsers(h, "d4");
    const txt = await h.call(
      "POST",
      `/api/conversations/${cid}/messages`,
      { kind: "TEXT", body: "hi", meta: { w: 100, h: 100 } },
      A.token,
    );
    check(
      "a TEXT message ignores dims entirely",
      txt.status === 201 && txt.json.message.mediaW === undefined,
      JSON.stringify(txt.json.message?.mediaW),
    );
  }

  // ── 5. images are not editable, so the one route that REWRITES meta_json
  //     cannot clobber them; and the media bytes still serve for both sides.
  {
    const { A, B, cid } = await twoUsers(h, "d5");
    const up = await h.call(
      "POST",
      "/api/files?name=p.jpg&type=image/jpeg",
      new Uint8Array([9, 9]),
      A.token,
    );
    const msg = await h.call(
      "POST",
      `/api/conversations/${cid}/messages`,
      {
        kind: "FILE",
        fileKey: up.json.fileKey,
        fileName: "p.jpg",
        fileType: "image/jpeg",
        fileSize: 2,
        clientId: "c-edit",
        meta: { w: 1234, h: 4321 },
      },
      A.token,
    );
    const id = msg.json.message.id;
    const edit = await h.call("PATCH", `/api/messages/${id}`, { body: "caption fixed" }, A.token);
    check(
      "an image message cannot be edited (the meta rewrite path is unreachable for it)",
      edit.status === 400,
      `${edit.status} ${JSON.stringify(edit.json).slice(0, 60)}`,
    );
    const after = await h.call("GET", `/api/conversations/${cid}/messages`, undefined, A.token);
    const row = (after.json.items ?? []).find((x) => x.id === id) ?? {};
    check(
      "dims intact after the refused edit",
      row.mediaW === 1234 && row.mediaH === 4321,
      JSON.stringify({ w: row.mediaW, h: row.mediaH }),
    );
    const media = await h.call("GET", `/api/messages/${id}/media`, undefined, B.token);
    check(
      "recipient still gets the photo bytes (no regression)",
      media.status === 200,
      `${media.status}`,
    );
    const metaRow = await h.call("GET", `/api/conversations/${cid}/messages`, undefined, B.token);
    const r2 = (metaRow.json.items ?? []).find((x) => x.id === id) ?? {};
    check(
      "recipient sees the SAME sizing fields as the sender",
      r2.mediaW === 1234 && r2.mediaH === 4321,
      JSON.stringify({ w: r2.mediaW, h: r2.mediaH }),
    );
  }

  // ── 6. an idempotent retry (offline flush) returns the same sized row
  {
    const { A, cid } = await twoUsers(h, "d6");
    const up = await h.call(
      "POST",
      "/api/files?name=p.jpg&type=image/jpeg",
      new Uint8Array([1]),
      A.token,
    );
    const body = {
      kind: "FILE",
      fileKey: up.json.fileKey,
      fileName: "p.jpg",
      fileType: "image/jpeg",
      fileSize: 1,
      clientId: "c-dup",
      meta: { w: 3, h: 2 },
    };
    const first = await h.call("POST", `/api/conversations/${cid}/messages`, body, A.token);
    const again = await h.call("POST", `/api/conversations/${cid}/messages`, body, A.token);
    check(
      "duplicate send returns the ORIGINAL row, still sized",
      again.json.duplicate === true &&
        again.json.message.id === first.json.message.id &&
        again.json.message.mediaW === 3,
      JSON.stringify({ dup: again.json.duplicate, w: again.json.message?.mediaW }),
    );
  }

  process.stdout.write(lines.join("\n") + "\n");
  const broken = lines.filter((l) => l.startsWith("  BROKEN")).length;
  process.exit(broken ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

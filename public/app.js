/* KuchuPuchu Web — v1 (r104)
 * Same API, same account, same chats as the Android app — from the browser.
 *
 * Login: phone number → in-app six-digit code or approval by any signed-in client;
 * background polling completes an approval without another code entry.
 * Live: /ws/user (chat list) + /ws/chat/<id> (open chat); browsers cannot set
 * WebSocket headers, so the sockets carry ?token= (the worker accepts the
 * query param on /ws/* routes only).
 *
 * E2EE (full parity with the app, owner round 64): 1:1 message bodies are
 * sealed on the device — P-256 ECDH → HKDF-SHA256 → AES-256-GCM, envelope
 * "KP1." + base64(nonce ‖ ciphertext). The web client can adopt an existing
 * legacy or KP2 roaming identity from GET /api/e2ee/backup. Newly created
 * identities stay in browser storage; the web never uploads an unencrypted
 * private key. A passphrase-locked KP2 backup can still share one identity
 * across the phone and browser.
 */
"use strict";

import { buildE164, validOtp } from "./login-utils.mjs";

(() => {
  const $ = (id) => document.getElementById(id);
  const LS = {
    token: "kp.token",
    me: "kp.me",
    dev: "kp.device",
    e2ee: "kp.e2ee",
  };
  const KP1 = "KP1.";
  const KP2 = "KP2.";
  const HKDF_INFO = "kp-msg-e2ee-v1";
  const KP_BOTS = new Set(["kp_official_bot", "kp_ai_bot"]);
  const E2EE_PREVIEW = "এনক্রিপ্ট করা মেসেজ";
  const E2EE_OPEN_FAILED = "এই ডিভাইসে মেসেজটি খোলা যায়নি";

  const state = {
    token: localStorage.getItem(LS.token) || "",
    me: JSON.parse(localStorage.getItem(LS.me) || "null"),
    deviceId: localStorage.getItem(LS.dev) || "",
    e2ee: JSON.parse(localStorage.getItem(LS.e2ee) || "null"), // {p,u} base64 keys
    pendingRestore: null, // KP2 blob awaiting the owner's passphrase
    convs: [],
    conv: null, // the open conversation object
    msgs: [], // open chat rows, oldest first
    otherReadAt: null,
    typingTimer: 0,
    pollTimer: 0,
    userWs: null,
    chatWs: null,
    mediaCache: new Map(), // url-string -> objectURL
    atBottom: true,
    authMode: "login",
    loginRequestId: "",
    currentPhone: "",
    otpAvailable: false,
    deviceGone: false,
    otpBusy: false,
    otpLocked: false,
    pollBusy: false,
    approvalBusy: new Set(),
    approvalFeedback: new Map(),
    approvalExpiryTimers: new Map(),
    countries: [],
    country: { iso: "BD", name: "Bangladesh", dial: "880" },
    googleClientId: null,
    gsiLoad: null,
    recoveryPhone: "",
    googleReturn: "entry",
  };

  /* ---------------- tiny helpers ---------------- */
  const esc = (s) =>
    String(s == null ? "" : s).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const uuid = () =>
    "c_w" +
    (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now())
      .replace(/-/g, "")
      .slice(0, 24);
  const b64e = (bytes) => {
    let s = "";
    const a = new Uint8Array(bytes);
    for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s);
  };
  const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  function flagFor(iso) {
    return String(iso || "BD")
      .toUpperCase()
      .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
  }
  const bdCountry = { iso: "BD", name: "Bangladesh", dial: "880" };
  function clock(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    let h = d.getHours() % 12;
    if (h === 0) h = 12;
    return `${h}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "AM" : "PM"}`;
  }
  function dhakaClock(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Dhaka",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d);
  }
  function dayLabel(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const today = new Date();
    const yst = new Date(Date.now() - 86400000);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yst.toDateString()) return "Yesterday";
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------------- api ---------------- */
  async function api(path, opts = {}, raw) {
    const headers = {};
    if (state.token) headers.Authorization = "Bearer " + state.token;
    let body;
    if (raw !== undefined) {
      body = raw; // raw bytes (upload) — no content-type, the worker reads the query
    } else if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, { method: opts.method || "GET", headers, body });
    let j = null;
    try {
      j = await res.json();
    } catch {
      /* non-json */
    }
    if (!res.ok) {
      const msg = (j && (j.error || j.message)) || `HTTP ${res.status}`;
      if (res.status === 401 && state.token) {
        hardLogout();
        throw new Error("Signed out — please sign in again.");
      }
      throw new Error(msg);
    }
    return j;
  }

  /* ---------------- E2EE (byte-for-byte the app's scheme) ---------------- */
  const e2ee = {
    validPub: (s) => typeof s === "string" && s.length > 60,
    async importPriv(pB64) {
      return crypto.subtle.importKey(
        "pkcs8",
        b64d(pB64),
        { name: "ECDH", namedCurve: "P-256" },
        false,
        ["deriveBits"],
      );
    },
    async importPub(uB64) {
      return crypto.subtle.importKey(
        "spki",
        b64d(uB64),
        { name: "ECDH", namedCurve: "P-256" },
        false,
        [],
      );
    },
    async keyFromShared(shared) {
      // The app's HKDF (E2eeMsg.kt): prk = HMAC(key=shared, data=∅), then
      // T1 = HMAC(key=prk, data=info ‖ 0x01) — one 32-byte block.
      const enc = new TextEncoder();
      const prkK = await crypto.subtle.importKey(
        "raw",
        shared,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const prk = new Uint8Array(await crypto.subtle.sign("HMAC", prkK, new Uint8Array(0)));
      const t1K = await crypto.subtle.importKey(
        "raw",
        prk,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const info = enc.encode(HKDF_INFO);
      const t1Data = new Uint8Array(info.length + 1);
      t1Data.set(info);
      t1Data[info.length] = 1;
      const t1 = new Uint8Array(await crypto.subtle.sign("HMAC", t1K, t1Data));
      return crypto.subtle.importKey("raw", t1, "AES-GCM", false, ["encrypt", "decrypt"]);
    },
    async seal(plain, peerPubB64) {
      if (!state.e2ee || !this.validPub(peerPubB64)) return null;
      try {
        const priv = await this.importPriv(state.e2ee.p);
        const pub = await this.importPub(peerPubB64);
        const shared = new Uint8Array(
          await crypto.subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256),
        );
        const key = await this.keyFromShared(shared);
        const nonce = crypto.getRandomValues(new Uint8Array(12));
        const ct = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv: nonce },
          key,
          new TextEncoder().encode(plain),
        );
        const out = new Uint8Array(12 + ct.byteLength);
        out.set(nonce);
        out.set(new Uint8Array(ct), 12);
        return KP1 + b64e(out);
      } catch {
        return null;
      }
    },
    async open(envelope, peerPubB64) {
      if (!state.e2ee || !this.validPub(peerPubB64)) return null;
      try {
        const raw = b64d(envelope.slice(KP1.length));
        if (raw.length < 29) return null;
        const priv = await this.importPriv(state.e2ee.p);
        const pub = await this.importPub(peerPubB64);
        const shared = new Uint8Array(
          await crypto.subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256),
        );
        const iv = raw.slice(0, 12);
        const ct = raw.slice(12);
        // JCA providers pad the P-256 secret to 32 bytes (SunEC and Conscrypt
        // both measured); try a stripped-leading-zero variant too, so a
        // minimal-length secret from any peer still opens.
        const variants = [shared];
        let n = 0;
        while (n < shared.length - 1 && shared[n] === 0) n++;
        if (n > 0) variants.push(shared.slice(n));
        for (const v of variants) {
          try {
            const key = await this.keyFromShared(v);
            const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
            return new TextDecoder().decode(pt);
          } catch {
            /* next variant */
          }
        }
        return null;
      } catch {
        return null;
      }
    },
    isEnvelope: (s) => typeof s === "string" && s.startsWith(KP1),

    /* KP2 passphrase backup (PBKDF2-SHA256 200k + AES-GCM), the app's shape:
     * KP2.b64(salt).b64(iv).b64(ct) over "priv\npub". */
    async unlockBackup(blob, pass) {
      try {
        const parts = blob.slice(KP2.length).split(".");
        if (parts.length !== 3) return null;
        const km = await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(pass),
          "PBKDF2",
          false,
          ["deriveBits"],
        );
        const keyRaw = await crypto.subtle.deriveBits(
          { name: "PBKDF2", hash: "SHA-256", salt: b64d(parts[0]), iterations: 200000 },
          km,
          256,
        );
        const key = await crypto.subtle.importKey("raw", keyRaw, "AES-GCM", false, ["decrypt"]);
        const pt = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: b64d(parts[1]) },
          key,
          b64d(parts[2]),
        );
        const s = new TextDecoder().decode(pt);
        const cut = s.indexOf("\n");
        if (cut <= 0) return null;
        const p = s.slice(0, cut);
        const u = s.slice(cut + 1);
        return this.validPub(u) && p.length > 60 ? { p, u } : null;
      } catch {
        return null; // wrong passphrase (GCM tag) or bad blob
      }
    },
  };

  /* ---------- identity: adopt the account's roaming keypair ---------- */
  async function ensureIdentity() {
    if (state.e2ee || !state.token) return;
    let remote = "";
    try {
      remote = (await api("/api/e2ee/backup")).backup || "";
    } catch {
      return; // offline — retry on the next boot/refresh
    }
    if (remote.startsWith(KP2)) {
      // Passphrase-locked (the owner set a 60+ char-safe passphrase in the
      // privacy sheet). The web refuses to mint a second key — one identity
      // per account keeps every device opening every envelope. Show the bar.
      state.pendingRestore = remote;
      renderUnlockBar();
      return;
    }
    let pair = null;
    if (remote) {
      try {
        const j = JSON.parse(new TextDecoder().decode(b64d(remote)));
        if (j && j.p && j.u && e2ee.validPub(j.u)) pair = { p: j.p, u: j.u };
      } catch {
        /* corrupt blob — fall through to mint */
      }
    }
    if (!pair) {
      // No backup anywhere: mint a browser-local identity and publish only
      // its public half. A private-key backup requires the native KP2
      // passphrase flow; never upload a plaintext keypair here.
      const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
        "deriveBits",
      ]);
      const pkcs8 = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
      const spki = await crypto.subtle.exportKey("spki", kp.publicKey);
      pair = { p: b64e(pkcs8), u: b64e(spki) };
    }
    adoptIdentity(pair);
  }
  async function adoptIdentity(pair) {
    state.e2ee = pair;
    localStorage.setItem(LS.e2ee, JSON.stringify(pair));
    try {
      const me = await api("/api/me");
      const user = me.user || {};
      state.me = { ...(state.me || {}), ...user };
      localStorage.setItem(LS.me, JSON.stringify(state.me));
      if (user.e2eePublicKey !== pair.u) {
        await api("/api/me", { method: "PATCH", body: { e2eePublicKey: pair.u } });
      }
    } catch {
      /* public-key publication retries on the next boot */
    }
    state.pendingRestore = null;
    renderUnlockBar();
    if (state.conv) unsealOpenChat();
  }
  async function tryPassphrase(pass) {
    if (!state.pendingRestore) return;
    $("unlockMsg").textContent = "খুলছি… Unlocking…";
    const pair = await e2ee.unlockBackup(state.pendingRestore, pass);
    if (!pair) {
      $("unlockMsg").textContent = "ভুল পাসফ্রেজ / wrong passphrase";
      return;
    }
    await adoptIdentity(pair);
  }
  function renderUnlockBar() {
    const bar = $("unlock");
    if (state.pendingRestore && !state.e2ee) {
      bar.classList.remove("off");
      $("unlockMsg").textContent = "";
    } else {
      bar.classList.add("off");
    }
  }
  async function unsealOpenChat() {
    const conv = state.conv;
    if (!conv) return;
    const peerPub = (conv.other || {}).e2eePublicKey || "";
    let changed = false;
    for (const m of state.msgs) {
      if (m._sealed !== undefined) continue;
      if (e2ee.isEnvelope(m.body)) {
        m._sealed = true;
        const plain = await e2ee.open(m.body, peerPub);
        m.body = plain == null ? E2EE_OPEN_FAILED : plain;
        changed = true;
      } else {
        m._sealed = false;
      }
    }
    if (changed) renderMsgs(state.atBottom);
  }
  // The app's send policy (E2eeSendPolicy + prepareOutgoing), exact:
  // personal = SOLO chat whose peer is not a KP bot; a personal body may
  // NEVER leave plaintext — with no usable peer key the send is refused.
  function isPersonal(conv) {
    return !!conv && !conv.isGroup && !KP_BOTS.has(((conv.other || {}).id || "").trim());
  }
  async function protectBody(conv, body) {
    if (!body) return body;
    const personal = isPersonal(conv);
    if (!personal) return body;
    const peerPub = ((conv.other || {}).e2eePublicKey || "").trim();
    if (!e2ee.validPub(peerPub) || !state.e2ee)
      throw new Error("Waiting for secure chat — নিরাপদ চ্যাটের জন্য অপেক্ষা…");
    const sealed = await e2ee.seal(body, peerPub);
    if (!sealed || !sealed.startsWith(KP1))
      throw new Error("Waiting for secure chat — নিরাপদ চ্যাটের জন্য অপেক্ষা…");
    return sealed;
  }

  /* ---------------- auth ---------------- */
  function ensureDeviceId() {
    if (!state.deviceId) {
      state.deviceId = "web-" + uuid().slice(2, 16);
      localStorage.setItem(LS.dev, state.deviceId);
    }
    return state.deviceId;
  }
  function setLogin(text, err) {
    const el = $("loginStatus");
    el.textContent = text || "";
    el.className = err ? "err" : "";
  }
  function setOtpState(text, err = false) {
    const el = $("otpState");
    el.textContent = text || "";
    el.classList.toggle("err", !!err);
  }
  function setGoogleStatus(text, err = false) {
    const el = $("googleStatus");
    el.textContent = text || "";
    el.classList.toggle("err", !!err);
  }
  function showAuthPanel(name) {
    $("entryPanel").classList.toggle("off", name !== "entry");
    $("otpPanel").classList.toggle("off", name !== "otp");
    $("googlePanel").classList.toggle("off", name !== "google");
  }
  function setAuthMode(mode) {
    state.authMode = mode === "recovery" ? "recovery" : "login";
    $("loginTitle").textContent =
      state.authMode === "recovery" ? "Recover account" : "KuchuPuchu Web";
    $("loginSubtitle").innerHTML =
      state.authMode === "recovery"
        ? "অ্যাকাউন্টে যুক্ত নম্বর দিন।<br />Enter the phone number linked to the account."
        : "দেশ বেছে স্থানীয় নম্বর লিখুন।<br />Choose a country, then enter your local number.";
    $("loginBtn").textContent = state.authMode === "recovery" ? "Continue" : "Continue";
    $("recoverLink").textContent =
      state.authMode === "recovery" ? "Back to sign in" : "Recover account";
  }
  function updateCountryButton() {
    const c = state.country || bdCountry;
    $("countryFlag").textContent = flagFor(c.iso);
    $("countryLabel").textContent = `${c.name} +${c.dial}`;
    $("countryBtn").setAttribute("aria-label", `Country: ${c.name}, calling code +${c.dial}`);
  }
  function renderCountryOptions() {
    const box = $("countryOptions");
    const q = $("countrySearch").value.trim().toLocaleLowerCase();
    const countries = state.countries.length ? state.countries : [bdCountry];
    const matches = countries.filter((c) =>
      `${c.name} ${c.iso} ${c.dial} +${c.dial}`.toLocaleLowerCase().includes(q),
    );
    box.innerHTML = matches.length
      ? matches
          .map(
            (c) =>
              `<button class="country-option ${c.iso === state.country.iso ? "selected" : ""}" type="button" role="option" aria-selected="${c.iso === state.country.iso}" data-iso="${esc(c.iso)}"><span>${flagFor(c.iso)} ${esc(c.name)}</span><small>+${esc(c.dial)}</small></button>`,
          )
          .join("")
      : '<div class="auth-note">No countries found.</div>';
  }
  async function loadCountries() {
    try {
      const res = await fetch("/countries.json", { cache: "force-cache" });
      if (!res.ok) throw new Error("Country list unavailable");
      const rows = await res.json();
      if (!Array.isArray(rows) || !rows.some((c) => c.iso === "BD" && c.dial === "880"))
        throw new Error("Country list invalid");
      state.countries = rows;
      state.country = rows.find((c) => c.iso === "BD") || bdCountry;
    } catch {
      state.countries = [bdCountry];
      state.country = bdCountry;
    }
    updateCountryButton();
    renderCountryOptions();
  }
  function openCountryPicker() {
    $("countryOverlay").classList.remove("off");
    $("countryBtn").setAttribute("aria-expanded", "true");
    $("countrySearch").value = "";
    renderCountryOptions();
    setTimeout(() => $("countrySearch").focus(), 0);
  }
  function closeCountryPicker() {
    $("countryOverlay").classList.add("off");
    $("countryBtn").setAttribute("aria-expanded", "false");
    $("countryBtn").focus();
  }
  function buildCurrentPhone() {
    return buildE164($("phone").value, state.country || bdCountry);
  }
  async function login() {
    const phone = buildCurrentPhone();
    if (!phone) {
      return setLogin(
        state.country.iso === "BD"
          ? "সঠিক বাংলাদেশি মোবাইল নম্বর দিন। / Enter a valid Bangladeshi mobile number."
          : "সঠিক নম্বর দিন। / Enter a valid phone number.",
        true,
      );
    }
    state.currentPhone = phone;
    if (state.authMode === "recovery") {
      await lookupRecovery(phone, "entry");
      return;
    }
    $("loginBtn").disabled = true;
    setLogin("যাচাই করা হচ্ছে… / Checking…");
    try {
      const r = await api("/api/auth/verify-phone", {
        method: "POST",
        // A browser has no SIM: always report UNAVAILABLE, never a match.
        body: {
          phone,
          deviceId: ensureDeviceId(),
          platform: "WEB",
          deviceName: "KuchuPuchu Web",
          sim: "UNAVAILABLE",
        },
      });
      if (r.status === "SESSION" && r.token) {
        startSession(r.token, r.user);
      } else if (r.status === "APPROVAL_REQUIRED") {
        state.loginRequestId = String(r.requestId || "");
        state.otpAvailable = !!r.otpAvailable;
        state.deviceGone = !!r.deviceGone;
        state.otpLocked = false;
        $("otpInput").value = "";
        $("otpInput").disabled = !state.otpAvailable;
        $("otpSubmit").disabled = !state.otpAvailable;
        $("otpGoogle").classList.toggle("off", !state.deviceGone);
        $("otpCancel").textContent = "Cancel request";
        setOtpState("");
        $("otpCopy").textContent = state.otpAvailable
          ? "Enter the six-digit code shown inside the KuchuPuchu approval card. If a signed-in Android or Web device approves, you will sign in automatically."
          : "A code is not available right now. A signed-in device can still approve this request and sign you in automatically.";
        if (state.deviceGone) {
          setOtpState("No recent approval connection. You can try linked-Google recovery instead.");
        }
        showAuthPanel("otp");
        setLogin("");
        pollApproval(state.loginRequestId);
        if (state.otpAvailable) setTimeout(() => $("otpInput").focus(), 0);
      } else if (["ACCOUNT_CREATED", "BIND_REQUIRED", "PENDING"].includes(r.status)) {
        setLogin(
          "এই নম্বরে অ্যাকাউন্ট নেই — আগে ফোনের অ্যাপে সাইন আপ করুন।\nNo account for this number yet — sign up in the phone app first.",
          true,
        );
      } else {
        setLogin("অপ্রত্যাশিত উত্তর / Unexpected reply: " + (r.status || "?"), true);
      }
    } catch (e) {
      setLogin(e.message, true);
    } finally {
      $("loginBtn").disabled = false;
    }
  }
  function stopApprovalPolling() {
    clearInterval(state.pollTimer);
    state.pollTimer = 0;
    state.pollBusy = false;
  }
  function finishApprovalState(status) {
    stopApprovalPolling();
    state.loginRequestId = "";
    state.otpAvailable = false;
    state.otpLocked = false;
    $("otpInput").value = "";
    $("otpInput").disabled = true;
    $("otpSubmit").disabled = true;
    $("otpCancel").textContent = "Try again";
    if (status === "DECLINED")
      setOtpState("অনুরোধটি প্রত্যাখ্যান করা হয়েছে। / The request was declined.", true);
    else if (status === "CANCELLED")
      setOtpState("অনুরোধ বাতিল হয়েছে। / The request was cancelled.", true);
    else if (status === "UNKNOWN")
      setOtpState(
        "অনুরোধটি আর চালু নেই। নতুন করে চেষ্টা করুন। / This request is no longer available. Start again.",
        true,
      );
    else setOtpState("অনুরোধের সময় শেষ। / The request expired.", true);
  }
  function pollApproval(requestId) {
    stopApprovalPolling();
    let tries = 0;
    const tick = async () => {
      if (state.loginRequestId !== requestId || state.pollBusy) return;
      if (++tries > 150) {
        finishApprovalState("EXPIRED");
        return;
      }
      state.pollBusy = true;
      try {
        const r = await api("/api/auth/login/poll", {
          method: "POST",
          body: { requestId, deviceId: ensureDeviceId() },
        });
        if (r.status === "SESSION" && r.token) {
          stopApprovalPolling();
          startSession(r.token, r.user);
          return;
        }
        if (
          r.status === "DECLINED" ||
          r.status === "EXPIRED" ||
          r.status === "CANCELLED" ||
          r.status === "UNKNOWN"
        ) {
          finishApprovalState(r.status);
          return;
        }
        if (r.status === "APPROVED") setOtpState("Approved — completing sign-in automatically…");
      } catch {
        /* keep polling through transient network errors */
      } finally {
        state.pollBusy = false;
      }
    };
    tick();
    state.pollTimer = setInterval(tick, 3000);
  }
  async function submitOtp() {
    if (state.otpBusy || !state.loginRequestId || !state.otpAvailable || state.otpLocked) return;
    const code = $("otpInput").value.trim();
    if (!validOtp(code)) {
      setOtpState("ছয় সংখ্যার কোড দিন। / Enter all six digits.", true);
      return;
    }
    state.otpBusy = true;
    $("otpSubmit").disabled = true;
    try {
      const r = await api("/api/auth/login/otp", {
        method: "POST",
        body: { requestId: state.loginRequestId, deviceId: ensureDeviceId(), otp: code },
      });
      if (r.status === "SESSION" && r.token) {
        stopApprovalPolling();
        $("otpInput").value = "";
        startSession(r.token, r.user);
      } else if (r.status === "INVALID_CODE") {
        $("otpInput").value = "";
        setOtpState(
          `কোডটি মেলেনি। আরও ${r.attemptsRemaining ?? "কয়েকটি"} বার চেষ্টা করা যাবে। / Incorrect code; ${r.attemptsRemaining ?? "limited"} tries remain.`,
          true,
        );
        $("otpSubmit").disabled = false;
        $("otpInput").focus();
      } else if (r.status === "OTP_LOCKED") {
        state.otpLocked = true;
        $("otpInput").value = "";
        $("otpInput").disabled = true;
        setOtpState(
          "পাঁচবার ভুল হয়েছে। কোড বন্ধ, তবে অন্য ডিভাইস Approve করতে পারে। / Code attempts used; approval can still finish sign-in.",
          true,
        );
      } else if (r.status === "OTP_UNAVAILABLE") {
        state.otpAvailable = false;
        $("otpInput").disabled = true;
        setOtpState(
          "কোড যাচাই এখন উপলভ্য নয়। অন্য ডিভাইস Approve করতে পারে। / Code verification is unavailable; approval still works.",
          true,
        );
      } else if (r.status === "APPROVED") {
        setOtpState(
          "অন্য ডিভাইস Approve করেছে — সাইন-ইন হচ্ছে… / Approved; signing in automatically…",
        );
      } else if (
        r.status === "EXPIRED" ||
        r.status === "DECLINED" ||
        r.status === "CANCELLED" ||
        r.status === "UNKNOWN"
      ) {
        finishApprovalState(r.status);
      } else {
        setOtpState(
          "কোড যাচাই করা যায়নি। / Could not verify the code. Try approval or recovery.",
          true,
        );
      }
    } catch (e) {
      setOtpState(e.message || "Network unavailable. Try again.", true);
      $("otpSubmit").disabled = false;
    } finally {
      state.otpBusy = false;
      if (state.otpAvailable && !state.otpLocked && state.loginRequestId)
        $("otpSubmit").disabled = false;
    }
  }
  async function lookupRecovery(phone, returnPanel) {
    state.recoveryPhone = phone;
    state.googleReturn = returnPanel;
    setGoogleStatus("Checking account… / অ্যাকাউন্ট যাচাই হচ্ছে…");
    if (returnPanel === "entry") {
      $("loginBtn").disabled = true;
      setLogin("Checking recovery options…");
    }
    try {
      const found = await api("/api/auth/recovery/lookup", { method: "POST", body: { phone } });
      if (!found.exists) {
        if (returnPanel === "otp") {
          setOtpState(
            "এই নম্বরে recoverable account নেই। / No recoverable account was found.",
            true,
          );
        } else {
          showAuthPanel("entry");
          setLogin("এই নম্বরে recoverable account নেই। / No recoverable account was found.", true);
        }
        return;
      }
      showAuthPanel("google");
      setLogin("");
      setGoogleStatus("Use the Google account already linked to this phone number.");
      await renderGoogleButton();
    } catch (e) {
      if (returnPanel === "otp") setOtpState(e.message, true);
      else {
        showAuthPanel("entry");
        setLogin(e.message, true);
      }
    } finally {
      $("loginBtn").disabled = false;
    }
  }
  async function loadGoogleIdentity() {
    if (!state.gsiLoad) {
      state.gsiLoad = new Promise((resolve, reject) => {
        if (window.google?.accounts?.id) return resolve();
        const script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.defer = true;
        script.onload = () =>
          window.google?.accounts?.id
            ? resolve()
            : reject(new Error("Google sign-in did not load."));
        script.onerror = () =>
          reject(new Error("Google sign-in is unavailable in this browser or network."));
        document.head.appendChild(script);
        setTimeout(() => reject(new Error("Google sign-in took too long to load.")), 10000);
      }).catch((error) => {
        state.gsiLoad = null;
        throw error;
      });
    }
    return state.gsiLoad;
  }
  async function renderGoogleButton() {
    try {
      if (state.googleClientId === null) {
        const config = await api("/api/config/firebase");
        state.googleClientId = config.googleWebClientId || "";
      }
      if (!state.googleClientId)
        throw new Error("Google recovery is not configured on the server.");
      await loadGoogleIdentity();
      const host = $("googleButton");
      host.innerHTML = "";
      const gsi = window.google?.accounts?.id;
      if (!gsi) throw new Error("Google sign-in is unavailable in this browser.");
      gsi.initialize({
        client_id: state.googleClientId,
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: (response) => {
          if (!response?.credential) {
            setGoogleStatus("Google verification was cancelled. Try again when ready.", true);
            return;
          }
          finishGoogleRecovery(response.credential);
        },
      });
      gsi.renderButton(host, {
        type: "standard",
        theme: "filled_black",
        size: "large",
        text: "continue_with",
        shape: "pill",
        width: Math.min(340, Math.max(220, host.clientWidth || 320)),
      });
      setGoogleStatus("Google verifies your linked account; the server checks the ID token.");
    } catch (e) {
      setGoogleStatus(
        e.message || "Google sign-in is unavailable. Try another browser or network.",
        true,
      );
    }
  }
  async function finishGoogleRecovery(idToken) {
    if (!idToken || state.otpBusy) return;
    state.otpBusy = true;
    setGoogleStatus("Verifying linked Google account…");
    try {
      const deviceId = ensureDeviceId();
      const started = await api("/api/auth/recovery/start", {
        method: "POST",
        body: { phone: state.recoveryPhone, idToken, deviceId, platform: "WEB" },
      });
      const completed = await api("/api/auth/recovery/complete", {
        method: "POST",
        body: { requestId: started.requestId, deviceId, platform: "WEB" },
      });
      const pendingApproval = state.loginRequestId;
      if (pendingApproval) {
        stopApprovalPolling();
        state.loginRequestId = "";
        state.otpAvailable = false;
        state.otpLocked = false;
        $("otpInput").value = "";
        api("/api/auth/login/cancel", {
          method: "POST",
          body: { requestId: pendingApproval, deviceId },
        }).catch(() => {});
      }
      startSession(completed.token, completed.user);
    } catch (e) {
      setGoogleStatus(e.message || "Google recovery failed. Please try again.", true);
    } finally {
      state.otpBusy = false;
    }
  }
  async function recoverFromOtp() {
    const phone = state.currentPhone || buildCurrentPhone();
    if (!phone) {
      setOtpState("Enter the account phone number first. / আগে নম্বর দিন।", true);
      return;
    }
    await lookupRecovery(phone, "otp");
  }
  function cancelApproval() {
    const requestId = state.loginRequestId;
    stopApprovalPolling();
    state.loginRequestId = "";
    state.otpAvailable = false;
    state.otpLocked = false;
    $("otpInput").value = "";
    showAuthPanel("entry");
    setAuthMode("login");
    setLogin("");
    if (requestId) {
      api("/api/auth/login/cancel", {
        method: "POST",
        body: { requestId, deviceId: ensureDeviceId() },
      }).catch(() => {});
    }
  }
  function startSession(token, user) {
    stopApprovalPolling();
    state.loginRequestId = "";
    state.otpAvailable = false;
    state.otpLocked = false;
    $("otpInput").value = "";
    state.token = token;
    state.me = user || null;
    localStorage.setItem(LS.token, token);
    localStorage.setItem(LS.me, JSON.stringify(user || {}));
    enterApp();
  }
  function hardLogout() {
    try {
      state.userWs && state.userWs.close();
      state.chatWs && state.chatWs.close();
    } catch {}
    stopApprovalPolling();
    state.token = "";
    state.me = null;
    state.e2ee = null;
    localStorage.removeItem(LS.token);
    localStorage.removeItem(LS.me);
    localStorage.removeItem(LS.e2ee);
    show("login");
    showAuthPanel("entry");
    setAuthMode("login");
    setLogin("");
  }
  async function logout() {
    try {
      // The worker reads device_id from this bearer; body IDs are not trusted.
      await api("/api/auth/logout", { method: "POST", body: {} });
    } catch {}
    hardLogout();
  }

  /* ---------------- screens ---------------- */
  function show(name) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("on"));
    $(name).classList.add("on");
  }
  function enterApp() {
    if (!state.token) return show("login");
    const me = state.me || {};
    $("meName").textContent = me.displayName || me.username || "KuchuPuchu Web";
    $("meAvatar").textContent = (me.displayName || me.username || "K")
      .trim()
      .charAt(0)
      .toUpperCase();
    show("list");
    renderUnlockBar();
    loadConvs();
    connectUser();
    ensureIdentity();
  }

  /* ---------------- chat list ---------------- */
  function convTitle(c) {
    if (c.isGroup) return c.title || "Group";
    const o = c.other || {};
    return o.displayName || o.username || o.id || "Chat";
  }
  function convPreview(c) {
    const p = c.lastMessagePreview;
    if (!p) {
      const k = c.lastMessage || "";
      if (k === "call") return "📞 Call";
      return "";
    }
    if (p.viewOnce) return "📷 Photo · View once";
    if (p.kind === "DELETED") return "🚫 Deleted";
    const cat = p.category || "message";
    const tag = {
      photo: "📷 Photo",
      video: "🎬 Video",
      voice: "🎤 Voice",
      sticker: "🎨 Sticker",
      document: "📎 File",
      call: "📞 Call",
      contact: "👤 Contact",
      location: "📍 Location",
    }[cat];
    if (tag && cat !== "message") return tag;
    if (e2ee.isEnvelope(p.body)) return E2EE_PREVIEW;
    return (p.body || "").slice(0, 120);
  }
  async function loadConvs() {
    if (!state.token) return;
    try {
      const r = await api("/api/conversations");
      state.convs = (r.conversations || []).filter((c) => !c.hidden);
      renderConvs();
    } catch (e) {
      if (state.token) console.warn("convs:", e.message);
    }
  }
  function renderConvs() {
    const box = $("rows");
    if (!state.convs.length) {
      box.innerHTML =
        '<div class="empty">কোনো চ্যাট নেই। ফোনের অ্যাপ থেকে চ্যাট শুরু করুন — এখানেও দেখা যাবে।<br/><br/>No chats yet — start one from the phone app.</div>';
      return;
    }
    box.innerHTML = state.convs
      .map((c) => {
        const t = convTitle(c);
        const time = c.lastMessageAt ? clock(c.lastMessageAt) : "";
        const unread =
          c.unread > 0 ? `<span class="badge">${c.unread > 99 ? "99+" : c.unread}</span>` : "";
        return `<div class="row" data-id="${esc(c.id)}">
          <div class="avatar">${esc(t.charAt(0).toUpperCase())}</div>
          <div class="mid">
            <div class="l1"><span class="name">${esc(t)}</span><span class="time">${esc(time)}</span></div>
            <div class="l2"><span class="prev">${esc(convPreview(c))}</span>${unread}</div>
          </div>
        </div>`;
      })
      .join("");
    box
      .querySelectorAll(".row")
      .forEach((el) => el.addEventListener("click", () => openChat(el.dataset.id)));
  }

  /* ---------------- open chat ---------------- */
  async function openChat(convId) {
    let c = state.convs.find((x) => x.id === convId);
    if (!c) {
      try {
        const d = await api(`/api/conversations/${encodeURIComponent(convId)}`);
        c = d.conversation;
      } catch {
        c = { id: convId };
      }
    }
    state.conv = c;
    state.msgs = [];
    state.otherReadAt = null;
    state.mediaCache.forEach((u) => URL.revokeObjectURL(u));
    state.mediaCache.clear();
    state.atBottom = true;
    const t = convTitle(c);
    $("chatTitle").textContent = t;
    $("chatAvatar").textContent = t.charAt(0).toUpperCase();
    $("chatSub").textContent = c.isGroup ? "Group chat" : "";
    $("msgs").innerHTML = '<div class="empty">লোড হচ্ছে… Loading…</div>';
    $("typing").textContent = "";
    // The official notification account is one-way (the API refuses replies).
    const oneWay = !c.isGroup && ((c.other || {}).id || "") === "kp_official_bot";
    $("composer").classList.toggle("off", !!oneWay);
    show("chat");
    connectChat();
    try {
      const r = await api(`/api/conversations/${encodeURIComponent(convId)}/messages`);
      state.msgs = (r.items || []).slice().reverse(); // the API page is newest-first
      state.otherReadAt = r.readAt || null;
      if (r.typingAt && Date.now() - new Date(r.typingAt) < 6000)
        $("typing").textContent = "টাইপ করছে…";
      renderMsgs(true);
      markRead();
      await unsealOpenChat();
    } catch (e) {
      $("msgs").innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    }
  }
  function markRead() {
    if (!state.conv) return;
    api(`/api/conversations/${encodeURIComponent(state.conv.id)}/read`, {
      method: "POST",
      body: {},
    }).catch(() => {});
  }
  function mediaSrc(m) {
    if (m.kind === "IMAGE" && m.mediaUrl) return m.mediaUrl;
    if (m.kind === "FILE" && m.fileKey && /^image\//.test(m.fileType || "")) {
      return "/api/files/" + encodeURIComponent(m.fileKey);
    }
    return null;
  }
  function loginApprovalHtml(m) {
    const meta = m.meta && typeof m.meta === "object" ? m.meta : {};
    const requestId = String(meta.requestId || "");
    let status = String(meta.status || "PENDING").toUpperCase();
    const expiresAt = Date.parse(meta.expiresAt || "");
    const createdAt = Date.parse(m.createdAt || "");
    const deadline = Number.isFinite(expiresAt)
      ? expiresAt
      : Number.isFinite(createdAt)
        ? createdAt + 5 * 60 * 1000
        : 0;
    const expired = !deadline || deadline <= Date.now();
    if (status === "PENDING" && expired) status = "EXPIRED";
    const pending = (status === "PENDING" || status === "OTP_LOCKED") && !expired;
    const locked = Number(meta.otpLocked) === 1 || status === "OTP_LOCKED";
    const code = pending && !locked && validOtp(String(meta.otp || "")) ? String(meta.otp) : "";
    const busy = requestId && state.approvalBusy.has(requestId);
    const feedback = requestId ? state.approvalFeedback.get(requestId) || "" : "";
    const device = String(meta.deviceName || "Another device");
    const place = [meta.city, meta.country].filter(Boolean).map(String).join(", ");
    const ip = String(meta.ip || "");
    const when = dhakaClock(meta.time || m.createdAt);
    const details = [
      `<div class="approval-detail">Device: ${esc(device)} wants to sign in to your account.</div>`,
      place ? `<div class="approval-detail">Location: ${esc(place)}</div>` : "",
      ip && ip !== "unknown" ? `<div class="approval-detail">IP: ${esc(ip)}</div>` : "",
      when ? `<div class="approval-footnote">${esc(when)} · Bangladesh time</div>` : "",
    ].join("");
    let stateText = "";
    if (pending) {
      if (locked) {
        stateText = "Five incorrect codes used. The code is cleared; approval is still available.";
      } else if (!code) {
        stateText = "No code is available. A signed-in device can still approve this request.";
      } else {
        stateText = "Enter this code on the device trying to sign in.";
      }
    } else if (status === "APPROVED") {
      stateText = "Approved — the new device can finish signing in.";
    } else if (status === "CLAIMED") {
      stateText = "The new device signed in successfully.";
    } else if (status === "DECLINED") {
      stateText = "Declined. No new device was signed in.";
    } else if (status === "CANCELLED") {
      stateText = "Login request cancelled.";
    } else {
      stateText = "Login request expired.";
    }
    const actionHtml =
      pending && requestId
        ? `<div class="approval-actions">
          <button class="approval-accept" type="button" data-login-action="approve" ${busy ? "disabled" : ""}>${busy ? "Working…" : "Accept"}</button>
          <button class="approval-decline" type="button" data-login-action="decline" ${busy ? "disabled" : ""}>${busy ? "Working…" : "Decline"}</button>
        </div>
        <div class="approval-footnote">Only approve if you recognize this sign-in.</div>`
        : "";
    return `<div class="approval-card">
      <div class="approval-title">KuchuPuchu · Security</div>
      <div class="approval-detail"><strong>New sign-in attempt</strong></div>
      ${details}
      ${code ? `<div class="approval-code-label">In-app sign-in code</div><div class="approval-code" aria-label="Six-digit sign-in code">${esc(code)}</div>` : ""}
      <div class="approval-state">${esc(stateText)}</div>
      ${actionHtml}
      ${feedback ? `<div class="approval-error" role="status">${esc(feedback)}</div>` : ""}
    </div>`;
  }
  function bubbleHtml(m) {
    const mine = state.me && m.senderId === state.me.id;
    let inner = "";
    const kind = m.kind || "TEXT";
    const isApproval = kind === "LOGIN_APPROVAL";
    if (isApproval) {
      inner = loginApprovalHtml(m);
    } else if (kind === "DELETED") {
      inner = '<i style="color:var(--muted)">This message was deleted</i>';
    } else if (kind === "IMAGE" || mediaSrc(m)) {
      inner =
        (mediaSrc(m)
          ? `<img class="pic" data-src="${esc(mediaSrc(m))}" alt="photo" style="min-height:90px;min-width:90px;background:rgba(255,255,255,.06)${
              m.mediaW && m.mediaH ? `;aspect-ratio:${m.mediaW}/${m.mediaH}` : ""
            }"/>`
          : "") + (m.body && m.body !== E2EE_OPEN_FAILED ? `<div>${esc(m.body)}</div>` : "");
    } else if (kind === "FILE") {
      const t = m.fileType || "";
      const ico = t.startsWith("audio") ? "🎤" : t.startsWith("video") ? "🎬" : "📎";
      const kb = m.fileSize
        ? m.fileSize > 1048576
          ? (m.fileSize / 1048576).toFixed(1) + " MB"
          : Math.max(1, Math.round(m.fileSize / 1024)) + " KB"
        : "";
      inner =
        `<div class="chip"><span class="ico">${ico}</span><span><div class="fn">${esc(m.fileName || "File")}</div>` +
        `<div class="fs">${esc(kb)} · অ্যাপে খুলুন / open in the app</div></span></div>` +
        (m.body ? `<div>${esc(m.body)}</div>` : "");
    } else if (kind === "CALL") {
      inner = '<i style="color:var(--muted)">📞 Call</i>';
    } else {
      inner = esc(m.body);
    }
    let tick = "";
    if (mine) {
      const seen =
        state.otherReadAt && m.createdAt && new Date(state.otherReadAt) >= new Date(m.createdAt);
      const delivered = !!m.deliveredAt;
      tick = `<span class="tick ${seen ? "seen" : ""}" title="${seen ? "Seen" : delivered ? "Delivered" : "Sent"}">${
        seen || delivered ? "✓✓" : "✓"
      }</span>`;
    }
    const stamp = isApproval ? "" : `<span class="stamp">${clock(m.createdAt)}${tick}</span>`;
    const sender =
      !mine && state.conv && state.conv.isGroup && m.senderName
        ? `<div class="sender">${esc(m.senderName)}</div>`
        : "";
    const securityClass = isApproval ? " security-row" : "";
    return `<div class="mrow ${mine ? "mine" : "their"}${securityClass}" data-mid="${esc(m.id)}">${sender}<div class="bubble">${inner}</div>${stamp}</div>`;
  }
  async function actOnLoginApproval(messageId, action) {
    const message = state.msgs.find((item) => item.id === messageId);
    const meta = message && message.meta && typeof message.meta === "object" ? message.meta : null;
    const requestId = meta && String(meta.requestId || "");
    if (!message || message.kind !== "LOGIN_APPROVAL" || !meta || !requestId) return;
    const status = String(meta.status || "PENDING").toUpperCase();
    const expiresAt = Date.parse(meta.expiresAt || "");
    const createdAt = Date.parse(message.createdAt || "");
    const deadline = Number.isFinite(expiresAt)
      ? expiresAt
      : Number.isFinite(createdAt)
        ? createdAt + 5 * 60 * 1000
        : 0;
    if ((status !== "PENDING" && status !== "OTP_LOCKED") || !deadline || deadline <= Date.now())
      return;
    if (action !== "approve" && action !== "decline") return;
    if (state.approvalBusy.has(requestId)) return;

    state.approvalBusy.add(requestId);
    state.approvalFeedback.delete(requestId);
    renderMsgs(false);
    try {
      await api(`/api/auth/login/${action}`, {
        method: "POST",
        body: { id: requestId },
      });
      meta.status = action === "approve" ? "APPROVED" : "DECLINED";
      delete meta.otp;
      delete meta.otpLocked;
      state.approvalFeedback.delete(requestId);
    } catch (error) {
      state.approvalFeedback.set(
        requestId,
        error.message || "Could not update this request. Try again.",
      );
    } finally {
      state.approvalBusy.delete(requestId);
      renderMsgs(false);
    }
  }
  function scheduleApprovalExpiry(message) {
    const existing = state.approvalExpiryTimers.get(message.id);
    const meta = message.meta && typeof message.meta === "object" ? message.meta : null;
    if (!meta) return;
    const status = String(meta.status || "PENDING").toUpperCase();
    if (status !== "PENDING" && status !== "OTP_LOCKED") {
      if (existing) clearTimeout(existing.timer);
      state.approvalExpiryTimers.delete(message.id);
      return;
    }
    const expiresAt = Date.parse(meta.expiresAt || "");
    const createdAt = Date.parse(message.createdAt || "");
    const deadline = Number.isFinite(expiresAt)
      ? expiresAt
      : Number.isFinite(createdAt)
        ? createdAt + 5 * 60 * 1000
        : 0;
    if (!deadline || deadline <= Date.now()) {
      delete meta.otp;
      delete meta.otpLocked;
      if (status === "PENDING") meta.status = "EXPIRED";
      if (existing) clearTimeout(existing.timer);
      state.approvalExpiryTimers.delete(message.id);
      return;
    }
    if (existing && existing.deadline === deadline) return;
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(
      () => {
        state.approvalExpiryTimers.delete(message.id);
        const current = state.msgs.find((item) => item.id === message.id);
        const currentMeta =
          current && current.meta && typeof current.meta === "object" ? current.meta : null;
        if (currentMeta) {
          delete currentMeta.otp;
          delete currentMeta.otpLocked;
          if (String(currentMeta.status || "PENDING").toUpperCase() === "PENDING")
            currentMeta.status = "EXPIRED";
        }
        renderMsgs(state.atBottom);
      },
      Math.max(0, deadline - Date.now()),
    );
    state.approvalExpiryTimers.set(message.id, { timer, deadline });
  }
  function renderMsgs(scrollDown) {
    const box = $("msgs");
    const atTop = box.scrollTop;
    let html = "";
    let prevDay = "";
    for (const m of state.msgs) {
      if (m.kind === "LOGIN_APPROVAL") scheduleApprovalExpiry(m);
      const d = dayLabel(m.createdAt);
      if (d && d !== prevDay) {
        html += `<div class="day">${esc(d)}</div>`;
        prevDay = d;
      }
      html += bubbleHtml(m);
    }
    box.innerHTML =
      html || '<div class="empty">কোনো মেসেজ নেই — প্রথমটা পাঠান!<br/>No messages yet.</div>';
    // Media is token-gated, so every picture is fetched with the session and
    // swapped in as a blob URL (the <img> never carries the bearer).
    box.querySelectorAll("img.pic[data-src]").forEach(async (img) => {
      const src = img.dataset.src;
      let url = state.mediaCache.get(src);
      if (!url) {
        try {
          const res = await fetch(src, { headers: { Authorization: "Bearer " + state.token } });
          if (!res.ok) throw new Error();
          url = URL.createObjectURL(await res.blob());
          state.mediaCache.set(src, url);
        } catch {
          img.style.minHeight = "0";
          img.style.minWidth = "0";
          img.replaceWith(
            Object.assign(document.createElement("div"), {
              textContent: "📷 photo",
              className: "chip",
            }),
          );
          return;
        }
      }
      img.src = url;
    });
    if (scrollDown || state.atBottom) box.scrollTop = box.scrollHeight;
    else box.scrollTop = atTop;
    updateHeaderSub();
  }
  function updateHeaderSub() {
    if (!state.conv) return;
    const last = state.msgs[state.msgs.length - 1];
    const seen =
      state.otherReadAt && last && new Date(state.otherReadAt) >= new Date(last.createdAt);
    $("chatSub").textContent = state.conv.isGroup ? "Group chat" : seen ? "Seen · দেখা হয়েছে" : "";
  }

  /* ---------------- sending ---------------- */
  async function sendText() {
    const box = $("input");
    const plain = box.value.trim();
    if (!plain || !state.conv) return;
    box.value = "";
    box.style.height = "auto";
    const conv = state.conv;
    const clientId = uuid();
    try {
      const body = await protectBody(conv, plain);
      const echo = {
        id: clientId,
        clientId,
        senderId: state.me && state.me.id,
        kind: "TEXT",
        body: plain, // the local row shows plaintext; the wire carries the envelope
        createdAt: new Date().toISOString(),
        _sealed: true,
      };
      state.msgs.push(echo);
      renderMsgs(true);
      await api(`/api/conversations/${encodeURIComponent(conv.id)}/messages`, {
        method: "POST",
        body: { kind: "TEXT", body, clientId },
      });
    } catch (e) {
      $("typing").textContent = "⚠ " + e.message;
      setTimeout(() => {
        if ($("typing").textContent.startsWith("⚠")) $("typing").textContent = "";
      }, 4000);
      if (!box.value) box.value = plain; // give the text back on refusal
    }
  }
  async function sendPhoto(file) {
    if (!file || !state.conv) return;
    const conv = state.conv;
    $("typing").textContent = "ছবি আপলোড হচ্ছে… Uploading photo…";
    try {
      // Stay inside the single-request upload path: cap the long edge like the
      // app does, re-encode as JPEG, then measure the real dimensions.
      const blob = await shrinkImage(file, 2048);
      const dims = await imageDimsOf(blob);
      const name = "photo_" + Date.now() + ".jpg";
      const up = await api(
        `/api/files?name=${encodeURIComponent(name)}&type=${encodeURIComponent("image/jpeg")}`,
        { method: "POST" },
        blob,
      );
      const payload = {
        kind: "FILE",
        fileName: name,
        fileType: "image/jpeg",
        fileSize: up.size || blob.size,
        body: "",
        clientId: uuid(),
        fileKey: up.fileKey,
        meta: dims.w && dims.h ? { w: dims.w, h: dims.h } : {},
      };
      await api(`/api/conversations/${encodeURIComponent(conv.id)}/messages`, {
        method: "POST",
        body: payload,
      });
      $("typing").textContent = "";
    } catch (e) {
      $("typing").textContent = "⚠ " + e.message;
      setTimeout(() => {
        if ($("typing").textContent.startsWith("⚠")) $("typing").textContent = "";
      }, 5000);
    }
  }
  function shrinkImage(file, maxEdge) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => {
        try {
          const scale = Math.min(1, maxEdge / Math.max(im.naturalWidth, im.naturalHeight));
          const w = Math.max(1, Math.round(im.naturalWidth * scale));
          const h = Math.max(1, Math.round(im.naturalHeight * scale));
          const cv = document.createElement("canvas");
          cv.width = w;
          cv.height = h;
          cv.getContext("2d").drawImage(im, 0, 0, w, h);
          cv.toBlob(
            (b) => (b ? res(b) : rej(new Error("Could not encode the photo."))),
            "image/jpeg",
            0.85,
          );
        } catch (e) {
          rej(e);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      im.onerror = () => rej(new Error("Could not read that image."));
      im.src = url;
    });
  }
  function imageDimsOf(blob) {
    return new Promise((res) => {
      const url = URL.createObjectURL(blob);
      const im = new Image();
      im.onload = () => {
        res({ w: im.naturalWidth, h: im.naturalHeight });
        URL.revokeObjectURL(url);
      };
      im.onerror = () => {
        res({});
        URL.revokeObjectURL(url);
      };
      im.src = url;
    });
  }

  /* ---------------- websockets ---------------- */
  function wsUrl(path) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}${path}?token=${encodeURIComponent(state.token)}`;
  }
  function heartbeat(ws) {
    const t = setInterval(() => {
      if (ws.readyState !== 1) return clearInterval(t);
      ws.send(JSON.stringify({ type: "hb", at: Date.now() }));
    }, 20000);
  }
  function connectUser() {
    if (!state.token) return;
    try {
      state.userWs && state.userWs.close();
    } catch {}
    const ws = new WebSocket(wsUrl("/ws/user"));
    state.userWs = ws;
    heartbeat(ws);
    ws.onopen = () => setConn(true);
    ws.onclose = () => {
      setConn(false);
      if (state.token) setTimeout(connectUser, 2500);
    };
    ws.onmessage = (ev) => {
      let f = null;
      try {
        f = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (f.type === "conv") {
        loadConvs();
        if (state.conv && f.conversationId === state.conv.id) refreshOpenChat();
      }
    };
  }
  function connectChat() {
    if (!state.token || !state.conv) return;
    try {
      state.chatWs && state.chatWs.close();
    } catch {}
    const ws = new WebSocket(wsUrl("/ws/chat/" + encodeURIComponent(state.conv.id)));
    state.chatWs = ws;
    heartbeat(ws);
    ws.onmessage = (ev) => {
      let f = null;
      try {
        f = JSON.parse(ev.data);
      } catch {
        return;
      }
      const meId = state.me && state.me.id;
      if (f.type === "message" && f.message) {
        const m = f.message;
        const existing = state.msgs.findIndex((x) => x.id === m.id);
        if (m.senderId === meId) {
          const echo = state.msgs.findIndex((x) => x.clientId && x.clientId === m.clientId);
          if (echo >= 0) state.msgs[echo] = m;
          else if (existing >= 0) state.msgs[existing] = m;
          else state.msgs.push(m);
        } else if (existing >= 0) {
          // Existing security cards can receive redacted/status updates in place.
          state.msgs[existing] = m;
        } else {
          state.msgs.push(m);
          markRead();
          loadConvs();
        }
        unsealOpenChat().then(() => renderMsgs(true));
      } else if (f.type === "read" && f.userId !== meId) {
        if (f.at && (!state.otherReadAt || new Date(f.at) > new Date(state.otherReadAt))) {
          state.otherReadAt = f.at;
          renderMsgs(false);
        }
      } else if (f.type === "delivered" && Array.isArray(f.messageIds)) {
        let hit = false;
        for (const m of state.msgs) {
          if (!m.deliveredAt && f.messageIds.includes(m.id)) {
            m.deliveredAt = f.at;
            hit = true;
          }
        }
        if (hit) renderMsgs(false);
      } else if (f.type === "typing" && f.userId !== meId) {
        if (f.at === "" || !f.at) {
          if ($("typing").textContent && !$("typing").textContent.startsWith("⚠"))
            $("typing").textContent = "";
        } else {
          $("typing").textContent = "টাইপ করছে…";
          clearTimeout(state.typingTimer);
          state.typingTimer = setTimeout(() => ($("typing").textContent = ""), 6000);
        }
      } else if (f.type === "conv") {
        refreshOpenChat();
      }
    };
  }
  async function refreshOpenChat() {
    if (!state.conv) return;
    try {
      const r = await api(`/api/conversations/${encodeURIComponent(state.conv.id)}/messages`);
      const fresh = (r.items || []).slice().reverse();
      // keep local echoes the server page has not confirmed yet
      const pend = state.msgs.filter((m) => m.id.startsWith("c_w"));
      const keep = pend.filter((p) => !fresh.some((f2) => f2.clientId === p.clientId));
      state.msgs = fresh.concat(keep);
      if (r.readAt) state.otherReadAt = r.readAt;
      await unsealOpenChat();
      renderMsgs(state.atBottom);
    } catch {}
  }
  function setConn(on) {
    $("connDot").classList.toggle("on", on);
    $("connDot2").style.background = on ? "var(--green)" : "var(--red)";
  }

  /* ---------------- ui wiring ---------------- */
  $("countryBtn").addEventListener("click", openCountryPicker);
  $("countryClose").addEventListener("click", closeCountryPicker);
  $("countryOverlay").addEventListener("click", (event) => {
    if (event.target === $("countryOverlay")) closeCountryPicker();
  });
  $("countrySearch").addEventListener("input", renderCountryOptions);
  $("countryOptions").addEventListener("click", (event) => {
    const option = event.target.closest(".country-option");
    if (!option) return;
    const country = state.countries.find((item) => item.iso === option.dataset.iso);
    if (!country) return;
    state.country = country;
    updateCountryButton();
    closeCountryPicker();
    $("phone").focus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("countryOverlay").classList.contains("off"))
      closeCountryPicker();
  });
  $("recoverLink").addEventListener("click", () => {
    const nextMode = state.authMode === "recovery" ? "login" : "recovery";
    setAuthMode(nextMode);
    showAuthPanel("entry");
    setLogin("");
  });
  $("googleBack").addEventListener("click", () => {
    setGoogleStatus("");
    showAuthPanel(state.googleReturn === "otp" && state.loginRequestId ? "otp" : "entry");
  });
  $("otpSubmit").addEventListener("click", submitOtp);
  $("otpInput").addEventListener("input", (event) => {
    const input = event.target;
    const clean = input.value.replace(/\D/g, "").slice(0, 6);
    if (input.value !== clean) input.value = clean;
    if (clean.length) setOtpState("");
  });
  $("otpInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitOtp();
    }
  });
  $("otpCancel").addEventListener("click", cancelApproval);
  $("otpGoogle").addEventListener("click", recoverFromOtp);
  $("msgs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-login-action]");
    if (!button) return;
    const row = button.closest("[data-mid]");
    if (row) actOnLoginApproval(row.dataset.mid, button.dataset.loginAction);
  });
  $("loginBtn").addEventListener("click", login);
  $("phone").addEventListener("keydown", (e) => e.key === "Enter" && login());
  $("logoutBtn").addEventListener("click", logout);
  $("unlockBtn").addEventListener("click", () => {
    const pass = $("unlockPass").value;
    if (pass) tryPassphrase(pass);
  });
  $("backBtn").addEventListener("click", () => {
    try {
      state.chatWs && state.chatWs.close();
    } catch {}
    state.chatWs = null;
    state.conv = null;
    show("list");
    loadConvs();
  });
  $("sendBtn").addEventListener("click", sendText);
  $("input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendText();
    }
  });
  $("input").addEventListener("input", (e) => {
    e.target.style.height = "auto";
    e.target.style.height = Math.min(120, e.target.scrollHeight) + "px";
  });
  $("photoBtn").addEventListener("click", () => $("photoPick").click());
  $("photoPick").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (f) sendPhoto(f);
  });
  $("msgs").addEventListener("scroll", (e) => {
    const el = e.target;
    state.atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.token) {
      loadConvs();
      if (state.conv) refreshOpenChat();
    }
  });

  /* ---------------- boot ---------------- */
  loadCountries();
  if (state.token) {
    // Token might be stale: validate silently, then enter (or bounce to login).
    api("/api/me")
      .then((r) => {
        state.me = r.user || state.me;
        localStorage.setItem(LS.me, JSON.stringify(state.me || {}));
        enterApp();
      })
      .catch(() => {
        if (state.token) hardLogout();
      });
  } else {
    show("login");
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
})();

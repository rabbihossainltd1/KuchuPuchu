import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadString } from "firebase/storage";
import { sendEmailVerification, updateProfile } from "firebase/auth";
import { STORE_CATALOG } from "../../shared/catalog";
import { firebaseAuth, db, storage, explainFirebaseError } from "./firebase";
import { RequestError } from "./errors";
import { ensureUserDoc, iso, loadUserDoc, meFromDoc, publicFromDoc, slugFrom } from "./users";
import type { Me, PublicUser } from "./types";

const COIN_PACKS = [
  { id: "pkg_80", name: "Starter pouch", coins: 80, priceBdt: 49 },
  { id: "pkg_200", name: "Squad pack", coins: 200, priceBdt: 99 },
  { id: "pkg_500", name: "Custom night", coins: 500, priceBdt: 199 },
  { id: "pkg_1200", name: "Season chest", coins: 1200, priceBdt: 399 },
];

function fail(status: number, message: string, code = "CLOUD"): never {
  throw new RequestError(status, { code, message });
}

function requireUid() {
  const uid = firebaseAuth.currentUser?.uid;
  if (!uid) fail(401, "Sign in first.", "UNAUTHENTICATED");
  return uid;
}

function parseBody(init: RequestInit): Record<string, unknown> {
  if (!init.body) return {};
  if (typeof init.body === "string") {
    try {
      return JSON.parse(init.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function pairId(a: string, b: string) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function pathOf(raw: string) {
  const url = new URL(raw, "https://app.local");
  return { path: url.pathname.replace(/\/$/, "") || "/", search: url.searchParams };
}

async function userPublic(uid: string, viewer?: string): Promise<PublicUser | null> {
  const data = await loadUserDoc(uid);
  if (!data || data.status === "DELETED") return null;
  return publicFromDoc(uid, data, viewer);
}

function otherUserFallback(uid: string): PublicUser {
  return {
    userId: uid,
    displayName: "Player",
    username: "player",
    avatarUrl: null,
    bio: null,
    country: null,
    district: null,
    approximateArea: null,
    ffUid: null,
    ffIgn: null,
    serverRegion: null,
    level: null,
    rank: null,
    preferredModes: [],
    playStyle: null,
    languages: [],
    availability: [],
    micPreference: null,
    relationshipStatus: null,
    facebookId: null,
    instagram: null,
    whatsapp: null,
    verifiedFf: false,
    verifiedIdentity: false,
    reputation: 0,
    lastActiveAt: new Date().toISOString(),
    online: false,
  };
}

async function notify(userId: string, title: string, body: string, link?: string) {
  await addDoc(collection(db, "notifications"), {
    userId,
    title,
    body,
    link: link ?? "/notifications",
    readAt: null,
    createdAt: serverTimestamp(),
  });
}

async function listUsers(viewer: string) {
  const snap = await getDocs(query(collection(db, "users"), limit(80)));
  const blocked = await blockedSet(viewer);
  return snap.docs
    .filter((item) => item.id !== viewer && item.data().status !== "DELETED")
    .map((item) => publicFromDoc(item.id, item.data(), viewer))
    .filter((item) => !blocked.has(item.userId));
}

async function blockedSet(uid: string) {
  const snap = await getDocs(query(collection(db, "blocks"), where("ownerId", "==", uid)));
  return new Set(snap.docs.map((item) => String(item.data().targetId)));
}

function rankIndex(rank?: string | null) {
  const order = ["BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND", "HEROIC", "GRANDMASTER"];
  const i = order.indexOf(rank ?? "");
  return i < 0 ? 2 : i;
}

async function handleDiscover(uid: string, search: URLSearchParams) {
  const meDoc = await loadUserDoc(uid);
  const me = meDoc ? meFromDoc(uid, meDoc) : null;
  let people = await listUsers(uid);
  const q = (search.get("q") ?? "").trim().toLowerCase();
  if (q) {
    people = people.filter(
      (p) =>
        p.displayName.toLowerCase().includes(q) ||
        p.username.toLowerCase().includes(q) ||
        (p.ffIgn ?? "").toLowerCase().includes(q),
    );
  }
  const server = search.get("serverRegion");
  if (server) people = people.filter((p) => p.serverRegion === server);
  const country = search.get("country");
  if (country)
    people = people.filter((p) => (p.country ?? "").toLowerCase().includes(country.toLowerCase()));
  const district = search.get("district");
  if (district)
    people = people.filter((p) =>
      (p.district ?? "").toLowerCase().includes(district.toLowerCase()),
    );
  const mode = search.get("mode");
  if (mode) people = people.filter((p) => p.preferredModes.includes(mode));
  const playStyle = search.get("playStyle");
  if (playStyle) people = people.filter((p) => p.playStyle === playStyle);
  const language = search.get("language");
  if (language) people = people.filter((p) => p.languages.includes(language));
  const availability = search.get("availability");
  if (availability) people = people.filter((p) => p.availability.includes(availability));
  const mic = search.get("micPreference");
  if (mic) people = people.filter((p) => p.micPreference === mic);
  const age = search.get("ageRange");
  if (age && me) {
    /* matching hint only */
  }
  if (search.get("online") === "true") people = people.filter((p) => p.online);
  if (search.get("online") === "false") people = people.filter((p) => !p.online);
  if (search.get("verified") === "true") people = people.filter((p) => p.verifiedFf);
  const min = search.get("rankMin");
  const max = search.get("rankMax");
  if (min) people = people.filter((p) => rankIndex(p.rank) >= rankIndex(min));
  if (max) people = people.filter((p) => rankIndex(p.rank) <= rankIndex(max));

  people = people.map((p) => {
    const reasons: string[] = [];
    let score = 0;
    if (me?.profile.serverRegion && p.serverRegion === me.profile.serverRegion) {
      score += 3;
      reasons.push("Same server");
    }
    if (me?.profile.rank && p.rank === me.profile.rank) {
      score += 2;
      reasons.push("Same rank");
    }
    if (me?.profile.preferredModes.some((m) => p.preferredModes.includes(m))) {
      score += 2;
      reasons.push("Same mode");
    }
    if (p.online) score += 1;
    return { ...p, score, reasons };
  });
  people.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return { items: people };
}

async function handleFeed(uid: string) {
  const friends = await friendIds(uid);
  const snap = await getDocs(
    query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(60)),
  );
  const items = [];
  for (const row of snap.docs) {
    const data = row.data();
    const authorId = String(data.authorId);
    const visibility = data.visibility === "FRIENDS" ? "FRIENDS" : "PUBLIC";
    if (visibility === "FRIENDS" && authorId !== uid && !friends.has(authorId)) continue;
    const author = await userPublic(authorId, uid);
    if (!author) continue;
    const liked = (await getDoc(doc(db, "posts", row.id, "likes", uid))).exists();
    const commentsSnap = await getDocs(
      query(collection(db, "posts", row.id, "comments"), orderBy("createdAt", "asc"), limit(20)),
    );
    const comments = [];
    for (const c of commentsSnap.docs) {
      const cd = c.data();
      comments.push({
        id: c.id,
        body: String(cd.body || ""),
        createdAt: iso(cd.createdAt),
        author: await userPublic(String(cd.authorId), uid),
      });
    }
    items.push({
      id: row.id,
      body: String(data.body || ""),
      visibility,
      createdAt: iso(data.createdAt),
      author,
      likeCount: Number(data.likeCount || 0),
      liked,
      commentCount: Number(data.commentCount || comments.length),
      comments,
    });
  }
  return { items };
}

async function friendIds(uid: string) {
  const snap = await getDocs(
    query(collection(db, "friendships"), where("users", "array-contains", uid)),
  );
  const ids = new Set<string>();
  for (const row of snap.docs) {
    const data = row.data();
    if (data.status !== "accepted") continue;
    const users = (data.users as string[]) || [];
    for (const other of users) if (other !== uid) ids.add(other);
  }
  return ids;
}

async function handleStories(uid: string) {
  const snap = await getDocs(
    query(collection(db, "stories"), orderBy("createdAt", "desc"), limit(80)),
  );
  const now = Date.now();
  const groups = new Map<
    string,
    { author: PublicUser; seen: boolean; stories: Array<Record<string, unknown>> }
  >();
  for (const row of snap.docs) {
    const data = row.data();
    const expires = Date.parse(iso(data.expiresAt));
    if (Number.isFinite(expires) && expires < now) continue;
    const author = await userPublic(String(data.authorId), uid);
    if (!author) continue;
    const seenSnap = await getDoc(doc(db, "storyViews", `${row.id}_${uid}`));
    const story = {
      id: row.id,
      body: (data.body as string | null) ?? null,
      imageUrl: (data.imageUrl as string | null) ?? null,
      createdAt: iso(data.createdAt),
      expiresAt: iso(data.expiresAt),
      seen: seenSnap.exists(),
      mine: data.authorId === uid,
    };
    const group = groups.get(author.userId) ?? { author, seen: true, stories: [] };
    group.stories.push(story);
    group.seen = group.seen && story.seen;
    groups.set(author.userId, group);
  }
  const items = [...groups.values()];
  items.sort((a, b) => Number(a.seen) - Number(b.seen));
  return { items };
}

async function uploadDataUrl(path: string, dataUrl: string) {
  const file = ref(storage, path);
  await uploadString(file, dataUrl, "data_url");
  return getDownloadURL(file);
}

async function createPost(uid: string, body: Record<string, unknown>) {
  const text = String(body.body || "").trim();
  if (!text) fail(400, "Write something first.");
  const visibility = body.visibility === "FRIENDS" ? "FRIENDS" : "PUBLIC";
  const refDoc = await addDoc(collection(db, "posts"), {
    authorId: uid,
    body: text.slice(0, 500),
    visibility,
    likeCount: 0,
    commentCount: 0,
    createdAt: serverTimestamp(),
  });
  const author = (await userPublic(uid, uid))!;
  return {
    post: {
      id: refDoc.id,
      body: text.slice(0, 500),
      visibility,
      createdAt: new Date().toISOString(),
      author,
      likeCount: 0,
      liked: false,
      commentCount: 0,
      comments: [],
    },
  };
}

async function loadPost(id: string, uid: string) {
  const snap = await getDoc(doc(db, "posts", id));
  if (!snap.exists()) fail(404, "Post not found.");
  const data = snap.data();
  const author = await userPublic(String(data.authorId), uid);
  if (!author) fail(404, "Post not found.");
  const liked = (await getDoc(doc(db, "posts", id, "likes", uid))).exists();
  const commentsSnap = await getDocs(
    query(collection(db, "posts", id, "comments"), orderBy("createdAt", "asc"), limit(40)),
  );
  const comments = [];
  for (const c of commentsSnap.docs) {
    const cd = c.data();
    comments.push({
      id: c.id,
      body: String(cd.body || ""),
      createdAt: iso(cd.createdAt),
      author: await userPublic(String(cd.authorId), uid),
    });
  }
  return {
    post: {
      id,
      body: String(data.body || ""),
      visibility: data.visibility === "FRIENDS" ? "FRIENDS" : "PUBLIC",
      createdAt: iso(data.createdAt),
      author,
      likeCount: Number(data.likeCount || 0),
      liked,
      commentCount: Number(data.commentCount || comments.length),
      comments,
    },
  };
}

async function handleFriendships(
  uid: string,
  method: string,
  path: string,
  body: Record<string, unknown>,
) {
  if (path === "/api/friends") {
    const ids = await friendIds(uid);
    const items: PublicUser[] = [];
    for (const id of ids) {
      const person = await userPublic(id, uid);
      if (person) items.push(person);
    }
    return { items };
  }
  if (path === "/api/friend-requests" && method === "GET") {
    const snap = await getDocs(query(collection(db, "friendships"), where("to", "==", uid)));
    const items = [];
    for (const row of snap.docs) {
      if (row.data().status !== "pending") continue;
      const from = await userPublic(String(row.data().from), uid);
      if (from)
        items.push({
          id: row.id,
          createdAt: iso(row.data().createdAt),
          from,
          fromUserId: from.userId,
        });
    }
    return { items };
  }
  if (path === "/api/friend-requests" && method === "POST") {
    const target = String(body.userId || "");
    if (!target || target === uid) fail(400, "Pick someone else.");
    const id = pairId(uid, target);
    const existing = await getDoc(doc(db, "friendships", id));
    if (existing.exists() && existing.data().status === "accepted")
      fail(400, "You are already friends.");
    await setDoc(doc(db, "friendships", id), {
      users: [uid, target],
      from: uid,
      to: target,
      status: "pending",
      createdAt: serverTimestamp(),
    });
    const me = await userPublic(uid, target);
    await notify(
      target,
      "Friend request",
      `${me?.displayName ?? "Someone"} sent you a friend request`,
      "/requests",
    );
    return { ok: true };
  }
  const accept = path.match(/^\/api\/friend-requests\/([^/]+)\/accept$/);
  const decline = path.match(/^\/api\/friend-requests\/([^/]+)\/decline$/);
  const id = accept?.[1] ?? decline?.[1];
  if (id && method === "POST") {
    const refDoc = doc(db, "friendships", id);
    const snap = await getDoc(refDoc);
    if (!snap.exists()) fail(404, "Request not found.");
    if (decline) {
      await deleteDoc(refDoc);
      return { ok: true };
    }
    await updateDoc(refDoc, { status: "accepted" });
    const data = snap.data();
    await notify(
      String(data.from),
      "Request accepted",
      "Your friend request was accepted.",
      "/friends",
    );
    return { ok: true };
  }
  return null;
}

async function handleChat(
  uid: string,
  method: string,
  path: string,
  body: Record<string, unknown>,
) {
  if (path === "/api/conversations" && method === "GET") {
    const snap = await getDocs(
      query(collection(db, "conversations"), where("members", "array-contains", uid)),
    );
    const items = [];
    for (const row of snap.docs) {
      const data = row.data();
      const otherId = ((data.members as string[]) || []).find((id) => id !== uid);
      const other = otherId ? await userPublic(otherId, uid) : null;
      if (!other) continue;
      const unreadMap = (data.unread as Record<string, number>) || {};
      items.push({
        id: row.id,
        other,
        lastMessage: data.lastMessage
          ? { body: String(data.lastMessage), createdAt: iso(data.lastMessageAt) }
          : null,
        unread: Number(unreadMap[uid] || 0),
        lastMessageAt: data.lastMessageAt ? iso(data.lastMessageAt) : undefined,
      });
    }
    items.sort((a, b) =>
      String(b.lastMessageAt ?? "").localeCompare(String(a.lastMessageAt ?? "")),
    );
    return { items };
  }
  if (path === "/api/conversations" && method === "POST") {
    const other = String(body.userId || "");
    if (!other) fail(400, "Pick someone to message.");
    const id = `c_${pairId(uid, other)}`;
    const refDoc = doc(db, "conversations", id);
    if (!(await getDoc(refDoc)).exists()) {
      await setDoc(refDoc, {
        members: [uid, other],
        lastMessage: null,
        lastMessageAt: null,
        unread: { [uid]: 0, [other]: 0 },
        createdAt: serverTimestamp(),
      });
    }
    return { conversation: { id } };
  }
  const msgs = path.match(/^\/api\/conversations\/([^/]+)\/messages$/);
  if (msgs) {
    const id = msgs[1]!;
    const conv = await getDoc(doc(db, "conversations", id));
    if (!conv.exists()) fail(404, "Conversation not found.");
    const members = (conv.data().members as string[]) || [];
    if (!members.includes(uid)) fail(403, "Not in this conversation.");
    if (method === "GET") {
      const snap = await getDocs(
        query(
          collection(db, "conversations", id, "messages"),
          orderBy("createdAt", "asc"),
          limit(200),
        ),
      );
      await updateDoc(doc(db, "conversations", id), { [`unread.${uid}`]: 0 }).catch(
        () => undefined,
      );
      return {
        items: snap.docs.map((row) => ({
          id: row.id,
          senderId: String(row.data().senderId),
          body: String(row.data().body || ""),
          createdAt: iso(row.data().createdAt),
        })),
      };
    }
    const text = String(body.body || "").trim();
    if (!text) fail(400, "Write a message.");
    const added = await addDoc(collection(db, "conversations", id, "messages"), {
      senderId: uid,
      body: text.slice(0, 2000),
      createdAt: serverTimestamp(),
    });
    const other = members.find((id0) => id0 !== uid);
    const unread: Record<string, number> = { [uid]: 0 };
    if (other) unread[other] = increment(1) as unknown as number;
    await updateDoc(doc(db, "conversations", id), {
      lastMessage: text.slice(0, 2000),
      lastMessageAt: serverTimestamp(),
      [`unread.${uid}`]: 0,
      ...(other ? { [`unread.${other}`]: increment(1) } : {}),
    });
    if (other) {
      const me = await userPublic(uid, other);
      await notify(other, me?.displayName ?? "Message", text.slice(0, 80), `/messages/${id}`);
    }
    return {
      message: {
        id: added.id,
        senderId: uid,
        body: text.slice(0, 2000),
        createdAt: new Date().toISOString(),
      },
    };
  }
  return null;
}

async function handleCalls(
  uid: string,
  method: string,
  path: string,
  body: Record<string, unknown>,
) {
  if (path === "/api/calls" && method === "POST") {
    const other = String(body.userId || "");
    const kind = body.kind === "VIDEO" ? "VIDEO" : "AUDIO";
    const added = await addDoc(collection(db, "calls"), {
      callerId: uid,
      calleeId: other,
      kind,
      status: "RINGING",
      offerSdp: body.offerSdp ?? null,
      answerSdp: null,
      createdAt: serverTimestamp(),
    });
    const otherUser = (await userPublic(other, uid)) ?? {
      userId: other,
      displayName: "Player",
      username: "player",
      avatarUrl: null,
      bio: null,
      country: null,
      district: null,
      approximateArea: null,
      ffUid: null,
      ffIgn: null,
      serverRegion: null,
      level: null,
      rank: null,
      preferredModes: [],
      playStyle: null,
      languages: [],
      availability: [],
      micPreference: null,
      relationshipStatus: null,
      facebookId: null,
      instagram: null,
      whatsapp: null,
      verifiedFf: false,
      verifiedIdentity: false,
      reputation: 0,
      lastActiveAt: new Date().toISOString(),
      online: false,
    };
    return {
      call: {
        id: added.id,
        kind,
        status: "RINGING",
        callerId: uid,
        calleeId: other,
        offerSdp: body.offerSdp ?? null,
        answerSdp: null,
        incoming: false,
        other: otherUser,
      },
    };
  }
  if (path === "/api/calls/active") {
    const mine = await getDocs(
      query(collection(db, "calls"), where("callerId", "==", uid), limit(8)),
    );
    const theirs = await getDocs(
      query(collection(db, "calls"), where("calleeId", "==", uid), limit(8)),
    );
    const items = [];
    for (const row of [...mine.docs, ...theirs.docs]) {
      const data = row.data();
      if (!["RINGING", "ACTIVE"].includes(String(data.status))) continue;
      const otherId = data.callerId === uid ? String(data.calleeId) : String(data.callerId);
      const other = await userPublic(otherId, uid);
      if (!other) continue;
      items.push({
        id: row.id,
        kind: data.kind === "VIDEO" ? "VIDEO" : "AUDIO",
        status: String(data.status),
        callerId: String(data.callerId),
        calleeId: String(data.calleeId),
        offerSdp: data.offerSdp ?? null,
        answerSdp: data.answerSdp ?? null,
        incoming: data.calleeId === uid,
        other,
      });
    }
    return { items };
  }
  const ice = path.match(/^\/api\/calls\/([^/]+)\/ice$/);
  if (ice) {
    const id = ice[1]!;
    if (method === "POST") {
      await addDoc(collection(db, "calls", id, "ice"), {
        from: uid,
        candidate: body.candidate ?? null,
        createdAt: serverTimestamp(),
      });
      return { ok: true };
    }
    const snap = await getDocs(collection(db, "calls", id, "ice"));
    return {
      items: snap.docs
        .filter((row) => row.data().from !== uid)
        .map((row) => ({ id: row.id, candidate: row.data().candidate })),
    };
  }
  const action = path.match(/^\/api\/calls\/([^/]+)\/(answer|hangup|decline)$/);
  if (action && method === "POST") {
    const id = action[1]!;
    const verb = action[2];
    if (verb === "answer") {
      await updateDoc(doc(db, "calls", id), {
        status: "ACTIVE",
        answerSdp: body.answerSdp ?? null,
      });
    } else if (verb === "decline") {
      await updateDoc(doc(db, "calls", id), { status: "DECLINED" });
    } else {
      await updateDoc(doc(db, "calls", id), { status: "ENDED" });
    }
    const snap = await getDoc(doc(db, "calls", id));
    const data = snap.data() ?? {};
    const otherId = data.callerId === uid ? String(data.calleeId) : String(data.callerId);
    return {
      call: {
        id,
        kind: data.kind === "VIDEO" ? "VIDEO" : "AUDIO",
        status: String(data.status || "ENDED"),
        callerId: String(data.callerId || ""),
        calleeId: String(data.calleeId || ""),
        offerSdp: data.offerSdp ?? null,
        answerSdp: data.answerSdp ?? null,
        incoming: data.calleeId === uid,
        other: (await userPublic(otherId, uid)) ?? otherUserFallback(otherId),
      },
    };
  }
  return null;
}

async function handleEconomy(
  uid: string,
  method: string,
  path: string,
  body: Record<string, unknown>,
  search: URLSearchParams,
) {
  if (path === "/api/store/products") {
    const category = search.get("category");
    const items = STORE_CATALOG.filter((item) => !category || item.category === category);
    return { items };
  }
  if (path === "/api/store/orders" && method === "GET") {
    const snap = await getDocs(
      query(collection(db, "users", uid, "orders"), orderBy("createdAt", "desc"), limit(50)),
    );
    return {
      items: snap.docs.map((row) => ({
        id: row.id,
        createdAt: iso(row.data().createdAt),
        product: row.data().product,
      })),
    };
  }
  if (path === "/api/store/orders" && method === "POST") {
    const product = STORE_CATALOG.find((item) => item.id === body.productId);
    if (!product) fail(404, "Item not found.");
    const meSnap = await getDoc(doc(db, "users", uid));
    const balance = Number(meSnap.data()?.walletBalance || 0);
    if (balance < product.priceCoins)
      fail(400, "Not enough coins. Claim the daily reward or add funds later.");
    const inv = await addDoc(collection(db, "users", uid, "inventory"), {
      productId: product.id,
      product,
      equipped: false,
      giftable: product.giftable !== false,
      createdAt: serverTimestamp(),
    });
    await addDoc(collection(db, "users", uid, "orders"), {
      product,
      createdAt: serverTimestamp(),
    });
    await addDoc(collection(db, "users", uid, "ledger"), {
      type: "DEBIT",
      amount: -product.priceCoins,
      source: "store",
      createdAt: serverTimestamp(),
    });
    await updateDoc(doc(db, "users", uid), { walletBalance: increment(-product.priceCoins) });
    return { order: { id: inv.id } };
  }
  if (path === "/api/inventory") {
    const snap = await getDocs(collection(db, "users", uid, "inventory"));
    return {
      items: snap.docs.map((row) => ({
        id: row.id,
        equipped: Boolean(row.data().equipped),
        giftable: Boolean(row.data().giftable),
        product: row.data().product,
      })),
    };
  }
  const equip = path.match(/^\/api\/inventory\/([^/]+)\/(equip|unequip)$/);
  if (equip && method === "POST") {
    await updateDoc(doc(db, "users", uid, "inventory", equip[1]!), {
      equipped: equip[2] === "equip",
    });
    return { ok: true };
  }
  if (path === "/api/gifts" && method === "POST") {
    const invId = String(body.inventoryId || "");
    const receiverId = String(body.receiverId || "");
    const inv = await getDoc(doc(db, "users", uid, "inventory", invId));
    if (!inv.exists() || !inv.data().giftable) fail(400, "That item cannot be gifted.");
    await addDoc(collection(db, "users", receiverId, "inventory"), {
      ...inv.data(),
      equipped: false,
      giftedFrom: uid,
    });
    await deleteDoc(doc(db, "users", uid, "inventory", invId));
    await notify(receiverId, "Gift received", "Someone sent you a store item.", "/inventory");
    return { ok: true };
  }
  if (path === "/api/payments/packages") return { items: COIN_PACKS };
  if (path === "/api/payments/orders") {
    if (method === "POST")
      fail(400, "Coin purchase needs a payment server. Claim the daily reward for now.");
    return { items: [] };
  }
  if (path === "/api/wallet/transactions") {
    const snap = await getDocs(
      query(collection(db, "users", uid, "ledger"), orderBy("createdAt", "desc"), limit(40)),
    );
    return {
      items: snap.docs.map((row) => ({
        id: row.id,
        type: String(row.data().type || ""),
        amount: Number(row.data().amount || 0),
        source: String(row.data().source || ""),
        createdAt: iso(row.data().createdAt),
      })),
    };
  }
  if (path === "/api/wallet/referrals") return { items: [] };
  if (path === "/api/wallet/daily-reward" && method === "POST") {
    const meSnap = await getDoc(doc(db, "users", uid));
    const last = String(meSnap.data()?.lastDailyReward || "");
    const today = new Date().toISOString().slice(0, 10);
    if (last === today) fail(400, "Daily reward already claimed today.");
    await updateDoc(doc(db, "users", uid), {
      walletBalance: increment(20),
      lastDailyReward: today,
    });
    await addDoc(collection(db, "users", uid, "ledger"), {
      type: "CREDIT",
      amount: 20,
      source: "daily",
      createdAt: serverTimestamp(),
    });
    return { ok: true };
  }
  return null;
}

async function patchMe(uid: string, body: Record<string, unknown>): Promise<Me> {
  const fb = firebaseAuth.currentUser;
  if (!fb) fail(401, "Sign in first.");
  const current = await ensureUserDoc(fb);
  const profile = { ...current.profile };
  const next: Record<string, unknown> = {};
  const assign = (key: string, value: unknown) => {
    if (value !== undefined) next[key] = value;
  };
  if (body.displayName !== undefined) {
    assign("displayName", String(body.displayName).trim() || current.displayName);
    assign("searchName", String(body.displayName).trim().toLowerCase());
    await updateProfile(fb, { displayName: String(body.displayName).trim() }).catch(
      () => undefined,
    );
  }
  if (body.username !== undefined) {
    assign("username", slugFrom(String(body.username)));
    assign("searchUsername", slugFrom(String(body.username)));
  }
  if (body.bio !== undefined) assign("bio", String(body.bio));
  if (body.avatarUrl !== undefined) assign("avatarUrl", body.avatarUrl);
  if (body.country !== undefined) assign("country", body.country);
  if (body.district !== undefined) assign("district", body.district);
  const profileKeys = [
    "ffUid",
    "ffIgn",
    "serverRegion",
    "level",
    "rank",
    "preferredModes",
    "playStyle",
    "languages",
    "availability",
    "micPreference",
    "ageRange",
    "gender",
    "genderPreference",
    "relationshipStatus",
    "facebookId",
    "instagram",
    "whatsapp",
  ] as const;
  let profileChanged = false;
  for (const key of profileKeys) {
    if (body[key] !== undefined) {
      (profile as Record<string, unknown>)[key] = body[key];
      profileChanged = true;
    }
  }
  if (profileChanged) next.profile = profile;
  await updateDoc(doc(db, "users", uid), next);
  const fresh = await loadUserDoc(uid);
  return meFromDoc(uid, fresh ?? {}, fb);
}

export async function cloudRequest<T>(rawPath: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || "GET").toUpperCase();
  const { path, search } = pathOf(rawPath);
  const body = parseBody(init);
  try {
    const uid = requireUid();
    let result: unknown = null;

    if (path === "/api/me" || path === "/api/me/profile") {
      const fb = firebaseAuth.currentUser!;
      if (method === "PATCH") result = { user: await patchMe(uid, body) };
      else result = { user: await ensureUserDoc(fb) };
    } else if (path === "/api/me/privacy" && method === "PATCH") {
      const fb = firebaseAuth.currentUser!;
      const current = await ensureUserDoc(fb);
      const privacy = { ...current.privacy, ...body };
      await updateDoc(doc(db, "users", uid), { privacy });
      result = { ok: true };
    } else if (path === "/api/feed") result = await handleFeed(uid);
    else if (path === "/api/posts" && method === "POST") result = await createPost(uid, body);
    else if (path.match(/^\/api\/posts\/[^/]+$/) && method === "GET") {
      result = await loadPost(path.split("/").pop()!, uid);
    } else if (path.match(/^\/api\/posts\/[^/]+$/) && method === "DELETE") {
      const id = path.split("/").pop()!;
      const snap = await getDoc(doc(db, "posts", id));
      if (snap.data()?.authorId !== uid) fail(403, "You can only delete your post.");
      await deleteDoc(doc(db, "posts", id));
      result = { ok: true };
    } else if (path.match(/^\/api\/posts\/[^/]+\/like$/) && method === "POST") {
      const id = path.split("/")[3]!;
      const likeRef = doc(db, "posts", id, "likes", uid);
      const liked = (await getDoc(likeRef)).exists();
      if (liked) {
        await deleteDoc(likeRef);
        await updateDoc(doc(db, "posts", id), { likeCount: increment(-1) });
      } else {
        await setDoc(likeRef, { createdAt: serverTimestamp() });
        await updateDoc(doc(db, "posts", id), { likeCount: increment(1) });
        const post = await getDoc(doc(db, "posts", id));
        const authorId = String(post.data()?.authorId || "");
        if (authorId && authorId !== uid) {
          const me = await userPublic(uid, authorId);
          await notify(
            authorId,
            "New like",
            `${me?.displayName ?? "Someone"} liked your post`,
            "/home",
          );
        }
      }
      result = await loadPost(id, uid);
    } else if (path.match(/^\/api\/posts\/[^/]+\/comments$/) && method === "POST") {
      const id = path.split("/")[3]!;
      const text = String(body.body || "").trim();
      if (!text) fail(400, "Write a comment.");
      await addDoc(collection(db, "posts", id, "comments"), {
        authorId: uid,
        body: text.slice(0, 280),
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "posts", id), { commentCount: increment(1) });
      const post = await getDoc(doc(db, "posts", id));
      const authorId = String(post.data()?.authorId || "");
      if (authorId && authorId !== uid) {
        const me = await userPublic(uid, authorId);
        await notify(authorId, "New comment", `${me?.displayName ?? "Someone"} commented`, "/home");
      }
      result = await loadPost(id, uid);
    } else if (path === "/api/stories" && method === "GET") result = await handleStories(uid);
    else if (path === "/api/stories" && method === "POST") {
      let imageUrl: string | null = null;
      if (typeof body.imageData === "string" && body.imageData.startsWith("data:")) {
        imageUrl = await uploadDataUrl(`stories/${uid}/${Date.now()}.jpg`, body.imageData);
      }
      const caption = body.body ? String(body.body).slice(0, 200) : null;
      if (!imageUrl && !caption) fail(400, "Add a photo or a caption.");
      await addDoc(collection(db, "stories"), {
        authorId: uid,
        body: caption,
        imageUrl,
        createdAt: serverTimestamp(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
      result = await handleStories(uid);
    } else if (path.match(/^\/api\/stories\/[^/]+\/view$/) && method === "POST") {
      const id = path.split("/")[3]!;
      await setDoc(doc(db, "storyViews", `${id}_${uid}`), { at: serverTimestamp() });
      result = { ok: true };
    } else if (path.match(/^\/api\/stories\/[^/]+$/) && method === "DELETE") {
      const id = path.split("/").pop()!;
      const snap = await getDoc(doc(db, "stories", id));
      if (snap.data()?.authorId !== uid) fail(403, "You can only delete your story.");
      await deleteDoc(doc(db, "stories", id));
      result = { ok: true };
    } else if (path === "/api/discover" || path === "/api/discover/recommendations") {
      result = await handleDiscover(uid, search);
    } else if (path.match(/^\/api\/users\/[^/]+$/) && method === "GET") {
      const id = path.split("/").pop()!;
      const user = await userPublic(id, uid);
      if (!user) fail(404, "Player not found.");
      result = { user };
    } else if (path.match(/^\/api\/users\/[^/]+\/follow$/) && method === "POST") {
      const id = path.split("/")[3]!;
      await setDoc(doc(db, "follows", `${uid}_${id}`), {
        from: uid,
        to: id,
        createdAt: serverTimestamp(),
      });
      result = { ok: true };
    } else if (path.match(/^\/api\/users\/[^/]+\/block$/) && method === "POST") {
      const id = path.split("/")[3]!;
      await addDoc(collection(db, "blocks"), {
        ownerId: uid,
        targetId: id,
        createdAt: serverTimestamp(),
      });
      result = { ok: true };
    } else if (path === "/api/reports" && method === "POST") {
      await addDoc(collection(db, "reports"), {
        ...body,
        reporterId: uid,
        createdAt: serverTimestamp(),
      });
      result = { ok: true };
    } else if (path === "/api/duo-requests" && method === "GET") {
      const a = await getDocs(query(collection(db, "duoRequests"), where("from", "==", uid)));
      const b = await getDocs(query(collection(db, "duoRequests"), where("to", "==", uid)));
      const items = [];
      for (const row of [...a.docs, ...b.docs]) {
        const data = row.data();
        const requester = await userPublic(String(data.from), uid);
        items.push({
          id: row.id,
          mode: data.mode,
          status: data.status,
          requester,
        });
      }
      result = { items };
    } else if (path === "/api/duo-requests" && method === "POST") {
      const target = String(body.targetId || body.userId || "");
      if (!target) fail(400, "Pick a player.");
      const added = await addDoc(collection(db, "duoRequests"), {
        from: uid,
        to: target,
        mode: body.mode || "CLASH_SQUAD",
        status: "PENDING",
        createdAt: serverTimestamp(),
      });
      const me = await userPublic(uid, target);
      await notify(
        target,
        "Duo invite",
        `${me?.displayName ?? "Someone"} invited you to queue`,
        "/requests",
      );
      result = { id: added.id };
    } else if (
      path.match(/^\/api\/duo-requests\/[^/]+\/(accept|decline|cancel)$/) &&
      method === "POST"
    ) {
      const parts = path.split("/");
      const id = parts[3]!;
      const verb = parts[4];
      await updateDoc(doc(db, "duoRequests", id), {
        status: verb === "accept" ? "ACCEPTED" : verb === "decline" ? "DECLINED" : "CANCELLED",
      });
      result = { ok: true };
    } else if (path === "/api/notifications" && method === "GET") {
      const snap = await getDocs(
        query(collection(db, "notifications"), where("userId", "==", uid), limit(50)),
      );
      const items = snap.docs
        .map((row) => ({
          id: row.id,
          title: String(row.data().title || ""),
          body: String(row.data().body || ""),
          link: row.data().link as string | undefined,
          readAt: row.data().readAt ? iso(row.data().readAt) : null,
          createdAt: iso(row.data().createdAt),
        }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      result = { items, unread: items.filter((item) => !item.readAt).length };
    } else if (path === "/api/notifications/read" && method === "POST") {
      const snap = await getDocs(
        query(collection(db, "notifications"), where("userId", "==", uid)),
      );
      const batch = writeBatch(db);
      snap.docs.forEach((row) => {
        if (!row.data().readAt) batch.update(row.ref, { readAt: serverTimestamp() });
      });
      await batch.commit();
      result = { ok: true };
    } else if (path === "/api/auth/verify-email/resend" && method === "POST") {
      const user = firebaseAuth.currentUser;
      if (user && !user.emailVerified) await sendEmailVerification(user);
      result = { ok: true };
    } else if (path === "/api/auth/logout-all" && method === "POST") {
      result = { ok: true };
    } else if (path === "/api/account" && method === "DELETE") {
      await updateDoc(doc(db, "users", uid), { status: "DELETED", displayName: "Deleted player" });
      result = { ok: true };
    } else if (path === "/api/dev/mailbox") result = { items: [] };
    else if (path.startsWith("/api/admin")) fail(403, "Admin tools need the server.");
    else if (path.startsWith("/api/sandbox") || path.startsWith("/api/payments/orders/")) {
      fail(400, "Payments need a live payment server.");
    } else {
      result =
        (await handleFriendships(uid, method, path, body)) ??
        (await handleChat(uid, method, path, body)) ??
        (await handleCalls(uid, method, path, body)) ??
        (await handleEconomy(uid, method, path, body, search));
    }

    if (result == null) fail(404, "Not found.");
    return result as T;
  } catch (err) {
    if (err instanceof RequestError) throw err;
    throw new RequestError(0, {
      code: "CLOUD",
      message: explainFirebaseError(err),
    });
  }
}

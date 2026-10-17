// R7/R8 — Laravel-authoritative classroom bridge and native Android contract.
import { createHmac, generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { makeCtx, makeD1, makeR2 } from "../d1shim.mjs";
import { installGoogleStub, makeReg } from "../helpers/phoneauth.mjs";

installGoogleStub();
const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;
const worker = (await import(`${WORKER}?classroom=${Date.now()}`)).default;
const ROOT = randomBytes(32);
const ORIGIN = "https://classroom.vx.test";
const signBridge = (claims) => {
  const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${encoded}.${createHmac("sha256", ROOT).update(encoded).digest("base64url")}`;
};

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const FCM_CREDENTIALS = JSON.stringify({
  project_id: "kp-classroom-test",
  client_email: "svc@kp-classroom-test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  token_uri: "https://oauth2.googleapis.com/token",
});
const upstreamCalls = [];
const pushes = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.includes("oauth2.googleapis.com/token") && !url.includes("tokeninfo")) {
    return Response.json({ access_token: "classroom-fcm-token", expires_in: 3600 });
  }
  if (url.includes("fcm.googleapis.com/v1/projects")) {
    pushes.push(JSON.parse(init.body));
    return Response.json({ name: "projects/test/messages/classroom" });
  }
  if (!url.startsWith(ORIGIN)) return realFetch(input, init);
  const path = new URL(url).pathname;
  const assertion = init.headers?.["x-vintox-classroom-assertion"] ?? "";
  const [encoded, signature] = assertion.split(".");
  const purpose = createHmac("sha256", ROOT).update("vintoxbd/classroom-bridge/v1").digest();
  const valid =
    !!encoded &&
    !!signature &&
    createHmac("sha256", purpose).update(encoded).digest("base64url") === signature;
  const claims = valid ? JSON.parse(Buffer.from(encoded, "base64url").toString()) : {};
  const requestBody = init.body ? JSON.parse(init.body) : {};
  upstreamCalls.push({ path, method: init.method, valid, claims, body: requestBody });
  if (!valid) return Response.json({ message: "bad assertion" }, { status: 401 });
  if (path.includes("/materials/")) {
    return new Response("first-party-material", {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="lesson.pdf"',
      },
    });
  }
  if (path.endsWith("/recording")) {
    return new Response("first-party-recording", {
      headers: {
        "content-type": "video/mp4",
        "content-disposition": 'attachment; filename="class-recording.mp4"',
      },
    });
  }
  if (path.endsWith("/state")) {
    return Response.json({
      inSession: true,
      polls: [],
      quizzes: [],
      questions: [],
      hands: {},
      chat: [],
    });
  }
  if (path.endsWith("/questions")) return Response.json({ question: requestBody });
  if (path.endsWith("/raise-hand")) return Response.json({ hand: { status: "raised" } });
  if (path.endsWith("/chat")) return Response.json({ message: requestBody });
  if (path.includes("/polls/")) return Response.json({ vote: requestBody });
  if (path.includes("/quizzes/")) return Response.json({ score: { earned: 1, total: 1 } });
  if (path.endsWith("/attendance")) {
    return Response.json({ ok: true, seconds: 30, left: requestBody.event === "leave" });
  }
  if (path.endsWith("/room-token")) {
    return Response.json({
      role: "instructor",
      canPublish: true,
    });
  }
  if (path.endsWith("/41")) {
    return Response.json({ class: { id: 41, title: "Physics", joinable: true } });
  }
  return Response.json({
    revision: "r1",
    classes: [{ id: 41, title: "Physics", joinable: true }],
  });
};

const db = makeD1();
const env = {
  DB: db,
  MEDIA: makeR2(),
  GOOGLE_WEB_CLIENT_ID: "kp-test-web-client",
  LARAVEL_BRIDGE_KEY: ROOT.toString("base64url"),
  WS_TICKET_KEY: ROOT.toString("base64url"),
  LARAVEL_CLASSROOM_ORIGIN: ORIGIN,
  FCM_CREDENTIALS,
  SELF_ORIGIN: "https://kp.test",
};
const ctx = makeCtx();
let ipSeq = 0;
const call = async (method, path, body, token, overrideEnv = env) => {
  const headers = { "content-type": "application/json" };
  if (path.startsWith("/api/auth/")) headers["cf-connecting-ip"] = `203.70.0.${++ipSeq}`;
  if (token) headers.authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);
  const response = await worker.fetch(
    new Request(`https://kp.test${path}`, init),
    overrideEnv,
    ctx,
  );
  const json = await response.json();
  await ctx.drain();
  return { status: response.status, json, headers: response.headers };
};

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(
    `  ${condition ? "OK     " : "BROKEN "}  ${name}${!condition && detail ? `  -> ${detail}` : ""}`,
  );
const reg = makeReg(call);
const kp = await reg("class-kp@x.test", "Class Student");
const websiteSubject = "laravel-student-41";
const vx = await call("POST", "/api/auth/realm/exchange", {
  assertion: signBridge({
    sub: websiteSubject,
    handle: "class_student_vx",
    displayName: "Website Student",
    aud: "vintoxbd-core",
    iat: Date.now(),
    exp: Date.now() + 60_000,
  }),
  deviceId: "web-class-41",
});

// Unlinked KP identity must stop before Laravel is contacted.
const callsBeforeUnlinked = upstreamCalls.length;
const unlinked = await call("GET", "/api/classroom/v1/classes", undefined, kp.token);
check(
  "an unlinked KP account fails before Laravel is called",
  unlinked.status === 403 &&
    unlinked.json.error?.code === "CLASSROOM_LINK_REQUIRED" &&
    upstreamCalls.length === callsBeforeUnlinked,
  JSON.stringify(unlinked),
);

// Complete the ordinary explicit approval ceremony; no identity similarity is used.
const initiated = await call("POST", "/api/links/approvals", { targetRealm: "vx" }, kp.token);
const approval = initiated.json.approval;
await call(
  "POST",
  `/api/links/approvals/${approval.id}/approve`,
  { code: approval.code, confirm: true },
  vx.json.token,
);

await call(
  "POST",
  "/api/devices",
  { token: "kp-classroom-device-token", deviceId: "class-phone", platform: "android" },
  kp.token,
);

const listed = await call("GET", "/api/classroom/v1/classes", undefined, kp.token);
const listCall = upstreamCalls.at(-1);
check(
  "an explicitly linked KP account receives Laravel-authoritative classes",
  listed.status === 200 && listed.json.classes?.[0]?.id === 41,
  JSON.stringify(listed),
);
check(
  "the upstream credential is purpose-, method-, path-, identity- and time-bound",
  listCall.valid &&
    listCall.method === "GET" &&
    listCall.claims.iss === "vintoxbd-comm-core" &&
    listCall.claims.aud === "vintoxbd-classroom" &&
    listCall.claims.path === "/internal/classroom/v1/classes" &&
    listCall.claims.method === "GET" &&
    listCall.claims.websiteSubject === websiteSubject &&
    listCall.claims.vxCommunicationId === vx.json.user.id &&
    listCall.claims.actorCommunicationId === kp.user.id &&
    listCall.claims.actorRealm === "kp" &&
    listCall.claims.exp - listCall.claims.iat === 45_000 &&
    /^[A-Za-z0-9_-]{20,80}$/.test(listCall.claims.nonce),
  JSON.stringify(listCall),
);
check(
  "the entitlement is cached as a managed class group but never as authority",
  db._db
    .prepare("SELECT class_id, website_subject FROM managed_classrooms WHERE kp_user_id = ?")
    .get(kp.user.id)?.class_id === "41",
);

const classNotificationFields = {
  notificationId: "701",
  classId: "41",
  eventType: "class_live",
  title: "Live now",
  body: "Your Physics class is live — join now.",
};
const issued = Date.now();
const classNotification = {
  ...classNotificationFields,
  assertion: signBridge({
    sub: websiteSubject,
    aud: "vintoxbd-core",
    iat: issued,
    exp: issued + 45_000,
    originRealm: "vx",
    communicationId: vx.json.user.id,
    purpose: "class-notification",
    ...classNotificationFields,
    nonce: randomBytes(24).toString("base64url"),
  }),
};
const unsigned = await call(
  "POST",
  "/api/classroom/v1/notifications",
  classNotificationFields,
  vx.json.token,
);
const relayed = await call(
  "POST",
  "/api/classroom/v1/notifications",
  classNotification,
  vx.json.token,
);
const replayed = await call(
  "POST",
  "/api/classroom/v1/notifications",
  classNotification,
  vx.json.token,
);
const classPush = pushes.at(-1)?.message;
check(
  "Laravel class alerts reach only the approved KP link and deduplicate by source notification",
  unsigned.status === 401 &&
    unsigned.json.error?.code === "BAD_CLASS_NOTIFICATION_ASSERTION" &&
    relayed.status === 200 &&
    relayed.json.accepted === true &&
    replayed.json.deduplicated === true &&
    pushes.length === 1 &&
    classPush?.token === "kp-classroom-device-token" &&
    classPush?.android?.data?.type === "classroom" &&
    classPush?.android?.data?.classId === "41" &&
    classPush?.android?.notification?.channel_id === "kp_classes_v1" &&
    classPush?.android?.notification?.tag === "class-41" &&
    db._db
      .prepare("SELECT state FROM classroom_notification_deliveries WHERE source_id = ?")
      .get(`${vx.json.user.id}:701`)?.state === "delivered",
  JSON.stringify({ relayed, replayed, pushes }),
);

const token = await call("POST", "/api/classroom/v1/classes/41/room-token", {}, kp.token);
const tokenCall = upstreamCalls.at(-1);
check(
  "room admission returns a six-person direct-media mesh credential after Laravel approval",
  token.status === 200 &&
    token.json.transport === "p2p-mesh" &&
    token.json.instructor === true &&
    token.json.maxParticipants === 6 &&
    token.json.turnFallback === false &&
    token.json.url === "wss://kp.test/ws/classroom/41" &&
    typeof token.json.ticket === "string" &&
    token.json.ticket.includes(".") &&
    tokenCall.method === "POST" &&
    tokenCall.claims.path === "/internal/classroom/v1/classes/41/room-token" &&
    token.headers.get("cache-control") === "private, no-store",
  JSON.stringify(token),
);

const attendance = await call(
  "POST",
  "/api/classroom/v1/classes/41/attendance",
  { event: "heartbeat" },
  kp.token,
);
const attendanceCall = upstreamCalls.at(-1);
check(
  "native attendance is assertion-bound and forwards only an allowlisted event",
  attendance.status === 200 &&
    attendanceCall.claims.path === "/internal/classroom/v1/classes/41/attendance" &&
    attendanceCall.body.event === "heartbeat",
  JSON.stringify(attendance),
);

const toolCalls = [
  [
    "GET",
    "/api/classroom/v1/classes/41/state",
    undefined,
    "/internal/classroom/v1/classes/41/state",
  ],
  [
    "POST",
    "/api/classroom/v1/classes/41/questions",
    { question: "Explain this" },
    "/internal/classroom/v1/classes/41/questions",
  ],
  [
    "POST",
    "/api/classroom/v1/classes/41/raise-hand",
    {},
    "/internal/classroom/v1/classes/41/raise-hand",
  ],
  [
    "POST",
    "/api/classroom/v1/classes/41/chat",
    { body: "Hello class" },
    "/internal/classroom/v1/classes/41/chat",
  ],
  [
    "POST",
    "/api/classroom/v1/classes/41/polls/7/vote",
    { option: 1 },
    "/internal/classroom/v1/classes/41/polls/7/vote",
  ],
  [
    "POST",
    "/api/classroom/v1/classes/41/quizzes/8/submit",
    { answers: { 9: 0 } },
    "/internal/classroom/v1/classes/41/quizzes/8/submit",
  ],
];
let toolsOk = true;
for (const [method, path, payload, internalPath] of toolCalls) {
  const answer = await call(method, path, payload, kp.token);
  const seen = upstreamCalls.at(-1);
  toolsOk &&= answer.status === 200 && seen.valid && seen.claims.path === internalPath;
}
check(
  "class state, questions, hand, chat, polls and quizzes stay on signed first-party routes",
  toolsOk,
);

const materialResponse = await worker.fetch(
  new Request("https://kp.test/api/classroom/v1/classes/41/materials/12", {
    headers: { authorization: `Bearer ${kp.token}` },
  }),
  env,
  ctx,
);
const materialBody = await materialResponse.text();
const materialCall = upstreamCalls.at(-1);
check(
  "class materials stream first-party with signed authority and no storage URL",
  materialResponse.status === 200 &&
    materialResponse.headers.get("cache-control") === "private, no-store" &&
    materialResponse.headers.get("content-type") === "application/pdf" &&
    materialCall.claims.path === "/internal/classroom/v1/classes/41/materials/12" &&
    materialBody === "first-party-material",
);

const recordingResponse = await worker.fetch(
  new Request("https://kp.test/api/classroom/v1/classes/41/recording", {
    headers: { authorization: `Bearer ${kp.token}` },
  }),
  env,
  ctx,
);
const recordingBody = await recordingResponse.text();
const recordingCall = upstreamCalls.at(-1);
check(
  "finished recordings stream through the same first-party entitlement boundary",
  recordingResponse.status === 200 &&
    recordingResponse.headers.get("content-type") === "video/mp4" &&
    recordingCall.claims.path === "/internal/classroom/v1/classes/41/recording" &&
    recordingBody === "first-party-recording",
);

const badQuizCalls = upstreamCalls.length;
const badQuiz = await call(
  "POST",
  "/api/classroom/v1/classes/41/quizzes/8/submit",
  { answers: { exploit: "yes" } },
  kp.token,
);
check(
  "malformed classroom actions are rejected before reaching Laravel",
  badQuiz.status === 400 && upstreamCalls.length === badQuizCalls,
  JSON.stringify(badQuiz),
);

const unavailable = await call("POST", "/api/classroom/v1/classes/41/room-token", {}, kp.token, {
  ...env,
  LARAVEL_CLASSROOM_ORIGIN: undefined,
});
check(
  "an unconfigured classroom bridge fails closed",
  unavailable.status === 503 && unavailable.json.error?.code === "CLASSROOM_UNAVAILABLE",
  JSON.stringify(unavailable),
);

const link = db._db.prepare("SELECT id FROM identity_links WHERE status = 'ACTIVE'").get();
await call("POST", `/api/links/${link.id}/revoke`, {}, kp.token);
const beforeRevoked = upstreamCalls.length;
const revoked = await call("POST", "/api/classroom/v1/classes/41/room-token", {}, kp.token);
check(
  "revocation blocks token refresh before Laravel and the managed cache cannot override it",
  revoked.status === 403 &&
    revoked.json.error?.code === "CLASSROOM_LINK_REQUIRED" &&
    upstreamCalls.length === beforeRevoked &&
    db._db.prepare("SELECT COUNT(*) n FROM managed_classrooms WHERE kp_user_id = ?").get(kp.user.id)
      .n === 1,
  JSON.stringify(revoked),
);

const android = readFileSync(
  new URL(
    "../../native-android/app/src/main/java/app/kuchupuchu/android/ClassroomScreens.kt",
    import.meta.url,
  ),
  "utf8",
);
const coreApi = readFileSync(
  new URL(
    "../../native-android/app/src/main/java/app/kuchupuchu/android/VintoxBdCore.kt",
    import.meta.url,
  ),
  "utf8",
);
const recoveryPolicy = readFileSync(
  new URL(
    "../../native-android/app/src/main/java/app/kuchupuchu/android/ClassroomRecoveryPolicy.kt",
    import.meta.url,
  ),
  "utf8",
);
const recoveryTest = readFileSync(
  new URL(
    "../../native-android/app/src/test/java/app/kuchupuchu/android/ClassroomRecoveryPolicyTest.kt",
    import.meta.url,
  ),
  "utf8",
);
const app = readFileSync(
  new URL(
    "../../native-android/app/src/main/java/app/kuchupuchu/android/KpApp.kt",
    import.meta.url,
  ),
  "utf8",
);
const push = readFileSync(
  new URL(
    "../../native-android/app/src/main/java/app/kuchupuchu/android/KpPush.kt",
    import.meta.url,
  ),
  "utf8",
);
const notify = readFileSync(
  new URL(
    "../../native-android/app/src/main/java/app/kuchupuchu/android/KpNotify.kt",
    import.meta.url,
  ),
  "utf8",
);
const mainActivity = readFileSync(
  new URL(
    "../../native-android/app/src/main/java/app/kuchupuchu/android/MainActivity.kt",
    import.meta.url,
  ),
  "utf8",
);
const menu = readFileSync(
  new URL(
    "../../native-android/app/src/main/java/app/kuchupuchu/android/ChatListScreen.kt",
    import.meta.url,
  ),
  "utf8",
);
const gradle = readFileSync(
  new URL("../../native-android/app/build.gradle.kts", import.meta.url),
  "utf8",
);
const settings = readFileSync(
  new URL("../../native-android/settings.gradle.kts", import.meta.url),
  "utf8",
);
check(
  "Android uses native Class routes, video, authoritative refresh, explicit retry/relink, leave cleanup and no WebView fallback",
  app.includes('composable("classroom") { ClassroomListScreen(nav) }') &&
    app.includes("MainActivity.pendingClass.collect") &&
    mainActivity.includes('intent.getStringExtra("kp_class")') &&
    push.includes('"classroom" -> handleClassroom(data)') &&
    notify.includes('private const val CLASS_CHANNEL = "kp_classes_v1"') &&
    notify.includes('putExtra("kp_class", classId)') &&
    menu.includes('HomeMenuItem(Icons.Filled.School, "Class")') &&
    android.includes('CoreApi.getAsync(ctx, "/api/classroom/v1/classes")') &&
    android.includes("VintoxMediaRoom(") &&
    android.includes("track.addSink(it)") &&
    android.includes("retryNonce++") &&
    android.includes("ClassroomRecoveryPolicy.shouldAutoRefresh") &&
    android.includes("classroomNeedsRelink(e)") &&
    recoveryPolicy.includes("fun needsRelink(status: Int, code: String)") &&
    recoveryPolicy.includes("fun canRetryConnection(") &&
    recoveryTest.includes("gets exactly one automatic token refresh") &&
    recoveryTest.includes("authorization and link failures require reauthentication") &&
    android.includes('nav.navigate("settings/vintoxbd")') &&
    android.includes('Text("Try connection again")') &&
    android.includes('JSONObject().put("event", "heartbeat")') &&
    android.includes('JSONObject().put("event", "leave")') &&
    android.includes("ClassroomToolsPanel(") &&
    android.includes('state?.optJSONArray("roster")') &&
    android.includes('state?.optJSONObject("hands")?.optJSONArray("participants")') &&
    android.includes('RealmBadge(originRealmOf(row.optString("originRealm"))') &&
    android.includes("CoreApi.downloadToDownloads(") &&
    android.includes('"/api/classroom/v1/classes/$classId/materials/$materialId"') &&
    android.includes('"/api/classroom/v1/classes/$classId/recording"') &&
    android.includes('Text("Save class recording")') &&
    coreApi.includes("suspend fun downloadToDownloads(") &&
    coreApi.includes("body.byteStream().use") &&
    coreApi.includes("MediaStore.Downloads.IS_PENDING") &&
    android.includes('onAction("raise-hand"') &&
    android.includes('onAction("questions"') &&
    android.includes('onAction("chat"') &&
    android.includes('onAction("polls/') &&
    android.includes('onAction("quizzes/') &&
    android.includes("manuallyLeft = true") &&
    android.includes("room?.disconnect()") &&
    !android.includes("WebView") &&
    gradle.includes('implementation("io.getstream:stream-webrtc-android:1.1.3")') &&
    !settings.includes('maven("https://jitpack.io")'),
);

console.log("\n[97] Classroom entitlement bridge");
for (const line of lines) console.log(line);
const broken = lines.filter((line) => line.includes("BROKEN")).length;
globalThis.fetch = realFetch;
process.exit(broken ? 1 : 0);

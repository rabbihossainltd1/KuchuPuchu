import { readFileSync } from "node:fs";
import { makeCtx, makeD1, makeR2 } from "../d1shim.mjs";
import { installGoogleStub, makeReg } from "../helpers/phoneauth.mjs";
import { completeAiText } from "../../src/worker/aiText.ts";

installGoogleStub();

const WORKER = new URL("../../src/worker/index.ts", import.meta.url).href;
const worker = (await import(`${WORKER}?delivery-length=1`)).default;
const db = makeD1();
const env = { DB: db, MEDIA: makeR2(), GOOGLE_WEB_CLIENT_ID: "kp-test-web-client" };
const ctx = makeCtx();
const lines = [];
const check = (name, cond, detail = "") =>
  lines.push(
    `  ${cond ? "OK     " : "BROKEN "}  ${name}${!cond && detail ? `  -> ${detail}` : ""}`,
  );
let ipSeq = 0;
const call = async (method, path, body, token) => {
  const headers = { "content-type": "application/json" };
  if (path.startsWith("/api/auth/"))
    headers["cf-connecting-ip"] = `203.31.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
  if (token) headers.authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);
  const response = await worker.fetch(new Request(`https://kp.test${path}`, init), env, ctx);
  const text = await response.text();
  await ctx.drain();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { _raw: text.slice(0, 100) };
  }
  return { status: response.status, json };
};
const reg = makeReg(call);
const A = await reg("delivery-a@x.com", "Delivery A");
const B = await reg("delivery-b@x.com", "Delivery B");
const created = await call("POST", "/api/conversations", { userId: B.user.id }, A.token);
const conversationId = created.json.conversation?.id;

const longUserBody = "বাংলা message delivery test — ".repeat(50);
const sent = await call(
  "POST",
  `/api/conversations/${conversationId}/messages`,
  { body: longUserBody, clientId: "delivery-over-600" },
  A.token,
);
const page = await call("GET", `/api/conversations/${conversationId}/messages`, undefined, B.token);
const deliveredBody = page.json.items?.find((row) => row.clientId === "delivery-over-600")?.body;
check(
  "a user-authored message over 600 characters is stored and delivered in full",
  sent.status === 201 && deliveredBody === longUserBody.trim() && deliveredBody.length > 600,
  JSON.stringify({
    status: sent.status,
    sentLength: longUserBody.trim().length,
    receivedLength: deliveredBody?.length,
  }),
);

await call(
  "POST",
  `/api/conversations/${conversationId}/messages`,
  { body: "*bold preview**" },
  A.token,
);
const conversations = await call("GET", "/api/conversations", undefined, A.token);
const previewRow = conversations.json.items?.find((row) => row.id === conversationId);
check(
  "mismatched bold markers are removed from Worker chat-list previews",
  previewRow?.lastMessage === "bold preview" &&
    previewRow?.lastMessagePreview?.body === "bold preview",
  JSON.stringify({
    lastMessage: previewRow?.lastMessage,
    preview: previewRow?.lastMessagePreview?.body,
  }),
);

for (const [kind, attachment] of [
  ["IMAGE", { imageData: "data:image/jpeg;base64,AAAA" }],
  ["VIDEO", {}],
  [
    "FILE",
    { fileKey: "f/preview-file.pdf", fileName: "preview-file.pdf", fileType: "application/pdf" },
  ],
]) {
  const mediaSent = await call(
    "POST",
    `/api/conversations/${conversationId}/messages`,
    { kind, body: "*media caption**", ...attachment },
    A.token,
  );
  const mediaConversations = await call("GET", "/api/conversations", undefined, A.token);
  const mediaPreview = mediaConversations.json.items?.find((row) => row.id === conversationId);
  check(
    `bold markers are removed from ${kind.toLowerCase()} caption previews`,
    mediaSent.status === 201 &&
      mediaPreview?.lastMessage === "media caption" &&
      mediaPreview?.lastMessagePreview?.body === "media caption",
    JSON.stringify({
      kind,
      status: mediaSent.status,
      lastMessage: mediaPreview?.lastMessage,
      preview: mediaPreview?.lastMessagePreview?.body,
    }),
  );
}

const tooLong = await call(
  "POST",
  `/api/conversations/${conversationId}/messages`,
  { body: "x".repeat(4_001) },
  A.token,
);
check(
  "an over-limit user message is refused instead of silently truncated",
  tooLong.status === 400 && tooLong.json.error?.code === "MESSAGE_TOO_LONG",
  JSON.stringify({ status: tooLong.status, code: tooLong.json.error?.code }),
);

const aiAnswer = `  ${"দীর্ঘ AI উত্তর সম্পূর্ণ থাকে। ".repeat(65)}  `;
const normalizedAi = completeAiText(aiAnswer);
const workerSource = readFileSync("src/worker/index.ts", "utf8");
check(
  "AI text normalization retains the complete provider answer beyond 600 characters",
  normalizedAi === aiAnswer.trim() && normalizedAi.length > 600,
  `length=${normalizedAi.length}`,
);
check(
  "HF, Cloudflare, Gemini, and the Gemini stream have no 600-character truncation or stream stop",
  (workerSource.match(/completeAiText\(/g) ?? []).length >= 5 &&
    !/\.slice\(0,\s*600\)/.test(workerSource) &&
    !/text\.length\s*<=\s*600/.test(workerSource) &&
    workerSource.includes("onChunk(text);"),
);

console.log(lines.join("\n"));
const broken = lines.filter((line) => line.includes("BROKEN")).length;
console.log(`\n--- ${lines.length - broken} ok / ${broken} broken ---`);
process.exit(broken ? 1 : 0);

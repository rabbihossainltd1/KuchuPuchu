// Typed Web route parsing and canonical path generation.
import { isDeepStrictEqual } from "node:util";
import { canonicalPath, parseRoute, pathForRoute } from "../../web/src/router.ts";

const lines = [];
const check = (name, condition, detail = "") =>
  lines.push(`  ${condition ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);
const routeIs = (name, pathname, expected) =>
  check(
    name,
    isDeepStrictEqual(parseRoute(pathname), expected),
    JSON.stringify(parseRoute(pathname)),
  );

routeIs("root resolves to the chat section", "/", { kind: "section", section: "chats" });
routeIs("chat section parses", "/chats", { kind: "section", section: "chats" });
routeIs("trailing slash parses to its section", "/statuses/", {
  kind: "section",
  section: "statuses",
});
routeIs("section paths are case-insensitive", "/CALLS", { kind: "section", section: "calls" });
routeIs("opaque conversation id parses", "/chats/thread-42", {
  kind: "conversation",
  conversationId: "thread-42",
});
routeIs("encoded conversation id is decoded", "/chats/hello%20world", {
  kind: "conversation",
  conversationId: "hello world",
});
routeIs(
  "unicode conversation id parses",
  "/chats/%E0%A6%AC%E0%A6%BE%E0%A6%B0%E0%A7%8D%E0%A6%A4%E0%A6%BE",
  {
    kind: "conversation",
    conversationId: "বার্তা",
  },
);
routeIs("unknown path is not treated as a chat", "/admin", { kind: "not-found" });
routeIs("malformed escape is rejected", "/chats/%E0%A4%A", { kind: "not-found" });
routeIs("encoded slash cannot escape a conversation segment", "/chats/a%2Fb", {
  kind: "not-found",
});
routeIs("dot-segment ids are rejected", "/chats/%2E%2E", { kind: "not-found" });
routeIs("trailing slash does not create an empty conversation route", "/chats/", {
  kind: "section",
  section: "chats",
});
routeIs("blank encoded conversation id is rejected", "/chats/%20%20", { kind: "not-found" });
routeIs("duplicate path separators are rejected", "/chats//thread-42", { kind: "not-found" });

const encodedRoute = { kind: "conversation", conversationId: "thread 42-বার্তা" };
check(
  "conversation path safely encodes opaque ids",
  pathForRoute(encodedRoute) ===
    "/chats/thread%2042-%E0%A6%AC%E0%A6%BE%E0%A6%B0%E0%A7%8D%E0%A6%A4%E0%A6%BE",
  pathForRoute(encodedRoute),
);
check(
  "encoded conversation path round-trips",
  isDeepStrictEqual(parseRoute(pathForRoute(encodedRoute)), encodedRoute),
);
check("root canonicalizes to chats", canonicalPath("/") === "/chats");
check("trailing slash canonicalizes", canonicalPath("/calls/") === "/calls");
check("unknown path is not rewritten", canonicalPath("/unknown") === null);

console.log(lines.join("\n"));
const broken = lines.filter((line) => line.includes("BROKEN")).length;
console.log(`case 50: ${lines.length} checks, ${broken} broken`);
process.exit(broken ? 1 : 0);

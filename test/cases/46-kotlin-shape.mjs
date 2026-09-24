// Kotlin source shape: the sandbox has no Kotlin compiler (CI's `apk` job is the
// only compile witness), so the two mistakes that DID reach CI — a detached
// annotation and unbalanced braces — are checked here, off-device.
//
// r68: two errors reached CI (`AnimatedVisibility` called through the wrong
// implicit receiver, and an unresolved local function).
// r69: two more did — `@Composable` left dangling above a new composable, so the
// NEXT declaration carried two of them ("This annotation is not repeatable") and
// the function it used to annotate was no longer @Composable at all.
//
// The rules below are shape rules, not a compiler: they catch exactly the
// classes we have actually shipped a broken build with.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const lines = [];
const check = (name, cond, detail) =>
  lines.push(`  ${cond ? "OK     " : "BROKEN "}  ${name}${detail ? `  -> ${detail}` : ""}`);

const ROOTS = [
  "native-android/app/src/main/java/app/kuchupuchu/android",
  "native-android/app/src/test/java/app/kuchupuchu/android",
];

function ktFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...ktFiles(p));
    else if (e.endsWith(".kt") || e.endsWith(".kts")) out.push(p);
  }
  return out;
}

/** Comments and strings stripped, so braces inside them cannot fake a balance. */
function strip(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const two = src.slice(i, i + 2);
    const ch = src[i];
    // Strings FIRST: `"https://x"` must not have its tail read as a comment.
    // Backticked identifiers matter too: a JUnit test name like
    // `fun \`a stranger's key opens nothing\`()` carries an apostrophe that a
    // naive scanner reads as a char literal and then swallows real braces with.
    if (ch === "`") {
      const j = src.indexOf("`", i + 1);
      i = j < 0 ? n : j + 1;
      out += "x";
      continue;
    }
    if (ch === '"' || ch === "'") {
      const triple = src.slice(i, i + 3) === ch.repeat(3);
      if (triple) {
        const j = src.indexOf(ch.repeat(3), i + 3);
        i = j < 0 ? n : j + 3;
        out += '""';
        continue;
      }
      i++;
      let esc = false;
      while (i < n && (src[i] !== ch || esc)) {
        esc = !esc && src[i] === "\\";
        i++;
      }
      i++;
      out += ch === '"' ? '""' : "''";
      continue;
    }
    if (two === "//") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (two === "/*") {
      const j = src.indexOf("*/", i + 2);
      i = j < 0 ? n : j + 2;
      continue;
    }
    // A regex literal cannot be told from a division without a parser; the
    // sources only use them in a few `Regex("…")` strings, which are handled
    // above, so nothing else needs a special case here.
    out += ch;
    i++;
  }
  return out;
}

const isComment = (t) => t === "" || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
const isDecl = (t) =>
  /^(public |internal |private |protected |inline |suspend |operator |override |open |abstract |external |tailrec |expect |actual )*\s*(fun|val|var|class|object|interface|enum|typealias|constructor)\b/.test(
    t,
  );

{
  const files = ROOTS.flatMap((r) => ktFiles(r));
  const unbalanced = [];
  for (const f of files) {
    const b = strip(readFileSync(f, "utf8"));
    const d = ["{}", "()", "[]"].map(([o, c]) => b.split(o).length - b.split(c).length);
    if (d.some((x) => x !== 0)) unbalanced.push(`${f.split("/").pop()} ${JSON.stringify(d)}`);
  }
  check(
    "kotlin shape: every source file is brace / paren / bracket balanced once comments and strings are stripped (the r69 ChatListScreen rebuild lost one and only CI could see it)",
    files.length > 20 && unbalanced.length === 0,
    unbalanced.length ? unbalanced.join(", ") : `${files.length} files`,
  );
}

{
  // An annotation belongs to the declaration under it. A `@Composable` that is
  // followed — over blanks and comments — by another annotation, or by anything
  // that is not a declaration, is DETACHED: the declaration it belonged to is
  // now un-annotated and the next one carries two.
  const detached = [];
  for (const f of ROOTS.flatMap((r) => ktFiles(r))) {
    const src = readFileSync(f, "utf8").split("\n");
    for (let i = 0; i < src.length; i++) {
      const t = src[i].trim();
      if (t !== "@Composable") continue;
      let j = i + 1;
      let guard = 0;
      while (j < src.length && guard++ < 30) {
        const u = src[j].trim();
        if (isComment(u)) {
          j++;
          continue;
        }
        if (u.startsWith("@")) {
          // two annotations in a row are legal (e.g. @Composable + @OptIn); only
          // a REPEAT of the same annotation, or a `@Composable` that finds
          // another `@Composable` under it, means one was left behind.
          if (u === "@Composable") detached.push(`${f.split("/").pop()}:${i + 1} duplicate ${t}`);
          break;
        }
        if (!isDecl(u))
          detached.push(`${f.split("/").pop()}:${i + 1} ${t} then "${u.slice(0, 40)}"`);
        break;
      }
      if (j >= src.length) detached.push(`${f.split("/").pop()}:${i + 1} dangling ${t}`);
    }
  }
  check(
    "kotlin shape: no annotation is detached — the r69 @Composable left above a new composable made CI report 'This annotation is not repeatable' and left ChatRowSheet / KpSheet un-annotated",
    detached.length === 0,
    detached.length ? detached.join(", ") : "no detached annotations",
  );
}

console.log(lines.join("\n"));
const broken = lines.filter((l) => l.includes("BROKEN")).length;
console.log(`kotlin-shape: ${lines.length - broken} ok / ${broken} broken`);
process.exit(broken ? 1 : 0);

// Comment/string-aware brace balance for the Kotlin sources, because the only
// Kotlin compiler in this sandbox is CI. Usage: node test/helpers/brace-check.mjs <file…>
// Strings and comments are stripped first, so text like `"{"` or `// )` cannot
// fake a balance.
import fs from "node:fs";

function strip(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (two === "/*") {
      const j = src.indexOf("*/", i + 2);
      i = j < 0 ? n : j + 2;
      continue;
    }
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i];
      const triple = src.slice(i, i + 3) === q.repeat(3);
      if (triple) {
        const j = src.indexOf(q.repeat(3), i + 3);
        i = j < 0 ? n : j + 3;
        out += '""';
        continue;
      }
      i++;
      let esc = false;
      while (i < n && (src[i] !== q || esc)) {
        esc = !esc && src[i] === "\\";
        i++;
      }
      i++;
      out += q === '"' ? '""' : "''";
      continue;
    }
    out += src[i];
    i++;
  }
  return out;
}

let bad = 0;
for (const file of process.argv.slice(2)) {
  const b = strip(fs.readFileSync(file, "utf8"));
  const d = ["{}", "()", "[]"].map(([o, c]) => b.split(o).length - b.split(c).length);
  const ok = d.every((x) => x === 0);
  if (!ok) bad++;
  console.log(
    `${file.split("/").pop().padEnd(22)} ${JSON.stringify(d)} ${ok ? "balanced" : "UNBALANCED"}`,
  );
}
process.exit(bad ? 1 : 0);

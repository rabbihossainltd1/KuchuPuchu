/**
 * Test runner.
 *
 * Each file in test/cases is a self-contained scenario that drives the real
 * worker (src/worker/index.ts) against an in-memory D1-shaped SQLite shim and
 * an in-memory R2, and prints one OK / BROKEN line per assertion. A case is run
 * in its own child process on purpose: the worker keeps `schemaReady` and the
 * rate-limit buckets in module scope, so sharing one process across cases would
 * let one case's database leak into the next.
 *
 * Exits non-zero if any case prints BROKEN or dies, so CI can gate on it.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cases = readdirSync(join(here, "cases"))
  .filter((f) => f.endsWith(".mjs"))
  .sort();

let failures = 0;
let checks = 0;

for (const name of cases) {
  const file = join(here, "cases", name);
  // `--import tsx` rather than inheriting process.execArgv: the cases import a
  // .ts file dynamically, and the parent's loader flags do not reliably reach a
  // spawned child.
  const res = spawnSync(process.execPath, ["--import", "tsx", file], {
    encoding: "utf8",
    cwd: join(here, ".."),
    env: process.env,
  });
  const out = `${res.stdout || ""}${res.stderr || ""}`;
  const ok = (out.match(/^\s*OK\s/gm) || []).length;
  const broken = (out.match(/^\s*BROKEN\s/gm) || []).length;
  checks += ok + broken;
  const crashed = res.status !== 0 && broken === 0;
  const failed = broken > 0 || crashed;
  if (failed) failures++;
  console.log(`${failed ? "FAIL" : "pass"}  ${name}  ${ok} ok / ${broken} broken`);
  if (failed) {
    for (const line of out.split("\n")) {
      if (/BROKEN|Error|error:|at /.test(line)) console.log(`        ${line.trim()}`);
    }
  }
}

console.log(`\n${cases.length - failures}/${cases.length} cases passed, ${checks} assertions`);
process.exit(failures ? 1 : 0);

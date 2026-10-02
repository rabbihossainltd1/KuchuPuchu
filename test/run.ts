/**
 * Test runner.
 *
 * Each file in test/cases is a self-contained scenario. Worker cases drive the
 * real worker (src/worker/index.ts) against in-memory D1/R2 shims; focused Web
 * contract cases may import pure client modules directly. Every case prints one
 * OK / BROKEN line per assertion and runs in its own child process: the worker
 * keeps `schemaReady` and rate-limit buckets in module scope, so sharing a
 * process could let one case's state leak into the next.
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

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const PATTERNS: { name: string; regex: RegExp }[] = [
  { name: "GitHub PAT", regex: /ghp_[A-Za-z0-9]{20,}/ },
  { name: "AWS key", regex: /AKIA[0-9A-Z]{16}/ },
  { name: "Private key", regex: /-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/ },
];

const IGNORE = new Set(["scripts/secret-scan.ts", "arena agent command.md", "package-lock.json"]);

function filesToScan(): string[] {
  try {
    return execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function main() {
  const files = filesToScan();
  if (!files.length) {
    console.info("secret-scan: no tracked files yet");
    process.exit(0);
  }
  const hits: string[] = [];
  for (const file of files) {
    if (IGNORE.has(file) || !existsSync(file)) continue;
    const content = readFileSync(file, "utf8");
    for (const pattern of PATTERNS) {
      if (pattern.regex.test(content)) hits.push(`${file}: ${pattern.name}`);
    }
  }
  if (hits.length) {
    console.error("Secret scan failed:");
    for (const hit of hits) console.error(` - ${hit}`);
    process.exit(1);
  }
  console.info("Secret scan passed.");
}

main();

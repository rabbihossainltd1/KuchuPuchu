/**
 * Derives the Web sticker catalog from the Android source of truth.
 *
 * `native-android/.../StickerSheet.kt` holds `object Stickers { val packs = ... }`.
 * The Web client must offer the same packs and the same glyphs in the same
 * order, or a sticker sent from a browser renders differently on a phone. The
 * catalog is therefore generated, never hand-copied: run this after any Android
 * sticker change, and `test/cases/57-web-media-attachments.mjs` re-derives the
 * same list from Kotlin and fails if the committed file drifts.
 *
 * Usage: npm run generate:web-stickers [-- --check]
 *   --check  verify the committed file matches, without writing (CI-safe)
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const KOTLIN = resolve(
  here,
  "../native-android/app/src/main/java/app/kuchupuchu/android/StickerSheet.kt",
);
const OUTPUT = resolve(here, "../web/src/media/stickerPacks.ts");

export type DerivedPack = { name: string; glyphs: string[] };

/** Pull `"Name" to listOf("a", "b")` pairs out of the `Stickers` object. */
export function deriveStickerPacks(kotlin: string): DerivedPack[] {
  const start = kotlin.indexOf("object Stickers {");
  if (start < 0) throw new Error("object Stickers not found in StickerSheet.kt");

  // The object ends at the first column-0 closing brace after its opening.
  const after = kotlin.slice(start);
  const end = after.indexOf("\n}");
  if (end < 0) throw new Error("unterminated object Stickers");
  const body = after.slice(0, end);

  const packs: DerivedPack[] = [];
  const pairRe = /"((?:[^"\\]|\\.)*)"\s+to\s+listOf\(([\s\S]*?)\)\s*(?:,|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pairRe.exec(body)) !== null) {
    const name = match[1]!;
    const inner = match[2]!;
    const glyphs = [...inner.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((g) => g[1]!);
    if (!glyphs.length) throw new Error(`sticker pack "${name}" has no glyphs`);
    packs.push({ name, glyphs });
  }

  if (!packs.length) throw new Error("no sticker packs parsed");
  return packs;
}

function renderModule(packs: DerivedPack[], glyphTotal: number): string {
  const lines = packs.map(
    (pack) => `  { name: ${JSON.stringify(pack.name)}, glyphs: ${JSON.stringify(pack.glyphs)} },`,
  );
  return `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Source of truth: native-android/app/src/main/java/app/kuchupuchu/android/StickerSheet.kt
 * Regenerate with: npm run generate:web-stickers
 *
 * Parity is enforced by test/cases/57-web-media-attachments.mjs, which parses
 * the Kotlin again and compares pack names, glyph order and totals.
 */

export type StickerPack = {
  readonly name: string;
  readonly glyphs: readonly string[];
};

export const STICKER_PACKS: readonly StickerPack[] = Object.freeze([
${lines.join("\n")}
]);

/** ${packs.length} packs / ${glyphTotal} glyphs, as derived from the Kotlin source. */
export const STICKER_PACK_COUNT = ${packs.length};
export const STICKER_GLYPH_COUNT = ${glyphTotal};
`;
}

type CatalogModule = {
  STICKER_PACKS: readonly { name: string; glyphs: readonly string[] }[];
};

/**
 * --check compares DATA, not bytes: the committed module is prettier-formatted,
 * so its line breaks differ from this renderer's output. What must never drift
 * is the pack list, the glyph order and the totals.
 */
function sameCatalog(a: readonly DerivedPack[], b: CatalogModule["STICKER_PACKS"]): boolean {
  if (a.length !== b.length) return false;
  return a.every((pack, index) => {
    const other = b[index];
    if (!other || other.name !== pack.name) return false;
    if (other.glyphs.length !== pack.glyphs.length) return false;
    return pack.glyphs.every((glyph, i) => other.glyphs[i] === glyph);
  });
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");
  const kotlin = readFileSync(KOTLIN, "utf8");
  const packs = deriveStickerPacks(kotlin);
  const total = packs.reduce((sum, pack) => sum + pack.glyphs.length, 0);

  if (checkOnly) {
    const current = (await import(OUTPUT)) as CatalogModule;
    if (!sameCatalog(packs, current.STICKER_PACKS)) {
      process.stderr.write(
        `web/src/media/stickerPacks.ts drifted from StickerSheet.kt: run \`npm run generate:web-stickers\`.\n`,
      );
      process.exit(1);
    }
    process.stdout.write(`Sticker catalog in sync: ${packs.length} packs / ${total} glyphs.\n`);
    return;
  }

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, renderModule(packs, total), "utf8");
  process.stdout.write(
    `Wrote web/src/media/stickerPacks.ts: ${packs.length} packs / ${total} glyphs.\n`,
  );
}

// Import-safe: a contract case imports `deriveStickerPacks` to re-check parity,
// and that must never rewrite the catalog as a side effect.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void main();

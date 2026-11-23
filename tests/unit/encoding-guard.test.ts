import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Encoding guard.
 *
 * This plugin once shipped assets whose UTF-8 characters had been double
 * encoded through Windows-1252 (an em dash became a three-character mojibake
 * run, an emoji became four), which put garbled text in front of visitors.
 * This test re-reads every source and asset file as bytes so the bug is
 * caught before it reaches a page:
 *
 * - the file must decode as strict UTF-8 (no ANSI saves, no stray bytes);
 * - it must not contain the replacement character;
 * - it must not contain any of the mojibake signatures a double encoding
 *   leaves behind (the signatures are written as escapes below, so this
 *   file can never trigger its own guard).
 *
 * The same logic runs workspace-wide through `scripts/check-encoding.mjs`;
 * this copy lives inside the plugin so the plugin's own CI catches it too.
 */

const packageRoot = path.dirname(fileURLToPath(new URL("../../package.json", import.meta.url)));

/** Directories that must stay clean UTF-8. */
const SCAN_DIRS = ["public", "src", "admin", "tests"];

/**
 * Character sequences a double UTF-8 → Windows-1252 → UTF-8 encoding leaves
 * behind. Written as escapes so this guard itself cannot become a victim.
 * Each maps to a famous original: an em dash, an arrow, a box-drawing rule,
 * a multiplication sign, an emoji, a middle dot.
 */
const MOJIBAKE_SIGNATURES = [
  "\u00E2\u20AC", //       em/en dash, ellipsis, dagger mojibake
  "\u00E2\u2020", //       arrows
  "\u00E2\u201D\u20AC", // box-drawing rules
  "\u00C3\u2014", //       multiplication sign
  "\u00F0\u0178", //       emoji (surrogate-adjacent byte pairs)
  "\u00C2\u00B7", //       middle dot
];

function collectFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

describe("encoding guard", () => {
  it("keeps every source and asset file valid UTF-8 and free of mojibake", () => {
    const files = SCAN_DIRS.flatMap((dir) => collectFiles(path.join(packageRoot, dir)));
    expect(files.length).toBeGreaterThan(10);

    const offenders: string[] = [];
    for (const file of files) {
      const bytes = readFileSync(file);
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        offenders.push(`${path.relative(packageRoot, file)} → not valid UTF-8`);
        continue;
      }
      if (text.includes("\uFFFD")) {
        offenders.push(`${path.relative(packageRoot, file)} → replacement character`);
        continue;
      }
      const hit = MOJIBAKE_SIGNATURES.find((signature) => text.includes(signature));
      if (hit !== undefined) {
        offenders.push(`${path.relative(packageRoot, file)} → mojibake ${JSON.stringify(hit)}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

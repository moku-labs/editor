/* eslint-disable sonarjs/slow-regex -- the patterns read this repository's own small source files */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path/posix";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// collector/report is runtime-free: pages' summary path and a browser bundle
// may import it. It imports its own files and perf/protocol only.
// ─────────────────────────────────────────────────────────────────────────────

/** The report folder. */
const REPORT = fileURLToPath(new URL("../../report", import.meta.url));

/**
 * A source text without its comments (a comment may name what the code must not use).
 *
 * @param text - The source.
 * @returns The code only.
 */
function codeOf(text: string): string {
  return text.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/^\s*\/\/.*$/gm, "");
}

/** Every .ts file of report/ with its code. */
const FILES = readdirSync(REPORT)
  .filter(name => name.endsWith(".ts"))
  .map(name => ({ name, text: codeOf(readFileSync(join(REPORT, name), "utf8")) }));

/** An import or export statement with its specifier. */
const SPECIFIER = /^\s*(import|export)\s+(type\s+)?[^;]*?from\s+"([^"]+)"/gm;

/** The value names perf/protocol may give the report: constants and pure functions. */
const PROTOCOL_VALUES =
  /^(PERF_LOG_VERSION|PERF_GAP_BUCKETS|CAUSE_BITS|CAUSE_RANK|primaryCause|causeName|rateFps|cleanText)$/;

describe("report boundary", () => {
  it("has the files of the spec", () => {
    expect(FILES.map(file => file.name).toSorted()).toEqual([
      "compare.ts",
      "hist.ts",
      "index.ts",
      "parse.ts",
      "summary.ts",
      "text.ts",
      "types.ts"
    ]);
  });

  it("imports only its own files and perf/protocol (bug: the adb runner or the kernel in pages' summary path)", () => {
    for (const { name, text } of FILES) {
      for (const match of text.matchAll(SPECIFIER)) {
        const specifier = match[3] ?? "";
        const allowed = specifier.startsWith("./") || specifier === "../../perf/protocol";
        expect(allowed, `${name} imports ${specifier}`).toBe(true);
      }
      expect(text, name).not.toMatch(/\bimport\(/);
    }
  });

  it("takes only constants and pure functions from perf/protocol as values; types with import type", () => {
    for (const { name, text } of FILES) {
      for (const match of text.matchAll(SPECIFIER)) {
        if (match[3] !== "../../perf/protocol" || match[2] !== undefined) continue;
        const names = /\{([^}]*)\}/.exec(match[0])?.[1]?.split(",") ?? [];
        for (const imported of names.map(part => part.trim()).filter(Boolean)) {
          expect(PROTOCOL_VALUES.test(imported), `${name} imports the value ${imported}`).toBe(
            true
          );
        }
      }
    }
  });

  it("uses no Bun, process or node global", () => {
    for (const { name, text } of FILES) {
      expect(text, name).not.toMatch(/\b(Bun|process|Buffer|require)\s*[.(]/);
      expect(text, name).not.toMatch(/node:/);
    }
  });
});

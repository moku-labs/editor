/* eslint-disable sonarjs/slow-regex -- the patterns read this repository's own small source files */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path/posix";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// perf/graph is runtime-free and DOM-free: the overlay and the tools strip
// import it. It imports its own files and ../protocol only, names no DOM type,
// and its painter allocates nothing per paint.
// ─────────────────────────────────────────────────────────────────────────────

/** The graph folder. */
const GRAPH = fileURLToPath(new URL("../../graph", import.meta.url));

/**
 * A source text without its comments.
 *
 * @param text - The source.
 * @returns The code only.
 */
function codeOf(text: string): string {
  return text.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/^\s*\/\/.*$/gm, "");
}

/** Every .ts file of graph/ with its code. */
const FILES = readdirSync(GRAPH)
  .filter(name => name.endsWith(".ts"))
  .map(name => ({ name, text: codeOf(readFileSync(join(GRAPH, name), "utf8")) }));

/** An import or export statement with its specifier. */
const SPECIFIER = /^\s*(import|export)\s+(type\s+)?[^;]*?from\s+"([^"]+)"/gm;

describe("graph boundary", () => {
  it("imports only its own files and ../protocol (bug: a plugin or Preact in the painter)", () => {
    for (const { name, text } of FILES) {
      for (const match of text.matchAll(SPECIFIER)) {
        const specifier = match[3] ?? "";
        expect(
          specifier.startsWith("./") || specifier === "../protocol",
          `${name} imports ${specifier}`
        ).toBe(true);
      }
    }
  });

  it("names no DOM type, so it type-checks without lib.dom", () => {
    for (const { name, text } of FILES) {
      expect(text, name).not.toMatch(
        /CanvasRenderingContext2D|HTMLCanvasElement|TextMetrics|document\.|window\.devicePixelRatio/
      );
    }
  });

  it("paints without allocating: no template string, for…of, array or object literal, spread or per-row tuple in the painter's functions (bug: garbage on every 4 Hz paint)", () => {
    const paint = FILES.find(file => file.name === "paint.ts")?.text ?? "";
    const functions = paint.slice(paint.indexOf("\nfunction "));
    expect(functions.length).toBeGreaterThan(1000);
    expect(functions).not.toMatch(/`/);
    expect(functions).not.toMatch(/for\s*\(\s*const\s+\w+\s+of\b/);
    expect(functions).not.toMatch(/(?:=|return|\()\s*\[/);
    expect(functions).not.toMatch(/(?:=|return|\()\s*\{(?!\s*\})/);
    expect(functions).not.toMatch(/\.\.\.|\.(map|filter|forEach|slice|concat)\(/);
    expect(functions).not.toMatch(/\):\s*\[/);
  });
});

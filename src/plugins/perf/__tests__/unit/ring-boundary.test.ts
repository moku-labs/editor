/* eslint-disable sonarjs/slow-regex -- the patterns read this repository's own small source files */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path/posix";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// The engine's runtime lists (PERF_CAUSES, DEMAND_REASONS) enter the editor in
// one file, perf/ring.ts, on the agent side only: the agent runs in the game's
// page, where the engine is already loaded. perf/protocol and perf/graph stay
// runtime-free (the tools page and the server import them), and no module
// outside perf's agent side imports ring.ts, so no engine code reaches the tools
// or the server bundle.
// ─────────────────────────────────────────────────────────────────────────────

/** The repository's src folder. */
const SRC = fileURLToPath(new URL("../../../../", import.meta.url));

/** The perf plugin folder, relative to src. */
const PERF = "plugins/perf";

/**
 * A source text without its comments (a comment may name what the code must not use).
 *
 * @param text - The source.
 * @returns The code only.
 */
function codeOf(text: string): string {
  return text.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/^\s*\/\/.*$/gm, "");
}

/**
 * Every source file under a folder (tests excluded), relative to src, with its code.
 *
 * @param folder - A folder under src.
 * @returns The files.
 */
function sourcesOf(folder: string): { readonly path: string; readonly text: string }[] {
  return readdirSync(join(SRC, folder), { recursive: true, encoding: "utf8" })
    .filter(name => /\.tsx?$/.test(name) && !name.includes("__tests__"))
    .map(name => {
      const path = relative(SRC, join(SRC, folder, name));
      return { path, text: codeOf(readFileSync(join(SRC, path), "utf8")) };
    });
}

/** A runtime import (not `import type`) with its specifier. */
const RUNTIME_IMPORT = /^\s*import\s+(?!type\s)[^;]*?from\s+"([^"]+)"/gm;

/** Every source file of src. */
const SOURCES = sourcesOf(".");

/**
 * The runtime import specifiers of a file.
 *
 * @param text - The file's code.
 * @returns The specifiers.
 */
function runtimeImports(text: string): string[] {
  return [...text.matchAll(RUNTIME_IMPORT)].map(match => match[1] ?? "");
}

describe("the engine's runtime lists enter through perf/ring.ts only", () => {
  it("lets only perf/ring.ts import @moku-labs/game at runtime among perf's files (bug: the engine pulled into the tools or server bundle)", () => {
    const importers = SOURCES.filter(file => file.path.startsWith(PERF))
      .filter(file => runtimeImports(file.text).some(spec => spec.startsWith("@moku-labs/game")))
      .map(file => file.path);
    expect(importers).toEqual([`${PERF}/ring.ts`]);
  });

  it("imports ring.ts only from perf's agent side: never from protocol/, graph/ or another plugin", () => {
    const importers = SOURCES.filter(file =>
      runtimeImports(file.text).some(spec => /(^|\/)ring$/.test(spec))
    ).map(file => file.path);
    expect(importers.length).toBeGreaterThan(0);
    for (const path of importers) {
      expect(path.startsWith(`${PERF}/`), path).toBe(true);
      expect(/^plugins\/perf\/(protocol|graph)\//.test(path), path).toBe(false);
    }
  });
});

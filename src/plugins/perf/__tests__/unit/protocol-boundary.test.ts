/* eslint-disable sonarjs/slow-regex -- the patterns read this repository's own small source files */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path/posix";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// perf/protocol is runtime-free: any core imports it (the server through
// collector/report and the hub's types, the tools page, the agent). It imports
// its own files, registry/protocol by import type, and the engine by type only.
// ─────────────────────────────────────────────────────────────────────────────

/** The protocol folder. */
const PROTOCOL = fileURLToPath(new URL("../../protocol", import.meta.url));

/**
 * A source text without its comments (a comment may name what the code must not use).
 *
 * @param text - The source.
 * @returns The code only.
 */
function codeOf(text: string): string {
  return text.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/^\s*\/\/.*$/gm, "");
}

/** Every .ts file of protocol/ with its code. */
const FILES = readdirSync(PROTOCOL)
  .filter(name => name.endsWith(".ts"))
  .map(name => ({ name, text: codeOf(readFileSync(join(PROTOCOL, name), "utf8")) }));

/** An import or export statement with its specifier. */
const SPECIFIER = /^\s*(import|export)\s+(type\s+)?[^;]*?from\s+"([^"]+)"/gm;

describe("protocol boundary", () => {
  it("keeps the skeleton's barrel and extends it with window, values, guards, the GPU rule and the Mission control feeds", () => {
    const parts = [
      "causes",
      "engine",
      "frames",
      "gpu",
      "guards",
      "history",
      "memory",
      "passes",
      "rate",
      "sections",
      "text",
      "timeline",
      "values",
      "window"
    ];
    expect(FILES.map(file => file.name).toSorted()).toEqual(
      [...parts, "index"].map(part => `${part}.ts`).toSorted()
    );
    const barrel = FILES.find(file => file.name === "index.ts")?.text ?? "";
    for (const part of parts) expect(barrel).toContain(`export * from "./${part}";`);
  });

  it("imports only its own files, registry/protocol by type and the engine by type (bug: a plugin, the kernel or the engine dragged into the server or tools bundle)", () => {
    for (const { name, text } of FILES) {
      for (const match of text.matchAll(SPECIFIER)) {
        const specifier = match[3] ?? "";
        const typeOnly = match[2] !== undefined;
        const own = specifier.startsWith("./");
        const typed =
          (specifier === "../../registry/protocol" || specifier === "@moku-labs/game") && typeOnly;
        expect(own || typed, `${name} imports ${specifier}${typeOnly ? " (type)" : ""}`).toBe(true);
      }
      expect(text, name).not.toMatch(/\bimport\(/);
    }
  });

  it("names no hub/protocol, kernel, common, node module or Preact (bug: a cyclic protocol type graph)", () => {
    for (const { name, text } of FILES) {
      expect(text, name).not.toMatch(
        /hub\/protocol|@moku-labs\/core|@moku-labs\/common|src\/config|node:|preact/
      );
    }
  });
});

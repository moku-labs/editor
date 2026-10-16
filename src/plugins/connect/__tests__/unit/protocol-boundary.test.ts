/* eslint-disable sonarjs/slow-regex -- the patterns read this repository's own small source files */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// spec 11 § 3 "Wire types": connect/protocol is runtime-free and imports only
// itself and, type-only, hub/protocol. A self-scan of the folder.
// Bug: the tools page's link (which imports the guards) dragging connect's
// server code, adb or Bun into the tools bundle, or a registry/protocol ↔
// connect/protocol cycle.
// ─────────────────────────────────────────────────────────────────────────────

/** The folder under test. */
const PROTOCOL = path.join(import.meta.dirname, "../../protocol");

/** An import or export statement: its type keyword and its specifier. */
const SPECIFIER = /^\s*(?:import|export)\s+(type\s+)?[^;]*?from\s+"([^"]+)"/gm;

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
 * Every .ts file of the folder with its code.
 *
 * @returns The files.
 */
async function sources(): Promise<{ file: string; text: string }[]> {
  const entries = await readdir(PROTOCOL);
  const files = entries.filter(file => file.endsWith(".ts"));
  return Promise.all(
    files.map(async file => ({
      file,
      text: codeOf(await readFile(path.join(PROTOCOL, file), "utf8"))
    }))
  );
}

describe("connect/protocol boundary", () => {
  it("imports only its own files and hub/protocol by type", async () => {
    const found = await sources();
    expect(found.map(source => source.file).toSorted()).toEqual([
      "guards.ts",
      "index.ts",
      "types.ts"
    ]);

    for (const { file, text } of found) {
      const outside = [...text.matchAll(SPECIFIER)]
        .filter(match => !(match[2] ?? "").startsWith("./"))
        .map(match => `${match[1] === undefined ? "" : "type "}${match[2] ?? ""}`);
      expect({ file, outside }).toEqual({
        file,
        outside: file === "types.ts" ? ["type ../../hub/protocol"] : []
      });
      expect(text, file).not.toMatch(/\bimport\(/);
    }
  });

  it("names no Bun global, no node: module and no registry/protocol", async () => {
    for (const { file, text } of await sources()) {
      expect({
        file,
        bun: /\bBun\./.test(text),
        node: text.includes("node:"),
        registry: text.includes("registry/protocol")
      }).toEqual({ file, bun: false, node: false, registry: false });
    }
  });
});

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// The bridge reaches the hub's device-link helpers only through
// `../hub/protocol` (runtime-free), never the hub plugin: the agent bundle must
// not pull the hub's Bun server code.
// ─────────────────────────────────────────────────────────────────────────────

/** The bridge plugin directory. */
const ROOT = path.join(import.meta.dirname, "..", "..");

/** Every import or export specifier of a source text. */
const SPECIFIER = /(?:from|import)[\s(]*["']([^"']+)["']/g;

/** A specifier that may name the hub: only its protocol module is allowed. */
const ALLOWED_HUB = /^(?:\.\.\/)+hub\/protocol$/;

/**
 * The source files of the bridge, tests excluded.
 *
 * @param dir - A directory of the bridge.
 * @returns Paths of its `.ts` files.
 */
function sourcesOf(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourcesOf(file);
    return entry.name.endsWith(".ts") ? [file] : [];
  });
}

describe("the bridge's imports of the hub", () => {
  it("come from ../hub/protocol only, never the hub index", () => {
    const offending = sourcesOf(ROOT).flatMap(file =>
      [...readFileSync(file, "utf8").matchAll(SPECIFIER)]
        .map(match => match[1] ?? "")
        .filter(specifier => /(?:^|\/)hub(?:\/|$)/.test(specifier) && !ALLOWED_HUB.test(specifier))
        .map(specifier => `${path.relative(ROOT, file)}: ${specifier}`)
    );

    expect(offending).toEqual([]);
  });

  it("does reach the device-link helpers through ../hub/protocol", () => {
    const users = sourcesOf(ROOT).filter(file =>
      /from "(?:\.\.\/)+hub\/protocol"/.test(readFileSync(file, "utf8"))
    );

    expect(users.length).toBeGreaterThan(0);
  });
});

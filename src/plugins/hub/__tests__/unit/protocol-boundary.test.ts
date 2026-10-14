import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// C11: hub/protocol is runtime-free and imports nothing outside itself. A
// self-scan of the folder only (the agent's importers check their own imports).
// Bug: a device-link helper that drags the hub's server code into the agent
// bundle, or a registry/protocol ↔ hub/protocol type cycle.
// ─────────────────────────────────────────────────────────────────────────────

/** The folder under test. */
const PROTOCOL = path.join(import.meta.dirname, "../../protocol");

/** The module specifiers of a source text: static and re-export, side-effect, dynamic imports. */
const SPECIFIERS: readonly RegExp[] = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\(\s*["']([^"']+)["']/g
];

/**
 * Every .ts file of the folder with its text.
 *
 * @returns The files.
 */
async function sources(): Promise<{ file: string; text: string }[]> {
  const entries = await readdir(PROTOCOL);
  const files = entries.filter(file => file.endsWith(".ts"));
  return Promise.all(
    files.map(async file => ({ file, text: await readFile(path.join(PROTOCOL, file), "utf8") }))
  );
}

describe("hub/protocol boundary", () => {
  it("imports nothing outside its own folder: no plugin, kernel, node:, engine or registry/protocol", async () => {
    const found = await sources();
    expect(found.map(source => source.file).toSorted()).toEqual(["device-link.ts", "index.ts"]);

    for (const { file, text } of found) {
      const specifiers = SPECIFIERS.flatMap(pattern =>
        [...text.matchAll(pattern)].map(match => match[1])
      );
      const outside = specifiers.filter(specifier => !specifier?.startsWith("./"));
      expect({ file, outside }).toEqual({ file, outside: [] });
    }
  });

  it("names no Bun global and no node: module", async () => {
    for (const { file, text } of await sources()) {
      expect({ file, bun: /\bBun\./.test(text), node: text.includes("node:") }).toEqual({
        file,
        bun: false,
        node: false
      });
    }
  });

  it("re-exports its types with export type, so a consumer's import stays type-only", async () => {
    const found = await sources();
    const barrel = found.find(source => source.file === "index.ts")?.text ?? "";
    const valueExports = (/export\s*\{([^}]*)\}/.exec(barrel)?.[1] ?? "")
      .split(",")
      .map(name => name.trim());

    expect(valueExports).toContain("parseAddress");
    for (const name of ["LinkJson", "EngineInfo", "SessionDevice", "DeviceLink", "PairParams"]) {
      expect(valueExports).not.toContain(name);
    }
  });
});

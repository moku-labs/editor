import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// recorder/protocol.ts is the wire shape of the `editor.recorder` source: types
// only, imported by the tools page. A self-scan of the file.
// Bug: a runtime value (or a runtime import) in protocol.ts dragging recorder
// code into the tools bundle, or the tools page taking its contract from the
// plugin's own types.ts (and through it perf and the registry).
// ─────────────────────────────────────────────────────────────────────────────

/** The file under test. */
const PROTOCOL = path.join(import.meta.dirname, "../../protocol.ts");

/** The renderView contract that reads it. */
const CONTRACT = path.join(import.meta.dirname, "../../../renderView/device/contract/recorder.ts");

/** The module specifiers of a source text: static and re-export, side-effect, dynamic imports. */
const SPECIFIERS: readonly RegExp[] = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\(\s*["']([^"']+)["']/g
];

describe("recorder/protocol boundary", () => {
  it("holds types only: no import of anything, no runtime export", async () => {
    const text = await readFile(PROTOCOL, "utf8");
    const specifiers = SPECIFIERS.flatMap(pattern =>
      [...text.matchAll(pattern)].map(match => match[1])
    );
    const values = [
      ...text.matchAll(/^export\s+(?:const|let|var|function|class|enum|default|async|\{)/gm)
    ].map(match => match[0]);
    expect({ specifiers, values }).toEqual({ specifiers: [], values: [] });
    expect(text).toMatch(/^export type RecorderStatus = /m);
  });

  it("is where the tools page takes RecorderStatus from, as a type", async () => {
    const contract = await readFile(CONTRACT, "utf8");
    const specifiers = SPECIFIERS.flatMap(pattern =>
      [...contract.matchAll(pattern)].map(match => match[1])
    );
    expect(specifiers).toEqual(["../../../recorder/protocol"]);
    expect(contract).toContain('export type { RecorderStatus } from "../../../recorder/protocol";');
  });
});

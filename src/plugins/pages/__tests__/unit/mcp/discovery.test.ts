import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoveryOf, writeDiscovery } from "../../../discovery";
import { findEditor, isProcessAlive, readDiscovery } from "../../../mcp/discovery";
import type { EditorDiscovery } from "../../../types";

// ─────────────────────────────────────────────────────────────────────────────
// pages/mcp discovery (M3): the bridge reads <root>/.moku/editor.json. A live
// pid wins; a dead pid is stale (no bin) but still names the last html; a
// missing or malformed file is no bin at all.
// ─────────────────────────────────────────────────────────────────────────────

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "moku-mcp-discovery-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A record of `pid` under the temp root. */
function record(pid: number): EditorDiscovery {
  return discoveryOf({
    pid,
    port: 4000,
    path: "/__editor",
    token: "secret",
    root,
    html: join(root, "web", "index.html"),
    startedAt: 1_790_000_000_000
  });
}

describe("findEditor", () => {
  it("answers the record as live while its pid runs", () => {
    writeDiscovery(root, record(process.pid));
    expect(findEditor(root)).toEqual({ live: record(process.pid), seen: record(process.pid) });
  });

  it("answers a stale record (dead pid) as seen only", () => {
    writeDiscovery(root, record(4242));
    expect(findEditor(root, () => false)).toEqual({ seen: record(4242) });
  });

  it("answers nothing without a file or for a malformed one", async () => {
    expect(findEditor(root)).toEqual({});
    await mkdir(join(root, ".moku"), { recursive: true });
    await writeFile(join(root, ".moku", "editor.json"), "{not json");
    expect(findEditor(root)).toEqual({});
    await writeFile(join(root, ".moku", "editor.json"), JSON.stringify({ version: 2 }));
    expect(findEditor(root)).toEqual({});
  });
});

describe("readDiscovery", () => {
  it("refuses a record without its fields or with an empty token", () => {
    const valid = record(1);
    expect(readDiscovery({ ...valid })).toEqual(valid);
    expect(readDiscovery({ ...valid, token: "" })).toBeUndefined();
    expect(readDiscovery({ ...valid, port: "4000" })).toBeUndefined();
    expect(readDiscovery({ ...valid, ws: 1 })).toBeUndefined();
    expect(readDiscovery([])).toBeUndefined();
  });
});

describe("isProcessAlive", () => {
  it("is true for this process and false for a pid that cannot exist", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-5)).toBe(false);
    expect(isProcessAlive(2 ** 31 - 2)).toBe(false);
  });
});

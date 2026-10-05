import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DISCOVERY_FILE,
  discoveryOf,
  discoveryPath,
  publishDiscovery,
  removeDiscovery,
  writeDiscovery
} from "../../discovery";
import type { EditorDiscovery } from "../../types";
import { TOKEN } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// pages discovery (M3, M6): the bin writes <root>/.moku/editor.json, mode 0600,
// through a temp file and a rename, and removes it on stop and on process exit.
// Only the process that wrote the file removes it.
// ─────────────────────────────────────────────────────────────────────────────

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "moku-discovery-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * A discovery record of this process on port 4000.
 *
 * @param pid - The writer pid.
 * @returns The record.
 */
function record(pid = process.pid): EditorDiscovery {
  return discoveryOf({
    pid,
    port: 4000,
    path: "/__editor",
    token: TOKEN,
    root,
    html: join(root, "web", "index.html"),
    startedAt: 1_700_000_000_000
  });
}

describe("discoveryOf", () => {
  it("builds version 1 with the loopback url and the hub websocket url", () => {
    expect(record()).toEqual({
      version: 1,
      pid: process.pid,
      port: 4000,
      url: "http://127.0.0.1:4000",
      ws: "ws://127.0.0.1:4000/__editor/ws",
      token: TOKEN,
      root,
      html: join(root, "web", "index.html"),
      startedAt: 1_700_000_000_000
    });
  });
});

describe("discoveryPath", () => {
  it("is .moku/editor.json under the root", () => {
    expect(DISCOVERY_FILE).toBe(".moku/editor.json");
    expect(discoveryPath(root)).toBe(join(root, ".moku", "editor.json"));
  });
});

describe("writeDiscovery", () => {
  it("creates .moku/ and writes the JSON with mode 0600, no temp file left", () => {
    const path = writeDiscovery(root, record());
    expect(path).toBe(discoveryPath(root));
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(record());
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(root, ".moku"))).toEqual(["editor.json"]);
  });

  it("replaces an older file and keeps an existing .moku/ folder", async () => {
    await mkdir(join(root, ".moku", "captures"), { recursive: true });
    writeFileSync(discoveryPath(root), '{"version":1,"pid":1}', { mode: 0o644 });
    writeDiscovery(root, record());
    expect(JSON.parse(readFileSync(discoveryPath(root), "utf8")).pid).toBe(process.pid);
    expect(statSync(discoveryPath(root)).mode & 0o777).toBe(0o600);
    expect(existsSync(join(root, ".moku", "captures"))).toBe(true);
  });

  it("throws for a root path the file system refuses", () => {
    expect(() => writeDiscovery(join(root, "bad\0"), record())).toThrow();
  });
});

describe("removeDiscovery", () => {
  it("removes the file written by this pid", () => {
    writeDiscovery(root, record());
    expect(removeDiscovery(root, process.pid)).toBe(true);
    expect(existsSync(discoveryPath(root))).toBe(false);
  });

  it("keeps a file written by another bin", () => {
    writeDiscovery(root, record(process.pid + 1));
    expect(removeDiscovery(root, process.pid)).toBe(false);
    expect(existsSync(discoveryPath(root))).toBe(true);
  });

  it("answers false for a missing or unreadable file", async () => {
    expect(removeDiscovery(root, process.pid)).toBe(false);
    await mkdir(join(root, ".moku"));
    writeFileSync(discoveryPath(root), "not json");
    expect(removeDiscovery(root, process.pid)).toBe(false);
    expect(existsSync(discoveryPath(root))).toBe(true);
  });
});

describe("publishDiscovery", () => {
  it("writes the file and removes it once on release, with its exit listener", () => {
    const before = process.listenerCount("exit");
    const release = publishDiscovery(root, record());
    expect(existsSync(discoveryPath(root))).toBe(true);
    expect(process.listenerCount("exit")).toBe(before + 1);

    release();
    release();
    expect(existsSync(discoveryPath(root))).toBe(false);
    expect(process.listenerCount("exit")).toBe(before);
  });

  it("removes the file from its exit listener", () => {
    const before = process.listeners("exit");
    publishDiscovery(root, record());
    const added = process.listeners("exit").find(listener => !before.includes(listener));
    expect(added).toBeTypeOf("function");

    added?.(0);
    expect(existsSync(discoveryPath(root))).toBe(false);
    expect(process.listeners("exit")).not.toContain(added);
  });

  it("registers nothing when the write fails", () => {
    const before = process.listenerCount("exit");
    expect(() => publishDiscovery(join(root, "bad\0"), record())).toThrow();
    expect(process.listenerCount("exit")).toBe(before);
  });
});

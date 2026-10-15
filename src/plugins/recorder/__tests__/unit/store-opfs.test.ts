import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpfsStore, OPFS_DIR, openStore } from "../../store";
import type { LogFileInfo } from "../../types";
import type { FakeDirectory, FakeFile } from "../fake-opfs";
import { createFakeDirectory } from "../fake-opfs";

// ─────────────────────────────────────────────────────────────────────────────
// The OPFS store on a fake OPFS: one directory per log, numbered chunk files
// (never a rewrite of a big file), meta.json, ordered reads, recursive remove;
// openStore's fallback to memory with the reason.
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.unstubAllGlobals();
});

const INFO: LogFileInfo = {
  name: "perf-20261014-1532-sm-a266b.jsonl",
  label: "garden, A26",
  startedAt: 1_792_000_920_000,
  lines: 2,
  bytes: 4,
  sent: 1,
  current: true,
  storage: "opfs"
};

/**
 * The directory of a log in the fake root.
 *
 * @param root - The fake root.
 * @returns The log's directory.
 */
function logDirectory(root: FakeDirectory): FakeDirectory {
  const found = root.entries.get("perf-20261014-1532-sm-a266b");
  if (found?.kind !== "directory") throw new Error("no log directory");
  return found;
}

describe("the OPFS store", () => {
  it("appends each chunk as a new numbered file and rewrites meta.json after it", async () => {
    const root = createFakeDirectory();
    const store = createOpfsStore(root);
    await store.append(INFO, "a\n");
    await store.append({ ...INFO, lines: 3 }, "b\n");
    const directory = logDirectory(root);
    expect([...directory.entries.keys()].toSorted()).toEqual([
      "000001.jsonl",
      "000002.jsonl",
      "meta.json"
    ]);
    expect(root.writes.map(path => path.split("/").at(-1))).toEqual([
      "000001.jsonl",
      "meta.json",
      "000002.jsonl",
      "meta.json"
    ]);
    const meta = JSON.parse((directory.entries.get("meta.json") as FakeFile).text);
    expect(meta).toEqual({
      name: INFO.name,
      label: "garden, A26",
      startedAt: INFO.startedAt,
      lines: 3,
      bytes: 4,
      sent: 1,
      chunks: 2
    });
  });

  it("numbers on from the meta.json an earlier page left", async () => {
    const root = createFakeDirectory();
    await createOpfsStore(root).append(INFO, "a\n");
    await createOpfsStore(root).append(INFO, "b\n");
    expect([...logDirectory(root).entries.keys()]).toContain("000002.jsonl");
    const blob = await createOpfsStore(root).read(INFO.name);
    await expect(blob.text()).resolves.toBe("a\nb\n");
  });

  it("reads the chunks in name order as one application/x-ndjson Blob", async () => {
    const root = createFakeDirectory();
    const store = createOpfsStore(root);
    // A directory that lists its chunks out of order.
    const directory = await root.getDirectoryHandle("perf-20261014-1532-sm-a266b", {
      create: true
    });
    for (const [file, text] of [
      ["000002.jsonl", "second\n"],
      ["000001.jsonl", "first\n"]
    ] as const) {
      const handle = await directory.getFileHandle(file, { create: true });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
    }
    const blob = await store.read(INFO.name);
    expect(blob.type).toBe("application/x-ndjson");
    await expect(blob.text()).resolves.toBe("first\nsecond\n");
  });

  it("removes a log's directory recursively", async () => {
    const root = createFakeDirectory();
    const store = createOpfsStore(root);
    await store.append(INFO, "a\n");
    await store.remove(INFO.name);
    expect(root.removed).toEqual([{ name: "perf-20261014-1532-sm-a266b", recursive: true }]);
    await expect(store.list()).resolves.toEqual([]);
  });

  it("lists every log as finished, oldest first, and skips what is not a log", async () => {
    const root = createFakeDirectory();
    const store = createOpfsStore(root);
    await store.append({ ...INFO, name: "perf-20261014-1600-sm-a266b.jsonl", startedAt: 2 }, "b\n");
    await store.append({ ...INFO, startedAt: 1 }, "a\n");
    await store.describe({ ...INFO, startedAt: 1, current: false, sent: 2 });
    const stray = await root.getDirectoryHandle("notes", { create: true });
    const metaFile = await stray.getFileHandle("meta.json", { create: true });
    const meta = await metaFile.createWritable();
    await meta.write("{ not json");
    await meta.close();
    await root.getFileHandle("loose.txt", { create: true });
    const listed = await store.list();
    expect(listed.map(info => [info.name, info.current, info.storage, info.sent])).toEqual([
      [INFO.name, false, "opfs", 2],
      ["perf-20261014-1600-sm-a266b.jsonl", false, "opfs", 1]
    ]);
  });
});

describe("openStore", () => {
  it("opens the moku-editor-perf directory under navigator.storage.getDirectory for auto", async () => {
    const top = createFakeDirectory();
    vi.stubGlobal("navigator", { storage: { getDirectory: async () => top } });
    const opened = await openStore("auto");
    expect(opened).toEqual({ store: expect.objectContaining({ kind: "opfs" }) });
    expect(top.entries.get(OPFS_DIR)?.kind).toBe("directory");
    await expect(openStore("memory")).resolves.toEqual({
      store: expect.objectContaining({ kind: "memory" })
    });
  });

  it.each([
    ["no navigator.storage.getDirectory", {}, "getDirectory"],
    [
      "a getDirectory that throws",
      { storage: { getDirectory: () => Promise.reject(new Error("SecurityError: denied")) } },
      "SecurityError: denied"
    ]
  ])("answers the memory store and the reason with %s", async (_label, navigator, reason) => {
    vi.stubGlobal("navigator", navigator);
    const opened = await openStore("auto");
    expect(opened.store.kind).toBe("memory");
    expect(opened.reason).toContain(reason);
  });
});

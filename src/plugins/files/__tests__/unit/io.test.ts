import { createHash } from "node:crypto";
import { chmod, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicWrite, listDir, readBytes, readText, sha1, withLock } from "../../io";
import { describeChild } from "../../sandbox";
import { createFilesState } from "../../state";
import type { Fixture } from "../helpers";
import { createFixture, outcome } from "../helpers";

let fx: Fixture;

beforeEach(async () => {
  fx = await createFixture();
});

afterEach(async () => {
  await fx.cleanup();
});

/**
 * The temp files left in a folder.
 *
 * @param dir - Absolute folder.
 * @returns Names ending with .tmp.
 */
async function temps(dir: string): Promise<string[]> {
  const names = await readdir(dir);
  return names.filter(name => name.endsWith(".tmp"));
}

/**
 * The list entry of a child, by the sandbox rules of the fixture.
 *
 * @param child - Relative child path.
 * @param absolute - Absolute child path.
 * @returns The entry or undefined.
 */
function childOf(child: string, absolute: string) {
  return describeChild(fx.ctx, child, absolute);
}

describe("sha1", () => {
  it("matches node:crypto sha1 in lowercase hex", () => {
    const bytes = new TextEncoder().encode("hello");
    // eslint-disable-next-line sonarjs/hashing -- the reference for the content version
    expect(sha1(bytes)).toBe(createHash("sha1").update(bytes).digest("hex"));
    expect(sha1(bytes)).toMatch(/^[\da-f]{40}$/);
  });
});

describe("readBytes and readText", () => {
  it("reads the bytes of a file", async () => {
    const file = await fx.put("a.ts", "abc");
    expect([...(await readBytes(file, 10, "a.ts"))]).toEqual([97, 98, 99]);
  });

  it("rejects a file over the limit with -32000", async () => {
    const file = await fx.put("a.ts", "abcd");
    await expect(readBytes(file, 3, "a.ts")).rejects.toMatchObject({
      code: -32_000,
      data: { reason: "command_failed" }
    });
  });

  it("reads UTF-8 with U+FFFD for invalid bytes and keeps a BOM", async () => {
    const file = await fx.put("a.ts", Uint8Array.from([0xef, 0xbb, 0xbf, 0x61, 0xff, 0x62]));
    const { text, version } = await readText(file, "a.ts");
    expect(text).toBe("﻿a�b");
    expect(version).toBe(sha1(await readFile(file)));
  });
});

describe("atomicWrite", () => {
  it("writes the bytes and leaves no temp file", async () => {
    const file = join(fx.root, "src", "a.ts");
    await mkdir(join(fx.root, "src"));
    await atomicWrite(file, new TextEncoder().encode("export {};\n"));
    expect(await readFile(file, "utf8")).toBe("export {};\n");
    expect(await temps(join(fx.root, "src"))).toEqual([]);
  });

  it("creates missing parent folders", async () => {
    const file = join(fx.root, "src", "deep", "new", "file.ts");
    await atomicWrite(file, new TextEncoder().encode("x"));
    expect(await readFile(file, "utf8")).toBe("x");
  });

  it("writes a new file with mode 0o644", async () => {
    const file = join(fx.root, "a.ts");
    await atomicWrite(file, new TextEncoder().encode("x"));
    const { mode } = await stat(file);
    expect(mode & 0o777).toBe(0o644);
  });

  it("preserves the mode of an existing file", async () => {
    const file = await fx.put("run.ts", "old");
    await chmod(file, 0o755);
    await atomicWrite(file, new TextEncoder().encode("new"));
    const { mode } = await stat(file);
    expect(mode & 0o777).toBe(0o755);
    expect(await readFile(file, "utf8")).toBe("new");
  });

  it("removes the temp file and rethrows when the rename fails", async () => {
    const target = join(fx.root, "src", "x.ts");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "inner.ts"), "keep");
    expect(await outcome(atomicWrite(target, new TextEncoder().encode("x")))).toBe(-1);
    expect(await temps(join(fx.root, "src"))).toEqual([]);
  });

  it("removes the temp file and rethrows when the pre-rename check fails", async () => {
    const file = join(fx.root, "a.ts");
    const failing = atomicWrite(file, new TextEncoder().encode("x"), () =>
      Promise.reject(new Error("moved"))
    );
    await expect(failing).rejects.toThrow("moved");
    expect(await temps(fx.root)).toEqual([]);
    expect(await outcome(stat(file))).toBe(-1);
  });
});

describe("withLock", () => {
  it("serialises two tasks on the same path", async () => {
    const state = createFilesState();
    const order: string[] = [];
    const gate = Promise.withResolvers<void>();

    const first = withLock(state, "a.ts", async () => {
      order.push("first:start");
      await gate.promise;
      order.push("first:end");
      return 1;
    });
    const second = withLock(state, "a.ts", async () => {
      order.push("second");
      return 2;
    });

    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    gate.resolve();
    expect(await Promise.all([first, second])).toEqual([1, 2]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
    expect(state.locks.size).toBe(0);
  });

  it("runs the next task after a failed one", async () => {
    const state = createFilesState();
    const failed = withLock(state, "a.ts", () => Promise.reject(new Error("boom")));
    const next = withLock(state, "a.ts", () => Promise.resolve("ok"));
    await expect(failed).rejects.toThrow("boom");
    expect(await next).toBe("ok");
    expect(state.locks.size).toBe(0);
  });

  it("does not serialise different paths", async () => {
    const state = createFilesState();
    const gate = Promise.withResolvers<void>();
    const slow = withLock(state, "a.ts", () => gate.promise.then(() => "a"));
    expect(await withLock(state, "b.ts", () => Promise.resolve("b"))).toBe("b");
    gate.resolve();
    expect(await slow).toBe("a");
  });
});

describe("listDir", () => {
  it("lists folders first, then allowed files, sorted by code point", async () => {
    await fx.put("a.ts");
    await fx.put("Z.ts");
    await fx.put("a.js");
    await fx.put("src/x.ts");
    await fx.put("Docs/y.md");
    const entries = await listDir("", fx.rootReal, childOf);
    expect(entries.map(entry => `${entry.kind}:${entry.path}`)).toEqual([
      "dir:Docs",
      "dir:src",
      "file:Z.ts",
      "file:a.ts"
    ]);
  });

  it("gives files their byte size and folders 0, never a version", async () => {
    await fx.put("src/a.ts", "12345");
    await mkdir(join(fx.root, "src", "sub"));
    const entries = await listDir("src", join(fx.rootReal, "src"), childOf);
    expect(entries).toEqual([
      { path: "src/sub", kind: "dir", size: 0 },
      { path: "src/a.ts", kind: "file", size: 5 }
    ]);
  });
});

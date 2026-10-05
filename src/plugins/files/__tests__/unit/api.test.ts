import { chmod, readdir, readFile } from "node:fs/promises";
import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { FileBinary, FileEntry, FileText, WriteResult } from "../../../registry/protocol";
import { sha1 } from "../../io";
import type { FilesApi, FilesCtx } from "../../types";
import type { Fixture } from "../helpers";
import { createFixture, outcome, PNG_BYTES } from "../helpers";

let fx: Fixture;

beforeEach(async () => {
  fx = await createFixture();
});

afterEach(async () => {
  await fx.cleanup();
});

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

const url = (type: string): string =>
  `data:image/${type};base64,${Buffer.from(PNG_BYTES).toString("base64")}`;

describe("files api: list", () => {
  it("lists the root for '' and '.' alike", async () => {
    await fx.put("a.ts", "abc");
    await fx.put("src/b.ts");
    const expected: FileEntry[] = [
      { path: "src", kind: "dir", size: 0 },
      { path: "a.ts", kind: "file", size: 3 }
    ];
    expect(await fx.api.list("")).toEqual(expected);
    expect(await fx.api.list(".")).toEqual(expected);
  });

  it("lists a sub folder with relative child paths", async () => {
    await fx.put("src/nodes/merge.ts");
    await fx.put("src/main.ts");
    const listed = await fx.api.list("src");
    expect(listed.map(entry => entry.path)).toEqual(["src/nodes", "src/main.ts"]);
  });

  it("follows in-root symlinks with the kind of their target and skips dangling ones", async () => {
    await fx.put("src/a.ts", "12");
    await fx.link("lnk", join(fx.root, "src"));
    await fx.link("alias.ts", join(fx.root, "src/a.ts"));
    await fx.link("gone.ts", join(fx.root, "nope.ts"));
    await fx.link("deny.ts", join(fx.root, "node_modules"));
    await fx.put("node_modules/x.ts");
    expect(await fx.api.list("")).toEqual([
      { path: "lnk", kind: "dir", size: 0 },
      { path: "src", kind: "dir", size: 0 },
      { path: "alias.ts", kind: "file", size: 2 }
    ]);
  });

  it("lists an allowed .moku folder with every file below it", async () => {
    await fx.put(".moku/captures/a.png", PNG_BYTES);
    await fx.put(".moku/captures/index.json", "{}");
    const listed = await fx.api.list(".moku/captures");
    expect(listed.map(entry => entry.path)).toEqual([
      ".moku/captures/a.png",
      ".moku/captures/index.json"
    ]);
  });
});

describe("files api: read", () => {
  it("returns the text and the sha1 of the bytes", async () => {
    await fx.put("features/ui/styles.ts", "export const a = 1;\n");
    const result = await fx.api.read("features/ui/styles.ts");
    expect(result).toEqual({
      text: "export const a = 1;\n",
      version: sha1(encode("export const a = 1;\n"))
    });
  });

  it("emits nothing", async () => {
    await fx.put("a.ts");
    await fx.api.read("a.ts");
    expect(fx.ctx.emit).not.toHaveBeenCalled();
  });
});

describe("files api: write", () => {
  it("writes, returns the result and emits files:written with the kind", async () => {
    const result = await fx.api.write("src/nodes/merge.ts", "export {};\n");
    expect(result).toEqual({
      path: "src/nodes/merge.ts",
      bytes: 11,
      version: sha1(encode("export {};\n"))
    });
    expect(fx.ctx.emit).toHaveBeenCalledWith("files:written", {
      path: "src/nodes/merge.ts",
      bytes: 11,
      kind: "code"
    });
  });

  it("accepts the current version and returns the new one", async () => {
    await fx.put(".moku/editor/layout.json", "{}");
    const current = await fx.api.read(".moku/editor/layout.json");
    const saved = await fx.api.write(".moku/editor/layout.json", '{"a":1}', current.version);
    expect(saved.version).toBe(sha1(encode('{"a":1}')));
    await expect(fx.api.read(".moku/editor/layout.json")).resolves.toHaveProperty(
      "version",
      saved.version
    );
    expect(fx.ctx.emit).toHaveBeenCalledWith("files:written", {
      path: ".moku/editor/layout.json",
      bytes: 7,
      kind: "layout"
    });
  });

  it("writes and announces identical content again", async () => {
    await fx.api.write("a.css", "a{}");
    await fx.api.write("a.css", "a{}");
    expect(fx.ctx.emit).toHaveBeenCalledTimes(2);
  });

  it("counts UTF-8 bytes, not characters", async () => {
    await expect(fx.api.write("docs/a.md", "é")).resolves.toHaveProperty("bytes", 2);
  });

  it("rejects a stale version with -32005 and data.id", async () => {
    await fx.put("a.ts", "old");
    await expect(fx.api.write("a.ts", "new", "f".repeat(40))).rejects.toMatchObject({
      code: -32_005,
      data: { reason: "version_conflict", id: "a.ts" }
    });
    expect(fx.ctx.emit).not.toHaveBeenCalled();
  });

  it("rejects text over 2 MiB with -32602 field text", async () => {
    await expect(fx.api.write("a.ts", "x".repeat(2 * 1024 * 1024 + 1))).rejects.toMatchObject({
      code: -32_602,
      data: { reason: "invalid_input", field: "text" }
    });
  });

  it("rejects a text that is not a string with -32602", async () => {
    const text: unknown = 42;
    expect(await outcome(fx.api.write("a.ts", text as string))).toBe(-32_602);
  });

  it("logs a failing emit and still resolves", async () => {
    const failing = vi.fn(() => {
      throw new Error("hook failed");
    });
    const ctx: FilesCtx = { ...fx.ctx, emit: failing };
    const { createFilesApi } = await import("../../api");
    const result = await createFilesApi(ctx).write("a.ts", "x");
    expect(result.bytes).toBe(1);
    expect(fx.ctx.log.error).toHaveBeenCalledWith(
      "files:emit-failed",
      expect.objectContaining({ path: "a.ts" })
    );
  });

  it("logs an emit that rejects asynchronously and still resolves", async () => {
    const rejecting = vi.fn(() => Promise.reject(new Error("hook rejected")));
    const ctx: FilesCtx = { ...fx.ctx, emit: rejecting };
    const { createFilesApi } = await import("../../api");
    const result = await createFilesApi(ctx).write("a.ts", "x");
    expect(result.bytes).toBe(1);
    await vi.waitFor(() => {
      expect(fx.ctx.log.error).toHaveBeenCalledWith(
        "files:emit-failed",
        expect.objectContaining({ path: "a.ts", error: "Error: hook rejected" })
      );
    });
  });

  it("maps an IO failure to -32000 without the absolute root", async () => {
    await fx.put("locked/a.ts", "old");
    await chmod(join(fx.root, "locked"), 0o555);
    const failure = await fx.api.write("locked/a.ts", "x").catch((error_: unknown) => error_);
    await chmod(join(fx.root, "locked"), 0o755);
    expect(failure).toMatchObject({ code: -32_000, data: { reason: "command_failed" } });
    const message = failure instanceof Error ? failure.message : "";
    expect(message).toContain("locked/a.ts");
    expect(message).not.toContain(fx.rootReal);
    expect(fx.ctx.emit).not.toHaveBeenCalled();
  });
});

describe("files api: writeBinary and readBinary", () => {
  it("writes a capture into a missing series folder and reads it back", async () => {
    const path = ".moku/captures/series-x/001.png";
    const saved = await fx.api.writeBinary(path, PNG_BYTES);
    expect(saved).toEqual({ path, bytes: PNG_BYTES.length, version: sha1(PNG_BYTES) });
    expect(fx.ctx.emit).toHaveBeenCalledWith("files:written", {
      path,
      bytes: PNG_BYTES.length,
      kind: "capture"
    });

    fx.ctx.emit.mockClear();
    const read = await fx.api.readBinary(path);
    expect(read.version).toBe(saved.version);
    expect(read.dataUrl).toBe(`data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`);
    expect(fx.ctx.emit).not.toHaveBeenCalled();
    expect(await readdir(join(fx.root, ".moku/captures/series-x"))).toEqual(["001.png"]);
  });

  it("rejects bytes that are not a Uint8Array with -32602 field data", async () => {
    const bytes: unknown = "png";
    await expect(
      fx.api.writeBinary(".moku/captures/a.png", bytes as Uint8Array)
    ).rejects.toMatchObject({ code: -32_602, data: { field: "data" } });
  });

  it("picks the mime of readBinary from the extension", async () => {
    await fx.put(".moku/captures/a.JPG", PNG_BYTES);
    const { dataUrl } = await fx.api.readBinary(".moku/captures/a.JPG");
    expect(dataUrl).toMatch(/^data:image\/jpeg;base64,/);
  });
});

describe("files api: writeDataUrl", () => {
  it("decodes the data URL and writes the image like writeBinary", async () => {
    const path = ".moku/captures/series-x/001.png";
    const saved = await fx.api.writeDataUrl(path, url("png"));
    expect(saved).toEqual({ path, bytes: PNG_BYTES.length, version: sha1(PNG_BYTES) });
    expect([...(await readFile(join(fx.root, path)))]).toEqual([...PNG_BYTES]);
    expect(fx.ctx.emit).toHaveBeenCalledWith("files:written", {
      path,
      bytes: PNG_BYTES.length,
      kind: "capture"
    });
  });

  it("rejects a mime that does not match the path with -32602 field data, writing nothing", async () => {
    await expect(fx.api.writeDataUrl(".moku/captures/a.jpg", url("png"))).rejects.toMatchObject({
      code: -32_602,
      data: { field: "data" }
    });
    expect(fx.ctx.emit).not.toHaveBeenCalled();
  });

  it("rejects instead of throwing: -32602 for a bad URL, -32004 for a non-image path", async () => {
    expect(await outcome(fx.api.writeDataUrl(".moku/captures/a.png", "png"))).toBe(-32_602);
    expect(await outcome(fx.api.writeDataUrl("src/a.ts", url("png")))).toBe(-32_004);
    expect(await outcome(fx.api.writeDataUrl("src/a.png", url("png")))).toBe(-32_004);
  });
});

describe("files api: resolve and root", () => {
  it("returns the real root", () => {
    expect(fx.api.root()).toBe(fx.rootReal);
  });

  it("resolves a missing file to its would-be real path", () => {
    expect(fx.api.resolve("src/main.ts")).toBe(join(fx.rootReal, "src/main.ts"));
  });

  it("throws a forbidden wire error synchronously", () => {
    let caught: unknown;
    try {
      fx.api.resolve("../secret.ts");
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: -32_004,
      message: "[moku-editor] forbidden path: ../secret.ts",
      data: { reason: "forbidden_path", id: "../secret.ts" }
    });
  });

  it("writes through resolve's path the same file write uses", async () => {
    await fx.api.write("src/a.ts", "x");
    expect(await readFile(fx.api.resolve("src/a.ts"), "utf8")).toBe("x");
  });
});

describe("files api: types", () => {
  it("types the api methods", () => {
    expectTypeOf<FilesApi["read"]>().returns.toEqualTypeOf<Promise<FileText>>();
    expectTypeOf<FilesApi["readBinary"]>().returns.toEqualTypeOf<Promise<FileBinary>>();
    expectTypeOf<FilesApi["list"]>().returns.toEqualTypeOf<Promise<FileEntry[]>>();
    expectTypeOf<FilesApi["write"]>().returns.toEqualTypeOf<Promise<WriteResult>>();
    expectTypeOf<FilesApi["writeBinary"]>().parameter(1).toEqualTypeOf<Uint8Array>();
    expectTypeOf<FilesApi["writeDataUrl"]>().parameter(1).toEqualTypeOf<string>();
    expectTypeOf<FilesApi["writeDataUrl"]>().returns.toEqualTypeOf<Promise<WriteResult>>();
    expectTypeOf<FilesApi["resolve"]>().returns.toEqualTypeOf<string>();
    expectTypeOf<FilesApi["root"]>().returns.toEqualTypeOf<string>();
  });

  it("makes the version of write optional", () => {
    expectTypeOf<FilesApi["write"]>().toBeCallableWith("a.ts", "x");
    expectTypeOf<FilesApi["write"]>().toBeCallableWith("a.ts", "x", "3f7a");
    expectTypeOf<FilesApi["write"]>().parameter(2).toEqualTypeOf<string | undefined>();
  });

  it("types the files:written payload of emit", () => {
    const emit: FilesCtx["emit"] = vi.fn();
    emit("files:written", { path: "a.ts", bytes: 1, kind: "code" });
    // @ts-expect-error — "image" is not a WrittenKind
    emit("files:written", { path: "a.ts", bytes: 1, kind: "image" });
    // @ts-expect-error — bytes is required
    emit("files:written", { path: "a.ts", kind: "code" });
    expect(emit).toHaveBeenCalledTimes(3);
  });
});

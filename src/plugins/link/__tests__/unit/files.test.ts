import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFilesClient } from "../../files/client";
import { openSocket } from "../../socket/connect";
import { BOOT, createCtx, FakeWebSocket, latestSocket, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// FilesClient: files channel, never a session, works without a game (empty)
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  FakeWebSocket.instances.length = 0;
  ctx = createCtx();
  ctx.state.boot = BOOT;
  openSocket(ctx);
  latestSocket().open();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("createFilesClient", () => {
  it("list sends list { dir } and reads FileEntry[]", async () => {
    const files = createFilesClient(ctx);
    const listing = files.list(".moku/notes");
    const sent = latestSocket().last("list");
    expect(sent).toEqual({
      jsonrpc: "2.0",
      id: 1,
      channel: "files",
      method: "list",
      params: { dir: ".moku/notes" }
    });
    latestSocket().answer(sent, [
      { path: ".moku/notes/a.md", kind: "file", size: 3, version: "v" }
    ]);
    await expect(listing).resolves.toEqual([
      { path: ".moku/notes/a.md", kind: "file", size: 3, version: "v" }
    ]);
  });

  it("read sends read { path } and reads FileText", async () => {
    const reading = createFilesClient(ctx).read("src/a.ts");
    const sent = latestSocket().last("read");
    expect(sent.params).toEqual({ path: "src/a.ts" });
    expect(sent.channel).toBe("files");
    latestSocket().answer(sent, { text: "x", version: "v1" });
    await expect(reading).resolves.toEqual({ text: "x", version: "v1" });
  });

  it("write sends the version only when given and reads WriteResult", async () => {
    const files = createFilesClient(ctx);
    const first = files.write("a.md", "hi");
    const second = files.write("a.md", "hi", "v1");
    const [plain, versioned] = latestSocket().requests("write");
    expect(plain?.params).toEqual({ path: "a.md", text: "hi" });
    expect(versioned?.params).toEqual({ path: "a.md", text: "hi", version: "v1" });
    if (plain === undefined || versioned === undefined) throw new Error("missing");
    latestSocket().answer(plain, { path: "a.md", bytes: 2, version: "v2" });
    latestSocket().answer(versioned, { path: "a.md", bytes: 2, version: "v3" });
    await expect(first).resolves.toEqual({ path: "a.md", bytes: 2, version: "v2" });
    await expect(second).resolves.toEqual({ path: "a.md", bytes: 2, version: "v3" });
  });

  it("writeBinary sends { path, data } and readBinary reads FileBinary", async () => {
    const files = createFilesClient(ctx);
    const url = "data:image/png;base64,iVBORw0KGgo=";
    const writing = files.writeBinary(".moku/captures/a.png", url);
    const reading = files.readBinary(".moku/captures/a.png");
    const socket = latestSocket();
    expect(socket.last("writeBinary").params).toEqual({ path: ".moku/captures/a.png", data: url });
    expect(socket.last("readBinary").params).toEqual({ path: ".moku/captures/a.png" });
    socket.answer(socket.last("writeBinary"), {
      path: ".moku/captures/a.png",
      bytes: 8,
      version: "v"
    });
    socket.answer(socket.last("readBinary"), { dataUrl: url, version: "v" });
    await expect(writing).resolves.toMatchObject({ bytes: 8 });
    await expect(reading).resolves.toEqual({ dataUrl: url, version: "v" });
  });

  it("find sends find { key } and reads the Found list", async () => {
    const found = {
      path: "nodes/merge.ts",
      binding: "merge",
      key: "node:board/merge",
      line: 17,
      range: [17, 1, 30, 3],
      hash: "a1"
    };
    const finding = createFilesClient(ctx).find("node:board/merge");
    const sent = latestSocket().last("find");
    expect(sent).toEqual({
      jsonrpc: "2.0",
      id: 1,
      channel: "files",
      method: "find",
      params: { key: "node:board/merge" }
    });
    latestSocket().answer(sent, [found]);
    await expect(finding).resolves.toEqual([found]);
  });

  it("find resolves [] for a key the index does not know and rejects a bad Found -32600", async () => {
    const files = createFilesClient(ctx);
    const unknown = files.find("jsx:nowhere");
    latestSocket().answer(latestSocket().last("find"), []);
    await expect(unknown).resolves.toEqual([]);

    const bad = files.find("node:board/merge").catch((error: unknown) => error);
    latestSocket().answer(latestSocket().last("find"), [
      { path: "nodes/merge.ts", line: 17, range: [17, 1, 30], hash: "a1" }
    ]);
    expect(await bad).toMatchObject({ code: -32_600 });
  });

  it("never sends a session, even when one is chosen", () => {
    ctx.state.chosen = "s-1";
    createFilesClient(ctx)
      .list("")
      .catch(() => undefined);
    expect("session" in latestSocket().last("list")).toBe(false);
  });

  it("propagates server errors and rejects bad shapes", async () => {
    const files = createFilesClient(ctx);
    const conflict = files.write("a.md", "x", "stale").catch((error: unknown) => error);
    latestSocket().reject(latestSocket().last("write"), {
      code: -32_005,
      message: "[moku-editor] version conflict",
      data: { reason: "version_conflict", retryable: false }
    });
    expect(await conflict).toMatchObject({ code: -32_005 });

    const bad = files.read("a.md").catch((error: unknown) => error);
    latestSocket().answer(latestSocket().last("read"), { text: 1 });
    expect(await bad).toMatchObject({ code: -32_600 });
  });
});

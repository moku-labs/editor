/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { afterEach, describe, expect, it } from "vitest";
import { wireError } from "../../../../registry/protocol";
import { NOT_RUNNING } from "../../../mcp/connection";
import {
  manifestTool,
  readTool,
  runTool,
  sessionsTool,
  statusTool,
  waitTool
} from "../../../mcp/game-tools";
import { session, until } from "../../fake-hub";
import type { ToolSetup } from "../../mcp-tools";
import { jsonOf, textAt, toolSetup } from "../../mcp-tools";

// ─────────────────────────────────────────────────────────────────────────────
// pages/mcp game tools (M5): status, sessions, manifest, read, run with its
// effect line, and wait (until, changedFrom, first change, timeout, cancel).
// ─────────────────────────────────────────────────────────────────────────────

let setup: ToolSetup | undefined;

afterEach(async () => {
  await setup?.cleanup();
  setup = undefined;
});

/** A manifest with one source and two commands. */
const MANIFEST = {
  game: "tiny-game 0.0.0",
  page: "http://127.0.0.1:3000/",
  embedded: true,
  sources: [{ id: "game.position", title: "Position", input: {}, changes: "commit" }],
  commands: [
    { id: "game.step", title: "Step", input: { frames: "number" }, effect: "raw" },
    { id: "game.pause", title: "Pause", input: {}, effect: "cosmetic" }
  ]
};

/** The setup of a test, kept for the cleanup. */
async function ready(options: Parameters<typeof toolSetup>[0] = {}): Promise<ToolSetup> {
  setup = await toolSetup(options);
  return setup;
}

describe("moku_status and moku_sessions", () => {
  it("shows the bin, the URLs, hot reload and the sessions with heartbeat", async () => {
    const live = session("s-1", { heartbeat: { frame: 9, paused: false, silent: false } });
    const { run, hub, root, client } = await ready({
      sessions: [live],
      hotReload: { hmr: true, owner: "bin" }
    });
    await until(() => client.hotReload() !== undefined, "hotReload");
    const { result } = await run(statusTool);
    expect(jsonOf(result)).toEqual({
      running: true,
      owned: false,
      url: `${hub.url}/`,
      tools: `${hub.url}/__editor/`,
      port: hub.port,
      pid: process.pid,
      root,
      html: `${root}/web/index.html`,
      hotReload: { hmr: true, owner: "bin" },
      sessions: [live]
    });
    const listed = await run(sessionsTool);
    expect(jsonOf(listed.result)).toEqual([live]);
  });

  it("answers running false with the hint (not isError) when no bin runs", async () => {
    const { run, editor } = await ready();
    editor.hub = () => Promise.reject(new Error(`[moku-editor] ${NOT_RUNNING}`));
    const { result } = await run(statusTool);
    expect(result.isError).toBeUndefined();
    expect(jsonOf(result)).toEqual({ running: false, owned: false, hint: NOT_RUNNING });
  });
});

describe("moku_manifest and moku_read", () => {
  it("answers the manifest of the asked session", async () => {
    const { run, hub } = await ready({ sessions: [session("s-1")] });
    hub.handle("game.manifest", () => MANIFEST);
    const { result } = await run(manifestTool, { session: "s-1" });
    expect(jsonOf(result)).toEqual(MANIFEST);
    expect(hub.requests[0]).toMatchObject({ method: "manifest", params: {}, session: "s-1" });
  });

  it("reads a source with its input", async () => {
    const { run, hub } = await ready({ sessions: [session("s-1")] });
    hub.handle("game.read", () => [{ path: "home" }]);
    const { result } = await run(readTool, { id: "game.history", input: { last: 1 } });
    expect(jsonOf(result)).toEqual([{ path: "home" }]);
    expect(hub.requests[0]).toEqual({
      channel: "game",
      method: "read",
      params: { id: "game.history", input: { last: 1 } },
      session: undefined
    });
  });

  it("answers the hub error as isError", async () => {
    const { run, hub } = await ready({ sessions: [session("s-1")] });
    hub.handle("game.read", () => {
      throw wireError(-32_601, "unknown source nope", { reason: "unknown_id", id: "nope" });
    });
    const { result } = await run(readTool, { id: "nope" });
    expect(result).toEqual({
      content: [{ type: "text", text: "unknown source nope" }],
      isError: true
    });
  });

  it("lists the sessions to choose from on choose_session", async () => {
    const sessions = [session("s-1", { embedded: false }), session("s-2", { embedded: false })];
    const { run, hub } = await ready({ sessions });
    hub.handle("game.read", () => {
      throw wireError(-32_003, "several games are connected; choose a session", {
        reason: "choose_session"
      });
    });
    const { result } = await run(readTool, { id: "game.position" });
    expect(result.isError).toBe(true);
    expect(textAt(result)).toBe(
      [
        "several games are connected; choose a session",
        "Pass session as one of:",
        "- s-1 tiny-game 0.0.0 http://127.0.0.1:3000/",
        "- s-2 tiny-game 0.0.0 http://127.0.0.1:3000/"
      ].join("\n")
    );
  });
});

describe("moku_run", () => {
  it("starts the text with the command's effect, then the envelope", async () => {
    const { run, hub } = await ready({ sessions: [session("s-1")] });
    hub.handle("game.manifest", () => MANIFEST);
    hub.handle("game.run", () => ({
      value: { frame: 11 },
      state: { path: "home", frame: 11, tainted: true }
    }));
    const { result } = await run(runTool, { id: "game.step", input: { frames: 1 } });
    const [first, ...rest] = textAt(result).split("\n");
    expect(first).toBe("effect: raw");
    expect(JSON.parse(rest.join("\n"))).toEqual({
      value: { frame: 11 },
      frame: 11,
      state: { path: "home", frame: 11, tainted: true }
    });
    expect(hub.requests[1]?.params).toEqual({ id: "game.step", input: { frames: 1 } });
  });

  it("says effect unknown for a command missing from the manifest and passes an odd answer through", async () => {
    const { run, hub } = await ready({ sessions: [session("s-1")] });
    hub.handle("game.manifest", () => MANIFEST);
    hub.handle("game.run", () => "odd");
    const { result } = await run(runTool, { id: "tiny.warn" });
    expect(textAt(result)).toBe('effect: unknown\n"odd"');
  });
});

describe("moku_wait", () => {
  it("resolves when the value deep-equals until and unwatches", async () => {
    const { run, hub } = await ready({ sessions: [session("s-1")] });
    const waiting = run(waitTool, { id: "game.position", until: { b: 2, a: 1 } });
    await until(() => hub.watched().length === 1, "the watch");
    hub.value(1, { a: 0 });
    hub.value(1, { a: 1, b: 2 });
    const { result } = await waiting;
    expect(jsonOf(result)).toMatchObject({ timedOut: false, value: { a: 1, b: 2 } });
    await until(() => hub.watched().length === 0, "the unwatch");
  });

  it("resolves when the value differs from changedFrom, the first value included", async () => {
    const { run, hub } = await ready({ sessions: [session("s-1")] });
    const waiting = run(waitTool, { id: "game.position", changedFrom: "splash" });
    await until(() => hub.watched().length === 1, "the watch");
    hub.value(1, "board");
    const waited = await waiting;
    expect(jsonOf(waited.result)).toMatchObject({ timedOut: false, value: "board" });
  });

  it("waits for the first change after the current value by default; null counts as a value", async () => {
    const { run, hub } = await ready({ sessions: [session("s-1")] });
    const waiting = run(waitTool, { id: "game.position" });
    await until(() => hub.watched().length === 1, "the watch");
    hub.value(1, null);
    hub.value(1, null);
    hub.value(1, "board");
    const waited = await waiting;
    expect(jsonOf(waited.result)).toMatchObject({ timedOut: false, value: "board" });
  });

  it("keeps a JSON null value as the answer", async () => {
    const { run, hub } = await ready({ sessions: [session("s-1")] });
    const waiting = run(waitTool, { id: "game.selection", until: null });
    await until(() => hub.watched().length === 1, "the watch");
    hub.value(1, null);
    const waited = await waiting;
    expect(jsonOf(waited.result)).toMatchObject({ timedOut: false, value: null });
  });

  it("times out with the last value", async () => {
    const { run, hub } = await ready({ sessions: [session("s-1")] });
    const waiting = run(waitTool, { id: "game.position", until: "never", timeoutMs: 150 });
    await until(() => hub.watched().length === 1, "the watch");
    hub.value(1, "splash");
    const { result } = await waiting;
    expect(jsonOf(result)).toMatchObject({ timedOut: true, value: "splash" });
    await until(() => hub.watched().length === 0, "the unwatch");
  });

  it("says when no value arrived before the timeout", async () => {
    const { run } = await ready({ sessions: [session("s-1")] });
    const { result } = await run(waitTool, { id: "game.position", timeoutMs: 100 });
    expect(jsonOf(result)).toMatchObject({ timedOut: true, value: "no value arrived" });
  });

  it("ends and unwatches when the request is cancelled", async () => {
    const { run, hub } = await ready({ sessions: [session("s-1")] });
    const controller = new AbortController();
    const waiting = run(waitTool, { id: "game.position", timeoutMs: 20_000 }, controller.signal);
    await until(() => hub.watched().length === 1, "the watch");
    controller.abort();
    const waited = await waiting;
    expect(jsonOf(waited.result)).toMatchObject({ timedOut: true });
    await until(() => hub.watched().length === 0, "the unwatch");
  });

  it("answers a refused watch as isError", async () => {
    const { run, hub } = await ready({ sessions: [session("s-1")] });
    hub.handle("game.watch", () => {
      throw wireError(-32_601, "unknown source nope", { reason: "unknown_id" });
    });
    const { result } = await run(waitTool, { id: "nope" });
    expect(result).toEqual({
      content: [{ type: "text", text: "unknown source nope" }],
      isError: true
    });
  });
});

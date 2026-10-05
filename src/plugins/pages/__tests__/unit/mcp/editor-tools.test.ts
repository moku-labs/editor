import { afterEach, describe, expect, it } from "vitest";
import { wireError } from "../../../../registry/protocol";
import { reloadTool, startTool, stopTool } from "../../../mcp/editor-tools";
import { session, until } from "../../fake-hub";
import type { ToolSetup } from "../../mcp-tools";
import { jsonOf, textAt, toolSetup } from "../../mcp-tools";

// ─────────────────────────────────────────────────────────────────────────────
// pages/mcp editor tools (M5): moku_reload runs editor.reload and waits for
// the game to connect again (a -32001 on the run is expected); moku_start and
// moku_stop go to the bin side, which stops only a bin this bridge started.
// ─────────────────────────────────────────────────────────────────────────────

let setup: ToolSetup | undefined;

afterEach(async () => {
  await setup?.cleanup();
  setup = undefined;
});

/** The setup of a test, kept for the cleanup. */
async function ready(options: Parameters<typeof toolSetup>[0] = {}): Promise<ToolSetup> {
  setup = await toolSetup(options);
  return setup;
}

describe("moku_reload", () => {
  it("runs editor.reload, waits for the game to come back and reads its restored frame", async () => {
    const current = await ready({ sessions: [session("s-1")] });
    const { hub, run } = current;
    hub.handle("game.run", () => {
      setTimeout(() => hub.setSessions([session("s-2")]), 20);
      return { value: { scheduled: true }, state: { path: "home", frame: 5, tainted: false } };
    });
    hub.handle("game.manifest", () => ({ game: "g", restored: { bookmark: "{}", frame: 1840 } }));
    const { result } = await run(reloadTool);
    expect(hub.requests[0]?.params).toEqual({ id: "editor.reload", input: { restore: true } });
    expect(hub.requests[1]).toMatchObject({ method: "manifest", session: "s-2" });
    expect(jsonOf(result)).toEqual({
      restored: true,
      frame: 1840,
      session: "s-2",
      game: "tiny-game 0.0.0"
    });
  });

  it("expects a -32001 game_reloaded on the run, and passes restore false", async () => {
    const current = await ready({ sessions: [session("s-1")] });
    const { hub, run } = current;
    hub.handle("game.run", () => {
      setTimeout(() => hub.setSessions([session("s-9")]), 20);
      throw wireError(-32_001, "the game reloaded", { reason: "game_reloaded", retryable: true });
    });
    hub.handle("game.manifest", () => ({ game: "g" }));
    const { result } = await run(reloadTool, { restore: false, session: "s-1" });
    expect(hub.requests[0]).toMatchObject({
      params: { id: "editor.reload", input: { restore: false } },
      session: "s-1"
    });
    expect(jsonOf(result)).toEqual({ restored: false, session: "s-9", game: "tiny-game 0.0.0" });
  });

  it("ignores a new session of another game and answers isError when cancelled", async () => {
    const current = await ready({ sessions: [session("s-1")] });
    const { hub, run } = current;
    hub.handle("game.run", () => ({ value: {}, state: { path: "", frame: 0, tainted: false } }));
    const controller = new AbortController();
    const reloading = run(reloadTool, {}, controller.signal);
    await until(() => hub.requests.length === 1, "the run");
    hub.setSessions([session("s-1"), session("s-3", { game: "other 1.0.0" })]);
    await Bun.sleep(20);
    controller.abort();
    const { result } = await reloading;
    expect(result.isError).toBe(true);
    expect(textAt(result)).toBe("the game did not connect again within 15 s after the reload");
  });

  it("answers another run error as isError", async () => {
    const current = await ready({ sessions: [session("s-1")] });
    current.hub.handle("game.run", () => {
      throw wireError(-32_601, "unknown command editor.reload", { reason: "unknown_id" });
    });
    const { result } = await current.run(reloadTool);
    expect(result).toEqual({
      content: [{ type: "text", text: "unknown command editor.reload" }],
      isError: true
    });
  });
});

describe("moku_start", () => {
  it("asks the bin side to start with the given html and port", async () => {
    const current = await ready();
    const { result } = await current.run(startTool, { html: "web/index.html", port: 3001 });
    expect(current.editor.launch).toHaveBeenCalledWith({ html: "web/index.html", port: 3001 });
    expect(jsonOf(result)).toEqual({
      running: true,
      owned: false,
      url: `${current.hub.url}/`,
      pid: process.pid
    });
    await current.run(startTool);
    expect(current.editor.launch).toHaveBeenLastCalledWith({});
  });

  it("answers a failed start as isError", async () => {
    const current = await ready();
    current.editor.launch.mockRejectedValueOnce(
      new Error(
        "[moku-editor] moku_start needs the game HTML file.\n  Pass html, such as web/index.html."
      )
    );
    const { result } = await current.run(startTool);
    expect(result.isError).toBe(true);
    expect(textAt(result)).toContain("moku_start needs the game HTML file");
  });
});

describe("moku_stop", () => {
  it("answers stopped for a bin this bridge started", async () => {
    const current = await ready();
    current.editor.stopOwned.mockResolvedValueOnce({
      stopped: true,
      status: { running: false, owned: false, bin: undefined }
    });
    const stopped = await current.run(stopTool);
    expect(jsonOf(stopped.result)).toEqual({ stopped: true, running: false });
  });

  it("refuses a bin it did not start, and answers not running when none runs", async () => {
    const current = await ready();
    const refused = await current.run(stopTool);
    expect(refused.result.isError).toBe(true);
    expect(textAt(refused.result)).toBe(
      `moku-editor (pid ${process.pid}) was not started by this bridge; stop it where it runs (Ctrl+C)`
    );

    current.editor.hub = () => Promise.reject(new Error("not running"));
    const nothingRuns = await current.run(stopTool);
    expect(jsonOf(nothingRuns.result)).toEqual({
      stopped: false,
      running: false
    });
  });
});

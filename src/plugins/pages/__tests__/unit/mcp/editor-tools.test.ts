import { afterEach, describe, expect, it } from "vitest";
import type { BunServeOptions } from "../../../../hub/types";
import { toWireValue, wireError } from "../../../../registry/protocol";
import { attachServer, hotReloadRoute } from "../../../hot-reload";
import {
  deviceTool,
  hotReloadTool,
  reloadTool,
  showTool,
  startTool,
  stopTool
} from "../../../mcp/editor-tools";
import { connectHub } from "../../../mcp/hub-client";
import { checkArguments } from "../../../mcp/schema";
import type { HubClient } from "../../../mcp/types";
import { FAKE_TOKEN, session, until } from "../../fake-hub";
import { createHarness } from "../../helpers";
import type { ToolSetup } from "../../mcp-tools";
import { jsonOf, textAt, toolSetup } from "../../mcp-tools";

// ─────────────────────────────────────────────────────────────────────────────
// pages/mcp editor tools (M5): moku_reload runs editor.reload and waits for
// the game to connect again (a -32001 on the run is expected); moku_start and
// moku_stop go to the bin side, which stops only a bin this bridge started.
// moku_device and moku_show ask the editor page through the hub (D-60);
// moku_hot_reload posts P/hmr with the token of the discovery file and waits
// for the bin to come back (D-62).
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

/** The hub's error when no editor page is open. */
function noEditorPage(): Error {
  return wireError(
    -32_003,
    "no editor page is open. Open the editor page: http://127.0.0.1:3000/__editor/",
    { reason: "no_editor_page", retryable: false }
  );
}

/** The answer of an editor page that does not know a method: an older page. */
function unknownMethod(method: string): Error {
  return wireError(-32_601, `unknown method editor.${method}: this page has no handler`, {
    retryable: false
  });
}

/** What every tool answers for an editor page older than the bridge. */
const OLDER_PAGE = {
  content: [{ type: "text", text: "this editor page is older than the bridge; reload it" }],
  isError: true
};

/** The device the editor page answers: a Pixel 8 on its side. */
const DEVICE = {
  preset: "pixel-8",
  orientation: "landscape",
  folded: true,
  w: 915,
  h: 412,
  presets: [
    {
      id: "pixel-8",
      name: "Pixel 8",
      group: "android",
      kind: "phone",
      w: 412,
      h: 915,
      foldable: false
    }
  ]
};

/** The workspaces of the rail, in rail order. */
const WORKSPACES = ["flow", "game", "render", "state", "files", "console"];

describe("moku_device", () => {
  it("passes the checked arguments to editor.device and prints the device", async () => {
    const { run, hub } = await ready();
    hub.handle("editor.device", () => DEVICE);
    const { result } = await run(deviceTool, { preset: "pixel-8", orientation: "landscape" });
    expect(hub.requests).toEqual([
      {
        channel: "editor",
        method: "device",
        params: { preset: "pixel-8", orientation: "landscape" },
        session: undefined
      }
    ]);
    expect(jsonOf(result)).toEqual(DEVICE);
    expect(result.isError).toBeUndefined();
  });

  it("reads the device and the presets with no argument, and passes folded", async () => {
    const { run, hub } = await ready();
    hub.handle("editor.device", () => DEVICE);
    const { result } = await run(deviceTool);
    expect(hub.requests[0]?.params).toEqual({});
    expect(jsonOf(result)).toEqual(DEVICE);
    await run(deviceTool, { folded: false });
    expect(hub.requests[1]?.params).toEqual({ folded: false });
  });

  it("answers the hub's no_editor_page error with the URL of the tools page to open", async () => {
    const { run, hub } = await ready();
    hub.handle("editor.device", () => {
      throw noEditorPage();
    });
    const { result } = await run(deviceTool, { preset: "pixel-8" });
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "no editor page is open. Open the editor page: http://127.0.0.1:3000/__editor/"
        }
      ],
      isError: true
    });
  });

  it("passes the page's refusal of an unknown preset through", async () => {
    const { run, hub } = await ready();
    hub.handle("editor.device", () => {
      throw wireError(-32_602, "unknown device preset nokia-3310", {
        reason: "invalid_input",
        field: "preset"
      });
    });
    const { result } = await run(deviceTool, { preset: "nokia-3310" });
    expect(result).toEqual({
      content: [{ type: "text", text: "unknown device preset nokia-3310" }],
      isError: true
    });
  });

  it("tells an editor page older than the bridge to reload", async () => {
    const { run, hub } = await ready();
    hub.handle("editor.device", () => {
      throw unknownMethod("device");
    });
    const { result } = await run(deviceTool);
    expect(result).toEqual(OLDER_PAGE);
  });

  it("answers isError for an answer that is not a device", async () => {
    const { run, hub } = await ready();
    hub.handle("editor.device", () => ({ preset: "pixel-8" }));
    const { result } = await run(deviceTool);
    expect(result).toEqual({
      content: [{ type: "text", text: "editor.device answered an unexpected value." }],
      isError: true
    });
  });

  it("takes a closed object: an unknown field, a bad orientation or a bad type is refused", () => {
    const { inputSchema } = deviceTool;
    expect(checkArguments(inputSchema, { zoom: 2 })).toBe("zoom is not an argument of this tool");
    expect(checkArguments(inputSchema, { orientation: "sideways" })).toBe(
      "orientation must be one of portrait, landscape"
    );
    expect(checkArguments(inputSchema, { preset: "" })).toBe("preset must not be empty");
    expect(checkArguments(inputSchema, { folded: "yes" })).toBe("folded must be true or false");
    expect(inputSchema.additionalProperties).toBe(false);
    expect(inputSchema.required).toBeUndefined();
  });

  it("changes the editor page, destroys nothing and can be repeated", () => {
    expect(deviceTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    });
  });
});

describe("moku_show", () => {
  it("passes the workspace to editor.show and prints the active one with the list", async () => {
    const { run, hub } = await ready();
    hub.handle("editor.show", () => ({ workspace: "state", workspaces: WORKSPACES }));
    const { result } = await run(showTool, { workspace: "state" });
    expect(hub.requests).toEqual([
      { channel: "editor", method: "show", params: { workspace: "state" }, session: undefined }
    ]);
    expect(jsonOf(result)).toEqual({ workspace: "state", workspaces: WORKSPACES });
  });

  it("reads the active workspace with no argument", async () => {
    const { run, hub } = await ready();
    hub.handle("editor.show", () => ({ workspace: "game", workspaces: WORKSPACES }));
    const { result } = await run(showTool);
    expect(hub.requests[0]?.params).toEqual({});
    expect(jsonOf(result)).toEqual({ workspace: "game", workspaces: WORKSPACES });
  });

  it("answers no_editor_page with the URL to open, and an older page with the reload hint", async () => {
    const { run, hub } = await ready();
    hub.handle("editor.show", () => {
      throw noEditorPage();
    });
    const closed = await run(showTool, { workspace: "flow" });
    expect(closed.result.isError).toBe(true);
    expect(textAt(closed.result)).toBe(
      "no editor page is open. Open the editor page: http://127.0.0.1:3000/__editor/"
    );

    hub.handle("editor.show", () => {
      throw unknownMethod("show");
    });
    const older = await run(showTool, { workspace: "flow" });
    expect(older.result).toEqual(OLDER_PAGE);
  });

  it("takes only a workspace of the rail", () => {
    const { inputSchema } = showTool;
    expect(inputSchema.properties.workspace).toMatchObject({ type: "string", enum: WORKSPACES });
    expect(checkArguments(inputSchema, { workspace: "settings" })).toBe(
      "workspace must be one of flow, game, render, state, files, console"
    );
    expect(checkArguments(inputSchema, { workspace: "flow", focus: true })).toBe(
      "focus is not an argument of this tool"
    );
    expect(showTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    });
  });
});

/** One POST the fake bin received on `P/hmr`. */
type HmrPost = { readonly authorization: string | null; readonly body: string };

/**
 * A clock of the tool that runs ahead of real time: every reading is `step` ms later. The tool
 * reads it once or twice per 100 ms look at the connection. With 250 ms, the 1.5 s a connection has
 * to hold pass in about 0.3 s, and the 15 s of the wait in 3 s or more.
 *
 * @param step - How far each reading moves the clock, in ms.
 */
function fastClock(step = 250): () => number {
  let clock = 1_790_000_000_000;
  return () => {
    clock += step;
    return clock;
  };
}

/**
 * The bin behind the fake hub: `P/hmr` is answered by the real route of the bin (`hot-reload.ts`:
 * the guard, the token of this start and the body check), the state it publishes goes out through
 * the fake hub, and the bin's restart closes every socket and the port, opens the port again and
 * lets the bridge reconnect.
 *
 * @param current - The setup.
 * @param hmr - Bun HMR of the bin at the start; undefined for a game's own server (no bin).
 */
function serveBin(current: ToolSetup, hmr: boolean | undefined) {
  const { hub, root } = current;
  const posts: HmrPost[] = [];
  const clients: HubClient[] = [current.client];
  const harness = createHarness(undefined);
  harness.hub.token = () => FAKE_TOKEN;
  harness.hub.publish.mockImplementation((method, params) => {
    hub.publish(method, toWireValue(params));
  });
  const route = hotReloadRoute(harness.deps);
  const server = { port: hub.port, upgrade: () => false };

  /** The bin's restart: 1012 to every socket, a closed port, the port again, then the bridge. */
  const restart = async (): Promise<void> => {
    await hub.goAway();
    hub.comeBack();
    clients.push(await connectHub(hub.discovery(root)));
  };
  if (hmr !== undefined) {
    const options = { port: hub.port, development: { hmr, console: true } };
    attachServer(harness.deps, options as unknown as BunServeOptions, restart);
  }

  hub.serveHttp(async req => {
    if (new URL(req.url).pathname !== "/__editor/hmr") return new Response("no", { status: 404 });
    if (req.method === "POST") {
      const copy = req.clone();
      posts.push({ authorization: copy.headers.get("authorization"), body: await copy.text() });
    }
    return (await route(req, server)) ?? new Response("no", { status: 404 });
  });
  // The bin side of the bridge: the newest connection, while it is open.
  current.editor.connected = () => {
    const newest = clients.at(-1);
    return newest?.isOpen() === true ? newest : undefined;
  };
  current.editor.hub = () => {
    const open = current.editor.connected();
    return open === undefined ? Promise.reject(new Error("not running")) : Promise.resolve(open);
  };

  return {
    posts,
    clients,
    restarts: () => clients.length - 1,
    cleanup: () => {
      for (const client of clients.slice(1)) client.close();
    }
  };
}

/** A setup whose hub published `{ hmr: true, owner: "bin" }`, read by the client. */
async function withHmrOn(now?: () => number): Promise<ToolSetup> {
  const current = await ready({
    hotReload: { hmr: true, owner: "bin" },
    ...(now === undefined ? {} : { now })
  });
  await until(() => current.client.hotReload() !== undefined, "the published state");
  return current;
}

describe("moku_hot_reload", () => {
  it("posts once with the token and the body the route expects, waits for the restart and answers the new state", async () => {
    const current = await ready({ now: fastClock() });
    const bin = serveBin(current, true);
    await until(() => current.client.hotReload() !== undefined, "the published state");

    const { result } = await current.run(hotReloadTool, { on: false });

    expect(bin.posts).toEqual([{ authorization: `Bearer ${FAKE_TOKEN}`, body: '{"hmr":false}' }]);
    expect(jsonOf(result)).toEqual({ hmr: false, owner: "bin", restarted: true });
    expect(result.isError).toBeUndefined();
    expect(bin.restarts()).toBe(1);
    expect(current.client.isOpen()).toBe(false);
    expect(bin.clients.at(-1)?.isOpen()).toBe(true);
    expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN);
    bin.cleanup();
  });

  it("switches back on over the connection the restart left: one POST per switch", async () => {
    const current = await ready({ now: fastClock() });
    const bin = serveBin(current, true);
    await until(() => current.client.hotReload() !== undefined, "the published state");

    await current.run(hotReloadTool, { on: false });
    const { result } = await current.run(hotReloadTool, { on: true });

    expect(bin.posts.map(post => post.body)).toEqual(['{"hmr":false}', '{"hmr":true}']);
    expect(jsonOf(result)).toEqual({ hmr: true, owner: "bin", restarted: true });
    expect(bin.restarts()).toBe(2);
    bin.cleanup();
  });

  it("skips the POST when hot reload is already in the asked state", async () => {
    const current = await withHmrOn();
    const bin = serveBin(current, undefined);

    const { result } = await current.run(hotReloadTool, { on: true });

    expect(jsonOf(result)).toEqual({ hmr: true, owner: "bin", restarted: false });
    expect(bin.posts).toEqual([]);
  });

  it("answers isError for a game's own server, without a POST when the state says so", async () => {
    const current = await ready({ hotReload: { hmr: false, owner: "server" } });
    const bin = serveBin(current, undefined);
    await until(() => current.client.hotReload() !== undefined, "the published state");

    for (const on of [true, false]) {
      const { result } = await current.run(hotReloadTool, { on });
      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: "hot reload is owned by the game's server; it cannot be switched"
          }
        ],
        isError: true
      });
    }
    expect(bin.posts).toEqual([]);
  });

  it("answers isError for a game's own server that published no state: the route says who owns it", async () => {
    const current = await ready();
    const bin = serveBin(current, undefined);

    const { result } = await current.run(hotReloadTool, { on: true });

    expect(bin.posts).toHaveLength(1);
    expect(result.isError).toBe(true);
    expect(textAt(result)).toBe("hot reload is owned by the game's server; it cannot be switched");
  });

  it("answers isError with the status when the route refuses the POST, and never the token", async () => {
    const current = await withHmrOn();
    const seen: (string | null)[] = [];
    current.hub.serveHttp(req => {
      seen.push(req.headers.get("authorization"));
      return new Response("unauthorized", { status: 401 });
    });

    const { result } = await current.run(hotReloadTool, { on: false });

    expect(seen).toEqual([`Bearer ${FAKE_TOKEN}`]);
    expect(result).toEqual({
      content: [{ type: "text", text: "moku-editor answered HTTP 401 to the hot reload switch" }],
      isError: true
    });
    expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN);
  });

  it("does not follow a redirect with the token: it reads as a refusal", async () => {
    const current = await withHmrOn();
    const paths: string[] = [];
    current.hub.serveHttp(req => {
      paths.push(new URL(req.url).pathname);
      return new Response("moved", { status: 307, headers: { location: "/elsewhere" } });
    });

    const { result } = await current.run(hotReloadTool, { on: false });

    expect(paths).toEqual(["/__editor/hmr"]);
    expect(textAt(result)).toBe("moku-editor answered HTTP 307 to the hot reload switch");
    expect(result.isError).toBe(true);
  });

  it("answers isError when the bin keeps its state: a bin attached without a restart", async () => {
    const current = await withHmrOn();
    current.hub.serveHttp(() => Response.json({ hmr: true, owner: "bin" }));

    const { result } = await current.run(hotReloadTool, { on: false });

    expect(result).toEqual({
      content: [{ type: "text", text: "moku-editor did not switch hot reload: it stays on" }],
      isError: true
    });
  });

  it("times out with a clear text when the bin does not come back in the asked state", async () => {
    // 6 s per reading: the third look at the connection is past the 15 s.
    const current = await withHmrOn(fastClock(6000));
    let posts = 0;
    // The bin answers the asked state, then nothing restarts: no new connection ever opens.
    current.hub.serveHttp(() => {
      posts += 1;
      return Response.json({ hmr: false, owner: "bin" });
    });

    const { result } = await current.run(hotReloadTool, { on: false });

    expect(posts).toBe(1);
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "moku-editor did not come back with hot reload off within 15 s; call moku_status"
        }
      ],
      isError: true
    });
  });

  it("stops waiting when the call is cancelled", async () => {
    const current = await withHmrOn();
    const controller = new AbortController();
    current.hub.serveHttp(() => {
      setTimeout(() => controller.abort(), 50);
      return Response.json({ hmr: false, owner: "bin" });
    });

    const started = Date.now();
    const { result } = await current.run(hotReloadTool, { on: false }, controller.signal);

    expect(result.isError).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("counts an answer the restart cut off as sent, and waits for the bin all the same", async () => {
    const current = await withHmrOn(fastClock());
    const { hub, root } = current;
    let next: HubClient | undefined;
    let posts = 0;
    current.editor.connected = () => (next?.isOpen() === true ? next : undefined);
    hub.serveHttp(() => {
      posts += 1;
      // The restart closes the connection of the POST before its answer went out.
      const restarted = (async (): Promise<void> => {
        hub.publish("hotReload", { hmr: false, owner: "bin" });
        await hub.goAway();
        hub.comeBack();
        next = await connectHub(hub.discovery(root));
      })();
      return restarted.then(() => new Response("late", { status: 500 }));
    });

    const { result } = await current.run(hotReloadTool, { on: false });

    expect(posts).toBe(1);
    expect(jsonOf(result)).toEqual({ hmr: false, owner: "bin", restarted: true });
    next?.close();
  });

  it("counts a 200 whose body is no state as sent: the connection decides", async () => {
    const current = await withHmrOn(fastClock());
    const { hub, root } = current;
    let next: HubClient | undefined;
    current.editor.connected = () => (next?.isOpen() === true ? next : undefined);
    /** The bin is back a moment after its answer: the state, then the bridge's connection. */
    const comeBack = async (): Promise<void> => {
      await Bun.sleep(20);
      hub.publish("hotReload", { hmr: false, owner: "bin" });
      next = await connectHub(hub.discovery(root));
    };
    let back: Promise<void> | undefined;
    hub.serveHttp(() => {
      back = comeBack();
      return new Response("ok");
    });

    const { result } = await current.run(hotReloadTool, { on: false });
    await back;

    expect(jsonOf(result)).toEqual({ hmr: false, owner: "bin", restarted: true });
    next?.close();
  });

  it("does not take a connection the old server accepted: it waits for one that holds", async () => {
    const current = await withHmrOn(fastClock());
    const { hub, root } = current;
    const opened: HubClient[] = [];
    current.editor.connected = () => {
      const newest = opened.at(-1);
      return newest?.isOpen() === true ? newest : undefined;
    };
    /** The old server takes the bridge's first try and drops it when it stops; then the new one. */
    const reconnect = async (): Promise<void> => {
      const early = await connectHub(hub.discovery(root));
      opened.push(early);
      await Bun.sleep(120);
      early.close();
      await Bun.sleep(60);
      opened.push(await connectHub(hub.discovery(root)));
    };
    let reconnected: Promise<void> | undefined;
    hub.serveHttp(() => {
      hub.publish("hotReload", { hmr: false, owner: "bin" });
      reconnected = reconnect();
      return Response.json({ hmr: false, owner: "bin" });
    });

    const { result } = await current.run(hotReloadTool, { on: false });
    await reconnected;

    expect(jsonOf(result)).toEqual({ hmr: false, owner: "bin", restarted: true });
    expect(opened).toHaveLength(2);
    expect(opened[0]?.isOpen()).toBe(false);
    expect(opened[1]?.isOpen()).toBe(true);
    opened[1]?.close();
  });

  it("takes exactly { on } and is not destructive", () => {
    const { inputSchema } = hotReloadTool;
    expect(inputSchema).toEqual({
      type: "object",
      properties: { on: { type: "boolean", description: expect.any(String) } },
      required: ["on"],
      additionalProperties: false
    });
    expect(checkArguments(inputSchema, {})).toBe("on is required");
    expect(checkArguments(inputSchema, { on: "yes" })).toBe("on must be true or false");
    expect(checkArguments(inputSchema, { on: true, port: 1 })).toBe(
      "port is not an argument of this tool"
    );
    expect(hotReloadTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    });
  });
});

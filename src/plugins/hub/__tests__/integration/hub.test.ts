import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServerCore, createServerPlugin, serverCoreConfig } from "../../../../config";
import { filesPlugin } from "../../../files";
import { failure, notification, request, success } from "../../../registry/protocol";
import { hubPlugin } from "../..";
import type { HubSession } from "../../types";
import type { Client } from "./clients";
import {
  AGENT_MANIFEST,
  connectAgent,
  connectClient,
  isNote,
  isRequestOf,
  isResponseTo,
  nextRequest,
  paramsOf,
  shutdown
} from "./clients";

// ─────────────────────────────────────────────────────────────────────────────
// A server core composed with files, hub and an observer plugin that hooks
// hub:session (pages joins the core in wave 4). Real Bun.serve on port 0, real
// websocket clients for the agent and the tools page.
// ─────────────────────────────────────────────────────────────────────────────

/** Every hub:session payload the observer saw. */
const seen: HubSession[] = [];

/**
 * Records a hub:session payload.
 *
 * @param payload - The event payload.
 */
function record(payload: HubSession): void {
  seen.push(payload);
}

/**
 * The hooks of the observer plugin.
 *
 * @returns The hook map.
 */
function observerHooks() {
  return { "hub:session": record };
}

const observerPlugin = createServerPlugin("observer", {
  depends: [hubPlugin],
  hooks: observerHooks
});

const framework = createServerCore(serverCoreConfig, {
  plugins: [filesPlugin, hubPlugin, observerPlugin]
});

/** One running editor server. */
type Running = {
  readonly app: ReturnType<typeof framework.createApp>;
  readonly server: ReturnType<typeof Bun.serve>;
  readonly port: number;
  readonly token: string;
};

let base: string;
let running: Running | undefined;
const clients: Client[] = [];

/**
 * Creates, starts and serves an editor app.
 *
 * @returns The running app and server.
 */
async function serveEditor(): Promise<Running> {
  const app = framework.createApp({
    pluginConfigs: { files: { root: base }, hub: { callTimeoutMs: 400 } }
  });
  await app.start();
  const server = Bun.serve(
    app.hub.serve({
      port: 0,
      routes: { "/": new Response("game page") },
      fetch: () => new Response("asset")
    })
  );
  const port = server.port ?? 0;
  running = { app, server, port, token: app.hub.token() };
  return running;
}

/**
 * Connects a client and remembers it for cleanup.
 *
 * @param kind - Connection kind.
 * @returns The client.
 */
async function tools(kind: "tools" | "agent" = "tools"): Promise<Client> {
  if (running === undefined) throw new Error("not running");
  const client = await connectClient(running.port, { token: running.token, kind });
  clients.push(client);
  return client;
}

/**
 * Connects a fake agent and remembers it for cleanup.
 *
 * @returns The agent and its session id.
 */
async function agent(): Promise<{ agent: Client; session: string }> {
  if (running === undefined) throw new Error("not running");
  const connected = await connectAgent(running.port, running.token);
  clients.push(connected.agent);
  return connected;
}

/** Requests the fake agent already answered. */
const answered = new WeakSet<object>();

/**
 * Answers every request of a method the agent receives with a result.
 *
 * @param client - The agent.
 * @param method - The method.
 * @param answer - Builds the result.
 */
function serveRequests(
  client: Client,
  method: string,
  answer: (params: ReturnType<typeof paramsOf>) => Parameters<typeof success>[1]
): void {
  client.socket.addEventListener("message", () => {
    const pending = client.messages.filter(isRequestOf(method));
    const last = pending.at(-1);
    if (last !== undefined && !answered.has(last)) {
      answered.add(last);
      client.send(success(last.id, answer(paramsOf(last))));
    }
  });
}

beforeEach(async () => {
  seen.length = 0;
  base = await mkdtemp(join(tmpdir(), "moku-hub-"));
  await mkdir(join(base, "src"), { recursive: true });
  await writeFile(join(base, "src/a.ts"), "export const a = 1;\n");
});

afterEach(async () => {
  const open = clients.splice(0);
  if (running !== undefined) {
    const { app, server } = running;
    await shutdown(open, () => app.stop(), server);
    running = undefined;
  }
  await rm(base, { recursive: true, force: true });
});

describe("hub over real websockets", () => {
  it("tells a new agent its session and tools the session list", async () => {
    await serveEditor();
    const page = await tools();
    await page.next(isNote("editor", "sessions"));

    const { agent: game, session } = await agent();

    const note = game.messages.find(isNote("editor", "session"));
    expect(paramsOf(note)).toEqual({ id: session, game: AGENT_MANIFEST.game, open: true });
    await page.next(
      message => isNote("editor", "sessions")(message) && JSON.stringify(message).includes(session)
    );
    expect(paramsOf(await page.next(isNote("editor", "session")))).toEqual({
      id: session,
      game: AGENT_MANIFEST.game,
      open: true
    });
    expect(running?.app.hub.sessions().map(info => info.id)).toEqual([session]);
    expect(seen).toEqual([{ id: session, game: AGENT_MANIFEST.game, open: true }]);
  });

  it("forwards a tools read to the agent and answers it", async () => {
    await serveEditor();
    const { agent: game } = await agent();
    serveRequests(game, "read", () => ({ path: "board/awaitIntent", frame: 12 }));
    const page = await tools();

    page.send(request(7, "game", "read", { id: "game.position" }));

    expect(await page.next(isResponseTo(7))).toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: { path: "board/awaitIntent", frame: 12 }
    });
  });

  it("fans one agent watch out to two tools pages", async () => {
    await serveEditor();
    const { agent: game, session } = await agent();
    const first = await tools();
    const second = await tools();

    first.send(request(1, "game", "watch", { sub: 4, id: "game.history", input: { last: 2 } }));
    second.send(request(1, "game", "watch", { sub: 9, id: "game.history", input: { last: 2 } }));
    const watch = await nextRequest(game, "watch");
    const agentSub = paramsOf(watch)?.sub ?? 0;
    game.send(success(watch.id, null)); // eslint-disable-line unicorn/no-null -- JSON null result
    game.send({
      jsonrpc: "2.0",
      channel: "game",
      method: "value",
      params: { sub: agentSub, value: ["x"] }
    });

    await first.next(isResponseTo(1));
    await second.next(isResponseTo(1));
    expect(paramsOf(await first.next(isNote("game", "value")))).toEqual({ sub: 4, value: ["x"] });
    const value = await second.next(isNote("game", "value"));
    expect(paramsOf(value)).toEqual({ sub: 9, value: ["x"] });
    expect("session" in value ? value.session : undefined).toBe(session);
    expect(game.messages.filter(isRequestOf("watch"))).toHaveLength(1);
  });

  it("forwards a heartbeat with its heap and a tap of the agent to a tools page", async () => {
    await serveEditor();
    const { agent: game, session } = await agent();
    const page = await tools();
    const heap = { usedMb: 12.8, limitMb: 4095.8 };

    game.send(notification("game", "heartbeat", { frame: 12, paused: false, at: 5, heap }));
    game.send(notification("game", "tap", { x: 206, y: 640, at: 15_234.5 }));

    const beat = await page.next(isNote("game", "heartbeat"));
    expect(paramsOf(beat)).toEqual({ frame: 12, paused: false, at: 5, heap });
    const tap = await page.next(isNote("game", "tap"));
    expect(paramsOf(tap)).toEqual({ x: 206, y: 640, at: 15_234.5 });
    expect("session" in tap ? tap.session : undefined).toBe(session);
  });

  it("fails a call in flight -32001 when the game reloads, and tells tools", async () => {
    await serveEditor();
    const { agent: game, session } = await agent();
    const page = await tools();
    page.send(request(3, "game", "run", { id: "game.step", input: { frames: 1 } }));
    await nextRequest(game, "run");

    game.close();

    expect(await page.next(isResponseTo(3))).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: {
        code: -32_001,
        message: "[moku-editor] game reloaded",
        data: { retryable: true, reason: "game_reloaded" }
      }
    });
    const closed = await page.next(
      message => isNote("editor", "session")(message) && paramsOf(message)?.open === false
    );
    expect(paramsOf(closed)).toEqual({
      id: session,
      game: AGENT_MANIFEST.game,
      open: false,
      reason: "game_reloaded"
    });
    await expect.poll(() => seen.length).toBe(2);
    expect(seen[1]).toEqual({
      id: session,
      game: AGENT_MANIFEST.game,
      open: false,
      reason: "game_reloaded"
    });
  });

  it("times out a call the agent never answers with -32002", async () => {
    await serveEditor();
    await agent();
    const page = await tools();

    page.send(request(5, "game", "read", { id: "game.position" }));

    const response = await page.next(isResponseTo(5));
    expect("error" in response ? response.error : undefined).toEqual({
      code: -32_002,
      message: "[moku-editor] call timed out",
      data: { retryable: true, reason: "timeout" }
    });
  });

  it("passes an agent error through without a stack (H39)", async () => {
    await serveEditor();
    const { agent: game } = await agent();
    const page = await tools();
    page.send(request(6, "game", "run", { id: "game.step", input: { frames: 1 } }));
    const run = await nextRequest(game, "run");

    game.send(
      JSON.stringify({
        ...failure(run.id, { code: -32_000, message: "[moku-editor] boom" }),
        stack: "Error: x\n at y"
      })
    );

    const response = await page.next(isResponseTo(6));
    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 6,
      error: { code: -32_000, message: "[moku-editor] boom" }
    });
  });

  it("writes and reads text and images through the files channel", async () => {
    await serveEditor();
    const page = await tools();

    page.send(request(1, "files", "write", { path: "src/b.ts", text: "export const b = 2;\n" }));
    const written = await page.next(isResponseTo(1));
    expect(written).toMatchObject({ result: { path: "src/b.ts", bytes: 20 } });
    page.send(request(2, "files", "read", { path: "src/b.ts" }));
    expect(await page.next(isResponseTo(2))).toMatchObject({
      result: { text: "export const b = 2;\n" }
    });
    expect(await readFile(join(base, "src/b.ts"), "utf8")).toBe("export const b = 2;\n");

    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    page.send(request(3, "files", "writeBinary", { path: ".moku/captures/a.png", data: png }));
    expect(await page.next(isResponseTo(3))).toMatchObject({
      result: { path: ".moku/captures/a.png" }
    });
    page.send(request(4, "files", "readBinary", { path: ".moku/captures/a.png" }));
    expect(await page.next(isResponseTo(4))).toMatchObject({ result: { dataUrl: png } });

    page.send(request(5, "files", "list", { dir: "src" }));
    const listed = await page.next(isResponseTo(5));
    expect(JSON.stringify(listed)).toContain("src/b.ts");
  });

  it("closes every socket with 1001 on stop and refuses new upgrades with 503", async () => {
    const { app, port, token } = await serveEditor();
    const { agent: game } = await agent();
    const page = await tools();

    await app.stop();

    // The hub closes with 1001; Bun 1.3.14's client reports it as 1000 (runtime rewrite).
    const [pageClosed, gameClosed] = await Promise.all([page.closed, game.closed]);
    expect([1000, 1001]).toContain(pageClosed.code);
    expect([1000, 1001]).toContain(gameClosed.code);
    await expect(connectClient(port, { token, kind: "tools" })).rejects.toThrow();
    expect(() => app.hub.token()).toThrow(/^\[moku-editor] /);
  });
});

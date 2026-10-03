/* eslint-disable unicorn/no-null -- null is the JSON value the wire carries */
import { defineCommand } from "@moku-labs/game/control";
import { defineSource } from "@moku-labs/game/inspect";
import { createHeadless } from "@moku-labs/game/testing";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { loadMergeGame } from "../../../../../tests/fixtures/merge-game";
import type { AgentEvents } from "../../../../config";
import { agentCoreConfig, createAgentCore, createAgentPlugin } from "../../../../config";
import { channelPlugin } from "../../../channel";
import { registryPlugin } from "../../../registry";
import type {
  Json,
  LinkStatus,
  Message,
  Notification,
  Response as RpcResponse
} from "../../../registry/protocol";
import {
  decode,
  encode,
  isNotification,
  isResponse,
  notification,
  request
} from "../../../registry/protocol";
import type { DevModule, GameLike } from "../../../registry/types";
import { bridgePlugin } from "../..";
import type { BridgeApi } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// The agent core (registry + channel + bridge) over the headless merge game,
// linked to a minimal hub: a real Bun.serve with the hello route and the
// websocket upgrade (token, kind=agent and an Origin header required).
// ─────────────────────────────────────────────────────────────────────────────

const framework = createAgentCore(agentCoreConfig, {
  plugins: [registryPlugin, channelPlugin, bridgePlugin]
});

/** The server side of one agent socket. */
type Connection = {
  readonly socket: { send(text: string): unknown; close(code?: number, reason?: string): void };
  readonly messages: Message[];
  closed: { code: number; reason: string } | undefined;
};

/** The minimal hub of the test. */
type Hub = {
  readonly port: number;
  /** "404" makes the hello route answer 404. */
  mode: "ok" | "404";
  hellos: number;
  readonly origins: (string | null)[];
  readonly connections: Connection[];
  stop(): Promise<void>;
};

/** A started headless merge game. */
type StartedGame = { readonly app: GameLike; stop(): Promise<void> };

let game: StartedGame;
let hub: Hub;
let count = 0;
let nextId = 100;
const statuses: AgentEvents["bridge:status"][] = [];
const running: { stop(): Promise<void> }[] = [];

/** A .dev module of the test: a frame source, a bump command and a command that never answers. */
const testModule: DevModule = {
  sources: [
    defineSource({
      id: "test.count",
      title: "Count",
      input: {},
      changes: "frame",
      read: () => count
    })
  ],
  commands: [
    defineCommand({
      id: "test.bump",
      title: "Bump",
      input: {},
      effect: "cosmetic",
      run: () => {
        count += 1;
        return count;
      }
    }),
    defineCommand({
      id: "test.hang",
      title: "Hang",
      input: {},
      effect: "cosmetic",
      run: () => new Promise<number>(() => {})
    })
  ]
};

/** Records every bridge:status the agent core emits. */
const spyPlugin = createAgentPlugin("spy", {
  hooks: () => ({
    "bridge:status": payload => {
      statuses.push(payload);
    }
  })
});

/**
 * Starts the minimal hub on a random port.
 *
 * @returns The hub.
 */
function startHub(): Hub {
  const connections: Connection[] = [];
  const origins: (string | null)[] = [];
  const state = { mode: "ok" as "ok" | "404", hellos: 0 };
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/__editor/hello") {
        state.hellos += 1;
        if (state.mode === "404") return new Response("no editor", { status: 404 });
        return Response.json({ ws: "/__editor/ws", token: "t1" });
      }
      if (url.pathname === "/__editor/ws") {
        const origin = req.headers.get("origin");
        origins.push(origin);
        const allowed =
          url.searchParams.get("token") === "t1" &&
          url.searchParams.get("kind") === "agent" &&
          origin !== null;
        if (!allowed) return new Response("forbidden", { status: 403 });
        return srv.upgrade(req) ? undefined : new Response("no upgrade", { status: 400 });
      }
      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        connections.push({ socket: ws, messages: [], closed: undefined });
      },
      message(ws, data) {
        const connection = connections.find(entry => entry.socket === ws);
        if (connection === undefined) return;
        const message = decode(typeof data === "string" ? data : data.toString());
        connection.messages.push(message);
        if (
          connection.messages.length === 1 &&
          isNotification(message) &&
          message.method === "hello"
        ) {
          ws.send(
            encode(
              notification("editor", "session", { id: "s-test", game: "merge-game", open: true })
            )
          );
        }
      },
      close(ws, code, reason) {
        const connection = connections.find(entry => entry.socket === ws);
        if (connection !== undefined) connection.closed = { code, reason };
      }
    }
  });
  const port = server.port ?? 0;

  return {
    port,
    get mode() {
      return state.mode;
    },
    set mode(mode) {
      state.mode = mode;
    },
    get hellos() {
      return state.hellos;
    },
    set hellos(value) {
      state.hellos = value;
    },
    origins,
    connections,
    // Bun 1.3.14: after a server-side ws.close(), server.stop(true) never settles. Bounded wait.
    stop: () => Promise.race([server.stop(true), sleep(100)])
  };
}

/**
 * Polls until `probe` returns a value other than undefined.
 *
 * @param probe - What to wait for.
 * @param timeoutMs - How long to wait.
 * @returns The value.
 */
async function waitFor<T>(probe: () => T | undefined, timeoutMs = 3000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error("waitFor timed out");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

/**
 * A member of a JSON object, or undefined.
 *
 * @param value - A JSON value.
 * @param key - The member name.
 * @returns The member.
 */
function field(value: Json | undefined, key: string): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value[key]
    : undefined;
}

/**
 * A JSON array, or an empty list.
 *
 * @param value - A JSON value.
 * @returns The items.
 */
function listOf(value: Json | undefined): Json[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Sleeps.
 *
 * @param ms - Milliseconds.
 */
async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sends a game request to the agent and waits for its response.
 *
 * @param connection - The agent socket.
 * @param method - The method.
 * @param params - The params.
 * @returns The response.
 */
async function call(connection: Connection, method: string, params?: Json): Promise<RpcResponse> {
  nextId += 1;
  const id = nextId;
  connection.socket.send(encode(request(id, "game", method, params)));
  return waitFor(() =>
    connection.messages.find(
      (message): message is RpcResponse => isResponse(message) && message.id === id
    )
  );
}

/**
 * The game notifications of a method on a connection.
 *
 * @param connection - The agent socket.
 * @param method - The method.
 * @returns The notifications.
 */
function notes(connection: Connection, method: string): Notification[] {
  return connection.messages.filter(
    (message): message is Notification => isNotification(message) && message.method === method
  );
}

/**
 * The value notifications of one sub.
 *
 * @param connection - The agent socket.
 * @param sub - The sub id.
 * @returns Their values.
 */
function valuesOf(connection: Connection, sub: number): Json[] {
  return notes(connection, "value").flatMap(message => {
    const value = field(message.params, "value");
    return field(message.params, "sub") === sub && value !== undefined ? [value] : [];
  });
}

/**
 * Creates and starts the agent app linked to the hub.
 *
 * @returns The app.
 */
async function startAgent() {
  const app = framework.createApp({
    plugins: [spyPlugin],
    pluginConfigs: {
      registry: { game: game.app, modules: [testModule], name: "merge-game 0.0.0" },
      channel: { heartbeatMs: 100 },
      bridge: {
        hello: `http://127.0.0.1:${String(hub.port)}/__editor/hello`,
        retryMs: 100,
        callTimeoutMs: 200
      }
    }
  });
  await app.start();
  let stopped = false;
  running.push({
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await app.stop();
    }
  });
  return {
    app,
    stop: async () => {
      stopped = true;
      await app.stop();
    }
  };
}

/**
 * Starts the agent and waits for the first connection and its session.
 *
 * @returns The app and the hub side of its socket.
 */
async function linked() {
  const agent = await startAgent();
  const connection = await waitFor(() => hub.connections[0]);
  await waitFor(() => agent.app.bridge.session());
  return { ...agent, connection };
}

beforeEach(async () => {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  const { createGame } = await loadMergeGame();
  const { app } = createGame();
  const headless = await createHeadless(app);
  game = { app, stop: () => headless.stop() };
  hub = startHub();
  count = 0;
  statuses.length = 0;
});

afterEach(async () => {
  for (const agent of running.splice(0)) await agent.stop();
  await hub.stop();
  await game.stop();
  vi.unstubAllGlobals();
});

describe("bridge integration", () => {
  it("start resolves at once; hello first, then heartbeats; connecting → live; session", async () => {
    const { app } = await startAgent();

    expect(app.bridge.status()).toEqual({ kind: "connecting" });

    const connection = await waitFor(() => hub.connections[0]);
    await waitFor(() => (notes(connection, "heartbeat").length >= 2 ? true : undefined));
    await waitFor(() => app.bridge.session());

    const [hello] = connection.messages;
    expect(hello).toMatchObject({ jsonrpc: "2.0", channel: "game", method: "hello" });
    const manifest = field(
      hello !== undefined && isNotification(hello) ? hello.params : undefined,
      "manifest"
    );
    const sources = listOf(field(manifest, "sources"));
    expect(sources).toHaveLength(16);
    expect(sources.filter(source => String(field(source, "id")).startsWith("game."))).toHaveLength(
      15
    );
    expect(listOf(field(manifest, "commands"))).toHaveLength(16);
    expect(field(manifest, "game")).toBe("merge-game 0.0.0");
    expect(hub.origins).toEqual([`http://127.0.0.1:${String(hub.port)}`]);

    expect(app.bridge.session()).toBe("s-test");
    expect(app.bridge.status()).toMatchObject({ kind: "live" });
    expect(statuses.map(payload => payload.status.kind)).toEqual(["connecting", "live", "live"]);
    expect(statuses.at(-1)).toEqual({
      status: { kind: "live", frame: game.app.time.snapshot().frame },
      session: "s-test"
    });
  });

  it("answers read, and watch with null then a value", async () => {
    const { app, connection } = await linked();

    const read = await call(connection, "read", { id: "game.position" });
    expect(read).toEqual({
      jsonrpc: "2.0",
      id: nextId,
      result: app.registry.source("game.position")?.read(null)
    });

    const watched = await call(connection, "watch", { sub: 1, id: "game.position" });
    expect(watched).toMatchObject({ result: null });
    const [value] = await waitFor(() => {
      const values = valuesOf(connection, 1);
      return values.length > 0 ? values : undefined;
    });

    expect(value).toEqual(app.registry.source("game.position")?.read(null));
    expect(connection.messages.indexOf(watched)).toBeLessThan(
      connection.messages.findIndex(
        message => isNotification(message) && message.method === "value"
      )
    );
  });

  it("runs game.step and answers its RunResult", async () => {
    const { app, connection } = await linked();
    const before = app.registry.clock().frame;

    const ran = await call(connection, "run", { id: "game.step", input: { frames: 1 } });

    // The headless game has not ticked yet: one 1000/60 ms step is the whole elapsed time.
    expect(before).toBe(0);
    expect(ran).toEqual({
      jsonrpc: "2.0",
      id: nextId,
      result: {
        value: { delta: 1000 / 60, elapsed: 1000 / 60, scale: 1, frame: 1, idle: false },
        state: { path: app.registry.envelope().path, frame: 1, tainted: false }
      }
    });
  });

  it("re-reads a watched frame source after a run, before the next tick, without duplicates", async () => {
    const { connection } = await linked();

    await call(connection, "watch", { sub: 2, id: "test.count" });
    await waitFor(() => (valuesOf(connection, 2).length > 0 ? true : undefined));
    expect(valuesOf(connection, 2)).toEqual([0]);

    const ran = await call(connection, "run", { id: "test.bump" });
    expect(ran).toMatchObject({ result: { value: 1 } });
    await waitFor(() => (valuesOf(connection, 2).length > 1 ? true : undefined));

    const ranAt = connection.messages.indexOf(ran);
    const between = connection.messages.slice(ranAt + 1);
    const firstValue = between.findIndex(
      message => isNotification(message) && message.method === "value"
    );
    expect(
      between
        .slice(0, firstValue)
        .some(message => isNotification(message) && message.method === "heartbeat")
    ).toBe(false);

    const beats = notes(connection, "heartbeat").length;
    await waitFor(() => (notes(connection, "heartbeat").length >= beats + 3 ? true : undefined));
    expect(valuesOf(connection, 2)).toEqual([0, 1]);
  });

  it("rejects bad command input with -32602 and a hung command with -32002 after the deadline", async () => {
    const { connection } = await linked();

    const invalid = await call(connection, "run", { id: "game.step", input: { frames: "1" } });
    expect(invalid).toMatchObject({
      error: { code: -32_602, data: { field: "frames", reason: "invalid_input" } }
    });

    const started = Date.now();
    const hung = await call(connection, "run", { id: "test.hang" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(180);
    expect(hung).toMatchObject({
      error: {
        code: -32_002,
        message: "[moku-editor] test.hang: no answer after 200 ms",
        data: { reason: "timeout", retryable: true, id: "test.hang" }
      }
    });
  });

  it("reconnects after the hub closes the socket: lost, a new hello fetch, a new hello", async () => {
    const { connection } = await linked();
    await call(connection, "watch", { sub: 1, id: "game.position" });

    connection.socket.close(1001, "editor stopping");

    const lost = await waitFor(() => statuses.find(payload => payload.status.kind === "lost"));
    // Bun's client reports the code the server closed with as 1000 or 1001; the reason is kept.
    expect(lost.status).toMatchObject({
      reason: expect.stringMatching(/^socket closed \(100[01]\): editor stopping$/)
    });
    const retryInMs = lost.status.kind === "lost" ? lost.status.retryInMs : -1;
    expect(retryInMs).toBeGreaterThanOrEqual(80);
    expect(retryInMs).toBeLessThanOrEqual(120);
    expect(lost.session).toBeUndefined();

    const second = await waitFor(() => hub.connections[1]);
    await waitFor(() => (notes(second, "heartbeat").length >= 3 ? true : undefined));

    expect(hub.hellos).toBe(2);
    expect(second.messages[0]).toMatchObject({ channel: "game", method: "hello" });
    expect(notes(second, "value")).toEqual([]);
  });

  it("keeps retrying while the hello answers 404; start still resolves", async () => {
    hub.mode = "404";

    const { app } = await startAgent();

    const lost = await waitFor(() => statuses.find(payload => payload.status.kind === "lost"));
    expect(lost.status).toMatchObject({ kind: "lost", reason: "hello 404" });
    await waitFor(() => (hub.hellos >= 3 ? true : undefined));
    expect(hub.connections).toEqual([]);
    expect(["connecting", "lost"]).toContain(app.bridge.status().kind);
  });

  it("says bye and closes 1000 on stop, and never reconnects", async () => {
    const { app, stop, connection } = await linked();

    await stop();
    const closed = await waitFor(() => connection.closed);

    expect(closed.code).toBe(1000);
    expect(connection.messages.at(-1)).toEqual(notification("game", "bye"));
    expect(app.bridge.status()).toMatchObject({ kind: "lost", reason: "stopped", retryInMs: 0 });
    expect(app.bridge.session()).toBeUndefined();

    const hellos = hub.hellos;
    await sleep(300);
    expect(hub.hellos).toBe(hellos);
    expect(hub.connections).toHaveLength(1);
  });

  it("rejects an invalid retryMs at createApp", () => {
    expect(() =>
      framework.createApp({
        pluginConfigs: { registry: { game: game.app }, bridge: { retryMs: 50 } }
      })
    ).toThrow("[moku-editor] bridge.retryMs must be a whole number of at least 100.");
  });
});

describe("bridge types", () => {
  it("app.bridge is { status(): LinkStatus; session(): string | undefined }", () => {
    const app = framework.createApp({ pluginConfigs: { registry: { game: game.app } } });

    expectTypeOf(app.bridge).toEqualTypeOf<BridgeApi>();
    expectTypeOf(app.bridge.status).returns.toEqualTypeOf<LinkStatus>();
    expectTypeOf(app.bridge.session).returns.toEqualTypeOf<string | undefined>();
    expect(app.bridge.status()).toEqual({ kind: "connecting" });
  });

  it("a hook on bridge:status receives { status: LinkStatus; session?: string }", () => {
    let hooked = false;
    const watcher = createAgentPlugin("watcher", {
      hooks: () => ({
        "bridge:status": payload => {
          expectTypeOf(payload).toEqualTypeOf<{ status: LinkStatus; session?: string }>();
          hooked = true;
        }
      })
    });
    const app = framework.createApp({
      plugins: [watcher],
      pluginConfigs: { registry: { game: game.app } }
    });

    expect(app.bridge.status()).toEqual({ kind: "connecting" });
    expect(hooked).toBe(false);
  });

  it("pluginConfigs.bridge.retryMs rejects a string", () => {
    expect(() =>
      framework.createApp({
        pluginConfigs: {
          registry: { game: game.app },
          // @ts-expect-error — retryMs is a number
          bridge: { retryMs: "1000" }
        }
      })
    ).toThrow("[moku-editor] bridge.retryMs");
  });
});

/* eslint-disable unicorn/no-null -- null is the JSON value the wire carries */
import { afterEach, describe, expect, it, vi } from "vitest";
import { wireError } from "../../../../registry/protocol";
import { connectHub } from "../../../mcp/hub-client";
import type { FakeHub } from "../../fake-hub";
import { FAKE_TOKEN, session, startFakeHub, until } from "../../fake-hub";

// ─────────────────────────────────────────────────────────────────────────────
// pages/mcp hub-client (M2, M4): the bridge is a hub tools client. It sends
// the Origin header, the token and kind=tools; it reads sessions with the
// heartbeat readout and keeps the live frame from forwarded heartbeats; it
// watches and unwatches; a closed socket fails its pending calls.
// ─────────────────────────────────────────────────────────────────────────────

let hub: FakeHub | undefined;

afterEach(async () => {
  await hub?.stop();
  hub = undefined;
});

/** Starts the fake hub of a test. */
function fake(options: Parameters<typeof startFakeHub>[0] = {}): FakeHub {
  hub = startFakeHub(options);
  return hub;
}

describe("connectHub", () => {
  it("upgrades with the Origin header and resolves on the first sessions list", async () => {
    const server = fake({ sessions: [session("s-1")], hotReload: { hmr: true, owner: "bin" } });
    const client = await connectHub(server.discovery("/root"));
    expect(server.origins).toEqual([server.url]);
    expect(client.sessions()).toEqual([session("s-1")]);
    await until(() => client.hotReload() !== undefined, "hotReload");
    expect(client.hotReload()).toEqual({ hmr: true, owner: "bin" });
    expect(client.isOpen()).toBe(true);
    client.close();
    expect(client.isOpen()).toBe(false);
  });

  it("rejects without leaking the token when the hub refuses the upgrade", async () => {
    const server = fake();
    const bad = { ...server.discovery("/root"), token: "wrong" };
    const failure = await connectHub(bad).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain(`could not connect to moku-editor at ${server.url}`);
    expect(String(failure)).not.toContain(FAKE_TOKEN);
  });

  it("rejects when no sessions list comes in time", async () => {
    const server = fake();
    const silentSocket = (): WebSocket =>
      new WebSocket(`${server.url.replace("http", "ws")}/nowhere`);
    await expect(
      connectHub(server.discovery("/root"), { openSocket: silentSocket, readyTimeoutMs: 50 })
    ).rejects.toThrow("could not connect");
  });
});

describe("requests", () => {
  it("sends game and files requests with the session and resolves their results", async () => {
    const server = fake({ sessions: [session("s-1")] });
    server.handle("game.read", params => ({ asked: params ?? null }));
    server.handle("files.list", () => []);
    const client = await connectHub(server.discovery("/root"));
    await expect(client.request("game", "read", { id: "game.position" }, "s-1")).resolves.toEqual({
      asked: { id: "game.position" }
    });
    await expect(client.request("files", "list", { dir: "" })).resolves.toEqual([]);
    expect(server.requests).toEqual([
      { channel: "game", method: "read", params: { id: "game.position" }, session: "s-1" },
      { channel: "files", method: "list", params: { dir: "" }, session: undefined }
    ]);
    client.close();
  });

  it("rejects with the hub's wire error", async () => {
    const server = fake({ sessions: [session("s-1")] });
    server.handle("game.read", () => {
      throw wireError(-32_601, "unknown source x", { reason: "unknown_id", id: "x" });
    });
    const client = await connectHub(server.discovery("/root"));
    await expect(client.request("game", "read", { id: "x" })).rejects.toMatchObject({
      code: -32_601,
      message: "[moku-editor] unknown source x",
      data: { reason: "unknown_id", id: "x" }
    });
    client.close();
  });

  it("fails pending calls with link_closed when the socket closes, and calls onClose once", async () => {
    const server = fake({ sessions: [session("s-1")] });
    server.handle("game.run", () => new Promise(() => {}));
    const onClose = vi.fn();
    const client = await connectHub(server.discovery("/root"), { onClose });
    const pending = client.request("game", "run", { id: "game.step" });
    server.dropClients();
    await expect(pending).rejects.toMatchObject({ data: { reason: "link_closed" } });
    await until(() => onClose.mock.calls.length === 1, "onClose");
    expect(client.isOpen()).toBe(false);
    await expect(client.request("game", "read", { id: "x" })).rejects.toMatchObject({
      data: { reason: "link_closed" }
    });
  });

  it("does not call onClose when the bridge closes the socket itself", async () => {
    const server = fake({ sessions: [] });
    const onClose = vi.fn();
    const client = await connectHub(server.discovery("/root"), { onClose });
    client.close();
    await Bun.sleep(30);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("times out a request the hub never answers", async () => {
    const server = fake({ sessions: [] });
    server.handle("files.read", () => new Promise(() => {}));
    const client = await connectHub(server.discovery("/root"), { requestTimeoutMs: 30 });
    await expect(client.request("files", "read", { path: "a.md" })).rejects.toMatchObject({
      code: -32_002,
      data: { reason: "timeout" }
    });
    client.close();
  });
});

describe("sessions and liveness (M4)", () => {
  it("merges the hub readout with forwarded heartbeats and drops closed sessions", async () => {
    const server = fake({
      sessions: [session("s-1", { heartbeat: { frame: 10, paused: false, silent: false } })]
    });
    const client = await connectHub(server.discovery("/root"));
    expect(client.sessions()[0]?.heartbeat).toEqual({ frame: 10, paused: false, silent: false });

    server.notify("game", "heartbeat", { frame: 42, paused: true, at: 1 }, "s-1");
    await until(() => client.sessions()[0]?.heartbeat?.frame === 42, "the beat");
    expect(client.sessions()[0]?.heartbeat).toEqual({ frame: 42, paused: true, silent: false });

    const seen: string[][] = [];
    client.onSessions(list => seen.push(list.map(entry => entry.id)));
    server.setSessions([
      session("s-1", { heartbeat: { frame: 50, paused: false, silent: true } }),
      session("s-2")
    ]);
    await until(() => seen.length === 1, "the list");
    expect(client.sessions()).toEqual([
      { ...session("s-1"), heartbeat: { frame: 50, paused: false, silent: true } },
      session("s-2")
    ]);

    server.setSessions([session("s-2")]);
    await until(() => client.sessions().length === 1, "the close");
    server.notify("game", "heartbeat", { frame: "x" }, "s-2");
    server.notify("editor", "sessions", { nope: true });
    await Bun.sleep(20);
    expect(client.sessions()).toEqual([session("s-2")]);
    client.close();
  });
});

describe("watch", () => {
  it("delivers values of its sub and unwatches once on stop", async () => {
    const server = fake({ sessions: [session("s-1")] });
    const client = await connectHub(server.discovery("/root"));
    const values: unknown[] = [];
    const stop = await client.watch(
      { id: "game.history", input: { last: 1 }, session: "s-1" },
      value => values.push(value)
    );
    expect(server.requests[0]).toEqual({
      channel: "game",
      method: "watch",
      params: { sub: 1, id: "game.history", input: { last: 1 } },
      session: "s-1"
    });
    server.value(1, "a");
    server.value(2, "other sub");
    await until(() => values.length === 1, "the value");
    stop();
    stop();
    await until(() => server.watched().length === 0, "the unwatch");
    expect(server.requests.filter(entry => entry.method === "unwatch")).toHaveLength(1);
    expect(values).toEqual(["a"]);
    client.close();
  });

  it("rejects a refused watch and keeps no handler", async () => {
    const server = fake({ sessions: [session("s-1")] });
    server.handle("game.watch", () => {
      throw wireError(-32_003, "several games are connected; choose a session", {
        reason: "choose_session"
      });
    });
    const client = await connectHub(server.discovery("/root"));
    await expect(
      client.watch({ id: "game.position", input: undefined, session: undefined }, () => null)
    ).rejects.toMatchObject({ data: { reason: "choose_session" } });
    expect(server.requests[0]?.params).toEqual({ sub: 1, id: "game.position" });
    client.close();
  });
});

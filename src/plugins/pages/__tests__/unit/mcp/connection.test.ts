import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { createBrandConsole } from "@moku-labs/common/cli";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeDiscovery } from "../../../discovery";
import type { ConnectHub } from "../../../mcp/connection";
import { createEditorLink, NOT_RUNNING, RECONNECT_WAITS_MS } from "../../../mcp/connection";
import type { HubClientOptions } from "../../../mcp/hub-client";
import type { ChildProcess, HubClient, SpawnProcess } from "../../../mcp/types";
import type { EditorDiscovery, McpArgs } from "../../../types";
import type { FakeHub } from "../../fake-hub";
import { session, startFakeHub, until } from "../../fake-hub";

// ─────────────────────────────────────────────────────────────────────────────
// pages/mcp connection (M3): a live discovery file wins; without one the
// bridge starts the bin when it knows the html; a closed socket reconnects at
// the close and, while the bin lives, 1, 3 and 7 s after it (the bin's restart,
// D-57); the bridge stops only the bin it started.
// ─────────────────────────────────────────────────────────────────────────────

let root: string;
let hub: FakeHub;
const children: { child: ChildProcess; signals: string[] }[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "moku-mcp-link-"));
  hub = startFakeHub({ sessions: [session("s-1")] });
  children.length = 0;
});

afterEach(async () => {
  vi.useRealTimers();
  await hub.stop();
  await rm(root, { recursive: true, force: true });
});

/** A fake child that exits on any signal. */
function fakeChild(pid: number) {
  const { promise: exited, resolve: exit } = Promise.withResolvers<number>();
  const signals: string[] = [];
  const child: ChildProcess = {
    pid,
    exited,
    kill: name => {
      signals.push(name);
      exit(0);
    },
    unref: vi.fn()
  };
  children.push({ child, signals });
  return child;
}

/**
 * The bin side over the temp root and the fake hub. The fake spawn "starts" a bin: it writes the
 * fake hub's discovery file with the child's pid.
 *
 * @param args - The mcp arguments (root is the temp root).
 * @param startBin - Whether the spawned child writes its discovery file.
 * @param connect - The hub connection factory, when a test scripts it (default: the real one).
 */
function link(args: Partial<McpArgs> = {}, startBin = true, connect?: ConnectHub) {
  const lines: string[] = [];
  const ui = createBrandConsole({
    write: line => lines.push(line),
    writeError: line => lines.push(line),
    color: false
  });
  const alive = new Set([process.pid]);
  const spawn = vi.fn<SpawnProcess>(() => {
    const pid = 7000 + children.length;
    alive.add(pid);
    if (startBin) setTimeout(() => writeDiscovery(root, hub.discovery(root, pid)), 20);
    return fakeChild(pid);
  });
  const onConnected = vi.fn<(client: HubClient) => void>();
  const onDisconnected = vi.fn();
  const editor = createEditorLink({
    root,
    args: { kind: "mcp", root, hmr: true, ...args },
    deps: { ui, spawn, isAlive: pid => alive.has(pid), command: ["bun", "bin.mjs"], now: Date.now },
    onConnected,
    onDisconnected,
    ...(connect === undefined ? {} : { connect })
  });
  return { editor, lines, spawn, onConnected, onDisconnected, alive };
}

describe("startup", () => {
  it("connects to a live bin and does not own it", async () => {
    writeDiscovery(root, hub.discovery(root));
    const { editor, spawn, lines } = link();
    await editor.start();
    const client = await editor.hub();
    expect(client.sessions()).toEqual([session("s-1")]);
    expect(editor.status()).toEqual({ running: true, owned: false, bin: hub.discovery(root) });
    expect(editor.connected()).toBe(client);
    expect(spawn).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain(`connected to ${hub.url}`);
    await editor.shutdown();
    expect(editor.connected()).toBeUndefined();
  });

  it("prints one line when --port differs from the running bin", async () => {
    writeDiscovery(root, hub.discovery(root));
    const { editor, lines } = link({ port: 1 });
    await editor.start();
    expect(
      lines.filter(line => line.includes("only applies when the bridge starts it"))
    ).toHaveLength(1);
    await editor.shutdown();
  });

  it("waits for moku_start without a bin and without an html", async () => {
    const { editor, spawn, lines } = link();
    await editor.start();
    await expect(editor.hub()).rejects.toThrow(NOT_RUNNING);
    expect(spawn).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("waiting for moku_start");
    expect(editor.status()).toEqual({ running: false, owned: false, bin: undefined });
  });

  it("starts the bin from the argv html, owns it and stops it on shutdown", async () => {
    const { editor, spawn } = link({ html: "web/index.html", port: 4555 });
    await editor.start();
    const [cmd] = spawn.mock.calls[0] ?? [];
    expect(cmd).toEqual([
      "bun",
      "bin.mjs",
      expect.stringMatching(/\/web\/index\.html$/),
      "--port",
      "4555",
      "--root",
      root
    ]);
    expect(editor.status()).toMatchObject({ running: true, owned: true });
    await editor.shutdown();
    expect(children[0]?.signals).toEqual(["SIGTERM"]);
  });

  it("starts the bin from a stale discovery file: its html and port", async () => {
    writeDiscovery(root, { ...hub.discovery(root, 99_999), port: 4777 });
    const { editor, spawn } = link();
    await editor.start();
    const [cmd] = spawn.mock.calls[0] ?? [];
    expect(cmd).toEqual([
      "bun",
      "bin.mjs",
      `${root}/web/index.html`,
      "--port",
      "4777",
      "--root",
      root
    ]);
    await editor.shutdown();
  });

  it("remembers a failed start for the not-running answer", async () => {
    const { editor } = link({ html: "web/index.html" }, false);
    const started = editor.start();
    await Bun.sleep(30);
    children[0]?.child.kill("SIGTERM");
    await started;
    await expect(editor.hub()).rejects.toThrow("Last attempt: [moku-editor] moku-editor exited");
  });
});

describe("reconnect", () => {
  it("reconnects to the same bin at the close, and reports the close and each connect", async () => {
    writeDiscovery(root, hub.discovery(root));
    const { editor, onConnected, onDisconnected } = link();
    await editor.start();
    const first = await editor.hub();
    expect(onConnected.mock.calls).toEqual([[first]]);
    hub.dropClients();
    await until(() => !first.isOpen(), "the close");
    const second = await editor.hub();
    expect(second).not.toBe(first);
    expect(second.isOpen()).toBe(true);
    expect(onDisconnected).toHaveBeenCalledOnce();
    expect(onConnected.mock.calls).toEqual([[first], [second]]);
    await editor.shutdown();
    expect(onDisconnected).toHaveBeenCalledTimes(2);
  });

  it("reports nothing on shutdown when no connection is open", async () => {
    const { editor, onConnected, onDisconnected } = link();
    await editor.start();
    await editor.shutdown();
    expect(onConnected).not.toHaveBeenCalled();
    expect(onDisconnected).not.toHaveBeenCalled();
  });

  it("answers not running when the bin is gone after the close", async () => {
    writeDiscovery(root, hub.discovery(root, 4242));
    const { editor, alive } = link();
    alive.add(4242);
    await editor.start();
    const first = await editor.hub();
    alive.delete(4242);
    hub.dropClients();
    await until(() => !first.isOpen(), "the close");
    await expect(editor.hub()).rejects.toThrow(NOT_RUNNING);
  });
});

/** What a scripted connect answers when the port is closed. */
const REFUSED = "[moku-editor] could not connect to moku-editor: the socket closed.";

/** One step of a scripted connect: an open client, a closed port, or a promise the test settles. */
type Step = "open" | "refuse" | Promise<void>;

/** Removes a sessions listener of a hand client: it keeps none. */
function removeNothing(): void {
  // A hand client never sends a sessions list.
}

/**
 * A hub client the test drops by hand.
 *
 * @param bin - The bin it talks to.
 * @param options - The options of the connect: `onClose` is the bridge's.
 */
function handClient(bin: EditorDiscovery, options: HubClientOptions) {
  let open = true;
  const close = vi.fn(() => {
    open = false;
  });
  const client: HubClient = {
    bin,
    request: () => Promise.reject(new Error("[moku-editor] no hub.")),
    watch: () => Promise.resolve(() => undefined),
    sessions: () => [],
    hotReload: () => undefined,
    onSessions: () => removeNothing,
    isOpen: () => open,
    close
  };
  /** The hub closes the socket. */
  const drop = (): void => {
    open = false;
    options.onClose?.();
  };
  return { client, close, drop };
}

/**
 * The bin side over a connect the test scripts: each call takes the next step, and a closed port
 * once the steps ran out. No socket and no wait of real time: the tries run on fake time.
 *
 * @param steps - What each connect answers, in order.
 * @param args - The mcp arguments.
 */
function scripted(steps: Step[], args: Partial<McpArgs> = {}) {
  const made: ReturnType<typeof handClient>[] = [];
  const connect = vi.fn<ConnectHub>(async (bin, options = {}) => {
    const step = steps.shift() ?? "refuse";
    if (step === "refuse") throw new Error(REFUSED);
    const hand = handClient(bin, options);
    made.push(hand);
    if (step !== "open") await step;
    return hand.client;
  });
  return { ...link(args, true, connect), connect, made };
}

/** Lets the pending promise callbacks run (real setImmediate, also under fake timeouts). */
async function settle(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await new Promise<void>(resolve => {
      setImmediate(resolve);
    });
  }
}

describe("reconnect tries (the bin's restart, D-57)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  it("tries at the close, then 1, 2 and 4 s after each failed try, and stops: no timer is left", async () => {
    writeDiscovery(root, hub.discovery(root));
    const { editor, connect, made, onDisconnected, lines } = scripted(["open"]);
    await editor.start();

    made[0]?.drop();
    await settle();
    expect(connect).toHaveBeenCalledTimes(2);
    expect(RECONNECT_WAITS_MS).toEqual([1000, 2000, 4000]);
    for (const [index, wait] of RECONNECT_WAITS_MS.entries()) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(connect).toHaveBeenCalledTimes(index + 2);
      await vi.advanceTimersByTimeAsync(1);
      await settle();
      expect(connect).toHaveBeenCalledTimes(index + 3);
    }

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connect).toHaveBeenCalledTimes(5);
    expect(onDisconnected).toHaveBeenCalledOnce();
    expect(lines.filter(line => line.includes("the socket closed"))).toHaveLength(4);

    // A tool call still tries one connect, as before.
    await expect(editor.hub()).rejects.toThrow(REFUSED);
    expect(connect).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("connects on the try that finds the port open again, reports it and ends the tries", async () => {
    writeDiscovery(root, hub.discovery(root));
    const { editor, connect, made, onConnected } = scripted(["open", "refuse", "refuse", "open"]);
    await editor.start();

    made[0]?.drop();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(editor.connected()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2000);
    await settle();

    const back = made[1]?.client;
    expect(editor.connected()).toBe(back);
    expect(onConnected.mock.calls).toEqual([[made[0]?.client], [back]]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(editor.hub()).resolves.toBe(back);
    expect(connect).toHaveBeenCalledTimes(4);
  });

  it("starts over when a connection that just opened is dropped again (the old server took it)", async () => {
    writeDiscovery(root, hub.discovery(root));
    const { editor, connect, made, onDisconnected } = scripted(["open", "open", "refuse", "open"]);
    await editor.start();

    made[0]?.drop();
    await settle();
    expect(editor.connected()).toBe(made[1]?.client);
    made[1]?.drop();
    await settle();
    expect(connect).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(999);
    expect(connect).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    await settle();

    expect(editor.connected()).toBe(made[2]?.client);
    expect(onDisconnected).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends the tries when the bin is gone between two of them", async () => {
    writeDiscovery(root, hub.discovery(root, 4242));
    const { editor, connect, made, alive } = scripted(["open"]);
    alive.add(4242);
    await editor.start();

    made[0]?.drop();
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    alive.delete(4242);
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();

    expect(connect).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    await expect(editor.hub()).rejects.toThrow(NOT_RUNNING);
  });

  it("makes no try when the bin is gone at the close", async () => {
    writeDiscovery(root, hub.discovery(root, 4242));
    const { editor, connect, made, alive } = scripted(["open"]);
    alive.add(4242);
    await editor.start();

    alive.delete(4242);
    made[0]?.drop();
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(connect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends the tries when a tool call connects between two of them", async () => {
    writeDiscovery(root, hub.discovery(root));
    const { editor, connect, made } = scripted(["open", "refuse", "open"]);
    await editor.start();

    made[0]?.drop();
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    const client = await editor.hub();

    expect(client).toBe(made[1]?.client);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it("keeps the first connection when a tool call and a try connect at once, and closes the second", async () => {
    writeDiscovery(root, hub.discovery(root));
    const ofCall = Promise.withResolvers<void>();
    const ofTry = Promise.withResolvers<void>();
    const { editor, connect, made, onConnected } = scripted([
      "open",
      "refuse",
      ofCall.promise,
      ofTry.promise
    ]);
    await editor.start();

    // The tool call connects while the wait before the second try runs; the try starts next to it.
    made[0]?.drop();
    await settle();
    const call = editor.hub();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(connect).toHaveBeenCalledTimes(4);

    ofCall.resolve();
    await expect(call).resolves.toBe(made[1]?.client);
    ofTry.resolve();
    await settle();

    expect(made[2]?.close).toHaveBeenCalledOnce();
    expect(made[1]?.close).not.toHaveBeenCalled();
    expect(editor.connected()).toBe(made[1]?.client);
    expect(onConnected).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts no wait when a try fails after a tool call connected", async () => {
    writeDiscovery(root, hub.discovery(root));
    const ofCall = Promise.withResolvers<void>();
    const ofTry = Promise.withResolvers<void>();
    const { editor, made } = scripted(["open", "refuse", ofCall.promise, ofTry.promise]);
    await editor.start();

    made[0]?.drop();
    await settle();
    const call = editor.hub();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    ofCall.resolve();
    await call;
    ofTry.reject(new Error(REFUSED));
    await settle();

    expect(editor.connected()).toBe(made[1]?.client);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("runs one wait at most when the tries of two closes overlap, and shutdown ends it", async () => {
    writeDiscovery(root, hub.discovery(root));
    const ofCall = Promise.withResolvers<void>();
    const ofFirst = Promise.withResolvers<void>();
    const ofSecond = Promise.withResolvers<void>();
    const { editor, connect, made } = scripted([
      "open",
      "refuse",
      ofCall.promise,
      ofFirst.promise,
      ofSecond.promise
    ]);
    await editor.start();

    // The first close: a try of it is in flight next to a tool call's connect.
    made[0]?.drop();
    await settle();
    const call = editor.hub();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    // The tool call connects and that connection closes: the second close starts its own tries.
    ofCall.resolve();
    await call;
    made[1]?.drop();
    await settle();
    expect(connect).toHaveBeenCalledTimes(5);

    ofFirst.reject(new Error(REFUSED));
    await settle();
    ofSecond.reject(new Error(REFUSED));
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    await editor.shutdown();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends the tries on shutdown between two of them: no timer, no try after it", async () => {
    writeDiscovery(root, hub.discovery(root));
    const { editor, connect, made } = scripted(["open"]);
    await editor.start();

    made[0]?.drop();
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    await editor.shutdown();

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("starts no wait when a try fails while the bridge shuts down", async () => {
    writeDiscovery(root, hub.discovery(root));
    const port = Promise.withResolvers<void>();
    const { editor, connect, made } = scripted(["open", port.promise]);
    await editor.start();

    made[0]?.drop();
    await settle();
    const down = editor.shutdown();
    port.reject(new Error(REFUSED));
    await down;

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connect).toHaveBeenCalledTimes(2);
  });
});

describe("launch and stop", () => {
  it("does not start a second bin while one runs", async () => {
    writeDiscovery(root, hub.discovery(root));
    const { editor, spawn } = link({ html: "web/index.html" });
    await editor.start();
    await expect(editor.launch({ html: "other.html" })).resolves.toMatchObject({ running: true });
    expect(spawn).not.toHaveBeenCalled();
    await editor.shutdown();
  });

  it("refuses moku_start without any html", async () => {
    const { editor } = link();
    await editor.start();
    await expect(editor.launch({})).rejects.toThrow("moku_start needs the game HTML file");
  });

  it("starts the bin on launch with the asked html and port", async () => {
    const { editor, spawn } = link();
    await editor.start();
    await expect(editor.launch({ html: "g.html", port: 4999 })).resolves.toMatchObject({
      running: true,
      owned: true
    });
    expect(spawn.mock.calls[0]?.[0]).toContain("4999");
    await editor.shutdown();
  });

  it("leaves a bin it did not start running", async () => {
    writeDiscovery(root, hub.discovery(root));
    const notOwned = link();
    await notOwned.editor.start();
    await expect(notOwned.editor.stopOwned()).resolves.toMatchObject({ stopped: false });
    const client = await notOwned.editor.hub();
    expect(client.isOpen()).toBe(true);
    await notOwned.editor.shutdown();
    expect(children).toEqual([]);
  });

  it("stops the bin it started and closes the connection", async () => {
    const { editor, lines, onDisconnected } = link({ html: "web/index.html" });
    await editor.start();
    const client = await editor.hub();
    const stopped = await editor.stopOwned();
    expect(stopped.stopped).toBe(true);
    expect(client.isOpen()).toBe(false);
    expect(onDisconnected).toHaveBeenCalledOnce();
    expect(children[0]?.signals).toEqual(["SIGTERM"]);
    expect(lines.join("\n")).toContain("stopped moku-editor (pid 7000)");
  });

  it("ends the reconnect tries when it stops the bin it started", async () => {
    const { editor, connect, made } = scripted(["open"], { html: "web/index.html" });
    await editor.start();
    expect(editor.status()).toMatchObject({ running: true, owned: true });

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    made[0]?.drop();
    await settle();
    expect(connect).toHaveBeenCalledTimes(2);
    await expect(editor.stopOwned()).resolves.toMatchObject({ stopped: true });

    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("stops a bin whose start is in progress when stdin ends", async () => {
    const { editor } = link({ html: "web/index.html" }, false);
    const started = editor.start();
    await Bun.sleep(20);
    await editor.shutdown();
    await started;
    expect(children[0]?.signals).toEqual(["SIGTERM"]);
  });
});

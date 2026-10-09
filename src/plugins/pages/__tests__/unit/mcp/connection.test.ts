import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { createBrandConsole } from "@moku-labs/common/cli";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeDiscovery } from "../../../discovery";
import type { ConnectHub } from "../../../mcp/connection";
import {
  createEditorLink,
  NOT_RUNNING,
  RECONNECT_WAITS_MS,
  STABLE_MS
} from "../../../mcp/connection";
import type { HubClientOptions } from "../../../mcp/hub-client";
import type { ChildProcess, HubClient, SpawnProcess } from "../../../mcp/types";
import type { EditorDiscovery, McpArgs } from "../../../types";
import type { FakeHub } from "../../fake-hub";
import { session, startFakeHub, until } from "../../fake-hub";

// ─────────────────────────────────────────────────────────────────────────────
// pages/mcp connection (M3): a live discovery file wins; without one the
// bridge starts the bin when it knows the html; a closed socket reconnects at
// the close and, while the bin lives, 1, 3 and 7 s after it (the bin's restart,
// D-57, D-59); a connection dropped within 5 s counts as a failed try; the
// bridge stops only the bin it started.
// ─────────────────────────────────────────────────────────────────────────────

let root: string;
let hub: FakeHub;
const children: { child: ChildProcess; signals: string[] }[] = [];

/** The clock of the bin side, in ms: a test moves it by hand to let a connection grow old. */
let clock = 0;

/** How old a connection is when a test closes it without saying: a minute, so it held. */
const OLD_MS = 60_000;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "moku-mcp-link-"));
  hub = startFakeHub({ sessions: [session("s-1")] });
  children.length = 0;
  clock = 0;
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
 * The bin side over the temp root and the fake hub, on the clock of the test. The fake spawn
 * "starts" a bin: it writes the fake hub's discovery file with the child's pid.
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
    deps: {
      ui,
      spawn,
      isAlive: pid => alive.has(pid),
      command: ["bun", "bin.mjs"],
      now: () => clock
    },
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
    clock += OLD_MS;
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
    clock += OLD_MS;
    hub.dropClients();
    await until(() => !first.isOpen(), "the close");
    await expect(editor.hub()).rejects.toThrow(NOT_RUNNING);
  });
});

/** What a scripted connect answers when the port is closed. */
const REFUSED = "[moku-editor] could not connect to moku-editor: the socket closed.";

/** The stderr line of a close that starts the tries, of one without a bin and of an early one. */
const CLOSED = "  › moku-editor mcp: the moku-editor connection closed; reconnecting";
const CLOSED_NO_BIN =
  "  › moku-editor mcp: the moku-editor connection closed; no running moku-editor";
const CLOSED_EARLY = "  › moku-editor mcp: the moku-editor connection closed after less than 5 s";

/** The stderr line of a connect to the fake hub. */
function connectedLine(): string {
  return `  › moku-editor mcp: connected to ${hub.url}`;
}

/** What the bin side remembers of a connection the hub dropped within 5 s. */
function droppedEarly(): string {
  return `[moku-editor] moku-editor at ${hub.url} closed the connection after less than 5 s.`;
}

/**
 * The one warning of tries that ended without a connection.
 *
 * @param last - The last failure it carries.
 */
function gaveUp(last: string): string {
  return `  ⚠ [moku-editor] mcp: could not reconnect to moku-editor; the next tool call tries again.\n  Last attempt: ${last}`;
}

/** The warnings among stderr lines. */
function warningsOf(lines: readonly string[]): string[] {
  return lines.filter(line => line.includes("⚠"));
}

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
  /**
   * The hub closes the socket.
   *
   * @param after - How long the connection lived, in ms on the clock of the test (a minute: it
   *   held).
   */
  const drop = (after = OLD_MS): void => {
    clock += after;
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

describe("reconnect tries (the bin's restart, D-57, D-59)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  it("tries at the close, then 1, 2 and 4 s after each failed try, and stops with one warning: no timer is left", async () => {
    writeDiscovery(root, hub.discovery(root));
    const { editor, connect, made, onDisconnected, lines } = scripted(["open"]);
    await editor.start();
    const before = lines.length;

    made[0]?.drop();
    await settle();
    expect(connect).toHaveBeenCalledTimes(2);
    expect(RECONNECT_WAITS_MS).toEqual([1000, 2000, 4000]);
    for (const [index, wait] of RECONNECT_WAITS_MS.entries()) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(connect).toHaveBeenCalledTimes(index + 2);
      expect(warningsOf(lines)).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      await settle();
      expect(connect).toHaveBeenCalledTimes(index + 3);
    }

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connect).toHaveBeenCalledTimes(5);
    expect(onDisconnected).toHaveBeenCalledOnce();
    // A failed try prints nothing: the close, then the one warning with the last failure.
    expect(lines.slice(before)).toEqual([CLOSED, gaveUp(REFUSED)]);

    // A tool call still tries one connect, as before.
    await expect(editor.hub()).rejects.toThrow(REFUSED);
    expect(connect).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(0);
    expect(warningsOf(lines)).toHaveLength(1);
  });

  it("connects on the try that finds the port open again, reports it without a warning and ends the tries", async () => {
    writeDiscovery(root, hub.discovery(root));
    const { editor, connect, made, onConnected, lines } = scripted([
      "open",
      "refuse",
      "refuse",
      "open"
    ]);
    await editor.start();
    const before = lines.length;

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
    expect(lines.slice(before)).toEqual([CLOSED, connectedLine()]);
  });

  it("counts a connection dropped right after it opened as a failed try (the old server took it): the next try waits 1 s", async () => {
    writeDiscovery(root, hub.discovery(root));
    const { editor, connect, made, onDisconnected } = scripted(["open", "open", "open"]);
    await editor.start();

    made[0]?.drop();
    await settle();
    expect(editor.connected()).toBe(made[1]?.client);
    made[1]?.drop(0);
    await settle();
    expect(connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await settle();

    expect(connect).toHaveBeenCalledTimes(3);
    expect(editor.connected()).toBe(made[2]?.client);
    expect(onDisconnected).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("walks the same waits when the bin drops every connection at once: tries 0, 1, 3 and 7 s after the close, then one warning and no timer", async () => {
    writeDiscovery(root, hub.discovery(root));
    const { editor, connect, made, onConnected, onDisconnected, lines } = scripted([
      "open",
      "open",
      "open",
      "open",
      "open"
    ]);
    await editor.start();
    const before = lines.length;

    // The connection that held closes: the try at the close connects.
    made[0]?.drop();
    await settle();
    expect(connect).toHaveBeenCalledTimes(2);
    // The bin drops each new connection at once: no try before the wait is over.
    for (const [index, wait] of RECONNECT_WAITS_MS.entries()) {
      made[index + 1]?.drop(0);
      await settle();
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(connect).toHaveBeenCalledTimes(index + 2);
      await vi.advanceTimersByTimeAsync(1);
      await settle();
      expect(connect).toHaveBeenCalledTimes(index + 3);
    }
    // The connection of the last try is dropped too: no wait is left.
    made[4]?.drop(0);
    await settle();

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(connect).toHaveBeenCalledTimes(5);
    expect(onConnected).toHaveBeenCalledTimes(5);
    expect(onDisconnected).toHaveBeenCalledTimes(5);
    expect(editor.connected()).toBeUndefined();
    expect(lines.slice(before)).toEqual([
      CLOSED,
      connectedLine(),
      CLOSED_EARLY,
      connectedLine(),
      CLOSED_EARLY,
      connectedLine(),
      CLOSED_EARLY,
      connectedLine(),
      CLOSED_EARLY,
      gaveUp(droppedEarly())
    ]);
  });

  it("starts over at the close of a connection that lived 6 s: a try at once, then the 1 s wait again", async () => {
    writeDiscovery(root, hub.discovery(root));
    const { editor, connect, made } = scripted(["open", "refuse", "open"]);
    await editor.start();

    // The first walk: the try at the close fails, the one after 1 s connects.
    made[0]?.drop();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(editor.connected()).toBe(made[1]?.client);
    expect(connect).toHaveBeenCalledTimes(3);

    made[1]?.drop(6000);
    await settle();
    expect(connect).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(999);
    expect(connect).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(connect).toHaveBeenCalledTimes(5);

    await editor.shutdown();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the count at the close of a connection that lived just under 5 s: no try at the close, the next wait is 2 s", async () => {
    writeDiscovery(root, hub.discovery(root));
    const { editor, connect, made } = scripted(["open", "refuse", "open", "open"]);
    await editor.start();

    made[0]?.drop();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(editor.connected()).toBe(made[1]?.client);
    expect(connect).toHaveBeenCalledTimes(3);

    expect(STABLE_MS).toBe(5000);
    made[1]?.drop(STABLE_MS - 1);
    await settle();
    expect(connect).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1999);
    expect(connect).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    await settle();

    expect(connect).toHaveBeenCalledTimes(4);
    expect(editor.connected()).toBe(made[2]?.client);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts over at the close of a tool call's connection that lived 6 s after the tries ended: a try at once, no new warning, the next wait is 1 s", async () => {
    writeDiscovery(root, hub.discovery(root));
    const { editor, connect, made, lines } = scripted([
      "open",
      "refuse",
      "refuse",
      "refuse",
      "refuse",
      "open",
      "refuse"
    ]);
    await editor.start();

    // The tries end without a connection: one warning, no timer.
    made[0]?.drop();
    await settle();
    for (const wait of RECONNECT_WAITS_MS) {
      await vi.advanceTimersByTimeAsync(wait);
      await settle();
    }
    expect(connect).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(0);
    expect(warningsOf(lines)).toHaveLength(1);

    // A tool call connects lazily, and that connection holds past 5 s before it closes.
    const lazy = await editor.hub();
    expect(lazy).toBe(made[1]?.client);
    expect(connect).toHaveBeenCalledTimes(6);
    made[1]?.drop(6000);
    await settle();

    expect(connect).toHaveBeenCalledTimes(7);
    expect(warningsOf(lines)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(connect).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(connect).toHaveBeenCalledTimes(8);

    await editor.shutdown();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("makes no try at the close of a tool call's connection that lived under 5 s after the tries ended: one more warning, no timer, the next tool call connects", async () => {
    writeDiscovery(root, hub.discovery(root));
    const { editor, connect, made, lines } = scripted([
      "open",
      "refuse",
      "refuse",
      "refuse",
      "refuse",
      "open",
      "open"
    ]);
    await editor.start();

    made[0]?.drop();
    await settle();
    for (const wait of RECONNECT_WAITS_MS) {
      await vi.advanceTimersByTimeAsync(wait);
      await settle();
    }
    expect(connect).toHaveBeenCalledTimes(5);
    expect(warningsOf(lines)).toHaveLength(1);

    // The lazy connection is dropped before 5 s: no try, one more warning.
    const lazy = await editor.hub();
    expect(lazy).toBe(made[1]?.client);
    made[1]?.drop(1000);
    await settle();

    expect(connect).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(0);
    expect(warningsOf(lines)).toHaveLength(2);
    expect(warningsOf(lines)[1]).toBe(gaveUp(droppedEarly()));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connect).toHaveBeenCalledTimes(6);

    // The next tool call connects again.
    const again = await editor.hub();
    expect(again).toBe(made[2]?.client);
    expect(connect).toHaveBeenCalledTimes(7);
    await editor.shutdown();
  });

  it("ends the tries with one warning when the bin is gone between two of them", async () => {
    writeDiscovery(root, hub.discovery(root, 4242));
    const { editor, connect, made, alive, lines } = scripted(["open"]);
    alive.add(4242);
    await editor.start();
    const before = lines.length;

    made[0]?.drop();
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    alive.delete(4242);
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();

    expect(connect).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(lines.slice(before)).toEqual([CLOSED, gaveUp(REFUSED)]);
    await expect(editor.hub()).rejects.toThrow(NOT_RUNNING);
  });

  it("makes no try and prints no warning when the bin is gone at the close", async () => {
    writeDiscovery(root, hub.discovery(root, 4242));
    const { editor, connect, made, alive, lines } = scripted(["open"]);
    alive.add(4242);
    await editor.start();
    const before = lines.length;

    alive.delete(4242);
    made[0]?.drop();
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(connect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(lines.slice(before)).toEqual([CLOSED_NO_BIN]);
  });

  it("starts no wait when the bin is gone at the close of a connection dropped at once", async () => {
    writeDiscovery(root, hub.discovery(root, 4242));
    const { editor, connect, made, alive, lines } = scripted(["open"]);
    alive.add(4242);
    await editor.start();
    const before = lines.length;

    alive.delete(4242);
    made[0]?.drop(0);
    await settle();

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connect).toHaveBeenCalledOnce();
    expect(lines.slice(before)).toEqual([CLOSED_NO_BIN]);
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

  it("starts no wait and prints no warning when a try fails after a tool call connected", async () => {
    writeDiscovery(root, hub.discovery(root));
    const ofCall = Promise.withResolvers<void>();
    const ofTry = Promise.withResolvers<void>();
    const { editor, made, lines } = scripted(["open", "refuse", ofCall.promise, ofTry.promise]);
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
    expect(warningsOf(lines)).toEqual([]);
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

  it("starts no wait and prints no warning when a try fails while the bridge shuts down", async () => {
    writeDiscovery(root, hub.discovery(root));
    const port = Promise.withResolvers<void>();
    const { editor, connect, made, lines } = scripted(["open", port.promise]);
    await editor.start();

    made[0]?.drop();
    await settle();
    const down = editor.shutdown();
    port.reject(new Error(REFUSED));
    await down;

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(warningsOf(lines)).toEqual([]);
  });

  it("closes a connection that opens while the bridge shuts down: it is not reported, and no timer is left", async () => {
    writeDiscovery(root, hub.discovery(root));
    const port = Promise.withResolvers<void>();
    const { editor, made, onConnected, onDisconnected, lines } = scripted(["open", port.promise]);
    await editor.start();

    // A try is in flight when shutdown starts, and its connect opens during the shutdown.
    made[0]?.drop();
    await settle();
    const down = editor.shutdown();
    port.resolve();
    await down;

    expect(made[1]?.close).toHaveBeenCalledOnce();
    expect(made[1]?.client.isOpen()).toBe(false);
    expect(onConnected).toHaveBeenCalledOnce();
    expect(onDisconnected).toHaveBeenCalledOnce();
    expect(editor.connected()).toBeUndefined();
    expect(lines.filter(line => line === connectedLine())).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("closes the connection of a tool call that opens after the shutdown", async () => {
    writeDiscovery(root, hub.discovery(root));
    const ofCall = Promise.withResolvers<void>();
    const { editor, made, onConnected } = scripted(["open", "refuse", ofCall.promise]);
    await editor.start();

    // The connect of a tool call is in flight over the whole shutdown.
    made[0]?.drop();
    await settle();
    const call = editor.hub();
    await settle();
    await editor.shutdown();
    ofCall.resolve();
    const client = await call;

    expect(client.isOpen()).toBe(false);
    expect(made[1]?.close).toHaveBeenCalledOnce();
    expect(onConnected).toHaveBeenCalledOnce();
    expect(editor.connected()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
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

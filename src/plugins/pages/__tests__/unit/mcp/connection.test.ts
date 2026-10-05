import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { createBrandConsole } from "@moku-labs/common/cli";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeDiscovery } from "../../../discovery";
import { createEditorLink, NOT_RUNNING } from "../../../mcp/connection";
import type { ChildProcess, SpawnProcess } from "../../../mcp/types";
import type { McpArgs } from "../../../types";
import type { FakeHub } from "../../fake-hub";
import { session, startFakeHub, until } from "../../fake-hub";

// ─────────────────────────────────────────────────────────────────────────────
// pages/mcp connection (M3): a live discovery file wins; without one the
// bridge starts the bin when it knows the html; a closed socket reconnects
// once; the bridge stops only the bin it started.
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
 */
function link(args: Partial<McpArgs> = {}, startBin = true) {
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
  const onBinChanged = vi.fn();
  const editor = createEditorLink({
    root,
    args: { kind: "mcp", root, hmr: true, ...args },
    deps: { ui, spawn, isAlive: pid => alive.has(pid), command: ["bun", "bin.mjs"], now: Date.now },
    onBinChanged
  });
  return { editor, lines, spawn, onBinChanged, alive };
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
  it("reconnects once to the same bin after a close, without a tools change", async () => {
    writeDiscovery(root, hub.discovery(root));
    const { editor, onBinChanged } = link();
    await editor.start();
    const first = await editor.hub();
    hub.dropClients();
    await until(() => !first.isOpen(), "the close");
    const second = await editor.hub();
    expect(second).not.toBe(first);
    expect(second.isOpen()).toBe(true);
    expect(onBinChanged).not.toHaveBeenCalled();
    await editor.shutdown();
  });

  it("signals a tools change when it connects to another bin", async () => {
    writeDiscovery(root, hub.discovery(root));
    const { editor, onBinChanged } = link();
    await editor.start();
    const first = await editor.hub();
    writeDiscovery(root, { ...hub.discovery(root), startedAt: 1_800_000_000_000 });
    hub.dropClients();
    await until(() => !first.isOpen(), "the close");
    await editor.hub();
    expect(onBinChanged).toHaveBeenCalledTimes(1);
    await editor.shutdown();
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
    const { editor, lines } = link({ html: "web/index.html" });
    await editor.start();
    const client = await editor.hub();
    const stopped = await editor.stopOwned();
    expect(stopped.stopped).toBe(true);
    expect(client.isOpen()).toBe(false);
    expect(children[0]?.signals).toEqual(["SIGTERM"]);
    expect(lines.join("\n")).toContain("stopped moku-editor (pid 7000)");
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

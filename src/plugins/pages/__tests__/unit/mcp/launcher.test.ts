import { closeSync, existsSync, openSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseBinArgs } from "../../../args";
import { discoveryOf, writeDiscovery } from "../../../discovery";
import {
  LOG_FILE,
  launchCommand,
  launchEditor,
  spawnDetached,
  stopChild
} from "../../../mcp/launcher";
import type { ChildProcess, SpawnProcess } from "../../../mcp/types";

// ─────────────────────────────────────────────────────────────────────────────
// pages/mcp launcher (M3): `moku-editor <html> --port <port> --root <root>
// [--no-hmr]` detached with output in .moku/editor.log, then a wait for the
// discovery file; an owned child is stopped with SIGTERM, then SIGKILL. The
// html `<root>/.moku/index.html` (the engine page) is left out: the bin then
// writes the page again and re-runs under its bunfig (D-51).
// ─────────────────────────────────────────────────────────────────────────────

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "moku-mcp-launcher-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * A fake child: `exit(code)` ends it; `kill` records the signals and, unless told to ignore
 * SIGTERM, exits.
 *
 * @param pid - Its pid.
 * @param ignoreTerm - Stay running on SIGTERM.
 */
function fakeChild(pid: number, ignoreTerm = false) {
  const { promise: exited, resolve: exit } = Promise.withResolvers<number>();
  const signals: string[] = [];
  const child: ChildProcess = {
    pid,
    exited,
    kill: name => {
      signals.push(name);
      if (name === "SIGKILL" || !ignoreTerm) exit(name === "SIGKILL" ? 137 : 0);
    },
    unref: vi.fn()
  };
  return { child, signals, exit };
}

/** The launch options of the tests. */
function options(hmr = true) {
  return { html: join(root, "web", "index.html"), port: 4100, root, hmr };
}

/** The discovery record of a started bin. */
function binRecord(pid: number, startedAt = Date.now()) {
  return discoveryOf({
    pid,
    port: 4100,
    path: "/__editor",
    token: "t",
    root,
    html: join(root, "web", "index.html"),
    startedAt
  });
}

describe("launchCommand", () => {
  it("passes html, port and root, and --no-hmr only when hot reload is off", () => {
    expect(launchCommand(["bun", "/pkg/dist/bin.mjs"], options())).toEqual([
      "bun",
      "/pkg/dist/bin.mjs",
      join(root, "web", "index.html"),
      "--port",
      "4100",
      "--root",
      root
    ]);
    expect(launchCommand(["bun", "bin"], options(false)).at(-1)).toBe("--no-hmr");
  });

  it("starts the engine form, without the html, when the html is the root's engine page", () => {
    const engine = { html: join(root, ".moku", "index.html"), port: 4100, root, hmr: true };

    expect(launchCommand(["bun", "/pkg/dist/bin.mjs"], engine)).toEqual([
      "bun",
      "/pkg/dist/bin.mjs",
      "--port",
      "4100",
      "--root",
      root
    ]);
    expect(launchCommand(["bun", "bin"], { ...engine, hmr: false })).toEqual([
      "bun",
      "bin",
      "--port",
      "4100",
      "--root",
      root,
      "--no-hmr"
    ]);

    // The bin reads these words as the engine page: a `run` without an html (D-51).
    expect(parseBinArgs(launchCommand([], engine))).toEqual({
      kind: "run",
      port: 4100,
      root,
      hmr: true,
      preload: [],
      servePlugins: []
    });
  });

  it("keeps the html form for an engine page of another folder", () => {
    const html = join(root, "games", "timber", ".moku", "index.html");

    expect(launchCommand(["bun", "bin"], { html, port: 4100, root, hmr: true })).toEqual([
      "bun",
      "bin",
      html,
      "--port",
      "4100",
      "--root",
      root
    ]);
  });
});

describe("launchEditor", () => {
  it("spawns detached into .moku/editor.log (0600) and resolves with the bin's discovery file", async () => {
    const { child } = fakeChild(5151);
    const spawn = vi.fn<SpawnProcess>(() => {
      setTimeout(() => writeDiscovery(root, binRecord(5151)), 30);
      return child;
    });
    const launched = await launchEditor(options(), {
      spawn,
      isAlive: pid => pid === 5151,
      command: ["bun", "bin.mjs"],
      now: Date.now
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    const [cmd, spawnOptions] = spawn.mock.calls[0] ?? [];
    expect(cmd).toEqual(["bun", "bin.mjs", ...launchCommand([], options())]);
    expect(spawnOptions).toEqual({ cwd: root, logFd: expect.any(Number) });
    expect(child.unref).toHaveBeenCalled();
    expect(launched.bin.pid).toBe(5151);
    expect(launched.child).toBe(child);
    expect(statSync(join(root, LOG_FILE)).mode & 0o777).toBe(0o600);
  });

  it("fails naming the log when the child exits before it served", async () => {
    const { child, exit } = fakeChild(5252);
    const spawn: SpawnProcess = () => {
      setTimeout(() => exit(1), 20);
      return child;
    };
    await expect(
      launchEditor(options(), { spawn, isAlive: () => false, command: ["bun"], now: Date.now })
    ).rejects.toThrow(`moku-editor exited with code 1 before it served.\n  See ${LOG_FILE}.`);
  });

  it("stops the child when it does not start in time", async () => {
    const { child, signals } = fakeChild(5353);
    await expect(
      launchEditor(options(), {
        spawn: () => child,
        isAlive: () => true,
        command: ["bun"],
        now: Date.now,
        waitMs: 50
      })
    ).rejects.toThrow("it did not start in time");
    expect(signals).toEqual(["SIGTERM"]);
  });

  it("stops the child when the bridge shuts down during the wait", async () => {
    const { child, signals } = fakeChild(5454);
    const controller = new AbortController();
    const launch = launchEditor(options(), {
      spawn: () => child,
      isAlive: () => true,
      command: ["bun"],
      now: Date.now,
      signal: controller.signal
    });
    controller.abort();
    await expect(launch).rejects.toThrow("the bridge is closing");
    expect(signals).toEqual(["SIGTERM"]);
    expect(existsSync(join(root, ".moku"))).toBe(true);
  });
});

describe("stopChild", () => {
  it("sends SIGTERM and stops there when the child exits", async () => {
    const { child, signals } = fakeChild(1);
    await stopChild(child, 50);
    expect(signals).toEqual(["SIGTERM"]);
  });

  it("sends SIGKILL after the grace period when SIGTERM is ignored", async () => {
    const { child, signals } = fakeChild(2, true);
    await stopChild(child, 20);
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("is fine with a child that is already gone", async () => {
    const child: ChildProcess = {
      pid: 3,
      exited: Promise.resolve(0),
      kill: () => {
        throw new Error("ESRCH");
      },
      unref: vi.fn()
    };
    await expect(stopChild(child, 10)).resolves.toBeUndefined();
  });
});

describe("spawnDetached", () => {
  it("runs the command detached with its output in the log descriptor", async () => {
    const log = join(root, "out.log");
    const fd = openSync(log, "a");
    const child = spawnDetached([process.execPath, "-e", "console.log('hi'); process.exit(3)"], {
      cwd: root,
      logFd: fd
    });
    closeSync(fd);
    child.unref();
    expect(child.pid).toBeGreaterThan(0);
    await expect(child.exited).resolves.toBe(3);
    expect(readFileSync(log, "utf8")).toBe("hi\n");
    expect(() => child.kill("SIGTERM")).not.toThrow();
  });
});

import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addSignalHandler,
  everyUnref,
  hasServeStatic,
  PARENT_CHECK_MS,
  processReexec,
  REEXEC_ENV,
  reexecBin,
  reexecEngine,
  reexecRoot,
  spawnInherited,
  stopWithParent
} from "../../reexec";
import type { ForwardedSignal, ReexecChild, ReexecDeps, RunArgs, ServeArgs } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// pages reexec (B2): Bun reads `[serve.static] plugins` once, from the
// bunfig.toml in the process cwd. A bin started elsewhere re-spawns itself with
// cwd = the game root, forwards signals and exits with the child's code.
// ─────────────────────────────────────────────────────────────────────────────

/** The `[serve.static]` bunfig of the tests. */
const BUNFIG = '[serve.static]\nplugins = ["@moku-labs/game/hot"]\n';

let base: string;
let root: string;
let elsewhere: string;

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "moku-reexec-")));
  root = join(base, "game");
  elsewhere = join(base, "editor");
  await mkdir(root);
  await mkdir(elsewhere);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

/**
 * The `run` arguments of the tests: html and root relative to `elsewhere`.
 *
 * @param hmr - Hot reload on.
 * @returns The arguments.
 */
function runArgs(hmr = true): ServeArgs {
  return {
    kind: "run",
    html: "../game/index.html",
    port: 0,
    root: "../game",
    hmr,
    preload: [],
    servePlugins: []
  };
}

/**
 * A fake child: `exit(code)` ends it, `kill` records the signals.
 *
 * @returns The child, its signals and its exit.
 */
function fakeChild() {
  const { promise: exited, resolve: exit } = Promise.withResolvers<number>();
  const signals: ForwardedSignal[] = [];
  const child: ReexecChild = {
    exited,
    kill: signal => {
      signals.push(signal);
    }
  };
  return { child, signals, exit };
}

/**
 * Reexec deps with a fake spawn and recorded signal handlers.
 *
 * @param overrides - Deps to replace.
 * @returns The deps, the child, the handlers and the spawn mock.
 */
function createDeps(overrides: Partial<ReexecDeps> = {}) {
  const fake = fakeChild();
  const handlers = new Map<ForwardedSignal, () => void>();
  const spawn = vi.fn<ReexecDeps["spawn"]>(() => fake.child);
  const deps: ReexecDeps = {
    cwd: () => elsewhere,
    env: { PATH: "/bin" },
    command: ["/usr/bin/bun", "/editor/bin.ts"],
    spawn,
    onSignal: (signal, handler) => {
      handlers.set(signal, handler);
      return () => {
        handlers.delete(signal);
      };
    },
    ppid: () => 4000,
    interval: () => vi.fn(),
    ...overrides
  };
  return { deps, fake, handlers, spawn };
}

describe("hasServeStatic", () => {
  it("finds a [serve.static] table header", () => {
    expect(hasServeStatic(BUNFIG)).toBe(true);
    expect(hasServeStatic('[install]\nexact = true\n\n  [serve.static]\nplugins = ["x"]')).toBe(
      true
    );
  });

  it("ignores other tables, a commented header and an empty file", () => {
    expect(hasServeStatic("[install]\nexact = true\n")).toBe(false);
    expect(hasServeStatic("[serve]\nport = 3000\n")).toBe(false);
    expect(hasServeStatic('# [serve.static]\nplugins = ["x"]\n')).toBe(false);
    expect(hasServeStatic("")).toBe(false);
  });
});

describe("reexecRoot", () => {
  it("answers the absolute root when it has a [serve.static] bunfig and the cwd differs", async () => {
    await writeFile(join(root, "bunfig.toml"), BUNFIG);
    expect(reexecRoot(runArgs(), createDeps().deps)).toBe(root);
  });

  it("answers undefined without a bunfig, or with one that has no [serve.static]", async () => {
    expect(reexecRoot(runArgs(), createDeps().deps)).toBeUndefined();
    await writeFile(join(root, "bunfig.toml"), "[install]\nexact = true\n");
    expect(reexecRoot(runArgs(), createDeps().deps)).toBeUndefined();
  });

  it("answers undefined when the cwd already is the root, also through a symlink", async () => {
    await writeFile(join(root, "bunfig.toml"), BUNFIG);
    const link = join(base, "link");
    await symlink(root, link);
    expect(reexecRoot(runArgs(), createDeps({ cwd: () => root }).deps)).toBeUndefined();
    const viaLink: ServeArgs = { ...runArgs(), root: link };
    expect(reexecRoot(viaLink, createDeps({ cwd: () => root }).deps)).toBeUndefined();
  });

  it("answers undefined in the re-spawned bin (the loop guard) and for a missing root", async () => {
    await writeFile(join(root, "bunfig.toml"), BUNFIG);
    const env = { [REEXEC_ENV]: "1" };
    expect(reexecRoot(runArgs(), createDeps({ env }).deps)).toBeUndefined();
    const missing: ServeArgs = { ...runArgs(), root: "../nope" };
    expect(reexecRoot(missing, createDeps().deps)).toBeUndefined();
  });
});

describe("reexecBin", () => {
  it("does not spawn when no re-spawn is needed", async () => {
    const { deps, spawn } = createDeps();
    await expect(reexecBin(runArgs(), deps)).resolves.toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("re-spawns the bin with absolute html and root, cwd = root and the env marker", async () => {
    await writeFile(join(root, "bunfig.toml"), BUNFIG);
    const { deps, fake, spawn } = createDeps();
    const running = reexecBin(runArgs(false), deps);
    fake.exit(0);
    await expect(running).resolves.toBe(0);
    expect(spawn).toHaveBeenCalledWith(
      [
        "/usr/bin/bun",
        "/editor/bin.ts",
        join(root, "index.html"),
        "--port",
        "0",
        "--root",
        root,
        "--no-hmr"
      ],
      { cwd: root, env: { PATH: "/bin", [REEXEC_ENV]: "1" } }
    );
  });

  it("keeps hot reload on without --no-hmr and exits with the child's code", async () => {
    await writeFile(join(root, "bunfig.toml"), BUNFIG);
    const { deps, fake, spawn } = createDeps();
    const running = reexecBin(runArgs(true), deps);
    fake.exit(1);
    await expect(running).resolves.toBe(1);
    expect(spawn.mock.calls[0]?.[0]).not.toContain("--no-hmr");
  });

  it("forwards SIGINT, SIGTERM and SIGHUP to the child until it exits", async () => {
    await writeFile(join(root, "bunfig.toml"), BUNFIG);
    const { deps, fake, handlers } = createDeps();
    const running = reexecBin(runArgs(), deps);
    expect([...handlers.keys()]).toEqual(["SIGINT", "SIGTERM", "SIGHUP"]);
    handlers.get("SIGINT")?.();
    handlers.get("SIGTERM")?.();
    handlers.get("SIGHUP")?.();
    expect(fake.signals).toEqual(["SIGINT", "SIGTERM", "SIGHUP"]);
    fake.exit(0);
    await running;
    expect(handlers.size).toBe(0);
  });

  it("keeps the handlers quiet when the child cannot be signalled any more", async () => {
    await writeFile(join(root, "bunfig.toml"), BUNFIG);
    const { promise: exited, resolve: exit } = Promise.withResolvers<number>();
    const gone: ReexecChild = {
      exited,
      kill: () => {
        throw new Error("ESRCH");
      }
    };
    const { deps, handlers } = createDeps({ spawn: () => gone });
    const running = reexecBin(runArgs(), deps);
    expect(() => handlers.get("SIGINT")?.()).not.toThrow();
    exit(0);
    await expect(running).resolves.toBe(0);
  });
});

/**
 * The page the engine wrote into the game root.
 *
 * @returns Its HTML and bunfig paths.
 */
function enginePage(): { html: string; bunfig: string } {
  return { html: join(root, ".moku", "index.html"), bunfig: join(root, ".moku", "bunfig.toml") };
}

/**
 * The engine-page `run` arguments: no html, root relative to `elsewhere`.
 *
 * @param hmr - Hot reload on.
 * @returns The arguments.
 */
function engineArgs(hmr = true): RunArgs {
  return { kind: "run", port: 0, root: "../game", hmr, preload: [], servePlugins: [] };
}

describe("reexecEngine (B5, D-51)", () => {
  it("re-runs the bin under the page's bunfig: --config= after bun, then the html, root, port and --no-hmr", async () => {
    const { deps, fake, spawn } = createDeps();
    const running = reexecEngine(enginePage(), engineArgs(false), deps);
    fake.exit(0);
    await expect(running).resolves.toBe(0);
    expect(spawn).toHaveBeenCalledWith(
      [
        "/usr/bin/bun",
        `--config=${join(root, ".moku", "bunfig.toml")}`,
        "/editor/bin.ts",
        join(root, ".moku", "index.html"),
        "--root",
        root,
        "--port",
        "0",
        "--no-hmr"
      ],
      { cwd: root, env: { PATH: "/bin", [REEXEC_ENV]: "1" } }
    );
  });

  it("always re-runs, also when the cwd is the root; keeps hot reload on and answers the child's code", async () => {
    const { deps, fake, spawn } = createDeps({ cwd: () => root });
    const running = reexecEngine(enginePage(), { ...engineArgs(true), root: "." }, deps);
    fake.exit(3);
    await expect(running).resolves.toBe(3);
    const cmd = spawn.mock.calls[0]?.[0];
    expect(cmd).not.toContain("--no-hmr");
    expect(cmd?.slice(4, 6)).toEqual(["--root", root]);
  });

  it("forwards SIGINT, SIGTERM and SIGHUP to the child until it exits", async () => {
    const { deps, fake, handlers } = createDeps();
    const running = reexecEngine(enginePage(), engineArgs(), deps);
    expect([...handlers.keys()]).toEqual(["SIGINT", "SIGTERM", "SIGHUP"]);
    handlers.get("SIGINT")?.();
    expect(fake.signals).toEqual(["SIGINT"]);
    fake.exit(0);
    await running;
    expect(handlers.size).toBe(0);
  });
});

/**
 * A parent watch the test drives: `orphan()` changes the parent pid, `tick()` runs the checks.
 *
 * @param env - The process environment.
 * @returns The deps, the interval mock, its cancel and the controls.
 */
function parentWatch(env: ReexecDeps["env"]) {
  let parent = 4000;
  const ticks: (() => void)[] = [];
  const cancel = vi.fn();
  const interval = vi.fn<ReexecDeps["interval"]>((_ms, tick) => {
    ticks.push(tick);
    return cancel;
  });
  const deps = { env, ppid: () => parent, interval };
  const orphan = (): void => {
    parent = 1;
  };
  const tick = (): void => {
    for (const check of ticks) check();
  };
  return { deps, interval, cancel, orphan, tick };
}

describe("stopWithParent (A4: a parent killed by SIGKILL forwards no signal)", () => {
  it("watches nothing in a bin started by hand", () => {
    const watch = parentWatch({ PATH: "/bin" });
    const stop = vi.fn();
    expect(stopWithParent(watch.deps, stop)).toBeUndefined();
    expect(watch.interval).not.toHaveBeenCalled();
  });

  it("checks the parent every second in a re-spawned bin and stops it once the parent is gone", () => {
    const watch = parentWatch({ [REEXEC_ENV]: "1" });
    const stop = vi.fn();
    stopWithParent(watch.deps, stop);
    expect(watch.interval).toHaveBeenCalledWith(PARENT_CHECK_MS, expect.any(Function));
    expect(PARENT_CHECK_MS).toBe(1000);

    watch.tick();
    expect(stop).not.toHaveBeenCalled();

    // The parent died: the system adopted the child, so its parent pid changed.
    watch.orphan();
    watch.tick();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(watch.cancel).toHaveBeenCalledTimes(1);
  });

  it("answers the cancel of the checks", () => {
    const watch = parentWatch({ [REEXEC_ENV]: "1" });
    const cancel = stopWithParent(watch.deps, vi.fn());
    cancel?.();
    expect(watch.cancel).toHaveBeenCalledTimes(1);
  });
});

describe("everyUnref", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks every period until cancelled", () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    const cancel = everyUnref(1000, tick);
    vi.advanceTimersByTime(2000);
    expect(tick).toHaveBeenCalledTimes(2);
    cancel();
    vi.advanceTimersByTime(2000);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it("does not keep the process alive", () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    const cancel = everyUnref(1000, vi.fn());
    try {
      const timer = interval.mock.results[0]?.value;
      expect(timer?.hasRef()).toBe(false);
    } finally {
      cancel();
      interval.mockRestore();
    }
  });
});

describe("the real process deps", () => {
  it("spawns with the given cwd and environment and resolves the exit code", async () => {
    const script =
      "process.exit(process.cwd().endsWith('/game') && process.env.MARK === 'x' ? 3 : 4)";
    const child = spawnInherited([process.execPath, "-e", script], {
      cwd: root,
      env: { MARK: "x" }
    });
    await expect(child.exited).resolves.toBe(3);
  });

  it("signals the spawned child", async () => {
    const child = spawnInherited([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
      cwd: root,
      env: {}
    });
    child.kill("SIGTERM");
    await expect(child.exited).resolves.not.toBe(0);
  });

  it("adds a process signal handler and removes it", () => {
    const before = process.listenerCount("SIGHUP");
    const remove = addSignalHandler("SIGHUP", () => {
      // Never sent in the test.
    });
    expect(process.listenerCount("SIGHUP")).toBe(before + 1);
    remove();
    expect(process.listenerCount("SIGHUP")).toBe(before);
  });

  it("reads this process: cwd, environment and [bun, Bun.main]", () => {
    const deps = processReexec();
    expect(deps.cwd()).toBe(process.cwd());
    expect(deps.command).toEqual([process.execPath, Bun.main]);
    expect(deps.spawn).toBe(spawnInherited);
    expect(deps.onSignal).toBe(addSignalHandler);
    expect(deps.ppid()).toBe(process.ppid);
    expect(deps.interval).toBe(everyUnref);
  });
});

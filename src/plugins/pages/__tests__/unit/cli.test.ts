import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { createBrandConsole } from "@moku-labs/common/cli";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CliDeps, PageModule } from "../../cli";
import { main, startBin, stopOnce } from "../../cli";
import type { PreparePage } from "../../engine-page";
import { runBridge } from "../../mcp/bridge";
import { REEXEC_ENV } from "../../reexec";
import type { ReexecDeps } from "../../types";

// The bridge reads the real stdin: the cli test checks only the dispatch to it.
vi.mock("../../mcp/bridge", () => ({ runBridge: vi.fn(() => Promise.resolve(0)) }));

/** The default fake HTML bundle. */
const GAME_PAGE: PageModule = { default: new Response("<p>game</p>") };

let game: string;

beforeAll(async () => {
  game = await realpath(await mkdtemp(join(tmpdir(), "moku-cli-")));
  await writeFile(join(game, "index.html"), "<html></html>");
  await writeFile(join(game, "data.json"), "{}");
});

afterAll(async () => {
  await rm(game, { recursive: true, force: true });
});

/**
 * Bin deps that record every console line and fake the HTML import.
 *
 * @param page - What the HTML import resolves with.
 * @returns The deps and the recorded lines.
 */
function createDeps(page: PageModule | Error = GAME_PAGE) {
  const lines: string[] = [];
  const ui = createBrandConsole({
    write: line => lines.push(line),
    writeError: line => lines.push(line),
    color: false
  });
  const deps: CliDeps = {
    ui,
    importPage: vi.fn(() => (page instanceof Error ? Promise.reject(page) : Promise.resolve(page))),
    exit: vi.fn()
  };
  return { deps, lines };
}

describe("startBin", () => {
  it("prints usage with 0 for --help", async () => {
    const { deps, lines } = createDeps();
    await expect(startBin(["--help"], deps)).resolves.toHaveProperty("code", 0);
    expect(lines.join("\n")).toContain("moku-editor <game-html>");
    expect(lines.join("\n")).toContain("--no-hmr");
    expect(lines.join("\n")).toContain("moku-editor mcp [<game-html>]");
    expect(lines.join("\n")).toContain("moku-editor mcp-config [<game-html>] [--port N]");
    expect(lines.join("\n")).toContain(
      "moku-editor [--root DIR] [--preload FILE]… [--serve-plugin FILE]…"
    );
    expect(lines.join("\n")).toContain(
      "without an HTML file, a moku-game folder (index.ts + config.ts) gets its page from the engine"
    );
  });

  it("prints the error and usage with 2 for bad arguments", async () => {
    const { deps, lines } = createDeps();
    await expect(startBin(["x.html", "--host", "0.0.0.0"], deps)).resolves.toHaveProperty(
      "code",
      2
    );
    expect(lines.join("\n")).toContain("[moku-editor]");
  });

  it("answers 1 for a missing HTML file, a failed import and a non-bundle", async () => {
    const missing = createDeps();
    await expect(startBin([join(game, "nope.html")], missing.deps)).resolves.toHaveProperty(
      "code",
      1
    );
    const failing = createDeps(new Error("parse error"));
    await expect(startBin([join(game, "index.html")], failing.deps)).resolves.toHaveProperty(
      "code",
      1
    );
    expect(failing.lines.join("\n")).toContain("parse error");
    const empty = createDeps({});
    await expect(startBin([join(game, "index.html")], empty.deps)).resolves.toHaveProperty(
      "code",
      1
    );
  });

  it("answers 1 when the root cannot start the editor", async () => {
    const { deps, lines } = createDeps();
    const started = await startBin(
      [join(game, "index.html"), "--root", join(game, "missing")],
      deps
    );
    expect(started.code).toBe(1);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("serves the game, files and editor, prints URLs without the token, and stops", async () => {
    const { deps, lines } = createDeps();
    const started = await startBin([join(game, "index.html"), "--port", "0", "--root", game], deps);
    expect(started.code).toBe(0);
    const port = Number(/127\.0\.0\.1:(\d+)\//.exec(lines.join("\n"))?.[1]);
    const origin = `http://127.0.0.1:${port}`;
    try {
      const page = await fetch(`${origin}/`);
      expect(await page.text()).toBe("<p>game</p>");
      const data = await fetch(`${origin}/data.json`);
      expect(data.status).toBe(200);
      const hello = await fetch(`${origin}/__editor/hello`, { headers: { origin } });
      const body: { token: string } = await hello.json();
      expect(lines.join("\n")).not.toContain(body.token);
      expect(lines.join("\n")).toContain(`Tools  ${origin}/__editor/`);

      const second = createDeps();
      const busy = await startBin(
        [join(game, "index.html"), "--port", String(port), "--root", game],
        second.deps
      );
      expect(busy.code).toBe(1);
      expect(second.lines.join("\n")).toContain(`is in use · try --port ${port + 1}`);
    } finally {
      await started.stop?.();
    }
  });
});

describe("startBin log forwarding", () => {
  it("prints the files:project-on info line, so the server log shows the index is on", async () => {
    const { deps, lines } = createDeps();
    const started = await startBin([join(game, "index.html"), "--port", "0", "--root", game], deps);
    try {
      expect(started.code).toBe(0);
      await vi.waitFor(() => expect(lines.join("\n")).toContain("files:project-on {"), {
        timeout: 3000
      });
    } finally {
      await started.stop?.();
    }
  });
});

describe("startBin dev server (D-23)", () => {
  it("serves the game with Bun's HMR and console forwarding", async () => {
    const serve = vi.spyOn(Bun, "serve");
    const { deps } = createDeps();
    const started = await startBin([join(game, "index.html"), "--port", "0", "--root", game], deps);
    try {
      expect(started.code).toBe(0);
      expect(serve).toHaveBeenCalledTimes(1);
      const options: { development?: unknown } | undefined = serve.mock.calls[0]?.[0];
      expect(options?.development).toEqual({ hmr: true, console: true });
    } finally {
      serve.mockRestore();
      await started.stop?.();
    }
  });

  it("attaches its server: GET /__editor/hmr answers the bin's hot reload state", async () => {
    const { deps, lines } = createDeps();
    const started = await startBin([join(game, "index.html"), "--port", "0", "--root", game], deps);
    try {
      const port = Number(/127\.0\.0\.1:(\d+)\//.exec(lines.join("\n"))?.[1]);
      const response = await fetch(`http://127.0.0.1:${port}/__editor/hmr`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ hmr: true, owner: "bin" });
    } finally {
      await started.stop?.();
    }
  });
});

describe("startBin hot reload switch (D-32)", () => {
  it("restarts the server on the same port with HMR flipped; the token stays; stop stops the new server", async () => {
    const serve = vi.spyOn(Bun, "serve");
    const { deps, lines } = createDeps();
    const started = await startBin([join(game, "index.html"), "--port", "0", "--root", game], deps);
    const port = Number(/127\.0\.0\.1:(\d+)\//.exec(lines.join("\n"))?.[1]);
    const origin = `http://127.0.0.1:${port}`;
    let token = "";
    try {
      const hello = await fetch(`${origin}/__editor/hello`, { headers: { origin } });
      token = ((await hello.json()) as { token: string }).token;

      const answer = await fetch(`${origin}/__editor/hmr`, {
        method: "POST",
        headers: { origin, authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ hmr: false })
      });
      expect(answer.status).toBe(200);
      expect(await answer.json()).toEqual({ hmr: false, owner: "bin" });

      await vi.waitFor(() => expect(serve).toHaveBeenCalledTimes(2), { timeout: 5000 });
      const options: { port?: unknown; development?: unknown } | undefined =
        serve.mock.calls[1]?.[0];
      expect(options?.port).toBe(port);
      expect(options?.development).toEqual({ hmr: false, console: true });

      const again = await fetch(`${origin}/__editor/hello`, { headers: { origin } });
      expect(((await again.json()) as { token: string }).token).toBe(token);
      await expect(fetch(`${origin}/__editor/hmr`).then(r => r.json())).resolves.toEqual({
        hmr: false,
        owner: "bin"
      });
    } finally {
      serve.mockRestore();
      await started.stop?.();
    }
    await expect(fetch(`${origin}/`)).rejects.toThrow();
  });
});

describe("startBin --no-hmr (R6)", () => {
  it("serves with Bun HMR off and console forwarding kept", async () => {
    const serve = vi.spyOn(Bun, "serve");
    const { deps } = createDeps();
    const argv = [join(game, "index.html"), "--port", "0", "--root", game, "--no-hmr"];
    const started = await startBin(argv, deps);
    try {
      expect(started.code).toBe(0);
      const options: { development?: unknown } | undefined = serve.mock.calls[0]?.[0];
      expect(options?.development).toEqual({ hmr: false, console: true });
    } finally {
      serve.mockRestore();
      await started.stop?.();
    }
  });

  it("still attaches its server: GET /__editor/hmr answers hmr false, owner bin", async () => {
    const { deps, lines } = createDeps();
    const argv = [join(game, "index.html"), "--no-hmr", "--port", "0", "--root", game];
    const started = await startBin(argv, deps);
    try {
      const port = Number(/127\.0\.0\.1:(\d+)\//.exec(lines.join("\n"))?.[1]);
      const response = await fetch(`http://127.0.0.1:${port}/__editor/hmr`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ hmr: false, owner: "bin" });
    } finally {
      await started.stop?.();
    }
  });
});

describe("main", () => {
  it("resolves with the code and stops on SIGINT while serving", async () => {
    expect(await main(["--help"], createDeps().deps)).toBe(0);
    const { deps, lines } = createDeps();
    expect(await main([join(game, "index.html"), "--port", "0", "--root", game], deps)).toBe(0);
    process.emit("SIGINT");
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));
    expect(lines.join("\n")).toContain("stopped");
    process.emit("SIGTERM");
  });

  it("a SIGTERM that lands while the bin starts stops it once it serves, with exit 0", async () => {
    const before = { int: process.listenerCount("SIGINT"), term: process.listenerCount("SIGTERM") };
    const { deps, lines } = createDeps();
    const importPage = deps.importPage;
    const started = main([join(game, "index.html"), "--port", "0", "--root", game], {
      ...deps,
      importPage: async url => {
        // The signal comes mid-start, before the bin's own handlers exist.
        process.emit("SIGTERM");
        return importPage(url);
      }
    });
    expect(await started).toBe(0);
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));
    expect(lines.join("\n")).toContain("stopped");
    expect(deps.exit).toHaveBeenCalledTimes(1);
    // The early handlers are gone; the once-handlers of the stopped bin are no-ops, emitting removes them.
    process.emit("SIGINT");
    process.emit("SIGTERM");
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(process.listenerCount("SIGINT")).toBe(before.int);
    expect(process.listenerCount("SIGTERM")).toBe(before.term);
  });

  it("a start that throws releases the early signal handlers", async () => {
    const before = { int: process.listenerCount("SIGINT"), term: process.listenerCount("SIGTERM") };
    const { deps } = createDeps();
    // The re-exec check reads the cwd first, before anything serves: a throw there leaves nothing running.
    const { reexec } = reexecDeps(0);
    const failing: CliDeps = {
      ...deps,
      reexec: {
        ...reexec,
        cwd: () => {
          throw new Error("boom");
        }
      }
    };
    await expect(
      main([join(game, "index.html"), "--port", "0", "--root", game], failing)
    ).rejects.toThrow("boom");
    expect(process.listenerCount("SIGINT")).toBe(before.int);
    expect(process.listenerCount("SIGTERM")).toBe(before.term);
  });

  it("a command that does not serve leaves the signals alone", async () => {
    const before = process.listenerCount("SIGTERM");
    expect(await main(["--help"], createDeps().deps)).toBe(0);
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });
});

describe("main in a re-spawned bin (A4)", () => {
  it("stops gracefully and exits 0 once its parent is gone, also after a SIGKILL of the parent", async () => {
    const { deps, lines } = createDeps();
    const { reexec, interval, orphan, tick } = reexecDeps(0, { [REEXEC_ENV]: "1" });
    const argv = [join(game, "index.html"), "--port", "0", "--root", game];
    expect(await main(argv, { ...deps, reexec })).toBe(0);
    const discovery = join(game, ".moku", "editor.json");
    expect(existsSync(discovery)).toBe(true);
    expect(interval).toHaveBeenCalledWith(1000, expect.any(Function));

    tick();
    expect(deps.exit).not.toHaveBeenCalled();
    orphan();
    tick();
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));
    expect(lines.join("\n")).toContain("stopped");
    expect(existsSync(discovery)).toBe(false);

    // The once-handlers of the stopped bin are no-ops now; emitting removes them.
    process.emit("SIGINT");
    process.emit("SIGTERM");
    expect(deps.exit).toHaveBeenCalledTimes(1);
  });

  it("a bin started by hand watches no parent", async () => {
    const { deps } = createDeps();
    const { reexec, interval } = reexecDeps(0);
    const argv = [join(game, "index.html"), "--port", "0", "--root", game];
    expect(await main(argv, { ...deps, reexec })).toBe(0);
    expect(interval).not.toHaveBeenCalled();
    process.emit("SIGINT");
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));
    process.emit("SIGTERM");
  });
});

describe("stopOnce", () => {
  it("stops once, prints stopped and exits 0", async () => {
    const { deps, lines } = createDeps();
    const stop = vi.fn(() => Promise.resolve());
    const onSignal = stopOnce(stop, deps);
    await onSignal();
    await onSignal();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(0);
    expect(lines.join("\n")).toContain("stopped");
  });

  it("prints a stop failure and still exits 0", async () => {
    const { deps, lines } = createDeps();
    await stopOnce(() => Promise.reject(new Error("boom")), deps)();
    expect(lines.join("\n")).toContain("boom");
    expect(deps.exit).toHaveBeenCalledWith(0);
  });
});

describe("startBin mcp-config (M8)", () => {
  it("prints the .mcp.json snippet and the claude mcp add line verbatim, exit 0", async () => {
    const { deps, lines } = createDeps();
    const started = await startBin(["mcp-config", "web/index.html", "--port", "3000"], deps);
    expect(started).toEqual({ code: 0 });
    expect(lines[0]).toBe("{");
    expect(lines.join("\n")).toContain('"mcpServers"');
    expect(lines.at(-1)).toBe(
      "claude mcp add moku-editor -- bunx moku-editor mcp web/index.html --port 3000"
    );
    expect(deps.importPage).not.toHaveBeenCalled();
  });

  it("resolves main with 0 and registers no signal handler", async () => {
    const before = process.listenerCount("SIGINT");
    expect(await main(["mcp-config"], createDeps().deps)).toBe(0);
    expect(process.listenerCount("SIGINT")).toBe(before);
  });
});

describe("startBin mcp (U4)", () => {
  it("runs the stdio bridge with the mcp arguments, prints nothing and answers its code", async () => {
    const { deps, lines } = createDeps();
    const argv = ["mcp", "web/index.html", "--port", "3000", "--no-hmr"];
    await expect(startBin(argv, deps)).resolves.toEqual({ code: 0 });
    expect(runBridge).toHaveBeenCalledWith({
      kind: "mcp",
      html: "web/index.html",
      port: 3000,
      root: ".",
      hmr: false
    });
    expect(lines).toEqual([]);
    expect(deps.importPage).not.toHaveBeenCalled();
  });
});

describe("startBin discovery file (M3, M6)", () => {
  it("writes .moku/editor.json 0600 after serving, never prints the token, removes it on stop", async () => {
    const { deps, lines } = createDeps();
    const exits = process.listenerCount("exit");
    const html = join(game, "index.html");
    const started = await startBin([html, "--port", "0", "--root", game], deps);
    const path = join(game, ".moku", "editor.json");
    try {
      const port = Number(/127\.0\.0\.1:(\d+)\//.exec(lines.join("\n"))?.[1]);
      const origin = `http://127.0.0.1:${port}`;
      const hello = await fetch(`${origin}/__editor/hello`, { headers: { origin } });
      const body: { ws: string; token: string } = await hello.json();
      const file = JSON.parse(readFileSync(path, "utf8"));
      expect(file).toEqual({
        version: 1,
        pid: process.pid,
        port,
        url: origin,
        ws: `ws://127.0.0.1:${port}/__editor/ws`,
        token: body.token,
        root: game,
        html,
        startedAt: expect.any(Number)
      });
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(lines.join("\n")).not.toContain(body.token);
      expect(process.listenerCount("exit")).toBe(exits + 1);
    } finally {
      await started.stop?.();
    }
    expect(existsSync(path)).toBe(false);
    expect(process.listenerCount("exit")).toBe(exits);
  });

  it("warns and keeps serving when the file cannot be written", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "moku-cli-blocked-")));
    await writeFile(join(root, ".moku"), "a file where the folder should be");
    const { deps, lines } = createDeps();
    const started = await startBin([join(game, "index.html"), "--port", "0", "--root", root], deps);
    try {
      expect(started.code).toBe(0);
      expect(lines.join("\n")).toContain("[moku-editor] could not write .moku/editor.json");
      expect(lines.join("\n")).toContain("Tools  http://127.0.0.1:");
    } finally {
      await started.stop?.();
      await rm(root, { recursive: true, force: true });
    }
  });
});

/**
 * The removal of a signal handler the fake reexec never added.
 */
function keepHandlers(): void {
  // Nothing was added, so nothing is removed.
}

/**
 * Reexec deps with a fake spawn whose child exits at once with a code, and a parent watch the
 * test drives: `orphan()` makes the parent pid change, `tick()` runs the periodic check.
 *
 * @param code - The child's exit code.
 * @param env - The process environment.
 * @returns The deps, the spawn mock and the parent watch controls.
 */
function reexecDeps(code: number, env: ReexecDeps["env"] = {}) {
  const spawn = vi.fn<ReexecDeps["spawn"]>(() => ({
    exited: Promise.resolve(code),
    kill: vi.fn()
  }));
  let parent = 4000;
  const ticks: (() => void)[] = [];
  const interval = vi.fn<ReexecDeps["interval"]>((_ms, tick) => {
    ticks.push(tick);
    return vi.fn();
  });
  const reexec: ReexecDeps = {
    cwd: () => tmpdir(),
    env,
    command: ["bun", "bin.ts"],
    spawn,
    onSignal: () => keepHandlers,
    ppid: () => parent,
    interval
  };
  const orphan = (): void => {
    parent = 1;
  };
  const tick = (): void => {
    for (const check of ticks) check();
  };
  return { reexec, spawn, interval, orphan, tick };
}

describe("startBin re-spawn in the game root (B2)", () => {
  it("answers the child's code and serves nothing itself when the root has [serve.static]", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "moku-cli-bunfig-")));
    await writeFile(join(root, "index.html"), "<html></html>");
    await writeFile(join(root, "bunfig.toml"), '[serve.static]\nplugins = ["./p.ts"]\n');
    const { deps } = createDeps();
    const { reexec, spawn } = reexecDeps(7);
    try {
      const started = await startBin([join(root, "index.html"), "--root", root], {
        ...deps,
        reexec
      });
      expect(started).toEqual({ code: 7 });
      expect(spawn).toHaveBeenCalledWith(expect.arrayContaining(["--root", root]), {
        cwd: root,
        env: { [REEXEC_ENV]: "1" }
      });
      expect(deps.importPage).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("serves itself when the root has no [serve.static] bunfig", async () => {
    const { deps } = createDeps();
    const { reexec, spawn } = reexecDeps(7);
    const started = await startBin([join(game, "index.html"), "--port", "0", "--root", game], {
      ...deps,
      reexec
    });
    try {
      expect(started.code).toBe(0);
      expect(spawn).not.toHaveBeenCalled();
      expect(deps.importPage).toHaveBeenCalledTimes(1);
    } finally {
      await started.stop?.();
    }
  });
});

/**
 * A preparePage that refuses the game's config, as the engine does.
 *
 * @returns Never: rejects with the engine's `[game]` error.
 */
function refusePage(): Promise<never> {
  return Promise.reject(new Error("[game] config.ts: page.title is refused."));
}

describe("startBin engine page (B5)", () => {
  let base: string;
  let moku: string;

  beforeAll(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), "moku-cli-engine-")));
    moku = join(base, "games", "timber");
    await mkdir(moku, { recursive: true });
    await writeFile(join(moku, "index.ts"), "export default {};");
    await writeFile(join(moku, "config.ts"), "export default {};");
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  /** The page the stubbed engine writes. */
  const page = () => ({
    html: join(moku, ".moku", "index.html"),
    bunfig: join(moku, ".moku", "bunfig.toml")
  });

  /**
   * Bin deps for the engine page: the reexec deps with the cwd `base`, and an importCli whose
   * preparePage answers the page (or the given stub).
   *
   * @param prepare - The preparePage stub.
   * @param code - The exit code of the re-spawned bin.
   * @returns The deps, the lines, the spawn and the preparePage mocks.
   */
  function engineDeps(prepare: PreparePage = () => Promise.resolve(page()), code = 0) {
    const { deps, lines } = createDeps();
    const { reexec, spawn } = reexecDeps(code);
    const preparePage = vi.fn<PreparePage>(prepare);
    const importCli = vi.fn(() => Promise.resolve({ preparePage }));
    return {
      deps: { ...deps, reexec: { ...reexec, cwd: () => base }, importCli },
      lines,
      spawn,
      preparePage,
      importCli
    };
  }

  it("answers 1 without the real process (no reexec dep): the page needs a re-run", async () => {
    const { deps, lines } = createDeps();
    await expect(startBin(["--root", moku], deps)).resolves.toEqual({ code: 1 });
    expect(lines.join("\n")).toContain(
      "[moku-editor] the engine page needs the real process: pass the game HTML file"
    );
  });

  it("answers 2 for a root that is not a moku-game folder", async () => {
    const { deps, lines, importCli } = engineDeps();
    await expect(startBin(["--root", "games"], deps)).resolves.toEqual({ code: 2 });
    expect(lines.join("\n")).toContain(
      `[moku-editor] ${join(base, "games")} has no index.ts and config.ts: pass the game HTML file, or run in a moku-game folder`
    );
    expect(importCli).not.toHaveBeenCalled();
  });

  it("answers 1 with the install hint when @moku-labs/game/cli does not resolve", async () => {
    const { deps, lines } = engineDeps();
    const failing = { ...deps, importCli: () => Promise.reject(new Error("Cannot find module")) };
    await expect(startBin(["--root", moku], failing)).resolves.toEqual({ code: 1 });
    expect(lines.join("\n")).toContain(
      `[moku-editor] @moku-labs/game/cli does not resolve from ${moku}: install @moku-labs/game >=0.10.0 in the game`
    );
  });

  it("imports the engine's cli from the root by default: none resolves here, so the install hint", async () => {
    // An empty node_modules above the game keeps Bun from resolving through its global cache.
    await mkdir(join(base, "node_modules"), { recursive: true });
    const { deps, lines, spawn } = engineDeps();
    const withDefault: CliDeps = {
      ui: deps.ui,
      importPage: deps.importPage,
      exit: deps.exit,
      reexec: deps.reexec
    };
    await expect(startBin(["--root", moku], withDefault)).resolves.toEqual({ code: 1 });
    expect(lines.join("\n")).toContain(`@moku-labs/game/cli does not resolve from ${moku}`);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("answers 1 with the engine's [game] text when preparePage throws, and re-runs nothing", async () => {
    const { deps, lines, spawn } = engineDeps(refusePage);
    await expect(startBin(["--root", moku], deps)).resolves.toEqual({ code: 1 });
    expect(lines.join("\n")).toContain("[game] config.ts: page.title is refused.");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("prepares the page from the root, re-runs the bin under its bunfig and answers the child's code", async () => {
    const { deps, spawn, preparePage, importCli } = engineDeps(undefined, 7);
    const argv = ["--root", "games/timber", "--port", "0", "--no-hmr", "--preload", "p.ts"];
    const withPlugin = [...argv, "--serve-plugin", "plugins/marker.ts"];
    await expect(startBin(withPlugin, deps)).resolves.toEqual({ code: 7 });

    expect(importCli).toHaveBeenCalledWith(moku);
    const [root, options] = preparePage.mock.calls[0] ?? [];
    expect(root).toBe(moku);
    expect(options?.agents).toEqual(["@moku-labs/editor/agent/page"]);
    expect(options?.preload).toEqual([join(base, "p.ts")]);
    expect(options?.servePlugins?.[0]).toBe(join(base, "plugins", "marker.ts"));

    expect(spawn).toHaveBeenCalledWith(
      [
        "bun",
        `--config=${page().bunfig}`,
        "bin.ts",
        page().html,
        "--root",
        moku,
        "--port",
        "0",
        "--no-hmr"
      ],
      { cwd: moku, env: { [REEXEC_ENV]: "1" } }
    );
    expect(deps.importPage).not.toHaveBeenCalled();
  });
});

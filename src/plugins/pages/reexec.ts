/**
 * @file pages plugin — the bin re-spawns itself in the game root (B2). Bun reads
 * `[serve.static] plugins` once at process start, from the `bunfig.toml` in the process cwd;
 * `process.chdir` comes too late (spike, Bun 1.3.14). So a `run` whose `--root` holds a
 * `bunfig.toml` with `[serve.static]`, started from another cwd, spawns the same bin again with
 * `cwd: root`, absolute html and root, and the loop marker `MOKU_EDITOR_REEXEC=1`. The parent
 * forwards SIGINT, SIGTERM and SIGHUP and exits with the child's code; the child serves and writes
 * the discovery file with its own pid. The child runs in its own process group, so a terminal
 * Ctrl+C reaches it once, through the parent. A parent killed by SIGKILL forwards nothing: the
 * child checks its parent pid every second and stops itself once the parent is gone (A4).
 *
 * The engine page (B5) always re-spawns (D-51): Bun reads `--config=<root>/.moku/bunfig.toml`
 * only at process start, so `reexecEngine` runs `bun --config=<bunfig> <bin> <root>/.moku/index.html`
 * in the game root, with the same signal forwarding and loop marker.
 */
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path/posix";
import type { PreparedPage } from "@moku-labs/game/cli";
import type { ForwardedSignal, ReexecChild, ReexecDeps, RunArgs, ServeArgs } from "./types";

/**
 * The environment marker of a re-spawned bin: it never re-spawns again.
 */
export const REEXEC_ENV = "MOKU_EDITOR_REEXEC";

/**
 * The value of `REEXEC_ENV` in a re-spawned bin.
 */
const REEXEC_ON = "1";

/**
 * How often a re-spawned bin checks that its parent is still there, in ms.
 */
export const PARENT_CHECK_MS = 1000;

/**
 * The bunfig file Bun reads from the process cwd.
 */
const BUNFIG = "bunfig.toml";

/**
 * A `[serve.static]` table header at the start of a line (a `#` comment does not count).
 */
const SERVE_STATIC_HEADER = /^[ \t]*\[[ \t]*serve\.static[ \t]*\]/m;

/**
 * The signals the parent hands on to the child.
 */
const FORWARDED: readonly ForwardedSignal[] = ["SIGINT", "SIGTERM", "SIGHUP"];

/**
 * Whether a bunfig text has a `[serve.static]` table, where Bun's dev server reads its plugins.
 *
 * @param text - The bunfig.toml text.
 * @returns True when the table header is there.
 * @example
 * ```ts
 * hasServeStatic('[serve.static]\nplugins = ["@moku-labs/game/hot"]'); // true
 * hasServeStatic("[install]\nexact = true"); // false
 * ```
 */
export function hasServeStatic(text: string): boolean {
  return SERVE_STATIC_HEADER.test(text);
}

/**
 * The real path of a file or folder, or undefined when it does not exist.
 *
 * @param path - An absolute path.
 * @returns The real path, or undefined.
 * @example
 * ```ts
 * realOrUndefined("/tmp"); // "/private/tmp" on macOS
 * ```
 */
function realOrUndefined(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

/**
 * The text of a file, or undefined when it cannot be read.
 *
 * @param path - An absolute path.
 * @returns The text, or undefined.
 * @example
 * ```ts
 * textOrUndefined("/games/merge/bunfig.toml"); // '[serve.static]\n…'
 * ```
 */
function textOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * The absolute root to re-spawn the bin in, or undefined to serve here: not in a re-spawned bin,
 * the root exists, its `bunfig.toml` has `[serve.static]`, and the cwd is another folder (real
 * paths compared, so a symlink to the root counts as the root).
 *
 * @param args - The `run` arguments.
 * @param deps - The process cwd and environment.
 * @returns The absolute root (resolved against the cwd), or undefined.
 * @example
 * ```ts
 * reexecRoot({ kind: "run", html: "../game/index.html", port: 3000, root: "../game", hmr: true, preload: [], servePlugins: [] }, deps);
 * // "/work/game" when /work/game/bunfig.toml has [serve.static] and the cwd is /work/editor
 * ```
 */
export function reexecRoot(
  args: ServeArgs,
  deps: Pick<ReexecDeps, "cwd" | "env">
): string | undefined {
  if (deps.env[REEXEC_ENV] === REEXEC_ON) return undefined;

  const cwd = deps.cwd();
  const root = resolve(cwd, args.root);
  const realRoot = realOrUndefined(root);
  if (realRoot === undefined) return undefined;

  const bunfig = textOrUndefined(join(realRoot, BUNFIG));
  if (bunfig === undefined || !hasServeStatic(bunfig)) return undefined;

  return realOrUndefined(cwd) === realRoot ? undefined : root;
}

/**
 * The bin arguments of the child: absolute html and root (the child's cwd is the root), the port,
 * and `--no-hmr` when hot reload is off.
 *
 * @param args - The `run` arguments.
 * @param cwd - The parent's cwd, the base of relative paths.
 * @param root - The absolute root.
 * @returns The argument words.
 * @example
 * ```ts
 * childArgv({ kind: "run", html: "web/index.html", port: 0, root: ".", hmr: false, preload: [], servePlugins: [] }, "/g", "/g");
 * // ["/g/web/index.html", "--port", "0", "--root", "/g", "--no-hmr"]
 * ```
 */
function childArgv(args: ServeArgs, cwd: string, root: string): string[] {
  const words = [resolve(cwd, args.html), "--port", String(args.port), "--root", root];
  return args.hmr ? words : [...words, "--no-hmr"];
}

/**
 * Hands SIGINT, SIGTERM and SIGHUP on to the child until the returned release runs. A child that
 * is already gone is ignored: its exit ends the parent anyway.
 *
 * @param child - The re-spawned bin.
 * @param onSignal - Adds a signal handler and returns its removal.
 * @returns Removes every handler.
 */
function forwardSignals(child: ReexecChild, onSignal: ReexecDeps["onSignal"]): () => void {
  const removals = FORWARDED.map(signal =>
    onSignal(signal, () => {
      try {
        child.kill(signal);
      } catch {
        // The child exited between the signal and the kill.
      }
    })
  );
  return () => {
    for (const remove of removals) remove();
  };
}

/**
 * Spawns the bin's child in the game root with the loop marker, hands the stop signals on to it
 * until it exits, and answers its exit code.
 *
 * @param cmd - The whole command.
 * @param root - The absolute game root: the child's cwd.
 * @param deps - Environment, spawn and signal handlers.
 * @returns The child's exit code.
 */
async function runChild(cmd: readonly string[], root: string, deps: ReexecDeps): Promise<number> {
  const child = deps.spawn(cmd, { cwd: root, env: { ...deps.env, [REEXEC_ENV]: REEXEC_ON } });
  const release = forwardSignals(child, deps.onSignal);
  try {
    return await child.exited;
  } finally {
    release();
  }
}

/**
 * Re-spawns the bin in the game root when its `bunfig.toml` has `[serve.static]` and the cwd is
 * elsewhere, and waits for it.
 *
 * @param args - The `run` arguments with the game HTML file.
 * @param deps - Cwd, environment, command, spawn and signal handlers.
 * @returns The child's exit code, or undefined when this process serves the game itself.
 * @example
 * ```ts
 * // Started in /work/editor for a game whose bunfig.toml has [serve.static]: the child serves it.
 * await reexecBin({ kind: "run", html: "../game/index.html", port: 3000, root: "../game", hmr: true, preload: [], servePlugins: [] }, processReexec()); // 0 after Ctrl+C
 * ```
 */
export async function reexecBin(args: ServeArgs, deps: ReexecDeps): Promise<number | undefined> {
  const root = reexecRoot(args, deps);
  if (root === undefined) return undefined;

  return runChild([...deps.command, ...childArgv(args, deps.cwd(), root)], root, deps);
}

/**
 * Re-runs the bin under the engine page's bunfig (D-51), always: Bun reads `--config=` only at
 * process start. The child serves `<root>/.moku/index.html` as any re-spawned bin, in the root.
 *
 * @param page - The page the engine wrote: its HTML and its bunfig.
 * @param args - The `run` arguments of the engine page (root, port, hmr).
 * @param deps - Cwd, environment, command, spawn and signal handlers.
 * @returns The child's exit code.
 * @example
 * ```ts
 * // moku-editor --root games/timber: bun --config=/w/games/timber/.moku/bunfig.toml bin.mjs /w/games/timber/.moku/index.html --root /w/games/timber --port 3000
 * await reexecEngine(page, { kind: "run", port: 3000, root: "games/timber", hmr: true, preload: [], servePlugins: [] }, processReexec()); // 0 after Ctrl+C
 * ```
 */
export function reexecEngine(page: PreparedPage, args: RunArgs, deps: ReexecDeps): Promise<number> {
  // The child runs in the game root.
  const root = resolve(deps.cwd(), args.root);

  // Split the command so `--config=` goes between bun and the bin.
  const bun = deps.command.slice(0, 1);
  const bin = deps.command.slice(1);

  // Build the bin arguments, then run.
  const words = [page.html, "--root", root, "--port", String(args.port)];
  const binArgs = args.hmr ? words : [...words, "--no-hmr"];
  return runChild([...bun, `--config=${page.bunfig}`, ...bin, ...binArgs], root, deps);
}

/**
 * The real spawn: Bun.spawn with stdio inherited, in its own process group (`detached`), so a
 * terminal Ctrl+C reaches the child only through the parent's forward.
 *
 * @param cmd - The command words.
 * @param options - The working directory and the environment.
 * @param options.cwd - The working directory.
 * @param options.env - The environment.
 * @returns The child.
 * @example
 * ```ts
 * const child = spawnInherited([process.execPath, Bun.main, "/g/index.html"], { cwd: "/g", env });
 * ```
 */
export function spawnInherited(
  cmd: readonly string[],
  options: { readonly cwd: string; readonly env: Readonly<Record<string, string | undefined>> }
): ReexecChild {
  const child = Bun.spawn([...cmd], {
    cwd: options.cwd,
    env: { ...options.env },
    stdio: ["inherit", "inherit", "inherit"],
    detached: true
  });
  return {
    exited: child.exited,
    kill: signal => {
      child.kill(signal);
    }
  };
}

/**
 * Adds a process signal handler.
 *
 * @param signal - The signal.
 * @param handler - Its handler.
 * @returns Removes the handler.
 * @example
 * ```ts
 * const remove = addSignalHandler("SIGINT", () => child.kill("SIGINT"));
 * ```
 */
export function addSignalHandler(signal: ForwardedSignal, handler: () => void): () => void {
  process.on(signal, handler);
  return () => {
    process.off(signal, handler);
  };
}

/**
 * Calls `tick` every `ms` on a timer that does not keep the process alive.
 *
 * @param ms - The period.
 * @param tick - Called on each period.
 * @returns Stops the timer.
 * @example
 * ```ts
 * let ticks = 0;
 * const cancel = everyUnref(1000, () => (ticks += 1)); // ticks is 3 after 3 s
 * cancel(); // no more ticks
 * ```
 */
export function everyUnref(ms: number, tick: () => void): () => void {
  const timer = setInterval(tick, ms);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}

/**
 * In a re-spawned bin, stops it once its parent is gone: a parent killed by SIGKILL forwards no
 * signal, and the child would serve on alone. Every `PARENT_CHECK_MS` the parent pid is read
 * again; when it changed (the system adopted the orphan), the checks end and `stop` runs once. A
 * bin started by hand watches nothing.
 *
 * @param deps - The environment, the parent pid and the interval.
 * @param stop - The graceful stop of the bin (it exits 0 after it).
 * @returns Cancels the checks; undefined when this is not a re-spawned bin.
 */
export function stopWithParent(
  deps: Pick<ReexecDeps, "env" | "ppid" | "interval">,
  stop: () => void
): (() => void) | undefined {
  if (deps.env[REEXEC_ENV] !== REEXEC_ON) return undefined;

  const parent = deps.ppid();
  const cancel = deps.interval(PARENT_CHECK_MS, () => {
    if (deps.ppid() === parent) return;
    cancel();
    stop();
  });
  return cancel;
}

/**
 * The reexec deps of the real process: its cwd and environment, `[bun, Bun.main]`, the real spawn,
 * process signal handlers, the live parent pid and an unref'd interval. The environment is handed
 * on whole to the re-spawned bin.
 *
 * @returns The deps.
 */
export function processReexec(): ReexecDeps {
  return {
    cwd: () => process.cwd(),
    env: process.env, // @env-allow — passed through whole to the re-spawned bin
    command: [process.execPath, Bun.main],
    spawn: spawnInherited,
    onSignal: addSignalHandler,
    ppid: () => process.ppid,
    interval: everyUnref
  };
}

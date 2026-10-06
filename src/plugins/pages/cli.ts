/**
 * @file pages plugin — the moku-editor bin program: parse arguments, import the game HTML at run
 * time, start the server core, serve hub.serve(...) as the game server (`serve.ts`) with Bun HMR
 * on (off with `--no-hmr`), attach it to pages with its restart (the Hot reload switch, D-32),
 * write the discovery file `.moku/editor.json` (removed on stop and exit), print the URLs through
 * the branded console (MC1). A root whose `bunfig.toml` has `[serve.static]` is served from a
 * re-spawned bin with that cwd (`reexec.ts`). `mcp` runs the stdio MCP bridge (`mcp/`, stdout for
 * protocol frames only); `mcp-config` prints the Claude Code setup. The token is never printed.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path/posix";
import { pathToFileURL } from "node:url";
import type { BrandConsole } from "@moku-labs/common/cli";
import { createBrandConsole } from "@moku-labs/common/cli";
import { createApp } from "../../server";
import { parseBinArgs } from "./args";
import { discoveryOf, publishDiscovery } from "./discovery";
import { runBridge } from "./mcp/bridge";
import { mcpConfigLines } from "./mcp-config";
import { processReexec, reexecBin, stopWithParent } from "./reexec";
import type { GameServer } from "./serve";
import { createGameServer } from "./serve";
import { createStaticFetch } from "./static";
import type { McpConfigArgs, ReexecDeps, RunArgs } from "./types";

/**
 * The usage lines of `--help` and of an argument error.
 */
const USAGE = [
  "Usage: moku-editor <game-html> [--port 3000] [--root .] [--no-hmr] [--help]",
  "       moku-editor mcp [<game-html>] [--port N] [--root DIR] [--no-hmr]",
  "       moku-editor mcp-config [<game-html>] [--port N]",
  "  mcp         stdio MCP server for Claude Code: uses the running editor, or starts it",
  "  mcp-config  print the .mcp.json snippet and the claude mcp add line",
  "  --port, -p  port on 127.0.0.1 (0 = a random free port)",
  "  --root, -r  project root the editor reads and writes (default .)",
  "  --no-hmr    serve the game without hot reload (default: hot reload on)"
];

/**
 * A module loaded from the game HTML file (a Bun HTML import: its default export is the bundle).
 */
export type PageModule = { readonly default?: unknown };

/**
 * What the bin talks to: the console, the HTML import, the process exit and, for the real
 * process, the re-spawn in the game root (without it the bin always serves itself).
 */
export type CliDeps = {
  readonly ui: BrandConsole;
  readonly importPage: (url: string) => Promise<PageModule>;
  readonly exit: (code: number) => void;
  readonly reexec?: ReexecDeps;
};

/**
 * The result of starting the bin: the exit code, and the stop function while serving.
 */
export type Started = { readonly code: number; readonly stop?: () => Promise<void> };

/**
 * The editor server app of the bin.
 */
type EditorApp = ReturnType<typeof createApp>;

/**
 * The message of any thrown value.
 *
 * @param error - The thrown value.
 * @returns Its message.
 * @example
 * ```ts
 * messageOf(new Error("x")); // "x"
 * ```
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * True for the error Bun.serve throws when the port is taken.
 *
 * @param error - The thrown value.
 * @returns Whether the port is in use.
 * @example
 * ```ts
 * isPortInUse(Object.assign(new Error("listen failed"), { code: "EADDRINUSE" })); // true
 * ```
 */
function isPortInUse(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? error.code : undefined;
  return code === "EADDRINUSE" || /in use/i.test(error.message);
}

/**
 * Prints the usage lines.
 *
 * @param ui - The branded console.
 */
function printUsage(ui: BrandConsole): void {
  for (const line of USAGE) ui.info(line);
}

/**
 * The info log events the bin prints: the server log shows that the project index is on.
 */
const PRINTED_INFO = new Set(["files:project-on"]);

/**
 * Routes the warn and error log entries of the app, and the info entries in `PRINTED_INFO`, to
 * the branded console from now on (the default console sink is removed).
 *
 * @param app - The editor app.
 * @param ui - The branded console.
 */
function forwardLog(app: EditorApp, ui: BrandConsole): void {
  const sink = {
    /**
     * Writes one entry as a brand line.
     *
     * @param entry - The log entry.
     * @param entry.level - Its level.
     * @param entry.event - Its event name.
     * @param entry.data - Its payload.
     */
    write(entry: { level: string; event: string; data?: unknown }): void {
      const line =
        entry.data === undefined ? entry.event : `${entry.event} ${JSON.stringify(entry.data)}`;
      const isPrintedInfo = entry.level === "info" && PRINTED_INFO.has(entry.event);
      if (entry.level === "error") ui.error(line);
      else if (entry.level === "warn") ui.warn(line);
      else if (isPrintedInfo) ui.info(line);
    }
  };
  app.log.clearSinks();
  app.log.addSink(sink);
}

/**
 * Creates and starts the editor app for a project root.
 *
 * @param rootPath - The absolute project root.
 * @param ui - The branded console.
 * @returns The started app, or undefined after printing the error.
 */
async function startEditor(rootPath: string, ui: BrandConsole): Promise<EditorApp | undefined> {
  try {
    const editor = createApp({
      pluginConfigs: { files: { root: rootPath }, pages: { gameUrl: "/" } }
    });
    forwardLog(editor, ui);
    await editor.start();
    return editor;
  } catch (error) {
    ui.error(messageOf(error));
    return undefined;
  }
}

/**
 * Imports the game HTML file as a Bun HTML bundle.
 *
 * @param htmlPath - The absolute HTML path.
 * @param deps - The bin deps.
 * @returns The bundle, or undefined after printing the error.
 */
async function importGame(htmlPath: string, deps: CliDeps): Promise<object | undefined> {
  if (!existsSync(htmlPath)) {
    deps.ui.error(`[moku-editor] the game HTML file ${htmlPath} does not exist`);
    return undefined;
  }
  try {
    const page = await deps.importPage(pathToFileURL(htmlPath).href);
    if (typeof page.default === "object" && page.default !== null) return page.default;
    deps.ui.error(`[moku-editor] ${htmlPath} did not load as an HTML bundle`);
  } catch (error) {
    deps.ui.error(`[moku-editor] ${htmlPath} did not load: ${messageOf(error)}`);
  }
  return undefined;
}

/**
 * Prints the lockup and the URLs. The token is never printed.
 *
 * @param ui - The branded console.
 * @param port - The real port.
 * @param path - hub.path().
 * @param rootPath - The project root.
 */
function printServing(ui: BrandConsole, port: number, path: string, rootPath: string): void {
  ui.lockup({ wordmark: "moku editor", label: "serve" });
  ui.box([
    `Game   http://127.0.0.1:${port}/`,
    `Tools  http://127.0.0.1:${port}${path}/`,
    `Root   ${rootPath}`
  ]);
  ui.info("Ctrl+C to stop");
}

/**
 * The release function when no discovery file was written.
 */
function keepNothing(): void {
  // Nothing was written, so nothing is removed.
}

/**
 * Writes `.moku/editor.json` for the MCP bridge. A failed write is a warning (without the token):
 * the bin keeps serving.
 *
 * @param editor - The started editor.
 * @param port - The real port.
 * @param paths - The absolute root and game HTML paths.
 * @param paths.rootPath - The project root.
 * @param paths.htmlPath - The game HTML file.
 * @param ui - The branded console.
 * @returns The release function (removes the file), a no-op when nothing was written.
 */
function writeDiscoveryFile(
  editor: EditorApp,
  port: number,
  paths: { readonly rootPath: string; readonly htmlPath: string },
  ui: BrandConsole
): () => void {
  const discovery = discoveryOf({
    pid: process.pid,
    port,
    path: editor.hub.path(),
    token: editor.hub.token(),
    root: paths.rootPath,
    html: paths.htmlPath,
    startedAt: Date.now()
  });
  try {
    return publishDiscovery(paths.rootPath, discovery);
  } catch (error) {
    ui.warn(`[moku-editor] could not write .moku/editor.json: ${messageOf(error)}`);
    return keepNothing;
  }
}

/**
 * The stop function of a serving bin: the discovery file goes first, then the editor (it closes
 * its sockets), then the current game server, bounded (Bun's stop does not resolve while a close
 * is in flight).
 *
 * @param editor - The started editor.
 * @param game - The game server (the current one after any Hot reload restart).
 * @param release - Removes the discovery file.
 * @returns The stop function.
 */
function stopper(editor: EditorApp, game: GameServer, release: () => void): () => Promise<void> {
  return async function stop(): Promise<void> {
    release();
    await editor.stop();
    await game.stop();
  };
}

/**
 * Prints the `.mcp.json` snippet and the `claude mcp add` line verbatim, for copying.
 *
 * @param ui - The branded console.
 * @param args - The `mcp-config` arguments.
 */
function printMcpConfig(ui: BrandConsole, args: McpConfigArgs): void {
  for (const line of mcpConfigLines(args)) ui.line(line);
}

/**
 * Imports the game, starts the editor, serves and writes the discovery file; resolves while the
 * server runs.
 *
 * @param args - The `run` arguments.
 * @param deps - The bin deps.
 * @returns 0 with the stop function while serving, or 1 on a runtime error.
 */
async function serveGame(args: RunArgs, deps: CliDeps): Promise<Started> {
  const { ui } = deps;
  const htmlPath = resolve(args.html);
  const rootPath = resolve(args.root);
  const bundle = await importGame(htmlPath, deps);
  if (bundle === undefined) return { code: 1 };

  const editor = await startEditor(rootPath, ui);
  if (editor === undefined) return { code: 1 };

  let game: GameServer;
  let options: ReturnType<typeof editor.hub.serve>;
  try {
    options = editor.hub.serve({
      port: args.port,
      // Bun HMR reloads the game page on a save (D-23), unless `--no-hmr`; `console: true`
      // forwards the browser console.
      development: { hmr: args.hmr, console: true },
      routes: { "/": bundle },
      fetch: createStaticFetch(rootPath, editor.hub.guard)
    });
    game = createGameServer(options, (code, reason) => editor.hub.closeAll(code, reason));
  } catch (error) {
    const portTaken = `[moku-editor] port ${args.port} is in use · try --port ${args.port + 1}`;
    const message = isPortInUse(error) ? portTaken : `[moku-editor] ${messageOf(error)}`;
    ui.error(message);
    await editor.stop();
    return { code: 1 };
  }

  // The Hot reload switch restarts the game server on the same port (D-32): the hub closes every
  // socket with 1012 first (U11) and keeps its token.
  editor.pages.attachServer(options, next => game.restart(next));
  const port = game.current().port ?? args.port;
  const release = writeDiscoveryFile(editor, port, { rootPath, htmlPath }, ui);
  printServing(ui, port, editor.hub.path(), rootPath);
  return { code: 0, stop: stopper(editor, game, release) };
}

/**
 * Parses and dispatches: help, an argument error, `mcp-config`, `mcp`, or serving the game (from a
 * re-spawned bin when `deps.reexec` asks for one: then the child's exit code).
 *
 * @param argv - Arguments after the script name.
 * @param deps - The bin deps.
 * @returns The exit code (0 help, mcp-config, the mcp bridge after stdin ended, or serving; 1
 * runtime error; 2 bad arguments) and,
 * while serving, the stop function.
 */
export async function startBin(argv: readonly string[], deps: CliDeps): Promise<Started> {
  const { ui } = deps;
  const args = parseBinArgs(argv);
  if (args.kind === "help") {
    printUsage(ui);
    return { code: 0 };
  }
  if (args.kind === "error") {
    ui.error(args.message);
    printUsage(ui);
    return { code: 2 };
  }
  if (args.kind === "mcp-config") {
    printMcpConfig(ui, args);
    return { code: 0 };
  }
  if (args.kind === "mcp") return { code: await runBridge(args) };

  const reexecCode = deps.reexec === undefined ? undefined : await reexecBin(args, deps.reexec);
  return reexecCode === undefined ? serveGame(args, deps) : { code: reexecCode };
}

/**
 * A handler that stops the bin once, prints "stopped" and exits 0.
 *
 * @param stop - The stop function of the running bin.
 * @param deps - The bin deps.
 * @returns The signal handler.
 */
export function stopOnce(stop: () => Promise<void>, deps: CliDeps): () => Promise<void> {
  let stopping = false;

  return async function onSignal(): Promise<void> {
    if (stopping) return;
    stopping = true;
    try {
      await stop();
    } catch (error) {
      deps.ui.error(messageOf(error));
    }
    deps.ui.info("stopped");
    deps.exit(0);
  };
}

/**
 * The Bun HTML import of the game page (run time, so Bun bundles it on demand).
 *
 * @param url - file: URL of the HTML file.
 * @returns The module.
 * @example
 * ```ts
 * const page = await importPage(pathToFileURL("web/index.html").href);
 * ```
 */
function importPage(url: string): Promise<PageModule> {
  return import(url);
}

/**
 * Exits this process.
 *
 * @param code - Exit code.
 */
function exit(code: number): void {
  // eslint-disable-next-line unicorn/no-process-exit -- the bin's own exit after SIGINT/SIGTERM
  process.exit(code);
}

/**
 * The deps of the real process.
 *
 * @returns Console, HTML import, exit and re-spawn of this process.
 * @example
 * ```ts
 * await main(Bun.argv.slice(2), processDeps());
 * ```
 */
function processDeps(): CliDeps {
  return { ui: createBrandConsole(), importPage, exit, reexec: processReexec() };
}

/**
 * Stops a serving bin once on SIGINT or SIGTERM; a re-spawned bin also once its parent is gone.
 *
 * @param stop - The stop function of the running bin.
 * @param deps - The bin deps.
 */
function stopOnSignals(stop: () => Promise<void>, deps: CliDeps): void {
  const onSignal = stopOnce(stop, deps);
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  if (deps.reexec === undefined) return;

  stopWithParent(deps.reexec, () => {
    void onSignal();
  });
}

/**
 * Runs the bin; resolves with the exit code (0 help or serving, 1 runtime error, 2 bad arguments).
 * A serving bin stops once on SIGINT or SIGTERM; a re-spawned one also when its parent is gone
 * (A4: a parent killed by SIGKILL forwards no signal).
 *
 * @param argv - Arguments after the script name.
 * @param deps - The bin deps (default: this process).
 * @returns The exit code.
 * @example
 * ```ts
 * process.exitCode = await main(Bun.argv.slice(2));
 * ```
 */
export async function main(
  argv: readonly string[],
  deps: CliDeps = processDeps()
): Promise<number> {
  const { code, stop } = await startBin(argv, deps);
  if (stop !== undefined) stopOnSignals(stop, deps);
  return code;
}

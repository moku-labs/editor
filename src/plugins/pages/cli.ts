/**
 * @file pages plugin — the moku-editor bin program: parse arguments, import the game HTML at run
 * time, start the server core, Bun.serve(hub.serve(...)) with Bun HMR on (off with `--no-hmr`), attach the server to
 * pages (hot reload), print the URLs through the branded console (MC1). The token is never
 * printed.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path/posix";
import { pathToFileURL } from "node:url";
import type { BrandConsole } from "@moku-labs/common/cli";
import { createBrandConsole } from "@moku-labs/common/cli";
import { createApp } from "../../server";
import { parseBinArgs } from "./args";
import { createStaticFetch } from "./static";

/**
 * The usage lines of `--help` and of an argument error.
 */
const USAGE = [
  "Usage: moku-editor <game-html> [--port 3000] [--root .] [--no-hmr] [--help]",
  "  --port, -p  port on 127.0.0.1 (0 = a random free port)",
  "  --root, -r  project root the editor reads and writes (default .)",
  "  --no-hmr    serve the game without hot reload (default: hot reload on)"
];

/**
 * How long stop waits for Bun's server stop before it gives up (it does not resolve while a
 * close is in flight).
 */
const STOP_GRACE_MS = 500;

/**
 * A module loaded from the game HTML file (a Bun HTML import: its default export is the bundle).
 */
export type PageModule = { readonly default?: unknown };

/**
 * What the bin talks to: the console, the HTML import and the process exit.
 */
export type CliDeps = {
  readonly ui: BrandConsole;
  readonly importPage: (url: string) => Promise<PageModule>;
  readonly exit: (code: number) => void;
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
 * Routes the warn and error log entries of the app to the branded console from now on (the
 * default console sink is removed).
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
      if (entry.level === "error") ui.error(line);
      else if (entry.level === "warn") ui.warn(line);
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
 * The stop function of a serving bin: the editor first (it closes its sockets), then the server,
 * bounded (Bun's stop does not resolve while a close is in flight).
 *
 * @param editor - The started editor.
 * @param server - The Bun server.
 * @param server.stop - Bun's stop.
 * @returns The stop function.
 */
function stopper(
  editor: EditorApp,
  server: { stop(force?: boolean): Promise<void> }
): () => Promise<void> {
  return async function stop(): Promise<void> {
    await editor.stop();
    await Promise.race([server.stop(true), Bun.sleep(STOP_GRACE_MS)]);
  };
}

/**
 * Parses, imports the game, starts the editor and serves; resolves while the server runs.
 *
 * @param argv - Arguments after the script name.
 * @param deps - The bin deps.
 * @returns The exit code (0 help or serving, 1 runtime error, 2 bad arguments) and, while
 * serving, the stop function.
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

  const htmlPath = resolve(args.html);
  const rootPath = resolve(args.root);
  const bundle = await importGame(htmlPath, deps);
  if (bundle === undefined) return { code: 1 };

  const editor = await startEditor(rootPath, ui);
  if (editor === undefined) return { code: 1 };

  let server: ReturnType<typeof Bun.serve>;
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
    server = Bun.serve(options);
  } catch (error) {
    const portTaken = `[moku-editor] port ${args.port} is in use · try --port ${args.port + 1}`;
    const message = isPortInUse(error) ? portTaken : `[moku-editor] ${messageOf(error)}`;
    ui.error(message);
    await editor.stop();
    return { code: 1 };
  }

  editor.pages.attachServer(server, options);
  printServing(ui, server.port ?? args.port, editor.hub.path(), rootPath);
  return { code: 0, stop: stopper(editor, server) };
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
 * @returns Console, HTML import and exit of this process.
 * @example
 * ```ts
 * await main(Bun.argv.slice(2), processDeps());
 * ```
 */
function processDeps(): CliDeps {
  return { ui: createBrandConsole(), importPage, exit };
}

/**
 * Runs the bin; resolves with the exit code (0 help or serving, 1 runtime error, 2 bad arguments).
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
  if (stop !== undefined) {
    const onSignal = stopOnce(stop, deps);
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  }
  return code;
}

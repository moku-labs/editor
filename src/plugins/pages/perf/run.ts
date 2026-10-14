/**
 * @file pages perf sub-domain — `moku-editor perf`: start the server core (files, hub, collector,
 * pages) without a game, turn on the hub's device mode with the terminal as the pairing prompt,
 * serve the tools page on the device port (unless `--no-ui`), print a live line per phone log,
 * write `.moku/perf.json` for `perf mark`, and on stop print the summary of every log written.
 */
import { relative, resolve } from "node:path/posix";
import type { BrandConsole } from "@moku-labs/common/cli";
import { createApp } from "../../../server";
import { parsePerfLog, summarize, summaryText } from "../../collector/report";
import type { CollectorSessionInfo } from "../../collector/types";
import type { DeviceListen } from "../../hub/types";
import type { Started } from "../types";
import { writePerfDiscovery } from "./discovery";
import { noGamePage } from "./home";
import { groupThousands } from "./live";
import { perfSink } from "./log";
import { mergePluginConfigs, perfConfigOf } from "./plugin-configs";
import { printPerfReady } from "./print";
import { pairPrompt } from "./prompt";
import type { PerfArgs, PerfDeps, ServerPluginConfigs } from "./types";

/** The editor app of a perf run. */
type PerfEditor = ReturnType<typeof createApp>;

/** The collector's default time between two adb reverse rounds, ms. */
const REVERSE_EVERY_MS = 2000;

/**
 * How long the stop waits after `hub.stopDevices()`: the collector emits each log's `done` from
 * its close queue, a few ticks after the hub's `stopped`, and `editor.stop()` would cut that emit.
 */
const DONE_SETTLE_MS = 50;

/**
 * The text of a thrown value.
 *
 * @param error - The thrown value.
 * @returns Its message.
 * @example
 * ```ts
 * messageOf(new Error("boom")); // "boom"
 * ```
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The release function when no discovery file was written.
 */
function keepNothing(): void {
  // Nothing was written, so nothing is removed.
}

/**
 * Creates and starts the editor with the run's plugin configs; the app log goes to the brand
 * console through the perf sink.
 *
 * @param configs - The merged plugin configs.
 * @param ui - The brand console.
 * @returns The started editor, or undefined after printing the error.
 */
async function startEditor(
  configs: ServerPluginConfigs,
  ui: BrandConsole
): Promise<PerfEditor | undefined> {
  try {
    const editor = createApp({ pluginConfigs: configs });
    editor.log.clearSinks();
    editor.log.addSink(perfSink(ui));
    await editor.start();
    return editor;
  } catch (error) {
    ui.error(messageOf(error));
    return undefined;
  }
}

/**
 * Turns device mode on with the terminal prompt and the no-game page; a failure (a taken port
 * prints the hub's two-line message) stops the editor.
 *
 * @param editor - The started editor.
 * @param deps - The process seam (ask).
 * @param ui - The brand console.
 * @returns Where device mode listens, or undefined after printing the error and stopping.
 */
async function listenOrStop(
  editor: PerfEditor,
  deps: PerfDeps,
  ui: BrandConsole
): Promise<DeviceListen | undefined> {
  try {
    return await editor.hub.listenDevices({
      confirm: pairPrompt(ui, deps.ask),
      routes: { "/": noGamePage() }
    });
  } catch (error) {
    ui.error(messageOf(error));
    await editor.stop();
    return undefined;
  }
}

/**
 * Writes `.moku/perf.json`; a failed write is a warning without the token, and the run goes on.
 *
 * @param editor - The started editor.
 * @param root - The root.
 * @param listen - Where device mode listens.
 * @param deps - The process seam (pid).
 * @param ui - The brand console.
 * @returns The release function, a no-op when nothing was written.
 */
function publishRun(
  editor: PerfEditor,
  root: string,
  listen: DeviceListen,
  deps: PerfDeps,
  ui: BrandConsole
): () => void {
  try {
    return writePerfDiscovery(root, {
      pid: deps.pid,
      port: listen.port,
      path: editor.hub.path(),
      token: editor.hub.token(),
      lan: listen.lan,
      startedAt: Date.now()
    });
  } catch (error) {
    ui.warn(`[moku-editor] could not write .moku/perf.json: ${messageOf(error)}`);
    return keepNothing;
  }
}

/**
 * Prints one log's count line and the summary of its file; a file that cannot be read is one
 * warning.
 *
 * @param log - The log as the collector reports it.
 * @param root - The root (paths print relative to it).
 * @param deps - The process seam (readText).
 * @param ui - The brand console.
 * @returns When the summary is printed.
 */
async function printLogSummary(
  log: CollectorSessionInfo,
  root: string,
  deps: PerfDeps,
  ui: BrandConsole
): Promise<void> {
  const name = relative(root, log.file);
  const lost = log.lost > 0 ? ` · ${groupThousands(log.lost)} lost` : "";
  ui.line("");
  ui.info(`log ${name} · ${groupThousands(log.lines)} lines${lost}`);
  try {
    const text = await deps.readText(log.file);
    for (const line of summaryText(summarize(parsePerfLog(text)))) ui.line(line);
  } catch (error) {
    ui.warn(`could not read ${name}: ${messageOf(error)}`);
  }
}

/**
 * Stops a perf run: the discovery file goes first; device mode stops while the app still runs,
 * so the collector marks every log done and the live hook prints each done line (teardown has no
 * emit); then the editor stops (the collector flushes and closes its files); then each log with
 * lines prints its summary (the records outlive the stop, with the final counts).
 *
 * @param editor - The started editor.
 * @param root - The root.
 * @param release - Removes `.moku/perf.json`.
 * @param deps - The process seam.
 * @param ui - The brand console.
 * @returns When the summaries are printed.
 */
async function stopRun(
  editor: PerfEditor,
  root: string,
  release: () => void,
  deps: PerfDeps,
  ui: BrandConsole
): Promise<void> {
  release();
  await editor.hub.stopDevices();
  await new Promise(settled => setTimeout(settled, DONE_SETTLE_MS));
  await editor.stop();

  for (const log of editor.collector.sessions()) {
    if (log.lines > 0) await printLogSummary(log, root, deps, ui);
  }
}

/**
 * Runs `moku-editor perf`: resolves once device mode listens and the ready block is printed.
 *
 * @param args - The run's arguments.
 * @param deps - The process seam (`processPerfDeps()` in the bin).
 * @param ui - The brand console.
 * @returns 0 with the stop function (it runs once, however often it is called), or 1 after a
 * start or listen failure (the editor stopped).
 * @example
 * ```ts
 * const { code, stop } = await runPerf({ kind: "perf", lan: false, port: 47600, out: ".moku/perf", every: 10, ui: true }, processPerfDeps(), ui);
 * // code 0; "Phones  127.0.0.1:47600 · adb reverse every 2 s" is printed; Ctrl+C runs stop()
 * ```
 */
export async function runPerf(args: PerfArgs, deps: PerfDeps, ui: BrandConsole): Promise<Started> {
  const root = resolve(deps.cwd());
  const appId = await deps.appIdOf(root);
  const configs = mergePluginConfigs(perfConfigOf(args, root, appId), deps.extraConfig);

  const editor = await startEditor(configs, ui);
  if (editor === undefined) return { code: 1 };
  const listen = await listenOrStop(editor, deps, ui);
  if (listen === undefined) return { code: 1 };

  editor.pages.attachPerf(ui);
  const release = publishRun(editor, root, listen, deps, ui);
  printPerfReady(ui, {
    listen,
    path: editor.hub.path(),
    tools: args.ui,
    logs: resolve(root, configs.collector?.out ?? args.out),
    engine: editor.files.engine().id,
    appId,
    reverseEveryMs: configs.collector?.reverseEveryMs ?? REVERSE_EVERY_MS
  });

  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopping ??= stopRun(editor, root, release, deps, ui);
    return stopping;
  };
  return { code: 0, stop };
}

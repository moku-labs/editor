/**
 * @file pages perf sub-domain — the ready block of a perf run, printed once device mode listens:
 * the lockup, a box with the phones' address, the LAN address (with `--lan`), the tools page
 * (without `--no-ui`), the log folder and the computer's engine, then what to do next. The token
 * is never printed.
 */
import type { BrandConsole } from "@moku-labs/common/cli";
import type { DeviceListen } from "../../hub/types";

/**
 * What the ready block shows.
 *
 * @example
 * ```ts
 * const ready: PerfReady = { listen, path: "/__editor", tools: true, logs: "/game/.moku/perf", engine: "0.14.12+9c41e0", appId: undefined, reverseEveryMs: 2000 };
 * ```
 */
export type PerfReady = {
  /** Where device mode listens. */
  readonly listen: DeviceListen;
  /** `hub.path()`. */
  readonly path: string;
  /** Whether the tools page is served (false with `--no-ui`). */
  readonly tools: boolean;
  /** The absolute log folder. */
  readonly logs: string;
  /** The computer's engine id (`files.engine().id`). */
  readonly engine: string;
  /** The game's app id, or undefined (gfx lines are off then). */
  readonly appId: string | undefined;
  /** Milliseconds between two adb reverse rounds. */
  readonly reverseEveryMs: number;
};

/**
 * Prints the ready block of a perf run.
 *
 * @param ui - The brand console.
 * @param ready - What the run knows.
 * @example
 * ```ts
 * printPerfReady(ui, { listen: { port: 47600, adb: "127.0.0.1:47600", lan: null }, path: "/__editor", tools: true, logs: "/game/.moku/perf", engine: "0.14.12+9c41e0", appId: undefined, reverseEveryMs: 2000 });
 * // "│ Phones  127.0.0.1:47600 · adb reverse every 2 s │" … "› Ctrl+C to stop"
 * ```
 */
export function printPerfReady(ui: BrandConsole, ready: PerfReady): void {
  const { listen, path, tools, logs, engine, appId, reverseEveryMs } = ready;
  const seconds = Math.round(reverseEveryMs / 1000);
  ui.lockup({ wordmark: "moku editor", label: "perf" });
  ui.box([
    `Phones  ${listen.adb} · adb reverse every ${seconds} s`,
    ...(listen.lan === null ? [] : [`LAN     ${listen.lan} · a phone pairs by its code`]),
    ...(tools ? [`Tools   http://${listen.adb}${path}/#render`] : []),
    `Logs    ${logs}`,
    `Engine  ${engine}`
  ]);
  ui.info(`Waiting for a phone: a debug build dials ${listen.adb} (moku-game build --debug).`);
  if (appId === undefined) {
    ui.info(
      "No app id: gfx lines are off. Set native.identifier in config.ts or pluginConfigs.collector.appId."
    );
  }
  ui.info("Ctrl+C to stop");
}

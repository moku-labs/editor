/**
 * @file activeSource plugin — lifecycle: onInit validates the config (two-line TypeErrors), onStart
 * subscribes to link's sessions and connect's published values (B2), onStop is state-only (spec/08
 * §2: no emit, no log): every subscription, timer, wait and listener dropped. onStop does not
 * resume the local preview: the page is going away, and its frame with it.
 */
import { linkPlugin } from "../link";
import { ERROR_PREFIX } from "../registry/protocol";
import { handleDirectory, handleTelemetry } from "./published";
import { handleSessions } from "./sessions";
import type { ActiveSourceConfig, ActiveSourceCtx, ActiveSourceStopCtx } from "./types";

/**
 * The whole-number fields: name, lowest, highest, and the default the message proposes.
 */
const RANGES = [
  ["rejoinMs", 0, 600_000, 15_000],
  ["noticeMs", 1000, 120_000, 12_000],
  ["renewMs", 500, 60_000, 4000],
  ["markers", 1, 512, 32]
] as const;

/**
 * How a refused value reads in the message: a string quoted, anything else as is.
 *
 * @param value - The value.
 * @returns Its text.
 * @example
 * ```ts
 * shown("yes"); // "\"yes\""
 * ```
 */
function shown(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/**
 * onInit: validates the config.
 *
 * @param ctx - A context with the resolved config.
 * @param ctx.config - The resolved config.
 * @throws {TypeError} `[moku-editor] activeSource.<field> is <value>.\n  Give true or false.` for a
 *   flag, `…\n  Give a whole number from <min> to <max>, for example <default>.` for a number.
 */
export function checkActiveSourceConfig(ctx: {
  readonly config: Readonly<ActiveSourceConfig>;
}): void {
  const { config } = ctx;
  for (const field of ["autoUse", "pauseLocal"] as const) {
    if (typeof config[field] !== "boolean") {
      throw new TypeError(
        `${ERROR_PREFIX}activeSource.${field} is ${shown(config[field])}.\n  Give true or false.`
      );
    }
  }
  for (const [field, min, max, example] of RANGES) {
    const value = config[field];
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new TypeError(
        `${ERROR_PREFIX}activeSource.${field} is ${shown(value)}.\n  Give a whole number from ${String(min)} to ${String(max)}, for example ${String(example)}.`
      );
    }
  }
}

/**
 * onStart: subscribes to link's session lists and connect's `editor.devices` and
 * `editor.deviceTelemetry`, and applies the list link already has.
 *
 * @param ctx - Domain context of activeSource.
 */
export function startActiveSource(ctx: ActiveSourceCtx): void {
  const link = ctx.require(linkPlugin);
  ctx.state.off.push(
    link.onSessions(list => handleSessions(ctx, list)),
    link.onPublished("devices", directory => handleDirectory(ctx, directory)),
    link.onPublished("deviceTelemetry", record => handleTelemetry(ctx, record))
  );
  const list = link.sessions();
  if (list.length > 0) handleSessions(ctx, list);
}

/**
 * onStop: state-only teardown. Unsubscribes, clears the renew interval and the notice timer,
 * cancels the connectDevice waits, drops the listeners; late callbacks then do nothing.
 *
 * @param ctx - The teardown context: own config and state.
 */
export function stopActiveSource(ctx: ActiveSourceStopCtx): void {
  const { state } = ctx;
  state.stopped = true;
  for (const off of state.off.splice(0)) off();
  clearInterval(state.timers.renew);
  clearTimeout(state.timers.notice);
  state.timers = { renew: undefined, notice: undefined };
  for (const cancel of state.waits) cancel();
  state.waits.clear();
  state.listeners.clear();
  state.telemetryListeners.clear();
}

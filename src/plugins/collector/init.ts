/**
 * @file collector plugin — the onInit body: the config checks (a two-line TypeError per field) and
 * the mark route, registered with hub.addRoutes before serve() or listenDevices() freeze the routes.
 */
import { hubPlugin } from "../hub";
import { markRouteOf } from "./route";
import type { CollectorConfig, CollectorCtx } from "./types";

/** The fewest and most seconds between two adb readings. */
const EVERY_S = { min: 1, max: 3600 } as const;

/** The fewest milliseconds of a reverse round period and an adb timeout. */
const MIN_MS = 500;

/** An Android application id: dotted segments, each starting with a letter. */
const APP_ID = /^[A-Za-z]\w*(\.[A-Za-z]\w*)+$/;

/**
 * A config value as the error shows it: strings quoted.
 *
 * @param value - The value.
 * @returns The text.
 * @example
 * ```ts
 * shown(""); // "\"\""
 * ```
 */
function shown(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/**
 * A config error in the two-line format.
 *
 * @param field - The field.
 * @param value - Its value.
 * @param fix - How to fix it, without the final period.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * configError("everyS", 0, "Use whole seconds from 1 to 3600").message; // "[moku-editor] collector.everyS is 0.\n  Use whole seconds from 1 to 3600."
 * ```
 */
function configError(field: keyof CollectorConfig, value: unknown, fix: string): TypeError {
  return new TypeError(`[moku-editor] collector.${field} is ${shown(value)}.\n  ${fix}.`);
}

/**
 * Whether a value is a whole number of at least `min` (and at most `max`).
 *
 * @param value - The value.
 * @param min - The least.
 * @param max - The most.
 * @returns Whether it is in range.
 * @example
 * ```ts
 * isWholeIn(1.5, 1); // false
 * ```
 */
function isWholeIn(value: number, min: number, max = Number.POSITIVE_INFINITY): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Checks the collector config: `out` and `adb` non-empty, `everyS` whole 1–3600, `reverseEveryMs`
 * and `adbTimeoutMs` whole ≥ 500, `appId` undefined or an Android application id.
 *
 * @param config - The resolved config.
 * @throws {TypeError} `[moku-editor] collector.<field> is <value>.` with the fix on a second line.
 */
export function validateCollectorConfig(config: Readonly<CollectorConfig>): void {
  const { out, everyS, reverseEveryMs, adb, adbTimeoutMs, appId } = config;
  if (typeof out !== "string" || out.length === 0)
    throw configError("out", out, 'Set it to a folder, for example ".moku/perf"');
  if (!isWholeIn(everyS, EVERY_S.min, EVERY_S.max)) {
    throw configError("everyS", everyS, "Use whole seconds from 1 to 3600, for example 10");
  }
  if (!isWholeIn(reverseEveryMs, MIN_MS)) {
    throw configError(
      "reverseEveryMs",
      reverseEveryMs,
      "Use whole milliseconds of 500 or more, for example 2000"
    );
  }
  if (typeof adb !== "string" || adb.length === 0)
    throw configError("adb", adb, 'Set it to the adb command, for example "adb"');
  if (!isWholeIn(adbTimeoutMs, MIN_MS)) {
    throw configError(
      "adbTimeoutMs",
      adbTimeoutMs,
      "Use whole milliseconds of 500 or more, for example 5000"
    );
  }
  if (appId !== undefined && !APP_ID.test(appId)) {
    throw configError(
      "appId",
      appId,
      'Use the Android package of the game, for example "com.example.garden"'
    );
  }
}

/**
 * collector's onInit: checks the config, then registers the mark route `{path}/perf/mark` on every
 * server (device mode off included).
 *
 * @param ctx - Domain context of the collector.
 * @throws {TypeError} For a bad config field (no route is registered then).
 */
export function initCollector(ctx: CollectorCtx): void {
  validateCollectorConfig(ctx.config);

  const hub = ctx.require(hubPlugin);
  hub.addRoutes({ [`${hub.path()}/perf/mark`]: markRouteOf(ctx, hub) });
}

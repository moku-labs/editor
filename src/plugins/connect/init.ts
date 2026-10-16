/**
 * @file connect plugin — onInit (spec 11 C9): the config is checked (two-line TypeErrors naming
 * the field and its rule), then the editor methods are registered on the hub, before the hub
 * freezes its routes in `serve()` / `listenDevices()`.
 */
import { hubPlugin } from "../hub";
import { createEditorMethods } from "./methods";
import type { ConnectConfig, ConnectCtx } from "./types";

/** The whole-number fields: name, lowest, highest, an example. */
const WHOLE_NUMBERS: readonly (readonly [keyof ConnectConfig, number, number, number])[] = [
  ["adbTimeoutMs", 500, 60_000, 5000],
  ["scanEveryMs", 500, 60_000, 2000],
  ["answerTimeoutMs", 1000, 300_000, 20_000],
  ["leaseMs", 2000, 120_000, 10_000],
  ["telemetryEveryMs", 250, 10_000, 1000],
  ["meminfoEveryMs", 1000, 60_000, 5000],
  ["heapEveryMs", 100, 5000, 250]
];

/**
 * A config value as the message shows it: text quoted, anything else as it prints.
 *
 * @param value - The value.
 * @returns Its text.
 * @example
 * ```ts
 * shown(""); // '""'
 * ```
 */
function shown(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/**
 * The two-line error of a field.
 *
 * @param field - The field.
 * @param value - Its value.
 * @param fix - The second line, without the indent and the period.
 * @returns The TypeError.
 * @example
 * ```ts
 * fieldError("heapEveryMs", 10, "Give a whole number from 100 to 5000, for example 250").message; // "[moku-editor] connect.heapEveryMs is 10.\n  Give a whole number from 100 to 5000, for example 250."
 * ```
 */
function fieldError(field: string, value: unknown, fix: string): TypeError {
  return new TypeError(`[moku-editor] connect.${field} is ${shown(value)}.\n  ${fix}.`);
}

/**
 * Checks the connect config.
 *
 * @param config - The resolved config.
 * @throws {TypeError} `[moku-editor] connect.<field> is <value>.` with the rule on the second line,
 * for the first field out of its rule.
 * @example
 * ```ts
 * validateConnectConfig({ ...config, heapEveryMs: 10 }); // throws "[moku-editor] connect.heapEveryMs is 10.\n  Give a whole number from 100 to 5000, for example 250."
 * ```
 */
export function validateConnectConfig(config: Readonly<ConnectConfig>): void {
  if (typeof config.adb !== "string" || config.adb.trim() === "") {
    throw fieldError(
      "adb",
      config.adb,
      'Give the adb command, a name on PATH or a path, for example "adb"'
    );
  }
  for (const [field, low, high, example] of WHOLE_NUMBERS) {
    const value = config[field];
    if (typeof value !== "number" || !Number.isInteger(value) || value < low || value > high) {
      throw fieldError(
        field,
        value,
        `Give a whole number from ${low} to ${high}, for example ${example}`
      );
    }
  }
  const drop = config.gcDropMb;
  if (typeof drop !== "number" || !Number.isFinite(drop) || drop < 0.05 || drop > 64) {
    throw fieldError("gcDropMb", drop, "Give a number from 0.05 to 64, for example 0.5");
  }
  if (typeof config.gcTrace !== "boolean") {
    throw fieldError("gcTrace", config.gcTrace, "Give true or false");
  }
  if (config.wire !== "manual" && config.wire !== "auto") {
    throw fieldError("wire", config.wire, 'Give "manual" or "auto"');
  }
}

/**
 * connect's onInit: checks the config and registers the editor methods on the hub.
 *
 * @param ctx - Domain context of connect.
 * @throws {TypeError} For a config field out of its rule (nothing is registered then).
 */
export function initConnect(ctx: ConnectCtx): void {
  validateConnectConfig(ctx.config);
  ctx.require(hubPlugin).addEditorMethods(createEditorMethods(ctx));
}

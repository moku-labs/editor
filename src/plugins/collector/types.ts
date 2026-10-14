/**
 * @file collector plugin — type definitions. The Wave 0 skeleton declares only the config; unit 04
 * adds the api, state, sessions, adb loop, event types and the report re-exports.
 */

/**
 * Collector configuration.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { collector: { out: "logs/perf", everyS: 5, appId: "com.example.garden" } } });
 * ```
 */
export type CollectorConfig = {
  /** Folder of the logs: relative to the files root, or absolute. Created on the first log. */
  out: string;
  /** Seconds between two adb readings (heat, system frames) of a phone. 1–3600. */
  everyS: number;
  /** Milliseconds between two `adb devices` + `adb reverse` rounds. ≥ 500. */
  reverseEveryMs: number;
  /** The adb command (a name on PATH or a path). */
  adb: string;
  /** The longest one adb command may run before it is killed. ≥ 500. */
  adbTimeoutMs: number;
  /**
   * The Android package of the game (its base identifier). The collector prefers `<appId>.debug` when
   * the phone has it (the debug build installs beside the store build), else `<appId>`. Undefined: no
   * gfx lines.
   */
  appId: string | undefined;
};

/**
 * @file registry plugin — the build of this page, from the engine's build flags (spec 10 F1/F3).
 * Each flag is read from `globalThis`: the agent is a separate module that never sees the folded
 * `define`, and every debug or dev page sets the flags as globals too. No engine import.
 */
import type { BuildInfo, BuildProfile } from "../protocol";

/**
 * True when the page sets the global to the boolean `true` (a string `"true"` is not a flag).
 *
 * @param name - The global's name.
 * @returns Whether the flag is on.
 * @example
 * ```ts
 * isFlag("__MOKU_GAME_AGENT__"); // true on a plain --debug build
 * ```
 */
function isFlag(name: string): boolean {
  return Reflect.get(globalThis, name) === true;
}

/**
 * The global's value when it is a string.
 *
 * @param name - The global's name.
 * @returns The string, or undefined.
 * @example
 * ```ts
 * stringOf("__MOKU_GAME_ENGINE__"); // "0.14.12+9c41e0" on a debug build
 * ```
 */
function stringOf(name: string): string | undefined {
  const value: unknown = Reflect.get(globalThis, name);

  return typeof value === "string" ? value : undefined;
}

/**
 * The profile of the page: dev first, then full, then read, else none.
 *
 * @returns The profile.
 * @example
 * ```ts
 * profileOf(); // "dev" on the dev server's page
 * ```
 */
function profileOf(): BuildProfile {
  if (isFlag("__MOKU_GAME_DEV__")) return "dev";
  if (isFlag("__MOKU_GAME_CONTROL__")) return "full";
  if (isFlag("__MOKU_GAME_AGENT__")) return "read";

  return "none";
}

/**
 * The build of this page, from the flags spec 10 sets (10:136-153): dev when `__MOKU_GAME_DEV__`
 * is true, full when `__MOKU_GAME_CONTROL__` is true, read when `__MOKU_GAME_AGENT__` is true, none
 * otherwise (a test without stubs, a release page). `id` and `engine` are present only when their
 * global is a string.
 *
 * @returns A fresh frozen BuildInfo.
 * @example
 * ```ts
 * readBuildInfo(); // { profile: "read", id: "debug-20261014T160000Z", engine: "0.14.12+9c41e0" }
 * ```
 */
export function readBuildInfo(): BuildInfo {
  const id = stringOf("__MOKU_GAME_BUILD__");
  const engine = stringOf("__MOKU_GAME_ENGINE__");

  return Object.freeze({
    profile: profileOf(),
    ...(id === undefined ? {} : { id }),
    ...(engine === undefined ? {} : { engine })
  });
}

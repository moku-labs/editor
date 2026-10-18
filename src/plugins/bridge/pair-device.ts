/**
 * @file bridge plugin — the page probe of device mode (pure): the build's editor address, the
 * native shell's device model and the user agent (`readFlags`), and what the phone tells the
 * computer about itself in `pair` (`pairDeviceOf`).
 */
import type { PairParams } from "../hub/protocol";
import type { BuildInfo } from "../registry/protocol";
import type { PageFlags } from "./types";

/**
 * The page scope the flags come from (`globalThis` in the agent).
 */
type FlagScope = {
  readonly __MOKU_GAME_EDITOR__?: unknown;
  readonly __MOKU_NATIVE__?: unknown;
  readonly navigator?: { readonly userAgent?: unknown };
};

/**
 * The device of a `pair`, being built.
 */
type PairDevice = { -readonly [K in keyof PairParams["device"]]: PairParams["device"][K] };

/** What follows the model in an Android user agent: "…; SM-A266B Build/…". */
const BUILD_MARK = " Build/";

/** The Android version in a user agent. */
const ANDROID_VERSION = /Android (\d+)/;

/** The iOS version in a user agent: "… OS 18_0 like Mac OS X". */
const IOS_VERSION = /OS (\d+)_/;

/**
 * The value when it is a non-empty string.
 *
 * @param value - Anything read from the page.
 * @returns The string, or undefined.
 * @example
 * ```ts
 * filled("127.0.0.1:47600"); // "127.0.0.1:47600"
 * ```
 */
function filled(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The native shell's device model, from `__MOKU_NATIVE__.model` when it is a string (the field
 * name is open on the native side; this guard is the one place to change).
 *
 * @param shell - The value of `__MOKU_NATIVE__`.
 * @returns The model, or undefined.
 * @example
 * ```ts
 * shellModel({ model: "Pixel 9" }); // "Pixel 9"
 * ```
 */
function shellModel(shell: unknown): string | undefined {
  if (typeof shell !== "object" || shell === null || !("model" in shell)) return undefined;
  return filled(shell.model);
}

/**
 * Reads the page flags once: `__MOKU_GAME_EDITOR__` (a debug build's computer address), the
 * native shell's model and `navigator.userAgent`. Every read is guarded: a missing or odd value
 * reads as undefined.
 *
 * @param scope - The page scope (`globalThis`).
 * @returns The flags.
 * @example
 * ```ts
 * readFlags({ __MOKU_GAME_EDITOR__: "127.0.0.1:47600" }).editor; // "127.0.0.1:47600"
 * ```
 */
export function readFlags(scope: FlagScope): PageFlags {
  return {
    editor: filled(scope.__MOKU_GAME_EDITOR__),
    model: shellModel(scope.__MOKU_NATIVE__),
    userAgent: filled(scope.navigator?.userAgent)
  };
}

/**
 * The model in an Android user agent: the text between the last ";" and " Build/".
 *
 * @param userAgent - The user agent.
 * @returns The model, or undefined.
 * @example
 * ```ts
 * androidModel("Mozilla/5.0 (Linux; Android 15; SM-A266B Build/AP3A)"); // "SM-A266B"
 * ```
 */
function androidModel(userAgent: string): string | undefined {
  const end = userAgent.indexOf(BUILD_MARK);
  const start = userAgent.lastIndexOf(";", end);
  if (end === -1 || start === -1) return undefined;
  const model = userAgent.slice(start + 1, end).trim();
  return model === "" ? undefined : model;
}

/**
 * The system of a user agent: "Android 15" or "iOS 18".
 *
 * @param userAgent - The user agent.
 * @returns The system, or undefined.
 * @example
 * ```ts
 * osOf("Mozilla/5.0 (Linux; Android 15; SM-A266B Build/AP3A)"); // "Android 15"
 * ```
 */
function osOf(userAgent: string): string | undefined {
  const android = ANDROID_VERSION.exec(userAgent)?.[1];
  if (android !== undefined) return `Android ${android}`;
  const ios = IOS_VERSION.exec(userAgent)?.[1];
  return ios === undefined ? undefined : `iOS ${ios}`;
}

/**
 * What the phone tells the computer in `pair`: the engine, build id and app id of the page (the
 * app id with its `.debug` suffix, as the build wrote it), the shell's model (else the Android user
 * agent's), the system from the user agent. A key without a value is left out.
 *
 * @param build - The page's build (`registry.build()`).
 * @param flags - The page flags.
 * @returns The `device` of PairParams.
 * @example
 * ```ts
 * pairDeviceOf({ profile: "read", engine: "0.14.12+9c41e0" }, { editor: undefined, model: "Pixel 9", userAgent: undefined });
 * // { engine: "0.14.12+9c41e0", model: "Pixel 9" }
 * ```
 */
export function pairDeviceOf(build: BuildInfo, flags: PageFlags): PairParams["device"] {
  const device: PairDevice = {};
  if (build.engine !== undefined) device.engine = build.engine;
  if (build.id !== undefined) device.build = build.id;
  if (build.appId !== undefined) device.appId = build.appId;

  const userAgent = flags.userAgent ?? "";
  const model = flags.model ?? androidModel(userAgent);
  if (model !== undefined) device.model = model;
  const os = osOf(userAgent);
  if (os !== undefined) device.os = os;
  return device;
}

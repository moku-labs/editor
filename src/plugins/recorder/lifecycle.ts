/**
 * @file recorder plugin — the lifecycle: the config checks, the monitor and the registry entries
 * (onInit); the store, the earlier logs, the subscription, the flush timer and autoStart (onStart);
 * the running log finished, the timer and the listener freed (onStop, without emit or log).
 */
import { perfPlugin } from "../perf";
import { registryPlugin } from "../registry";
import type { BuildProfile } from "../registry/protocol";
import { addRecorderEntries } from "./entries";
import { flushTick } from "./flush";
import { listen } from "./listener";
import { rotateIfFull } from "./rotate";
import { finishLog, originOf, startRecording } from "./session";
import { revokeDownloads } from "./share";
import { messageOf, openStore } from "./store";
import type { LogStore } from "./store/types";
import type { LogFileInfo, RecorderConfig, RecorderCtx, RecorderStopCtx } from "./types";

/** A numeric option and its range. */
type Rule = {
  readonly key: "keepMb" | "flushEveryMs" | "persistEveryMs" | "keepFiles" | "maxLogMb";
  readonly min: number;
  readonly max: number;
  readonly whole: boolean;
  readonly hint: string;
};

/** The numeric options, their ranges and the second line of their message. */
const RULES: readonly Rule[] = [
  {
    key: "keepMb",
    min: 1,
    max: 512,
    whole: false,
    hint: "Give megabytes from 1 to 512; 64 keeps about 12 hours of samples."
  },
  {
    key: "flushEveryMs",
    min: 100,
    max: 10_000,
    whole: false,
    hint: "Give milliseconds from 100 to 10000; 1000 serializes once a second."
  },
  {
    key: "persistEveryMs",
    min: 1000,
    max: 60_000,
    whole: false,
    hint: "Give milliseconds from 1000 to 60000; 5000 writes the store every five seconds."
  },
  {
    key: "keepFiles",
    min: 1,
    max: 100,
    whole: true,
    hint: "Give a whole number from 1 to 100; 10 keeps the last ten logs."
  },
  {
    key: "maxLogMb",
    min: 1,
    max: 512,
    whole: true,
    hint: "Give a whole number of megabytes from 1 to 512; 32 keeps every log shareable."
  }
];

/**
 * A config value as the message shows it: a string quoted.
 *
 * @param value - The value.
 * @returns Its text.
 * @example
 * ```ts
 * shown("disk"); // '"disk"'
 * ```
 */
function shown(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/**
 * Whether a value is an autoStart: true, false or "device".
 *
 * @param value - The config's value.
 * @returns Whether it is one of the three.
 * @example
 * ```ts
 * isAutoStart("yes"); // false
 * ```
 */
function isAutoStart(value: unknown): value is boolean | "device" {
  return value === true || value === false || value === "device";
}

/**
 * Checks the config, key by key, and throws for the first bad one: `keepMb` (1 to 512),
 * `flushEveryMs` (100 to 10000), `persistEveryMs` (1000 to 60000), `keepFiles` (whole, 1 to 100) and
 * `maxLogMb` (whole, 1 to 512) are numbers in their range; `autoStart` is true, false or "device";
 * `storage` is "auto" or "memory".
 *
 * @param config - The resolved config.
 * @throws {TypeError} `[moku-editor] recorder.<key> is <value>.\n  Give …` for the first bad key.
 */
export function checkRecorderConfig(config: Readonly<RecorderConfig>): void {
  // Numbers: each in its range, whole where the rule says so.
  for (const rule of RULES) {
    const value: unknown = config[rule.key];
    const fits =
      typeof value === "number" &&
      value >= rule.min &&
      value <= rule.max &&
      (!rule.whole || Number.isInteger(value));
    if (!fits) {
      throw new TypeError(`[moku-editor] recorder.${rule.key} is ${shown(value)}.\n  ${rule.hint}`);
    }
  }
  // autoStart: one of its three values.
  const autoStart: unknown = config.autoStart;
  if (!isAutoStart(autoStart)) {
    throw new TypeError(
      `[moku-editor] recorder.autoStart is ${shown(autoStart)}.\n  Give true, false or "device" (start a log on a debug build only).`
    );
  }
  // storage: one of its two values.
  const storage: unknown = config.storage;
  if (storage !== "auto" && storage !== "memory") {
    throw new TypeError(
      `[moku-editor] recorder.storage is ${shown(storage)}.\n  Give "auto" (OPFS when the page has it) or "memory" (never on disk).`
    );
  }
}

/**
 * onInit: checks the config, takes the monitor perf found and adds the registry entries. Without a
 * monitor logs `recorder:no-monitor` once.
 *
 * @param ctx - The recorder's context.
 */
export function initRecorder(ctx: RecorderCtx): void {
  checkRecorderConfig(ctx.config);
  const monitor = ctx.require(perfPlugin).monitor();
  ctx.state.monitor = monitor;
  addRecorderEntries(ctx);
  if (monitor === undefined) {
    ctx.log.info("recorder:no-monitor", {
      reason: "perf found no engine monitor; nothing is recorded"
    });
  }
}

/**
 * The logs an OPFS store kept, before the ones the recorder knows (a restart lists nothing twice).
 * A store that cannot be listed is warned and adds nothing.
 *
 * @param ctx - The recorder's context.
 * @param store - The OPFS store.
 * @returns The list.
 */
async function withStoredLogs(ctx: RecorderCtx, store: LogStore): Promise<LogFileInfo[]> {
  const known = new Set(ctx.state.files.map(file => file.name));
  try {
    const listed = await store.list();
    return [...listed.filter(file => !known.has(file.name)), ...ctx.state.files];
  } catch (error) {
    ctx.log.warn("recorder:list-failed", { message: messageOf(error) });
    return ctx.state.files;
  }
}

/** Ticks autoStart waits for the header a native shell holds back before it starts anyway. */
export const AUTOSTART_WAIT_TICKS = 10;

/**
 * A pending autoStart: starts the log (started by "auto") once the header is in, or at the last
 * tick of the wait without it.
 *
 * @param ctx - The recorder's context.
 */
function autoStartOnTick(ctx: RecorderCtx): void {
  const { state } = ctx;
  if (state.autoStartWait === 0) return;
  state.autoStartWait -= 1;
  if (state.header !== undefined || state.autoStartWait === 0) {
    startRecording(ctx, undefined, originOf("auto"));
  }
}

/**
 * One tick of the flush timer: a pending autoStart first, then the flush, then the rotation of a
 * log at maxLogMb; a throw of any is warned, never left to the timer.
 *
 * @param ctx - The recorder's context.
 */
function tick(ctx: RecorderCtx): void {
  try {
    autoStartOnTick(ctx);
    flushTick(ctx);
    rotateIfFull(ctx);
  } catch (error) {
    ctx.log.warn("recorder:flush-failed", { message: messageOf(error) });
  }
}

/**
 * Whether a page is a debug build: the registry's profile `read` (`--debug`) or `full`
 * (`--debug=full`), the builds with the agent flag on and the dev flag off.
 *
 * @param profile - The page's build profile.
 * @returns Whether it is a debug build.
 * @example
 * ```ts
 * isDebugBuild("dev"); // false
 * ```
 */
function isDebugBuild(profile: BuildProfile): boolean {
  return profile === "read" || profile === "full";
}

/**
 * Whether onStart starts a log: "device" on a debug build only (the registry's profile `read` or
 * `full`: agent flag on, dev flag off), true always, false never.
 *
 * @param autoStart - The config's autoStart.
 * @param profile - The page's build profile.
 * @returns Whether to start.
 * @example
 * ```ts
 * shouldAutoStart("device", "dev"); // false: a dev page records only when asked
 * ```
 */
export function shouldAutoStart(autoStart: boolean | "device", profile: BuildProfile): boolean {
  return autoStart === "device" ? isDebugBuild(profile) : autoStart;
}

/**
 * onStart: opens the store (OPFS may answer memory with a reason) and lists its logs. With a
 * monitor it subscribes to the stream and starts the flush timer. When autoStart says so for this
 * build (`shouldAutoStart`; never with the default `false`), it starts a log started by "auto": at
 * once when the header is in, else on the first tick that has it, at most AUTOSTART_WAIT_TICKS
 * later (a native shell holds the header back until it is ready).
 *
 * @param ctx - The recorder's context.
 */
export async function startRecorder(ctx: RecorderCtx): Promise<void> {
  const { state, config } = ctx;
  const { store, reason } = await openStore(config.storage);
  if (reason !== undefined) ctx.log.info("recorder:storage", { kind: "memory", reason });
  if (store.kind === "opfs") {
    state.store = store;
    state.files = await withStoredLogs(ctx, store);
  }

  const { monitor } = state;
  if (monitor === undefined) return;
  state.unsubscribe = monitor.stream(line => listen(state, line));
  state.timer = setInterval(() => tick(ctx), config.flushEveryMs);
  if (!shouldAutoStart(config.autoStart, ctx.require(registryPlugin).build().profile)) return;
  if (state.header === undefined) state.autoStartWait = AUTOSTART_WAIT_TICKS;
  else startRecording(ctx, undefined, originOf("auto"));
}

/**
 * onStop: clears the timer, revokes the download URLs still waiting, finishes a running log (its
 * errors swallowed: teardown reports nothing, and the text stays in the memory store), waits for
 * every log a stop or a rotation is still finishing, unsubscribes and drops the source watches.
 *
 * @param ctx - The teardown context: own config and state.
 */
export async function stopRecorder(ctx: RecorderStopCtx): Promise<void> {
  const { state } = ctx;
  clearInterval(state.timer);
  state.timer = undefined;
  state.autoStartWait = 0;
  revokeDownloads(state);
  await finishLog(state).catch(() => {});
  // A log a stop or a rotation is still finishing is finished before the teardown goes on.
  await Promise.all(state.finishing.values());
  state.unsubscribe?.();
  state.unsubscribe = undefined;
  state.watchers.clear();
}

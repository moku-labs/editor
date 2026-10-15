/**
 * @file recorder plugin — the lifecycle: the config checks, the monitor and the registry entries
 * (onInit); the store, the earlier logs, the subscription, the flush timer and autoStart (onStart);
 * the running log finished, the timer and the listener freed (onStop, without emit or log).
 */
import { perfPlugin } from "../perf";
import { addRecorderEntries } from "./entries";
import { flushTick } from "./flush";
import { listen } from "./listener";
import { finishLog, startRecording } from "./session";
import { messageOf, openStore } from "./store";
import type { LogStore } from "./store/types";
import type { LogFileInfo, RecorderConfig, RecorderCtx, RecorderStopCtx } from "./types";

/** A numeric option and its range. */
type Rule = {
  readonly key: "keepMb" | "flushEveryMs" | "persistEveryMs" | "keepFiles";
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
 * Checks the config: every number finite and in range (`keepFiles` whole), `storage` one of its two
 * values.
 *
 * @param config - The resolved config.
 * @throws {TypeError} `[moku-editor] recorder.<key> is <value>.\n  Give …` for the first bad key.
 */
export function checkRecorderConfig(config: Readonly<RecorderConfig>): void {
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

/**
 * One tick of the flush timer: a pending autoStart first (its header came after the subscribe),
 * then the flush; a throw is warned, never left to the timer.
 *
 * @param ctx - The recorder's context.
 */
function tick(ctx: RecorderCtx): void {
  if (ctx.state.autoStartPending) startRecording(ctx);
  try {
    flushTick(ctx);
  } catch (error) {
    ctx.log.warn("recorder:flush-failed", { message: messageOf(error) });
  }
}

/**
 * onStart: opens the store (OPFS may answer memory with a reason) and lists its logs. With a
 * monitor: subscribes to the stream, starts the flush timer and, with autoStart, starts a log —
 * at once when the header is in, else on the next tick (a native shell holds the header back
 * until it is ready).
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
  if (!config.autoStart) return;
  if (state.header === undefined) state.autoStartPending = true;
  else startRecording(ctx);
}

/**
 * onStop: clears the timer, finishes a running log (its errors swallowed: teardown reports nothing,
 * and the text stays in the memory store), unsubscribes and drops the source watches.
 *
 * @param ctx - The teardown context: own config and state.
 */
export async function stopRecorder(ctx: RecorderStopCtx): Promise<void> {
  const { state } = ctx;
  clearInterval(state.timer);
  state.timer = undefined;
  state.autoStartPending = false;
  await finishLog(state).catch(() => {});
  state.unsubscribe?.();
  state.unsubscribe = undefined;
  state.watchers.clear();
}

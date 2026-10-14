/**
 * @file registry plugin — the run event: every command entry the registry hands out emits
 * `registry:command` once its run settles, whoever ran it (the overlay, the bridge, an in-process
 * caller). The recorder hooks it and writes the log's one `command` line per run.
 */
import type { Log } from "@moku-labs/common/browser";
import type { EmitFn } from "@moku-labs/core";
import type { CommandVia, Json, RunResult } from "../protocol";
import type { CommandEntry, RegistryEvents } from "../types";
import { isInputError, messageOf } from "./failures";

/**
 * Wraps a command entry so its run emits `registry:command { id, input, via, ok }` when it
 * settles: `ok` true on resolve, false on reject (a refusal included); `input` is the raw input
 * (null when none), `via` the caller's (`"local"` when absent). A run whose input check refused
 * it (-32602) is not a run and emits nothing. A throwing emit is logged `registry:emit-failed` and
 * never changes the caller's result. The descriptor and `value()` are kept.
 *
 * @param entry - The command entry (a door, module or guarded editor entry).
 * @param emit - The registry's emit.
 * @param log - The registry log.
 * @returns The frozen wrapped entry.
 */
export function withRunEvent(
  entry: CommandEntry,
  emit: EmitFn<RegistryEvents>,
  log: Log.LogApi
): CommandEntry {
  const { id } = entry.descriptor;

  /**
   * Emits the event of one settled run; a throwing hook is logged, never rethrown.
   *
   * @param raw - The raw input of the run.
   * @param via - Who ran it.
   * @param ok - Whether the run resolved.
   */
  const settled = (raw: Json, via: CommandVia | undefined, ok: boolean): void => {
    try {
      // eslint-disable-next-line unicorn/no-null -- null is the wire value of "no input"
      emit("registry:command", { id, input: raw ?? null, via: via ?? "local", ok });
    } catch (error) {
      log.warn("registry:emit-failed", { id, message: messageOf(error) });
    }
  };

  return Object.freeze({
    ...entry,
    /**
     * Runs the inner entry and emits the run event when it settles.
     *
     * @param raw - Raw input (`null` = none).
     * @param via - Who runs it; absent: `"local"`.
     * @returns What the inner entry answered.
     */
    run: async (raw: Json, via?: CommandVia): Promise<RunResult> => {
      try {
        const result = await entry.run(raw, via);
        settled(raw, via, true);
        return result;
      } catch (error) {
        if (!isInputError(error)) settled(raw, via, false);
        throw error;
      }
    }
  });
}

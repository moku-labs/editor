/* eslint-disable unicorn/no-null -- null is "no log" in editor.record's value */
/**
 * @file recorder plugin — the registry entries: the mirrors `editor.record` and `editor.mark` (editor
 * commands, effect `cosmetic`: they change the log, never the game) and the source `editor.recorder`
 * of the tools page's device row (no probe: without a monitor it answers `monitor: false`).
 */
import { registryPlugin } from "../registry";
import { checkInput, toWireValue } from "../registry/protocol";
import { markLog } from "./marks";
import { startRecording, stopRecording } from "./session";
import { statusOf } from "./state";
import type { RecorderCtx } from "./types";

/** The input of `editor.record`. */
const RECORD_INPUT = { on: "boolean", label: "string?" } as const;

/** The input of `editor.mark`. */
const MARK_INPUT = { label: "string" } as const;

/**
 * Adds `editor.record`, `editor.mark` and `editor.recorder` to the registry (onInit).
 *
 * @param ctx - The recorder's context.
 */
export function addRecorderEntries(ctx: RecorderCtx): void {
  const registry = ctx.require(registryPlugin);
  const { state } = ctx;

  registry.add({
    descriptor: {
      id: "editor.record",
      title: "Record the performance log",
      input: RECORD_INPUT,
      effect: "cosmetic"
    },
    run: async raw => {
      const { on, label } = checkInput(RECORD_INPUT, raw);
      if (on) {
        return { value: { on, file: startRecording(ctx, label).name }, state: registry.envelope() };
      }
      const stopped = await stopRecording(ctx);
      return { value: { on, file: stopped?.name ?? null }, state: registry.envelope() };
    }
  });

  registry.add({
    descriptor: {
      id: "editor.mark",
      title: "Mark the performance log",
      input: MARK_INPUT,
      effect: "cosmetic"
    },
    run: async raw => {
      const { label } = checkInput(MARK_INPUT, raw);
      return { value: { marked: markLog(state, label) }, state: registry.envelope() };
    }
  });

  registry.add({
    descriptor: { id: "editor.recorder", title: "Performance log", input: {}, changes: "frame" },
    read: () => toWireValue(statusOf(state)),
    watch: (_raw, fn) => {
      const watcher = (): void => fn(toWireValue(statusOf(state)));
      state.watchers.add(watcher);
      return () => {
        state.watchers.delete(watcher);
      };
    }
  });
}

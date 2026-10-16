/* eslint-disable unicorn/no-null -- null is "no log", "no starter" and "no mark" in editor.record's value */
/**
 * @file recorder plugin — the registry entries: the mirrors `editor.record` and `editor.mark` (editor
 * commands, effect `cosmetic`: they change the log, never the game) and the source `editor.recorder`
 * of the tools page's device row and recording popover (no probe: without a monitor it answers
 * `monitor: false`). `editor.record` starts, stops and marks in one call, and names who started
 * the log from the `via` of its run (and an agent from the MCP client's name the hub stamped).
 */
import { registryPlugin } from "../registry";
import type { CommandVia, Json, RunResult } from "../registry/protocol";
import { checkInput, errorCode, toWireValue, wireError } from "../registry/protocol";
import { markLog } from "./marks";
import { originOf, startRecording, stopRecording } from "./session";
import { sourceOf, statusOf } from "./state";
import type { RecorderCtx, RecordStarter } from "./types";

/** The input of `editor.record`: start or stop, a label for a start, a mark. */
const RECORD_INPUT = { on: "boolean?", label: "string?", mark: "string?" } as const;

/** The input of `editor.mark`. */
const MARK_INPUT = { label: "string" } as const;

/** The refusal of an `editor.record` that asks for nothing. */
const NEEDS_ON_OR_MARK =
  '[moku-editor] editor.record needs on or mark.\n  Pass { on: true } to start, { on: false } to stop, { mark: "boss intro" } to mark.';

/** Who started a log, by the `via` of the run that started it (spec 05 Delta 2026-10-16 R2). */
const STARTERS: Readonly<Record<CommandVia, RecordStarter>> = {
  overlay: "phone",
  tools: "editor",
  mcp: "agent",
  bridge: "remote",
  local: "code"
};

/**
 * Who starts a log, by the `via` of the `editor.record` run: the phone's overlay, the tools page,
 * an agent through MCP, a hub that does not say (`bridge`), or the game's own code (`local`, none).
 *
 * @param via - The run's `via`.
 * @returns The starter.
 * @example
 * ```ts
 * starterOf("mcp"); // "agent"
 * ```
 */
export function starterOf(via: CommandVia | undefined): RecordStarter {
  return via === undefined ? "code" : STARTERS[via];
}

/**
 * Starts (`on: true`) or stops (`on: false`) the log, or leaves it (`on` absent).
 *
 * @param ctx - The recorder's context.
 * @param on - Start, stop, or neither.
 * @param label - A name for a start.
 * @param via - The run's `via`: who starts it.
 * @param client - The MCP client's name, with `via: "mcp"` only.
 * @returns The log's name: the started (or running) log, the stopped one, or the running one; null
 *   when there is none.
 */
async function switchLog(
  ctx: RecorderCtx,
  on: boolean | undefined,
  label: string | undefined,
  via: CommandVia | undefined,
  client: string | undefined
): Promise<string | null> {
  if (on === true) return startRecording(ctx, label, originOf(starterOf(via), client)).name;
  if (on === false) {
    const stopped = await stopRecording(ctx);
    return stopped?.name ?? null;
  }
  return ctx.state.session?.name ?? null;
}

/**
 * Runs `editor.record`: checks the input (`on` or a non-empty `mark`, else -32602), starts or stops
 * the log, then writes the mark, so `{ on: true, mark }` starts and marks in one call.
 *
 * @param ctx - The recorder's context.
 * @param raw - The raw input.
 * @param via - Who runs it.
 * @param client - The MCP client's name, with `via: "mcp"` only.
 * @returns `{ on, file, startedBy, marked }`: recording now, the log's name, who started it, the
 *   mark's answer (null without a mark); the envelope as `state`.
 * @throws {Error} A ProtocolError -32602 for a bad input or one that asks for nothing.
 */
async function runRecord(
  ctx: RecorderCtx,
  raw: Json,
  via: CommandVia | undefined,
  client: string | undefined
): Promise<RunResult> {
  const { on, label, mark } = checkInput(RECORD_INPUT, raw);
  const note = mark?.trim() ?? "";
  if (on === undefined && note === "") {
    throw wireError(errorCode.invalidInput, NEEDS_ON_OR_MARK, {
      reason: "invalid_input",
      retryable: false
    });
  }

  const file = await switchLog(ctx, on, label, via, client);
  const marked = note === "" ? null : markLog(ctx.state, note);
  const { startedBy } = statusOf(ctx.state);
  return {
    value: { on: ctx.state.session !== undefined, file, startedBy, marked },
    state: ctx.require(registryPlugin).envelope()
  };
}

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
    run: (raw, via, client) => runRecord(ctx, raw, via, client)
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
    read: () => toWireValue(sourceOf(state)),
    watch: (_raw, fn) => {
      const watcher = (): void => fn(toWireValue(sourceOf(state)));
      state.watchers.add(watcher);
      return () => {
        state.watchers.delete(watcher);
      };
    }
  });
}

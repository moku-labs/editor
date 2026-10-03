/**
 * @file channel plugin — the domain deps built from the plugin context, and the entry lookups
 * that turn an unknown id into a -32601 wire error.
 */
import { registryPlugin } from "../registry";
import type { Json } from "../registry/protocol";
import { errorCode, wireError } from "../registry/protocol";
import type { CommandEntry, SourceEntry } from "../registry/types";
import type { ChannelCtx, ChannelDeps, ChannelRegistry } from "./types";

/**
 * The raw wire input of "no input".
 */
// eslint-disable-next-line unicorn/no-null -- null is the wire value for "no input" (contracts §2)
const NO_INPUT: Json = null;

/**
 * Builds the domain deps of the channel modules from the plugin context.
 *
 * @param ctx - Domain context of the channel.
 * @returns Config, state, log and the registry slice the channel uses.
 */
export function depsOf(ctx: ChannelCtx): ChannelDeps {
  return {
    config: ctx.config,
    state: ctx.state,
    log: ctx.log,
    registry: ctx.require(registryPlugin)
  };
}

/**
 * The raw input an entry takes: the given input, or `null` when there is none.
 *
 * @param input - The caller's input.
 * @returns The raw Json for the entry.
 * @example
 * ```ts
 * rawOf(undefined); // null
 * rawOf({ frames: 1 }); // { frames: 1 }
 * ```
 */
export function rawOf(input: Json | undefined): Json {
  return input ?? NO_INPUT;
}

/**
 * Builds the -32601 error of an unknown id.
 *
 * @param id - The unknown id.
 * @param kind - "source" or "command".
 * @returns The wire error.
 * @example
 * ```ts
 * unknownId("game.nope", "source").message; // "[moku-editor] game.nope: unknown source"
 * ```
 */
function unknownId(id: string, kind: "source" | "command"): Error {
  return wireError(errorCode.unknownMethod, `${id}: unknown ${kind}`, {
    reason: "unknown_id",
    retryable: false,
    id
  });
}

/**
 * The source entry of an id.
 *
 * @param registry - The registry slice.
 * @param id - The source id.
 * @returns The entry.
 * @throws {Error} -32601 `[moku-editor] <id>: unknown source` with `data.id`.
 */
export function sourceOf(registry: ChannelRegistry, id: string): SourceEntry {
  const entry = registry.source(id);
  if (entry === undefined) throw unknownId(id, "source");
  return entry;
}

/**
 * The command entry of an id.
 *
 * @param registry - The registry slice.
 * @param id - The command id.
 * @returns The entry.
 * @throws {Error} -32601 `[moku-editor] <id>: unknown command` with `data.id`.
 */
export function commandOf(registry: ChannelRegistry, id: string): CommandEntry {
  const entry = registry.command(id);
  if (entry === undefined) throw unknownId(id, "command");
  return entry;
}

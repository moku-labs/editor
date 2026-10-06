/**
 * @file link plugin — the project index on the tools page. The hub publishes the files plugin's
 * `ProjectState` as `editor.project` and replays it on every socket open. link keeps the last one
 * frozen (also across reconnects) and emits each new one as `link:project` with the delta a view
 * drops by. The same state again (the replay) emits nothing.
 */
import type { Json, ProjectState } from "../../registry/protocol";
import { projectDelta } from "../../registry/protocol";
import { readProjectState } from "../rpc/shapes";
import type { LinkCtx } from "../types";

/**
 * Freezes a fresh parsed value and every object and array inside it.
 *
 * @param value - A value nobody else holds yet.
 * @returns The same value, frozen all the way down.
 * @example
 * ```ts
 * const state = freezeDeep({ state: "on", revision: "r1", defs: { "flow:board": ["flows/board.ts"] }, uses: {}, broken: {} });
 * Object.isFrozen(state.defs["flow:board"]); // true
 * ```
 */
function freezeDeep<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;

  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

/**
 * True when `next` says nothing new: both off with the same reason, or both on at the same
 * revision.
 *
 * @param held - The state link holds; undefined before the first.
 * @param next - The state that just arrived.
 * @returns Whether `next` is the held state again.
 * @example
 * ```ts
 * isSameProject({ state: "off", reason: "disabled" }, { state: "off", reason: "disabled" }); // true
 * isSameProject(undefined, { state: "off", reason: "disabled" }); // false
 * ```
 */
function isSameProject(held: ProjectState | undefined, next: ProjectState): boolean {
  if (held === undefined) return false;
  if (held.state === "off") return next.state === "off" && next.reason === held.reason;

  return next.state === "on" && next.revision === held.revision;
}

/**
 * Handles the params of an `editor.project` notification. A malformed state is the warning
 * `link:bad-project` and changes nothing; the held state again is dropped; any other state is
 * stored frozen and emitted as `link:project` with its delta.
 *
 * @param ctx - Domain context of link.
 * @param params - The notification params.
 */
export function onProjectNote(ctx: LinkCtx, params: Json | undefined): void {
  const next = readProjectState(params);
  if (next === undefined) {
    ctx.log.warn("link:bad-project", {});
    return;
  }

  const held = ctx.state.project;
  if (isSameProject(held, next)) return;

  const delta = freezeDeep(projectDelta(held, next));
  const state = freezeDeep(next);
  ctx.state.project = state;
  ctx.emit("link:project", { state, delta });
}

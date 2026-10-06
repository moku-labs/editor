/**
 * @file gameView plugin — a new project state (`link:project`, D-46): what gameView remembered of
 * the files a batch changed is dropped, so the next ask goes to the index again. `all` (a gap, the
 * first state, off) drops every key answer; else the answers in a changed or moved-from file and
 * of a removed `jsx:` key, with their style blocks. Projection answers always go. The manifest is
 * read again when it was read and the index names another or it changed. The selected element
 * looks its style up again when its file, its style file or the file of its refusal changed, or
 * the index did not know it (never during a stepper burst), and the style card says when its file
 * does not parse now.
 */
import type { ToolsEvents } from "../../../config";
import { manifestOf } from "../../panels/shared/project";
import { refId } from "../../panels/shared/scene";
import type { ProjectDelta, ProjectState } from "../../registry/protocol";
import { readManifest } from "../scene/manifest";
import { notify } from "../state";
import type { GameViewCtx, GameViewState } from "../types";
import { brokenError, openStyleCard } from "./styles";

/**
 * The files a batch touched: changed, appeared or vanished, and the files keys moved away from.
 *
 * @param delta - The delta of the project change.
 * @returns The paths.
 * @example
 * ```ts
 * changedPaths({ all: false, files: ["flows/board.ts"], moved: [{ key: "node:board/catchUp", from: "nodes/catch-up.ts", to: "nodes/board/catch-up.ts" }], removed: [] });
 * // Set { "flows/board.ts", "nodes/catch-up.ts" }
 * ```
 */
function changedPaths(delta: ProjectDelta): ReadonlySet<string> {
  return new Set([...delta.files, ...delta.moved.map(move => move.from)]);
}

/**
 * The ui key of the selected element in the scene.
 *
 * @param state - gameView state.
 * @returns The key, undefined for an entity, an unkeyed node or no selection.
 */
function selectedKey(state: GameViewState): string | undefined {
  const { selected, scene } = state;
  return selected?.kind === "ui" ? scene?.nodes.get(refId(selected))?.key : undefined;
}

/**
 * True when the style lookup of the selected element must run again: the index had no answer for
 * its key, or its key file, its style file or the file of its refusal changed.
 *
 * @param state - gameView state, before the answers are dropped.
 * @param changed - The files the batch touched.
 * @returns Whether to look again.
 */
function touchesSelected(state: GameViewState, changed: ReadonlySet<string>): boolean {
  const key = selectedKey(state);
  const { lookup, styles } = state;
  if (key === undefined) return false;
  if (lookup?.status === "missing") return true;

  const lookupPath = lookup !== undefined && "path" in lookup ? lookup.path : undefined;
  const paths = [state.found.get(key)?.path, styles?.path, lookupPath];
  return paths.some(path => path !== undefined && changed.has(path));
}

/**
 * Drops the key answers and style blocks a batch made stale.
 *
 * @param state - gameView state.
 * @param delta - The delta of the project change.
 * @param changed - The files the batch touched.
 */
function dropAnswers(
  state: GameViewState,
  delta: ProjectDelta,
  changed: ReadonlySet<string>
): void {
  if (delta.all) {
    state.found.clear();
    state.blocks.clear();
    return;
  }

  const removed = new Set(delta.removed);
  for (const [key, source] of state.found) {
    if (!changed.has(source.path) && !removed.has(`jsx:${key}`)) continue;
    state.found.delete(key);
    state.blocks.delete(key);
  }
  for (const [key, block] of state.blocks) {
    if (changed.has(block.path)) state.blocks.delete(key);
  }
}

/**
 * Reads the manifest again when it was read and the index now names another one, or it changed
 * on disk.
 *
 * @param ctx - Domain context of gameView.
 * @param project - The new project state.
 * @param delta - The delta of the project change.
 */
function refreshManifest(ctx: GameViewCtx, project: ProjectState, delta: ProjectDelta): void {
  const read = ctx.state.manifest;
  if (read === undefined) return;

  const named = manifestOf(project);
  const isStale =
    delta.all ||
    (read === null ? named !== undefined : read.path !== named || delta.files.includes(read.path));
  if (!isStale) return;

  ctx.state.manifest = undefined;
  void readManifest(ctx);
}

/**
 * Shows on the open style card whether its file does not parse now, and takes the `broken` text
 * away once it parses again.
 *
 * @param ctx - Domain context of gameView.
 */
function markBroken(ctx: GameViewCtx): void {
  const card = ctx.state.styles;
  if (card === undefined) return;

  const broken = brokenError(ctx, card.path);
  if (broken !== undefined) card.error = broken;
  else if (card.error?.error === "broken") card.error = undefined;
}

/**
 * Applies a new project state: drops the stale answers, the projection answers and a stale
 * manifest, marks a broken style card, and looks the selected element's style up again when the
 * batch touched it and no stepper burst waits.
 *
 * @param ctx - Domain context of gameView.
 * @param payload - The `link:project` payload: the state and its delta.
 */
export function applyProjectChange(ctx: GameViewCtx, payload: ToolsEvents["link:project"]): void {
  const { state } = ctx;
  const { delta } = payload;
  const changed = changedPaths(delta);
  const isTouched = delta.all || touchesSelected(state, changed);

  dropAnswers(state, delta, changed);
  state.spawns.clear();
  refreshManifest(ctx, payload.state, delta);
  markBroken(ctx);

  const { selected, styles } = state;
  // openStyleCard never rejects: a failed lookup shows "missing" and is logged there.
  if (isTouched && selected !== undefined && styles?.pending === undefined) {
    void openStyleCard(ctx, selected);
  }
  notify(state);
}

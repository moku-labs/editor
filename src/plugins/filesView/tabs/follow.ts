/**
 * @file filesView plugin — open tabs follow the project index (`link:project`, D-38). A tab whose
 * file an agent moved is replaced in place by a tab at the new path; the tabs of changed files are
 * re-read at once; a move, a gone key, a new path or a gone file rebuilds the tree. Each delta is
 * applied after the one before it.
 */
import { linkPlugin } from "../../link";
import type { ProjectDelta, ProjectMove } from "../../registry/protocol";
import { messageOf } from "../errors";
import { notify } from "../store";
import { revealPath } from "../tree/model";
import { buildIndex } from "../tree/walk";
import type { FilesViewCtx, OpenTab } from "../types";
import { kindOf } from "./kind";
import { markChecked, readFailure, revalidate, showReadFailure, storeText } from "./load";
import { findTab, isModified } from "./model";

/**
 * The status line of a tab that followed its file.
 *
 * @param from - The path the file left.
 * @returns The note.
 * @example
 * ```ts
 * movedText("nodes/catch-up.ts"); // "Moved from nodes/catch-up.ts"
 * ```
 */
export function movedText(from: string): string {
  return `Moved from ${from}`;
}

/**
 * The first move of each file: a file with several keys moves once.
 *
 * @param moved - The moves of a delta.
 * @returns The path a file left → its first move.
 * @example
 * ```ts
 * movesByFile([
 *   { key: "node:board/merge", from: "nodes/merge.ts", to: "nodes/board/merge.ts" },
 *   { key: "node:board/mergeHelper", from: "nodes/merge.ts", to: "nodes/board/merge.ts" }
 * ]).size; // 1: both keys left nodes/merge.ts
 * ```
 */
function movesByFile(moved: readonly ProjectMove[]): Map<string, ProjectMove> {
  const moves = new Map<string, ProjectMove>();
  for (const move of moved) {
    if (!moves.has(move.from)) moves.set(move.from, move);
  }
  return moves;
}

/**
 * True when the file of a path is gone: its read answers missing. A key can leave a file that
 * stays on disk; that tab does not move.
 *
 * @param ctx - Domain context of filesView.
 * @param path - The path a key left.
 * @returns Whether the file is gone.
 */
async function isGone(ctx: FilesViewCtx, path: string): Promise<boolean> {
  try {
    await ctx.require(linkPlugin).files.read(path);
    return false;
  } catch (error) {
    return readFailure(error).status === "missing";
  }
}

/**
 * The line of a moved key in its new file, read from disk by the index. Only an answer at the
 * new path counts: the line of another file means nothing in this tab.
 *
 * @param ctx - Domain context of filesView.
 * @param move - The move.
 * @returns The line, or undefined when `find` fails or has no answer at `move.to`.
 */
async function lineOf(ctx: FilesViewCtx, move: ProjectMove): Promise<number | undefined> {
  try {
    const answers = await ctx.require(linkPlugin).files.find(move.key);
    return answers.find(found => found.path === move.to)?.line;
  } catch {
    return undefined;
  }
}

/**
 * Puts a tab at the new path in the place of the old one. Buffer, saved text, version, edit mode
 * and mode stay; the active tab, its reveal and the discard popover follow.
 *
 * @param ctx - Domain context of filesView.
 * @param tab - The tab at the old path.
 * @param to - The new path.
 * @returns The new tab.
 */
function replaceTab(ctx: FilesViewCtx, tab: OpenTab, to: string): OpenTab {
  const { state } = ctx;
  const moved: OpenTab = { ...tab, path: to, kind: kindOf(to) };
  state.tabs[state.tabs.indexOf(tab)] = moved;

  if (state.active === tab.path) {
    state.active = to;
    revealPath(state.expanded, to);
  }
  if (state.confirmClose === tab.path) state.confirmClose = to;
  return moved;
}

/**
 * Reads the new path of a moved tab: the same version only checks it; other bytes replace a
 * clean tab and put a modified one in conflict. A failed read shows on the tab.
 *
 * @param ctx - Domain context of filesView.
 * @param tab - The moved tab.
 * @returns Whether the read succeeded.
 */
async function readMoved(ctx: FilesViewCtx, tab: OpenTab): Promise<boolean> {
  try {
    const { text, version } = await ctx.require(linkPlugin).files.read(tab.path);
    if (version === tab.version) markChecked(tab);
    else if (isModified(tab)) tab.status = "conflict";
    else storeText(tab, text, version);
    return true;
  } catch (error) {
    showReadFailure(ctx, tab, error);
    return false;
  }
}

/**
 * Follows one move: a text tab at `from` whose file is gone becomes a tab at `to`, at the line of
 * the key, with the note "Moved from <from>". A tab that loads or saves, a file still on disk and
 * a path that already has a tab are left alone.
 *
 * @param ctx - Domain context of filesView.
 * @param move - The first move of a file.
 * @returns The new tab, or undefined when no tab followed.
 */
async function followMove(ctx: FilesViewCtx, move: ProjectMove): Promise<OpenTab | undefined> {
  const tab = findTab(ctx.state, move.from);
  const busy = tab?.status === "loading" || tab?.status === "saving";
  if (tab === undefined || tab.kind === "image" || busy) return undefined;
  if (!(await isGone(ctx, move.from))) return undefined;

  // The tabs may have changed while the read ran.
  const taken = findTab(ctx.state, move.to) !== undefined;
  if (taken || !ctx.state.tabs.includes(tab)) return undefined;

  const moved = replaceTab(ctx, tab, move.to);
  notify(ctx.state);
  if (await readMoved(ctx, moved)) moved.message = movedText(move.from);

  const line = await lineOf(ctx, move);
  if (line !== undefined) moved.line = line;
  return moved;
}

/**
 * The tabs a delta re-reads: every tab after a revision gap, else the tabs of changed, vanished
 * and left files. A tab that just followed its file is already read.
 *
 * @param ctx - Domain context of filesView.
 * @param delta - The delta.
 * @param followed - The tabs that followed a move.
 * @returns The tabs.
 */
function staleTabs(
  ctx: FilesViewCtx,
  delta: ProjectDelta,
  followed: ReadonlySet<OpenTab>
): OpenTab[] {
  const changed = new Set([...delta.files, ...delta.moved.map(move => move.from)]);
  return ctx.state.tabs.filter(tab => !followed.has(tab) && (delta.all || changed.has(tab.path)));
}

/**
 * True when the file tree is out of date: a move, a gone key, a changed path the tree does not
 * have, or a re-read tab whose file is gone but still in the tree. Without a tree there is
 * nothing to rebuild (the start or the next `link:status` builds it).
 *
 * @param ctx - Domain context of filesView.
 * @param delta - The delta.
 * @param checked - The tabs just re-read.
 * @returns Whether to rebuild the tree.
 */
function treeChanged(ctx: FilesViewCtx, delta: ProjectDelta, checked: readonly OpenTab[]): boolean {
  const { index } = ctx.state;
  if (index === undefined) return false;
  if (delta.moved.length > 0 || delta.removed.length > 0) return true;
  if (delta.files.some(path => !index.files.has(path))) return true;
  return checked.some(tab => tab.status === "missing" && index.files.has(tab.path));
}

/**
 * Applies one delta: moves first, then the re-reads, then the tree (not awaited).
 *
 * @param ctx - Domain context of filesView.
 * @param delta - The delta.
 * @returns When the tabs are done.
 */
async function applyDelta(ctx: FilesViewCtx, delta: ProjectDelta): Promise<void> {
  const followed = new Set<OpenTab>();
  for (const move of movesByFile(delta.moved).values()) {
    const tab = await followMove(ctx, move);
    if (tab !== undefined) followed.add(tab);
  }

  const stale = staleTabs(ctx, delta, followed);
  await Promise.all(stale.map(tab => revalidate(ctx, tab, true)));

  if (treeChanged(ctx, delta, stale)) void buildIndex(ctx);
  notify(ctx.state);
}

/**
 * Applies a project delta to the open tabs once the delta before it is done, and notifies at once
 * (Used by reads the new state). `state.following` is the work in flight. Never rejects: a
 * failure is warned.
 *
 * @param ctx - Domain context of filesView.
 * @param delta - The delta of a `link:project`.
 * @returns When this delta is applied.
 */
export function followProject(ctx: FilesViewCtx, delta: ProjectDelta): Promise<void> {
  const { state } = ctx;
  const before = state.following ?? Promise.resolve();

  const run: Promise<void> = before
    .then(() => applyDelta(ctx, delta))
    .catch((error: unknown) => {
      ctx.log.warn("filesView:follow-failed", { message: messageOf(error) });
    })
    .finally(() => {
      if (state.following === run) state.following = undefined;
    });
  state.following = run;

  notify(state);
  return run;
}

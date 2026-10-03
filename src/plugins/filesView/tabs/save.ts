/**
 * @file filesView plugin — the save flow: every write carries the version; an unchanged buffer
 * writes nothing; a stale version is a conflict (Reload / Overwrite); a game source saved
 * outside `.moku/` while live or paused runs the D-07 reload (workspace bookmarks, reloads the
 * frame and restores).
 */
import { linkPlugin } from "../../link";
import { errorCode, SOURCE_OVERRIDES_PATH } from "../../registry/protocol";
import { workspacePlugin } from "../../workspace";
import { codeOf, messageOf, reasonOf } from "../errors";
import { loadOverrides, rebuildUsedBy } from "../links/used-by";
import { notify } from "../store";
import type { Config, FilesViewCtx, OpenTab, SaveResult } from "../types";
import { extensionOf } from "./kind";
import { readFailure, storeText } from "./load";
import { findTab } from "./model";

/**
 * How long "✓ No changes" stays in the status line.
 */
export const NO_CHANGES_MS = 2000;

/**
 * The save note of an unchanged buffer.
 */
export const NO_CHANGES_MESSAGE = "✓ No changes";

/**
 * The result of a save with nothing to write.
 */
const NOTHING_TO_SAVE: SaveResult = { kind: "failed", code: undefined, message: "Nothing to save" };

/**
 * True when a save of the path reloads the game: not under `.moku/`, and the extension is one
 * of `reloadExtensions`.
 *
 * @param path - Relative file path.
 * @param config - filesView config.
 * @returns Whether the D-07 reload applies.
 * @example
 * ```ts
 * shouldReload("nodes/merge.ts", config); // true
 * ```
 */
export function shouldReload(path: string, config: Readonly<Config>): boolean {
  return !path.startsWith(".moku/") && config.reloadExtensions.includes(extensionOf(path));
}

/**
 * True while a game is linked: the reload has a session to restore.
 *
 * @param ctx - Domain context of filesView.
 * @returns Whether the link is live or paused.
 */
function isLinked(ctx: FilesViewCtx): boolean {
  const { kind } = ctx.require(linkPlugin).status();
  return kind === "live" || kind === "paused";
}

/**
 * After a write: the index entry size, the toast, the overrides when the override file was
 * saved, and the D-07 reload (not awaited; a failure is warned).
 *
 * @param ctx - Domain context of filesView.
 * @param path - The written path.
 * @param bytes - Bytes written.
 * @returns Whether the reload ran.
 */
async function afterWrite(ctx: FilesViewCtx, path: string, bytes: number): Promise<boolean> {
  const { state } = ctx;
  const workspace = ctx.require(workspacePlugin);
  const entry = state.index?.files.get(path);
  if (entry !== undefined) state.index?.files.set(path, { ...entry, size: bytes });

  workspace.toast("✓ Saved", path);
  if (path === SOURCE_OVERRIDES_PATH) {
    state.overrides = await loadOverrides(ctx);
    rebuildUsedBy(ctx);
  }

  const reload = shouldReload(path, ctx.config) && isLinked(ctx);
  if (reload) {
    workspace
      .gameFrame()
      .reload({ restore: true })
      .catch((error: unknown) => {
        ctx.log.warn("filesView:reload-failed", { message: messageOf(error) });
      });
  }
  return reload;
}

/**
 * Writes the buffer with a version (steps 3–6 of the save flow).
 *
 * @param ctx - Domain context of filesView.
 * @param tab - A ready tab with a buffer.
 * @param text - The buffer to write.
 * @param version - The version it replaces; undefined re-creates a missing file.
 * @returns The save result.
 */
async function write(
  ctx: FilesViewCtx,
  tab: OpenTab,
  text: string,
  version: string | undefined
): Promise<SaveResult> {
  tab.status = "saving";
  tab.message = undefined;
  notify(ctx.state);

  try {
    const result = await ctx.require(linkPlugin).files.write(tab.path, text, version);
    tab.saved = text;
    tab.version = result.version;
    tab.checkedAt = Date.now();
    tab.status = "ready";
    const reload = await afterWrite(ctx, tab.path, result.bytes);
    notify(ctx.state);
    return { kind: "saved", path: tab.path, bytes: result.bytes, version: result.version, reload };
  } catch (error) {
    const code = codeOf(error);
    if (reasonOf(error) === "version_conflict" || code === errorCode.versionConflict) {
      tab.status = "conflict";
      notify(ctx.state);
      return { kind: "conflict" };
    }
    const message = messageOf(error);
    tab.status = "ready";
    tab.message = message;
    ctx.log.error("filesView:save-failed", { path: tab.path, code });
    notify(ctx.state);
    return { kind: "failed", code, message };
  }
}

/**
 * Shows "✓ No changes" for NO_CHANGES_MS (a newer message stays).
 *
 * @param ctx - Domain context of filesView.
 * @param tab - The tab.
 */
function noteNoChanges(ctx: FilesViewCtx, tab: OpenTab): void {
  tab.message = NO_CHANGES_MESSAGE;
  notify(ctx.state);
  setTimeout(() => {
    if (tab.message !== NO_CHANGES_MESSAGE) return;
    tab.message = undefined;
    notify(ctx.state);
  }, NO_CHANGES_MS);
}

/**
 * The save flow of a tab: nothing to save, no changes, conflict while in conflict, else a
 * versioned write. Never rejects.
 *
 * @param ctx - Domain context of filesView.
 * @param path - The tab's path.
 * @returns The save result.
 */
export async function saveTab(ctx: FilesViewCtx, path: string): Promise<SaveResult> {
  const tab = findTab(ctx.state, path);
  if (tab?.status === "conflict") return { kind: "conflict" };
  if (tab?.status !== "ready" || tab.buffer === undefined) return NOTHING_TO_SAVE;
  if (tab.buffer === tab.saved) {
    noteNoChanges(ctx, tab);
    return { kind: "unchanged" };
  }
  return write(ctx, tab, tab.buffer, tab.version);
}

/**
 * A failed read while resolving a conflict: the tab keeps its status and buffer, the status line
 * shows why.
 *
 * @param ctx - Domain context of filesView.
 * @param tab - The tab.
 * @param error - What link rejected with.
 * @returns The failed result.
 */
function failedRead(ctx: FilesViewCtx, tab: OpenTab, error: unknown): SaveResult {
  const failure = readFailure(error);
  tab.message = failure.message;
  ctx.log.warn("filesView:read-failed", { path: tab.path, code: failure.code });
  notify(ctx.state);
  return { kind: "failed", code: failure.code, message: failure.message };
}

/**
 * "Reload": re-reads the file and drops the buffer; edit mode stays.
 *
 * @param ctx - Domain context of filesView.
 * @param tab - The tab.
 * @returns `{ kind: "unchanged" }`, or the failed read.
 */
async function reloadTab(ctx: FilesViewCtx, tab: OpenTab): Promise<SaveResult> {
  try {
    const { text, version } = await ctx.require(linkPlugin).files.read(tab.path);
    storeText(tab, text, version);
    notify(ctx.state);
    return { kind: "unchanged" };
  } catch (error) {
    return failedRead(ctx, tab, error);
  }
}

/**
 * "Overwrite": re-reads only the version, then writes the buffer over it; a missing file is
 * re-created without a version. Another change in between conflicts again.
 *
 * @param ctx - Domain context of filesView.
 * @param tab - The tab.
 * @returns The save result.
 */
async function overwriteTab(ctx: FilesViewCtx, tab: OpenTab): Promise<SaveResult> {
  let version: string | undefined;
  try {
    ({ version } = await ctx.require(linkPlugin).files.read(tab.path));
  } catch (error) {
    if (readFailure(error).status !== "missing") return failedRead(ctx, tab, error);
  }
  if (tab.buffer === undefined) return NOTHING_TO_SAVE;
  return write(ctx, tab, tab.buffer, version);
}

/**
 * Resolves a conflict: "reload" re-reads the file and drops the buffer (edit mode stays);
 * "overwrite" re-reads only the version and writes the buffer over it. Never rejects.
 *
 * @param ctx - Domain context of filesView.
 * @param path - The tab's path.
 * @param choice - "reload" or "overwrite".
 * @returns `{ kind: "unchanged" }` after a reload, else the save result.
 */
export function resolveConflict(
  ctx: FilesViewCtx,
  path: string,
  choice: "reload" | "overwrite"
): Promise<SaveResult> {
  const tab = findTab(ctx.state, path);
  if (tab === undefined || tab.kind === "image") return Promise.resolve(NOTHING_TO_SAVE);
  return choice === "reload" ? reloadTab(ctx, tab) : overwriteTab(ctx, tab);
}

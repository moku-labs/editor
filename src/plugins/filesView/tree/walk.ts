/**
 * @file filesView plugin — the tree walk: breadth first from the root with WALK_CONCURRENCY
 * parallel `link.files.list` calls, the WALK_MAX_DEPTH cap and the `maxFiles` cap, single
 * flight. The server already hides denied folders (files spec), so nothing is filtered here.
 */
import { linkPlugin } from "../../link";
import type { FilesClient } from "../../link/types";
import type { FileEntry, LinkStatus } from "../../registry/protocol";
import { codeOf, messageOf } from "../errors";
import { notify } from "../store";
import type { FileIndex, FilesViewCtx } from "../types";
import { WALK_CONCURRENCY, WALK_MAX_DEPTH } from "../types";
import { replacePaletteItems } from "./palette";

/**
 * True when the link has an open socket, so `link.files.list` can answer: not while it still
 * connects and not while it is lost. A walk started then fails at once with -32002, so the index
 * waits for the first `link:status` with an open socket instead.
 *
 * @param status - The link status.
 * @returns Whether a walk can list now.
 * @example
 * ```ts
 * canList({ kind: "connecting" }); // false
 * canList({ kind: "empty" }); // true: no game, but the files of the root list
 * ```
 */
export function canList(status: LinkStatus): boolean {
  return status.kind !== "connecting" && status.kind !== "lost";
}

/**
 * One folder listing: the entries, or undefined when the list failed.
 */
type Listing = readonly FileEntry[] | undefined;

/**
 * What one level of the walk produced.
 */
type Walked = {
  readonly files: Map<string, FileEntry>;
  readonly children: Map<string, readonly string[]>;
  truncated: boolean;
};

/**
 * Lists one folder; a failure is warned and gives undefined.
 *
 * @param ctx - Domain context of filesView.
 * @param client - The files client.
 * @param dir - Folder path.
 * @returns The entries, or undefined.
 */
async function listOne(ctx: FilesViewCtx, client: FilesClient, dir: string): Promise<Listing> {
  try {
    return await client.list(dir);
  } catch (error) {
    ctx.log.warn("filesView:list-failed", { dir, code: codeOf(error) });
    return undefined;
  }
}

/**
 * Lists folders with at most WALK_CONCURRENCY calls in flight; results keep the folder order.
 *
 * @param ctx - Domain context of filesView.
 * @param client - The files client.
 * @param directories - Folder paths.
 * @returns One listing per folder.
 */
async function listAll(
  ctx: FilesViewCtx,
  client: FilesClient,
  directories: readonly string[]
): Promise<Listing[]> {
  const results = Array.from<Listing>({ length: directories.length });
  const cursor = { next: 0 };
  const workers = Array.from(
    { length: Math.min(WALK_CONCURRENCY, directories.length) },
    async () => {
      while (cursor.next < directories.length) {
        const position = cursor.next;
        cursor.next += 1;
        results[position] = await listOne(ctx, client, directories[position] ?? "");
      }
    }
  );
  await Promise.all(workers);
  return results;
}

/**
 * Records one folder's listing: folders first (server order inside each group), files until the
 * cap. Returns the sub-folders to list next.
 *
 * @param walked - The index being built.
 * @param dir - The folder.
 * @param entries - Its listing.
 * @param maxFiles - The file cap.
 * @returns The sub-folders.
 */
function record(
  walked: Walked,
  dir: string,
  entries: readonly FileEntry[],
  maxFiles: number
): string[] {
  const folders = entries.filter(entry => entry.kind === "dir").map(entry => entry.path);
  const kept = [...folders];
  for (const folder of folders) walked.children.set(folder, []);

  for (const entry of entries) {
    if (entry.kind !== "file") continue;
    if (walked.files.size >= maxFiles) {
      walked.truncated = true;
      break;
    }
    walked.files.set(entry.path, entry);
    kept.push(entry.path);
  }
  walked.children.set(dir, kept);
  return folders;
}

/**
 * Lists one level of folders and records their listings; returns the folders of the next level
 * (none past the depth cap).
 *
 * @param ctx - Domain context of filesView.
 * @param walked - The index being built.
 * @param level - The folders of this level.
 * @param depth - Their depth (the root is 0).
 * @returns The next level, or undefined when the root list failed.
 */
async function walkLevel(
  ctx: FilesViewCtx,
  walked: Walked,
  level: readonly string[],
  depth: number
): Promise<string[] | undefined> {
  const listings = await listAll(ctx, ctx.require(linkPlugin).files, level);
  if (depth === 0 && listings[0] === undefined) return undefined;

  const next: string[] = [];
  for (const [position, dir] of level.entries()) {
    const entries = listings[position];
    if (entries === undefined) continue;
    const folders = record(walked, dir, entries, ctx.config.maxFiles);
    if (walked.truncated) break;
    if (depth < WALK_MAX_DEPTH) next.push(...folders);
  }
  return next;
}

/**
 * The walk itself: level by level, until no folder is left, the depth cap or the file cap.
 *
 * @param ctx - Domain context of filesView.
 * @returns The index, or undefined when the root list failed.
 */
async function walk(ctx: FilesViewCtx): Promise<FileIndex | undefined> {
  const walked: Walked = { files: new Map(), children: new Map(), truncated: false };
  let level: string[] | undefined = [""];
  let depth = 0;

  while (level.length > 0 && !walked.truncated) {
    level = await walkLevel(ctx, walked, level, depth);
    if (level === undefined) return undefined;
    depth += 1;
  }
  return { ...walked, builtAt: Date.now() };
}

/**
 * One walk into the state: the index and the palette items. A failing root list leaves the index
 * as it was. Never rejects: a failure is warned.
 *
 * @param ctx - Domain context of filesView.
 * @returns When the walk is stored.
 */
async function indexOnce(ctx: FilesViewCtx): Promise<void> {
  try {
    const index = await walk(ctx);
    if (index === undefined) return;
    ctx.state.index = index;
    replacePaletteItems(ctx);
  } catch (error) {
    ctx.log.warn("filesView:index-failed", { message: messageOf(error) });
  }
}

/**
 * Builds the file index, then replaces the palette items and notifies. Single flight: a call
 * while a walk runs gets that walk, marks the index dirty (`state.indexDirty`) and the walk runs
 * once more after it, since it may have listed a folder before the change that asked. Never
 * rejects.
 *
 * @param ctx - Domain context of filesView.
 * @returns When the build is done, the walk once more included.
 */
export function buildIndex(ctx: FilesViewCtx): Promise<void> {
  const { state } = ctx;
  if (state.indexing !== undefined) {
    state.indexDirty = true;
    return state.indexing;
  }

  const run = (async () => {
    try {
      await indexOnce(ctx);
    } finally {
      state.indexing = undefined;
      notify(state);
    }

    // A call during the walk asked again: walk once more, after this one.
    if (!state.indexDirty) return;
    state.indexDirty = false;
    await buildIndex(ctx);
  })();
  state.indexing = run;
  notify(state);
  return run;
}

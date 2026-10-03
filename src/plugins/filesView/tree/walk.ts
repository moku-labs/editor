/**
 * @file filesView plugin — the tree walk: breadth first from the root with WALK_CONCURRENCY
 * parallel `link.files.list` calls, the WALK_MAX_DEPTH cap and the `maxFiles` cap, single
 * flight. The server already hides denied folders (files spec), so nothing is filtered here.
 */
import { linkPlugin } from "../../link";
import type { FilesClient } from "../../link/types";
import type { FileEntry } from "../../registry/protocol";
import { codeOf, messageOf } from "../errors";
import { loadOverrides, rebuildUsedBy } from "../links/used-by";
import { notify } from "../store";
import type { FileIndex, FilesViewCtx } from "../types";
import { WALK_CONCURRENCY, WALK_MAX_DEPTH } from "../types";
import { replacePaletteItems } from "./palette";

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
 * Builds the file index (single flight: a running build is shared), then loads the overrides,
 * rebuilds Used by, replaces the palette items and notifies. A failing root list leaves the
 * index as it was. Never rejects.
 *
 * @param ctx - Domain context of filesView.
 * @returns When the build is done.
 */
export function buildIndex(ctx: FilesViewCtx): Promise<void> {
  const { state } = ctx;
  if (state.indexing !== undefined) return state.indexing;

  const run = (async () => {
    const index = await walk(ctx);
    if (index === undefined) return;
    state.index = index;
    state.overrides = await loadOverrides(ctx);
    rebuildUsedBy(ctx);
    replacePaletteItems(ctx);
  })()
    .catch((error: unknown) => {
      ctx.log.warn("filesView:index-failed", { message: messageOf(error) });
    })
    .finally(() => {
      state.indexing = undefined;
      notify(state);
    });
  state.indexing = run;
  notify(state);
  return run;
}

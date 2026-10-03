/**
 * @file filesView plugin — "Open in editor" (D-08): the link from the boot data through the
 * shared `editorUrlOf` (panels/shared/editor-url, R9), and opening it without a shell.
 */
import { linkPlugin } from "../../link";
import { editorUrlOf } from "../../panels/shared/editor-url";
import type { FilesViewCtx } from "../types";

/**
 * The editor link of a file from `link.boot()` (`editorUrl`, `root`).
 *
 * @param ctx - Domain context of filesView.
 * @param path - Relative file path.
 * @param line - 1-based line; 1 when omitted.
 * @returns The link, or undefined without boot data.
 * @example
 * ```ts
 * editorUrlFor(ctx, "nodes/merge.ts", 12); // "vscode://file/Users/moku/game/nodes/merge.ts:12"
 * ```
 */
export function editorUrlFor(ctx: FilesViewCtx, path: string, line?: number): string | undefined {
  const boot = ctx.require(linkPlugin).boot();
  return boot === undefined ? undefined : editorUrlOf(boot.editorUrl, boot.root, path, line);
}

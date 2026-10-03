/**
 * @file files plugin — the onInit body: resolves and checks the root, compiles the globs.
 * Synchronous by design, so `createApp` fails fast on a bad root.
 */
import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path/posix";
import { compileGlob } from "./glob";
import type { FilesCtx } from "./types";

/**
 * The real path of a folder, or undefined when it is missing or not a folder.
 *
 * @param root - An absolute path.
 * @returns The symlink-resolved path of the folder.
 * @example
 * ```ts
 * realFolder("/tmp"); // "/private/tmp" on macOS
 * ```
 */
function realFolder(root: string): string | undefined {
  try {
    const real = realpathSync(root);
    return statSync(real).isDirectory() ? real : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves `config.root` (realpath, must be a folder), stores rootReal, compiles allow and deny.
 *
 * @param ctx - Domain context of files.
 * @throws {Error} `[moku-editor] files.root "<root>" is not a directory.` or an empty allow list.
 */
export function validateFilesConfig(ctx: FilesCtx): void {
  const { root, allow, deny } = ctx.config;

  if (allow.length === 0) {
    throw new Error(
      "[moku-editor] files.allow is empty.\n  Pass at least one glob in pluginConfigs.files.allow."
    );
  }

  const rootReal = realFolder(resolve(root));
  if (rootReal === undefined) {
    throw new Error(
      `[moku-editor] files.root "${root}" is not a directory.\n  Pass pluginConfigs.files.root pointing at the game project.`
    );
  }

  ctx.state.rootReal = rootReal;
  ctx.state.allowGlobs = allow.map(glob => compileGlob(glob, { caseInsensitive: false }));
  ctx.state.denyGlobs = deny.map(glob => compileGlob(glob, { caseInsensitive: true }));
}

/**
 * @file pages plugin — where the built tools page lives: the configured folder, else the first
 * candidate that holds index.html (the published package, then a source checkout after
 * `bun run build:tools`).
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path/posix";
import { fileURLToPath } from "node:url";

/**
 * The folders tried when `pages.pageDir` is not set, in order: `dist/tools` next to the bundled
 * server code (published package), then the repository's `dist/tools` (running from source).
 *
 * @returns Absolute folder paths.
 * @example
 * ```ts
 * pageDirCandidates(); // ["/…/node_modules/@moku-labs/editor/dist/tools/", "/…/dist/tools/"]
 * ```
 */
export function pageDirCandidates(): string[] {
  return [
    fileURLToPath(new URL("tools/", import.meta.url)),
    fileURLToPath(new URL("../../../dist/tools/", import.meta.url))
  ];
}

/**
 * Resolves the folder of the built tools page.
 *
 * @param configured - `pages.pageDir`: wins when set, built or not.
 * @param candidates - Folders tried in order when nothing is configured.
 * @returns The absolute folder, or undefined when no candidate holds index.html.
 * @example
 * ```ts
 * resolvePageDir(undefined); // "/…/dist/tools/" after bun run build:tools
 * ```
 */
export function resolvePageDir(
  configured: string | undefined,
  candidates: readonly string[] = pageDirCandidates()
): string | undefined {
  if (configured !== undefined) return resolve(configured);

  return candidates.find(dir => existsSync(join(dir, "index.html")));
}

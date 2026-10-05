/**
 * @file Shared view module — where a game's asset manifest may live: one default list for the
 * `manifestPaths` option of gameView (the texture catalogue) and renderView (the Textures card).
 */

/**
 * The default `manifestPaths`: the files tried in order through `link.files.read`. Frozen, because
 * both plugin configs share this one array.
 *
 * @example
 * ```ts
 * DEFAULT_MANIFEST_PATHS[1]; // "public/manifest.json"
 * ```
 */
export const DEFAULT_MANIFEST_PATHS: readonly string[] = Object.freeze([
  "manifest.json",
  "public/manifest.json",
  "web/manifest.json"
]);

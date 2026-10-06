/**
 * @file Shared view module — where a game's asset manifest may live: one default list for the
 * `manifestPaths` option of gameView (the texture catalogue) and renderView (the Textures card).
 * Deprecated (amendment N1): the manifest is `ProjectState.manifest` only (`manifestOf` in
 * `./project`). Still imported by `gameView/index.ts` and `renderView/index.ts`; the file goes
 * with their `manifestPaths` config in the next wave.
 */

/**
 * The default `manifestPaths`: the files tried in order through `link.files.read`. Frozen, because
 * both plugin configs share this one array.
 *
 * @deprecated The manifest is `ProjectState.manifest` only; use `manifestOf(link.project())` from
 * `panels/shared/project`. Importers left: gameView/index.ts, renderView/index.ts.
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

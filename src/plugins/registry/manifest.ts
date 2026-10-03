/**
 * @file registry plugin — the manifest: descriptors only, cached until the next add; game, page
 * and embedded computed at call time.
 */
import type { Manifest } from "./protocol";
import type { RegistryConfig, RegistryState } from "./types";

/**
 * The longest page URL the hub's manifest check accepts.
 */
const MAX_PAGE_LENGTH = 2048;

/**
 * Builds the frozen manifest from the entries (their descriptors are fresh frozen copies, never
 * door objects).
 *
 * @param state - Registry state.
 * @param name - Display name of the game.
 * @returns The frozen manifest; `panels` is omitted (reserved).
 */
export function buildManifest(state: RegistryState, name: string): Manifest {
  const { page, embedded } = pageInfo();

  return Object.freeze({
    game: name,
    page,
    embedded,
    sources: Object.freeze([...state.sources.values()].map(entry => entry.descriptor)),
    commands: Object.freeze([...state.commands.values()].map(entry => entry.descriptor))
  });
}

/**
 * True when the page runs inside a frame whose parent has the same origin (the tools page).
 *
 * @returns Whether the page is embedded; false in Bun and under a cross-origin parent.
 * @example
 * ```ts
 * isEmbedded(); // true inside the tools page frame
 * ```
 */
function isEmbedded(): boolean {
  if (typeof globalThis.window === "undefined" || globalThis.self === window.top) return false;

  try {
    return window.parent.location.origin === location.origin;
  } catch {
    return false;
  }
}

/**
 * The page URL (cut to 2048 characters) and whether the page runs inside the tools page frame.
 *
 * @returns `{ page, embedded }`; `{ page: "", embedded: false }` in Bun.
 * @example
 * ```ts
 * pageInfo(); // { page: "", embedded: false } in Bun
 * ```
 */
export function pageInfo(): { page: string; embedded: boolean } {
  const href = typeof location === "undefined" ? "" : location.href;

  return { page: href.slice(0, MAX_PAGE_LENGTH), embedded: isEmbedded() };
}

/**
 * The display name: config.name, else the trimmed document.title, else "game".
 *
 * @param config - Resolved registry config.
 * @returns The name for Manifest.game.
 * @example
 * ```ts
 * gameName({ game, modules: [], name: "merge-game 0.0.0" }); // "merge-game 0.0.0"
 * ```
 */
export function gameName(config: Readonly<RegistryConfig>): string {
  const title = typeof document === "undefined" ? "" : document.title.trim();

  return config.name ?? (title || "game");
}

/**
 * The manifest now: the cached one while game, page and embedded are unchanged; a refreshed copy
 * (same descriptor lists) when one of them moved; a new build after the cache was dropped.
 *
 * @param state - Registry state (holds the cache).
 * @param config - Resolved registry config.
 * @returns The frozen manifest.
 */
export function currentManifest(state: RegistryState, config: Readonly<RegistryConfig>): Manifest {
  const game = gameName(config);
  const { page, embedded } = pageInfo();
  const cached = state.manifest ?? buildManifest(state, game);
  const current =
    cached.game === game && cached.page === page && cached.embedded === embedded
      ? cached
      : Object.freeze({ ...cached, game, page, embedded });

  state.manifest = current;

  return current;
}

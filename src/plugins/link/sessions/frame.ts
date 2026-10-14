/**
 * @file link plugin — the frame id of this tools page: one random id per page, carried as the
 * `__editorFrame` query parameter in the URL of the page's own game frame. The session that frame
 * opens reports the URL as its `page`, so it is told apart from the game frames of other tools
 * tabs on the same hub. `tagFrame` is the only function that tags a game URL; it also carries the
 * dev page's scenario (`player`).
 */

/**
 * The query parameter of the game frame URL that carries the frame id.
 */
export const FRAME_PARAM = "__editorFrame";

/**
 * The query parameter of the engine dev page that names the scenario it starts from
 * (`tests/scenarios/<name>.ts`, read by `startPage`).
 */
export const PLAYER_PARAM = "player";

/**
 * A new random frame id: 12 hex digits from `crypto.getRandomValues`, which also exists outside a
 * secure context (a tools page opened over a LAN address).
 *
 * @returns The id.
 * @example
 * ```ts
 * createFrameId(); // "3f9a1c2b7d4e"
 * ```
 */
export function createFrameId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The frame id a page URL carries.
 *
 * @param page - A page URL (`SessionInfo.page`, `Manifest.page`).
 * @returns The id, undefined for a page without one or a page that is not a URL.
 * @example
 * ```ts
 * frameOf("http://127.0.0.1:3000/?__editorFrame=3f9a1c2b7d4e"); // "3f9a1c2b7d4e"
 * frameOf("http://127.0.0.1:3000/"); // undefined
 * ```
 */
export function frameOf(page: string): string | undefined {
  try {
    return new URL(page).searchParams.get(FRAME_PARAM) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Tags a game page URL with a frame id, resolved against the tools page. A non-empty `player` is
 * set first, as the `player` query parameter (the dev page's scenario); absent or "" leaves the
 * URL's own `player` as it is.
 *
 * @param url - The game page URL, absolute or relative to the tools page.
 * @param frame - The frame id.
 * @param player - The scenario to start from; absent or "" for none.
 * @returns The absolute tagged URL; the URL unchanged when it does not parse.
 * @example
 * ```ts
 * tagFrame("http://127.0.0.1:3000/", "3f9a1c2b7d4e", "full");
 * // "http://127.0.0.1:3000/?player=full&__editorFrame=3f9a1c2b7d4e"
 * ```
 */
export function tagFrame(url: string, frame: string, player?: string): string {
  try {
    const tagged = new URL(url, globalThis.location?.href);
    if (player !== undefined && player !== "") tagged.searchParams.set(PLAYER_PARAM, player);
    tagged.searchParams.set(FRAME_PARAM, frame);
    return tagged.href;
  } catch {
    return url;
  }
}

/**
 * True when a page URL carries a frame id other than `frame`: the game frame of another tools tab.
 * A page without a frame id is not another tab's.
 *
 * @param page - A page URL.
 * @param frame - The frame id of this tools page.
 * @returns Whether the page belongs to another tools tab.
 * @example
 * ```ts
 * isOtherFrame("http://127.0.0.1:3000/?__editorFrame=aaaaaaaaaaaa", "3f9a1c2b7d4e"); // true
 * isOtherFrame("http://127.0.0.1:3000/", "3f9a1c2b7d4e"); // false
 * ```
 */
export function isOtherFrame(page: string, frame: string): boolean {
  const tag = frameOf(page);
  return tag !== undefined && tag !== frame;
}

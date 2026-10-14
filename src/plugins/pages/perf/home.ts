/**
 * @file pages perf sub-domain — `/` of the device port: a sentence instead of a 404, so the tools
 * page's game frame says why no game is there.
 */

/** The body of the no-game page. */
const NO_GAME_BODY =
  "<!doctype html><title>moku-editor perf</title><p>No game is served here. " +
  "Phones connect to this port; the tools page shows them in its device strip.</p>";

/**
 * The no-game page for `/` of the device port: no script, no cache.
 *
 * @returns A fresh 200 HTML response.
 * @example
 * ```ts
 * await editor.hub.listenDevices({ confirm, routes: { "/": noGamePage() } });
 * ```
 */
export function noGamePage(): Response {
  return new Response(NO_GAME_BODY, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'",
      "x-content-type-options": "nosniff"
    }
  });
}

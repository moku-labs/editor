/**
 * @file bridge plugin — the real reload seam: the page's sessionStorage, the document id and
 * Bun's `bun:beforeFullReload`. Bun allows its HMR API only in the direct form
 * `import.meta.hot.on(…)` behind `if (import.meta.hot)` (a stored `import.meta.hot` throws "cannot
 * be used indirectly"); without Bun HMR (a production build, Vite, a test) the listener is a no-op.
 */
import type { CheckpointStorage, ReloadSeam } from "../types";

/**
 * The Bun dev server event sent right before it reloads the page.
 */
const BEFORE_FULL_RELOAD = "bun:beforeFullReload";

/**
 * Listens to Bun's `bun:beforeFullReload` when Bun HMR runs this module.
 *
 * @param listener - Called right before Bun reloads the page.
 * @returns The remover; a no-op without Bun HMR.
 */
function onBeforeFullReload(listener: () => void): () => void {
  if (!import.meta.hot) return () => {};

  import.meta.hot.on(BEFORE_FULL_RELOAD, listener);
  return () => {
    import.meta.hot.off(BEFORE_FULL_RELOAD, listener);
  };
}

/**
 * The page's sessionStorage, or undefined outside a browser and where reading it throws (a
 * sandboxed frame).
 *
 * @param scope - Where to look for `sessionStorage`.
 * @param scope.sessionStorage - The page's sessionStorage, if any.
 * @returns The storage, or undefined.
 * @example
 * ```ts
 * storageOf({}); // undefined: no sessionStorage outside a browser
 * ```
 */
export function storageOf(scope: {
  readonly sessionStorage?: CheckpointStorage;
}): CheckpointStorage | undefined {
  try {
    return scope.sessionStorage;
  } catch {
    return undefined;
  }
}

/**
 * The reload seam of this page: sessionStorage, `performance.timeOrigin` and Bun's
 * beforeFullReload.
 *
 * @returns The seam the bridge deps carry.
 */
export function defaultReload(): ReloadSeam {
  return { storage: storageOf(globalThis), doc: performance.timeOrigin, onBeforeFullReload };
}

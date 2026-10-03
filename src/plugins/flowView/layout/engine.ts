/**
 * @file flowView layout module — the ELK runners ("Off main thread"): the worker engine over
 * `elkjs/lib/elk-api.js` with an injectable worker factory, the inline engine over
 * `elkjs/lib/elk.bundled.js`, and the lazy engine created on the first non-hub layout.
 */
import ElkBundled from "elkjs/lib/elk.bundled.js";
import ElkApi from "elkjs/lib/elk-api.js";
import type { LayoutEngine } from "./types";

/**
 * The worker engine: ELK runs in the worker the factory creates (a Blob worker in the tools page).
 * `dispose()` terminates the worker and calls `onDispose` (which revokes the Blob URL), once.
 *
 * @param workerFactory - Creates the worker; throws when the page forbids it.
 * @param onDispose - Called once on dispose.
 * @returns The engine.
 * @throws {Error} When the factory throws (the caller falls back to the inline engine).
 * @example
 * ```ts
 * const engine = createWorkerEngine(() => new Worker(url), () => revokeWorkerUrl(url));
 * ```
 */
export function createWorkerEngine(
  workerFactory: () => Worker,
  onDispose?: () => void
): LayoutEngine {
  const elk = new ElkApi({ workerFactory });
  let disposed = false;
  return {
    layout: async input => elk.layout(input),

    dispose: () => {
      if (disposed) return;
      disposed = true;
      elk.terminateWorker();
      onDispose?.();
    }
  };
}

/**
 * The inline engine: ELK on the main thread (tests, strict CSP, `layoutWorker: false`). Its
 * `dispose()` frees nothing: it holds no worker and no URL.
 *
 * @returns The engine.
 */
export function createInlineEngine(): LayoutEngine {
  const elk = new ElkBundled();
  return {
    layout: async input => elk.layout(input),

    dispose: () => {
      // The inline engine holds no worker and no URL.
    }
  };
}

/**
 * An engine whose real engine is created on its first layout call; dispose frees it if created.
 *
 * @param create - Creates the real engine.
 * @returns The lazy engine.
 * @example
 * ```ts
 * layout.engine ??= createLazyEngine(() => realEngine(ctx)); // no worker until the first layout
 * ```
 */
export function createLazyEngine(create: () => Promise<LayoutEngine>): LayoutEngine {
  let engine: Promise<LayoutEngine> | undefined;
  return {
    layout: async input => {
      engine ??= create();
      const real = await engine;
      return real.layout(input);
    },

    dispose: () => {
      engine?.then(
        real => real.dispose(),
        () => {}
      );
    }
  };
}

/**
 * @file flowView layout module — the ELK runners ("Off main thread"): the worker engine over
 * `elkjs/lib/elk-api.js` with an injectable worker factory, the inline engine over
 * `elkjs/lib/elk.bundled.js`, and the lazy engine created on the first non-hub layout.
 */
import type { ElkNode } from "elkjs";
import ElkBundled from "elkjs/lib/elk.bundled.js";
import ElkApi from "elkjs/lib/elk-api.js";
import type { LayoutEngine } from "./types";

/**
 * The worker engine: ELK runs in the worker the factory creates (a Blob worker in the tools page).
 * `dispose()` terminates the worker and calls `onDispose` (which revokes the Blob URL).
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
    /**
     * Lays out one graph in the worker.
     *
     * @param input - The ELK graph.
     * @returns The laid-out graph.
     * @example
     * ```ts
     * await engine.layout(toElkGraph("main", main, classes));
     * ```
     */
    async layout(input: ElkNode): Promise<ElkNode> {
      return elk.layout(input);
    },

    /**
     * Terminates the worker and revokes its URL (once).
     *
     * @example
     * ```ts
     * engine.dispose();
     * ```
     */
    dispose(): void {
      if (disposed) return;
      disposed = true;
      elk.terminateWorker();
      onDispose?.();
    }
  };
}

/**
 * The inline engine: ELK on the main thread (tests, strict CSP, `layoutWorker: false`).
 *
 * @returns The engine.
 * @example
 * ```ts
 * const engine = createInlineEngine();
 * ```
 */
export function createInlineEngine(): LayoutEngine {
  const elk = new ElkBundled();
  return {
    /**
     * Lays out one graph on the main thread.
     *
     * @param input - The ELK graph.
     * @returns The laid-out graph.
     * @example
     * ```ts
     * await engine.layout(toElkGraph("main", main, classes));
     * ```
     */
    async layout(input: ElkNode): Promise<ElkNode> {
      return elk.layout(input);
    },

    /**
     * Nothing to free: the inline engine has no worker.
     *
     * @example
     * ```ts
     * engine.dispose();
     * ```
     */
    dispose(): void {
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
 * ctx.state.layout.engine ??= createLazyEngine(() => engineFor(ctx));
 * ```
 */
export function createLazyEngine(create: () => Promise<LayoutEngine>): LayoutEngine {
  let engine: Promise<LayoutEngine> | undefined;
  return {
    /**
     * Creates the real engine on first use, then lays out.
     *
     * @param input - The ELK graph.
     * @returns The laid-out graph.
     * @example
     * ```ts
     * await lazy.layout(graph);
     * ```
     */
    async layout(input: ElkNode): Promise<ElkNode> {
      engine ??= create();
      const real = await engine;
      return real.layout(input);
    },

    /**
     * Disposes the real engine when it was created.
     *
     * @example
     * ```ts
     * lazy.dispose();
     * ```
     */
    dispose(): void {
      engine?.then(
        real => real.dispose(),
        () => {}
      );
    }
  };
}

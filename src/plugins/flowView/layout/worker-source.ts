/**
 * @file flowView layout module — the Blob URL of the ELK worker script. The text of
 * `elkjs/lib/elk-worker.min.js` is imported `with { type: "text" }` on demand, so Bun.build bundles
 * it into the prebuilt tools page (D-06) and no asset path ships in the package.
 */

/**
 * Creates a Blob URL for the ELK worker script (CSP `worker-src 'self' blob:`, R3).
 *
 * @returns The object URL.
 * @throws {Error} When the script does not load as text (a bundler without text imports).
 * @example
 * ```ts
 * const url = await workerUrl(); // "blob:http://127.0.0.1:3000/…"
 * ```
 */
export async function workerUrl(): Promise<string> {
  const script = await import("elkjs/lib/elk-worker.min.js", { with: { type: "text" } });
  const text: unknown = script.default;
  if (typeof text !== "string") {
    throw new TypeError(
      "[moku-editor] The ELK worker script did not load as text.\n  Bundle the tools page with Bun.build, or set flowView.layoutWorker to false."
    );
  }
  return URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
}

/**
 * Revokes a worker Blob URL.
 *
 * @param url - The object URL.
 * @example
 * ```ts
 * revokeWorkerUrl("blob:http://127.0.0.1:3000/1d2c");
 * ```
 */
export function revokeWorkerUrl(url: string): void {
  URL.revokeObjectURL(url);
}

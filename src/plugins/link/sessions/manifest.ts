/**
 * @file link plugin — the manifest cache of the chosen session and its listeners.
 */
import type { Manifest } from "../../registry/protocol";
import type { LinkCtx, LinkState } from "../types";

/**
 * The cached manifest of the chosen session.
 *
 * @param state - Link state.
 * @returns The manifest, undefined before one is attached.
 */
export function currentManifest(state: LinkState): Manifest | undefined {
  return state.chosen === undefined ? undefined : state.manifests.get(state.chosen);
}

/**
 * Calls one manifest listener; a listener that throws is logged.
 *
 * @param ctx - Domain context of link.
 * @param listener - The listener.
 * @param manifest - The manifest to pass.
 */
function callListener(
  ctx: LinkCtx,
  listener: (manifest: Manifest | undefined) => void,
  manifest: Manifest | undefined
): void {
  try {
    listener(manifest);
  } catch (error) {
    ctx.log.error("link:manifest-listener-failed", {}, error instanceof Error ? error : undefined);
  }
}

/**
 * Calls every manifest listener; one that throws is logged and the others still run.
 *
 * @param ctx - Domain context of link.
 * @param manifest - The new manifest; omitted when the session was lost.
 */
export function notifyManifest(ctx: LinkCtx, manifest?: Manifest): void {
  for (const listener of ctx.state.manifestListeners) callListener(ctx, listener, manifest);
}

/**
 * Adds a manifest listener; calls it at once when a manifest exists.
 *
 * @param ctx - Domain context of link.
 * @param fn - The listener.
 * @returns Unsubscribe.
 */
export function addManifestListener(
  ctx: LinkCtx,
  fn: (manifest: Manifest | undefined) => void
): () => void {
  const { manifestListeners } = ctx.state;
  /**
   * A wrapper of `fn`, so the same function added twice gets two independent entries.
   *
   * @param manifest - The manifest to pass on.
   */
  const listener = (manifest: Manifest | undefined): void => {
    fn(manifest);
  };

  manifestListeners.add(listener);
  const manifest = currentManifest(ctx.state);
  if (manifest !== undefined) callListener(ctx, listener, manifest);

  return () => {
    manifestListeners.delete(listener);
  };
}

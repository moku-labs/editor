/**
 * @file files plugin — onStart computes the engine fingerprint of the root, then opens the project
 * index without waiting for it; onStop ends its watch and closes it (the fingerprint is kept; a
 * restart computes it again).
 */
import { computeEngine } from "./engine";
import { closeIndex, openIndex } from "./project";
import type { FilesCtx, FilesState } from "./types";

/**
 * onStart: computes the engine fingerprint (`unknown` on any failure, never a failed start), then
 * starts the open of the project index; `find` waits for `state.opening`, which is set at once and
 * settles after the open. Resolves when the fingerprint is ready, so the hub, which starts later,
 * can publish it.
 *
 * @param ctx - Domain context of files.
 * @returns When the fingerprint is computed.
 */
export async function startFiles(ctx: FilesCtx): Promise<void> {
  const { state } = ctx;
  state.engineAt = Date.now();
  const engine = computeEngine(ctx).then(info => {
    state.engine = info;
  });
  state.opening = engine.then(() => openIndex(ctx));
  await engine;
}

/**
 * onStop: ends the watch, closes the index and leaves the state off `"stopped"`.
 *
 * @param ctx - Teardown context.
 * @param ctx.state - Own state.
 */
export function stopFiles(ctx: { readonly state: FilesState }): void {
  closeIndex(ctx.state);
}

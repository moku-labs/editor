/**
 * @file hub plugin — the computer's engine fingerprint, distributed (C7). The fingerprint is the
 * files plugin's (`files.engine()`, `files.refreshEngine()`); the hub publishes it to the tools
 * pages as `editor.engine`, keeps its id for the agents' `session` answer and the devices'
 * `paired`, and refreshes it when a phone pairs or reconnects (a reinstall during a long perf run).
 */
import { filesPlugin } from "../files";
import { publish } from "./routing/publish";
import type { HubCtx } from "./types";

/**
 * Publishes `files.engine()` as `editor.engine` and keeps its id (onStart; files computed the
 * fingerprint in its own onStart, which runs first).
 *
 * @param ctx - Domain context of the hub.
 */
export function publishEngine(ctx: HubCtx): void {
  const info = ctx.require(filesPlugin).engine();
  ctx.state.engineId = info.id;
  publish(ctx, "engine", info);
}

/**
 * Asks files for a fresh fingerprint (files re-hashes at most once per 2 s) and publishes it only
 * when its id changed. A rejection is logged `hub:engine-refresh-failed` at debug and the last id
 * stays. Never rejects.
 *
 * @param ctx - Domain context of the hub.
 * @returns When the refresh settled.
 */
export async function refreshAndPublish(ctx: HubCtx): Promise<void> {
  try {
    const info = await ctx.require(filesPlugin).refreshEngine();
    if (info.id === ctx.state.engineId) return;

    ctx.state.engineId = info.id;
    publish(ctx, "engine", info);
  } catch (error) {
    ctx.log.debug("hub:engine-refresh-failed", { error: String(error) });
  }
}

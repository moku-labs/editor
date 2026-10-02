/**
 * @file hub plugin — the onInit body: validates path, allow, callTimeoutMs, silentAfterMs and
 * builds state.origins.
 */
import type { HubCtx } from "./types";

/**
 * Validates the config (spec/11 Part 3 format, `[moku-editor] hub.<field> …`).
 *
 * @param _ctx - Domain context of the hub.
 * @example
 * ```ts
 * createServerPlugin("hub", { onInit: validateHubConfig });
 * ```
 */
export function validateHubConfig(_ctx: HubCtx): void {
  throw new Error("not implemented");
}

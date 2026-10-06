/**
 * @file hub plugin — hooks of the global server events: `files:project` becomes the published
 * `editor.project` state, sent to every tools page, kept and replayed to each one that opens.
 */
import type { ServerEvents } from "../../config";
import { publish } from "./routing/publish";
import type { HubCtx, HubHooks } from "./types";

/**
 * Publishes each project state of the files plugin as `editor.project`.
 *
 * @param ctx - Domain context of the hub.
 * @returns The hook.
 */
export function onFilesProject(ctx: HubCtx): (state: ServerEvents["files:project"]) => void {
  return state => {
    publish(ctx, "project", state);
  };
}

/**
 * hub's hooks factory (`hooks: createHandlers`).
 *
 * @param ctx - Domain context of the hub.
 * @returns The hooks.
 */
export function createHandlers(ctx: HubCtx): HubHooks {
  return { "files:project": onFilesProject(ctx) };
}

/**
 * @file consoleView plugin — hooks of the global tools events: link:status (notify) and
 * workspace:ran (command error lines, R4). Neither reads: the watch delivers new values (R6).
 */
import type { ToolsEvents } from "../../config";
import { linkPlugin } from "../link";
import { pushBadge } from "./badge";
import { pushLine } from "./ingest";
import { statusFrame, toCommandLine } from "./lines";
import { notify } from "./state";
import type { ConsoleCtx, ConsoleHooks } from "./types";

/**
 * consoleView's hooks factory (`hooks: createHandlers`).
 *
 * @param ctx - Domain context of consoleView.
 * @returns The hooks.
 * @example
 * ```ts
 * Object.keys(createHandlers(ctx)); // ["link:status", "workspace:ran"]
 * ```
 */
export function createHandlers(ctx: ConsoleCtx): ConsoleHooks {
  return {
    "link:status": onLinkStatus(ctx),
    "workspace:ran": onCommandRan(ctx)
  };
}

/**
 * Notifies the view (the empty-state text depends on the status) and remembers that a game was
 * connected once it is live or paused. Reads nothing.
 *
 * @param ctx - Domain context of consoleView.
 * @returns The hook.
 * @example
 * ```ts
 * onLinkStatus(ctx)({ status: { kind: "live", frame: 58 } }); // ctx.state.everConnected === true
 * ```
 */
export function onLinkStatus(ctx: ConsoleCtx): (payload: ToolsEvents["link:status"]) => void {
  return ({ status }) => {
    if (status.kind === "live" || status.kind === "paused") ctx.state.everConnected = true;
    notify(ctx.state);
  };
}

/**
 * A failed run appends the D1 command error line ("Logged in Console", prefix stripped by
 * bareMessage, R7) and pushes the badge. A successful run does nothing: a line the command
 * logged arrives through the watch.
 *
 * @param ctx - Domain context of consoleView.
 * @returns The hook.
 * @example
 * ```ts
 * onCommandRan(ctx)(stepError); // last line: "-32602 game.step: frames must be a number"
 * ```
 */
export function onCommandRan(ctx: ConsoleCtx): (payload: ToolsEvents["workspace:ran"]) => void {
  return ran => {
    if (ran.ok) return;

    const { state, config } = ctx;
    const frame = statusFrame(ctx.require(linkPlugin).status());
    pushLine(state, toCommandLine(ran, state.nextKey, frame), config.maxLines);
    state.nextKey += 1;
    pushBadge(ctx);
    notify(state);
  };
}

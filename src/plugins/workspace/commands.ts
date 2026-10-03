/**
 * @file workspace plugin — every command the shell runs for the user goes through `runCommand`:
 * `link.run`, then one global `workspace:ran` with its origin (R4), then it settles like
 * `link.run`. A `game.step` run also feeds the D1 step popover.
 */
import { linkPlugin } from "../link";
import type { Json, RunResult } from "../registry/protocol";
import { toWireError } from "../registry/protocol";
import type { RanEvent, RunOrigin, WorkspaceCtx } from "./types";

/**
 * The command id whose result the D1 popover shows.
 */
const STEP_COMMAND = "game.step";

/**
 * Stores a step result for the D1 popover and opens it.
 *
 * @param ctx - Domain context of workspace.
 * @param ran - The settled run.
 */
function showStep(ctx: Pick<WorkspaceCtx, "state">, ran: RanEvent): void {
  if (ran.id !== STEP_COMMAND) return;
  ctx.state.step = ran;
  ctx.state.popover = "step";
  ctx.state.ui.bump();
}

/**
 * Runs a command of the chosen game for the user and emits `workspace:ran`.
 *
 * @param ctx - Domain context of workspace.
 * @param id - Command id.
 * @param input - Command input, undefined for none.
 * @param origin - What started it: topbar, palette, key or panel.
 * @returns The RunResult; rejects with the link's error.
 */
export async function runCommand(
  ctx: WorkspaceCtx,
  id: string,
  input: Json | undefined,
  origin: RunOrigin
): Promise<RunResult> {
  const link = ctx.require(linkPlugin);
  try {
    const result = await link.run(id, input);
    const ran: RanEvent = { id, input, origin, at: Date.now(), ok: true, result };
    ctx.emit("workspace:ran", ran);
    showStep(ctx, ran);
    return result;
  } catch (error) {
    const ran: RanEvent = {
      id,
      input,
      origin,
      at: Date.now(),
      ok: false,
      error: toWireError(error)
    };
    ctx.emit("workspace:ran", ran);
    showStep(ctx, ran);
    throw error;
  }
}

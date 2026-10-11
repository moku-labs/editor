/**
 * @file registry plugin — where the game stands (R2, R6): the run state of editor commands and the
 * clock the channel heartbeat reads.
 */
import { read, sources } from "@moku-labs/game/inspect";
import type { RunState } from "../protocol";
import type { Clock, GameLike } from "../types";

/**
 * The run state now: the `game.position` path, the clock frame and the `game.tainted` flag.
 *
 * @param game - The game app.
 * @returns `{ path, frame, tainted }`.
 */
export function envelopeOf(game: GameLike): RunState {
  return {
    path: read(game, sources.position).path,
    frame: clockOf(game).frame,
    tainted: read(game, sources.tainted) === true
  };
}

/**
 * The pause reason of the developer: `game.pause` pushes it and only `game.resume` pops it.
 */
const DEVTOOLS_REASON = "devtools";

/**
 * The game clock and why it stands. Every pause reason sets `time.isPaused()`, so `paused` is true
 * for a hidden tab too; `held` is true only for the devtools pause, the one a reload restores. A
 * game without `lifecycle.reasons` has no reasons to read: `held` follows `paused`, as before.
 *
 * @param game - The game app.
 * @returns `{ frame, paused, held, reasons }`; `reasons` is a copy.
 * @example
 * ```ts
 * app.lifecycle.push("background");
 * clockOf(app); // { frame: 1840, paused: true, held: false, reasons: ["background"] }
 * app.lifecycle.push("devtools");
 * clockOf(app).held; // true
 * ```
 */
export function clockOf(game: GameLike): Clock {
  const frame = game.time.snapshot().frame;
  const paused = game.time.isPaused();
  const stack = game.lifecycle;

  if (typeof stack?.reasons !== "function") return { frame, paused, held: paused, reasons: [] };

  const reasons = [...stack.reasons()];
  return { frame, paused, held: reasons.includes(DEVTOOLS_REASON), reasons };
}

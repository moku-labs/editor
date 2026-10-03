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
 * The frame and the pause flag of the game clock (every pause reason sets `time.isPaused()`).
 *
 * @param game - The game app.
 * @returns `{ frame, paused }`.
 */
export function clockOf(game: GameLike): Clock {
  return { frame: game.time.snapshot().frame, paused: game.time.isPaused() };
}

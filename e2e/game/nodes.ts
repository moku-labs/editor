/**
 * @file The three nodes of the tiny e2e game: `home`, the checkpoint the game boots on; `level`,
 * the rest node Play leads to; `score`, the transit node a tap on the level runs.
 */
import { type } from "@moku-labs/game";
import { defineNode } from "./kit";
import { addPoint } from "./rules";

/** Rest node `home`: the checkpoint and safe node, waiting for Play. */
export const home = defineNode({
  scene: "home",
  outcomes: { play: type() },
  rest: true,
  checkpoint: true
});

/** Rest node `level`: waits for a tap, which scores, or Back, which goes home. */
export const level = defineNode({
  scene: "level",
  outcomes: { tap: type(), back: type() },
  rest: true
});

/** Transit node `score`: one point for the player, one tap for the session. */
export const score = defineNode({
  outcomes: { done: type() },
  run: ({ player, session, out }) => {
    player.score = addPoint(player.score);
    session.taps += 1;
    return out.done();
  }
});

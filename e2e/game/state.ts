/**
 * @file The state of the tiny e2e game: what a save holds, what one session holds, and the state
 * of a new player.
 */

/** The saved player: a name and the score the level counts up. */
export type Player = {
  /** The name the screens greet. */
  name: string;
  /** Points scored on the level, over every visit. */
  score: number;
};

/** The session: what one run of the game keeps and never saves. */
export type Session = {
  /** Taps on the level in this session. */
  taps: number;
};

/** The state of a new player. */
export const startingPlayer: Player = { name: "Tiny", score: 0 };

/** The session at every start. */
export const startingSession: Session = { taps: 0 };

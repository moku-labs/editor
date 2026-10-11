/**
 * @file workspace plugin — the game mark of the top bar (U1): the tile left of the game name. It
 * shows the initials of the name on a colour whose hue comes from the name, so the same game
 * always looks the same and two games in two panes are told apart at a glance. Pure: no state and
 * no DOM.
 */

/**
 * What the mark shows: its letters and the hue of its colour.
 */
export type GameMark = {
  /** One or two upper-case letters; `·` without a game. */
  readonly text: string;
  /** The hue in degrees, 0 to 359; undefined without a game (the tile stays neutral). */
  readonly hue: number | undefined;
};

/**
 * The mark without a game.
 */
const NO_GAME: GameMark = { text: "·", hue: undefined };

/**
 * What separates the words of a game name: whitespace, `-` and `_`.
 */
const WORD_BREAK = /[\s_-]+/;

/**
 * Degrees in a full turn of the hue.
 */
const FULL_TURN = 360;

/**
 * Letters the mark takes from a name of one word.
 */
const LETTERS_OF_ONE_WORD = 2;

/**
 * Letters the mark takes from each of the first two words of a longer name.
 */
const LETTERS_PER_WORD = 1;

/**
 * The first letters of a word.
 *
 * @param word - One word of the name.
 * @param count - How many letters to take.
 * @returns The letters; fewer when the word is shorter.
 * @example
 * ```ts
 * lettersOf("merge", 2); // "me"
 * ```
 */
function lettersOf(word: string, count: number): string {
  return [...word].slice(0, count).join("");
}

/**
 * The hue of a name: the sum of every character code times its position (from 1), modulo 360.
 *
 * @param name - The trimmed lower-case name.
 * @returns Degrees, 0 to 359.
 * @example
 * ```ts
 * hueOf("ab"); // 293: 97 × 1 + 98 × 2
 * ```
 */
function hueOf(name: string): number {
  let sum = 0;
  for (const [index, character] of [...name].entries()) {
    sum += (character.codePointAt(0) ?? 0) * (index + 1);
  }
  return sum % FULL_TURN;
}

/**
 * The mark of a game: the first letters of its first two words (split on whitespace, `-` and
 * `_`), or the first two letters of its one word, upper case; and a hue from the trimmed
 * lower-case name, so the same game always gets the same colour. Without a name, or with a name
 * that has no word, the mark is `·` with no hue.
 *
 * @param name - The game name without its version; undefined without a game.
 * @returns The letters and the hue.
 * @example
 * ```ts
 * // The top bar draws the tile left of the game name.
 * markOf("Tic Tac Toe"); // { text: "TT", hue: 7 }
 * markOf("merge-game"); // { text: "MG", hue: 288 }
 * markOf("Merge"); // { text: "ME", hue: 130 }
 * markOf(undefined); // { text: "·", hue: undefined }: no game, a neutral tile
 * ```
 */
export function markOf(name: string | undefined): GameMark {
  const trimmed = name?.trim() ?? "";
  const [first, second] = trimmed.split(WORD_BREAK).filter(word => word !== "");
  if (first === undefined) return NO_GAME;

  const letters =
    second === undefined
      ? lettersOf(first, LETTERS_OF_ONE_WORD)
      : lettersOf(first, LETTERS_PER_WORD) + lettersOf(second, LETTERS_PER_WORD);
  return { text: letters.toUpperCase(), hue: hueOf(trimmed.toLowerCase()) };
}

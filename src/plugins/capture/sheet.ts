/**
 * @file capture plugin — the input check of editor.sheet: how many pictures and how far apart, in
 * the game's own limits (2 to 12 frames, every 1 to 5000 ms of game time). Pure.
 */
import { errorCode, wireError } from "../registry/protocol";
import {
  MAX_SHEET_EVERY_MS,
  MAX_SHEET_FRAMES,
  MIN_SHEET_EVERY_MS,
  MIN_SHEET_FRAMES,
  SHEET_ID
} from "./types";

/**
 * The sheet option game.capture takes: `frames` pictures `everyMs` of game time apart.
 */
export type SheetOption = { frames: number; everyMs: number };

/**
 * Builds the -32602 refusal of an editor.sheet field.
 *
 * @param field - The refused field.
 * @param rule - What the field must be, without the prefix.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw refusedField("frames", "frames must be a whole number from 2 to 12");
 * ```
 */
function refusedField(field: string, rule: string): Error {
  return wireError(
    errorCode.invalidInput,
    `[moku-editor] ${SHEET_ID}: ${rule}.\n  The game takes a contact sheet in these limits.`,
    { reason: "invalid_input", retryable: false, id: SHEET_ID, field }
  );
}

/**
 * Checks the sheet fields of editor.sheet: `frames` a whole number from 2 to 12, `everyMs` a
 * number from 1 to 5000.
 *
 * @param input - The schema-checked input.
 * @param input.frames - How many pictures.
 * @param input.everyMs - Game time between two pictures, in ms.
 * @returns The sheet option for game.capture.
 * @throws {Error} -32602 `invalid_input` naming `frames` or `everyMs`.
 * @example
 * ```ts
 * checkSheet({ frames: 6, everyMs: 500 }); // { frames: 6, everyMs: 500 }
 * checkSheet({ frames: 13, everyMs: 500 }); // throws -32602, field "frames"
 * ```
 */
export function checkSheet(input: {
  readonly frames: number;
  readonly everyMs: number;
}): SheetOption {
  const { frames, everyMs } = input;

  const isFramesInRange =
    Number.isInteger(frames) && frames >= MIN_SHEET_FRAMES && frames <= MAX_SHEET_FRAMES;
  if (!isFramesInRange) {
    throw refusedField(
      "frames",
      `frames must be a whole number from ${String(MIN_SHEET_FRAMES)} to ${String(MAX_SHEET_FRAMES)}`
    );
  }

  const isEveryInRange =
    Number.isFinite(everyMs) && everyMs >= MIN_SHEET_EVERY_MS && everyMs <= MAX_SHEET_EVERY_MS;
  if (!isEveryInRange) {
    throw refusedField(
      "everyMs",
      `everyMs must be a number from ${String(MIN_SHEET_EVERY_MS)} to ${String(MAX_SHEET_EVERY_MS)}`
    );
  }

  return { frames, everyMs };
}

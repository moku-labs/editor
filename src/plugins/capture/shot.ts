/**
 * @file capture plugin — one shot: one run of the door command game.capture, checked for a
 * picture. game 0.1 answers the PNG data URL itself, game 0.4 answers `{ png, legend? }`.
 */
import type { Json, RunState } from "../registry/protocol";
import { errorCode, wireError } from "../registry/protocol";
import type { CaptureRegistry } from "./types";
import { CAPTURE_ID } from "./types";

/**
 * The start of every picture the door answers (a PNG data URL).
 */
const IMAGE_PREFIX = "data:image/";

/**
 * The picture of a game.capture value: the PNG data URL itself (game 0.1), or the string `png` of
 * `{ png, legend? }` (game 0.4).
 *
 * @param value - What game.capture answered.
 * @returns The data URL, or undefined for anything else (no picture).
 * @example
 * ```ts
 * pictureOf({ png: "data:image/png;base64,AA", legend: [] }); // "data:image/png;base64,AA"
 * pictureOf(null); // undefined: the renderer is inert
 * ```
 */
function pictureOf(value: Json): string | undefined {
  const isObject = typeof value === "object" && value !== null && !Array.isArray(value);
  const png = isObject ? value.png : value;

  return typeof png === "string" && png.startsWith(IMAGE_PREFIX) ? png : undefined;
}

/**
 * Runs game.capture once. The state is the envelope the engine read right after the picture
 * resolved, so its frame is the real frame of the shot (best effort: a GPU read-back that
 * crossed a frame boundary shows the frame before).
 *
 * @param registry - The registry slice (the game.capture entry is looked up at run time).
 * @returns The data URL and the run state of the shot.
 * @throws {Error} -32601 `unknown_id` when game.capture is not in the registry; -32000
 *   `command_failed` when the door answers no picture (neither a PNG data URL nor `{ png }` with
 *   one). Errors of the door pass unchanged.
 */
export async function takeShot(
  registry: CaptureRegistry
): Promise<{ image: string; state: RunState }> {
  const entry = registry.command(CAPTURE_ID);

  if (entry === undefined) {
    throw wireError(
      errorCode.unknownMethod,
      `[moku-editor] ${CAPTURE_ID} is not in the registry.`,
      {
        reason: "unknown_id",
        retryable: false,
        id: CAPTURE_ID
      }
    );
  }

  const ran = await entry.run({});
  const image = pictureOf(ran.value);

  if (image === undefined) {
    throw wireError(
      errorCode.commandFailed,
      `[moku-editor] ${CAPTURE_ID} gave no picture.\n  The renderer is inert, headless or this is not a dev build.`,
      { reason: "command_failed", retryable: false, id: "editor.capture" }
    );
  }

  return { image, state: ran.state };
}

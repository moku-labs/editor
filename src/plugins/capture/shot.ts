/**
 * @file capture plugin — one shot: one run of the door command game.capture, checked for a
 * picture.
 */
import type { RunState } from "../registry/protocol";
import { errorCode, wireError } from "../registry/protocol";
import type { CaptureRegistry } from "./types";
import { CAPTURE_ID } from "./types";

/**
 * The start of every picture the door answers (a PNG data URL).
 */
const IMAGE_PREFIX = "data:image/";

/**
 * Runs game.capture once. The state is the envelope the engine read right after the picture
 * resolved, so its frame is the real frame of the shot (best effort: a GPU read-back that
 * crossed a frame boundary shows the frame before).
 *
 * @param registry - The registry slice (the game.capture entry is looked up at run time).
 * @returns The data URL and the run state of the shot.
 * @throws {Error} -32601 `unknown_id` when game.capture is not in the registry; -32000
 *   `command_failed` when the door answers no picture. Errors of the door pass unchanged.
 * @example
 * ```ts
 * const { image, state } = await takeShot(registry); // image: "data:image/png;base64,…"
 * ```
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

  if (typeof ran.value !== "string" || !ran.value.startsWith(IMAGE_PREFIX)) {
    throw wireError(
      errorCode.commandFailed,
      `[moku-editor] ${CAPTURE_ID} gave no picture.\n  The renderer is inert, headless or this is not a dev build.`,
      { reason: "command_failed", retryable: false, id: "editor.capture" }
    );
  }

  return { image: ran.value, state: ran.state };
}

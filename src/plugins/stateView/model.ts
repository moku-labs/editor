/**
 * @file stateView plugin — pure readers of wire values: the game.model shape guard, own-field
 * access on JSON objects, and the frame of a link status.
 */
import type { Json, LinkStatus } from "../registry/protocol";
import type { ModelSnapshot } from "./types";

/**
 * True for a JSON object: neither null nor an array.
 *
 * @param value - A JSON value or undefined.
 * @returns Whether it is a plain JSON object.
 * @example
 * ```ts
 * isRecord({ a: 1 }); // true
 * ```
 */
export function isRecord(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * An own field of a JSON object; undefined for a missing key or a value that is no object.
 *
 * @param value - A JSON value or undefined.
 * @param key - The field name.
 * @returns The field value, or undefined.
 * @example
 * ```ts
 * field({ path: "board/awaitIntent" }, "path"); // "board/awaitIntent"
 * ```
 */
export function field(value: Json | undefined, key: string): Json | undefined {
  return isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined;
}

/**
 * True for a game.model snapshot: an object with `player` and `session` (rng optional). The
 * watch callback gets wire values, so this is the boundary check.
 *
 * @param value - The value the link delivered.
 * @returns Whether it is a ModelSnapshot.
 * @example
 * ```ts
 * isModelSnapshot({ player: {}, session: {}, rng: { seed: 42 } }); // true
 * ```
 */
export function isModelSnapshot(value: unknown): value is ModelSnapshot {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "player" in value &&
    "session" in value
  );
}

/**
 * The heartbeat frame a link status knows: the frame when live or paused, the last frame when
 * silent or lost, undefined when connecting or empty.
 *
 * @param status - The link status.
 * @returns The frame, or undefined.
 * @example
 * ```ts
 * frameOf({ kind: "live", frame: 1840 }); // 1840
 * ```
 */
export function frameOf(status: LinkStatus): number | undefined {
  switch (status.kind) {
    case "live":
    case "paused": {
      return status.frame;
    }
    case "silent":
    case "lost": {
      return status.lastFrame;
    }
    default: {
      return undefined;
    }
  }
}

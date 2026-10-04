/**
 * @file registry plugin — the probe of a door source: one read with the default input each time
 * the manifest is built. A door that throws is not installed in this game: its game plugin is
 * missing, so every read and watch answers -32008 `not_installed` instead of failing per call.
 */
import type { Log } from "@moku-labs/common/browser";
import { read } from "@moku-labs/game/inspect";
import type { InputOf, InputSchema, SourceDescriptor } from "../protocol";
import { checkInput, ERROR_PREFIX, errorCode, ProtocolError } from "../protocol";
import type { DoorSource, GameLike } from "../types";
import { firstLine, messageOf } from "./failures";

/**
 * Door sources never probed: they locate one element, so a read with `{}` says nothing about the
 * game. `game.rect` (game 0.1) needs a key; `game.locate` (game 0.4) has only optional fields
 * but throws without a key or a target.
 */
export const UNPROBED_SOURCES: ReadonlySet<string> = new Set(["game.rect", "game.locate"]);

/**
 * The input a probe reads with: `{}` when every field of the schema is optional.
 *
 * @param schema - The descriptor's input schema.
 * @returns The empty input, or undefined when a field is required (the source is not probed).
 * @example
 * ```ts
 * defaultInputOf({ last: "number?" }); // {}
 * defaultInputOf({ key: "string" }); // undefined: game.rect needs a key
 * ```
 */
export function defaultInputOf(schema: InputSchema): InputOf<InputSchema> | undefined {
  try {
    // eslint-disable-next-line unicorn/no-null -- null is the wire value for "no input"
    return checkInput(schema, null);
  } catch {
    return undefined;
  }
}

/**
 * The -32008 `not_installed` error of a source the game does not have.
 *
 * @param id - The source id.
 * @param reason - What its door threw on the probe.
 * @returns The ProtocolError, not retryable.
 * @example
 * ```ts
 * notInstalled("game.effects", "app.effects is undefined").message;
 * // "[moku-editor] source game.effects is not available in this game: app.effects is undefined"
 * ```
 */
export function notInstalled(id: string, reason: string): ProtocolError {
  return new ProtocolError(
    errorCode.notInstalled,
    `${ERROR_PREFIX}source ${id} is not available in this game: ${reason}`,
    { reason: "not_installed", retryable: false, id }
  );
}

/**
 * The manifest descriptor of a source: the entry's own descriptor while the source is available,
 * a frozen copy with `available: false` and the reason when it is not.
 *
 * @param descriptor - The entry's descriptor.
 * @param reason - Why the source is unavailable, or undefined.
 * @returns The descriptor the manifest lists.
 * @example
 * ```ts
 * withAvailability(effects.descriptor, "app.effects is undefined");
 * // { id: "game.effects", title: "Effects", input: {}, changes: "frame", available: false, reason: "app.effects is undefined" }
 * ```
 */
export function withAvailability(
  descriptor: SourceDescriptor,
  reason: string | undefined
): SourceDescriptor {
  if (reason === undefined) return descriptor;

  return Object.freeze({ ...descriptor, available: false, reason });
}

/**
 * Builds the probe of a door source: it reads the door once with the default input. A throw marks
 * the source unavailable (one `registry:source-unavailable` info when it was available before);
 * a read that answers marks it available again. A source with a required input, and every
 * source of `UNPROBED_SOURCES`, is never probed.
 *
 * @param game - The game app.
 * @param door - The door source.
 * @param log - The registry log.
 * @param unavailable - The unavailable sources of the registry state (id to reason).
 * @returns The probe.
 */
export function probeOf(
  game: GameLike,
  door: DoorSource,
  log: Log.LogApi,
  unavailable: Map<string, string>
): () => void {
  return () => {
    const input = UNPROBED_SOURCES.has(door.id) ? undefined : defaultInputOf(door.input);
    if (input === undefined) return;

    try {
      read(game, door, input);
      unavailable.delete(door.id);
    } catch (error) {
      const reason = firstLine(messageOf(error));
      if (!unavailable.has(door.id)) {
        log.info("registry:source-unavailable", { id: door.id, reason });
      }
      unavailable.set(door.id, reason);
    }
  };
}

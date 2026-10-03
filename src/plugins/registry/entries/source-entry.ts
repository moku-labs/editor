/**
 * @file registry plugin — the closure-erased source entry: raw Json in, checked input to the door,
 * wire-safe Json out. A watch never lets an error reach the game's frame loop.
 */
import type { Log } from "@moku-labs/common/browser";
import { read, watch } from "@moku-labs/game/inspect";
import type { InputOf, InputSchema, Json } from "../protocol";
import { toWireValue } from "../protocol";
import type { DoorSource, GameLike, SourceEntry } from "../types";
import { describeSource } from "./descriptor";
import { checkedInput, doorFailed, messageOf, wireValueOf } from "./failures";

/**
 * What a guarded door read returns when the door threw: the frame is skipped.
 */
const FAILED: unique symbol = Symbol("registry.failed");

/**
 * Watches a door with a guarded copy of the descriptor: any error inside a frame (the door read,
 * toWireValue, the listener) is caught and logged once per streak; the flag resets after the next
 * delivery.
 *
 * @param game - The game app.
 * @param door - The door source.
 * @param log - The registry log.
 * @param input - The checked input.
 * @param fn - The listener.
 * @returns The door's unsubscribe.
 */
function guardedWatch(
  game: GameLike,
  door: DoorSource,
  log: Log.LogApi,
  input: InputOf<InputSchema>,
  fn: (value: Json) => void
): () => void {
  let failing = false;

  /**
   * Logs the first error of a streak; the next delivery ends the streak.
   *
   * @param error - What was thrown inside the frame.
   */
  const fail = (error: unknown): void => {
    if (failing) return;
    failing = true;
    log.warn("registry:watch-failed", { id: door.id, message: messageOf(error) });
  };

  const guarded: DoorSource = {
    ...door,
    /**
     * The door read, guarded: a throw is logged and the frame is skipped.
     *
     * @param app - The game app.
     * @param given - The checked input.
     * @returns What the door read, or FAILED.
     */
    read: (app, given) => {
      try {
        return door.read(app, given);
      } catch (error) {
        fail(error);
        return FAILED;
      }
    }
  };

  /**
   * Converts a read value and hands it to the listener; any throw is logged, never rethrown.
   *
   * @param value - What the guarded read returned.
   */
  const deliver = (value: unknown): void => {
    if (value === FAILED) return;
    try {
      fn(toWireValue(value));
      failing = false;
    } catch (error) {
      fail(error);
    }
  };

  return watch(game, guarded, input, deliver);
}

/**
 * Builds the entry of a door (or module) source.
 *
 * @param game - The game app.
 * @param door - The door source.
 * @param log - The registry log.
 * @returns The frozen entry.
 */
export function sourceEntry(game: GameLike, door: DoorSource, log: Log.LogApi): SourceEntry {
  const descriptor = describeSource(door);
  const { id } = descriptor;

  /**
   * Reads the door once; a door throw becomes -32000 and is logged.
   *
   * @param input - The checked input.
   * @returns What the door read.
   */
  const readDoor = (input: InputOf<InputSchema>): unknown => {
    try {
      return read(game, door, input);
    } catch (error) {
      const message = messageOf(error);
      log.warn("registry:source-failed", { id, message });
      throw doorFailed(id, message);
    }
  };

  return Object.freeze({
    descriptor,
    /**
     * Reads the source once: checkInput, the door read, toWireValue.
     *
     * @param raw - Raw input (`null` = none).
     * @returns The wire value.
     */
    read: (raw: Json): Json => wireValueOf(id, readDoor(checkedInput(id, door.input, raw))),
    /**
     * Watches the source; checks the input now and reads on the next frame, not at once.
     *
     * @param raw - Raw input (`null` = none).
     * @param fn - Called with each wire value.
     * @returns The door's unsubscribe (idempotent).
     */
    watch: (raw: Json, fn: (value: Json) => void): (() => void) =>
      guardedWatch(game, door, log, checkedInput(id, door.input, raw), fn)
  });
}

/**
 * @file registry plugin — editor sources (`editor.perf.*`): the guarded copy `add` stores, and the
 * probe the registry runs at each manifest build. A source its probe finds unavailable answers
 * -32008 `not_installed` like a door source the game does not have; the owner is never called.
 */
import type { Log } from "@moku-labs/common/browser";
import type { Json } from "../protocol";
import { ProtocolError, toWireValue } from "../protocol";
import type { SourceEntry } from "../types";
import { describeSource } from "./descriptor";
import { doorFailed, firstLine, messageOf, wireValueOf } from "./failures";
import { notInstalled } from "./probe";

/**
 * The error a throw of the owner becomes: a ProtocolError unchanged, anything else -32000 with
 * the id, logged `registry:source-failed`.
 *
 * @param id - The source id.
 * @param error - What the owner threw.
 * @param log - The registry log.
 * @returns The error to throw.
 */
function sourceFailure(id: string, error: unknown, log: Log.LogApi): ProtocolError {
  if (error instanceof ProtocolError) return error;

  const message = firstLine(messageOf(error));
  log.warn("registry:source-failed", { id, message });
  return doorFailed(id, message);
}

/**
 * A listener that hands wire values to `fn` and never lets a throw reach the owner's timer: a
 * throw of the conversion or of `fn` is logged once per streak; the next delivery ends it.
 *
 * @param id - The source id.
 * @param fn - The caller's listener.
 * @param log - The registry log.
 * @returns The guarded listener.
 */
function guardedListener(
  id: string,
  fn: (value: Json) => void,
  log: Log.LogApi
): (value: Json) => void {
  let failing = false;

  return value => {
    try {
      fn(toWireValue(value));
      failing = false;
    } catch (error) {
      if (!failing) log.warn("registry:watch-failed", { id, message: messageOf(error) });
      failing = true;
    }
  };
}

/**
 * A frozen copy of an editor source with a fresh descriptor (`available` / `reason` of the given
 * descriptor are dropped: the registry owns them). Its read and watch answer -32008 while
 * `unavailable` has the id, without calling the owner; a read goes through `toWireValue`; a watch
 * delivers through a guarded listener. It has no `probe`: the registry runs it.
 *
 * @param entry - The editor source.
 * @param log - The registry log.
 * @param unavailable - The unavailable sources of the registry state (id to reason), read at call time.
 * @returns The guarded copy.
 */
export function guardSource(
  entry: SourceEntry,
  log: Log.LogApi,
  unavailable: ReadonlyMap<string, string>
): SourceEntry {
  const descriptor = describeSource(entry.descriptor);
  const { id } = descriptor;

  /**
   * Throws -32008 when the probe found the source unavailable.
   *
   * @throws {Error} -32008 `[moku-editor] source <id> is not available in this game: <reason>`.
   */
  const requireAvailable = (): void => {
    const reason = unavailable.get(id);
    if (reason !== undefined) throw notInstalled(id, reason);
  };

  return Object.freeze({
    descriptor,
    /**
     * Reads the source once: availability, the owner's read, toWireValue.
     *
     * @param raw - Raw input (`null` = none); the owner checks it.
     * @returns The wire value.
     */
    read: (raw: Json): Json => {
      requireAvailable();
      let value: Json;
      try {
        value = entry.read(raw);
      } catch (error) {
        throw sourceFailure(id, error, log);
      }
      return wireValueOf(id, value);
    },
    /**
     * Watches the source through the owner's watch, with a guarded listener.
     *
     * @param raw - Raw input (`null` = none); the owner checks it.
     * @param fn - Called with each wire value.
     * @returns The owner's unsubscribe.
     */
    watch: (raw: Json, fn: (value: Json) => void): (() => void) => {
      requireAvailable();
      try {
        return entry.watch(raw, guardedListener(id, fn, log));
      } catch (error) {
        throw sourceFailure(id, error, log);
      }
    }
  });
}

/**
 * Builds the probe of an editor source that gives one: its answer marks the source unavailable
 * (one `registry:source-unavailable` info when it turns unavailable), `undefined` makes it
 * available again, and a throw counts as unavailable with the first line of its message.
 *
 * @param entry - The editor source (with its probe).
 * @param log - The registry log.
 * @param unavailable - The unavailable sources of the registry state (id to reason).
 * @returns The probe the manifest build runs.
 */
export function editorProbeOf(
  entry: SourceEntry,
  log: Log.LogApi,
  unavailable: Map<string, string>
): () => void {
  const { id } = entry.descriptor;

  return () => {
    let reason: string | undefined;
    try {
      reason = entry.probe?.();
    } catch (error) {
      reason = firstLine(messageOf(error));
    }

    if (reason === undefined) {
      unavailable.delete(id);
      return;
    }

    if (!unavailable.has(id)) log.info("registry:source-unavailable", { id, reason });
    unavailable.set(id, reason);
  };
}

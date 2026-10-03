/**
 * @file channel plugin — watch: the current value at once, then the door's deliveries. The door's
 * first-frame re-read is dropped when it equals the immediate read.
 */
import type { Json } from "../registry/protocol";
import { rawOf, sourceOf } from "./deps";
import type { ChannelDeps } from "./types";

/**
 * Opens a watch: reads the source now and calls `onValue` with that value before it returns,
 * then follows the door watch (a frame callback of the game). Unknown id, invalid input or an
 * `onValue` throw on the first value propagate synchronously and open no door watch.
 *
 * @param deps - Domain deps of the channel.
 * @param id - The source id.
 * @param input - The source input; `undefined` means none.
 * @param onValue - Called with the current value, then with every change.
 * @returns An idempotent stop that closes the door watch and forgets it.
 * @throws {Error} -32601 for an unknown id; the entry's ProtocolError for an invalid input.
 */
export function openWatch(
  deps: ChannelDeps,
  id: string,
  input: Json | undefined,
  onValue: (value: Json) => void
): () => void {
  const entry = sourceOf(deps.registry, id);
  const raw = rawOf(input);
  const first = entry.read(raw);
  onValue(first);

  const firstText = JSON.stringify(first);
  let firstDelivery = true;
  let closed = false;
  let stopDoor: (() => void) | undefined;

  /**
   * Closes the door watch once and forgets the watch.
   */
  const stop = (): void => {
    if (closed) return;
    closed = true;
    deps.state.watches.delete(stop);
    stopDoor?.();
  };

  /**
   * Passes a door delivery on; the first one is dropped when it repeats the immediate read.
   *
   * @param value - What the door read on this frame.
   */
  const deliver = (value: Json): void => {
    if (closed) return;
    const isRepeat = firstDelivery && JSON.stringify(value) === firstText;
    firstDelivery = false;
    if (!isRepeat) onValue(value);
  };

  deps.state.watches.add(stop);
  try {
    stopDoor = entry.watch(raw, deliver);
  } catch (error) {
    deps.state.watches.delete(stop);
    throw error;
  }
  if (closed) stopDoor();

  return stop;
}

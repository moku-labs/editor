/**
 * @file connect plugin — three small helpers the modules share: timers that do not keep the
 * process alive, a wait with an upper bound, and a deep freeze of a published value.
 */

/**
 * Lets a timer not keep the process alive (Bun's and Node's timers have `unref`).
 *
 * @param timer - The timer.
 * @returns The same timer.
 */
export function unref<T extends ReturnType<typeof setTimeout>>(timer: T): T {
  if (typeof timer === "object" && "unref" in timer) timer.unref();
  return timer;
}

/**
 * Waits for a promise, at most `ms`; a rejection ends the wait too and is swallowed.
 *
 * @param promise - What to wait for.
 * @param ms - The longest wait.
 * @returns When the promise settled or the time ran out.
 */
export async function within(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<void>(resolve => {
    timer = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([promise, bound]);
  } catch {
    // A rejection ends the wait as well.
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Freezes a value and everything in it (plain objects and arrays).
 *
 * @param value - The value.
 * @returns The same value, frozen.
 * @example
 * ```ts
 * Object.isFrozen(freezeDeep({ wire: [{ serial: "R5CX30ABCDE" }] }).wire[0]); // true
 * ```
 */
export function freezeDeep<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) freezeDeep(item);
  return Object.freeze(value);
}

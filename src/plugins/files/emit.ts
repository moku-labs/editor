/**
 * @file files plugin — the emit that never breaks its caller: `files:written` after a write and
 * `files:project` after the index changed both go through it.
 */

/**
 * Fires an emit that is not awaited. A throw, or a rejected promise the emit returns, goes to
 * `onFailure`, so a failing hook never breaks the caller.
 *
 * @param fire - Calls ctx.emit.
 * @param onFailure - Logs the failure.
 * @example
 * ```ts
 * emitLogged(() => Promise.reject(new Error("x")), console.error); // returns; logs "Error: x" later
 * ```
 */
export function emitLogged(fire: () => unknown, onFailure: (error: unknown) => void): void {
  try {
    const emitted = fire();
    if (emitted instanceof Promise) emitted.catch(onFailure);
  } catch (error) {
    onFailure(error);
  }
}

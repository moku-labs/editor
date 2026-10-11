/**
 * @file pages/mcp — bounded polling for state that arrives on its own: a reading a tool waits for
 * (`pollFor`), such as the hub connection after the bin's restart, and a value the hub replays to
 * a new connection right after its `sessions` list (`replayed`): the hot reload state and the
 * project index. A hub connection is open from its `sessions` list on, so a tool call that just
 * connected would read those two a moment too early.
 */

/**
 * How long a tool waits for a value the hub replays after `sessions`, in ms. The replay follows
 * the list in the same write of the hub; a hub that published no such value costs this wait.
 */
const REPLAY_WAIT_MS = 300;

/**
 * How often a tool looks for a replayed value, in ms.
 */
const REPLAY_POLL_MS = 10;

/**
 * Waits for a timeout.
 *
 * @param ms - The wait.
 * @returns Resolves after `ms`.
 * @example
 * ```ts
 * await sleep(100); // then read again
 * ```
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

/**
 * Reads until a value is there or the wait is over. It reads before it waits, so a value that is
 * there costs no time, and it reads once more at the end of each wait.
 *
 * @param read - The reading: undefined while there is nothing yet.
 * @param isOver - True once the wait must end (a deadline, a cancelled call).
 * @param everyMs - The pause between two readings, in ms.
 * @returns The value, or undefined when the wait ended without one.
 * @example
 * ```ts
 * // The hub connection after the bin's restart, at most 15 s.
 * const deadline = Date.now() + 15_000;
 * const hub = await pollFor(() => editor.connected(), () => Date.now() >= deadline, 100);
 * ```
 */
export async function pollFor<T>(
  read: () => T | undefined,
  isOver: () => boolean,
  everyMs: number
): Promise<T | undefined> {
  for (;;) {
    const value = read();
    if (value !== undefined || isOver()) return value;
    await sleep(everyMs);
  }
}

/**
 * A value the hub replays to a new connection right after its `sessions` list: read now, or within
 * the next 300 ms when the connection just opened.
 *
 * @param read - The reading of the kept value: undefined until the hub sent it.
 * @returns The value, or undefined when the hub sent none in that time.
 * @example
 * ```ts
 * const hub = await context.editor.hub(); // may have connected for this call
 * const state = await replayed(() => readHotReload(hub.hotReload())); // { hmr: true, owner: "bin" }
 * ```
 */
export function replayed<T>(read: () => T | undefined): Promise<T | undefined> {
  const deadline = Date.now() + REPLAY_WAIT_MS;
  return pollFor(read, () => Date.now() >= deadline, REPLAY_POLL_MS);
}

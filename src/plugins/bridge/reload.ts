/**
 * @file bridge plugin — the `editor.reload` command (moku_reload): it stores the checkpoint the
 * way `bun:beforeFullReload` does, answers `{ scheduled: true }`, then reloads the page on the next
 * macrotask, after the answer went out. The bridge of the new document restores the checkpoint and
 * sends `restored` in its first hello.
 */
import type { Json, RunResult } from "../registry/protocol";
import { checkInput } from "../registry/protocol";
import type { CommandEntry } from "../registry/types";
import { takeCheckpoint } from "./checkpoint/checkpoint";
import type { BridgeDeps } from "./types";
import { RELOAD_ID } from "./types";

/**
 * The input schema of editor.reload.
 */
const RELOAD_INPUT: { readonly restore: "boolean?" } = { restore: "boolean?" };

/**
 * What editor.reload needs: the registry (bookmark, clock, envelope), the reload seam, the state
 * (its remover list) and the log.
 */
type ReloadDeps = Pick<BridgeDeps, "registry" | "reload" | "state" | "log">;

/**
 * Reloads the page on the next macrotask. A stop before then cancels it: the canceller sits in
 * `state.off` until the timer fires.
 *
 * @param deps - The reload seam and the state.
 */
function scheduleReload(deps: Pick<ReloadDeps, "reload" | "state">): void {
  const { off } = deps.state;

  /**
   * Cancels the pending reload.
   */
  const cancel = (): void => {
    clearTimeout(timer);
  };
  const timer = setTimeout(() => {
    const index = off.indexOf(cancel);
    if (index !== -1) off.splice(index, 1);
    deps.reload.reloadPage();
  }, 0);

  off.push(cancel);
}

/**
 * Builds the editor.reload entry. Its effect is `route`: the registry refuses `raw` for editor
 * commands, and the reload itself taints nothing (the restore in the new document runs
 * `game.restore` through the game, which taints the session).
 *
 * @param deps - Registry, reload seam, state and log.
 * @returns The entry the bridge adds to the registry in onInit.
 * @example
 * ```ts
 * registry.add(reloadEntry({ registry, reload: defaultReload(), state: ctx.state, log: ctx.log }));
 * ```
 */
export function reloadEntry(deps: ReloadDeps): CommandEntry {
  return {
    descriptor: { id: RELOAD_ID, title: "Reload the page", input: RELOAD_INPUT, effect: "route" },
    /**
     * Checks the input, stores the checkpoint unless `restore` is false, schedules the reload and
     * answers.
     *
     * @param raw - Raw input (`null`, `{}` or `{ restore }`).
     * @returns `{ scheduled: true }` with the registry envelope.
     */
    run: async (raw: Json): Promise<RunResult> => {
      const { restore = true } = checkInput(RELOAD_INPUT, raw);

      if (restore) await takeCheckpoint(deps);
      const state = deps.registry.envelope();
      scheduleReload(deps);

      return { value: { scheduled: true }, state };
    }
  };
}

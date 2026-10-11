/**
 * @file bridge plugin — the `editor.clock` command: the game clock and why it stands, read-only.
 * The heartbeat says `paused` for any pause reason; this command also says `held`, the pause of the
 * developer (the reason `devtools`), and the reasons. The tools side asks it before a reload, so
 * the pause of a hidden tab (`background`) is not restored as a devtools pause.
 */
import type { RunResult } from "../registry/protocol";
import { toWireValue } from "../registry/protocol";
import type { CommandEntry, RegistryApi } from "../registry/types";

/**
 * What editor.clock needs of the registry: the clock and the envelope.
 */
type ClockRegistry = Pick<RegistryApi, "clock" | "envelope">;

/**
 * Builds the editor.clock entry: a read without input that answers `registry.clock()`. It runs no
 * door, so its state is the registry envelope. A game without `lifecycle.reasons` answers
 * `reasons: []` and `held` equal to `paused`, as the registry decides.
 *
 * @param registry - The registry: the clock and the envelope.
 * @returns The entry the bridge adds to the registry in onInit.
 * @example
 * ```ts
 * // The game tab is hidden and the developer did not pause: the clock stands, nobody holds it.
 * registry.add(clockEntry(registry));
 * (await registry.command("editor.clock")?.run(null))?.value;
 * // { frame: 1840, paused: true, held: false, reasons: ["background"] }
 * ```
 */
export function clockEntry(registry: ClockRegistry): CommandEntry {
  return {
    descriptor: { id: "editor.clock", title: "Clock", input: {}, effect: "read" },
    /**
     * Reads the clock now. Its `reasons` are a readonly list, which is not Json: the clock goes
     * through toWireValue, so the answer is a Json value of its own.
     *
     * @returns `{ frame, paused, held, reasons }` with the registry envelope.
     */
    run: async (): Promise<RunResult> => ({
      value: toWireValue(registry.clock()),
      state: registry.envelope()
    })
  };
}

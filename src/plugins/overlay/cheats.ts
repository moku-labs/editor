/**
 * @file overlay plugin — the cheat list (one-click cheats of the manifest) and one cheat run.
 */
import type { CommandDescriptor, Manifest } from "../registry/protocol";
import { bareMessage, toWireError } from "../registry/protocol";
import { paint } from "./paint";
import type { OverlayCtx } from "./types";

/**
 * True when every field of a command's input is optional, so a click can run it.
 *
 * @param descriptor - The command descriptor.
 * @returns Whether the command takes no required input.
 * @example
 * ```ts
 * isOneClick({ id: "merge.addCoins", title: "Add coins", input: { amount: "number?" }, effect: "cheat" }); // true
 * ```
 */
function isOneClick(descriptor: CommandDescriptor): boolean {
  return Object.values(descriptor.input).every(kind => kind.endsWith("?"));
}

/**
 * The commands the overlay shows as buttons: effect `cheat` and no required input field, in
 * manifest order. A cheat with required input is left out (run it from the editor).
 *
 * @param manifest - The registry manifest.
 * @returns The one-click cheat descriptors.
 * @example
 * ```ts
 * cheatCommands(registry.manifest()).map(cheat => cheat.id); // ["merge.addCoins", "merge.refillEnergy"]
 * ```
 */
export function cheatCommands(manifest: Manifest): readonly CommandDescriptor[] {
  return manifest.commands.filter(
    descriptor => descriptor.effect === "cheat" && isOneClick(descriptor)
  );
}

/**
 * Runs one cheat through the channel (scheduled off the frame loop). Ignored while that cheat is
 * busy; records `{ ok }` or `{ ok: false, message }` and logs `overlay:cheat-failed` on error.
 * Paints when it starts and when it settles.
 *
 * @param octx - Domain context.
 * @param id - The cheat command id.
 * @returns Settles when the result is recorded; never rejects.
 * @example
 * ```ts
 * await runCheat(octx, "merge.addCoins");
 * octx.state.results.get("merge.addCoins")?.ok; // true
 * ```
 */
export async function runCheat(octx: OverlayCtx, id: string): Promise<void> {
  const { state } = octx;
  if (state.busy.has(id)) return;

  state.busy.add(id);
  paint(octx);
  try {
    await octx.channel.run(id);
    state.results.set(id, { ok: true, message: undefined, at: Date.now() });
  } catch (error) {
    const wire = toWireError(error);
    state.results.set(id, { ok: false, message: bareMessage(wire.message), at: Date.now() });
    octx.log.warn("overlay:cheat-failed", { id, code: wire.code, message: wire.message });
  } finally {
    state.busy.delete(id);
    paint(octx);
  }
}

/**
 * @file Protocol — the build profile rule (engine spec 10 C1): which build runs which command
 * effect, and how a panel reads the verdict of a descriptor. Pure and isomorphic: no Node or
 * browser API.
 */
import type { BuildProfile, CommandDescriptor, CommandRefusal, Effect } from "./types";

/**
 * The effects a plain `--debug` build (profile `"read"`) runs: they change nothing the game saves.
 */
const READ_EFFECTS: ReadonlySet<Effect> = new Set(["read", "cosmetic"]);

/**
 * Decides whether a build runs a command of a game, by the build profile and the command's effect
 * (spec 10 C1): dev and full run everything; read runs read and cosmetic; none runs nothing.
 *
 * @param profile - The page's build profile.
 * @param effect - The command's effect.
 * @returns The refusal, or undefined when the command runs.
 * @example
 * ```ts
 * refusalOf("read", "route"); // "read-only"
 * refusalOf("read", "cosmetic"); // undefined
 * ```
 */
export function refusalOf(profile: BuildProfile, effect: Effect): CommandRefusal | undefined {
  if (profile === "none") return "dev-only";
  if (profile === "read" && !READ_EFFECTS.has(effect)) return "read-only";

  return undefined;
}

/**
 * True unless the descriptor says `allowed: false`. A descriptor of an agent from before this change
 * has no `allowed` and reads as allowed.
 *
 * @param descriptor - A command descriptor of a manifest.
 * @returns Whether the page runs it.
 * @example
 * ```ts
 * // The overlay greys a command its build refuses.
 * isAllowed({ id: "game.tap", title: "Tap", input: { target: "string" }, effect: "route", allowed: false, reason: "read-only" }); // false
 * ```
 */
export function isAllowed(descriptor: CommandDescriptor): boolean {
  return descriptor.allowed !== false;
}

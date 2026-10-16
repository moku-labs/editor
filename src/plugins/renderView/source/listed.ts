/**
 * @file renderView source — whether the active session's manifest lists a source or allows a command
 * (spec 09 § M2 rule 1): a read, watch or poll is sent only for a listed, available source id, so an
 * older agent without the Mission control feeds keeps the page in its "older agent" state, never a
 * crash; a command a build refuses (`allowed: false`) disables its switch.
 */
import type { Manifest } from "../../registry/protocol";

/**
 * Whether the manifest lists the source id with `available !== false`.
 *
 * @param manifest - The active session's manifest; undefined before one is attached.
 * @param id - A source id, for example "editor.perf.frames".
 * @returns True when it may be read or watched.
 * @example
 * ```ts
 * listed(link.manifest(), "editor.perf.frames"); // false on an agent before the Mission control feeds
 * ```
 */
export function listed(manifest: Manifest | undefined, id: string): boolean {
  return manifest?.sources.some(source => source.id === id && source.available !== false) === true;
}

/**
 * Whether the manifest lists the command id and the build runs it (`allowed !== false`).
 *
 * @param manifest - The active session's manifest; undefined before one is attached.
 * @param id - A command id, for example "editor.perf.sections".
 * @returns True when the page's build runs it.
 * @example
 * ```ts
 * commandAllowed(link.manifest(), "game.frameRate"); // false on a release build
 * ```
 */
export function commandAllowed(manifest: Manifest | undefined, id: string): boolean {
  return (
    manifest?.commands.some(command => command.id === id && command.allowed !== false) === true
  );
}

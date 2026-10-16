/**
 * @file renderView source — whether the active session's manifest lists a source (spec 09 § M2
 * rule 1): a read, watch or poll is sent only for a listed, available id. Typed stub of build
 * wave 0 (spec 09 § M17, RV0): the signatures are the contract the other Mission control units
 * build against; build wave 3 (RV4) writes the bodies.
 */
import type { Manifest } from "../../registry/protocol";
import { notBuilt } from "../stub";

/**
 * Whether the manifest lists the source id with `available !== false`.
 *
 * @param _manifest - The active session's manifest; undefined before one is attached.
 * @param _id - A source id, for example "editor.perf.frames".
 * @returns True when it may be read or watched.
 * @throws {Error} Until build wave 3: "renderView source/listed is not built yet".
 */
export function listed(_manifest: Manifest | undefined, _id: string): boolean {
  return notBuilt("source/listed", 3);
}

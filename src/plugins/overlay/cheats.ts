/**
 * @file overlay plugin — cheats.ts (skeleton stubs, implemented in its wave).
 */

import type { CommandDescriptor, Manifest } from "../registry/protocol";
import type { OverlayCtx } from "./types";

/**
 * Skeleton stub for `cheatCommands`; implemented in its wave.
 *
 * @param _manifest - The manifest.
 * @example
 * ```ts
 * cheatCommands();
 * ```
 */
export function cheatCommands(_manifest: Manifest): readonly CommandDescriptor[] {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `runCheat`; implemented in its wave.
 *
 * @param _octx - The octx.
 * @param _id - The id.
 * @example
 * ```ts
 * runCheat();
 * ```
 */
export function runCheat(_octx: OverlayCtx, _id: string): Promise<void> {
  throw new Error("not implemented");
}

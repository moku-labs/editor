/**
 * @file registry plugin — entries/validate.ts (skeleton stubs, implemented in its wave).
 */
import type { CommandDescriptor, SourceDescriptor } from "../protocol";

/**
 * Skeleton stub for `checkDescriptor`; implemented in its wave.
 *
 * @param _kind - The kind.
 * @param _descriptor - The descriptor.
 * @example
 * ```ts
 * checkDescriptor();
 * ```
 */
export function checkDescriptor(
  _kind: "source" | "command",
  _descriptor: SourceDescriptor | CommandDescriptor
): void {
  throw new Error("not implemented");
}

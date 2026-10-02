/**
 * @file workspace plugin — commands.ts (skeleton stubs, implemented in its wave).
 */
import type { Json, RunResult } from "../registry/protocol";
import type { RunOrigin, WorkspaceCtx } from "./types";

/**
 * Skeleton stub for `runCommand`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _id - The id.
 * @param _input - The input.
 * @param _origin - The origin.
 * @example
 * ```ts
 * runCommand();
 * ```
 */
export function runCommand(
  _ctx: WorkspaceCtx,
  _id: string,
  _input: Json | undefined,
  _origin: RunOrigin
): Promise<RunResult> {
  throw new Error("not implemented");
}

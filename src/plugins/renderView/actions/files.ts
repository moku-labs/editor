/**
 * @file renderView actions — the inspector's file links (spec 09 § M10 Files): `system:<name>` looked
 * up once per session through the project index (engine systems and unknown names answer null), and
 * the `workspace:open-file` emission with its toast.
 */
import { linkPlugin } from "../../link";
import { workspacePlugin } from "../../workspace";
import { notifyMission } from "../state";
import type { RenderViewCtx } from "../types";

/**
 * Where a system is defined (cached in `mission.files` for the session).
 *
 * @param ctx - Domain context of renderView.
 * @param system - A system name.
 * @returns The file and line; null for an engine system, an unresolved name or an index that is off.
 * @example
 * ```ts
 * await systemFile(ctx, "ward.update"); // { path: "src/systems/ward.ts", line: 12 }
 * ```
 */
export async function systemFile(
  ctx: RenderViewCtx,
  system: string
): Promise<{ readonly path: string; readonly line: number } | null> {
  const { files } = ctx.state.mission;
  const known = files.get(system);
  if (known !== undefined) return known;
  // eslint-disable-next-line unicorn/no-null -- null: asked, not found (an engine system)
  let found: { readonly path: string; readonly line: number } | null = null;
  files.set(system, found);
  try {
    const [first] = await ctx.require(linkPlugin).files.find(`system:${system}`);
    if (first !== undefined) found = { path: first.path, line: first.line };
  } catch {
    // The project index is off: no file link for this session.
  }
  files.set(system, found);
  return found;
}

/**
 * Looks up the systems not asked yet and re-renders once their files are known.
 *
 * @param ctx - Domain context of renderView.
 * @param systems - System names of a range.
 * @returns When every lookup settled.
 * @example
 * ```ts
 * await lookupFiles(ctx, ["ward.update", "fog.render"]);
 * ```
 */
export async function lookupFiles(ctx: RenderViewCtx, systems: readonly string[]): Promise<void> {
  const { files } = ctx.state.mission;
  const asked = systems.filter(system => !files.has(system));
  if (asked.length === 0) return;
  await Promise.all(asked.map(system => systemFile(ctx, system)));
  notifyMission(ctx.state.mission);
}

/**
 * Opens a file in the person's editor: emits `workspace:open-file { path, line }` and toasts "Open in
 * editor: {path}:{line}".
 *
 * @param ctx - Domain context of renderView.
 * @param path - The file.
 * @param line - The line.
 * @example
 * ```ts
 * openFile(ctx, "src/systems/ward.ts", 12); // toast "Open in editor: src/systems/ward.ts:12"
 * ```
 */
export function openFile(ctx: RenderViewCtx, path: string, line: number): void {
  ctx.emit("workspace:open-file", { path, line });
  ctx.require(workspacePlugin).toast(`Open in editor: ${path}:${line}`);
}

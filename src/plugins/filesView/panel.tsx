/**
 * @file filesView plugin — the Files panel: no game sources (files come from the files channel).
 */
import type { PanelSpec } from "../panels/types";
import type { FilesViewCtx } from "./types";

/**
 * The Files panel: `definePanel({ id: "files", title: "Files", workspace: "files", sources: {}, view })`.
 *
 * @param _ctx - Domain context of filesView.
 * @example
 * ```ts
 * ctx.require(panelsPlugin).register(createFilesPanel(ctx));
 * ```
 */
export function createFilesPanel(_ctx: FilesViewCtx): PanelSpec {
  throw new Error("not implemented");
}

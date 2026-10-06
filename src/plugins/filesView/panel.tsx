/**
 * @file filesView plugin — the Files panel: no game sources (files come from the files channel,
 * not from game sources); the view renders the whole Files workspace.
 */
import { definePanel } from "../panels/shared/define";
import type { PanelSpec } from "../panels/types";
import { createFilesViewApi } from "./api";
import type { FilesViewCtx } from "./types";
import { FilesView } from "./view/FilesView";

/**
 * The Files panel: `definePanel({ id: "files", title: "Files", workspace: "files", sources: {},
 * view })`. Its view works on the same state as `app.filesView`.
 *
 * @param ctx - Domain context of filesView.
 * @returns The PanelSpec to register.
 */
export function createFilesPanel(ctx: FilesViewCtx): PanelSpec {
  const api = createFilesViewApi(ctx);
  return definePanel({
    id: "files",
    title: "Files",
    workspace: "files",
    sources: {},
    /**
     * Renders the Files workspace; the view re-reads the state on every filesView change.
     *
     * @returns The Files view.
     */
    view: () => <FilesView ctx={ctx} api={api} />
  });
}

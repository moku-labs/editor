/**
 * @file filesView plugin — the file bar: the path crumb (a folder segment reveals and focuses it
 * in the tree), Preview · Source for markdown and series, Open in editor (D-08), Edit here /
 * Cancel / Save ⌘S, the status line and the conflict bar.
 */
import type { VNode } from "preact";
import { workspacePlugin } from "../../workspace";
import { notify } from "../store";
import { cancelEdit } from "../tabs/edit";
import { isTextKind } from "../tabs/kind";
import { isModified } from "../tabs/model";
import { revealPath } from "../tree/model";
import type { FilesViewApi, FilesViewCtx, OpenTab } from "../types";

/**
 * Props of `FileBar`.
 *
 * @example
 * ```tsx
 * <FileBar ctx={ctx} api={api} tab={tab} />
 * ```
 */
export type FileBarProps = {
  readonly ctx: FilesViewCtx;
  readonly api: FilesViewApi;
  readonly tab: OpenTab;
};

/**
 * One crumb segment.
 */
type Segment = { readonly name: string; readonly path: string };

/**
 * The folder segments of a path.
 *
 * @param path - Relative file path.
 * @returns One segment per folder, root first.
 * @example
 * ```ts
 * foldersOf("a/b/c.ts"); // [{ name: "a", path: "a" }, { name: "b", path: "a/b" }]
 * ```
 */
function foldersOf(path: string): Segment[] {
  const names = path.split("/").slice(0, -1);
  return names.map((name, position) => ({ name, path: names.slice(0, position + 1).join("/") }));
}

/**
 * Reveals a folder in the tree and focuses its row once it is rendered.
 *
 * @param ctx - Domain context of filesView.
 * @param folder - The folder path.
 * @param from - The crumb button (to find the tree of this panel).
 * @example
 * ```ts
 * revealFolder(ctx, "nodes", event.currentTarget);
 * ```
 */
function revealFolder(ctx: FilesViewCtx, folder: string, from: HTMLElement): void {
  revealPath(ctx.state.expanded, folder);
  notify(ctx.state);
  const view = from.closest('[data-part="files-view"]');
  setTimeout(() => {
    const rows = view?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [];
    for (const row of rows) if (row.dataset.path === folder) row.focus();
  }, 0);
}

/**
 * The status line text: "Saving…", or the save note or error.
 *
 * @param tab - The tab.
 * @returns The text, or undefined.
 * @example
 * ```ts
 * statusText({ ...tab, status: "saving" }); // "Saving…"
 * ```
 */
function statusText(tab: OpenTab): string | undefined {
  if (tab.status === "saving") return "Saving…";
  return tab.status === "ready" || tab.status === "conflict" ? tab.message : undefined;
}

/**
 * The file bar of the active tab.
 *
 * @param props - Context, api and the tab.
 * @returns The bar.
 * @example
 * ```tsx
 * <FileBar ctx={ctx} api={api} tab={tab} />
 * ```
 */
export function FileBar(props: FileBarProps): VNode {
  const { ctx, api, tab } = props;
  const url = api.editorUrl(tab.path, tab.line);
  const status = statusText(tab);
  const switchable = tab.kind === "markdown" || tab.kind === "series";

  return (
    <div data-part="file-bar">
      <div data-bar-row>
        <nav data-crumb aria-label="Path">
          {foldersOf(tab.path).map(segment => (
            <span key={segment.path} data-crumb-segment>
              <button
                type="button"
                data-crumb-folder
                onClick={event => revealFolder(ctx, segment.path, event.currentTarget)}
              >
                {segment.name}
              </button>
              /
            </span>
          ))}
          <span data-crumb-file>{tab.path.slice(tab.path.lastIndexOf("/") + 1)}</span>
        </nav>
        <div data-actions>
          {switchable && (
            <div data-segmented role="radiogroup" aria-label="View">
              {(["preview", "source"] as const).map(mode => (
                // biome-ignore lint/a11y/useSemanticElements: a segmented control of buttons, styled as one group (workspace [data-segmented])
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={tab.mode === mode}
                  onClick={() => api.setMode(tab.path, mode)}
                >
                  {mode === "preview" ? "Preview" : "Source"}
                </button>
              ))}
            </div>
          )}
          {url !== undefined && (
            <a
              href={url}
              data-open-editor
              onClick={() => ctx.require(workspacePlugin).toast("Opened in your editor", tab.path)}
            >
              Open in editor
            </a>
          )}
          {isTextKind(tab.kind) && !tab.editing && (
            <button type="button" data-variant="ghost" onClick={() => api.edit(true, tab.path)}>
              Edit here
            </button>
          )}
          {tab.editing && (
            <>
              <button type="button" data-variant="ghost" onClick={() => cancelEdit(ctx, tab.path)}>
                Cancel
              </button>
              <button
                type="button"
                data-variant="primary"
                disabled={!isModified(tab)}
                onClick={() => {
                  api.save(tab.path);
                }}
              >
                Save ⌘S
              </button>
            </>
          )}
        </div>
      </div>
      {status !== undefined && (
        <p data-save-status role="status">
          {status}
        </p>
      )}
      {tab.status === "conflict" && (
        <div data-conflict role="alert">
          The file changed on disk ·{" "}
          <button
            type="button"
            data-link
            onClick={() => {
              api.resolveConflict(tab.path, "reload");
            }}
          >
            Reload
          </button>
          {" / "}
          <button
            type="button"
            data-link
            onClick={() => {
              api.resolveConflict(tab.path, "overwrite");
            }}
          >
            Overwrite
          </button>
        </div>
      )}
    </div>
  );
}

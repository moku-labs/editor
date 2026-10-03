/**
 * @file filesView plugin — A5, the Files workspace: the project tree beside the editor column
 * (tabs, file bar, Used by, body). The body shows the file by kind and mode; no tab open shows
 * the F5 Files text.
 */
import type { VNode } from "preact";
import { langOf } from "../../panels/shared/highlight";
import type { LinkStatus } from "../../registry/protocol";
import { parseSeriesIndex } from "../preview/series";
import { TOO_LARGE_MESSAGE } from "../tabs/load";
import { activeTab } from "../tabs/model";
import { closeTab } from "../tabs/open";
import type { FilesViewApi, FilesViewCtx, OpenTab } from "../types";
import { CodeEditor } from "./CodeEditor";
import { CodeView } from "./CodeView";
import { FileBar } from "./FileBar";
import { ImagePreview } from "./ImagePreview";
import { JsonBar } from "./JsonBar";
import { MarkdownPreview } from "./MarkdownPreview";
import { SeriesCard } from "./SeriesCard";
import { Tabs } from "./Tabs";
import { Tree } from "./Tree";
import { UsedBy } from "./UsedBy";
import { useFiles } from "./useFiles";

/**
 * Props of `FilesView`.
 */
export type FilesViewProps = {
  readonly ctx: FilesViewCtx;
  readonly api: FilesViewApi;
  readonly status: LinkStatus;
};

/**
 * Props of the body.
 */
type BodyProps = { readonly ctx: FilesViewCtx; readonly api: FilesViewApi; readonly tab: OpenTab };

/**
 * The text a tab shows: the buffer (which may hold unsaved changes), else the text on disk.
 *
 * @param tab - The tab.
 * @returns The text.
 * @example
 * ```ts
 * textOf(tab); // "export const merge = 1;\n"
 * ```
 */
function textOf(tab: OpenTab): string {
  return tab.buffer ?? tab.saved ?? "";
}

/**
 * The body of a ready tab by kind and mode.
 *
 * @param props - Context, api and the tab.
 * @returns The body content.
 */
function Content(props: BodyProps): VNode {
  const { ctx, api, tab } = props;
  const text = textOf(tab);
  const code = (
    <CodeView
      path={tab.path}
      text={text}
      lang={langOf(tab.path)}
      line={tab.line}
      maxHighlightChars={ctx.config.maxHighlightChars}
    />
  );

  if (tab.kind === "image") return <ImagePreview ctx={ctx} tab={tab} />;
  if (tab.editing) {
    return (
      <>
        {(tab.kind === "json" || tab.kind === "series") && <JsonBar text={text} />}
        <CodeEditor api={api} tab={tab} />
      </>
    );
  }
  if (tab.kind === "markdown" && tab.mode === "preview") {
    return <MarkdownPreview ctx={ctx} api={api} tab={tab} />;
  }
  if (tab.kind === "series") {
    return (
      <>
        <SeriesCard ctx={ctx} tab={tab} />
        {(tab.mode === "source" || parseSeriesIndex(text) === undefined) && code}
      </>
    );
  }
  if (tab.kind === "json") {
    return (
      <>
        <JsonBar text={text} />
        {code}
      </>
    );
  }
  return code;
}

/**
 * The body: loading, missing, error, or the content.
 *
 * @param props - Context, api and the tab.
 * @returns The body.
 */
function Body(props: BodyProps): VNode {
  const { ctx, api, tab } = props;
  if (tab.status === "loading") {
    return (
      <p data-body-state="loading" role="status">
        Loading…
      </p>
    );
  }
  if (tab.status === "missing") {
    return (
      <div data-body-state="missing" role="status">
        <p>{tab.message}</p>
        <button type="button" data-variant="ghost" onClick={() => closeTab(ctx, tab.path, true)}>
          Close tab
        </button>
      </div>
    );
  }
  if (tab.status === "error") {
    const url = tab.message === TOO_LARGE_MESSAGE ? api.editorUrl(tab.path) : undefined;
    return (
      <div data-body-state="error" role="alert">
        <p>
          {tab.message}
          {url !== undefined && (
            <>
              {" · "}
              <a href={url}>Open in editor</a>
            </>
          )}
        </p>
      </div>
    );
  }
  return <Content ctx={ctx} api={api} tab={tab} />;
}

/**
 * The Files workspace view.
 *
 * @param props - Context, api and the link status of this render.
 * @returns The grid: tree | editor column.
 */
export function FilesView(props: FilesViewProps): VNode {
  const { ctx, api, status } = props;
  const tab = useFiles(api, () => activeTab(ctx.state));

  return (
    <div data-part="files-view">
      <Tree ctx={ctx} api={api} />
      <div data-files-editor>
        {tab === undefined ? (
          <p data-empty>Pick a file in the tree, or press ⌘K and type a file name.</p>
        ) : (
          <>
            <Tabs ctx={ctx} />
            <FileBar ctx={ctx} api={api} tab={tab} />
            <UsedBy ctx={ctx} api={api} tab={tab} status={status} />
            <div data-files-body>
              <Body ctx={ctx} api={api} tab={tab} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

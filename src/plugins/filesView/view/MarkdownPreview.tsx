/**
 * @file filesView plugin — the Markdown preview: the note front matter through the shared codec
 * (rows, capture links), then the body through the safe renderer; relative links and captures
 * open in Files.
 */
import type { VNode } from "preact";
import { useMemo } from "preact/hooks";
import { FrontMatterRows, noteParts } from "../preview/front-matter";
import { renderMarkdown } from "../preview/markdown";
import { openOrLog } from "../tabs/open";
import { parentOf } from "../tree/model";
import type { FilesViewApi, FilesViewCtx, OpenTab } from "../types";

/**
 * Props of `MarkdownPreview`.
 *
 * @example
 * ```tsx
 * <MarkdownPreview ctx={ctx} api={api} tab={tab} />
 * ```
 */
export type MarkdownPreviewProps = {
  readonly ctx: FilesViewCtx;
  readonly api: FilesViewApi;
  readonly tab: OpenTab;
};

/**
 * The preview of a Markdown tab.
 *
 * @param props - Context, api and the tab.
 * @returns The preview.
 * @example
 * ```tsx
 * <MarkdownPreview ctx={ctx} api={api} tab={tab} />
 * ```
 */
export function MarkdownPreview(props: MarkdownPreviewProps): VNode {
  const { ctx, tab } = props;
  const text = tab.buffer ?? tab.saved ?? "";
  const body = useMemo(() => noteParts(text).body, [text]);

  /**
   * Opens a project path in Files (a failure is warned).
   *
   * @param path - The path.
   * @example
   * ```ts
   * open(".moku/captures/a.png");
   * ```
   */
  const open = (path: string): void => {
    openOrLog(ctx, path, {});
  };

  return (
    <div data-part="preview" data-preview="markdown">
      <FrontMatterRows text={text} onOpenPath={open} />
      {renderMarkdown(body, open, parentOf(tab.path))}
    </div>
  );
}

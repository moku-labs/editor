/**
 * @file filesView plugin — the Markdown preview: a front matter as one plain block of its raw
 * lines, then the body through the safe renderer; relative links open in Files.
 */
import type { VNode } from "preact";
import { useMemo } from "preact/hooks";
import { frontMatterParts, renderMarkdown } from "../preview/markdown";
import { openOrLog } from "../tabs/open";
import { parentOf } from "../tree/model";
import type { FilesViewApi, FilesViewCtx, OpenTab } from "../types";

/**
 * Props of `MarkdownPreview`.
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
 */
export function MarkdownPreview(props: MarkdownPreviewProps): VNode {
  const { ctx, tab } = props;
  const text = tab.buffer ?? tab.saved ?? "";
  const parts = useMemo(() => frontMatterParts(text), [text]);

  /**
   * Opens a project path in Files (a failure is warned).
   *
   * @param path - The path.
   */
  const open = (path: string): void => {
    openOrLog(ctx, path, {});
  };

  return (
    <div data-part="preview" data-preview="markdown">
      {parts.kind === "raw" && <pre data-front-matter="">{parts.lines.join("\n")}</pre>}
      {renderMarkdown(parts.body, open, parentOf(tab.path))}
    </div>
  );
}

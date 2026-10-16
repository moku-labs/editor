/**
 * @file renderView components (inspector) — a file link of the range view (spec 09 § M10 Files):
 * `folder…/file.ts:line` where the directory part shrinks with an ellipsis and the base name and line
 * never wrap or cut, the system as meta, the open icon; a click emits `workspace:open-file` and toasts.
 */
import type { JSX } from "preact";
import { openFile } from "../../actions/files";
import type { FileRow, RenderViewCtx } from "../../types";
import { MissionIcon } from "../icons";

/**
 * Props of `FileLink`.
 */
export type FileLinkProps = { readonly ctx: RenderViewCtx; readonly row: FileRow };

/**
 * A file link.
 *
 * @param props - ctx and the file row.
 * @returns The link.
 */
export function FileLink(props: FileLinkProps): JSX.Element {
  const { ctx, row } = props;
  const cut = row.path.lastIndexOf("/") + 1;
  return (
    <li>
      <button
        type="button"
        data-file-link
        title={`Open ${row.path}:${row.line} in your editor`}
        onClick={() => openFile(ctx, row.path, row.line)}
      >
        <span data-part="path">
          <span data-part="dir">{row.path.slice(0, cut)}</span>
          <span data-part="base">
            {row.path.slice(cut)}:{row.line}
          </span>
        </span>
        <span data-part="meta">{row.system}</span>
        <MissionIcon name="open" size={12} />
      </button>
    </li>
  );
}

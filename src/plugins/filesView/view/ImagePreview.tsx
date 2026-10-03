/**
 * @file filesView plugin — the image preview: the data URL from `readBinary` in an `<img>` on a
 * checkerboard, fitted to the body; a click toggles fit / 100 %; caption "W×H · N KB · path".
 */
import type { VNode } from "preact";
import { useState } from "preact/hooks";
import type { FilesViewCtx, OpenTab } from "../types";

/**
 * Props of `ImagePreview`.
 *
 * @example
 * ```tsx
 * <ImagePreview ctx={ctx} tab={tab} />
 * ```
 */
export type ImagePreviewProps = { readonly ctx: FilesViewCtx; readonly tab: OpenTab };

/**
 * The size of an image in KB: the index entry, else estimated from the base64 data URL.
 *
 * @param size - Bytes from the index, when known.
 * @param dataUrl - The data URL.
 * @returns Whole KB, at least 1.
 * @example
 * ```ts
 * kilobytes(20_480, ""); // 20
 * ```
 */
function kilobytes(size: number | undefined, dataUrl: string): number {
  const bytes = size ?? Math.floor(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4);
  return Math.max(1, Math.round(bytes / 1024));
}

/**
 * The image preview of a tab.
 *
 * @param props - Context and the image tab.
 * @returns The figure.
 * @example
 * ```tsx
 * <ImagePreview ctx={ctx} tab={tab} />
 * ```
 */
export function ImagePreview(props: ImagePreviewProps): VNode {
  const { ctx, tab } = props;
  const [actual, setActual] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | undefined>();
  const dataUrl = tab.image ?? "";
  const size = kilobytes(ctx.state.index?.files.get(tab.path)?.size, dataUrl);
  const caption = [
    ...(natural === undefined ? [] : [`${natural.w}×${natural.h}`]),
    `${size} KB`,
    tab.path
  ].join(" · ");

  return (
    <figure data-part="preview" data-preview="image" data-fit={actual ? "actual" : "fit"}>
      <button
        type="button"
        data-image-toggle
        aria-pressed={actual}
        aria-label={actual ? "Fit the image" : "Show the image at 100 %"}
        onClick={() => setActual(!actual)}
      >
        <img
          alt={tab.path}
          src={dataUrl}
          onLoad={event =>
            setNatural({
              w: event.currentTarget.naturalWidth,
              h: event.currentTarget.naturalHeight
            })
          }
        />
      </button>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

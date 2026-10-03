/**
 * @file renderView plugin — the pink hover box drawn in renderView's root inside the game frame's
 * overlay (device space): one absolutely placed outline, no pointer events.
 */
import type { JSX } from "preact";
import type { PageRect } from "../../panels/shared/scene";

/**
 * Props of `BoxRoot`.
 */
export type BoxRootProps = {
  /** The element's rect in game page CSS px; undefined draws nothing. */
  readonly rect: PageRect | undefined;
};

/**
 * The hover box around one element of the game frame.
 *
 * @param props - The rect to ring.
 * @returns The box, or nothing without a rect.
 * @example
 * ```tsx
 * render(<BoxRoot rect={{ x: 55, y: 801, w: 970, h: 970 }} />, overlayRoot);
 * ```
 */
export function BoxRoot(props: BoxRootProps): JSX.Element | null {
  const { rect } = props;
  // eslint-disable-next-line unicorn/no-null -- a Preact component renders null for "nothing"
  if (rect === undefined) return null;

  return (
    <div
      data-box=""
      aria-hidden="true"
      style={{
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.w}px`,
        height: `${rect.h}px`
      }}
    />
  );
}

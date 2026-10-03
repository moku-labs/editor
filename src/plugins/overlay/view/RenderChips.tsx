/**
 * @file overlay plugin — the render chips: fps, frame time and texture memory.
 */
import type { VNode } from "preact";
import type { RenderChip } from "../types";

/**
 * Props of `RenderChips`.
 *
 * @example
 * ```ts
 * const props: RenderChipsProps = { chips: renderChips(state.render, false) };
 * ```
 */
export type RenderChipsProps = { readonly chips: readonly RenderChip[] };

/**
 * The chip row. Not announced: the numbers change four times a second.
 *
 * @param props - The chips.
 * @returns The chip row.
 * @example
 * ```tsx
 * <RenderChips chips={renderChips({ fps: 60, frameMs: 4.1, textureMb: 31.1 }, false)} />
 * ```
 */
export function RenderChips(props: RenderChipsProps): VNode {
  return (
    <p data-chips="" aria-live="off">
      {props.chips.map(chip => (
        <span key={chip.key} data-chip={chip.key} title={chip.title}>
          {chip.text}
        </span>
      ))}
    </p>
  );
}

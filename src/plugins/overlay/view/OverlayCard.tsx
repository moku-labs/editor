/**
 * @file overlay plugin — the card root: header with the link dot, render chips, cheat list and a
 * visually hidden status line (data-* only, no class attribute).
 */
import type { VNode } from "preact";
import type { OverlayView } from "../types";

/**
 * Props of the overlay card: the painted view and the cheat click handler.
 */
export type OverlayCardProps = OverlayView & { readonly onCheat: (id: string) => void };

/**
 * The overlay card, a pure function of its props.
 *
 * @param _props - The view from viewOf and the cheat handler.
 * @example
 * ```tsx
 * render(<OverlayCard {...viewOf(state, config, Date.now())} onCheat={id => runCheat(octx, id)} />, root);
 * ```
 */
export function OverlayCard(_props: OverlayCardProps): VNode {
  throw new Error("not implemented");
}

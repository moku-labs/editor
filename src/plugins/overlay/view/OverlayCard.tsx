/**
 * @file overlay plugin — the card root: header with the link dot, render chips, cheat list and a
 * visually hidden status line (data-* only, no class attribute).
 */
import type { VNode } from "preact";
import type { OverlayView } from "../types";
import { CheatList } from "./CheatList";
import { LinkDot } from "./LinkDot";
import { RenderChips } from "./RenderChips";

/**
 * Props of the overlay card: the painted view and the cheat click handler.
 *
 * @example
 * ```ts
 * const props: OverlayCardProps = { ...viewOf(state, config, Date.now()), onCheat };
 * ```
 */
export type OverlayCardProps = OverlayView & { readonly onCheat: (id: string) => void };

/**
 * The overlay card, a pure function of its props. Render numbers and cheats only; no graph
 * controls.
 *
 * @param props - The view from viewOf and the cheat handler.
 * @returns The card.
 * @example
 * ```tsx
 * render(<OverlayCard {...viewOf(state, config, Date.now())} onCheat={id => runCheat(octx, id)} />, root);
 * ```
 */
export function OverlayCard(props: OverlayCardProps): VNode {
  return (
    <section
      data-overlay=""
      data-corner={props.corner}
      aria-label="Moku editor overlay: render numbers and cheats"
    >
      <header data-head="">
        {props.link === undefined ? undefined : (
          <LinkDot kind={props.link.kind} label={props.link.label} />
        )}
        <span data-title="">Overlay in game</span>
        <span data-hint="">render + cheats</span>
      </header>
      <RenderChips chips={props.chips} />
      <CheatList cheats={props.cheats} onCheat={props.onCheat} />
      <p role="status" data-announce="">
        {props.announce}
      </p>
    </section>
  );
}

/**
 * @file gameView plugin — the capture card (F2) in the browser top layer (R4): thumbnail,
 * "✓ Screenshot saved", the file, "frame N · <device>" and a close button. A polite status; it
 * stays while hovered or focused.
 */
import type { VNode } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { hideCard } from "../capture/shot";
import type { GameViewCtx } from "../types";
import { holdCard } from "../view-state";
import { showInTopLayer } from "./SeriesPopover";
import { useGameView } from "./useGameView";

/**
 * Props of `CaptureCard`.
 */
export type CaptureCardProps = { readonly ctx: GameViewCtx };

/**
 * The capture card.
 *
 * @param props - The gameView domain context.
 * @returns The card, undefined without a capture.
 */
export function CaptureCard(props: CaptureCardProps): VNode | undefined {
  const { ctx } = props;
  const { state } = ctx;
  const card = useGameView(state, () => state.card);
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (card !== undefined) showInTopLayer(element.current);
  }, [card]);
  if (card === undefined) return;

  return (
    <div
      data-game="card"
      popover="manual"
      role="status"
      aria-live="polite"
      ref={element}
      onPointerEnter={() => holdCard(state, true)}
      onPointerLeave={() => holdCard(state, false)}
      onFocusIn={() => holdCard(state, true)}
      onFocusOut={() => holdCard(state, false)}
    >
      <img src={card.image} alt={`Screenshot ${card.path}`} />
      <div data-part="body">
        <p data-part="saved">✓ Screenshot saved</p>
        <p data-part="path">{card.path}</p>
        <p data-part="meta">
          frame {card.frame} · {card.device}
        </p>
      </div>
      <button type="button" aria-label="Close" onClick={() => hideCard(ctx)}>
        ×
      </button>
    </div>
  );
}

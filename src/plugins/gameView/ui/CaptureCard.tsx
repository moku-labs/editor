/**
 * @file gameView plugin — the capture card (F2, round 2b R14) in the browser top layer (R4): a
 * 56 px thumbnail, one title line ("✓ Screenshot saved", "✓ 20 shots saved"), the path cut in
 * the middle (the whole path in its title), "f<frame> · <device>", the actions Copy link, Open and,
 * for a pick, Reference, and a close button. One card for a screenshot, the shot of a pick and a
 * series. A polite status; it stays while hovered or focused.
 */
import type { VNode } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { openSheet } from "../capture/sheet";
import { hideCard } from "../capture/shot";
import { copyText } from "../clipboard";
import { openInFiles } from "../element/select";
import type { CaptureCardInfo, GameViewCtx } from "../types";
import { holdCard } from "../view-state";
import { showInTopLayer } from "./SeriesPopover";
import { middleEllipsis } from "./text";
import { useGameView } from "./useGameView";

/**
 * Props of `CaptureCard`.
 */
export type CaptureCardProps = { readonly ctx: GameViewCtx };

/**
 * The characters of the path line before it is cut in the middle.
 */
const PATH_CHARS = 36;

/**
 * The title line of a card.
 *
 * @param card - The card.
 * @returns "✓ Screenshot saved", "✓ 20 shots saved".
 * @example
 * ```ts
 * cardTitle({ path: "a/", frame: 1, device: "d", image: "", series: { indexPath: "a/index.json", shots: 20 } }); // "✓ 20 shots saved"
 * ```
 */
function cardTitle(card: CaptureCardInfo): string {
  return card.series === undefined ? "✓ Screenshot saved" : `✓ ${card.series.shots} shots saved`;
}

/**
 * The line "Copy link" puts on the clipboard.
 *
 * @param card - The card.
 * @returns `shot: <path>` or `series: <folder> (<n> frames)`.
 * @example
 * ```ts
 * cardLink({ path: "a.png", frame: 1, device: "d", image: "" }); // "shot: a.png"
 * ```
 */
function cardLink(card: CaptureCardInfo): string {
  return card.series === undefined
    ? `shot: ${card.path}`
    : `series: ${card.path} (${card.series.shots} frames)`;
}

/**
 * Open: the contact sheet of a series, else the picture in Files.
 *
 * @param ctx - Domain context of gameView.
 * @param card - The card.
 */
function openCard(ctx: GameViewCtx, card: CaptureCardInfo): void {
  if (card.series === undefined) openInFiles(ctx, card.path);
  else void openSheet(ctx, card.series.indexPath);
}

/**
 * The actions row: Copy link, Open and, for a pick, Reference.
 *
 * @param props - The context and the card.
 * @param props.ctx - Domain context of gameView.
 * @param props.card - The card.
 * @returns The row.
 */
function CardActions(props: { readonly ctx: GameViewCtx; readonly card: CaptureCardInfo }): VNode {
  const { ctx, card } = props;
  const { reference } = card;
  return (
    <div data-part="actions">
      <button
        type="button"
        data-action="copy-link"
        onClick={() => void copyText(ctx, cardLink(card), "✓ Link copied")}
      >
        Copy link
      </button>
      <button type="button" data-action="open" onClick={() => openCard(ctx, card)}>
        Open
      </button>
      {reference !== undefined && (
        <button
          type="button"
          data-action="reference"
          title={reference}
          onClick={() => void copyText(ctx, reference, "✓ Reference copied")}
        >
          Reference
        </button>
      )}
    </div>
  );
}

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
      <p data-part="saved">{cardTitle(card)}</p>
      <p data-part="path" title={card.path}>
        {middleEllipsis(card.path, PATH_CHARS)}
      </p>
      <p data-part="meta">
        f{card.frame} · {card.device}
      </p>
      <CardActions ctx={ctx} card={card} />
      <button type="button" data-part="close" aria-label="Close" onClick={() => hideCard(ctx)}>
        ×
      </button>
    </div>
  );
}

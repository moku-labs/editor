/**
 * @file renderView components (cards) — the sync note above the cards (spec 09 § M9): "Cards share the
 * frame window above: {span}, moving live" or "paused {s} s behind live", the selection highlighted in
 * each, and that hovering any graph moves one cursor across all of them.
 */
import type { JSX } from "preact";
import { rangeTitle, spanWords } from "../../derive/inspector";
import type { RenderViewCtx } from "../../types";
import { viewWindow } from "../../view/view";
import { useTicker } from "../useMission";

/**
 * Props of `SyncNote`.
 */
export type SyncNoteProps = { readonly ctx: RenderViewCtx };

/**
 * The sync note.
 *
 * @param props - ctx.
 * @returns The note.
 */
export function SyncNote(props: SyncNoteProps): JSX.Element {
  const { mission } = props.ctx.state;
  const { live, span } = mission.view;
  useTicker(1000, !live);
  const behind = Math.round(viewWindow(mission, performance.now()).behindMs / 1000);
  const { selection } = mission;
  return (
    <p data-sync-note>
      <span data-dot={live ? "live" : "paused"} aria-hidden="true" />
      <span>
        Cards share the frame window above: <b>{spanWords(span)}</b>,{" "}
        {live ? "moving live" : <b>{`paused ${behind} s behind live`}</b>}
        {selection === undefined ? undefined : (
          <>
            , selection <b>{rangeTitle(selection)}</b> highlighted in each
          </>
        )}
        . Hover any graph to move one cursor across all of them.
      </span>
    </p>
  );
}

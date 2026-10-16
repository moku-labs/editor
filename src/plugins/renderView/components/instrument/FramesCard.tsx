/**
 * @file renderView components (instrument) — the frames card (spec 09 § M8): the header, the frame
 * timeline with its overlay and tooltip, the Shaders & passes lane, the deck (the overview scrubber and
 * the transport row) and the legend.
 */
import type { JSX } from "preact";
import type { RenderViewApi, RenderViewCtx } from "../../types";
import { FramesHeader } from "./FramesHeader";
import { LaneCanvas } from "./LaneCanvas";
import { Legend } from "./Legend";
import { OverviewCanvas } from "./OverviewCanvas";
import { TimelineCanvas } from "./TimelineCanvas";
import { Transport } from "./Transport";

/**
 * Props of `FramesCard`.
 */
export type FramesCardProps = { readonly ctx: RenderViewCtx; readonly api: RenderViewApi };

/**
 * The frames card.
 *
 * @param props - ctx and the api.
 * @returns The card.
 */
export function FramesCard(props: FramesCardProps): JSX.Element {
  const { ctx, api } = props;
  return (
    <section data-render="frames" data-card aria-label="Frame timeline">
      <FramesHeader ctx={ctx} api={api} />
      <TimelineCanvas ctx={ctx} api={api} />
      <LaneCanvas ctx={ctx} api={api} />
      <div data-part="deck">
        <OverviewCanvas ctx={ctx} api={api} />
        <Transport ctx={ctx} api={api} />
      </div>
      <Legend ctx={ctx} />
    </section>
  );
}

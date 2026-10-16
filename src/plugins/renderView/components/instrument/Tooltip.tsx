/**
 * @file renderView components (instrument) — the hover tooltip of the frame timeline (spec 09 § M8):
 * the hovered frame's numbers and the one line of what it was (derive/tooltip.ts), at the cursor's x
 * (`clamp(x + 12, 8, pw − 190)`), 34 px from the top; rebuilt when the hovered frame changes, hidden
 * while a drag selects.
 */
import type { JSX } from "preact";
import { graphFlags } from "../../derive/mission";
import { tooltipOf } from "../../derive/tooltip";
import { GUTTER } from "../../timeline/layout";
import { paintedScene } from "../../timeline/loop";
import type { RenderViewCtx } from "../../types";
import { useHoverFrame } from "../useMission";

/**
 * Props of `Tooltip`.
 */
export type TooltipProps = {
  readonly ctx: RenderViewCtx;
  /** A drag is selecting: the tooltip hides. */
  readonly dragging: boolean;
  /** The timeline's width, CSS px (its plot is this less the gutter). */
  readonly width: number;
};

/** The tooltip's distance right of the cursor, px. */
const OFFSET = 12;

/** The room the tooltip keeps from the plot's right edge, px. */
const RIGHT_ROOM = 190;

/**
 * The hover tooltip; nothing without a hovered frame.
 *
 * @param props - ctx, whether a drag selects, the timeline's width.
 * @returns The tooltip, or nothing.
 */
export function Tooltip(props: TooltipProps): JSX.Element | null {
  const { ctx, dragging, width } = props;
  const { mission } = ctx.state;
  const frame = useHoverFrame(mission);
  const hoverMs = mission.hoverMs;
  // eslint-disable-next-line unicorn/no-null -- Preact renders null for "nothing"
  if (dragging || frame === undefined || hoverMs === undefined) return null;
  const flags = graphFlags(mission);
  const gpu = mission.telemetry?.gpu;
  const view = tooltipOf(mission.history, frame, {
    gpu: flags.gpu,
    passes: flags.passes,
    // eslint-disable-next-line unicorn/no-null -- null: no clock reading
    gpuMhz: gpu?.available === true ? gpu.value.mhz : null,
    gcShown: flags.gc === "on"
  });
  // eslint-disable-next-line unicorn/no-null -- Preact renders null for "nothing"
  if (view === undefined) return null;
  const scene = paintedScene(mission);
  const plot = Math.max(1, width - GUTTER);
  const x = scene === undefined ? 0 : ((hoverMs - (scene.endMs - scene.span)) / scene.span) * plot;
  const left = Math.min(Math.max(x + OFFSET, 8), plot - RIGHT_ROOM);
  return (
    <div data-tooltip role="tooltip" style={{ left: `${Math.round(left)}px` }}>
      <p data-part="row">
        <b>{view.frame}</b>
        <b>{view.ms}</b>
      </p>
      {view.rows.map(row => (
        <p key={row.label} data-part="row">
          <span>{row.label}</span>
          <span>{row.value}</span>
        </p>
      ))}
      <p data-part="line">{view.line}</p>
    </div>
  );
}

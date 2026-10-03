/**
 * @file flowView render module — one hub lane band (G lane row): alternating tint by index, an
 * accent inset while its outcome is on the trail. A lane band is empty canvas for clicks (M2).
 */
import type { VNode } from "preact";
import type { LaneBand } from "../types";

/**
 * Props of `Lane`.
 */
export type LaneProps = { readonly lane: LaneBand; readonly trail: boolean };

/**
 * One lane band.
 *
 * @param props - The lane and whether it is on the trail.
 * @returns The band.
 * @example
 * ```tsx
 * <Lane lane={lane} trail={false} />
 * ```
 */
export function Lane(props: LaneProps): VNode {
  const { lane, trail } = props;
  return (
    <div
      data-flow="lane"
      data-hit="lane"
      data-index={lane.index}
      data-odd={lane.index % 2 === 1 ? "" : undefined}
      data-trail={trail ? "" : undefined}
      data-outcome={lane.outcome}
      style={{
        left: `${lane.x}px`,
        top: `${lane.y}px`,
        width: `${lane.w}px`,
        height: `${lane.h}px`
      }}
    />
  );
}

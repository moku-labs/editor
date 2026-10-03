/**
 * @file flowView render module — the edge layer (G edges): one SVG in the world layer with
 * orthogonal paths and 8 px rounded corners; trail, rejected, related, selected, note and return
 * edges by data attributes; mono label chips at the first segment's midpoint.
 */
import type { VNode } from "preact";
import { roundedPath } from "../layout/routes";
import type { EdgePath, LaneBand, Rect } from "../types";
import type { EdgeView } from "./types";

/**
 * Corner radius of every edge.
 */
const RADIUS = 8;

/**
 * How much each trail step fades.
 */
const TRAIL_FADE = 0.13;

/**
 * Props of `Edges`.
 */
export type EdgesProps = {
  readonly edges: readonly EdgePath[];
  /** The world rect the SVG covers. */
  readonly bounds: Rect;
  /** Edge views by `edgeId`. */
  readonly views: ReadonlyMap<string, EdgeView>;
  /** Stub keys whose return edge is drawn (hovered or selected). */
  readonly showReturns: ReadonlySet<string>;
};

/**
 * The id of an edge in the world: source, outcome and kind.
 *
 * @param edge - The edge.
 * @returns The id.
 * @example
 * ```ts
 * edgeId({ from: "main/home", outcome: "play", kind: "edge" }); // "main/home|play|edge"
 * ```
 */
export function edgeId(edge: Pick<EdgePath, "from" | "outcome" | "kind">): string {
  return `${edge.from}|${edge.outcome}|${edge.kind}`;
}

/**
 * The id of a lane band in the world.
 *
 * @param lane - The lane.
 * @returns The id.
 * @example
 * ```ts
 * laneId({ x: 264, y: 72 }); // "264|72"
 * ```
 */
export function laneId(lane: Pick<LaneBand, "x" | "y">): string {
  return `${lane.x}|${lane.y}`;
}

/**
 * The midpoint of an edge's first segment.
 *
 * @param edge - The edge.
 * @returns The point, or undefined for an edge without two points.
 * @example
 * ```ts
 * labelPoint(edge); // { x: 236, y: 100 }
 * ```
 */
function labelPoint(edge: EdgePath): { x: number; y: number } | undefined {
  const [first, second] = edge.points;
  if (first === undefined || second === undefined) return undefined;
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

/**
 * The edge layer.
 *
 * @param props - Edges, bounds, edge views and the shown return edges.
 * @returns The SVG layer and the label chips.
 * @example
 * ```tsx
 * <Edges edges={result.edges} bounds={result.bounds} views={world.edges} showReturns={new Set()} />
 * ```
 */
export function Edges(props: EdgesProps): VNode {
  const { edges, bounds, views, showReturns } = props;
  const shown = edges.filter(edge => edge.kind !== "return" || showReturns.has(edge.from));
  return (
    <>
      <svg
        data-flow="edges"
        aria-hidden="true"
        style={{
          left: `${bounds.x}px`,
          top: `${bounds.y}px`,
          width: `${bounds.w}px`,
          height: `${bounds.h}px`
        }}
        viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
      >
        {shown.map(edge => {
          const view = views.get(edgeId(edge));
          const rank = view?.rank;
          return (
            <path
              key={edgeId(edge)}
              d={roundedPath(edge.points, RADIUS)}
              data-kind={edge.kind}
              data-rank={rank}
              data-trail={rank === undefined ? undefined : ""}
              data-rejected={view?.rejected === true ? "" : undefined}
              data-related={view?.related === true ? "" : undefined}
              data-dimmed={view?.dimmed === true ? "" : undefined}
              data-selected={view?.selected === true ? "" : undefined}
              style={rank === undefined ? undefined : { opacity: String(1 - TRAIL_FADE * rank) }}
            />
          );
        })}
      </svg>
      {shown.map(edge => {
        const point =
          edge.kind === "edge" && edge.label !== undefined ? labelPoint(edge) : undefined;
        if (point === undefined) return false;
        return (
          <span
            key={`label:${edgeId(edge)}`}
            data-flow="edge-label"
            data-hit="outcome"
            data-source={edge.from}
            data-outcome={edge.outcome}
            data-dimmed={views.get(edgeId(edge))?.dimmed === true ? "" : undefined}
            style={{ left: `${point.x}px`, top: `${point.y}px` }}
          >
            {edge.label}
          </span>
        );
      })}
    </>
  );
}

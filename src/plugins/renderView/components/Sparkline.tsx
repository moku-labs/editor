/**
 * @file renderView plugin — the FPS sparkline: an inline SVG polyline, 1.5 px, accent colour.
 */
import type { JSX } from "preact";
import { cssVar } from "../../panels/shared/tokens";
import { sparkPoints } from "../format";

/**
 * Width of the sparkline box.
 */
const WIDTH = 120;

/**
 * Height of the sparkline box.
 */
const HEIGHT = 28;

/**
 * Props of `Sparkline`.
 */
export type SparklineProps = { readonly samples: readonly number[] };

/**
 * The FPS sparkline of the last samples.
 *
 * @param props - The samples.
 * @returns The SVG.
 * @example
 * ```tsx
 * <Sparkline samples={[58, 60, 59]} />
 * ```
 */
export function Sparkline(props: SparklineProps): JSX.Element {
  return (
    <svg
      data-spark=""
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      aria-hidden="true"
    >
      <polyline
        points={sparkPoints(props.samples, WIDTH, HEIGHT)}
        fill="none"
        stroke={cssVar("accent")}
        stroke-width="1.5"
        stroke-linejoin="round"
      />
    </svg>
  );
}

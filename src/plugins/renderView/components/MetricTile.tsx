/**
 * @file renderView plugin — one metric tile: label, big value with its unit, an optional chart,
 * the sub-line and the warn line. Absent values are named and muted.
 */
import type { ComponentChildren, JSX } from "preact";
import type { TileView } from "../format";

/**
 * Props of `MetricTile`.
 */
export type MetricTileProps = {
  readonly view: TileView;
  /** A chart under the value (sparkline, frame bar). */
  readonly children?: ComponentChildren;
};

/**
 * One metric tile.
 *
 * @param props - The tile texts and an optional chart.
 * @returns The tile.
 * @example
 * ```tsx
 * <MetricTile view={tileViews(snapshot.tiles)[2]} />
 * ```
 */
export function MetricTile(props: MetricTileProps): JSX.Element {
  const { view, children } = props;
  return (
    <section data-tile={view.id} data-absent={view.absent ? "" : undefined} aria-label={view.aria}>
      <h2>{view.label}</h2>
      <p data-value>
        <strong>{view.value}</strong>
        {view.unit === "" ? undefined : <span data-unit>{view.unit}</span>}
      </p>
      {children}
      <p data-sub>{view.sub}</p>
      {view.warn === undefined ? undefined : <p data-warn>{view.warn}</p>}
    </section>
  );
}

/**
 * @file renderView plugin — the pools card: one "All pools" row (in use against pooled) and the
 * line naming the per-pool counts game.render does not report (follow-up F-R1).
 */
import type { JSX } from "preact";
import type { RenderSnapshot } from "../types";

/**
 * Props of `PoolsCard`.
 */
export type PoolsCardProps = { readonly pools: RenderSnapshot["pools"] };

/**
 * The pools card.
 *
 * @param props - views and pooled of game.render.
 * @returns The card.
 * @example
 * ```tsx
 * <PoolsCard pools={{ views: 180, pooled: 24 }} />
 * ```
 */
export function PoolsCard(props: PoolsCardProps): JSX.Element {
  const { pools } = props;
  const total = pools === undefined ? 0 : pools.views + pools.pooled;
  const share = pools === undefined || total === 0 ? 0 : pools.views / total;
  return (
    <section data-render="pools" data-card>
      <header>
        <h2>Pools</h2>
      </header>
      {pools === undefined ? (
        <p data-empty>Waiting for game.render.</p>
      ) : (
        <p data-line>
          <span>
            All pools · {pools.pooled} pooled · {pools.views} in use
          </span>
          <span data-bar>
            <span style={{ inlineSize: `${Math.round(share * 100)}%` }} />
          </span>
        </p>
      )}
      <p data-sub>Per-pool counts need game.render pools (follow-up F-R1)</p>
    </section>
  );
}

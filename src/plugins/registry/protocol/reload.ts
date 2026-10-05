/**
 * @file Protocol — the two reload signals the tools read (U9 B5, U10 B1): `isReloading`, the
 * neutral `lost` of an expected reload, and `isHotSwapEntry`, the game.log entry a dev hot swap of
 * game 0.5.0 writes (`ctx.log.info("ui:hot-swap", …)` in its ui plugin). Pure: a wire value is
 * narrowed field by field, never cast.
 */
import type { Json, LinkStatus } from "./types";

/** The log event of an applied hot swap. A refused swap logs `ui:hot-refused` and reloads. */
const HOT_SWAP_EVENT = "ui:hot-swap";

/**
 * True for an object that is neither null nor an array.
 *
 * @param value - A wire value.
 * @returns Whether `value` is a record.
 * @example
 * ```ts
 * isRecord({ file: "/g/a.tsx" }); // true
 * ```
 */
function isRecord(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True for the neutral `lost` of an expected reload (U7): a `lost` with `reloading: true`. The
 * panels keep their data and the frame shows its spinner while it holds.
 *
 * @param status - A link status.
 * @returns Whether the link is lost to an expected reload.
 * @example
 * ```ts
 * // The game page reloads after a save: the panels do not mark their data stale.
 * isReloading({ kind: "lost", reason: "bye", lastFrame: 310, retryInMs: 1000, reloading: true }); // true
 * isReloading({ kind: "lost", reason: "socket_closed", lastFrame: 310, retryInMs: 1000 }); // false
 * ```
 */
export function isReloading(status: LinkStatus): boolean {
  return status.kind === "lost" && status.reloading === true;
}

/**
 * True for one game.log entry of an applied dev hot swap: event `ui:hot-swap`, a numeric `ts` and
 * `data.file`, the saved module. The game.log value is the whole trace: test its entries.
 *
 * @param value - One entry of the game.log value.
 * @returns Whether the entry tells that a hot swap was applied.
 * @example
 * ```ts
 * // A save of a styles module swapped in place: no reload follows.
 * isHotSwapEntry({ level: "info", event: "ui:hot-swap", data: { file: "/g/features/home/styles.ts" }, ts: 1759680000000 }); // true
 * isHotSwapEntry({ level: "info", event: "ui:hot-refused", data: { file: "/g/a.tsx", reason: "no exports" }, ts: 1 }); // false
 * ```
 */
export function isHotSwapEntry(value: Json): boolean {
  if (!isRecord(value)) return false;

  const { event, ts, data } = value;
  return (
    event === HOT_SWAP_EVENT &&
    typeof ts === "number" &&
    isRecord(data) &&
    typeof data.file === "string"
  );
}

/**
 * @file renderView derive — the connection bar's words (spec 09 § M7): the source's name, state
 * and link words, the facts, the rate-now line, the paused chip, the health line. Pure. Typed
 * stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract the other Mission
 * control units build against; build wave 3 (RV3) writes the bodies.
 */
import type { ActiveSource, PerfSecond, SourceHealth, SourceLabel } from "../source/contract";
import { notBuilt } from "../stub";
import type { MissionView } from "../types";

/**
 * The source part of MissionView: session, kind, name, link, and the state (live, waiting for
 * the first second, not started, no monitor).
 *
 * @param _source - activeSource.current().
 * @param _label - activeSource.label().
 * @param _second - The source's newest second.
 * @param _monitored - The manifest lists the Mission control feeds.
 * @returns The source view; undefined without a source.
 * @throws {Error} Until build wave 3: "renderView derive/sourceView is not built yet".
 */
export function sourceView(
  _source: ActiveSource | undefined,
  _label: SourceLabel,
  _second: PerfSecond | undefined,
  _monitored: boolean
): MissionView["source"] | undefined {
  return notBuilt("derive/sourceView", 3);
}

/**
 * The health line's latency: the newest of the 48 samples in whole ms, "—" when it is NaN.
 *
 * @param _health - activeSource.health().
 * @returns The text.
 * @throws {Error} Until build wave 3: "renderView derive/healthText is not built yet".
 */
export function healthText(_health: SourceHealth): string {
  return notBuilt("derive/healthText", 3);
}

/**
 * @file renderView components (connection) — the paused chip of a device source (spec 09 § M7): what
 * happened to the local preview ("Local preview paused while Galaxy A26 is connected", held by you,
 * could not pause with the reason in warn, pausing or resuming with a spinner). Narrow bars hide the
 * part after the bold words (its title keeps it).
 */
import type { JSX } from "preact";
import { activeSourcePlugin } from "../../../activeSource";
import { pausedChip } from "../../derive/connection";
import type { RenderViewCtx } from "../../types";
import { MissionIcon } from "../icons";
import { Spinner } from "../parts";

/**
 * Props of `PausedChip`.
 */
export type PausedChipProps = { readonly ctx: RenderViewCtx };

/**
 * The paused chip; nothing for a local source.
 *
 * @param props - ctx.
 * @returns The chip, or nothing.
 */
export function PausedChip(props: PausedChipProps): JSX.Element | null {
  const { ctx } = props;
  const activeSource = ctx.require(activeSourcePlugin);
  const source = ctx.state.mission.source ?? activeSource.current();
  const chip = pausedChip(source, activeSource.preview(), activeSource.label().name);
  // eslint-disable-next-line unicorn/no-null -- Preact renders null for "nothing"
  if (chip === undefined) return null;
  const full = chip.rest === "" ? chip.bold : `${chip.bold} ${chip.rest}`;
  return (
    <p
      data-paused-chip
      data-tone={chip.tone}
      title={full}
      aria-busy={chip.busy ? "true" : undefined}
    >
      {chip.busy ? <Spinner /> : <MissionIcon name="pause" size={14} />}
      <b>{chip.bold}</b>
      {chip.rest === "" ? undefined : <span data-part="rest">{chip.rest}</span>}
    </p>
  );
}

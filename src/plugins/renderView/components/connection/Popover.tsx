/**
 * @file renderView components (connection) — The popover every Mission control popover renders
 * in (spec 09 § M7): one open at a time, Esc and an outside click close it and focus returns to
 * its trigger. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract
 * the other Mission control units build against; build wave 4 (RV5) writes the bodies.
 */
import type { ComponentChildren, JSX } from "preact";
import { notBuilt } from "../../stub";
import type { MissionState, RenderViewCtx } from "../../types";

/**
 * Props of `Popover`.
 */
export type PopoverProps = {
  readonly ctx: RenderViewCtx;
  readonly id: NonNullable<MissionState["popover"]>;
  readonly label: string;
  readonly children: ComponentChildren;
};

/**
 * The popover every Mission control popover renders in (spec 09 § M7): one open at a time, Esc
 * and an outside click close it and focus returns to its trigger.
 *
 * @param _props - ctx, which popover it is, its label and its content.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/Popover is not built yet".
 */
export function Popover(_props: PopoverProps): JSX.Element {
  return notBuilt("components/Popover", 4);
}

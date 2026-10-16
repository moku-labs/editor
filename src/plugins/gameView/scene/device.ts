/**
 * @file gameView plugin — the device rule of the Game workspace (spec 11 § 5.5 G1, spec 09 R4):
 * on a session whose `SessionInfo.device` is present the source is a phone, so gameView reads no
 * scene from it (no watch, no calibration, no one-off read) and the element tools say to switch
 * to the local preview. Serializing a phone's scene tree once a second costs it frames, the
 * stutter the Render strip measures. The game commands keep running on the phone.
 */
import { linkPlugin } from "../../link";
import type { GameViewCtx } from "../types";

/**
 * What the Element tab and the picker say while a phone is the source.
 */
export const DEVICE_SOURCE_TEXT =
  "Element tools read the local preview. Switch the source to Local preview.";

/**
 * Tells whether the chosen session is a phone: link's chosen session has a `device`.
 *
 * @param ctx - Domain context of gameView (only `require` is read).
 * @returns True on a device session; false on a browser session or without a chosen session.
 */
export function onDevice(ctx: Pick<GameViewCtx, "require">): boolean {
  const link = ctx.require(linkPlugin);
  const chosen = link.session();
  if (chosen === undefined) return false;
  return link.sessions().some(session => session.id === chosen && session.device !== undefined);
}

/**
 * The refusal of a scene read while a phone is the source.
 *
 * @returns The two-line error.
 * @example
 * ```ts
 * deviceSourceError().message; // "[moku-editor] Element tools read the local preview.\n  Switch the source to Local preview."
 * ```
 */
export function deviceSourceError(): Error {
  return new Error(
    "[moku-editor] Element tools read the local preview.\n  Switch the source to Local preview."
  );
}

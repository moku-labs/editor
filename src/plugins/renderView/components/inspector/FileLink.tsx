/**
 * @file renderView components (inspector) — A file link of the range view: opens the file in
 * the Files workspace. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the
 * contract the other Mission control units build against; build wave 4 (RV6) writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `FileLink`.
 */
export type FileLinkProps = { readonly ctx: RenderViewCtx };

/**
 * A file link of the range view: opens the file in the Files workspace.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/FileLink is not built yet".
 */
export function FileLink(_props: FileLinkProps): JSX.Element {
  return notBuilt("components/FileLink", 4);
}

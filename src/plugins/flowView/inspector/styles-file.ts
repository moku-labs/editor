/**
 * @file flowView inspector module — the styles file of the Styles tab: `stylesFile` from the
 * config, else the shared search (panels/shared/styles-file) once per session.
 */
import { findStylesFile } from "../../panels/shared/styles-file";
import type { FlowCtx, FlowEnvironment } from "../types";

/**
 * The styles file of the Styles tab: `stylesFile` from the config, else the search result of this
 * session (one search per session, shared by every caller).
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and actions.
 * @returns The path, or undefined when no file calls the definer.
 */
export async function stylesFileOf(
  ctx: FlowCtx,
  env: FlowEnvironment
): Promise<string | undefined> {
  if (ctx.config.stylesFile !== undefined) return ctx.config.stylesFile;
  const { inspector, data } = ctx.state;
  if (inspector.found?.session !== data.session || inspector.found === undefined) {
    inspector.found = { session: data.session, path: findStylesFile(env.files()) };
  }
  return inspector.found.path;
}

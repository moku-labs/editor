/**
 * @file filesView plugin — reading a tab: text through `link.files.read`, images through
 * `readBinary` (R1, R7); the error texts by wire reason; revalidation of an open tab.
 */
import { linkPlugin } from "../../link";
import { codeOf, messageOf, reasonOf } from "../errors";
import { notify } from "../store";
import type { FilesViewCtx, OpenTab } from "../types";
import { isModified } from "./model";

/**
 * Body text of a path outside the files sandbox.
 */
export const SANDBOX_MESSAGE = "This file is outside the editor's sandbox.";

/**
 * Body text of a file over the server's 2 MiB read limit (the body adds "Open in editor").
 */
export const TOO_LARGE_MESSAGE = "File too large to open here (over 2 MB)";

/**
 * Body text of a file deleted on disk (the body adds "Close tab").
 */
export const MISSING_MESSAGE = "The file is gone from disk.";

/**
 * The tab status and text of a failed read.
 */
type ReadFailure = {
  readonly status: "error" | "missing";
  readonly message: string;
  readonly code: number | undefined;
};

/**
 * What a failed read shows: sandbox, too large, missing, or the wire message without the prefix.
 *
 * @param error - What link rejected with.
 * @returns Status, text and code.
 * @example
 * ```ts
 * readFailure(wireError(-32_601, "not found: a.ts", { reason: "unknown_id" })); // { status: "missing", … }
 * ```
 */
export function readFailure(error: unknown): ReadFailure {
  const code = codeOf(error);
  const reason = reasonOf(error);
  const text = messageOf(error);

  if (reason === "forbidden_path") return { status: "error", message: SANDBOX_MESSAGE, code };
  if (code === -32_000 && text.includes("too large")) {
    return { status: "error", message: TOO_LARGE_MESSAGE, code };
  }
  if (reason === "unknown_id" || code === -32_601) {
    return { status: "missing", message: MISSING_MESSAGE, code };
  }
  return { status: "error", message: text, code };
}

/**
 * Shows a failed read on the tab and warns it.
 *
 * @param ctx - Domain context of filesView.
 * @param tab - The tab.
 * @param error - What link rejected with.
 * @returns The failure shown.
 */
export function showReadFailure(ctx: FilesViewCtx, tab: OpenTab, error: unknown): ReadFailure {
  const failure = readFailure(error);
  tab.status = failure.status;
  tab.message = failure.message;
  ctx.log.warn("filesView:read-failed", { path: tab.path, code: failure.code });
  return failure;
}

/**
 * Stores a text read on a tab: saved = buffer = text, the version, the check time, ready.
 *
 * @param tab - The tab.
 * @param text - The file text.
 * @param version - Its version.
 */
export function storeText(tab: OpenTab, text: string, version: string): void {
  tab.saved = text;
  tab.buffer = text;
  tab.version = version;
  tab.checkedAt = Date.now();
  tab.status = "ready";
  tab.message = undefined;
}

/**
 * Loads a tab: images through readBinary into a data URL, text through read. Errors show on
 * the tab (see readFailure). Notifies before and after.
 *
 * @param ctx - Domain context of filesView.
 * @param tab - The tab.
 * @returns When the tab is ready or shows its error.
 */
export async function loadTab(ctx: FilesViewCtx, tab: OpenTab): Promise<void> {
  const { files } = ctx.require(linkPlugin);
  tab.status = "loading";
  tab.message = undefined;
  notify(ctx.state);

  try {
    if (tab.kind === "image") {
      const { dataUrl, version } = await files.readBinary(tab.path);
      tab.image = dataUrl;
      tab.version = version;
      tab.checkedAt = Date.now();
      tab.status = "ready";
    } else {
      const { text, version } = await files.read(tab.path);
      storeText(tab, text, version);
    }
  } catch (error) {
    showReadFailure(ctx, tab, error);
  }
  notify(ctx.state);
}

/**
 * Re-reads a ready text tab whose last check is older than `revalidateMs`: the same version
 * only refreshes the check time; a changed file replaces a clean tab silently and marks a
 * modified tab as conflict; a deleted file marks it missing. Never rejects.
 *
 * @param ctx - Domain context of filesView.
 * @param tab - The tab.
 * @returns When the check is done.
 */
export async function revalidate(ctx: FilesViewCtx, tab: OpenTab): Promise<void> {
  if (tab.kind === "image" || tab.status !== "ready") return;
  if (Date.now() - tab.checkedAt < ctx.config.revalidateMs) return;

  try {
    const { text, version } = await ctx.require(linkPlugin).files.read(tab.path);
    if (version === tab.version) tab.checkedAt = Date.now();
    else if (isModified(tab)) tab.status = "conflict";
    else storeText(tab, text, version);
  } catch (error) {
    const failure = readFailure(error);
    if (failure.status === "missing") {
      tab.status = "missing";
      tab.message = failure.message;
    } else {
      ctx.log.warn("filesView:revalidate-failed", { path: tab.path, code: failure.code });
    }
  }
  notify(ctx.state);
}

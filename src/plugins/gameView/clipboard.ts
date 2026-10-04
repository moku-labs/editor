/**
 * @file gameView plugin — the clipboard of the tools page: the reference block of a pick or of
 * "Copy reference" (a refusal is toasted), and the `shot:` / `series:` lines of Shot and Series
 * (a refusal is only logged: the files are saved all the same).
 */
import { workspacePlugin } from "../workspace";
import { messageOf, reportFailure } from "./report";
import type { GameViewCtx } from "./types";

/**
 * Writes a text to the clipboard.
 *
 * @param text - The text.
 * @returns Resolves when written.
 * @throws {Error} "The clipboard is not available." without a clipboard; the browser's refusal.
 * @example
 * ```ts
 * await writeClipboard("shot: .moku/captures/2026-09-24-1012-board.png");
 * ```
 */
export async function writeClipboard(text: string): Promise<void> {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard === undefined) throw new Error("The clipboard is not available.");
  await clipboard.writeText(text);
}

/**
 * Writes a text to the clipboard and toasts the success; a refusal toasts "Copy failed · …".
 *
 * @param ctx - Domain context of gameView.
 * @param text - The text.
 * @param toast - The toast of a success.
 * @returns True when written.
 */
export async function copyText(ctx: GameViewCtx, text: string, toast: string): Promise<boolean> {
  try {
    await writeClipboard(text);
    ctx.require(workspacePlugin).toast(toast);
    return true;
  } catch (error) {
    reportFailure(ctx, "Copy failed", "gameView: copy reference failed", error);
    return false;
  }
}

/**
 * Writes a line next to a saved capture; a refusal is logged at debug, nothing is toasted.
 *
 * @param ctx - Domain context of gameView.
 * @param text - The line (`shot: <path>`, `series: <folder> (<n> frames)`).
 * @returns Resolves when written or refused (never rejects).
 */
export async function copyQuietly(ctx: GameViewCtx, text: string): Promise<void> {
  try {
    await writeClipboard(text);
  } catch (error) {
    ctx.log.debug("gameView: clipboard refused", { message: messageOf(error) });
  }
}

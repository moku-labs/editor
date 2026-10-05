/**
 * @file pages/mcp — the content of tool results (M5): a text item first (pretty JSON or a
 * message), then images as base64 PNG; `isError` results for tool failures, with the hub's
 * session list for `choose_session`.
 */
import { bareMessage, isWireError } from "../../registry/protocol";
import { splitDataUrl } from "./shapes";
import type { Content, JsonShaped, SessionView, ToolResult } from "./types";

/**
 * The largest image a result carries, in base64 characters (M5: about 300 KB).
 */
export const MAX_IMAGE_CHARS = 300 * 1024;

/**
 * A text item.
 *
 * @param text - The text.
 * @returns The item.
 * @example
 * ```ts
 * textItem("effect: cheat"); // { type: "text", text: "effect: cheat" }
 * ```
 */
export function textItem(text: string): Content {
  return { type: "text", text };
}

/**
 * Pretty JSON text, two spaces.
 *
 * @param value - Any JSON-shaped value.
 * @returns The text.
 * @example
 * ```ts
 * jsonText({ a: 1 }); // '{\n  "a": 1\n}'
 * ```
 */
export function jsonText(value: JsonShaped): string {
  return JSON.stringify(value, undefined, 2);
}

/**
 * A result whose one item is pretty JSON.
 *
 * @param value - The value.
 * @returns The result.
 * @example
 * ```ts
 * jsonResult({ scheduled: true });
 * ```
 */
export function jsonResult(value: JsonShaped): ToolResult {
  return { content: [textItem(jsonText(value))] };
}

/**
 * A tool failure: one text item, `isError: true`. The `[moku-editor] ` prefix is dropped.
 *
 * @param text - What went wrong.
 * @returns The result.
 * @example
 * ```ts
 * errorResult("game paused or hidden at frame 1840 — bring the editor pane to front or resume");
 * ```
 */
export function errorResult(text: string): ToolResult {
  return { content: [textItem(bareMessage(text))], isError: true };
}

/**
 * The image item of a data URL.
 *
 * @param dataUrl - A base64 data URL, such as a PNG from game.capture.
 * @returns The image item, or undefined when it is not a base64 data URL.
 * @example
 * ```ts
 * imageItem("data:image/png;base64,iVBO"); // { type: "image", data: "iVBO", mimeType: "image/png" }
 * ```
 */
export function imageItem(dataUrl: string): Content | undefined {
  const split = splitDataUrl(dataUrl);
  return split === undefined ? undefined : { type: "image", ...split };
}

/**
 * The size of an image item's data in KB, one decimal.
 *
 * @param dataUrl - The data URL.
 * @returns Its base64 length in KB.
 * @example
 * ```ts
 * imageKb("data:image/png;base64," + "A".repeat(2048)); // 2
 * ```
 */
export function imageKb(dataUrl: string): number {
  const data = splitDataUrl(dataUrl)?.data ?? dataUrl;
  return Math.round((data.length / 1024) * 10) / 10;
}

/**
 * True when a picture is larger than a result carries comfortably.
 *
 * @param dataUrl - The data URL.
 * @returns Whether its base64 data exceeds MAX_IMAGE_CHARS.
 * @example
 * ```ts
 * isTooLarge(shot.image); // true for a full 1080 × 1920 PNG of a busy frame
 * ```
 */
export function isTooLarge(dataUrl: string): boolean {
  return (splitDataUrl(dataUrl)?.data ?? dataUrl).length > MAX_IMAGE_CHARS;
}

/**
 * One line of a session for a message.
 *
 * @param session - The session.
 * @returns `s-7f3a merge-game 0.0.0 (embedded) http://127.0.0.1:3000/`.
 * @example
 * ```ts
 * sessionLine(session); // "s-7f3a merge-game 0.0.0 (embedded) http://127.0.0.1:3000/"
 * ```
 */
function sessionLine(session: SessionView): string {
  const where = session.embedded ? " (embedded)" : "";
  return `${session.id} ${session.game}${where} ${session.page}`;
}

/**
 * The failure result of a thrown value. `choose_session` lists the sessions to pick from.
 *
 * @param error - The thrown value (a wire error from the hub, or an Error).
 * @param sessions - The sessions now, for `choose_session`.
 * @returns The `isError` result.
 * @example
 * ```ts
 * failureResult(error, hub.sessions());
 * // "several games are connected; choose a session\nPass session as one of:\n- s-7f3a merge-game 0.0.0 http://127.0.0.1:3000/ …"
 * ```
 */
export function failureResult(error: unknown, sessions: readonly SessionView[]): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  if (!isWireError(error) || error.data?.reason !== "choose_session") return errorResult(message);

  const lines = sessions.map(session => `- ${sessionLine(session)}`);
  return errorResult([message, "Pass session as one of:", ...lines].join("\n"));
}

/**
 * A text item of JSON followed by an image item, or the text alone when the picture is not a
 * data URL.
 *
 * @param facts - The facts shown first.
 * @param dataUrl - The picture.
 * @returns The result.
 * @example
 * ```ts
 * pictureResult({ frame: 1840 }, shot.image);
 * ```
 */
export function pictureResult(facts: JsonShaped, dataUrl: string): ToolResult {
  const image = imageItem(dataUrl);
  const text = textItem(jsonText(facts));
  return { content: image === undefined ? [text] : [text, image] };
}

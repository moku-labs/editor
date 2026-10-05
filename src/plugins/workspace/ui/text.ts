/**
 * @file workspace plugin — small text helpers shared by the shell components: lost reasons in
 * words, seconds since a time, clock times, badge labels for screen readers, input summaries, the
 * name and session the top bar keeps through a reload.
 */
import type { InputSchema, Json, LinkStatus } from "../../registry/protocol";
import { isReloading } from "../../registry/protocol";
import type { WorkspaceState } from "../types";

/**
 * The game name and session id of the last manifest.
 */
type Shown = Readonly<WorkspaceState["shown"]>;

/**
 * Words for the lost reasons link reports.
 */
const REASONS: Readonly<Record<string, string>> = {
  game_reloaded: "game page reloaded",
  socket_closed: "connection to the editor server closed",
  bye: "game page closed",
  no_boot: "the page has no boot data"
};

/**
 * Singular words of the badge label parts.
 */
const BADGE_WORDS: Readonly<Record<string, string>> = { warn: "warning", error: "error" };

/**
 * Milliseconds in one second.
 */
const MS_PER_SECOND = 1000;

/**
 * A lost reason in words.
 *
 * @param reason - The reason of a lost link status.
 * @returns Words for the UI.
 * @example
 * ```ts
 * lostReason("game_reloaded"); // "game page reloaded"
 * ```
 */
export function lostReason(reason: string): string {
  return REASONS[reason] ?? reason.replaceAll("_", " ");
}

/**
 * Upper-cases the first letter.
 *
 * @param text - Any text.
 * @returns The text with a capital first letter.
 * @example
 * ```ts
 * capitalize("game page reloaded"); // "Game page reloaded"
 * ```
 */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Whole seconds since an epoch time, never negative.
 *
 * @param since - Epoch ms.
 * @param now - Epoch ms now.
 * @returns Seconds.
 * @example
 * ```ts
 * secondsSince(1_000, 7_000); // 6
 * ```
 */
export function secondsSince(since: number, now: number): number {
  return Math.max(0, Math.round((now - since) / MS_PER_SECOND));
}

/**
 * Milliseconds as whole seconds, at least 1.
 *
 * @param ms - A delay.
 * @returns Seconds, rounded up.
 * @example
 * ```ts
 * secondsOf(1000); // 1
 * ```
 */
export function secondsOf(ms: number): number {
  return Math.max(1, Math.ceil(ms / MS_PER_SECOND));
}

/**
 * A local clock time "22:41:07".
 *
 * @param epoch - Epoch ms.
 * @returns HH:MM:SS.
 */
export function clockTime(epoch: number): string {
  const date = new Date(epoch);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map(part => String(part).padStart(2, "0"))
    .join(":");
}

/**
 * One badge label part for screen readers: "2 warn" → "2 warnings".
 *
 * @param part - A part of the label.
 * @returns The spoken part.
 * @example
 * ```ts
 * spokenPart("1 error"); // "1 error"
 * ```
 */
function spokenPart(part: string): string {
  const [count = "", word = ""] = part.split(" ");
  const singular = BADGE_WORDS[word];
  if (singular === undefined) return part;
  return `${count} ${singular}${count === "1" ? "" : "s"}`;
}

/**
 * A rail badge label for screen readers: "2 warn · 1 error" → "2 warnings, 1 error".
 *
 * @param label - The badge label.
 * @returns The spoken text.
 * @example
 * ```ts
 * badgeSpeech("2 warn · 1 error"); // "2 warnings, 1 error"
 * ```
 */
export function badgeSpeech(label: string): string {
  return label
    .split(" · ")
    .map(part => spokenPart(part))
    .join(", ");
}

/**
 * A command input as `frames: 1, id: "x"`.
 *
 * @param input - The input of a run.
 * @returns The summary, "no input" for none.
 * @example
 * ```ts
 * inputText({ frames: 1 }); // "frames: 1"
 * ```
 */
export function inputText(input: Json | undefined): string {
  if (input === undefined || input === null) return "no input";
  if (typeof input !== "object" || Array.isArray(input)) return JSON.stringify(input);
  const parts = Object.entries(input).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return parts.length === 0 ? "no input" : parts.join(", ");
}

/**
 * An input schema as "frames: number, id: string?".
 *
 * @param schema - A descriptor's input schema.
 * @returns The summary, "—" for none.
 * @example
 * ```ts
 * schemaText({ frames: "number" }); // "frames: number"
 * ```
 */
export function schemaText(schema: InputSchema): string {
  const parts = Object.entries(schema).map(([key, kind]) => `${key}: ${kind}`);
  return parts.length === 0 ? "—" : parts.join(", ");
}

/**
 * The game name and session id the top bar keeps showing while the game has no manifest: the last
 * ones, unless the link reports a real loss or no game. An expected reload (`isReloading`), and
 * the moments between a session's close and the link status that follows it, keep them (U9: the
 * bar does not move sideways).
 *
 * @param link - The link status.
 * @param shown - The game name and session id of the last manifest.
 * @returns What to show without a manifest; both undefined on a real loss.
 * @example
 * ```ts
 * const shown = { game: "merge-game 0.0.0", session: "s-7f3a" };
 * heldNames({ kind: "lost", reason: "bye", lastFrame: 310, retryInMs: 1000, reloading: true }, shown); // shown
 * heldNames({ kind: "lost", reason: "socket_closed", lastFrame: 310, retryInMs: 1000 }, shown); // both undefined
 * ```
 */
export function heldNames(link: LinkStatus, shown: Shown): Shown {
  const lost = link.kind === "empty" || (link.kind === "lost" && !isReloading(link));
  return lost ? { game: undefined, session: undefined } : shown;
}

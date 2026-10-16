/**
 * @file renderView derive — the recording's words (spec 09 § M5, M7 Record; spec 05 R2): who started
 * the log ("you", "you (on the phone)", "agent (Claude)", "agent", "the editor or an agent", "the
 * game", "on launch") from the recorder's `startedBy`, the pill and the popover lines, the log's
 * path, the marks, the answers of `editor.record` and the label of a new mark. Pure.
 */
import type { Json } from "../../registry/protocol";
import type { LogMark, RecorderSource, RecordOrigin } from "../source/contract";
import type { MissionView, RecordAnswer } from "../types";
import { mbText, messageOf, mmss, reasonOf } from "./words";

/** The collector's default directory of the logs (spec 04). */
export const LOG_DIR = ".moku/perf/";

/**
 * Who started the log, in words (spec 05 R2): an agent with a name reads "agent (Claude)", without
 * one "agent".
 *
 * @param origin - startedBy of the recorder's status.
 * @returns The words; "" for none.
 * @example
 * ```ts
 * whoText({ by: "agent", name: "Claude" }); // "agent (Claude)"
 * ```
 */
export function whoText(origin: RecordOrigin | null): string {
  if (origin === null) return "";
  switch (origin.by) {
    case "editor": {
      return "you";
    }
    case "phone": {
      return "you (on the phone)";
    }
    case "agent": {
      return origin.name === null ? "agent" : `agent (${origin.name})`;
    }
    case "remote": {
      return "the editor or an agent";
    }
    case "code": {
      return "the game";
    }
    default: {
      return "on launch";
    }
  }
}

/**
 * The popover's tag: "started by agent (Claude)", "started by you", "started on the phone",
 * "started on launch", "started by the game", "started by the editor or an agent".
 *
 * @param origin - startedBy of the recorder's status.
 * @returns The tag's words; "" for none.
 * @example
 * ```ts
 * startedText({ by: "phone", name: null }); // "started on the phone"
 * ```
 */
export function startedText(origin: RecordOrigin | null): string {
  if (origin === null) return "";
  if (origin.by === "phone") return "started on the phone";
  if (origin.by === "auto") return "started on launch";
  return `started by ${whoText(origin)}`;
}

/**
 * The pill's "by {who}".
 *
 * @param origin - startedBy of the recorder's status.
 * @returns "by agent (Claude)"; "" for none.
 * @example
 * ```ts
 * pillBy({ by: "editor", name: null }); // "by you"
 * ```
 */
export function pillBy(origin: RecordOrigin | null): string {
  const who = whoText(origin);
  return who === "" ? "" : `by ${who}`;
}

/**
 * The log's path as the popover shows it.
 *
 * @param file - The log's file name.
 * @returns `.moku/perf/<file>`; "" without a file.
 * @example
 * ```ts
 * logPath("perf-20261016-1412-sm-a266b.jsonl"); // ".moku/perf/perf-20261016-1412-sm-a266b.jsonl"
 * ```
 */
export function logPath(file: string | null): string {
  return file === null ? "" : `${LOG_DIR}${file}`;
}

/**
 * The recording part of MissionView.
 *
 * @param recorder - The newest editor.recorder value.
 * @returns The view; undefined without a recorder source.
 * @example
 * ```ts
 * recordingView(recorder)?.startedBy; // { by: "agent", name: "Claude" }
 * ```
 */
export function recordingView(recorder: RecorderSource | undefined): MissionView["recording"] {
  if (recorder === undefined) return undefined;
  return {
    state: recorder.state,
    startedBy: recorder.startedBy,
    sinceMs: recorder.sinceMs,
    bytes: recorder.bytes,
    file: recorder.file,
    marks: [...recorder.marks]
  };
}

/**
 * The pill of a recording: elapsed mm:ss from the recorder's own `sinceMs` (never the tools clock),
 * the size in MB and who started it.
 *
 * @param recorder - The newest editor.recorder value.
 * @returns The pill's words.
 * @example
 * ```ts
 * recordPill(recorder); // { elapsed: "00:42", size: "3.1 MB", by: "by agent (Claude)" }
 * ```
 */
export function recordPill(recorder: RecorderSource): {
  readonly elapsed: string;
  readonly size: string;
  readonly by: string;
} {
  return {
    elapsed: mmss(recorder.sinceMs),
    size: `${mbText(recorder.bytes)} MB`,
    by: pillBy(recorder.startedBy)
  };
}

/**
 * The marks list of the popover: label and mm:ss, newest last.
 *
 * @param marks - The log's marks.
 * @returns The rows.
 * @example
 * ```ts
 * marksRows(recorder.marks); // [{ label: "boss intro", at: "00:20" }, { label: "fog on", at: "00:31" }]
 * ```
 */
export function marksRows(
  marks: readonly LogMark[]
): { readonly label: string; readonly at: string }[] {
  return marks
    .toSorted((one, other) => one.atMs - other.atMs)
    .map(mark => ({ label: mark.label, at: mmss(mark.atMs) }));
}

/**
 * The label of a new mark: the typed text trimmed, or "mark {n + 1}" when empty.
 *
 * @param label - What the person typed.
 * @param marks - The log's marks so far.
 * @returns The label.
 * @example
 * ```ts
 * markLabelOf("  ", [{ atMs: 1000, label: "boss intro", auto: false }]); // "mark 2"
 * ```
 */
export function markLabelOf(label: string | undefined, marks: readonly LogMark[]): string {
  const typed = label?.trim() ?? "";
  return typed === "" ? `mark ${marks.length + 1}` : typed;
}

/**
 * The toast after Stop.
 *
 * @param file - The log's file name.
 * @param bytes - Its size.
 * @returns "Recording saved: .moku/perf/{file}, {mb} MB".
 * @example
 * ```ts
 * savedText("perf-1.jsonl", 3_100_000); // "Recording saved: .moku/perf/perf-1.jsonl, 3.1 MB"
 * ```
 */
export function savedText(file: string, bytes: number): string {
  return `Recording saved: ${logPath(file)}, ${mbText(bytes)} MB`;
}

/**
 * Reads the file of an `editor.record` answer (`{ on, file, startedBy, marked }`).
 *
 * @param value - The answer's value.
 * @returns The file; null without one; undefined for another shape.
 */
function fileOf(value: Json): string | null | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  if (typeof value.on !== "boolean") return undefined;
  const { file } = value;
  // eslint-disable-next-line unicorn/no-null -- null: no log yet
  return typeof file === "string" ? file : null;
}

/**
 * A Record or Stop answer in words.
 *
 * @param on - Record (true) or Stop.
 * @param value - editor.record's answer.
 * @returns The answer.
 * @example
 * ```ts
 * recordAnswerOf(true, { on: true, file: "perf-1.jsonl", startedBy: { by: "editor", name: null }, marked: false });
 * // { ok: true, text: "Recording", file: "perf-1.jsonl" }
 * ```
 */
export function recordAnswerOf(on: boolean, value: Json): RecordAnswer {
  const file = fileOf(value);
  if (file === undefined) {
    // eslint-disable-next-line unicorn/no-null -- null: no log
    return { ok: false, text: "Refused: the answer is not a recording", file: null };
  }
  return { ok: true, text: on ? "Recording" : "Stopped", file };
}

/**
 * A refused Record or Stop in words.
 *
 * @param error - What the run rejected with.
 * @returns The answer.
 * @example
 * ```ts
 * recordRefusalOf(new Error("[moku-editor] perf has no monitor.\n  …")).text; // "Refused: perf has no monitor."
 * ```
 */
export function recordRefusalOf(error: unknown): RecordAnswer {
  const reason = reasonOf(error);
  let text = `Refused: ${messageOf(error)}`;
  if (reason === "dev_only" || reason === "read_only") text = "Refused: needs a debug build";
  if (reason === "no_session") text = "Not sent: no source connected";
  // eslint-disable-next-line unicorn/no-null -- null: no log
  return { ok: false, text, file: null };
}

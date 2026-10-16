/**
 * @file overlay plugin — the Record tab's view model (C5): the recording row with who started the
 * log, the sent line and meter, the marks and the saved logs. Pure.
 */
import type {
  LogFileInfo,
  LogMark,
  RecorderStatus,
  RecordOrigin,
  RecordStarter
} from "../../recorder/types";
import type { LinkPayload } from "../types";
import { COLOUR, clockText, groupDigits, hourMinute, sizeText } from "./format";
import { isLive } from "./link";
import type { LegendView, LogRow, RecordTabView, SentView, ToastView } from "./types";

/** The REC legend of a running log. */
const REC: LegendView = {
  text: "REC",
  colour: COLOUR.warning,
  lit: true,
  hollow: false,
  title: undefined,
  small: undefined
};

/** The OFF legend of an idle recorder: nothing is recorded until someone starts a log. */
const OFF: LegendView = {
  text: "OFF",
  colour: COLOUR.ink2,
  lit: false,
  hollow: false,
  title: undefined,
  small: undefined
};

/** The two info lines of an idle recorder. */
const IDLE_LINES: RecordTabView["stats"] = [
  { value: "", text: "Nothing is saved until you record." },
  { value: "", text: "The editor or an agent can start it too." }
];

/** The origin line of each starter (an agent's adds its name). */
const ORIGIN_TEXT: Readonly<Record<RecordStarter, string>> = {
  phone: "started here",
  editor: "started from the editor",
  agent: "started by an agent",
  remote: "started from the computer",
  code: "started by the game",
  auto: "started on launch"
};

/** The longest agent name the origin line shows whole; a longer one is cut to fit the row. */
const NAME_MAX = 12;

/**
 * An agent's name cut to `NAME_MAX` characters, the last one an ellipsis.
 *
 * @param name - The MCP client's name.
 * @returns The name as the row shows it.
 * @example
 * ```ts
 * fitName("Claude Code"); // "Claude Code"
 * ```
 */
function fitName(name: string): string {
  const chars = [...name];
  return chars.length <= NAME_MAX ? name : `${chars.slice(0, NAME_MAX - 1).join("")}…`;
}

/**
 * The origin line of a log: who started it, with an agent's name when the hub named it.
 *
 * @param startedBy - `recorder.status().startedBy`; null while idle.
 * @returns The line, or undefined without an origin.
 * @example
 * ```ts
 * originText({ by: "agent", name: "Claude" }); // "started by an agent (Claude)"
 * originText({ by: "phone", name: null }); // "started here"
 * ```
 */
export function originText(startedBy: RecordOrigin | null): string | undefined {
  if (startedBy === null) return undefined;
  const text = ORIGIN_TEXT[startedBy.by];
  const { name } = startedBy;
  if (startedBy.by !== "agent" || name === null || name === "") return text;
  return `${text} (${fitName(name)})`;
}

/**
 * The "Sent to the computer" line: shown in device mode only (a bridge with a device link);
 * linked to a computer (adb / lan) with the meter, else offline.
 *
 * @param status - The recorder's status.
 * @param payload - The last `bridge:status`.
 * @param hasBridge - Whether the bridge is composed.
 * @returns The sent view, or undefined.
 */
function sentOf(
  status: RecorderStatus,
  payload: LinkPayload | undefined,
  hasBridge: boolean
): SentView | undefined {
  const mode = payload?.link?.mode;
  if (!hasBridge || mode === undefined) return undefined;

  const linked = isLive(mode);
  const total = status.sent + status.pending;
  return {
    linked,
    sent: groupDigits(status.sent),
    pending: groupDigits(status.pending),
    share: linked && total > 0 ? status.sent / total : 0
  };
}

/**
 * One saved log: name, size, start time and how much reached the computer.
 *
 * @param file - The log.
 * @returns The row.
 */
function logRow(file: LogFileInfo): LogRow {
  return {
    name: file.name,
    size: sizeText(file.bytes),
    time: hourMinute(file.startedAt),
    ...logStatus(file),
    canDelete: !file.current
  };
}

/**
 * How much of a log reached the computer: the current log first, then fully sent, else a count.
 *
 * @param file - The log.
 * @returns The status and its text.
 */
function logStatus(file: LogFileInfo): Pick<LogRow, "status" | "statusText"> {
  if (file.current) return { status: "current", statusText: "current" };
  if (file.sent >= file.lines) return { status: "sent", statusText: "sent" };
  return {
    status: "partial",
    statusText: `${groupDigits(file.sent)} of ${groupDigits(file.lines)} sent`
  };
}

/**
 * The Start / Stop key: Stop while recording, else Start (off without a monitor); off while a log
 * is exported.
 *
 * @param status - `recorder.status()`.
 * @param recording - Whether the recording row shows.
 * @param exporting - Whether a log is being exported.
 * @returns The key.
 */
function recordKeyOf(
  status: RecorderStatus,
  recording: boolean,
  exporting: boolean
): RecordTabView["key"] {
  if (recording) return { action: "stop", label: "Stop", disabled: exporting, title: undefined };
  return {
    action: "start",
    label: "Start",
    disabled: exporting || !status.monitor,
    title: status.monitor ? undefined : "No frame monitor in this build"
  };
}

/**
 * The Record tab.
 *
 * @param input - The recorder's status, marks and logs, the link and the field.
 * @param input.status - `recorder.status()`.
 * @param input.marks - `recorder.marks()`.
 * @param input.files - `recorder.files()`.
 * @param input.payload - The last `bridge:status`.
 * @param input.hasBridge - Whether the bridge is composed.
 * @param input.draft - The mark label field.
 * @param input.toast - The toast line, if any.
 * @returns The Record tab view.
 */
export function recordTabView(input: {
  readonly status: RecorderStatus;
  readonly marks: readonly LogMark[];
  readonly files: readonly LogFileInfo[];
  readonly payload: LinkPayload | undefined;
  readonly hasBridge: boolean;
  readonly draft: string;
  readonly toast: ToastView | undefined;
}): RecordTabView {
  const { status } = input;
  const exporting = status.state === "exporting";
  const [size = "", unit = ""] = sizeText(status.bytes).split(" ");
  const recording = status.state === "recording" || (exporting && status.sinceMs > 0);
  return {
    recording,
    legend: recording ? REC : OFF,
    clock: recording ? clockText(status.sinceMs) : "00:00",
    dim: !recording,
    stats: recording
      ? [
          { value: groupDigits(status.lines), text: " lines" },
          { value: size, text: ` ${unit}` }
        ]
      : IDLE_LINES,
    origin: recording ? originText(status.startedBy) : undefined,
    key: recordKeyOf(status, recording, exporting),
    sent: sentOf(status, input.payload, input.hasBridge),
    draft: input.draft,
    marks: input.marks.map(mark => ({
      time: clockText(mark.atMs),
      label: mark.label,
      auto: mark.auto
    })),
    files: input.files.map(file => logRow(file)),
    toast: input.toast
  };
}

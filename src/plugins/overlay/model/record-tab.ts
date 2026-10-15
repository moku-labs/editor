/**
 * @file overlay plugin — the Record tab's view model (C5): the recording row, the sent line and
 * meter, the marks and the saved logs. Pure.
 */
import type { LogFileInfo, LogMark, RecorderStatus } from "../../recorder/types";
import type { LinkPayload } from "../types";
import { COLOUR, clockText, groupDigits, hourMinute, sizeText } from "./format";
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

/** The STOPPED legend of an idle recorder. */
const STOPPED: LegendView = {
  text: "STOPPED",
  colour: COLOUR.ink2,
  lit: false,
  hollow: false,
  title: undefined,
  small: undefined
};

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

  const linked = mode === "adb" || mode === "lan";
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
  let status: LogRow["status"] = "partial";
  let statusText = `${groupDigits(file.sent)} of ${groupDigits(file.lines)} sent`;
  if (file.sent >= file.lines) {
    status = "sent";
    statusText = "sent";
  }
  if (file.current) {
    status = "current";
    statusText = "current";
  }
  return {
    name: file.name,
    size: sizeText(file.bytes),
    time: hourMinute(file.startedAt),
    status,
    statusText,
    canDelete: !file.current
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
    legend: recording ? REC : STOPPED,
    clock: recording ? clockText(status.sinceMs) : "00:00",
    dim: !recording,
    stats: recording
      ? [
          { value: groupDigits(status.lines), text: " lines" },
          { value: size, text: ` ${unit}` }
        ]
      : [
          { value: "", text: "not recording" },
          { value: "", text: "logs kept on the phone" }
        ],
    key: recording
      ? { action: "stop", label: "Stop", disabled: exporting, title: undefined }
      : {
          action: "start",
          label: "Start",
          disabled: exporting || !status.monitor,
          title: status.monitor ? undefined : "No frame monitor in this build"
        },
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

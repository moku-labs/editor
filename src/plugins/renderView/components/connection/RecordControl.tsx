/**
 * @file renderView components (connection) — Record (spec 09 § M7 Record, spec 05 R2–R4): not
 * recording, a button with a red ring that runs `editor.record { on: true }` (disabled when nothing
 * runs or the source has no `editor.record`); recording, a red-tinted pill with the pulsing dot,
 * mm:ss from the recorder's own `sinceMs`, the size, who started it, its popover, Mark and Stop;
 * exporting, "Saving…" with the size.
 */
import type { JSX } from "preact";
import { linkPlugin } from "../../../link";
import { togglePopover } from "../../actions/popover";
import { recordPill } from "../../derive/record";
import { commandAllowed } from "../../source/listed";
import { notifyMission } from "../../state";
import type { RenderViewCtx } from "../../types";
import { MissionIcon } from "../icons";
import { start } from "../start";
import { useMissionApi } from "../useMission";
import { RecordPopover } from "./RecordPopover";

/**
 * Props of `RecordControl`.
 */
export type RecordControlProps = { readonly ctx: RenderViewCtx };

/** The Record button's title (spec 09 § M7). */
const RECORD_TITLE =
  "Nothing is written to disk until you record. An agent can start it too with editor.record.";

/**
 * Record, or the recording pill.
 *
 * @param props - ctx.
 * @returns The control.
 */
export function RecordControl(props: RecordControlProps): JSX.Element {
  const { ctx } = props;
  const { mission } = ctx.state;
  const api = useMissionApi(ctx);
  const recorder = mission.recorder;
  const source = mission.source;
  const running = source !== undefined && !(source.kind === "local" && source.session === null);
  if (recorder === undefined || recorder.state === "idle") {
    const allowed = running && commandAllowed(ctx.require(linkPlugin).manifest(), "editor.record");
    return (
      <button
        type="button"
        data-variant="outline"
        data-action="record"
        title={RECORD_TITLE}
        disabled={!allowed}
        onClick={() => start(ctx, api.record(true))}
      >
        <span data-rec-ring aria-hidden="true" />
        Record
      </button>
    );
  }
  const pill = recordPill(recorder);
  const exporting = recorder.state === "exporting";
  const open = mission.popover === "record";
  return (
    <span data-anchor>
      <span data-record-pill role="status">
        <button
          type="button"
          data-part="summary"
          data-popover-trigger="record"
          aria-haspopup="dialog"
          aria-expanded={open}
          title="Recording details"
          onClick={() => {
            togglePopover(mission, "record");
            notifyMission(mission);
          }}
        >
          <span data-dot="rec" aria-hidden="true" />
          <span>{exporting ? "Saving…" : "Recording"}</span>
          {exporting ? undefined : <b>{pill.elapsed}</b>}
          <b>{pill.size}</b>
          {pill.by === "" ? undefined : <span data-part="by">{pill.by}</span>}
          <MissionIcon name="chevron" size={12} />
        </button>
        {exporting ? undefined : (
          <>
            <button
              type="button"
              data-variant="outline"
              data-size="sm"
              data-action="mark"
              onClick={() => start(ctx, api.mark())}
            >
              Mark
            </button>
            <button
              type="button"
              data-variant="outline"
              data-size="sm"
              data-action="stop"
              onClick={() => start(ctx, api.record(false))}
            >
              Stop
            </button>
          </>
        )}
      </span>
      {open ? <RecordPopover ctx={ctx} /> : undefined}
    </span>
  );
}

/**
 * @file renderView components (connection) — the recording popover (spec 09 § M7 Record): "Recording
 * on {name}" with who started it (an agent's tag in the accent), elapsed and size, the log's path on
 * one line, what a log line holds, the marks (label and mm:ss) with "Name a mark" + "Add mark", and
 * "Stop recording" with the note that an agent can do it too.
 */
import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { activeSourcePlugin } from "../../../activeSource";
import { logPath, marksRows, recordPill, startedText } from "../../derive/record";
import type { RenderViewCtx } from "../../types";
import { start } from "../start";
import { useMissionApi } from "../useMission";
import { Popover, PopoverHead } from "./Popover";

/**
 * Props of `RecordPopover`.
 */
export type RecordPopoverProps = { readonly ctx: RenderViewCtx };

/**
 * The recording popover; nothing while nothing records.
 *
 * @param props - ctx.
 * @returns The popover.
 */
export function RecordPopover(props: RecordPopoverProps): JSX.Element | null {
  const { ctx } = props;
  const api = useMissionApi(ctx);
  const [label, setLabel] = useState("");
  const recorder = ctx.state.mission.recorder;
  // eslint-disable-next-line unicorn/no-null -- Preact renders null for "nothing"
  if (recorder === undefined) return null;
  const name = ctx.require(activeSourcePlugin).label().name;
  const pill = recordPill(recorder);
  const path = logPath(recorder.file);
  const marks = marksRows(recorder.marks);
  const byAgent = recorder.startedBy?.by === "agent";
  const onSubmit = (event: Event): void => {
    event.preventDefault();
    start(ctx, api.mark(label));
    setLabel("");
  };
  return (
    <Popover ctx={ctx} id="record" label="Recording">
      <div data-record-popover data-by={byAgent ? "agent" : undefined}>
        <PopoverHead ctx={ctx} id="record" title={`Recording on ${name}`}>
          {recorder.startedBy === null ? undefined : (
            <span data-tag={byAgent ? "acc" : ""}>{startedText(recorder.startedBy)}</span>
          )}
        </PopoverHead>
        <div data-part="body">
          <dl data-part="numbers">
            <div>
              <dt>elapsed</dt>
              <dd>{pill.elapsed}</dd>
            </div>
            <div>
              <dt>written</dt>
              <dd>{pill.size}</dd>
            </div>
          </dl>
          <h4>Log file</h4>
          <p data-part="path" title={path}>
            {path === "" ? "—" : path}
          </p>
          <p data-part="note">
            One line per frame summary, pass summary, shader compile, adaptive rate change and mark.
          </p>
          <h4>
            Marks <span data-count>{marks.length}</span>
          </h4>
          {marks.length === 0 ? (
            <p data-part="note">No marks yet</p>
          ) : (
            <ol data-part="marks">
              {marks.map(mark => (
                <li key={`${mark.at}:${mark.label}`}>
                  <span>{mark.label}</span>
                  <span data-mono>{mark.at}</span>
                </li>
              ))}
            </ol>
          )}
          <form data-part="mark-form" onSubmit={onSubmit}>
            <input
              type="text"
              value={label}
              placeholder="Name a mark"
              aria-label="Mark name"
              onInput={event => setLabel(event.currentTarget.value)}
            />
            <button type="submit" data-variant="outline" data-size="sm">
              Add mark
            </button>
          </form>
          <div data-part="foot">
            <button
              type="button"
              data-variant="outline"
              data-size="sm"
              data-action="stop-recording"
              onClick={() => start(ctx, api.record(false))}
            >
              Stop recording
            </button>
            <span data-part="note">An agent can start, stop and mark too: editor.record</span>
          </div>
        </div>
      </div>
    </Popover>
  );
}

/**
 * @file gameView plugin — the recording view (F10) that replaces the series popover body: a
 * progress ring on the tools-side elapsed time, Remaining, Shots "≈k of n", Every, Length,
 * "Writing to <folder>", Stop; then "Writing k of N shots…".
 */
import type { VNode } from "preact";
import { stopRecording } from "../capture/series";
import type { GameViewCtx, Recording } from "../types";
import { elapsedText, secondsText } from "./text";
import { useTicker } from "./useGameView";

/**
 * Props of `RecordingView`.
 */
export type RecordingViewProps = { readonly ctx: GameViewCtx; readonly recording: Recording };

/**
 * The recording view.
 *
 * @param props - The context and the running recording.
 * @returns The view.
 */
export function RecordingView(props: RecordingViewProps): VNode {
  const { ctx, recording } = props;
  const recordingNow = recording.phase === "recording";
  useTicker(recordingNow, 100);
  const elapsed = Math.min(recording.durationMs, performance.now() - recording.startedAt);
  const percent =
    recording.durationMs > 0 ? Math.round((elapsed / recording.durationMs) * 100) : 100;
  const expected = Math.min(
    recording.planned,
    Math.floor(elapsed / Math.max(1, recording.intervalMs))
  );

  return (
    <div data-part="recording" data-phase={recording.phase}>
      <div
        role="progressbar"
        aria-label="Recording"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        data-part="ring"
        style={{ "--progress": `${percent}%` }}
      >
        <span>{elapsedText(elapsed)} s</span>
      </div>
      <dl data-props="">
        <dt>Remaining</dt>
        <dd>{elapsedText(recording.durationMs - elapsed)} s</dd>
        <dt>Shots</dt>
        <dd data-part="shots">
          ≈{expected} of {recording.planned}
        </dd>
        <dt>Every</dt>
        <dd>{recording.intervalMs} ms</dd>
        <dt>Length</dt>
        <dd>{secondsText(recording.durationMs)} s</dd>
      </dl>
      {recordingNow ? (
        <>
          <p>Writing to {recording.folder}</p>
          <button type="button" data-variant="danger" onClick={() => stopRecording(ctx)}>
            Stop
          </button>
        </>
      ) : (
        <p role="status">
          Writing {recording.written} of {recording.planned} shots…
        </p>
      )}
    </div>
  );
}

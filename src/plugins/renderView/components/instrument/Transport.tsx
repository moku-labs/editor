/**
 * @file renderView components (instrument) — the transport row under the overview (spec 09 § M8): the
 * Live / Paused toggle, "Paused · {s} s behind live" (counting up), the Frame, Spike and GC steppers
 * (GC disabled without GC data), the key hint and "Back to live" while paused; everything is disabled
 * without frames.
 */
import type { JSX } from "preact";
import type { MissionState, RenderViewApi, RenderViewCtx } from "../../types";
import { viewWindow } from "../../view/view";
import type { MissionIconName } from "../icons";
import { MissionIcon } from "../icons";
import { useTicker } from "../useMission";

/**
 * Props of `Transport`.
 */
export type TransportProps = { readonly ctx: RenderViewCtx; readonly api: RenderViewApi };

/**
 * "Paused · {s} s behind live": one decimal under 10 s, then whole seconds.
 *
 * @param ms - How far the view is behind live.
 * @returns The badge's words.
 * @example
 * ```ts
 * behindText(4200); // "Paused · 4.2 s behind live"
 * ```
 */
export function behindText(ms: number): string {
  const seconds = ms / 1000;
  return `Paused · ${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s behind live`;
}

/**
 * Whether the history holds a GC to jump to (the engine's GC events or a phone's CDP GCs).
 *
 * @param mission - Mission control's state.
 * @returns Whether there is GC data.
 */
function hasGcData(mission: MissionState): boolean {
  if (mission.series.gcs.count > 0) return true;
  const { history } = mission;
  for (let index = 0; index < history.eventCount; index += 1) {
    if (history.events[index]?.kind === "gc") return true;
  }
  return false;
}

/**
 * Props of `Stepper`.
 */
type StepperProps = {
  readonly label: string;
  readonly group: string;
  readonly names: readonly [string, string];
  readonly icons: readonly [MissionIconName, MissionIconName];
  readonly disabled: boolean;
  readonly onStep: (dir: 1 | -1) => void;
};

/**
 * A stepper: its label and the back and forward keys.
 *
 * @param props - The stepper.
 * @returns The group.
 */
function Stepper(props: StepperProps): JSX.Element {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a stepper of two buttons, styled as one group; it is no form, so no fieldset
    <span data-stepper role="group" aria-label={props.group}>
      <span data-part="label">{props.label}</span>
      <button
        type="button"
        aria-label={props.names[0]}
        disabled={props.disabled}
        onClick={() => props.onStep(-1)}
      >
        <MissionIcon name={props.icons[0]} size={14} />
      </button>
      <button
        type="button"
        aria-label={props.names[1]}
        disabled={props.disabled}
        onClick={() => props.onStep(1)}
      >
        <MissionIcon name={props.icons[1]} size={14} />
      </button>
    </span>
  );
}

/**
 * The transport row.
 *
 * @param props - ctx and the api.
 * @returns The row.
 */
export function Transport(props: TransportProps): JSX.Element {
  const { ctx, api } = props;
  const { mission } = ctx.state;
  const { live } = mission.view;
  const none = mission.history.count === 0;
  useTicker(250, !live && !none);
  const behind = viewWindow(mission, performance.now()).behindMs;
  return (
    <div data-transport>
      <button
        type="button"
        data-live-toggle
        aria-pressed={live}
        disabled={none}
        onClick={() => (live ? api.pause() : api.live())}
      >
        {live ? (
          <span data-dot="live" aria-hidden="true" />
        ) : (
          <MissionIcon name="pause" size={14} />
        )}
        {live ? "Live" : "Paused"}
      </button>
      {live || none ? undefined : <span data-behind>{behindText(behind)}</span>}
      <Stepper
        label="Frame"
        group="Frame step"
        names={["Previous frame", "Next frame"]}
        icons={["left", "right"]}
        disabled={none}
        onStep={dir => api.step(dir)}
      />
      <Stepper
        label="Spike"
        group="Jump to spike"
        names={["Previous spike", "Next spike"]}
        icons={["skip-left", "skip-right"]}
        disabled={none}
        onStep={dir => api.jump("spike", dir)}
      />
      <Stepper
        label="GC"
        group="Jump to GC"
        names={["Previous GC", "Next GC"]}
        icons={["skip-left", "skip-right"]}
        disabled={none || !hasGcData(mission)}
        onStep={dir => api.jump("gc", dir)}
      />
      <span data-keys title="Arrow keys step frames, Shift arrows jump spikes, Space pauses">
        <kbd>←</kbd>
        <kbd>→</kbd>
        <kbd>⇧</kbd>
        <kbd>Space</kbd>
      </span>
      <span data-part="spacer" />
      {live || none ? undefined : (
        <button
          type="button"
          data-variant="primary"
          data-action="back-to-live"
          onClick={() => api.live()}
        >
          <MissionIcon name="live" size={14} />
          Back to live
        </button>
      )}
    </div>
  );
}

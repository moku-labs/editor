/**
 * @file gameView plugin — the device toolbar (A2): picker, device select with W × H, Portrait /
 * Landscape, Fit / 100 %, safe-area switch, Reload, camera, Series (red with the time while
 * recording) and the overlay-in-game switch (workspace owns the flag, R4). Camera, Series and the
 * overlay switch are dimmed with a tooltip when the game lacks their command.
 */
import type { VNode } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import { linkPlugin } from "../../link";
import { workspacePlugin } from "../../workspace";
import { isDevicePresetId, resolveDevice } from "../../workspace/devices";
import { setPopover } from "../capture/series";
import { takeScreenshot } from "../capture/shot";
import { GAME_COMMANDS, NO_CAPTURE_TEXT, NO_OVERLAY_TEXT, OVERLAY_COMMAND } from "../commands";
import { setPicker } from "../element/select";
import { missingCommand, toggleOverlay } from "../palette";
import { reloadGame } from "../stage/reload";
import type { GameViewCtx } from "../types";
import { setZoom, toggleSafeArea } from "../view-state";
import { elapsedText } from "./text";
import { useGameView, useTicker } from "./useGameView";

/**
 * Props of `DeviceToolbar`.
 */
export type DeviceToolbarProps = { readonly ctx: GameViewCtx };

/**
 * Props of a segmented radio group.
 */
type SegmentedProps<T extends string> = {
  readonly label: string;
  readonly options: readonly (readonly [value: T, text: string])[];
  readonly value: T;
  readonly onChoose: (value: T) => void;
};

/**
 * A segmented control (`role="radiogroup"` with `aria-checked`).
 *
 * @param props - Label, options, the current value and the choose callback.
 * @returns The group.
 * @example
 * ```tsx
 * <Segmented label="Zoom" options={[["fit", "Fit"], ["100", "100 %"]]} value="fit" onChoose={choose} />
 * ```
 */
function Segmented<T extends string>(props: SegmentedProps<T>): VNode {
  const { label, options, value, onChoose } = props;
  return (
    <div role="radiogroup" data-segmented="" aria-label={label}>
      {options.map(([option, text]) => (
        // biome-ignore lint/a11y/useSemanticElements: a segmented control of buttons, styled as one group
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={option === value}
          onClick={() => onChoose(option)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/**
 * Device select, W × H and the orientation segment.
 *
 * @param props - The gameView domain context.
 * @param props.ctx - Domain context of gameView.
 * @returns The device controls.
 * @example
 * ```tsx
 * <DeviceControls ctx={ctx} />
 * ```
 */
function DeviceControls(props: { readonly ctx: GameViewCtx }): VNode {
  const workspace = props.ctx.require(workspacePlugin);
  const choice = workspace.device();
  const size = resolveDevice(choice.preset, choice.orientation);
  return (
    <>
      <select
        data-part="device"
        aria-label="Device"
        value={choice.preset.id}
        onChange={event => {
          const id = event.currentTarget.value;
          if (isDevicePresetId(id)) workspace.setDevice({ preset: id });
        }}
      >
        {workspace.devices().map(device => (
          <option key={device.id} value={device.id}>
            {device.name}
          </option>
        ))}
      </select>
      <span data-part="size">
        {size.w} × {size.h}
      </span>
      <Segmented
        label="Orientation"
        options={[
          ["portrait", "Portrait"],
          ["landscape", "Landscape"]
        ]}
        value={choice.orientation}
        onChoose={orientation => workspace.setDevice({ orientation })}
      />
    </>
  );
}

/**
 * The zoom segment, the safe-area switch (off for the desktop) and Reload.
 *
 * @param props - The gameView domain context.
 * @param props.ctx - Domain context of gameView.
 * @returns The view controls.
 * @example
 * ```tsx
 * <ViewControls ctx={ctx} />
 * ```
 */
function ViewControls(props: { readonly ctx: GameViewCtx }): VNode {
  const { ctx } = props;
  const { state } = ctx;
  const desktop = ctx.require(workspacePlugin).device().preset.kind === "desktop";
  return (
    <>
      <Segmented
        label="Zoom"
        options={[
          ["fit", "Fit"],
          ["100", "100 %"]
        ]}
        value={state.zoom}
        onChoose={zoom => setZoom(state, zoom)}
      />
      <button
        type="button"
        role="switch"
        data-switch=""
        data-part="safe"
        aria-checked={state.safeArea && !desktop}
        aria-disabled={desktop ? "true" : undefined}
        onClick={desktop ? undefined : () => toggleSafeArea(state)}
      >
        <span data-track="" />
        Safe area
      </button>
      <button type="button" data-part="reload" onClick={() => reloadGame(ctx, false)}>
        Reload
      </button>
    </>
  );
}

/**
 * The attributes of a control dimmed when the game lacks its command.
 *
 * @param reason - The tooltip of a missing command, or false.
 * @param title - The tooltip otherwise.
 * @returns aria-disabled and title.
 * @example
 * ```ts
 * dimmed(false, "Take a screenshot"); // { "aria-disabled": undefined, title: "Take a screenshot" }
 * ```
 */
function dimmed(
  reason: string | false,
  title: string
): { readonly "aria-disabled": "true" | undefined; readonly title: string } {
  return { "aria-disabled": reason === false ? undefined : "true", title: reason || title };
}

/**
 * The camera button.
 *
 * @param props - The gameView domain context.
 * @param props.ctx - Domain context of gameView.
 * @returns The button.
 * @example
 * ```tsx
 * <CameraButton ctx={ctx} />
 * ```
 */
function CameraButton(props: { readonly ctx: GameViewCtx }): VNode {
  const { ctx } = props;
  const off = missingCommand(ctx, GAME_COMMANDS.capture, NO_CAPTURE_TEXT);
  return (
    <button
      type="button"
      data-part="capture"
      aria-label="Take a screenshot"
      {...dimmed(off, "Take a screenshot")}
      onClick={off ? undefined : () => takeScreenshot(ctx)}
    >
      Shot
    </button>
  );
}

/**
 * The Series button: opens the popover; red with the elapsed time while recording.
 *
 * @param props - The gameView domain context.
 * @param props.ctx - Domain context of gameView.
 * @returns The button.
 * @example
 * ```tsx
 * <SeriesButton ctx={ctx} />
 * ```
 */
function SeriesButton(props: { readonly ctx: GameViewCtx }): VNode {
  const { ctx } = props;
  const { recording, popover } = ctx.state.series;
  const off = missingCommand(ctx, GAME_COMMANDS.series, NO_CAPTURE_TEXT);
  if (recording !== undefined) {
    return (
      <button
        type="button"
        data-part="series"
        data-recording=""
        aria-expanded={popover}
        title="Recording a series"
        onClick={() => setPopover(ctx, true)}
      >
        {`● ${elapsedText(performance.now() - recording.startedAt)} s`}
      </button>
    );
  }
  return (
    <button
      type="button"
      data-part="series"
      aria-expanded={popover}
      {...dimmed(off, "Record a series")}
      onClick={off ? undefined : () => setPopover(ctx, !popover)}
    >
      Series
    </button>
  );
}

/**
 * The overlay-in-game switch (workspace's flag).
 *
 * @param props - The gameView domain context.
 * @param props.ctx - Domain context of gameView.
 * @returns The switch.
 * @example
 * ```tsx
 * <OverlaySwitch ctx={ctx} />
 * ```
 */
function OverlaySwitch(props: { readonly ctx: GameViewCtx }): VNode {
  const { ctx } = props;
  const off = missingCommand(ctx, OVERLAY_COMMAND, NO_OVERLAY_TEXT);
  const on = ctx.require(workspacePlugin).overlayInGame();
  return (
    <button
      type="button"
      role="switch"
      data-switch=""
      data-part="overlay"
      aria-checked={on}
      {...dimmed(off, "Overlay in game")}
      onClick={off ? undefined : () => toggleOverlay(ctx)}
    >
      <span data-track="" />
      Overlay in game <span data-part="state">{on ? "On" : "Off"}</span>
    </button>
  );
}

/**
 * The device toolbar.
 *
 * @param props - The gameView domain context.
 * @returns The toolbar.
 * @example
 * ```tsx
 * <DeviceToolbar ctx={ctx} />
 * ```
 */
export function DeviceToolbar(props: DeviceToolbarProps): VNode {
  const { ctx } = props;
  const { state } = ctx;
  const picking = useGameView(state, () => state.picker.on);
  const link = ctx.require(linkPlugin);
  const [, setManifests] = useState(0);
  // A layout effect: a manifest change right after the first render is not lost.
  useLayoutEffect(() => link.onManifest(() => setManifests(count => count + 1)), [link]);
  useTicker(state.series.recording !== undefined, 100);

  return (
    <div data-game="toolbar" role="toolbar" aria-label="Game device">
      <button
        type="button"
        data-part="pick"
        aria-pressed={picking}
        title="Select element ⇧⌘C"
        onClick={() => setPicker(ctx)}
      >
        Select
      </button>
      <DeviceControls ctx={ctx} />
      <ViewControls ctx={ctx} />
      <CameraButton ctx={ctx} />
      <SeriesButton ctx={ctx} />
      <OverlaySwitch ctx={ctx} />
    </div>
  );
}

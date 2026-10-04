/**
 * @file gameView plugin — the device toolbar (A2): picker, device select grouped by kind (iPhone,
 * Android, Foldable, Tablet, Desktop; an estimated preset says so in its title) with W × H, Fold /
 * Unfold for a foldable, Portrait / Landscape, Fit / 100 %, safe-area switch, the Sound switch
 * (`game.mute`, dimmed with a tooltip without it, round 2b R11), Reload, camera,
 * Series (red with the time while recording) and, while the Element panel is closed, its reopen
 * button. Camera and Series are dimmed with a tooltip when the game lacks their command. The
 * overlay-in-game switch lives in the top bar (round 2 R1).
 */
import type { VNode } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import { linkPlugin } from "../../link";
import { useSidePanel } from "../../panels/shared/side-panel";
import type { DeviceSpec } from "../../registry/protocol";
import { workspacePlugin } from "../../workspace";
import { DEVICE_GROUPS, isDevicePresetId, resolveDevice } from "../../workspace/devices";
import { setPopover } from "../capture/series";
import { takeScreenshot } from "../capture/shot";
import { GAME_COMMANDS, NO_CAPTURE_TEXT } from "../commands";
import { setPicker } from "../element/select";
import { missingCommand } from "../palette";
import { SIDE_PANEL, SIDE_TITLE } from "../side";
import { canMute, NO_MUTE_TEXT, setSound } from "../sound";
import { foldDevice } from "../stage/fold";
import { reloadGame } from "../stage/reload";
import type { GameViewCtx } from "../types";
import { setZoom, toggleSafeArea } from "../view-state";
import { elapsedText } from "./text";
import { RECORD_TICK_MS, useGameView, useTicker } from "./useGameView";

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
 * The title of a preset's option: its size and dpr, and a note when its values are estimates.
 *
 * @param device - The preset.
 * @returns "412×915 · dpr 2.625", "… · approx: estimated values".
 * @example
 * ```ts
 * optionTitle(presetOf("redmi-note-13")); // "393×873 · dpr 2.75 · approx: estimated values"
 * ```
 */
function optionTitle(device: DeviceSpec): string {
  const title = `${device.w}×${device.h} · dpr ${device.dpr}`;
  return device.approx === true ? `${title} · approx: estimated values` : title;
}

/**
 * The device select: one `<optgroup>` per preset group, in display order.
 *
 * @param props - The presets and the chosen id.
 * @param props.devices - Every preset.
 * @param props.value - The chosen preset id.
 * @param props.onChoose - Takes a chosen preset id.
 * @returns The select.
 */
function DeviceSelect(props: {
  readonly devices: readonly DeviceSpec[];
  readonly value: string;
  readonly onChoose: (id: string) => void;
}): VNode {
  const { devices, value, onChoose } = props;
  return (
    <select
      data-part="device"
      aria-label="Device"
      value={value}
      onChange={event => onChoose(event.currentTarget.value)}
    >
      {DEVICE_GROUPS.map(group => (
        <optgroup key={group.id} label={group.label}>
          {devices
            .filter(device => device.group === group.id)
            .map(device => (
              <option key={device.id} value={device.id} title={optionTitle(device)}>
                {device.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

/**
 * Fold / Unfold of a foldable preset: the cover shows "Unfold", the inner screen "Fold".
 *
 * @param props - The gameView domain context and the folded flag.
 * @param props.ctx - Domain context of gameView.
 * @param props.folded - True while the cover screen shows.
 * @returns The button.
 */
function FoldButton(props: { readonly ctx: GameViewCtx; readonly folded: boolean }): VNode {
  const { ctx, folded } = props;
  return (
    <button
      type="button"
      data-action="fold"
      title={folded ? "Unfold to the inner screen" : "Fold to the cover screen"}
      onClick={() => foldDevice(ctx)}
    >
      {folded ? "Unfold" : "Fold"}
    </button>
  );
}

/**
 * Device select, W × H, Fold / Unfold for a foldable and the orientation segment.
 *
 * @param props - The gameView domain context.
 * @param props.ctx - Domain context of gameView.
 * @returns The device controls.
 */
function DeviceControls(props: { readonly ctx: GameViewCtx }): VNode {
  const { ctx } = props;
  const workspace = ctx.require(workspacePlugin);
  const choice = workspace.device();
  const size = resolveDevice(choice.preset, choice.orientation);
  return (
    <>
      <DeviceSelect
        devices={workspace.devices()}
        value={choice.preset.id}
        onChoose={id => {
          if (isDevicePresetId(id)) workspace.setDevice({ preset: id });
        }}
      />
      <span data-part="size">
        {size.w} × {size.h}
      </span>
      {choice.preset.fold !== undefined && <FoldButton ctx={ctx} folded={choice.folded} />}
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
 * The Sound switch (round 2b R11): on while the game has its sound; dimmed with a tooltip when
 * the game has no `game.mute`.
 *
 * @param props - The gameView domain context.
 * @param props.ctx - Domain context of gameView.
 * @returns The switch.
 */
function SoundSwitch(props: { readonly ctx: GameViewCtx }): VNode {
  const { ctx } = props;
  const muted = ctx.require(workspacePlugin).muted();
  const off = !canMute(ctx);
  return (
    <button
      type="button"
      role="switch"
      data-switch=""
      data-part="sound"
      aria-checked={!muted}
      {...dimmed(off && NO_MUTE_TEXT, "Sound on or off · M")}
      onClick={off ? undefined : () => void setSound(ctx)}
    >
      <span data-track="" />
      Sound
    </button>
  );
}

/**
 * The zoom segment, the safe-area switch (off for the desktop), the Sound switch and Reload.
 *
 * @param props - The gameView domain context.
 * @param props.ctx - Domain context of gameView.
 * @returns The view controls.
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
      <SoundSwitch ctx={ctx} />
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
 * The reopen button of the Element panel, only while the panel is closed.
 *
 * @returns The button, undefined while the panel shows.
 */
function ReopenSide(): VNode | undefined {
  const side = useSidePanel(SIDE_PANEL);
  if (!side.closed) return undefined;
  return (
    <button
      type="button"
      data-action={`reopen-${SIDE_PANEL}`}
      title={`Show ${SIDE_TITLE}`}
      onClick={side.show}
    >
      {SIDE_TITLE}
    </button>
  );
}

/**
 * The device toolbar.
 *
 * @param props - The gameView domain context.
 * @returns The toolbar.
 */
export function DeviceToolbar(props: DeviceToolbarProps): VNode {
  const { ctx } = props;
  const { state } = ctx;
  const picking = useGameView(state, () => state.picker.on);
  const link = ctx.require(linkPlugin);
  const [, setManifests] = useState(0);
  // A layout effect: a manifest change right after the first render is not lost.
  useLayoutEffect(() => link.onManifest(() => setManifests(count => count + 1)), [link]);
  useTicker(state.series.recording !== undefined, RECORD_TICK_MS);

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
      <ReopenSide />
    </div>
  );
}

/**
 * @file workspace plugin — the two editor-channel requests the hub relays to this page (D-60):
 * `device` reads or changes the device, `show` reads or changes the workspace. An empty request
 * only reads. A change goes through the function the api method calls (`patchDevice` of
 * `setDevice`, `showWorkspace` of `show`), so prefs are stored, `onPrefs` listeners run and
 * `workspace:changed` fires as for a click.
 */
import { linkPlugin } from "../link";
import type {
  DeviceInfo,
  DeviceParams,
  DevicePresetInfo,
  DeviceSpec,
  ShowInfo,
  ShowParams
} from "../registry/protocol";
import {
  DEVICES,
  errorCode,
  isDevicePresetId,
  resolveDevice,
  WORKSPACE_NAMES,
  wireError
} from "../registry/protocol";
import { showWorkspace } from "./actions";
import { deviceChoiceOf } from "./devices";
import { patchDevice } from "./prefs/apply";
import { trackCleanup } from "./state";
import type { StoredDevice, WorkspaceCtx } from "./types";

/**
 * The failure of a `device` request that names a preset this page does not have. The message
 * names the asked id only: the presets are the `presets` of an answer, not a line of text.
 *
 * @param preset - The asked preset id.
 * @returns The -32602 `invalid_input` error with `field: "preset"`, ready to throw.
 * @example
 * ```ts
 * throw unknownPreset("nokia"); // [moku-editor] editor.device: unknown preset "nokia". …
 * ```
 */
function unknownPreset(preset: string): Error {
  return wireError(
    errorCode.invalidInput,
    `editor.device: unknown preset "${preset}".\n  Send the request without params to read the presets.`,
    { reason: "invalid_input", retryable: false, field: "preset" }
  );
}

/**
 * True when a `device` request names a field: an empty one only reads.
 *
 * @param params - The checked params.
 * @returns Whether the request changes the device.
 * @example
 * ```ts
 * isDeviceChange({ folded: false }); // true
 * isDeviceChange({}); // false
 * ```
 */
function isDeviceChange(params: DeviceParams): boolean {
  return (
    params.preset !== undefined || params.orientation !== undefined || params.folded !== undefined
  );
}

/**
 * One preset as a `device` answer lists it. The size is the top-level one: the cover screen of a
 * foldable.
 *
 * @param spec - A device preset.
 * @returns Its row.
 * @example
 * ```ts
 * presetInfoOf(presetOf("pixel-8")); // { id: "pixel-8", name: "Pixel 8", group: "android", kind: "phone", w: 412, h: 915, foldable: false }
 * ```
 */
function presetInfoOf(spec: DeviceSpec): DevicePresetInfo {
  const { id, name, group, kind, w, h, fold } = spec;

  return { id, name, group, kind, w, h, foldable: fold !== undefined };
}

/**
 * The answer of a `device` request for a stored device: what `device()` gives (the screen in use)
 * with the orientation applied to its size, and every preset of `devices()` as a row. A preset
 * without a fold always answers `folded: true`, whatever the stored flag.
 *
 * @param device - The stored device.
 * @returns The DeviceInfo.
 * @example
 * ```ts
 * deviceInfoOf({ preset: "pixel-8", orientation: "landscape" });
 * // { preset: "pixel-8", orientation: "landscape", folded: true, w: 915, h: 412, presets: [21 rows] }
 * deviceInfoOf({ preset: "galaxy-z-fold-6", orientation: "portrait", folded: false }).w; // 707
 * ```
 */
export function deviceInfoOf(device: StoredDevice): DeviceInfo {
  const { preset, orientation, folded } = deviceChoiceOf(device);
  const { w, h } = resolveDevice(preset, orientation);

  return {
    preset: preset.id,
    orientation,
    folded: folded || preset.fold === undefined,
    w,
    h,
    presets: DEVICES.map(spec => presetInfoOf(spec))
  };
}

/**
 * Answers the `device` request. With a preset, an orientation or a fold it changes the device the
 * way `setDevice` does; the preset id is checked first, so a bad request changes nothing.
 *
 * @param ctx - Domain context of workspace.
 * @param params - The params link checked: any of `preset`, `orientation`, `folded`, or none.
 * @returns The device after the change.
 * @throws {Error} -32602 `invalid_input` with `field: "preset"` for a preset id not in `devices()`.
 */
export function answerDevice(ctx: WorkspaceCtx, params: DeviceParams): DeviceInfo {
  const { preset, ...rest } = params;
  if (preset !== undefined && !isDevicePresetId(preset)) throw unknownPreset(preset);

  if (isDeviceChange(params)) patchDevice(ctx, preset === undefined ? rest : { ...rest, preset });

  return deviceInfoOf(ctx.state.device);
}

/**
 * Answers the `show` request. With a workspace it shows it the way `show` does.
 *
 * @param ctx - Domain context of workspace.
 * @param params - The params link checked: a workspace, or none.
 * @returns The shown workspace and every workspace a next request can name.
 */
export function answerShow(ctx: WorkspaceCtx, params: ShowParams): ShowInfo {
  if (params.workspace !== undefined) showWorkspace(ctx, params.workspace);

  return { workspace: ctx.state.active, workspaces: WORKSPACE_NAMES };
}

/**
 * Gives link the handlers of `device` and `show`. onStop removes them with the other cleanups.
 *
 * @param ctx - Domain context of workspace.
 */
export function registerRequests(ctx: WorkspaceCtx): void {
  const link = ctx.require(linkPlugin);

  trackCleanup(
    ctx.state,
    link.handle("device", params => answerDevice(ctx, params))
  );
  trackCleanup(
    ctx.state,
    link.handle("show", params => answerShow(ctx, params))
  );
}

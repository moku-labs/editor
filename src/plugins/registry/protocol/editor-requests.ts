/**
 * @file Protocol — the checks of the three editor requests the hub relays to the page next to
 * `select` (D-60): `device`, `show` and `node`. Six parsers, one per params and one per answer,
 * and `WORKSPACE_NAMES`. Params are closed objects: an unknown field or a wrong type answers
 * `undefined`. Answers are read like `parseSelectionInfo`: known fields are checked, unknown fields
 * are dropped, in a preset row too. A parser returns a fresh copy. Pure: a value from the wire is
 * narrowed field by field, never cast.
 */
import { DEVICE_GROUPS } from "./devices";
import type {
  DeviceInfo,
  DeviceParams,
  DevicePresetInfo,
  DeviceSpec,
  NodeInfo,
  NodeParams,
  Orientation,
  ShowInfo,
  ShowParams,
  WorkspaceName
} from "./types";

/**
 * A type with every field writable, for building a fresh copy field by field.
 */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * The workspaces of the tools page rail, in rail order: the names `show` takes and answers. The
 * hub and the MCP bridge check a name against this list.
 *
 * @example
 * ```ts
 * WORKSPACE_NAMES.includes("state"); // true
 * WORKSPACE_NAMES.join(" "); // "flow game render state files console"
 * ```
 */
export const WORKSPACE_NAMES: readonly WorkspaceName[] = [
  "flow",
  "game",
  "render",
  "state",
  "files",
  "console"
];

/**
 * The longest node id a `node` request may carry.
 */
const NODE_ID_MAX = 256;

/**
 * `WORKSPACE_NAMES` as a set, to test a value of any type.
 */
const WORKSPACES: ReadonlySet<unknown> = new Set(WORKSPACE_NAMES);

/**
 * The two orientations.
 */
const ORIENTATIONS: ReadonlySet<unknown> = new Set<Orientation>(["portrait", "landscape"]);

/**
 * The kinds of a device preset.
 */
const DEVICE_KINDS: ReadonlySet<unknown> = new Set<DeviceSpec["kind"]>([
  "phone",
  "tablet",
  "desktop"
]);

/**
 * The fields of DeviceParams.
 */
const DEVICE_PARAMS_FIELDS = [
  "preset",
  "orientation",
  "folded"
] as const satisfies readonly (keyof DeviceParams)[];

/**
 * The fields of ShowParams.
 */
const SHOW_PARAMS_FIELDS = ["workspace"] as const satisfies readonly (keyof ShowParams)[];

/**
 * The fields of NodeParams.
 */
const NODE_PARAMS_FIELDS = ["id"] as const satisfies readonly (keyof NodeParams)[];

/**
 * True for an object that is neither null nor an array.
 *
 * @param value - Anything.
 * @returns Whether `value` is a record.
 * @example
 * ```ts
 * isRecord({ id: "main/home" }); // true
 * ```
 */
function isRecord(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True for a record with no key outside `fields`: the shape of request params.
 *
 * @param value - Anything.
 * @param fields - Every key the object may have.
 * @returns Whether `value` is a record without an unknown field.
 * @example
 * ```ts
 * isClosedRecord({ id: "main/home" }, ["id"]); // true
 * isClosedRecord({ id: "main/home", open: true }, ["id"]); // false
 * ```
 */
function isClosedRecord(value: unknown, fields: readonly string[]): value is object {
  return isRecord(value) && Object.keys(value).every(key => fields.includes(key));
}

/**
 * True when the record has the field as its own key and the value passes the check.
 *
 * @param record - A record.
 * @param field - The field name.
 * @param check - The check of the value.
 * @returns Whether the field is present and right.
 * @example
 * ```ts
 * required({ id: "main/home" }, "id", isText); // true
 * ```
 */
function required(record: object, field: string, check: (value: unknown) => boolean): boolean {
  return Object.hasOwn(record, field) && check(Reflect.get(record, field));
}

/**
 * True when the field is absent or its value passes the check. A key present with `undefined` is
 * wrong: the type has no `undefined` (exactOptionalPropertyTypes).
 *
 * @param record - A record.
 * @param field - The field name.
 * @param check - The check of the value.
 * @returns Whether the field is absent or right.
 * @example
 * ```ts
 * optional({}, "preset", isText); // true
 * ```
 */
function optional(record: object, field: string, check: (value: unknown) => boolean): boolean {
  return !Object.hasOwn(record, field) || check(Reflect.get(record, field));
}

/**
 * True for a string.
 *
 * @param value - Anything.
 * @returns Whether `value` is a string.
 * @example
 * ```ts
 * isText("pixel-8"); // true
 * ```
 */
function isText(value: unknown): boolean {
  return typeof value === "string";
}

/**
 * True for a finite number.
 *
 * @param value - Anything.
 * @returns Whether `value` is a finite number.
 * @example
 * ```ts
 * isFiniteNumber(Number.NaN); // false
 * ```
 */
function isFiniteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * True for a boolean.
 *
 * @param value - Anything.
 * @returns Whether `value` is a boolean.
 * @example
 * ```ts
 * isBoolean(false); // true
 * ```
 */
function isBoolean(value: unknown): boolean {
  return typeof value === "boolean";
}

/**
 * True for `"portrait"` or `"landscape"`.
 *
 * @param value - Anything.
 * @returns Whether `value` is an Orientation.
 * @example
 * ```ts
 * isOrientation("sideways"); // false
 * ```
 */
function isOrientation(value: unknown): boolean {
  return ORIENTATIONS.has(value);
}

/**
 * True for a name of `WORKSPACE_NAMES`.
 *
 * @param value - Anything.
 * @returns Whether `value` is a WorkspaceName.
 * @example
 * ```ts
 * isWorkspaceName("settings"); // false
 * ```
 */
function isWorkspaceName(value: unknown): boolean {
  return WORKSPACES.has(value);
}

/**
 * True for an array of names of `WORKSPACE_NAMES`.
 *
 * @param value - Anything.
 * @returns Whether `value` is a WorkspaceName list.
 * @example
 * ```ts
 * isWorkspaceList(["flow", "settings"]); // false
 * ```
 */
function isWorkspaceList(value: unknown): boolean {
  return Array.isArray(value) && value.every(name => isWorkspaceName(name));
}

/**
 * True for a node id: a string of 1 to 256 chars.
 *
 * @param value - Anything.
 * @returns Whether `value` is a node id.
 * @example
 * ```ts
 * isNodeId(""); // false
 * ```
 */
function isNodeId(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= NODE_ID_MAX;
}

/**
 * True for a group of `DEVICE_GROUPS`.
 *
 * @param value - Anything.
 * @returns Whether `value` is a preset group.
 * @example
 * ```ts
 * isDeviceGroup("foldable"); // true
 * ```
 */
function isDeviceGroup(value: unknown): boolean {
  return DEVICE_GROUPS.some(group => group.id === value);
}

/**
 * True for `"phone"`, `"tablet"` or `"desktop"`.
 *
 * @param value - Anything.
 * @returns Whether `value` is a preset kind.
 * @example
 * ```ts
 * isDeviceKind("watch"); // false
 * ```
 */
function isDeviceKind(value: unknown): boolean {
  return DEVICE_KINDS.has(value);
}

/**
 * True for DeviceParams: a closed object whose three fields are absent or of their type.
 *
 * @param value - Anything.
 * @returns Whether `value` is DeviceParams.
 * @example
 * ```ts
 * isDeviceParams({ orientation: "landscape" }); // true
 * ```
 */
function isDeviceParams(value: unknown): value is DeviceParams {
  return (
    isClosedRecord(value, DEVICE_PARAMS_FIELDS) &&
    optional(value, "preset", isText) &&
    optional(value, "orientation", isOrientation) &&
    optional(value, "folded", isBoolean)
  );
}

/**
 * True for a DevicePresetInfo: its seven fields are present and right. Unknown fields are ignored.
 *
 * @param value - Anything.
 * @returns Whether `value` is a DevicePresetInfo.
 * @example
 * ```ts
 * isPresetInfo({ id: "pixel-8", name: "Pixel 8" }); // false: five fields are missing
 * ```
 */
function isPresetInfo(value: unknown): value is DevicePresetInfo {
  return (
    isRecord(value) &&
    required(value, "id", isText) &&
    required(value, "name", isText) &&
    required(value, "group", isDeviceGroup) &&
    required(value, "kind", isDeviceKind) &&
    required(value, "w", isFiniteNumber) &&
    required(value, "h", isFiniteNumber) &&
    required(value, "foldable", isBoolean)
  );
}

/**
 * True for an array of DevicePresetInfo.
 *
 * @param value - Anything.
 * @returns Whether `value` is a preset list.
 * @example
 * ```ts
 * isPresetList([]); // true
 * ```
 */
function isPresetList(value: unknown): boolean {
  return Array.isArray(value) && value.every(row => isPresetInfo(row));
}

/**
 * True for a DeviceInfo: its six fields are present and right. Unknown fields are ignored, in a
 * preset row too.
 *
 * @param value - Anything.
 * @returns Whether `value` is a DeviceInfo.
 * @example
 * ```ts
 * isDeviceInfo({ preset: "pixel-8", orientation: "portrait", folded: true, w: 412, h: 915, presets: [] }); // true
 * ```
 */
function isDeviceInfo(value: unknown): value is DeviceInfo {
  return (
    isRecord(value) &&
    required(value, "preset", isText) &&
    required(value, "orientation", isOrientation) &&
    required(value, "folded", isBoolean) &&
    required(value, "w", isFiniteNumber) &&
    required(value, "h", isFiniteNumber) &&
    required(value, "presets", isPresetList)
  );
}

/**
 * True for ShowParams: a closed object whose `workspace` is absent or a WorkspaceName.
 *
 * @param value - Anything.
 * @returns Whether `value` is ShowParams.
 * @example
 * ```ts
 * isShowParams({ workspace: "state" }); // true
 * ```
 */
function isShowParams(value: unknown): value is ShowParams {
  return isClosedRecord(value, SHOW_PARAMS_FIELDS) && optional(value, "workspace", isWorkspaceName);
}

/**
 * True for a ShowInfo: a WorkspaceName and a list of them. Unknown fields are ignored.
 *
 * @param value - Anything.
 * @returns Whether `value` is a ShowInfo.
 * @example
 * ```ts
 * isShowInfo({ workspace: "flow", workspaces: ["flow", "game"] }); // true
 * ```
 */
function isShowInfo(value: unknown): value is ShowInfo {
  return (
    isRecord(value) &&
    required(value, "workspace", isWorkspaceName) &&
    required(value, "workspaces", isWorkspaceList)
  );
}

/**
 * True for NodeParams: a closed object with an `id` of 1 to 256 chars.
 *
 * @param value - Anything.
 * @returns Whether `value` is NodeParams.
 * @example
 * ```ts
 * isNodeParams({ id: "main/home" }); // true
 * ```
 */
function isNodeParams(value: unknown): value is NodeParams {
  return isClosedRecord(value, NODE_PARAMS_FIELDS) && required(value, "id", isNodeId);
}

/**
 * True for a NodeInfo: a text `id` and a text `selected`. Unknown fields are ignored.
 *
 * @param value - Anything.
 * @returns Whether `value` is a NodeInfo.
 * @example
 * ```ts
 * isNodeInfo({ id: "main/home" }); // false: `selected` is missing
 * ```
 */
function isNodeInfo(value: unknown): value is NodeInfo {
  return isRecord(value) && required(value, "id", isText) && required(value, "selected", isText);
}

/**
 * A fresh copy of a checked preset row with its seven fields only.
 *
 * @param row - A checked row.
 * @returns The copy.
 * @example
 * ```ts
 * presetCopy({ id: "pixel-8", name: "Pixel 8", group: "android", kind: "phone", w: 412, h: 915, foldable: false });
 * ```
 */
function presetCopy(row: DevicePresetInfo): DevicePresetInfo {
  const { id, name, group, kind, w, h, foldable } = row;

  return { id, name, group, kind, w, h, foldable };
}

/**
 * Checks the params of an editor-channel `device` request and copies them. An empty object passes:
 * it reads the device and changes nothing. The preset id is any string: the page knows the presets
 * and answers -32602 for an id it does not have.
 *
 * @param value - The request params.
 * @returns Fresh DeviceParams, or undefined for an unknown field or a wrong type.
 * @example
 * ```ts
 * parseDeviceParams({ preset: "pixel-8", orientation: "landscape" }); // { preset: "pixel-8", orientation: "landscape" }
 * parseDeviceParams({}); // {}
 * parseDeviceParams({ orientation: "sideways" }); // undefined
 * parseDeviceParams({ preset: "pixel-8", zoom: 2 }); // undefined
 * ```
 */
export function parseDeviceParams(value: unknown): DeviceParams | undefined {
  if (!isDeviceParams(value)) return undefined;

  const { preset, orientation, folded } = value;
  const params: Writable<DeviceParams> = {};

  if (preset !== undefined) params.preset = preset;
  if (orientation !== undefined) params.orientation = orientation;
  if (folded !== undefined) params.folded = folded;

  return params;
}

/**
 * Checks the params of an editor-channel `show` request and copies them. An empty object passes:
 * it reads the active workspace and changes nothing.
 *
 * @param value - The request params.
 * @returns Fresh ShowParams, or undefined for an unknown field or a name outside `WORKSPACE_NAMES`.
 * @example
 * ```ts
 * parseShowParams({ workspace: "state" }); // { workspace: "state" }
 * parseShowParams({}); // {}
 * parseShowParams({ workspace: "settings" }); // undefined
 * ```
 */
export function parseShowParams(value: unknown): ShowParams | undefined {
  if (!isShowParams(value)) return undefined;

  return value.workspace === undefined ? {} : { workspace: value.workspace };
}

/**
 * Checks the params of an editor-channel `node` request and copies them.
 *
 * @param value - The request params.
 * @returns Fresh NodeParams, or undefined for an unknown field or an `id` that is not a string of
 * 1 to 256 chars.
 * @example
 * ```ts
 * parseNodeParams({ id: "main/home" }); // { id: "main/home" }
 * parseNodeParams({ id: "" }); // undefined
 * parseNodeParams({ id: "main/home", expand: true }); // undefined
 * ```
 */
export function parseNodeParams(value: unknown): NodeParams | undefined {
  return isNodeParams(value) ? { id: value.id } : undefined;
}

/**
 * Checks the answer of an editor-channel `device` request and copies its known fields, the preset
 * list and its rows included; unknown fields, at the top and in a row, are dropped.
 *
 * @param value - Anything, e.g. the result of a `device` response.
 * @returns A fresh DeviceInfo, or undefined when `value` is not one.
 * @example
 * ```ts
 * parseDeviceInfo({ preset: "pixel-8", orientation: "landscape", folded: true, w: 915, h: 412, presets: [], dpr: 3 });
 * // { preset: "pixel-8", orientation: "landscape", folded: true, w: 915, h: 412, presets: [] }
 * parseDeviceInfo({ preset: "pixel-8", orientation: "landscape" }); // undefined
 * ```
 */
export function parseDeviceInfo(value: unknown): DeviceInfo | undefined {
  if (!isDeviceInfo(value)) return undefined;

  const { preset, orientation, folded, w, h, presets } = value;

  return { preset, orientation, folded, w, h, presets: presets.map(row => presetCopy(row)) };
}

/**
 * Checks the answer of an editor-channel `show` request and copies its known fields, the list
 * included; unknown fields are dropped.
 *
 * @param value - Anything, e.g. the result of a `show` response.
 * @returns A fresh ShowInfo, or undefined when `value` is not one.
 * @example
 * ```ts
 * parseShowInfo({ workspace: "state", workspaces: ["flow", "game", "state"], badge: 3 });
 * // { workspace: "state", workspaces: ["flow", "game", "state"] }
 * parseShowInfo({ workspace: "settings", workspaces: [] }); // undefined
 * ```
 */
export function parseShowInfo(value: unknown): ShowInfo | undefined {
  if (!isShowInfo(value)) return undefined;

  return { workspace: value.workspace, workspaces: [...value.workspaces] };
}

/**
 * Checks the answer of an editor-channel `node` request and copies its known fields; unknown
 * fields are dropped.
 *
 * @param value - Anything, e.g. the result of a `node` response.
 * @returns A fresh NodeInfo, or undefined when `value` is not one.
 * @example
 * ```ts
 * parseNodeInfo({ id: "main/home", selected: "main/home", open: true }); // { id: "main/home", selected: "main/home" }
 * parseNodeInfo({ id: "main/home" }); // undefined
 * ```
 */
export function parseNodeInfo(value: unknown): NodeInfo | undefined {
  return isNodeInfo(value) ? { id: value.id, selected: value.selected } : undefined;
}

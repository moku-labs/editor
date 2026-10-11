/**
 * @file gameView plugin — pending style edits (U8, D-67), pure: the key an element's edits are
 * kept under, the key the edits of a text style key are kept under (`textStyle:<key>`, D-73) and
 * what an edit belongs to (`EditOwner`), the value a style path names, the fields one style entry
 * turns into, the kind of control a field is (with the engine's values of an enum property,
 * `STYLE_ENUMS`), one edit recorded into a list, the edits a scene has not taken yet, the edits a
 * selection carries, and the text the agent gets (`editsText`). Nothing here writes a file or
 * talks to the game.
 */
import type { SceneNode } from "../../panels/shared/scene";
import { refId } from "../../panels/shared/scene";
import type { Json, StyleEdit, StyleValue } from "../../registry/protocol";
import type { ElementEdits, GameViewState } from "../types";

/**
 * One field of the Styles section: the style path it edits, the leaf name of a nested value
 * (`top` of `padding.top`; undefined for a plain value) and the value the scene has.
 *
 * @example
 * ```ts
 * const top: EditField = { path: "padding.top", label: "top", value: 25 };
 * ```
 */
export type EditField = {
  readonly path: string;
  readonly label: string | undefined;
  readonly value: StyleValue;
};

/**
 * What a pending edit belongs to: the selected element (its scene style), or a text style key
 * (the block of the key in the text styles file, D-73). One key styles many text nodes, so its
 * edit is the key's.
 *
 * @example
 * ```ts
 * const element: EditOwner = { kind: "node" };
 * const button: EditOwner = { kind: "textStyle", key: "ui.button" };
 * ```
 */
export type EditOwner =
  | { readonly kind: "node" }
  | { readonly kind: "textStyle"; readonly key: string };

/**
 * The control a field of the Styles section is: a number field, a text field, a checkbox, or a
 * select for a string whose property is an enum of the engine.
 *
 * @example
 * ```ts
 * const kind: FieldKind = fieldKind({ path: "justify", label: undefined }, "center"); // "select"
 * ```
 */
export type FieldKind = "number" | "text" | "checkbox" | "select";

/**
 * The style properties the engine types as a union of string literals, each with its values in
 * the engine's order: a field of one of them is a select. Read from the style types of
 * `@moku-labs/game` 0.13.1 (`BaseStyle`, the style a `game.ui` node carries). The name is the
 * style key, or the leaf name inside a record. A free string (`nineSlice`, `reason`) has no row;
 * neither has a property that also takes a number (`width: Extent`).
 *
 * @example
 * ```ts
 * STYLE_ENUMS.direction; // ["row", "column"]
 * STYLE_ENUMS.nineSlice; // undefined
 * ```
 */
export const STYLE_ENUMS: Readonly<Record<string, readonly string[]>> = {
  // FlowStyle.direction
  direction: ["row", "column"],
  // FlowStyle.justify
  justify: ["start", "center", "end", "between", "around", "evenly"],
  // FlowStyle.align
  align: ["start", "center", "end", "stretch"],
  // FlowStyle.alignSelf
  alignSelf: ["auto", "start", "center", "end", "stretch"],
  // BoxStyle.overflow
  overflow: ["visible", "hidden", "scroll"],
  // BoxStyle.fit
  fit: ["contain"],
  // PositionStyle.position
  position: ["relative", "absolute"],
  // VisualStyle.shape
  shape: ["rect", "triangle"],
  // TransformStyle.origin: the names of Origin. Its { x, y } form is a record of two numbers.
  origin: ["center", "top", "topLeft"]
};

/**
 * True for a value an edit can carry: a number, a string or a boolean.
 *
 * @param value - A style value of the scene.
 * @returns Whether a field can edit it.
 * @example
 * ```ts
 * isStyleValue(556); // true
 * isStyleValue({ top: 25 }); // false
 * ```
 */
export function isStyleValue(value: Json | undefined): value is StyleValue {
  return typeof value === "number" || typeof value === "string" || typeof value === "boolean";
}

/**
 * The key an element's edits are kept under: its ui key, else its node id.
 *
 * @param node - A scene node.
 * @returns The map key.
 * @example
 * ```ts
 * editKey({ id: "ui:homeScreen/homePlay", key: "homePlay" }); // "homePlay"
 * editKey({ id: "entity:7", key: undefined }); // "entity:7"
 * ```
 */
export function editKey(node: Pick<SceneNode, "id" | "key">): string {
  return node.key ?? node.id;
}

/**
 * What the map key of a text style key's edits starts with; also the project-index prefix.
 */
const TEXT_STYLE_PREFIX = "textStyle:";

/**
 * The key the edits of a text style key are kept under (D-73).
 *
 * @param key - The text style key.
 * @returns The map key.
 * @example
 * ```ts
 * textStyleEditKey("ui.button"); // "textStyle:ui.button"
 * ```
 */
export function textStyleEditKey(key: string): string {
  return `${TEXT_STYLE_PREFIX}${key}`;
}

/**
 * True for the map key of a text style key's edits: no scene node answers it.
 *
 * @param key - A key of the pending edits.
 * @returns Whether it names a text style key.
 * @example
 * ```ts
 * isTextStyleEditKey("textStyle:ui.button"); // true
 * isTextStyleEditKey("homePlay"); // false
 * ```
 */
export function isTextStyleEditKey(key: string): boolean {
  return key.startsWith(TEXT_STYLE_PREFIX);
}

/**
 * The text style key the map key of its edits names.
 *
 * @param key - A key of the pending edits.
 * @returns The text style key, undefined for the key of an element.
 * @example
 * ```ts
 * textStyleKeyOf("textStyle:ui.button"); // "ui.button"
 * textStyleKeyOf("homePlay"); // undefined
 * ```
 */
export function textStyleKeyOf(key: string): string | undefined {
  return isTextStyleEditKey(key) ? key.slice(TEXT_STYLE_PREFIX.length) : undefined;
}

/**
 * The edits kept under a key.
 *
 * @param kept - The pending edits per element (`state.edits`).
 * @param key - The element's key, undefined when it is not known.
 * @returns The edits, none for an unknown key.
 * @example
 * ```ts
 * editsOf(state.edits, "homePlay"); // [{ path: "minWidth", from: 556, to: 600 }]
 * ```
 */
export function editsOf(
  kept: ReadonlyMap<string, ElementEdits>,
  key: string | undefined
): readonly StyleEdit[] {
  return (key === undefined ? undefined : kept.get(key)?.edits) ?? [];
}

/**
 * The edits a selection of a node carries (`SelectionInfo.edits`): its own, then the edits of its
 * text style key, each under the path `textStyle:<key>.<field>` (D-73).
 *
 * @param kept - The pending edits (`state.edits`).
 * @param node - The selected node.
 * @returns The edits; the node's own list when its text style key has none.
 * @example
 * ```ts
 * // homePlayLabel is a text with `style="ui.button"`; the person wants its key smaller.
 * selectionEdits(state.edits, homePlayLabel); // [{ path: "textStyle:ui.button.size", from: 105, to: 96 }]
 * ```
 */
export function selectionEdits(
  kept: ReadonlyMap<string, ElementEdits>,
  node: Pick<SceneNode, "id" | "key" | "textStyle">
): readonly StyleEdit[] {
  const own = editsOf(kept, editKey(node));
  if (node.textStyle === undefined) return own;

  const owner = textStyleEditKey(node.textStyle);
  const ofKey = editsOf(kept, owner).map(edit => ({ ...edit, path: `${owner}.${edit.path}` }));
  return ofKey.length === 0 ? own : [...own, ...ofKey];
}

/**
 * The key the selected element's edits are kept under: from its scene node; without one, from the
 * selection published last for it, else its node id.
 *
 * @param state - The selection, the scene and the selection published last.
 * @returns The key, undefined when nothing is selected.
 */
export function selectedEditKey(
  state: Pick<GameViewState, "selected" | "scene" | "selection">
): string | undefined {
  const { selected, scene, selection } = state;
  if (selected === undefined) return undefined;
  const id = refId(selected);
  const node = scene?.nodes.get(id);
  if (node !== undefined) return editKey(node);

  // The scene is gone (a reload): the last publish of this element still names its key.
  const isPublished = selection !== undefined && refId(selection.ref) === id;
  return (isPublished ? selection.key : undefined) ?? id;
}

/**
 * The value a style path names: the entry of a key, or the leaf of a record for `<key>.<leaf>`.
 *
 * @param style - The style of a scene node.
 * @param path - The style path.
 * @returns The value, undefined when the path names a record, an array or nothing.
 * @example
 * ```ts
 * styleValueAt({ minWidth: 556, padding: { top: 25 } }, "padding.top"); // 25
 * styleValueAt({ minWidth: 556, padding: { top: 25 } }, "padding"); // undefined
 * ```
 */
export function styleValueAt(style: SceneNode["style"], path: string): StyleValue | undefined {
  if (style === undefined) return undefined;
  const whole = style[path];
  if (isStyleValue(whole)) return whole;

  const dot = path.indexOf(".");
  const record = dot === -1 ? undefined : style[path.slice(0, dot)];
  const isRecord = typeof record === "object" && record !== null && !Array.isArray(record);
  if (!isRecord) return undefined;
  const leaf = record[path.slice(dot + 1)];
  return isStyleValue(leaf) ? leaf : undefined;
}

/**
 * The fields one style entry turns into: one for a number, a string or a boolean; one per leaf
 * for a record of those (padding); none for anything else, which stays read-only text.
 *
 * @param key - The style key.
 * @param value - Its value in the scene.
 * @returns The fields, undefined for a read-only entry.
 * @example
 * ```ts
 * editFields("minWidth", 556); // [{ path: "minWidth", label: undefined, value: 556 }]
 * editFields("padding", { top: 25 }); // [{ path: "padding.top", label: "top", value: 25 }]
 * editFields("inset", ["safeArea.top", 12]); // undefined
 * ```
 */
export function editFields(key: string, value: Json): readonly EditField[] | undefined {
  if (isStyleValue(value)) return [{ path: key, label: undefined, value }];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;

  const fields: EditField[] = [];
  for (const [leaf, item] of Object.entries(value)) {
    if (!isStyleValue(item)) return undefined;
    fields.push({ path: `${key}.${leaf}`, label: leaf, value: item });
  }
  return fields.length === 0 ? undefined : fields;
}

/**
 * The engine's values of a field's property, by its name: the leaf name of a nested value, else
 * the style key.
 *
 * @param field - The path and the leaf name of a field.
 * @returns The values, undefined when the property is no enum.
 */
function enumOf(field: Pick<EditField, "path" | "label">): readonly string[] | undefined {
  const name = field.label ?? field.path;
  return Object.hasOwn(STYLE_ENUMS, name) ? STYLE_ENUMS[name] : undefined;
}

/**
 * The control of a field, by the value it shows: a checkbox for a boolean, a number field for a
 * number, and for a string a select when its property is an enum of the engine, else a text
 * field.
 *
 * @param field - The path and the leaf name of the field.
 * @param shown - The value the field shows: the pending value, else the scene value.
 * @returns The kind of control.
 * @example
 * ```ts
 * fieldKind({ path: "justify", label: undefined }, "center"); // "select"
 * fieldKind({ path: "nineSlice", label: undefined }, "ui.hud-pill"); // "text"
 * fieldKind({ path: "padding.top", label: "top" }, 25); // "number"
 * ```
 */
export function fieldKind(field: Pick<EditField, "path" | "label">, shown: StyleValue): FieldKind {
  if (typeof shown === "boolean") return "checkbox";
  if (typeof shown === "number") return "number";
  return enumOf(field) === undefined ? "text" : "select";
}

/**
 * The options of a select field: the engine's values of its property, then the scene value and
 * the value it shows when the table does not list them, so the select can always show both.
 *
 * @param field - The field.
 * @param shown - The value the field shows: the pending value, else the scene value.
 * @returns The options, in the engine's order.
 * @example
 * ```ts
 * selectOptions({ path: "direction", label: undefined, value: "row" }, "row"); // ["row", "column"]
 * selectOptions({ path: "fit", label: undefined, value: "cover" }, "cover"); // ["contain", "cover"]
 * ```
 */
export function selectOptions(field: EditField, shown: StyleValue): readonly string[] {
  const listed = enumOf(field) ?? [];
  const unlisted = [field.value, shown].filter(
    (value): value is string => typeof value === "string" && !listed.includes(value)
  );
  return [...listed, ...new Set(unlisted)];
}

/**
 * Records one edit into the edits of an element. The first edit of a path takes `from` from the
 * scene value; a second one replaces `to` and keeps that `from`; a `to` equal to the scene value
 * removes the edit of the path.
 *
 * @param edits - The edits of the element so far.
 * @param path - The style path.
 * @param now - The value the scene has for the path.
 * @param to - The wanted value.
 * @returns The edits after it: the same list when nothing changes.
 * @example
 * ```ts
 * withEdit([], "minWidth", 556, 600); // [{ path: "minWidth", from: 556, to: 600 }]
 * withEdit([{ path: "minWidth", from: 556, to: 600 }], "minWidth", 556, 556); // []
 * ```
 */
export function withEdit(
  edits: readonly StyleEdit[],
  path: string,
  now: StyleValue,
  to: StyleValue
): readonly StyleEdit[] {
  const made = edits.find(edit => edit.path === path);

  // Back to what the game shows: the edit of this path is gone.
  if (to === now) return made === undefined ? edits : edits.filter(edit => edit.path !== path);

  if (made === undefined) return [...edits, { path, from: now, to }];
  if (made.to === to) return edits;
  return edits.map(edit => (edit.path === path ? { ...edit, to } : edit));
}

/**
 * The edits a scene has not taken yet: an edit whose scene value equals its `to` is done (the
 * agent wrote the code and hot reload brought it in).
 *
 * @param edits - The edits of an element.
 * @param style - The style of its node in the new scene.
 * @returns The edits still pending: the same list when the scene took none.
 * @example
 * ```ts
 * unresolved([{ path: "minWidth", from: 556, to: 600 }], { minWidth: 600 }); // []
 * ```
 */
export function unresolved(
  edits: readonly StyleEdit[],
  style: SceneNode["style"]
): readonly StyleEdit[] {
  const left = edits.filter(edit => styleValueAt(style, edit.path) !== edit.to);
  return left.length === edits.length ? edits : left;
}

/**
 * A style value as the agent text writes it: a string in double quotes, a number and a boolean
 * bare.
 *
 * @param value - The value.
 * @returns The text.
 * @example
 * ```ts
 * valueText("center"); // '"center"'
 * valueText(600); // "600"
 * ```
 */
export function valueText(value: StyleValue): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/**
 * The block of one element in the agent text: `@moku <label>`, with ` · <path>:<line>` when the
 * source is known, then one line per edit.
 *
 * @param entry - The edits of the element.
 * @returns The lines of the block.
 */
function blockOf(entry: ElementEdits): string[] {
  const { label, source } = entry;
  const where = source === undefined ? "" : ` · ${source.path}:${source.line}`;
  const lines = entry.edits.map(
    edit => `${edit.path}: ${valueText(edit.from)} -> ${valueText(edit.to)}`
  );
  return [`@moku ${label}${where}`, ...lines];
}

/**
 * The pending edits as text for the agent ("Copy for agent"): one block per element and one per
 * text style key in the list's order, blocks separated by one empty line.
 *
 * @param list - The edits per element, the selected element first, then the text style keys.
 * @returns The text, "" for an empty list.
 * @example
 * ```ts
 * editsText([{ label: "homePlay", source: { path: "features/stage/views/home-screen.tsx", line: 199 }, byId: false, edits: [{ path: "minWidth", from: 556, to: 600 }] }]);
 * // "@moku homePlay · features/stage/views/home-screen.tsx:199\nminWidth: 556 -> 600"
 * editsText([{ label: "textStyle ui.button", source: { path: "shared/styles/text.ts", line: 88 }, byId: false, edits: [{ path: "size", from: 105, to: 96 }] }]);
 * // "@moku textStyle ui.button · shared/styles/text.ts:88\nsize: 105 -> 96"
 * ```
 */
export function editsText(list: readonly ElementEdits[]): string {
  return list.map(entry => blockOf(entry).join("\n")).join("\n\n");
}

/**
 * How many edits wait, as the copy toast says it.
 *
 * @param list - The edits per element.
 * @returns "1 edit", "2 edits".
 * @example
 * ```ts
 * editCountText([{ label: "homePlay", byId: false, edits: [{ path: "minWidth", from: 556, to: 600 }] }]); // "1 edit"
 * ```
 */
export function editCountText(list: readonly ElementEdits[]): string {
  const edits = list.reduce((sum, entry) => sum + entry.edits.length, 0);
  return edits === 1 ? "1 edit" : `${edits} edits`;
}

/**
 * How many edits wait, as the edits bar says it: the edits, and the elements only when there is
 * more than one.
 *
 * @param list - The edits per element.
 * @returns "1 edit", "2 edits", "3 edits · 2 elements".
 * @example
 * ```ts
 * countText(app.gameView.edits()); // "3 edits · 2 elements"
 * ```
 */
export function countText(list: readonly ElementEdits[]): string {
  const text = editCountText(list);
  return list.length > 1 ? `${text} · ${list.length} elements` : text;
}

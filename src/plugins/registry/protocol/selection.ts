/**
 * @file Protocol — the checks of the selection wire values (A5, A10, A15): `isSelectionInfo`, and
 * the parsers `parseSelectionInfo` and `parseSelectParams`, which return a fresh copy without the
 * unknown fields. An area selection (U9) adds `area` and `items`, pending style edits (U8) add
 * `edits`. Pure: a value from the wire is narrowed field by field, never cast.
 */
import type {
  SelectionInfo,
  SelectionItem,
  SelectionRect,
  SelectionRef,
  SelectParams,
  StyleEdit,
  StyleValue
} from "./types";

/**
 * A type with every field writable, for building a fresh copy field by field.
 */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * The optional text fields of a SelectionInfo (`key` is checked with the item fields).
 */
const TEXT_FIELDS = [
  "projection",
  "card",
  "crop",
  "line",
  "session"
] as const satisfies readonly (keyof SelectionInfo)[];

/**
 * The four numbers of a rect.
 */
const RECT_FIELDS = ["x", "y", "w", "h"] as const;

/**
 * True for an object that is neither null nor an array.
 *
 * @param value - Anything.
 * @returns Whether `value` is a record.
 * @example
 * ```ts
 * isRecord({ kind: "ui" }); // true
 * ```
 */
function isRecord(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
 * required({ name: "coins" }, "name", isText); // true
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
 * optional({}, "key", isText); // true
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
 * isText("coins"); // true
 * ```
 */
function isText(value: unknown): boolean {
  return typeof value === "string";
}

/**
 * True for a string that is not empty.
 *
 * @param value - Anything.
 * @returns Whether `value` is a non-empty string.
 * @example
 * ```ts
 * isFilledText(""); // false
 * ```
 */
function isFilledText(value: unknown): boolean {
  return typeof value === "string" && value !== "";
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
 * True for a ui ref with a text path or an entity ref with an integer id.
 *
 * @param value - Anything.
 * @returns Whether `value` is a SelectionRef.
 * @example
 * ```ts
 * isSelectionRef({ kind: "entity", id: 7 }); // true
 * ```
 */
function isSelectionRef(value: unknown): value is SelectionRef {
  if (!isRecord(value)) return false;

  const kind: unknown = Reflect.get(value, "kind");

  if (kind === "ui") return required(value, "path", isText);
  if (kind === "entity") return required(value, "id", Number.isInteger);

  return false;
}

/**
 * True for a rect of four finite numbers.
 *
 * @param value - Anything.
 * @returns Whether `value` is a SelectionRect.
 * @example
 * ```ts
 * isRect({ x: 0, y: 0, w: 10, h: 10 }); // true
 * ```
 */
function isRect(value: unknown): value is SelectionRect {
  return isRecord(value) && RECT_FIELDS.every(field => required(value, field, isFiniteNumber));
}

/**
 * True for a source line: a text path and an integer line.
 *
 * @param value - Anything.
 * @returns Whether `value` is a SelectionInfo source.
 * @example
 * ```ts
 * isSource({ path: "src/ui/hud.ts", line: 42 }); // true
 * ```
 */
function isSource(value: unknown): boolean {
  return (
    isRecord(value) && required(value, "path", isText) && required(value, "line", Number.isInteger)
  );
}

/**
 * True for the fields a SelectionInfo shares with a SelectionItem: ref, name and type present;
 * key, rect and source absent or of their type. Unknown fields are ignored.
 *
 * @param value - A record.
 * @returns Whether `value` has the element fields.
 * @example
 * ```ts
 * hasElementFields({ ref: { kind: "entity", id: 7 }, name: "slime", type: "entity" }); // true
 * ```
 */
function hasElementFields(value: object): boolean {
  return (
    required(value, "ref", isSelectionRef) &&
    required(value, "name", isText) &&
    required(value, "type", isText) &&
    optional(value, "key", isText) &&
    optional(value, "rect", isRect) &&
    optional(value, "source", isSource)
  );
}

/**
 * True for a SelectionItem: one element of an area selection.
 *
 * @param value - Anything.
 * @returns Whether `value` is a SelectionItem.
 * @example
 * ```ts
 * isSelectionItem({ ref: { kind: "ui", path: "a" }, name: "a", type: "text" }); // true
 * ```
 */
function isSelectionItem(value: unknown): value is SelectionItem {
  return isRecord(value) && hasElementFields(value);
}

/**
 * True for an array of SelectionItem.
 *
 * @param value - Anything.
 * @returns Whether `value` is a SelectionItem list.
 * @example
 * ```ts
 * isItemList([]); // true
 * ```
 */
function isItemList(value: unknown): boolean {
  return Array.isArray(value) && value.every(item => isSelectionItem(item));
}

/**
 * True for a style value: a finite number, a string or a boolean. NaN and ±Infinity are wrong:
 * they are null on the wire.
 *
 * @param value - Anything.
 * @returns Whether `value` is a StyleValue.
 * @example
 * ```ts
 * isStyleValue("center"); // true
 * isStyleValue({ top: 30 }); // false
 * ```
 */
function isStyleValue(value: unknown): value is StyleValue {
  return isFiniteNumber(value) || isText(value) || isBoolean(value);
}

/**
 * True for a StyleEdit: a non-empty text path, and a style value in `from` and in `to`.
 *
 * @param value - Anything.
 * @returns Whether `value` is a StyleEdit.
 * @example
 * ```ts
 * isStyleEdit({ path: "minWidth", from: 556, to: 600 }); // true
 * ```
 */
function isStyleEdit(value: unknown): value is StyleEdit {
  return (
    isRecord(value) &&
    required(value, "path", isFilledText) &&
    required(value, "from", isStyleValue) &&
    required(value, "to", isStyleValue)
  );
}

/**
 * True for an array of StyleEdit.
 *
 * @param value - Anything.
 * @returns Whether `value` is a StyleEdit list.
 * @example
 * ```ts
 * isEditList([]); // true
 * ```
 */
function isEditList(value: unknown): boolean {
  return Array.isArray(value) && value.every(edit => isStyleEdit(edit));
}

/**
 * A fresh copy of a ref with its two fields only.
 *
 * @param ref - A checked ref.
 * @returns The copy.
 * @example
 * ```ts
 * refCopy({ kind: "ui", path: "a" }); // { kind: "ui", path: "a" }
 * ```
 */
function refCopy(ref: SelectionRef): SelectionRef {
  return ref.kind === "ui" ? { kind: "ui", path: ref.path } : { kind: "entity", id: ref.id };
}

/**
 * A fresh copy of a rect with its four fields only.
 *
 * @param rect - A checked rect.
 * @returns The copy.
 * @example
 * ```ts
 * rectCopy({ x: 0, y: 0, w: 10, h: 10 }); // { x: 0, y: 0, w: 10, h: 10 }
 * ```
 */
function rectCopy(rect: SelectionRect): SelectionRect {
  return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
}

/**
 * A fresh copy of a checked item with its known fields only; absent fields stay absent.
 *
 * @param item - A checked item (or the element fields of a SelectionInfo).
 * @returns The copy.
 * @example
 * ```ts
 * itemCopy({ ref: { kind: "entity", id: 7 }, name: "slime", type: "entity" });
 * ```
 */
function itemCopy(item: SelectionItem): Writable<SelectionItem> {
  const { ref, key, name, type, rect, source } = item;
  const copy: Writable<SelectionItem> = { ref: refCopy(ref), name, type };

  if (key !== undefined) copy.key = key;
  if (rect !== undefined) copy.rect = rectCopy(rect);
  if (source !== undefined) copy.source = { path: source.path, line: source.line };

  return copy;
}

/**
 * A fresh copy of a checked edit with its three fields only.
 *
 * @param edit - A checked edit.
 * @returns The copy.
 * @example
 * ```ts
 * editCopy({ path: "minWidth", from: 556, to: 600 }); // { path: "minWidth", from: 556, to: 600 }
 * ```
 */
function editCopy(edit: StyleEdit): StyleEdit {
  return { path: edit.path, from: edit.from, to: edit.to };
}

/**
 * True for a SelectionInfo: the ref, name, type and at are present, and every optional field is
 * absent or of its type; an area selection's `area` is a rect and its `items` a list of
 * SelectionItem; `edits` is a list of StyleEdit. Unknown fields are ignored, inside the items and
 * the edits too.
 *
 * @param value - Anything, e.g. the params of an editor-channel `selection` notification.
 * @returns Whether `value` is a SelectionInfo.
 * @example
 * ```ts
 * isSelectionInfo({ ref: { kind: "entity", id: 7 }, name: "slime", type: "entity", at: 1 }); // true
 * isSelectionInfo({ ref: { kind: "entity", id: 7 }, name: "slime" }); // false
 * ```
 */
export function isSelectionInfo(value: unknown): value is SelectionInfo {
  if (!isRecord(value)) return false;

  return (
    hasElementFields(value) &&
    required(value, "at", isFiniteNumber) &&
    TEXT_FIELDS.every(field => optional(value, field, isText)) &&
    optional(value, "frame", Number.isInteger) &&
    optional(value, "area", isRect) &&
    optional(value, "items", isItemList) &&
    optional(value, "edits", isEditList)
  );
}

/**
 * Checks a received selection and copies its known fields; unknown fields, at the top, in the
 * nested ref, rect, source and area, in every item and in every edit, are dropped. A malformed
 * edit makes the whole value wrong, like every other field; an empty `edits` is dropped.
 *
 * @param value - Anything, e.g. the params of a page's `selection` notification.
 * @returns A fresh SelectionInfo, or undefined when `value` is not one.
 * @example
 * ```ts
 * parseSelectionInfo({ ref: { kind: "entity", id: 7 }, name: "slime", type: "entity", at: 1, zoom: 2 });
 * // { ref: { kind: "entity", id: 7 }, name: "slime", type: "entity", at: 1 }
 * parseSelectionInfo({ ...homePlay, edits: [{ path: "minWidth", from: 556, to: { px: 600 } }] });
 * // undefined
 * ```
 */
export function parseSelectionInfo(value: unknown): SelectionInfo | undefined {
  if (!isSelectionInfo(value)) return undefined;

  const { at, frame, area, items, edits } = value;
  const copy: Writable<SelectionInfo> = { ...itemCopy(value), at };

  for (const field of TEXT_FIELDS) {
    const text = value[field];
    if (text !== undefined) copy[field] = text;
  }
  if (frame !== undefined) copy.frame = frame;
  if (area !== undefined) copy.area = rectCopy(area);
  if (items !== undefined) copy.items = items.map(item => itemCopy(item));
  if (edits !== undefined && edits.length > 0) copy.edits = edits.map(edit => editCopy(edit));

  return copy;
}

/**
 * Checks the params of an editor-channel `select` request and copies its known fields. An empty
 * object passes: finding no element is the page's error, not a shape error. `rect` (an area)
 * wins over `key` and `ref`; the page applies that rule, the copy keeps every given field.
 *
 * @param value - The request params.
 * @returns Fresh SelectParams, or undefined when a field has the wrong type.
 * @example
 * ```ts
 * parseSelectParams({ key: "hud/infoBar" }); // { key: "hud/infoBar" }
 * parseSelectParams({ rect: { x: 0, y: 30, w: 200, h: 60, z: 1 } }); // { rect: { x: 0, y: 30, w: 200, h: 60 } }
 * parseSelectParams({ card: "yes" }); // undefined
 * ```
 */
export function parseSelectParams(value: unknown): SelectParams | undefined {
  if (!isRecord(value)) return undefined;

  const fits =
    optional(value, "key", isText) &&
    optional(value, "ref", isSelectionRef) &&
    optional(value, "rect", isRect) &&
    optional(value, "card", isBoolean);

  if (!fits) return undefined;

  const key: unknown = Reflect.get(value, "key");
  const ref: unknown = Reflect.get(value, "ref");
  const rect: unknown = Reflect.get(value, "rect");
  const card: unknown = Reflect.get(value, "card");
  const params: Writable<SelectParams> = {};

  if (isRect(rect)) params.rect = rectCopy(rect);
  if (typeof key === "string") params.key = key;
  if (isSelectionRef(ref)) params.ref = refCopy(ref);
  if (typeof card === "boolean") params.card = card;

  return params;
}

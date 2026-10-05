/**
 * @file Protocol — the checks of the selection wire values (A5, A10): `isSelectionInfo`, and the
 * parsers `parseSelectionInfo` and `parseSelectParams`, which return a fresh copy without the
 * unknown fields. Pure: a value from the wire is narrowed field by field, never cast.
 */
import type { SelectionInfo, SelectionRef, SelectParams } from "./types";

/**
 * A type with every field writable, for building a fresh copy field by field.
 */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * The optional text fields of a SelectionInfo.
 */
const TEXT_FIELDS = [
  "key",
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
function isRect(value: unknown): boolean {
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
 * True for a SelectionInfo: the ref, name, type and at are present, and every optional field is
 * absent or of its type. Unknown fields are ignored.
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
    required(value, "ref", isSelectionRef) &&
    required(value, "name", isText) &&
    required(value, "type", isText) &&
    required(value, "at", isFiniteNumber) &&
    TEXT_FIELDS.every(field => optional(value, field, isText)) &&
    optional(value, "rect", isRect) &&
    optional(value, "source", isSource) &&
    optional(value, "frame", Number.isInteger)
  );
}

/**
 * Checks a received selection and copies its known fields; unknown fields, at the top and in the
 * nested ref, rect and source, are dropped.
 *
 * @param value - Anything, e.g. the params of a page's `selection` notification.
 * @returns A fresh SelectionInfo, or undefined when `value` is not one.
 * @example
 * ```ts
 * parseSelectionInfo({ ref: { kind: "entity", id: 7 }, name: "slime", type: "entity", at: 1, zoom: 2 });
 * // { ref: { kind: "entity", id: 7 }, name: "slime", type: "entity", at: 1 }
 * ```
 */
export function parseSelectionInfo(value: unknown): SelectionInfo | undefined {
  if (!isSelectionInfo(value)) return undefined;

  const { ref, name, type, at, rect, source, frame } = value;
  const copy: Writable<SelectionInfo> = { ref: refCopy(ref), name, type, at };

  for (const field of TEXT_FIELDS) {
    const text = value[field];
    if (text !== undefined) copy[field] = text;
  }
  if (rect !== undefined) copy.rect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  if (source !== undefined) copy.source = { path: source.path, line: source.line };
  if (frame !== undefined) copy.frame = frame;

  return copy;
}

/**
 * Checks the params of an editor-channel `select` request and copies its known fields. An empty
 * object passes: finding no element is the page's error, not a shape error.
 *
 * @param value - The request params.
 * @returns Fresh SelectParams, or undefined when a field has the wrong type.
 * @example
 * ```ts
 * parseSelectParams({ key: "hud/infoBar" }); // { key: "hud/infoBar" }
 * parseSelectParams({ card: "yes" }); // undefined
 * ```
 */
export function parseSelectParams(value: unknown): SelectParams | undefined {
  if (!isRecord(value)) return undefined;

  const fits =
    optional(value, "key", isText) &&
    optional(value, "ref", isSelectionRef) &&
    optional(value, "card", isBoolean);

  if (!fits) return undefined;

  const key: unknown = Reflect.get(value, "key");
  const ref: unknown = Reflect.get(value, "ref");
  const card: unknown = Reflect.get(value, "card");
  const params: Writable<SelectParams> = {};

  if (typeof key === "string") params.key = key;
  if (isSelectionRef(ref)) params.ref = refCopy(ref);
  if (typeof card === "boolean") params.card = card;

  return params;
}

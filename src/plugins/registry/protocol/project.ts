/**
 * @file Protocol — the project index on the wire: the strict parsers of the published
 * `editor.project` state and of a files-channel `find` answer, the delta a view invalidates by,
 * and two key helpers. Pure: a value from the wire is narrowed field by field, never cast, and
 * one bad entry rejects the whole value.
 */
import type { ProjectChange, ProjectDelta, ProjectFound, ProjectMove, ProjectState } from "./types";

/**
 * A type with every field writable, for building a fresh copy field by field.
 */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * The on variant of ProjectState.
 */
type ProjectOn = Extract<ProjectState, { state: "on" }>;

/**
 * The text fields of a Found that may be absent.
 */
const ANCHOR_TEXT_FIELDS = ["binding", "key", "component", "stem"] as const;

/**
 * How a JSX key may be written (the game's `JsxKind`).
 */
const JSX_KINDS: ReadonlySet<unknown> = new Set(["literal", "template", "idProp", "ident"]);

/**
 * True for an object that is neither null nor an array.
 *
 * @param value - Anything.
 * @returns Whether `value` is a record.
 * @example
 * ```ts
 * isRecord({ state: "off" }); // true
 * ```
 */
function isRecord(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True for a string.
 *
 * @param value - Anything.
 * @returns Whether `value` is a string.
 * @example
 * ```ts
 * isText("nodes/merge.ts"); // true
 * ```
 */
function isText(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * True for an array of strings.
 *
 * @param value - Anything.
 * @returns Whether `value` is a string list.
 * @example
 * ```ts
 * isTextList(["flows/board.ts"]); // true
 * ```
 */
function isTextList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => isText(item));
}

/**
 * True for a positive integer: a 1-based line or column.
 *
 * @param value - Anything.
 * @returns Whether `value` is an integer of 1 or more.
 * @example
 * ```ts
 * isPosition(0); // false
 * ```
 */
function isPosition(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1;
}

/**
 * True for one of the four ways a JSX key is written.
 *
 * @param value - Anything.
 * @returns Whether `value` is an anchor kind.
 * @example
 * ```ts
 * isJsxKind("idProp"); // true
 * ```
 */
function isJsxKind(value: unknown): value is NonNullable<ProjectFound["kind"]> {
  return JSX_KINDS.has(value);
}

/**
 * The own field of a record; undefined when absent.
 *
 * @param record - A record.
 * @param name - The field name.
 * @returns The value, unchecked.
 * @example
 * ```ts
 * field({ state: "on" }, "state"); // "on"
 * ```
 */
function field(record: object, name: string): unknown {
  return Object.hasOwn(record, name) ? Reflect.get(record, name) : undefined;
}

/**
 * True when the field is absent or passes the check. A key present with `undefined` is wrong: the
 * types have no `undefined` (exactOptionalPropertyTypes).
 *
 * @param record - A record.
 * @param name - The field name.
 * @param check - The check of the value.
 * @returns Whether the field is absent or right.
 * @example
 * ```ts
 * optional({}, "previous", isText); // true
 * ```
 */
function optional(record: object, name: string, check: (value: unknown) => boolean): boolean {
  return !Object.hasOwn(record, name) || check(Reflect.get(record, name));
}

/**
 * Copies a map of key → value after checking every entry; any bad entry rejects the map. The copy
 * defines own keys, so a key named `__proto__` stays a plain entry.
 *
 * @param value - Anything.
 * @param check - The check of one value.
 * @param copy - The copy of one checked value.
 * @returns A fresh map, or undefined when `value` is not a record or one entry is wrong.
 * @example
 * ```ts
 * mapOf({ "a.ts": "a.ts:1:1 x" }, isText, text => text); // { "a.ts": "a.ts:1:1 x" }
 * ```
 */
function mapOf<T, C>(
  value: unknown,
  check: (entry: unknown) => entry is T,
  copy: (entry: T) => C
): Readonly<Record<string, C>> | undefined {
  if (!isRecord(value)) return undefined;

  const entries: [string, C][] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (!check(entry)) return undefined;
    entries.push([key, copy(entry)]);
  }

  return Object.fromEntries(entries);
}

/**
 * Checks one move and copies its three fields.
 *
 * @param value - Anything.
 * @returns A fresh move, or undefined.
 * @example
 * ```ts
 * moveOf({ key: "node:board/catchUp", from: "nodes/catch-up.ts", to: "nodes/board/catch-up.ts" });
 * ```
 */
function moveOf(value: unknown): ProjectMove | undefined {
  if (!isRecord(value)) return undefined;

  const key = field(value, "key");
  const from = field(value, "from");
  const to = field(value, "to");
  if (!isText(key) || !isText(from) || !isText(to)) return undefined;

  return { key, from, to };
}

/**
 * Checks a list and copies each item; any bad item rejects the list.
 *
 * @param value - Anything.
 * @param copy - The check-and-copy of one item: undefined when wrong.
 * @returns A fresh list, or undefined.
 * @example
 * ```ts
 * listOf([{ key: "k", from: "a.ts", to: "b.ts" }], moveOf); // [{ key: "k", from: "a.ts", to: "b.ts" }]
 * ```
 */
function listOf<T>(value: unknown, copy: (item: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const items: T[] = [];
  for (const item of value) {
    const copied = copy(item);
    if (copied === undefined) return undefined;
    items.push(copied);
  }

  return items;
}

/**
 * Checks the change of a watch batch and copies its three lists; the game's `revision` field and
 * any other unknown field are dropped.
 *
 * @param value - Anything.
 * @returns A fresh change, or undefined.
 * @example
 * ```ts
 * changeOf({ revision: "r2", files: ["nodes/merge.ts"], moved: [], removed: [] });
 * // { files: ["nodes/merge.ts"], moved: [], removed: [] }
 * ```
 */
function changeOf(value: unknown): ProjectChange | undefined {
  if (!isRecord(value)) return undefined;

  const files = field(value, "files");
  const removed = field(value, "removed");
  const moved = listOf(field(value, "moved"), moveOf);
  if (!isTextList(files) || !isTextList(removed) || moved === undefined) return undefined;

  return { files: [...files], moved, removed: [...removed] };
}

/**
 * Checks an on state and copies its known fields.
 *
 * @param value - A record whose `state` is `"on"`.
 * @returns A fresh on state, or undefined when a field is wrong.
 * @example
 * ```ts
 * onStateOf({ state: "on", revision: "r1", defs: {}, uses: {}, broken: {} });
 * ```
 */
function onStateOf(value: object): ProjectOn | undefined {
  const revision = field(value, "revision");
  const defs = mapOf(field(value, "defs"), isTextList, paths => [...paths]);
  const uses = mapOf(field(value, "uses"), isTextList, paths => [...paths]);
  const broken = mapOf(field(value, "broken"), isText, error => error);
  const change = Object.hasOwn(value, "change") ? changeOf(field(value, "change")) : undefined;

  const fits =
    isText(revision) &&
    defs !== undefined &&
    uses !== undefined &&
    broken !== undefined &&
    optional(value, "previous", isText) &&
    optional(value, "manifest", isText) &&
    (!Object.hasOwn(value, "change") || change !== undefined);
  if (!fits) return undefined;

  const state: Writable<ProjectOn> = { state: "on", revision, defs, uses, broken };
  const previous = field(value, "previous");
  const manifest = field(value, "manifest");
  if (isText(previous)) state.previous = previous;
  if (isText(manifest)) state.manifest = manifest;
  if (change !== undefined) state.change = change;

  return state;
}

/**
 * Checks a received project state and copies its known fields. Strict: a bad entry in any map or
 * list rejects the whole value.
 *
 * @param value - Anything, e.g. the params of an editor-channel `project` notification.
 * @returns A fresh ProjectState, or undefined when `value` is not one.
 * @example
 * ```ts
 * parseProjectState({ state: "off", reason: "disabled" }); // { state: "off", reason: "disabled" }
 * parseProjectState({ state: "on", revision: "r1", defs: { "flow:board": "flows/board.ts" }, uses: {}, broken: {} });
 * // undefined: a def is a list of paths
 * ```
 */
export function parseProjectState(value: unknown): ProjectState | undefined {
  if (!isRecord(value)) return undefined;

  const state = field(value, "state");
  if (state === "on") return onStateOf(value);
  if (state !== "off") return undefined;

  const reason = field(value, "reason");
  return isText(reason) ? { state: "off", reason } : undefined;
}

/**
 * Checks a range: four 1-based integers.
 *
 * @param value - Anything.
 * @returns A fresh range, or undefined.
 * @example
 * ```ts
 * rangeOf([300, 5, 318, 7]); // [300, 5, 318, 7]
 * ```
 */
function rangeOf(value: unknown): ProjectFound["range"] | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined;

  const [startLine, startColumn, endLine, endColumn]: unknown[] = value;
  if (!isPosition(startLine) || !isPosition(startColumn)) return undefined;
  if (!isPosition(endLine) || !isPosition(endColumn)) return undefined;

  return [startLine, startColumn, endLine, endColumn];
}

/**
 * Checks one answer of `find` and copies its known fields.
 *
 * @param value - Anything.
 * @returns A fresh answer, or undefined.
 * @example
 * ```ts
 * foundOf({ path: "nodes/merge.ts", binding: "merge", line: 17, range: [17, 1, 30, 3], hash: "a1" });
 * ```
 */
function foundOf(value: unknown): ProjectFound | undefined {
  if (!isRecord(value)) return undefined;

  const path = field(value, "path");
  const line = field(value, "line");
  const hash = field(value, "hash");
  const range = rangeOf(field(value, "range"));

  const fits =
    isText(path) &&
    isPosition(line) &&
    isText(hash) &&
    range !== undefined &&
    ANCHOR_TEXT_FIELDS.every(name => optional(value, name, isText)) &&
    optional(value, "kind", isJsxKind) &&
    optional(value, "broken", broken => broken === true);
  if (!fits) return undefined;

  const found: Writable<ProjectFound> = { path, line, range, hash };
  for (const name of ANCHOR_TEXT_FIELDS) {
    const text = field(value, name);
    if (isText(text)) found[name] = text;
  }
  const kind = field(value, "kind");
  if (isJsxKind(kind)) found.kind = kind;
  if (field(value, "broken") === true) found.broken = true;

  return found;
}

/**
 * Checks the result of a files-channel `find` and copies every answer. Strict: one bad answer
 * rejects the list.
 *
 * @param value - Anything, e.g. the result of a `find` request.
 * @returns A fresh list (empty for a key the index does not know), or undefined.
 * @example
 * ```ts
 * parseFoundList([{ path: "nodes/merge.ts", binding: "merge", line: 17, range: [17, 1, 30, 3], hash: "a1" }]);
 * // the same list, copied
 * parseFoundList([{ path: "nodes/merge.ts", line: 17, range: [17, 1, 30], hash: "a1" }]); // undefined
 * ```
 */
export function parseFoundList(value: unknown): readonly ProjectFound[] | undefined {
  return listOf(value, foundOf);
}

/**
 * What a view drops when `next` arrives after `held`: `all` when either is off, there was no
 * state before, or `next.previous` is not `held.revision` (a gap: reconnect, first state); else
 * the lists of `next.change`, empty when absent.
 *
 * @param held - The state a view holds; undefined before the first.
 * @param next - The state that just arrived.
 * @returns The delta.
 * @example
 * ```ts
 * // An agent edited nodes/merge.ts while the editor was open.
 * projectDelta(held, arrived); // { all: false, files: ["nodes/merge.ts"], moved: [], removed: [] }
 * projectDelta(undefined, arrived); // { all: true, files: [], moved: [], removed: [] }
 * ```
 */
export function projectDelta(held: ProjectState | undefined, next: ProjectState): ProjectDelta {
  const contiguous =
    held?.state === "on" &&
    next.state === "on" &&
    next.previous !== undefined &&
    next.previous === held.revision;

  if (!contiguous) return { all: true, files: [], moved: [], removed: [] };

  const change = next.change;
  return {
    all: false,
    files: change?.files ?? [],
    moved: change?.moved ?? [],
    removed: change?.removed ?? []
  };
}

/**
 * The first def path of a key: the file that defines it (the first one of a conflict).
 *
 * @param state - The project state; undefined before the first.
 * @param key - A project-index key, e.g. `"node:board/merge"`.
 * @returns The path, or undefined when the index is off or does not know the key.
 * @example
 * ```ts
 * // The Flow inspector opens the file of the selected node.
 * firstDefinition(link.project(), "node:board/merge"); // "nodes/merge.ts"
 * ```
 */
export function firstDefinition(state: ProjectState | undefined, key: string): string | undefined {
  if (state?.state !== "on") return undefined;

  return state.defs[key]?.[0];
}

/**
 * The project-index key of a style block: a `defineStyle` const is a `style:` key of its file, a
 * text-style entry a `textStyle:` key of the game.
 *
 * @param ref - The block: `{ kind: "const", name }` or `{ kind: "text", key }`.
 * @param path - The root-relative file the block is in.
 * @returns The key to `find`.
 * @example
 * ```ts
 * anchorKey({ kind: "const", name: "popupScreen" }, "features/ui/popup.tsx");
 * // "style:features/ui/popup.tsx#popupScreen"
 * anchorKey({ kind: "text", key: "ui.number" }, "features/ui/text-styles.ts"); // "textStyle:ui.number"
 * ```
 */
export function anchorKey(
  ref:
    | { readonly kind: "text"; readonly key: string }
    | { readonly kind: "const"; readonly name: string },
  path: string
): string {
  return ref.kind === "const" ? `style:${path}#${ref.name}` : `textStyle:${ref.key}`;
}

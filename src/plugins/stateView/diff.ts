/**
 * @file stateView plugin — the commit diff (pure): JSON Patch shaped patches with the old value
 * between two snapshots of a model root, the pointers they touch, and structural JSON equality.
 * Stands in for the engine's commit patches until game follow-up F-S1 (R4).
 */
import type { Json } from "../registry/protocol";
import { isRecord } from "./model";
import type { ModelSnapshot, StatePatch, StateRoot } from "./types";

/**
 * A path inside a root.
 */
type Path = readonly (string | number)[];

/**
 * Where the walk puts its patches: kept up to max, the rest only counted.
 */
type Collector = {
  readonly root: StateRoot;
  readonly max: number;
  readonly patches: StatePatch[];
  truncated: number;
};

/**
 * What one model diff yields.
 */
type ModelDiff = { patches: StatePatch[]; truncated: number; rngChanged: boolean };

/**
 * Escapes one JSON Pointer segment (RFC 6901): `~` → `~0`, `/` → `~1`.
 *
 * @param segment - A key or an index.
 * @returns The escaped segment.
 * @example
 * ```ts
 * escapeSegment("a/b"); // "a~1b"
 * ```
 */
export function escapeSegment(segment: string | number): string {
  return String(segment).replaceAll("~", "~0").replaceAll("/", "~1");
}

/**
 * The JSON Pointer of a path inside a root, the root included.
 *
 * @param root - "player" or "session".
 * @param path - Keys and indexes inside the root.
 * @returns The pointer.
 * @example
 * ```ts
 * pointerOf("player", ["merge", "energy", "value"]); // "/player/merge/energy/value"
 * ```
 */
export function pointerOf(root: StateRoot, path: Path): string {
  return `/${[root, ...path].map(segment => escapeSegment(segment)).join("/")}`;
}

/**
 * Structural equality of JSON values: arrays by index, objects by key set; `===` first.
 *
 * @param a - A JSON value or undefined.
 * @param b - A JSON value or undefined.
 * @returns Whether both are equal.
 * @example
 * ```ts
 * deepEqual({ a: [1] }, { a: [1] }); // true
 * ```
 */
export function deepEqual(a: Json | undefined, b: Json | undefined): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    return (
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => deepEqual(item, b[index]))
    );
  }
  if (!isRecord(a) || !isRecord(b)) return false;

  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(key => Object.hasOwn(b, key) && deepEqual(a[key], b[key]))
  );
}

/**
 * The values a patch carries: the new value (add, replace), the old one (remove, replace).
 */
type Change = { readonly value?: Json | undefined; readonly was?: Json | undefined };

/**
 * Adds one patch, or only counts it once max patches are kept.
 *
 * @param collector - Where the patches go.
 * @param op - The operation.
 * @param path - The path inside the root.
 * @param change - The new and the old value.
 * @example
 * ```ts
 * emit(collector, "replace", ["merge", "nextItemId"], { value: 4, was: 3 });
 * ```
 */
function emit(collector: Collector, op: StatePatch["op"], path: Path, change: Change): void {
  if (collector.patches.length >= collector.max) {
    collector.truncated += 1;
    return;
  }
  const { root } = collector;
  const { value, was } = change;
  collector.patches.push({
    op,
    root,
    path,
    pointer: pointerOf(root, path),
    ...(value === undefined ? {} : { value }),
    ...(was === undefined ? {} : { was })
  });
}

/**
 * The first index whose removal from `longer` gives `shorter`, when one exists. `longer` has
 * exactly one item more. Linear: the removal at i works when the first i items match and the
 * items after i match shifted by one.
 *
 * @param longer - The array with the extra item.
 * @param shorter - The array without it.
 * @returns The index, or undefined.
 * @example
 * ```ts
 * singleDrop([1, 2, 3], [1, 3]); // 1
 * ```
 */
function singleDrop(longer: readonly Json[], shorter: readonly Json[]): number | undefined {
  let prefix = 0;
  while (prefix < shorter.length && deepEqual(longer[prefix], shorter[prefix])) prefix += 1;

  let start = shorter.length;
  while (start > 0 && deepEqual(longer[start], shorter[start - 1])) start -= 1;

  return start <= prefix ? start : undefined;
}

/**
 * Diffs two objects: keys of `next` in order (add or recurse), then removed keys in the order of
 * `previous`.
 *
 * @param collector - Where the patches go.
 * @param previous - The old object.
 * @param next - The new object.
 * @param path - Path of both objects.
 * @example
 * ```ts
 * walkObject(collector, { a: 1 }, { a: 2, b: 3 }, []);
 * ```
 */
function walkObject(
  collector: Collector,
  previous: { readonly [key: string]: Json },
  next: { readonly [key: string]: Json },
  path: Path
): void {
  for (const [key, value] of Object.entries(next)) {
    const old = Object.hasOwn(previous, key) ? previous[key] : undefined;
    if (old === undefined) emit(collector, "add", [...path, key], { value });
    else walk(collector, old, value, [...path, key]);
  }
  for (const [key, value] of Object.entries(previous)) {
    if (!Object.hasOwn(next, key)) emit(collector, "remove", [...path, key], { was: value });
  }
}

/**
 * Diffs two arrays: one insert or one removal as a single patch, otherwise index-wise with the
 * removals emitted from the highest index down.
 *
 * @param collector - Where the patches go.
 * @param previous - The old array.
 * @param next - The new array.
 * @param path - Path of both arrays.
 * @example
 * ```ts
 * walkArray(collector, [1], [0, 1], ["items"]);
 * ```
 */
function walkArray(
  collector: Collector,
  previous: readonly Json[],
  next: readonly Json[],
  path: Path
): void {
  const inserted = next.length === previous.length + 1 ? singleDrop(next, previous) : undefined;
  if (inserted !== undefined) {
    emit(collector, "add", [...path, inserted], { value: next[inserted] });
    return;
  }
  const removed = previous.length === next.length + 1 ? singleDrop(previous, next) : undefined;
  if (removed !== undefined) {
    emit(collector, "remove", [...path, removed], { was: previous[removed] });
    return;
  }

  const common = Math.min(previous.length, next.length);
  for (const [index, value] of next.entries()) {
    const old = previous[index];
    if (index < common && old !== undefined) walk(collector, old, value, [...path, index]);
    else emit(collector, "add", [...path, index], { value });
  }
  for (let index = previous.length - 1; index >= common; index -= 1) {
    emit(collector, "remove", [...path, index], { was: previous[index] });
  }
}

/**
 * Diffs two JSON values, depth first.
 *
 * @param collector - Where the patches go.
 * @param previous - The old value.
 * @param next - The new value.
 * @param path - Path of both values.
 * @example
 * ```ts
 * walk(collector, { a: 1 }, { a: 2 }, []);
 * ```
 */
function walk(collector: Collector, previous: Json, next: Json, path: Path): void {
  if (deepEqual(previous, next)) return;
  if (isRecord(previous) && isRecord(next)) {
    walkObject(collector, previous, next, path);
  } else if (Array.isArray(previous) && Array.isArray(next)) {
    walkArray(collector, previous, next, path);
  } else {
    emit(collector, "replace", path, { value: next, was: previous });
  }
}

/**
 * The patches that turn `previous` into `next` inside one root, at most `max`; the rest is
 * counted in `truncated`, not built.
 *
 * @param previous - The old root value.
 * @param next - The new root value.
 * @param root - "player" or "session".
 * @param max - Most patches kept.
 * @returns The kept patches in document order and the count of the others.
 * @example
 * ```ts
 * diffJson({ energy: 8 }, { energy: 7 }, "player", 200).patches[0]?.pointer; // "/player/energy"
 * ```
 */
export function diffJson(
  previous: Json,
  next: Json,
  root: StateRoot,
  max: number
): { patches: StatePatch[]; truncated: number } {
  const collector: Collector = { root, max, patches: [], truncated: 0 };
  walk(collector, previous, next, []);
  return { patches: collector.patches, truncated: collector.truncated };
}

/**
 * Diffs two model snapshots: player, then session within what is left of `max`, and whether the
 * rng branch moved.
 *
 * @param previous - The baseline snapshot.
 * @param next - The new snapshot.
 * @param max - Most patches kept over both roots.
 * @returns The patches, the truncated count and rngChanged.
 * @example
 * ```ts
 * diffModel({ player: 1, session: 1 }, { player: 2, session: 1 }, 200).patches.length; // 1
 * ```
 */
export function diffModel(previous: ModelSnapshot, next: ModelSnapshot, max: number): ModelDiff {
  const player = diffJson(previous.player, next.player, "player", max);
  const session = diffJson(
    previous.session,
    next.session,
    "session",
    Math.max(0, max - player.patches.length)
  );
  return {
    patches: [...player.patches, ...session.patches],
    truncated: player.truncated + session.truncated,
    rngChanged: !deepEqual(previous.rng, next.rng)
  };
}

/**
 * Every proper prefix pointer of the patches' pointers, the root pointer included.
 *
 * @param patches - The kept patches.
 * @returns The ancestor pointers.
 * @example
 * ```ts
 * ancestorsOf([{ op: "replace", root: "player", path: ["a", "b"], pointer: "/player/a/b" }]); // Set { "/player", "/player/a" }
 * ```
 */
export function ancestorsOf(patches: readonly StatePatch[]): Set<string> {
  const ancestors = new Set<string>();
  for (const { root, path } of patches) {
    for (let length = 0; length < path.length; length += 1) {
      ancestors.add(pointerOf(root, path.slice(0, length)));
    }
  }
  return ancestors;
}

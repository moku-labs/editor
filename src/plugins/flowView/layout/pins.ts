/**
 * @file flowView layout module — the pins file `.moku/editor/layout.json` (design §7.8): parse,
 * serialize (sorted keys, 2 spaces, trailing newline, unknown keys kept), snap to 12, reset of the
 * visible flows, counts and the conflict merge. Only node positions are read; any other top-level
 * key (an old `notes` field too) is kept as it is.
 */
import type { Json } from "../../registry/protocol";
import type { PinsFile } from "./types";
import { SNAP } from "./types";

/**
 * A plain record.
 */
type Record_ = Readonly<Record<string, unknown>>;

/**
 * True for an object that is neither null nor an array.
 *
 * @param value - Anything.
 * @returns Whether it is a plain record.
 * @example
 * ```ts
 * isRecord({}); // true
 * ```
 */
function isRecord(value: unknown): value is Record_ {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True for a finite number.
 *
 * @param value - Anything.
 * @returns Whether it is a finite number.
 * @example
 * ```ts
 * isNumber(1); // true
 * ```
 */
function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * An empty pins file.
 *
 * @returns `{ version: 1, nodes: {}, extra: {} }`.
 * @example
 * ```ts
 * emptyPins().nodes; // {}
 * ```
 */
export function emptyPins(): PinsFile {
  return { version: 1, nodes: {}, extra: {} };
}

/**
 * Reads the node entries: id → { x, y }.
 *
 * @param value - The `nodes` value.
 * @returns The entries, or undefined when one is malformed.
 * @example
 * ```ts
 * readNodes({ "board/merge": { x: 1, y: 2 } });
 * ```
 */
function readNodes(value: unknown): PinsFile["nodes"] | undefined {
  if (value === undefined) return {};
  if (!isRecord(value)) return undefined;

  const nodes: PinsFile["nodes"] = {};
  for (const [id, pin] of Object.entries(value)) {
    if (!isRecord(pin) || !isNumber(pin.x) || !isNumber(pin.y)) return undefined;
    nodes[id] = { x: pin.x, y: pin.y };
  }
  return nodes;
}

/**
 * Parses layout.json.
 *
 * @param text - The file text.
 * @returns The pins, or undefined for invalid JSON or a wrong shape (the file is then read-only).
 * @example
 * ```ts
 * parsePins('{ "version": 1, "nodes": { "board/merge": { "x": 624, "y": 288 } } }')?.nodes;
 * ```
 */
export function parsePins(text: string): PinsFile | undefined {
  let parsed: Json;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  if (parsed.version !== undefined && parsed.version !== 1) return undefined;

  const nodes = readNodes(parsed.nodes);
  if (nodes === undefined) return undefined;

  const extra: Record<string, Json> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key !== "version" && key !== "nodes" && value !== undefined) extra[key] = value;
  }
  return { version: 1, nodes, extra };
}

/**
 * A copy of a record with its keys sorted.
 *
 * @param record - The record.
 * @returns The sorted copy.
 * @example
 * ```ts
 * sorted({ b: 1, a: 2 }); // { a: 2, b: 1 }
 * ```
 */
function sorted<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).toSorted(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * Serializes the pins: keys sorted, 2-space indent, trailing newline, unknown keys kept.
 *
 * @param pins - The pins.
 * @returns The file text.
 * @example
 * ```ts
 * serializePins(emptyPins()); // '{\n  "nodes": {},\n  "version": 1\n}\n'
 * ```
 */
export function serializePins(pins: PinsFile): string {
  const top: Record<string, Json> = {
    ...pins.extra,
    version: pins.version,
    nodes: sorted(pins.nodes)
  };
  return `${JSON.stringify(sorted(top), undefined, 2)}\n`;
}

/**
 * Rounds to the nearest multiple of 12 (never -0).
 *
 * @param value - A coordinate.
 * @returns The snapped coordinate.
 * @example
 * ```ts
 * snap(17); // 12
 * ```
 */
export function snap(value: number): number {
  return Math.round(value / SNAP) * SNAP || 0;
}

/**
 * The flow of a node id ("board/merge" → "board").
 *
 * @param id - A node id.
 * @returns The flow name.
 * @example
 * ```ts
 * flowOfId("board/merge"); // "board"
 * ```
 */
export function flowOfId(id: string): string {
  const slash = id.indexOf("/");
  return slash === -1 ? id : id.slice(0, slash);
}

/**
 * The pins without the node entries of some flows (Reset layout).
 *
 * @param pins - The pins.
 * @param flows - The visible flows.
 * @returns New pins.
 * @example
 * ```ts
 * resetPins(pins, new Set(["main", "board"])).nodes; // {}
 * ```
 */
export function resetPins(pins: PinsFile, flows: ReadonlySet<string>): PinsFile {
  const nodes = Object.fromEntries(
    Object.entries(pins.nodes).filter(([id]) => !flows.has(flowOfId(id)))
  );
  return { ...pins, nodes };
}

/**
 * The node pins of some flows.
 *
 * @param pins - The pins.
 * @param flows - The visible flows.
 * @returns The count.
 * @example
 * ```ts
 * countPins(pins, new Set(["board"])); // 2
 * ```
 */
export function countPins(pins: PinsFile, flows: ReadonlySet<string>): number {
  return Object.keys(pins.nodes).filter(id => flows.has(flowOfId(id))).length;
}

/**
 * The fresh file with only the changed ids taken from the current pins (set or deleted).
 *
 * @param fresh - The file as it is on disk now.
 * @param current - The pins in memory.
 * @param dirty - Node ids changed since the last save.
 * @returns The merged pins.
 * @example
 * ```ts
 * mergeDirty(fresh, current, new Set(["board/merge"])).nodes["board/merge"]; // { x: 624, y: 288 }
 * ```
 */
export function mergeDirty(
  fresh: PinsFile,
  current: PinsFile,
  dirty: ReadonlySet<string>
): PinsFile {
  const nodes = { ...fresh.nodes };
  for (const id of dirty) {
    const node = current.nodes[id];
    if (node === undefined) delete nodes[id];
    else nodes[id] = node;
  }
  return { ...fresh, nodes };
}

/**
 * @file flowView plugin — the wire values of the Flow panel: parse game.graph, game.position and
 * game.history into structural types (no game import at run time), hash the graph, and ingest a
 * render's values into the state (relayout on a graph change, Follow on a position change, live
 * frames of new history entries).
 */
import { linkPlugin } from "../link";
import type { Json } from "../registry/protocol";
import { actionsOf } from "./actions";
import { setNodeItems } from "./palette";
import { notify } from "./state";
import type {
  FlowCtx,
  FlowValues,
  GraphJson,
  GraphNodeJson,
  HistoryEntryJson,
  PositionJson,
  SlotContribution
} from "./types";

/**
 * JSON null: the payload of an entry without one.
 */
// eslint-disable-next-line unicorn/no-null -- JSON null is a wire value, not an absent one
const JSON_NULL: Json = null;

/**
 * The 32-bit FNV-1a offset basis: the hash of the empty text.
 */
const FNV_OFFSET_BASIS = 0x81_1c_9d_c5;

/**
 * The 32-bit FNV-1a prime.
 */
const FNV_PRIME = 0x01_00_01_93;

/**
 * Radix of the hash text.
 */
const HEX = 16;

/**
 * Hex digits of a 32-bit hash.
 */
const HASH_DIGITS = 8;

/**
 * A plain record.
 */
type Fields = Readonly<Record<string, unknown>>;

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
function isRecord(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True for an array of strings.
 *
 * @param value - Anything.
 * @returns Whether it is a string array.
 * @example
 * ```ts
 * isStrings(["a"]); // true
 * ```
 */
function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

/**
 * True when a field is absent or a string.
 *
 * @param value - The field.
 * @returns Whether it is an optional string.
 * @example
 * ```ts
 * optionalString(undefined); // true
 * ```
 */
function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

/**
 * Reads one graph node.
 *
 * @param value - The wire node.
 * @returns The node, or undefined when malformed.
 * @example
 * ```ts
 * readNode({ flow: "main", node: "boot", rest: false, over: false, checkpoint: false, barrier: false, outcomes: ["ready"] });
 * ```
 */
function readNode(value: unknown): GraphNodeJson | undefined {
  if (!isRecord(value)) return undefined;
  const { flow, node, rest, over, checkpoint, barrier, outcomes } = value;
  const flags = [rest, over, checkpoint, barrier].every(flag => typeof flag === "boolean");
  if (typeof flow !== "string" || typeof node !== "string" || !flags || !isStrings(outcomes)) {
    return undefined;
  }
  const optional = ["scene", "slot", "subFlow", "owner", "file"] as const;
  if (!optional.every(key => optionalString(value[key]))) return undefined;

  const result: GraphNodeJson = {
    flow,
    node,
    rest: rest === true,
    over: over === true,
    checkpoint: checkpoint === true,
    barrier: barrier === true,
    outcomes: [...outcomes]
  };
  for (const key of optional) {
    const field = value[key];
    if (typeof field === "string") result[key] = field;
  }
  return result;
}

/**
 * Reads one flow; on a malformed part returns the field path.
 *
 * @param name - The flow name.
 * @param value - The wire flow.
 * @returns The flow, or the field that is wrong.
 * @example
 * ```ts
 * readFlow("main", { nodes: {}, start: "boot", edges: {} });
 * ```
 */
function readFlow(name: string, value: unknown): GraphJson["flows"][string] | string {
  const field = `flows.${name}`;
  if (!isRecord(value) || typeof value.start !== "string") return field;
  if (!isRecord(value.nodes) || !isRecord(value.edges)) return field;

  const nodes: Record<string, GraphNodeJson> = {};
  for (const [node, raw] of Object.entries(value.nodes)) {
    const parsed = readNode(raw);
    if (parsed === undefined) return `${field}.nodes.${node}`;
    nodes[node] = parsed;
  }
  const edges: Record<string, Record<string, string>> = {};
  for (const [node, raw] of Object.entries(value.edges)) {
    if (!isRecord(raw) || !Object.values(raw).every(target => typeof target === "string")) {
      return `${field}.edges.${node}`;
    }
    edges[node] = Object.fromEntries(
      Object.entries(raw).map(([outcome, target]) => [outcome, String(target)])
    );
  }
  return { nodes, start: value.start, edges };
}

/**
 * Reads one slot contribution.
 *
 * @param value - The wire contribution.
 * @returns The contribution, or undefined when malformed.
 * @example
 * ```ts
 * readContribution({ feature: "reward", flow: "rewardPopup", order: 10, extra: 1 });
 * // { feature: "reward", flow: "rewardPopup", order: 10 }
 * readContribution({ feature: "reward" }); // undefined
 * ```
 */
function readContribution(value: unknown): SlotContribution | undefined {
  if (!isRecord(value)) return undefined;
  const { feature, flow, order } = value;
  if (typeof feature !== "string" || typeof flow !== "string" || typeof order !== "number") {
    return undefined;
  }
  return { feature, flow, order };
}

/**
 * Reads the slots map; on a malformed slot returns its field path.
 *
 * @param value - The wire slots.
 * @returns The slots, or the field that is wrong.
 * @example
 * ```ts
 * readSlots({ afterOrder: [{ feature: "reward", flow: "rewardPopup", order: 10 }] });
 * // { afterOrder: [{ feature: "reward", flow: "rewardPopup", order: 10 }] }
 * readSlots({ afterOrder: [{ feature: "reward" }] }); // "slots.afterOrder"
 * ```
 */
function readSlots(value: unknown): GraphJson["slots"] | string {
  if (!isRecord(value)) return "slots";
  const slots: GraphJson["slots"] = {};
  for (const [slot, raw] of Object.entries(value)) {
    if (!Array.isArray(raw)) return `slots.${slot}`;
    const entries = raw.map(item => readContribution(item));
    if (entries.includes(undefined)) return `slots.${slot}`;
    slots[slot] = entries.filter(item => item !== undefined);
  }
  return slots;
}

/**
 * Parses game.graph; the object key order (the declared order) is kept.
 *
 * @param value - The wire value (a genuine boundary: checked field by field).
 * @returns `{ graph }`, or `{ field }` naming the first malformed field.
 * @example
 * ```ts
 * parseGraph(42); // { field: "graph" }
 * parseGraph({ main: "main" }); // { field: "flows" }
 * ```
 */
export function parseGraph(
  value: unknown
): { readonly graph: GraphJson } | { readonly field: string } {
  if (!isRecord(value)) return { field: "graph" };
  if (typeof value.main !== "string") return { field: "main" };
  if (!isRecord(value.flows)) return { field: "flows" };

  const flows: GraphJson["flows"] = {};
  for (const [name, raw] of Object.entries(value.flows)) {
    const flow = readFlow(name, raw);
    if (typeof flow === "string") return { field: flow };
    flows[name] = flow;
  }
  if (flows[value.main] === undefined) return { field: "main" };
  const slots = readSlots(value.slots);
  if (typeof slots === "string") return { field: slots };
  return { graph: { main: value.main, flows, slots } };
}

/**
 * Parses game.position.
 *
 * @param value - The wire value.
 * @returns The position, or undefined when malformed.
 * @example
 * ```ts
 * parsePosition({ path: "board/awaitIntent", flow: "board", node: "awaitIntent", waiting: ["tap"] });
 * ```
 */
export function parsePosition(value: unknown): PositionJson | undefined {
  if (!isRecord(value) || typeof value.path !== "string" || !isStrings(value.waiting))
    return undefined;
  if (!optionalString(value.flow) || !optionalString(value.node)) return undefined;
  const position: PositionJson = { path: value.path, waiting: [...value.waiting] };
  if (typeof value.flow === "string") position.flow = value.flow;
  if (typeof value.node === "string") position.node = value.node;
  return position;
}

/**
 * A wire value as Json: kept when it is JSON (null, booleans, finite numbers, strings, arrays and
 * plain objects of those), else JSON null.
 *
 * @param value - The wire value.
 * @returns The Json value.
 * @example
 * ```ts
 * jsonOf({ reason: "empty" }); // { reason: "empty" }
 * ```
 */
function jsonOf(value: unknown): Json {
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(item => jsonOf(item));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonOf(item)]));
  }
  return JSON_NULL;
}

/**
 * Reads one history entry.
 *
 * @param value - The wire entry.
 * @returns The entry, or undefined when malformed.
 * @example
 * ```ts
 * readEntry({ index: 1, path: "home", outcome: "play", payload: null, next: "board/awaitIntent", now: 1, hash: "a" });
 * ```
 */
function readEntry(value: unknown): HistoryEntryJson | undefined {
  if (!isRecord(value)) return undefined;
  const { index, path, outcome, payload, next, now, hash, frame } = value;
  if (typeof index !== "number" || typeof now !== "number") return undefined;
  if (typeof path !== "string" || typeof outcome !== "string") return undefined;
  if (typeof next !== "string" || typeof hash !== "string") return undefined;
  if (frame !== undefined && typeof frame !== "number") return undefined;

  const entry: HistoryEntryJson = {
    index,
    path,
    outcome,
    payload: jsonOf(payload),
    next,
    now,
    hash
  };
  if (typeof frame === "number") entry.frame = frame;
  return entry;
}

/**
 * Parses game.history (oldest first).
 *
 * @param value - The wire value.
 * @returns The entries, or undefined when malformed.
 * @example
 * ```ts
 * parseHistory(values.history)?.length; // 20
 * ```
 */
export function parseHistory(value: unknown): readonly HistoryEntryJson[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.map(item => readEntry(item));
  return entries.every(item => item !== undefined)
    ? entries.filter(item => item !== undefined)
    : undefined;
}

/**
 * A stable 32-bit FNV-1a hash as 8 hex digits (the graph hash, the layout cache key).
 *
 * @param text - The text.
 * @returns The hash.
 * @example
 * ```ts
 * hashText("abc"); // "1a47e90b"
 * ```
 */
export function hashText(text: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.codePointAt(index) ?? 0;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(HEX).padStart(HASH_DIGITS, "0");
}

/**
 * Whether a history entry arrived while flowView watched (its frame is taken from the link).
 *
 * @param ctx - Domain context of flowView.
 * @param history - The new entries.
 * @param baseline - False for the first batch (past entries).
 */
function recordFrames(ctx: FlowCtx, history: readonly HistoryEntryJson[], baseline: boolean): void {
  const { frames } = ctx.state.focus;
  const known = new Set(ctx.state.data.history.map(entry => entry.index));
  const status = actionsStatus(ctx);
  if (baseline && status !== undefined) {
    for (const entry of history) {
      if (!known.has(entry.index) && entry.frame === undefined) frames.set(entry.index, status);
    }
  }
  const kept = new Set(history.map(entry => entry.index));
  for (const index of frames.keys()) if (!kept.has(index)) frames.delete(index);
}

/**
 * The frame of the link status when it is live or paused.
 *
 * @param ctx - Domain context of flowView.
 * @returns The frame, or undefined.
 */
function actionsStatus(ctx: FlowCtx): number | undefined {
  const status = ctx.require(linkPlugin).status();
  return status.kind === "live" || status.kind === "paused" ? status.frame : undefined;
}

/**
 * Takes a new graph: a changed hash stores it, replaces the Nodes palette group and asks for a
 * relayout; the first graph also expands the stack.
 *
 * @param ctx - Domain context of flowView.
 * @param values - The panel values.
 * @returns Whether a relayout is needed.
 */
function takeGraph(ctx: FlowCtx, values: FlowValues): boolean {
  const { data } = ctx.state;
  const parsed = parseGraph(values.graph);
  if ("field" in parsed) {
    ctx.log.warn("flowView: game.graph is not a flow graph", { field: parsed.field });
    return false;
  }
  const hash = hashText(JSON.stringify(parsed.graph));
  if (hash === data.graphHash) return false;

  const actions = actionsOf(ctx);
  const first = data.graph === undefined;
  data.graph = parsed.graph;
  data.graphHash = hash;
  if (first) {
    data.position = parsePosition(values.position) ?? data.position;
    actions.layout.expandStack();
  }
  setNodeItems(ctx, actions);
  return true;
}

/**
 * Takes the position and the history (at most historyLast entries; live frames recorded after the
 * first values).
 *
 * @param ctx - Domain context of flowView.
 * @param values - The panel values.
 * @param firstValues - True for the first render's values.
 */
function takeRuntime(ctx: FlowCtx, values: FlowValues, firstValues: boolean): void {
  const { data } = ctx.state;
  const position = parsePosition(values.position);
  if (position === undefined) ctx.log.warn("flowView: game.position is not a position", {});
  else data.position = position;

  const history = parseHistory(values.history);
  if (history === undefined) {
    ctx.log.warn("flowView: game.history is not a history", {});
    return;
  }
  const kept = history.slice(-ctx.config.historyLast);
  recordFrames(ctx, kept, !firstValues);
  data.history = kept;
}

/**
 * Takes a render's values into the state: a changed graph (by hash) relayouts and replaces the
 * Nodes palette group (the first graph also expands the stack); a changed current node moves the
 * camera when Follow is on; new history entries seen live get the link frame (F-H1 rule). An
 * invalid value keeps the last valid one and warns.
 *
 * @param ctx - Domain context of flowView.
 * @param values - The panel values.
 */
export function ingest(ctx: FlowCtx, values: FlowValues): void {
  const actions = actionsOf(ctx);
  const before = actions.focus.current();
  const firstValues = ctx.state.data.graph === undefined;
  const relayout = takeGraph(ctx, values);
  takeRuntime(ctx, values, firstValues);

  if (relayout) actions.layout.relayout().catch(() => {});
  const spot = actions.focus.current() === before ? undefined : actions.focus.locateCurrent();
  if (spot !== undefined && ctx.state.camera.follow) actions.camera.followItem(spot.item);
  notify(ctx.state);
}

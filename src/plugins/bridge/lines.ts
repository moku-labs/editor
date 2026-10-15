/**
 * @file bridge plugin — log shipping in device mode: the recorder's oldest unacknowledged run goes
 * out as `editor`/`perf.lines { log, from, lines }`, at most `linesPerBatch` lines, one batch in
 * flight; every `perf.ack { log, next, n }` is handed to `recorder.ack(log, next)`; a missed ack
 * stalls shipping until the next link. At-least-once: a failure leaves the lines in the recorder,
 * and the hub drops what it already has by index.
 */
import type { Json } from "../registry/protocol";
import { encode, notification } from "../registry/protocol";
import { memberOf } from "./dispatch/params";
import { congested, SOCKET_OPEN, sendText } from "./dispatch/send";
import type { BridgeDeps, BridgeState } from "./types";

/**
 * The end of an encoded `perf.lines` message with an empty `lines` list: `lines` is the last
 * member of the params, the params the last member of the message.
 */
const EMPTY_TAIL = "]}}";

/**
 * The `perf.lines` notification as text, with the recorder's serialized lines spliced into its
 * `lines` list as they are: each is a complete JSON object text, so the hub receives objects and
 * no line is parsed or serialized twice.
 *
 * @param log - The log's file name.
 * @param from - Index of the first line within that log.
 * @param lines - The lines' JSON texts.
 * @returns The message text.
 * @example
 * ```ts
 * JSON.parse(perfLinesText("perf-1.jsonl", 0, ['{"v":1,"kind":"mark","label":"boss"}'])).params.lines[0].label; // "boss"
 * ```
 */
export function perfLinesText(log: string, from: number, lines: readonly string[]): string {
  const empty = encode(notification("editor", "perf.lines", { log, from, lines: [] }));
  return `${empty.slice(0, -EMPTY_TAIL.length)}${lines.join(",")}${EMPTY_TAIL}`;
}

/**
 * Ends the batch in flight without an ack (a failure, a switch, stop): its lines stay unsent in
 * the recorder and go out again after the next link.
 *
 * @param state - The bridge state.
 */
export function dropShipping(state: BridgeState): void {
  if (state.shipping !== undefined) clearTimeout(state.shipping.timer);
  state.shipping = undefined;
}

/**
 * The ack deadline passed: no more shipping on this link (one warning), so a hub that never
 * acks is not fed the same batch forever. The next link step resumes.
 *
 * @param deps - The domain deps.
 */
function onAckDeadline(deps: BridgeDeps): void {
  const { state } = deps;
  const batch = state.shipping;
  if (batch === undefined) return;
  state.shipping = undefined;
  state.shippingStalled = true;
  deps.log.warn("bridge:lines-unacked", {
    address: state.address,
    log: batch.log,
    from: batch.from
  });
}

/**
 * True when the bridge may send a batch now: device mode, open, nothing in flight, not stalled,
 * an open socket that is not congested.
 *
 * @param state - The bridge state.
 * @returns Whether to ask the recorder for a run.
 */
function canShip(state: BridgeState): boolean {
  const { socket } = state;
  if (state.mode !== "device" || state.phase !== "open") return false;
  if (state.shipping !== undefined || state.shippingStalled) return false;
  return socket !== undefined && socket.readyState === SOCKET_OPEN && !congested(socket);
}

/**
 * Sends the recorder's oldest unacknowledged run as one `perf.lines` batch and starts its ack
 * deadline (callTimeoutMs). Called after the link step, on `recorder:status`, on each heartbeat
 * tick and after an ack; returns at once when there is nothing to do.
 *
 * @param deps - The domain deps.
 */
export function shipNext(deps: BridgeDeps): void {
  const { state, config } = deps;
  if (!canShip(state)) return;
  const run = deps.recorder.unsentRun(config.linesPerBatch);
  if (run === undefined || run.lines.length === 0) return;
  if (!sendText(deps, perfLinesText(run.log, run.from, run.lines))) return;

  const timer = setTimeout(() => {
    onAckDeadline(deps);
  }, config.callTimeoutMs);
  state.shipping = { log: run.log, from: run.from, count: run.lines.length, timer };
}

/**
 * A whole number ≥ 0.
 *
 * @param value - A Json member.
 * @returns Whether it is one.
 * @example
 * ```ts
 * isCount(200); // true
 * ```
 */
function isCount(value: Json | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Serves the hub's `perf.ack { log, next, n }`: hands it to `recorder.ack(log, next)` (idempotent
 * and monotonic there, so a late or repeated ack is harmless); when it answers the batch in flight
 * (same log, n = its size) the batch ends and the next one goes out. An ack that ends no batch is
 * logged at debug.
 *
 * @param deps - The domain deps.
 * @param params - The notification's params.
 */
export function onAck(deps: BridgeDeps, params: Json | undefined): void {
  const log = memberOf(params, "log");
  const next = memberOf(params, "next");
  const n = memberOf(params, "n");
  if (typeof log !== "string" || !isCount(next) || !isCount(n)) {
    deps.log.debug("bridge:bad-ack");
    return;
  }
  deps.recorder.ack(log, next);

  const batch = deps.state.shipping;
  if (batch?.log !== log || batch.count !== n) {
    deps.log.debug("bridge:late-ack", { log });
    return;
  }
  dropShipping(deps.state);
  shipNext(deps);
}

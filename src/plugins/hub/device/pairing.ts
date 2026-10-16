/**
 * @file hub plugin — pairing (C4). A pairing socket must send `editor`/`pair` first (a code of
 * exactly four digits and what the phone is). An adb phone under `pairing: "lan"` is confirmed at
 * once; every other pairing waits in a FIFO queue and the CLI's `confirm` is asked one ticket at a
 * time. A confirmed phone gets a device record, `paired { device, token, engine }` and the event
 * `connected`; a refused or timed-out one is closed 1008 and its address cools down for 10 s. The
 * token is never logged.
 */
import type { Message } from "../../registry/protocol";
import { isRequest, isResponse, notification } from "../../registry/protocol";
import { refreshAndPublish } from "../engine";
import { normalizeModel, parsePairParams } from "../protocol";
import { newToken } from "../security/token";
import { sendJson, strike } from "../sockets/send";
import type {
  AgentConn,
  DeviceConn,
  DeviceRecord,
  HubCtx,
  HubState,
  PairConfirm,
  PairRequest,
  PairTicket
} from "../types";
import { deviceIdFrom, emitDevice, linkedDevice } from "./records";

/**
 * How long an address that was refused cannot pair again, in ms.
 */
export const PAIR_COOLDOWN_MS = 10_000;

/**
 * The most paired devices of one device-mode run.
 */
export const MAX_DEVICES = 16;

/**
 * The most pairings waiting for the person at once (the one asked included).
 */
export const MAX_WAITING = 4;

/**
 * How long a pairing socket may stay open without a valid `pair`, in ms; then it closes 1008
 * `pair first`. A phone sends its `pair` right after the socket opens.
 */
export const PAIR_FIRST_MS = 5000;

/**
 * The most open pairing sockets (device sockets not paired yet) per peer address; a pairing
 * upgrade over it is answered 429 (check `cooldown`).
 */
export const MAX_PAIRING_SOCKETS = 4;

/**
 * Policy-violation close code.
 */
const POLICY_VIOLATION = 1008;

/**
 * The engine id `paired` carries before the hub published one.
 */
const UNKNOWN_ENGINE = "unknown";

/**
 * The pending ticket of a socket, asked or queued.
 *
 * @param state - Hub state.
 * @param conn - The connection number.
 * @returns The ticket, or undefined.
 */
function ticketOf(state: HubState, conn: number): PairTicket | undefined {
  const { asking, queue } = state.pairing;
  return asking?.conn === conn ? asking : queue.find(ticket => ticket.conn === conn);
}

/**
 * Removes a ticket from the queue or the asked slot and clears its timer. A ticket in neither
 * leaves both alone.
 *
 * @param state - Hub state.
 * @param ticket - The ticket.
 */
export function forget(state: HubState, ticket: PairTicket): void {
  clearTimeout(ticket.timer);
  const { pairing } = state;
  if (pairing.asking === ticket) {
    pairing.asking = undefined;
    return;
  }
  const index = pairing.queue.indexOf(ticket);
  if (index !== -1) pairing.queue.splice(index, 1);
}

/**
 * Starts the first-message deadline of a pairing socket: without a valid `pair` within
 * PAIR_FIRST_MS it closes 1008 `pair first`. The timer does not keep the process alive.
 *
 * @param conn - The pairing connection.
 * @param device - Its device side.
 */
export function armPairDeadline(conn: AgentConn, device: DeviceConn): void {
  const timer = setTimeout(() => {
    device.deadline = undefined;
    conn.socket.close(POLICY_VIOLATION, "pair first");
  }, PAIR_FIRST_MS);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
  device.deadline = timer;
}

/**
 * Clears the first-message deadline of a device connection, if any.
 *
 * @param device - The device side of the connection.
 */
export function clearPairDeadline(device: DeviceConn): void {
  if (device.deadline !== undefined) clearTimeout(device.deadline);
  device.deadline = undefined;
}

/**
 * The open pairing sockets (device connections not paired yet) of a peer address.
 *
 * @param state - Hub state.
 * @param address - The peer address.
 * @returns How many are open.
 */
export function pairingSocketsOf(state: HubState, address: string): number {
  let count = 0;
  for (const conn of state.conns.values()) {
    const device = conn.kind === "agent" ? conn.device : undefined;
    if (device?.id === undefined && device?.address === address) count += 1;
  }
  return count;
}

/**
 * Pairs a phone: a device record with a fresh id and token, the connection becomes paired, the
 * phone gets `paired { device, token, engine }`, `connected` is emitted and the computer's engine
 * is refreshed through files. Logged `hub:paired` without the token.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The pairing connection.
 * @param request - What the phone sent.
 */
function confirmPairing(ctx: HubCtx, conn: AgentConn, request: PairRequest): void {
  const { state } = ctx;
  const id = deviceIdFrom(state.devices);
  const token = newToken();
  const record: DeviceRecord = {
    id,
    token,
    model: request.model,
    link: request.link,
    address: request.address,
    engine: request.engine,
    build: request.build,
    ...(request.appId === undefined ? {} : { appId: request.appId }),
    pairedAt: Date.now(),
    conn: conn.conn,
    logs: new Map(),
    // eslint-disable-next-line unicorn/no-null -- null is "no pong yet" on LinkedDevice.latencyMs
    latencyMs: null
  };
  state.devices.set(id, record);
  if (conn.device !== undefined) conn.device.id = id;

  const engine = state.engineId ?? UNKNOWN_ENGINE;
  sendJson(conn, notification("editor", "paired", { device: id, token, engine }));
  ctx.log.info("hub:paired", { id, model: request.model, link: request.link });
  emitDevice(ctx, { kind: "connected", device: linkedDevice(state, record) });
  void refreshAndPublish(ctx);
}

/**
 * Refuses a pairing: the socket closes 1008 with the reason and the address cools down.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The pairing connection.
 * @param request - What the phone sent.
 * @param reason - "pairing refused" or "pairing timed out".
 */
function refusePairing(ctx: HubCtx, conn: AgentConn, request: PairRequest, reason: string): void {
  ctx.state.pairing.cooldown.set(request.address, Date.now() + PAIR_COOLDOWN_MS);
  ctx.log.info("hub:pair-refused", { address: request.address, model: request.model });
  conn.socket.close(POLICY_VIOLATION, reason);
}

/**
 * The person's answer: true pairs. A throw or a rejection is a refusal, logged `hub:pair-failed`
 * unless the question was aborted meanwhile.
 *
 * @param ctx - Domain context of the hub.
 * @param confirm - The CLI's callback.
 * @param ticket - The ticket asked.
 * @returns Whether the person confirmed.
 */
async function answerOf(ctx: HubCtx, confirm: PairConfirm, ticket: PairTicket): Promise<boolean> {
  try {
    return (await confirm(ticket.request, ticket.abort.signal)) === true;
  } catch (error) {
    if (!ticket.abort.signal.aborted) ctx.log.warn("hub:pair-failed", { error: String(error) });
    return false;
  }
}

/**
 * Asks the person about one ticket and acts on the answer, then asks about the next. An answer
 * that comes after the question was aborted (the phone left, the wait ran out, device mode
 * stopped) changes nothing.
 *
 * @param ctx - Domain context of the hub.
 * @param confirm - The CLI's callback.
 * @param ticket - The ticket asked.
 */
async function ask(ctx: HubCtx, confirm: PairConfirm, ticket: PairTicket): Promise<void> {
  const yes = await answerOf(ctx, confirm, ticket);
  if (ticket.abort.signal.aborted) return;

  forget(ctx.state, ticket);
  // The socket is open: its close would have aborted the question.
  const conn = ctx.state.conns.get(ticket.conn);
  if (conn?.kind === "agent" && yes) confirmPairing(ctx, conn, ticket.request);
  else if (conn?.kind === "agent") refusePairing(ctx, conn, ticket.request, "pairing refused");
  askNext(ctx);
}

/**
 * Asks the person about the next waiting ticket when nobody is being asked: a terminal asks one
 * question at a time.
 *
 * @param ctx - Domain context of the hub.
 */
function askNext(ctx: HubCtx): void {
  const { pairing, confirm } = ctx.state;
  if (pairing.asking !== undefined || confirm === undefined) return;

  const ticket = pairing.queue.shift();
  if (ticket === undefined) return;

  pairing.asking = ticket;
  void ask(ctx, confirm, ticket);
}

/**
 * The wait of a ticket ran out: its question is aborted, the socket closes 1008 `pairing timed
 * out` and the address cools down.
 *
 * @param ctx - Domain context of the hub.
 * @param ticket - The ticket.
 */
function timeOut(ctx: HubCtx, ticket: PairTicket): void {
  ticket.abort.abort();
  forget(ctx.state, ticket);
  const conn = ctx.state.conns.get(ticket.conn);
  if (conn?.kind === "agent") refusePairing(ctx, conn, ticket.request, "pairing timed out");
  askNext(ctx);
}

/**
 * Queues a ticket for the person, with its timer of `pairTimeoutMs`, and asks when nobody is
 * being asked.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The pairing connection number.
 * @param request - What the phone sent.
 */
function enqueue(ctx: HubCtx, conn: number, request: PairRequest): void {
  const ticket: PairTicket = {
    conn,
    request,
    abort: new AbortController(),
    timer: setTimeout(() => timeOut(ctx, ticket), ctx.config.pairTimeoutMs)
  };
  ctx.state.pairing.queue.push(ticket);
  askNext(ctx);
}

/**
 * True for a full house: 16 paired devices, or 4 pairings waiting for the person.
 *
 * @param state - Hub state.
 * @returns Whether a new pairing is refused `pairing busy`.
 */
function isBusy(state: HubState): boolean {
  const { pairing } = state;
  const waiting = pairing.queue.length + (pairing.asking === undefined ? 0 : 1);

  return state.devices.size >= MAX_DEVICES || waiting >= MAX_WAITING;
}

/**
 * One message of a pairing socket (a device connection without an id). Anything but an
 * `editor`/`pair` notification closes it 1008 `pair first`; malformed params or a second `pair`
 * while one waits are a strike (the first-message deadline keeps running); a full house closes
 * 1008 `pairing busy`. A valid `pair` clears the deadline: an adb phone under `pairing: "lan"`
 * pairs at once; every other phone waits for the person.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The pairing connection.
 * @param device - Its device side.
 * @param message - The decoded message.
 */
export function onPairingMessage(
  ctx: HubCtx,
  conn: AgentConn,
  device: DeviceConn,
  message: Message
): void {
  if (
    isResponse(message) ||
    isRequest(message) ||
    message.channel !== "editor" ||
    message.method !== "pair"
  ) {
    conn.socket.close(POLICY_VIOLATION, "pair first");
    return;
  }

  const { state } = ctx;
  const params = parsePairParams(message.params);
  if (params === undefined || ticketOf(state, conn.conn) !== undefined) {
    strike(conn);
    return;
  }
  if (isBusy(state)) {
    conn.socket.close(POLICY_VIOLATION, "pairing busy");
    return;
  }
  clearPairDeadline(device);

  const request: PairRequest = {
    code: params.code,
    model: normalizeModel(params.device.model),
    address: device.address,
    link: device.link,
    // eslint-disable-next-line unicorn/no-null -- null is "not reported" on PairRequest
    engine: params.device.engine ?? null,
    // eslint-disable-next-line unicorn/no-null -- null is "not reported" on PairRequest
    build: params.device.build ?? null,
    ...(params.device.appId === undefined ? {} : { appId: params.device.appId })
  };
  if (request.link === "adb" && ctx.config.pairing === "lan") confirmPairing(ctx, conn, request);
  else enqueue(ctx, conn.conn, request);
}

/**
 * A pairing socket closed: its question, asked or queued, is aborted (a late answer pairs
 * nothing) and the next one is asked. Nothing is emitted and no cooldown starts.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The connection number.
 */
export function abortPairing(ctx: HubCtx, conn: number): void {
  const ticket = ticketOf(ctx.state, conn);
  if (ticket === undefined) return;

  ticket.abort.abort();
  forget(ctx.state, ticket);
  askNext(ctx);
}

/**
 * Aborts every pending pairing and clears its timer (device mode off). State only: it neither
 * logs nor emits.
 *
 * @param state - Hub state.
 */
export function abortAllPairings(state: HubState): void {
  const { pairing } = state;
  const tickets = pairing.asking === undefined ? pairing.queue : [pairing.asking, ...pairing.queue];
  for (const ticket of tickets) {
    clearTimeout(ticket.timer);
    ticket.abort.abort();
  }
  pairing.queue = [];
  pairing.asking = undefined;
}

/**
 * @file connect plugin — the pairing confirm connect supplies to the hub (spec 11 C3). Each phone
 * that asks to link gets a ticket "p-" + 4 hex and waits in `asking` (FIFO); the directory shows it
 * without its code. The person types the code the phone shows into the tools page; connect compares
 * it here. The question ends on the answer, on a refusal, or when the hub's signal aborts (the
 * phone left, the wait ran out, device mode stopped); the ticket leaves `asking` every time. The
 * code is never published and never logged.
 */
import type { PairConfirm } from "../../hub/types";
import { errorCode, wireError } from "../../registry/protocol";
import { refreshDirectory } from "../directory";
import type { AskRecord, ConnectCtx, ConnectState } from "../types";

/**
 * A ticket no pairing asking has.
 *
 * @param state - The state.
 * @returns "p-" and 4 hex characters.
 */
function newTicket(state: ConnectState): string {
  for (;;) {
    const ticket = `p-${crypto.randomUUID().slice(0, 4)}`;
    if (!state.asking.some(record => record.ticket === ticket)) return ticket;
  }
}

/**
 * The pairing asking with a ticket.
 *
 * @param state - The state.
 * @param ticket - The ticket.
 * @returns The record.
 * @throws {Error} -32602 `no_ticket` when no pairing waits with it.
 */
function askOf(state: ConnectState, ticket: string): AskRecord {
  const record = state.asking.find(item => item.ticket === ticket);
  if (record !== undefined) return record;
  throw wireError(
    errorCode.invalidInput,
    `connect: no pairing waits with ticket ${ticket}.\n  It ended: answered, the phone left, or the wait ran out.`,
    { reason: "no_ticket", retryable: false, id: ticket, field: "ticket" }
  );
}

/**
 * The confirm connect passes to `hub.listenDevices`: each request waits in `asking` until the
 * person answers it in the tools page, or the hub aborts it. After onStop it answers false at once.
 *
 * @param ctx - Domain context of connect.
 * @returns The PairConfirm.
 */
export function createPairConfirm(ctx: ConnectCtx): PairConfirm {
  return (request, signal) =>
    new Promise<boolean>(resolve => {
      const { state } = ctx;
      if (state.stopped || signal.aborted) {
        resolve(false);
        return;
      }
      let settled = false;
      const record: AskRecord = {
        ticket: newTicket(state),
        request,
        since: Date.now(),
        settle: paired => {
          if (settled) return;
          settled = true;
          const index = state.asking.indexOf(record);
          if (index !== -1) state.asking.splice(index, 1);
          resolve(paired);
        }
      };
      state.asking.push(record);
      signal.addEventListener(
        "abort",
        () => {
          record.settle(false);
          refreshDirectory(ctx);
        },
        { once: true }
      );
      refreshDirectory(ctx);
    });
}

/**
 * Answers a waiting pairing with the code the person typed: it pairs when the code, trimmed, is
 * the one the phone shows; else the hub refuses the phone (it cools down 10 s). Logged
 * `connect:pair-answer { ticket, model, paired }`, never the code.
 *
 * @param ctx - Domain context of connect.
 * @param ticket - The ticket of the pairing.
 * @param code - What the person typed.
 * @returns Whether the phone pairs.
 * @throws {Error} -32602 `no_ticket` when no pairing waits with the ticket.
 */
export function answerPairing(ctx: ConnectCtx, ticket: string, code: string): boolean {
  const record = askOf(ctx.state, ticket);
  const paired = code.trim() === record.request.code;
  ctx.log.info("connect:pair-answer", { ticket, model: record.request.model, paired });
  record.settle(paired);
  refreshDirectory(ctx);
  return paired;
}

/**
 * Refuses a waiting pairing.
 *
 * @param ctx - Domain context of connect.
 * @param ticket - The ticket of the pairing.
 * @throws {Error} -32602 `no_ticket` when no pairing waits with the ticket.
 */
export function refusePairing(ctx: ConnectCtx, ticket: string): void {
  const record = askOf(ctx.state, ticket);
  ctx.log.info("connect:pair-answer", { ticket, model: record.request.model, paired: false });
  record.settle(false);
  refreshDirectory(ctx);
}

/**
 * Answers every waiting pairing false (device mode stopped, or onStop). Logs nothing.
 *
 * @param state - The state.
 */
export function clearAsking(state: ConnectState): void {
  for (const record of state.asking.splice(0)) record.settle(false);
}

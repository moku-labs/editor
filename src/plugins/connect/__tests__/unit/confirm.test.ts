/* eslint-disable sonarjs/no-hardcoded-ip -- the LAN address of the fixture phone */
import { describe, expect, it } from "vitest";
import type { PairRequest } from "../../../hub/types";
import { currentDirectory } from "../../directory";
import { answerPairing, createPairConfirm, refusePairing } from "../../pairing/confirm";
import { createCtx, publishedOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// spec 11 C3: the pairing confirm connect supplies to the hub. The code the
// phone shows is compared in connect; it never reaches a tools page or a log.
// Bug: the code sent to every tools page, so anyone who sees the panel can
// pair a stranger's phone.
// ─────────────────────────────────────────────────────────────────────────────

/** A LAN phone asking to link. */
const REQUEST: PairRequest = {
  code: "4821",
  model: "SM-A256B",
  address: "192.168.1.23",
  link: "lan",
  engine: "0.15.0+9c41e0",
  build: "debug-20261016T090000Z"
};

/**
 * Asks the confirm of a fresh ctx once.
 *
 * @returns The ctx, the answer, the abort and the ticket.
 */
function ask() {
  const ctx = createCtx();
  const abort = new AbortController();
  const answer = createPairConfirm(ctx)(REQUEST, abort.signal);
  const ticket = ctx.state.asking[0]?.ticket ?? "";
  return { ctx, answer, abort, ticket };
}

describe("the pairing confirm", () => {
  it("pairs on the right typed code and the ticket leaves asking", async () => {
    const { ctx, answer, ticket } = ask();
    expect(ticket).toMatch(/^p-[\da-f]{4}$/);

    expect(answerPairing(ctx, ticket, " 4821 ")).toBe(true);
    await expect(answer).resolves.toBe(true);
    expect(ctx.state.asking).toEqual([]);
  });

  it("refuses a wrong code, and refuses on refuse", async () => {
    const wrong = ask();
    expect(answerPairing(wrong.ctx, wrong.ticket, "1234")).toBe(false);
    await expect(wrong.answer).resolves.toBe(false);

    const refused = ask();
    refusePairing(refused.ctx, refused.ticket);
    await expect(refused.answer).resolves.toBe(false);
    expect(refused.ctx.state.asking).toEqual([]);
  });

  it("removes the ticket and answers false when the hub aborts the question", async () => {
    const { ctx, answer, abort } = ask();
    abort.abort();
    await expect(answer).resolves.toBe(false);
    expect(ctx.state.asking).toEqual([]);
  });

  it("publishes the asking phone without its code, and logs the answer without it", async () => {
    const { ctx, answer, ticket } = ask();
    const [directory] = publishedOf(ctx.hub, "devices");
    expect(directory?.asking).toEqual([
      {
        ticket,
        model: "SM-A256B",
        address: "192.168.1.23",
        link: "lan",
        engine: "0.15.0+9c41e0",
        build: "debug-20261016T090000Z",
        since: expect.any(Number)
      }
    ]);

    const asked = JSON.stringify(currentDirectory(ctx));
    answerPairing(ctx, ticket, "4821");
    await answer;
    expect(ctx.log.info).toHaveBeenCalledWith("connect:pair-answer", {
      ticket,
      model: "SM-A256B",
      paired: true
    });
    const everything = JSON.stringify([ctx.hub.published, ctx.log.info.mock.calls]) + asked;
    expect(everything).not.toContain("4821");
  });

  it("answers -32602 for a ticket it does not know", () => {
    const { ctx } = ask();
    expect(() => answerPairing(ctx, "p-0000", "4821")).toThrow(
      expect.objectContaining({
        code: -32_602,
        data: { reason: "no_ticket", retryable: false, id: "p-0000", field: "ticket" }
      })
    );
    expect(() => refusePairing(ctx, "p-0000")).toThrow(expect.objectContaining({ code: -32_602 }));
  });

  it("answers false at once after the plugin stopped", async () => {
    const ctx = createCtx();
    ctx.state.stopped = true;
    await expect(createPairConfirm(ctx)(REQUEST, new AbortController().signal)).resolves.toBe(
      false
    );
    expect(ctx.state.asking).toEqual([]);
  });
});

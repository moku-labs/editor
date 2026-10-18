import { describe, expect, it } from "vitest";
import { CDP_ALLOWED, connectCdp } from "../../cdp/client";
import { fakeCdp } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// spec 11 C5.5: the CDP client sends only the allowlisted read methods.
// Bug: the editor executing code in the player's game, or changing its timing.
// ─────────────────────────────────────────────────────────────────────────────

/** The refusal of a method. */
const REFUSED =
  /^\[moku-editor\] connect: CDP method Runtime\.evaluate is not allowed\.\n {2}The editor reads the device only\.$/;

/** The URL of the fake target. */
const URL = "ws://127.0.0.1:40211/devtools/page/7";

/**
 * Opens a client over a fake socket.
 *
 * @param gcTrace - Whether Tracing is allowed.
 * @returns The client and the fake socket.
 */
async function open(gcTrace = false) {
  const cdp = fakeCdp();
  const client = await connectCdp(cdp.open, URL, {
    gcTrace,
    timeoutMs: 1000,
    onClose: () => undefined
  });
  const socket = cdp.sockets[0];
  if (socket === undefined) throw new Error("no socket");
  return { client, socket };
}

describe("the CDP client", () => {
  it("throws for Runtime.evaluate and writes nothing to the socket", async () => {
    const { client, socket } = await open();
    expect(() => client.send("Runtime.evaluate")).toThrow(REFUSED);
    for (const method of [
      "Debugger.enable",
      "Page.reload",
      "HeapProfiler.collectGarbage",
      "Runtime.enable"
    ]) {
      expect(() => client.send(method)).toThrow(/is not allowed/);
    }
    expect(socket.sent).toEqual([]);
  });

  it("writes one message per allowed method and resolves with its result", async () => {
    const { client, socket } = await open();
    const answers = CDP_ALLOWED.map(method => client.send(method));
    expect(socket.sent.map(text => JSON.parse(text))).toEqual(
      CDP_ALLOWED.map((method, index) => ({ id: index + 1, method }))
    );

    socket.answer("Runtime.getHeapUsage", { usedSize: 1, totalSize: 2 });
    await expect(answers[0]).resolves.toEqual({ usedSize: 1, totalSize: 2 });
    socket.events.onMessage(JSON.stringify({ id: 2, error: { code: -32_601, message: "nope" } }));
    await expect(answers[1]).rejects.toThrow("nope");
    client.close();
    await Promise.allSettled(answers);
  });

  it("refuses Tracing.start unless gcTrace", async () => {
    const plain = await open(false);
    expect(() => plain.client.send("Tracing.start")).toThrow(/Tracing\.start is not allowed/);
    const traced = await open(true);
    const tracing = [traced.client.send("Tracing.start"), traced.client.send("Tracing.end")];
    expect(traced.socket.sent).toHaveLength(2);
    traced.client.close();
    await Promise.allSettled(tracing);
  });

  it("rejects the pending calls when the socket closes, and reports the close", async () => {
    const cdp = fakeCdp();
    let closes = 0;
    const client = await connectCdp(cdp.open, URL, {
      gcTrace: false,
      timeoutMs: 1000,
      onClose: () => {
        closes += 1;
      }
    });
    const pending = client.send("Runtime.getHeapUsage");
    cdp.sockets[0]?.events.onClose();
    await expect(pending).rejects.toThrow(/closed/);
    expect(client.closed()).toBe(true);
    expect(closes).toBe(1);
    await expect(client.send("Runtime.getHeapUsage")).rejects.toThrow(/closed/);
  });

  it("rejects a socket that never opens", async () => {
    const never = fakeCdp();
    never.open.mockImplementation(() => ({ send: () => undefined, close: () => undefined }));
    await expect(
      connectCdp(never.open, URL, { gcTrace: false, timeoutMs: 20, onClose: () => undefined })
    ).rejects.toThrow(/did not open/);
  });
});

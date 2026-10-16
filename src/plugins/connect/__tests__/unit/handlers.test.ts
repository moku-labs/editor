/* eslint-disable unicorn/no-null -- null is "none" on the wire */
/* eslint-disable sonarjs/no-hardcoded-ip -- the LAN address of the fixture phone */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPairConfirm } from "../../pairing/confirm";
import { createAttachRecord } from "../../state";
import { a26Device, createCtx, LISTEN, publishedOf, SERIAL } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// spec 11 C2, C8: the one hub:device handler — device mode on (owner other
// when connect did not cause it), a device left, device mode stopped.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the hub:device hook", () => {
  it("marks a device mode connect did not turn on as other's and starts the scan", async () => {
    const ctx = createCtx();
    ctx.hub.emit({ kind: "listening", listen: LISTEN });
    expect(ctx.state.mode).toEqual({ on: true, owner: "other", listen: LISTEN });

    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.run.calls()[0]).toEqual(["devices", "-l"]);
    expect(publishedOf(ctx.hub, "devices").at(-1)?.confirmIn).toBe("terminal");

    ctx.hub.emit({ kind: "listening", listen: { ...LISTEN, lan: "192.168.1.5:47600" } });
    expect(ctx.state.mode.listen?.lan).toBe("192.168.1.5:47600");
    expect(ctx.state.mode.owner).toBe("other");
  });

  it("detaches the telemetry of a device that left, and forgets everything when device mode stops", async () => {
    const ctx = createCtx();
    ctx.hub.emit({ kind: "listening", listen: LISTEN });
    const attach = createAttachRecord("d-7f3a", SERIAL, null);
    ctx.state.attaches.set("d-7f3a", attach);
    const waiting = createPairConfirm(ctx)(
      {
        code: "4821",
        model: null,
        address: "192.168.1.23",
        link: "lan",
        engine: null,
        build: null
      },
      new AbortController().signal
    );

    ctx.hub.emit({ kind: "closed", device: a26Device({ online: false }), reason: "lost" });
    expect(attach.ended).toBe(true);
    expect(ctx.state.attaches.size).toBe(0);

    ctx.state.attaches.set("d-9c1b", createAttachRecord("d-9c1b", SERIAL, null));
    ctx.hub.emit({ kind: "stopped" });
    await expect(waiting).resolves.toBe(false);
    expect(ctx.state.mode).toEqual({ on: false, owner: null, listen: null });
    expect(ctx.state.attaches.size).toBe(0);
    expect(ctx.state.asking).toEqual([]);
    await vi.advanceTimersByTimeAsync(300);
    expect(publishedOf(ctx.hub, "devices").at(-1)).toMatchObject({
      mode: { on: false },
      asking: []
    });
  });

  it("does nothing after onStop", () => {
    const ctx = createCtx();
    ctx.state.stopped = true;
    ctx.hub.emit({ kind: "listening", listen: LISTEN });
    expect(ctx.state.mode.on).toBe(false);
    expect(ctx.hub.published).toEqual([]);
  });
});

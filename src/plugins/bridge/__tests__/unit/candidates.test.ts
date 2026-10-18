import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { candidatesOf, startCandidatesAt } from "../../connection/device";
import { connect } from "../../connection/loop";
import { DEFAULT_DEVICE_ADDRESS } from "../../types";
import { deviceDeps, editorNote, LAN, socketOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Delta 2026-10-18: a device tries its candidates in turn while none answers —
// the address it last linked at, the wire, the other remembered computers.
// ─────────────────────────────────────────────────────────────────────────────

/** Another computer the phone paired with once. */
const OFFICE = "10.0.0.7:47600";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("candidatesOf", () => {
  it("puts the LAN address first, the wire second, the other remembered newest first, each once", () => {
    // Bug on the A26: after a LAN pairing the wire was never tried again.
    const remembered = {
      v: 1 as const,
      last: LAN,
      links: {
        [OFFICE]: { device: "d1", token: "t1" },
        [LAN]: { device: "d2", token: "t2" }
      }
    };
    expect(candidatesOf(LAN, remembered)).toEqual([LAN, DEFAULT_DEVICE_ADDRESS, OFFICE]);
  });

  it("adds no wire after a loopback address, which is a wire already", () => {
    // Bug: a phone on 127.0.0.1:<port> dialling another local port of the computer.
    expect(candidatesOf("127.0.0.1:4100", { v: 1, last: undefined, links: {} })).toEqual([
      "127.0.0.1:4100"
    ]);
  });
});

describe("rotation", () => {
  it("a dial that never opened moves the next one to the next candidate and wraps round", async () => {
    // Bug: the phone stuck on a dead LAN address while the cable is in.
    const deps = deviceDeps(LAN);
    startCandidatesAt(deps.state, LAN);

    await connect(deps);
    socketOf(deps, 0).emit("close", { code: 1006 });
    expect(deps.state.address).toBe(DEFAULT_DEVICE_ADDRESS);
    await vi.runOnlyPendingTimersAsync();
    expect(deps.net.sockets[1]?.url).toContain(DEFAULT_DEVICE_ADDRESS);

    socketOf(deps, 1).emit("close", { code: 1006 });
    expect(deps.state.address).toBe(LAN);
  });

  it("a socket that opened and closed does not rotate (the person may be typing its code)", async () => {
    // Bug: the pairing code on the phone moving to another address mid-typing.
    const deps = deviceDeps(LAN);
    startCandidatesAt(deps.state, LAN);

    await connect(deps);
    socketOf(deps, 0).open();
    socketOf(deps, 0).emit("close", { code: 1008, reason: "pairing timed out" });

    expect(deps.state.address).toBe(LAN);
  });

  it("the address a session opened on becomes the remembered last one and the first candidate", async () => {
    // Bug: the next launch dialling the dead LAN address first again.
    const deps = deviceDeps(LAN);
    startCandidatesAt(deps.state, LAN);
    deps.state.remembered = {
      v: 1,
      last: LAN,
      links: { [DEFAULT_DEVICE_ADDRESS]: { device: "d1", token: "t1" } }
    };
    await connect(deps);
    socketOf(deps, 0).emit("close", { code: 1006 });
    await vi.runOnlyPendingTimersAsync();

    const wire = socketOf(deps, 1);
    wire.open();
    wire.emit("message", { data: editorNote("session", { id: "s-1", open: true }) });

    expect(deps.state.remembered.last).toBe(DEFAULT_DEVICE_ADDRESS);
    expect(deps.state.candidates[0]).toBe(DEFAULT_DEVICE_ADDRESS);
  });
});

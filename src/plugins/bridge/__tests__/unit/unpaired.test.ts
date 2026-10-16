import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect } from "../../connection/loop";
import { PAIRING_STORE_KEY } from "../../types";
import { deviceDeps, editorNote, flush, LAN, socketOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// 4401 `unpaired`: the hub does not know the device id or token. The bridge
// drops them and pairs on the next socket at once; a socket that never opened
// keeps them and backs off.
// ─────────────────────────────────────────────────────────────────────────────

/** Another remembered computer. */
const OFFICE = "10.0.0.7:47600";

/** The device's credentials at LAN and at OFFICE. */
const LINKS = {
  [LAN]: { device: "d-7f3a", token: "dead-token" },
  [OFFICE]: { device: "d-0001", token: "office-token" }
};

/**
 * Device deps with credentials for LAN and OFFICE, in memory and in the store.
 *
 * @returns The deps.
 */
function credentialed() {
  const deps = deviceDeps();
  deps.state.remembered = { v: 1, last: LAN, links: { ...LINKS } };
  deps.linkStorage.setItem(PAIRING_STORE_KEY, JSON.stringify(deps.state.remembered));
  return deps;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a 4401 unpaired close", () => {
  it("drops the address's credentials and pairs on the next socket at once", async () => {
    const deps = credentialed();
    await connect(deps);
    socketOf(deps).open();

    socketOf(deps).emit("close", { code: 4401, reason: "unpaired" });
    await flush();

    expect(deps.net.sockets).toHaveLength(2);
    expect(deps.net.sockets[1]?.url).toBe(
      "ws://192.168.1.5:47600/__editor/ws?kind=agent&role=device"
    );
    expect(deps.state.attempt).toBe(0);
    expect(JSON.parse(deps.linkStorage.items.get(PAIRING_STORE_KEY) ?? "{}").links).toEqual({
      [OFFICE]: LINKS[OFFICE]
    });
    socketOf(deps, 1).open();
    expect(socketOf(deps, 1).messages()[0]).toMatchObject({ channel: "editor", method: "pair" });
  });

  it("names only the address in the log, never the device id or the token", async () => {
    const deps = credentialed();
    await connect(deps);
    socketOf(deps).open();

    socketOf(deps).emit("close", { code: 4401, reason: "unpaired" });
    await flush();

    expect(deps.log.info).toHaveBeenCalledWith("bridge:unpaired", { address: LAN });
    const logged = JSON.stringify([
      deps.log.info.mock.calls,
      deps.log.warn.mock.calls,
      deps.log.debug.mock.calls,
      deps.log.error.mock.calls
    ]);
    expect(logged).not.toContain("dead-token");
    expect(logged).not.toContain("d-7f3a");
  });

  it("on a pairing socket backs off instead of dialling again at once", async () => {
    const deps = deviceDeps();
    await connect(deps);
    socketOf(deps).open();

    socketOf(deps).emit("close", { code: 4401, reason: "unpaired" });
    await flush();

    expect(deps.net.sockets).toHaveLength(1);
    expect(deps.state.status).toMatchObject({ kind: "lost", retryInMs: 1000 });
  });
});

describe("a hub that unpairs the phone on every link", () => {
  it("cannot cycle it faster than the backoff: the streak is kept until a session", async () => {
    const deps = credentialed();
    await connect(deps);
    const delays: number[] = [];

    for (let cycle = 0; cycle < 3; cycle += 1) {
      const stale = socketOf(deps, deps.net.sockets.length - 1);
      stale.open();
      stale.emit("close", { code: 4401, reason: "unpaired" });
      await flush();
      const pairing = socketOf(deps, deps.net.sockets.length - 1);
      pairing.open();
      pairing.emit("message", {
        data: editorNote("paired", { device: `d-000${String(cycle)}`, token: "t", engine: "e" })
      });
      pairing.emit("close", { code: 1006, reason: "" });
      const { status } = deps.state;
      if (status.kind === "lost") delays.push(status.retryInMs);
      await vi.advanceTimersByTimeAsync(31_000);
    }

    expect(delays).toEqual([1000, 2000, 4000]);
  });
});

describe("a socket that never opened", () => {
  it("keeps the credentials and backs off", async () => {
    const deps = credentialed();
    await connect(deps);

    socketOf(deps).emit("close", { code: 1006, reason: "" });
    await flush();

    expect(deps.net.sockets).toHaveLength(1);
    expect(deps.state.remembered.links[LAN]).toEqual(LINKS[LAN]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(deps.net.sockets[1]?.url).toContain("&device=d-7f3a&token=dead-token");
  });
});

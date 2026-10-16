import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildBridgeApi, dial } from "../../api";
import { connectInBackground } from "../../connection/loop";
import type { HelloResponse } from "../../types";
import { createDeps, deferred, flush, helloOk, LAN, socketOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The connect generation: a page-mode hello fetch that settles after a newer
// connect (connect(address), overlay:connect) opens nothing and fails nothing.
// ─────────────────────────────────────────────────────────────────────────────

/** The device socket of LAN, without credentials. */
const DEVICE_URL = "ws://192.168.1.5:47600/__editor/ws?kind=agent&role=device";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("connect during a pending page-mode hello fetch", () => {
  it("leaves exactly one socket, the device one, when the hello answers late", async () => {
    const deps = createDeps();
    const hello = deferred<HelloResponse>();
    deps.net.answers.push(hello.promise);
    connectInBackground(deps);
    await flush();

    dial(deps, LAN);
    await flush();
    hello.resolve(helloOk());
    await flush();

    expect(deps.net.sockets.map(opened => opened.url)).toEqual([DEVICE_URL]);
    expect(deps.state.socket).toBe(socketOf(deps));
    expect(deps.state.status).toEqual({ kind: "connecting" });
    expect(buildBridgeApi(deps).link()).toEqual({ mode: "connecting", address: LAN });
  });

  it("ignores a late failure of the earlier hello: no lost status, no retry", async () => {
    const deps = createDeps();
    const hello = deferred<HelloResponse>();
    deps.net.answers.push(hello.promise);
    connectInBackground(deps);
    await flush();

    dial(deps, LAN);
    await flush();
    hello.reject(new Error("offline"));
    await flush();

    expect(deps.state.status).toEqual({ kind: "connecting" });
    expect(deps.state.socket).toBe(socketOf(deps));
    expect(vi.getTimerCount()).toBe(0);
    expect(deps.log.warn).not.toHaveBeenCalled();
  });
});

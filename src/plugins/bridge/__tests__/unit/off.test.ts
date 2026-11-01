import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildBridgeApi } from "../../api";
import { CHECKPOINT_KEY } from "../../checkpoint/checkpoint";
import { buildBridgeHooks } from "../../handlers";
import { startWith } from "../../lifecycle";
import type { PageFlags } from "../../types";
import { PAIRING_STORE_KEY } from "../../types";
import type { TestDeps } from "../helpers";
import { createDeps, fakeWindow, flush, LAN, PAGE_FLAGS } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The third mode: a store-signed test build writes __MOKU_GAME_EDITOR__ = "off"
// and the bridge never opens anything. The flag is written as a literal here on
// purpose: it is a contract with the engine, not a value of ours.
// ─────────────────────────────────────────────────────────────────────────────

/** The flags of a store-signed test build. */
const OFF_FLAGS: PageFlags = { ...PAGE_FLAGS, editor: "off" };

/** The one bridge:status of a build with no link. */
const OFF_PAYLOAD = { status: { kind: "lost", reason: "off", lastFrame: 0, retryInMs: 0 } };

/** A phone's page in the native WebView. */
const NATIVE_PAGE = "tauri://localhost/index.html";

/** Ten minutes: longer than any retry of the backoff. */
const LONG_MS = 600_000;

/**
 * Deps of a store-signed test build.
 *
 * @returns The deps.
 */
function offDeps(): TestDeps {
  return createDeps({ flags: OFF_FLAGS });
}

/**
 * Asserts the page opened nothing.
 *
 * @param deps - The deps.
 */
function expectNoDial(deps: TestDeps): void {
  expect(deps.net.sockets).toEqual([]);
  expect(deps.net.fetches).toEqual([]);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startWith with the off flag", () => {
  it("emits exactly one lost off payload, never connecting (bug: the overlay flashes CONNECTING)", async () => {
    const deps = offDeps();

    startWith(deps);
    await flush();

    expect(deps.emit.mock.calls).toEqual([[OFF_PAYLOAD]]);
  });

  it("opens no socket, fetches nothing and leaves no timer, however long the page lives (bug: a store build retries the hub for ever)", async () => {
    const deps = offDeps();

    startWith(deps);
    await flush();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(LONG_MS);

    expectNoDial(deps);
    expect(deps.emit).toHaveBeenCalledOnce();
  });

  it("dials nothing with a remembered address, a configured address and a native page (bug: an old pairing wakes the link)", async () => {
    const remembered = { v: 1, last: LAN, links: { [LAN]: { device: "d-7f3a", token: "t1" } } };
    const deps = createDeps({
      flags: OFF_FLAGS,
      config: { device: "10.0.0.7:47600" },
      page: { href: NATIVE_PAGE, document: undefined, window: undefined }
    });
    deps.linkStorage.items.set(PAIRING_STORE_KEY, JSON.stringify(remembered));

    startWith(deps);
    await vi.advanceTimersByTimeAsync(LONG_MS);

    expectNoDial(deps);
    expect(deps.state.mode).toBe("off");
    expect(deps.state.candidates).toEqual([]);
    expect(deps.state.remembered.last).toBe(LAN);
  });

  it("installs no listener (bug: taps and heartbeats keep waking a link that is not there)", () => {
    const document = new EventTarget();
    const visibility = vi.spyOn(document, "addEventListener");
    const window = fakeWindow();
    const deps = createDeps({
      flags: OFF_FLAGS,
      page: { href: "http://127.0.0.1:3000/game.html", document, window }
    });

    startWith(deps);

    expect(deps.channel.listeners.size).toBe(0);
    expect(visibility).not.toHaveBeenCalled();
    expect(window.listeners).toEqual([]);
    expect(deps.reload.listeners.size).toBe(0);
    expect(deps.state.off).toEqual([]);
  });

  it("leaves a stored checkpoint where it is (bug: a store build restores a developer's bookmark)", () => {
    const deps = offDeps();
    const stored = JSON.stringify({
      v: 1,
      doc: 1000,
      at: Date.now(),
      frame: 1840,
      paused: false,
      bookmark: { path: "home" }
    });
    deps.reload.storage.setItem(CHECKPOINT_KEY, stored);

    startWith(deps);

    expect(deps.reload.storage.getItem(CHECKPOINT_KEY)).toBe(stored);
  });

  it("logs one info bridge:off and no bad address (bug: the flag read as a broken address warns on every launch)", () => {
    const deps = offDeps();

    startWith(deps);

    expect(deps.log.info.mock.calls).toEqual([["bridge:off"]]);
    expect(deps.log.warn).not.toHaveBeenCalled();
    expect(deps.log.error).not.toHaveBeenCalled();
  });

  it("answers the lost off status and no link (bug: the Link tab shows a computer address)", () => {
    const deps = offDeps();
    const api = buildBridgeApi(deps);

    startWith(deps);

    expect(api.status()).toEqual(OFF_PAYLOAD.status);
    expect(api.link()).toBeUndefined();
  });
});

describe("connect with the off flag", () => {
  it("before start stays off: start dials nothing (bug: connect() turns the build into device mode)", async () => {
    const deps = offDeps();

    buildBridgeApi(deps).connect(LAN);
    startWith(deps);
    await flush();

    expect(deps.state.mode).toBe("off");
    expect(deps.state.address).toBeUndefined();
    expectNoDial(deps);
    expect(deps.linkStorage.items.size).toBe(0);
    expect(deps.emit.mock.calls).toEqual([[OFF_PAYLOAD]]);
  });

  it("after start dials nothing and leaves the status alone (bug: the Link tab redials from a store build)", async () => {
    const deps = offDeps();
    const api = buildBridgeApi(deps);
    startWith(deps);

    api.connect(LAN);
    await flush();

    expectNoDial(deps);
    expect(deps.state.mode).toBe("off");
    expect(deps.emit).toHaveBeenCalledOnce();
    expect(api.status()).toEqual(OFF_PAYLOAD.status);
  });

  it("returns before it reads the address: a bad one does not throw (bug: a build with no link fails a caller)", () => {
    const deps = offDeps();

    expect(() => {
      buildBridgeApi(deps).connect("nope");
    }).not.toThrow();
  });

  it("overlay:connect dials nothing (bug: the intent goes round the api's guard)", async () => {
    const deps = offDeps();
    startWith(deps);

    buildBridgeHooks(deps)["overlay:connect"]({ address: LAN });
    await flush();

    expectNoDial(deps);
    expect(deps.state.mode).toBe("off");
    expect(deps.emit).toHaveBeenCalledOnce();
  });
});

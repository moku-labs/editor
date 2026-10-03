/* eslint-disable sonarjs/no-clear-text-protocols -- local test URLs */
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultNet, hasNetwork } from "../../connection/socket";

/** Records the arguments of every construction. */
const constructed: unknown[][] = [];

/** A WebSocket stand-in. */
class StubSocket {
  readyState = 0;
  constructor(...args: unknown[]) {
    constructed.push(args);
  }
  send(): void {}
  close(): void {}
  addEventListener(): void {}
}

afterEach(() => {
  constructed.length = 0;
  vi.unstubAllGlobals();
});

describe("defaultNet", () => {
  it("opens a plain WebSocket when no origin is given (browser)", () => {
    vi.stubGlobal("WebSocket", StubSocket);

    const socket = defaultNet(globalThis).openSocket("ws://127.0.0.1:3000/__editor/ws", undefined);

    expect(socket).toBeInstanceOf(StubSocket);
    expect(constructed).toEqual([["ws://127.0.0.1:3000/__editor/ws"]]);
  });

  it("passes { headers: { origin } } when an origin is given (Bun)", () => {
    vi.stubGlobal("WebSocket", StubSocket);

    defaultNet(globalThis).openSocket("ws://127.0.0.1:3000/x", "http://127.0.0.1:3000");

    expect(constructed).toEqual([
      ["ws://127.0.0.1:3000/x", { headers: { origin: "http://127.0.0.1:3000" } }]
    ]);
  });

  it("throws when the runtime has no WebSocket", () => {
    vi.stubGlobal("WebSocket", undefined);

    expect(() => defaultNet(globalThis).openSocket("ws://x/", undefined)).toThrow(
      "[moku-editor] no WebSocket in this runtime"
    );
  });

  it("fetches through the global fetch", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetch);

    const response = await defaultNet(globalThis).fetch("http://x/hello", {
      cache: "no-store",
      credentials: "same-origin"
    });

    expect(response.status).toBe(404);
    expect(fetch).toHaveBeenCalledWith("http://x/hello", {
      cache: "no-store",
      credentials: "same-origin"
    });
  });

  it("draws random numbers in [0, 1)", () => {
    const value = defaultNet(globalThis).random();

    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
  });
});

describe("hasNetwork", () => {
  it("is true with WebSocket and fetch", () => {
    expect(hasNetwork(globalThis)).toBe(true);
  });

  it("is false without WebSocket or without fetch", () => {
    vi.stubGlobal("WebSocket", undefined);
    expect(hasNetwork(globalThis)).toBe(false);
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", undefined);
    expect(hasNetwork(globalThis)).toBe(false);
  });
});

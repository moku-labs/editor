import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notification } from "../../../registry/protocol";
import { newCode } from "../../connection/device";
import { connect } from "../../connection/loop";
import { memberOf } from "../../dispatch/params";
import { PAIRING_STORE_KEY } from "../../types";
import type { TestDeps } from "../helpers";
import { BUILD, deviceDeps, editorNote, flush, LAN, socketOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Pairing over a fake socket: pair first, the code kept across retries,
// `paired` stored and followed by hello on the same socket, remembered
// credentials, a refusal, the code's four digits.
// ─────────────────────────────────────────────────────────────────────────────

/** The hub's answer to a confirmed pairing. */
const PAIRED = { device: "d-7f3a", token: "9f2c-secret", engine: "0.14.12+9c41e0" };

/**
 * The code of the `pair` a socket sent first.
 *
 * @param deps - The test deps.
 * @param index - Which socket.
 * @returns The code.
 */
function codeSent(deps: TestDeps, index = 0): unknown {
  const [first] = socketOf(deps, index).messages();
  return first !== undefined && "params" in first ? memberOf(first.params, "code") : undefined;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pairing", () => {
  it("sends pair { code, device } first on a socket without credentials and shows the code", async () => {
    const deps = deviceDeps();

    await connect(deps);
    socketOf(deps).open();

    const code = codeSent(deps);
    expect(code).toMatch(/^\d{4}$/);
    expect(socketOf(deps).messages()).toEqual([
      notification("editor", "pair", {
        code: String(code),
        device: { engine: BUILD.engine ?? "", build: BUILD.id ?? "" }
      })
    ]);
    expect(deps.state.phase).toBe("pairing");
    expect(deps.emit).toHaveBeenLastCalledWith({
      status: { kind: "connecting" },
      link: { mode: "connecting", address: LAN, pairing: { code } }
    });
  });

  it("keeps the code across retries of the same pairing", async () => {
    const deps = deviceDeps();
    await connect(deps);
    socketOf(deps).open();
    const code = codeSent(deps);

    socketOf(deps).emit("close", { code: 1008, reason: "pairing timed out" });
    expect(deps.state.status).toMatchObject({
      kind: "lost",
      reason: "socket closed (1008): pairing timed out",
      retryInMs: 1000
    });
    await vi.advanceTimersByTimeAsync(1000);
    socketOf(deps, 1).open();

    expect(codeSent(deps, 1)).toBe(code);
  });

  it("paired: stores the device and token for the address, then says hello on the same socket", async () => {
    const deps = deviceDeps();
    await connect(deps);
    const socket = socketOf(deps);
    socket.open();
    socket.clear();

    socket.emit("message", { data: editorNote("paired", PAIRED) });

    expect(socket.messages().map(message => "method" in message && message.method)).toEqual([
      "hello",
      "heartbeat"
    ]);
    expect(deps.state.phase).toBe("open");
    expect(JSON.parse(deps.linkStorage.items.get(PAIRING_STORE_KEY) ?? "{}")).toEqual({
      v: 1,
      last: LAN,
      links: { [LAN]: { device: "d-7f3a", token: "9f2c-secret" } }
    });
    expect(deps.log.info).toHaveBeenCalledWith("bridge:paired", { address: LAN });
    expect(deps.emit).toHaveBeenLastCalledWith({
      status: { kind: "live", frame: 12 },
      link: { mode: "lan", address: LAN, editorEngine: PAIRED.engine, seenAt: Date.now() }
    });
  });

  it("ignores paired on a socket that is not pairing", async () => {
    const deps = deviceDeps();
    deps.state.remembered.links[LAN] = { device: "d-1111", token: "old" };
    await connect(deps);
    const socket = socketOf(deps);
    socket.open();

    socket.emit("message", { data: editorNote("paired", PAIRED) });

    expect(deps.state.remembered.links[LAN]).toEqual({ device: "d-1111", token: "old" });
    expect(deps.linkStorage.items.size).toBe(0);
  });

  it("with remembered credentials: hello first, no pair", async () => {
    const deps = deviceDeps();
    deps.state.remembered.links[LAN] = { device: "d-7f3a", token: "9f2c-secret" };

    await connect(deps);
    socketOf(deps).open();

    expect(deps.net.sockets[0]?.url).toContain("&device=d-7f3a&token=9f2c-secret");
    expect(socketOf(deps).messages()[0]).toMatchObject({ channel: "game", method: "hello" });
    expect(deps.state.phase).toBe("open");
  });

  it("1008 pairing refused: lost for good, no retry until connect asks again", async () => {
    const deps = deviceDeps();
    await connect(deps);
    socketOf(deps).open();

    socketOf(deps).emit("close", { code: 1008, reason: "pairing refused" });

    expect(deps.state.status).toMatchObject({
      kind: "lost",
      reason: "pairing refused",
      retryInMs: 0
    });
    expect(deps.state.pairing).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    expect(deps.log.warn).toHaveBeenCalledWith("bridge:pairing-refused", { address: LAN });
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(deps.net.sockets).toHaveLength(1);
  });
});

describe("connect in device mode", () => {
  it("dials the address's socket without a hello fetch and without an Origin of its own", async () => {
    const deps = deviceDeps();

    await connect(deps);

    expect(deps.net.fetches).toEqual([]);
    expect(deps.net.sockets).toEqual([
      expect.objectContaining({
        url: "ws://192.168.1.5:47600/__editor/ws?kind=agent&role=device",
        origin: undefined
      })
    ]);
  });

  it("without WebSocket: lost for good, no retry", async () => {
    vi.stubGlobal("WebSocket", undefined);
    const deps = deviceDeps();

    await connect(deps);
    vi.unstubAllGlobals();

    expect(deps.state.status).toMatchObject({
      kind: "lost",
      reason: "no WebSocket in this runtime",
      retryInMs: 0
    });
    expect(deps.net.sockets).toEqual([]);
  });

  it("with a hello that is not a URL: lost for good, naming the address only", async () => {
    const deps = deviceDeps(LAN, { config: { hello: "https://[" } });

    await connect(deps);

    expect(deps.state.status).toMatchObject({
      kind: "lost",
      reason: `no socket URL for ${LAN}`,
      retryInMs: 0
    });
  });
});

describe("newCode", () => {
  it("keeps the leading zero: a random of 0.0421 gives 0421", () => {
    expect(newCode(() => 0.0421, {})).toBe("0421");
  });

  it("takes crypto.getRandomValues when the page has it", () => {
    const scope = {
      crypto: {
        getRandomValues: <T extends ArrayBufferView>(array: T): T => {
          if (array instanceof Uint32Array) array[0] = 10_007;
          return array;
        }
      }
    };

    expect(newCode(() => 0.99, scope)).toBe("0007");
  });
});

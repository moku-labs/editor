/* eslint-disable unicorn/no-null -- null is the JSON value the wire carries */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message, Response, RunResult, WireError } from "../../../registry/protocol";
import {
  encode,
  isResponse,
  notification,
  request,
  success,
  toWireValue,
  wireError
} from "../../../registry/protocol";
import { handleRequest, handleText } from "../../dispatch/dispatch";
import type { TestDeps } from "../helpers";
import { deferred, flush, MANIFEST, openDeps, RAN, requestText } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// handleText (binary, bad, response, notification, request) and the
// handleRequest table, row by row, plus the deadline.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends one request text through handleText and lets it settle.
 *
 * @param deps - The test deps.
 * @param text - The encoded request.
 */
async function ask(deps: TestDeps, text: string): Promise<void> {
  handleText(deps, text);
  await flush();
}

/**
 * The responses on a socket.
 *
 * @param messages - Decoded messages.
 * @returns The responses only.
 */
function responsesOf(messages: Message[]): Response[] {
  return messages.filter(message => isResponse(message));
}

/**
 * The error of the only response.
 *
 * @param messages - Decoded messages.
 * @returns Its error member.
 */
function errorOf(messages: Message[]): WireError {
  const [response] = responsesOf(messages);
  if (response === undefined || !("error" in response)) throw new Error("no error response");
  return response.error;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("handleRequest — the game channel table", () => {
  it("manifest → the registry manifest as a wire value", async () => {
    const { deps, socket } = openDeps();

    await ask(deps, requestText(1, "manifest"));

    expect(socket.messages()).toEqual([success(1, toWireValue(MANIFEST))]);
  });

  it("read → the channel value, with the input passed on", async () => {
    const { deps, socket } = openDeps();

    await ask(deps, requestText(2, "read", { id: "game.position", input: { last: 1 } }));

    expect(socket.messages()).toEqual([success(2, { path: "home" })]);
    expect(deps.channel.reads).toEqual([{ id: "game.position", input: { last: 1 } }]);
  });

  it("watch → null, then a value notification", async () => {
    const { deps, socket } = openDeps();

    await ask(deps, requestText(3, "watch", { sub: 1, id: "game.position" }));

    expect(socket.messages()).toEqual([
      success(3, null),
      notification("game", "value", { sub: 1, value: { path: "home" } })
    ]);
  });

  it("unwatch → null and the channel watch stops; an unknown sub is fine", async () => {
    const { deps, socket } = openDeps();
    await ask(deps, requestText(3, "watch", { sub: 1, id: "game.position" }));
    socket.clear();

    await ask(deps, requestText(4, "unwatch", { sub: 1 }));
    await ask(deps, requestText(5, "unwatch", { sub: 99 }));

    expect(socket.messages()).toEqual([success(4, null), success(5, null)]);
    expect(deps.channel.stops).toBe(1);
  });

  it("run → the RunResult", async () => {
    const { deps, socket } = openDeps();

    await ask(deps, requestText(6, "run", { id: "game.step", input: { frames: 1 } }));

    expect(socket.messages()).toEqual([success(6, RAN)]);
  });

  it("run → the response comes before the post-run refresh of every sub", async () => {
    const { deps, socket } = openDeps();
    await ask(deps, requestText(1, "watch", { sub: 1, id: "game.render" }));
    deps.channel.values.set("game.render", { fps: 30 });
    socket.clear();

    await ask(deps, requestText(2, "run", { id: "game.step", input: { frames: 1 } }));

    expect(socket.messages()).toEqual([
      success(2, RAN),
      notification("game", "value", { sub: 1, value: { fps: 30 } })
    ]);
  });

  it("refreshes after a failed run too", async () => {
    const { deps, socket } = openDeps();
    await ask(deps, requestText(1, "watch", { sub: 1, id: "game.render" }));
    deps.channel.values.set("game.render", { fps: 30 });
    deps.channel.runs.set("game.step", () => Promise.reject(new Error("boom")));
    socket.clear();

    await ask(deps, requestText(2, "run", { id: "game.step" }));

    expect(socket.messages()[1]).toEqual(
      notification("game", "value", { sub: 1, value: { fps: 30 } })
    );
  });

  it("another game method → -32601 unknown method", async () => {
    const { deps, socket } = openDeps();

    await ask(deps, requestText(7, "nope"));

    expect(errorOf(socket.messages())).toEqual({
      code: -32_601,
      message: "[moku-editor] unknown method nope"
    });
  });

  it("any channel but game → -32601 unknown method <channel>.<method>", async () => {
    const { deps, socket } = openDeps();

    await ask(deps, requestText(8, "read", { path: "x.ts" }, "files"));

    expect(errorOf(socket.messages())).toEqual({
      code: -32_601,
      message: "[moku-editor] unknown method files.read"
    });
  });

  it("bad params → -32602 naming the field", async () => {
    const { deps, socket } = openDeps();

    await ask(deps, requestText(9, "read", { id: 5 }));

    expect(errorOf(socket.messages())).toMatchObject({
      code: -32_602,
      data: { reason: "invalid_input", field: "id" }
    });
  });

  it("a watch sub that is not a whole number ≥ 0 → -32602 field sub", async () => {
    const { deps, socket } = openDeps();

    await ask(deps, requestText(9, "watch", { sub: 1.5, id: "game.position" }));

    expect(errorOf(socket.messages())).toMatchObject({ code: -32_602, data: { field: "sub" } });
    expect(deps.state.subs.size).toBe(0);
  });

  it("an unknown id → -32601 with data.id", async () => {
    const { deps, socket } = openDeps();

    await ask(deps, requestText(10, "read", { id: "game.nope" }));

    expect(errorOf(socket.messages())).toEqual({
      code: -32_601,
      message: "[moku-editor] game.nope: unknown source",
      data: { reason: "unknown_id", id: "game.nope" }
    });
  });

  it("an invalid command input passes through with its code and field", async () => {
    const { deps, socket } = openDeps();
    deps.channel.runs.set("game.step", () =>
      Promise.reject(
        wireError(-32_602, "game.step: frames must be a number", {
          reason: "invalid_input",
          retryable: false,
          field: "frames"
        })
      )
    );

    await ask(deps, requestText(11, "run", { id: "game.step", input: { frames: "1" } }));

    expect(errorOf(socket.messages())).toEqual({
      code: -32_602,
      message: "[moku-editor] game.step: frames must be a number",
      data: { reason: "invalid_input", retryable: false, field: "frames" }
    });
  });

  it("any other failure → -32000 without a stack", async () => {
    const { deps, socket } = openDeps();
    deps.channel.runs.set("game.step", () => Promise.reject(new Error("boom")));

    await ask(deps, requestText(12, "run", { id: "game.step" }));

    expect(errorOf(socket.messages())).toEqual({
      code: -32_000,
      message: "[moku-editor] boom",
      data: { reason: "command_failed", retryable: false }
    });
    expect(socket.sent.join("")).not.toContain("stack");
  });

  it("a throw before any await still gets one response", async () => {
    const { deps, socket } = openDeps();
    const failing = {
      ...deps,
      registry: {
        ...deps.registry,
        manifest: () => {
          throw new Error("no manifest");
        }
      }
    };

    await handleRequest(failing, request(13, "game", "manifest"));

    expect(errorOf(socket.messages())).toMatchObject({
      code: -32_000,
      message: "[moku-editor] no manifest"
    });
  });

  it("every error message starts with the prefix", async () => {
    const { deps, socket } = openDeps();
    deps.channel.runs.set("game.step", () => Promise.reject(new Error("boom")));

    await ask(deps, requestText(1, "nope"));
    await ask(deps, requestText(2, "read", { path: "x" }, "files"));
    await ask(deps, requestText(3, "read", { id: 5 }));
    await ask(deps, requestText(4, "read", { id: "game.nope" }));
    await ask(deps, requestText(5, "run", { id: "game.step" }));
    await ask(deps, requestText(6, "watch", { sub: 1, id: "game.nope" }));

    const errors = responsesOf(socket.messages()).flatMap(response =>
      "error" in response ? [response.error.message] : []
    );
    expect(errors).toHaveLength(6);
    expect(errors.every(message => message.startsWith("[moku-editor] "))).toBe(true);
  });
});

describe("handleRequest — deadline", () => {
  it("answers -32002 timeout after callTimeoutMs and drops the late result", async () => {
    vi.useFakeTimers();
    const { deps, socket } = openDeps();
    const slow = deferred<RunResult>();
    deps.channel.runs.set("game.slow", () => slow.promise);

    handleText(deps, requestText(20, "run", { id: "game.slow" }));
    await vi.advanceTimersByTimeAsync(4999);
    expect(socket.sent).toEqual([]);
    expect(deps.state.inflight.size).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(errorOf(socket.messages())).toEqual({
      code: -32_002,
      message: "[moku-editor] game.slow: no answer after 5000 ms",
      data: { reason: "timeout", retryable: true, id: "game.slow" }
    });
    expect(deps.state.inflight.size).toBe(0);

    slow.resolve(RAN);
    await flush();

    expect(responsesOf(socket.messages())).toHaveLength(1);
    expect(deps.log.debug).toHaveBeenCalledWith(
      "bridge:late-result",
      expect.objectContaining({ id: "game.slow" })
    );
  });

  it("gives editor.series its duration on top", async () => {
    vi.useFakeTimers();
    const { deps, socket } = openDeps();
    deps.channel.runs.set("editor.series", () => new Promise(() => {}));

    handleText(
      deps,
      requestText(21, "run", {
        id: "editor.series",
        input: { durationMs: 20_000, intervalMs: 100 }
      })
    );
    await vi.advanceTimersByTimeAsync(24_999);
    expect(socket.sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(errorOf(socket.messages()).message).toBe(
      "[moku-editor] editor.series: no answer after 25000 ms"
    );
  });

  it("a read has the deadline too", async () => {
    vi.useFakeTimers();
    const { deps, socket } = openDeps();
    deps.channel.holds.set("game.position", new Promise(() => {}));

    handleText(deps, requestText(22, "read", { id: "game.position" }));
    await vi.advanceTimersByTimeAsync(5000);

    expect(errorOf(socket.messages())).toMatchObject({ code: -32_002 });
  });

  it("a settle before the deadline clears the timer", async () => {
    vi.useFakeTimers();
    const { deps, socket } = openDeps();

    handleText(deps, requestText(23, "run", { id: "game.step", input: { frames: 1 } }));
    await vi.advanceTimersByTimeAsync(0);

    expect(socket.messages()).toEqual([success(23, RAN)]);
    expect(deps.state.inflight.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a result after the socket closed is dropped", async () => {
    const { deps, socket } = openDeps();
    const slow = deferred<RunResult>();
    deps.channel.runs.set("game.slow", () => slow.promise);

    handleText(deps, requestText(24, "run", { id: "game.slow" }));
    await flush();
    for (const timer of deps.state.inflight.values()) clearTimeout(timer);
    deps.state.inflight.clear();
    slow.resolve(RAN);
    await flush();

    expect(socket.sent).toEqual([]);
  });
});

describe("handleText", () => {
  it("ignores a binary frame", () => {
    const { deps, socket } = openDeps();

    handleText(deps, new Uint8Array([1, 2]));

    expect(socket.sent).toEqual([]);
    expect(deps.log.debug).toHaveBeenCalledWith("bridge:binary-ignored");
  });

  it("drops a message that does not decode", () => {
    const { deps, socket } = openDeps();

    handleText(deps, "{nope");

    expect(socket.sent).toEqual([]);
    expect(deps.log.debug).toHaveBeenCalledWith("bridge:bad-message", {
      message: "[moku-editor] message is not JSON"
    });
  });

  it("ignores responses (the agent sends no requests)", async () => {
    const { deps, socket } = openDeps();

    await ask(deps, encode(success(1, null)));

    expect(socket.sent).toEqual([]);
  });

  it("ignores other notifications", () => {
    const { deps, socket } = openDeps();

    handleText(deps, encode(notification("game", "sessions", { list: [] })));

    expect(socket.sent).toEqual([]);
    expect(deps.log.debug).toHaveBeenCalledWith("bridge:notification-ignored", {
      channel: "game",
      method: "sessions"
    });
  });

  it("sets and clears the session from the hub's editor/session notification", () => {
    const { deps } = openDeps();
    const open = encode(
      notification("editor", "session", { id: "s-7f3a", game: "merge-game", open: true })
    );

    handleText(deps, open);
    handleText(deps, open);

    expect(deps.state.session).toBe("s-7f3a");
    expect(deps.emit).toHaveBeenCalledTimes(1);
    expect(deps.emit).toHaveBeenCalledWith({
      status: { kind: "live", frame: 12 },
      session: "s-7f3a"
    });

    handleText(
      deps,
      encode(notification("editor", "session", { id: "s-other", game: "x", open: false }))
    );
    expect(deps.state.session).toBe("s-7f3a");

    handleText(
      deps,
      encode(notification("editor", "session", { id: "s-7f3a", game: "x", open: false }))
    );
    expect(deps.state.session).toBeUndefined();
    expect(deps.emit).toHaveBeenCalledTimes(2);
    expect(deps.emit).toHaveBeenLastCalledWith({ status: { kind: "live", frame: 12 } });
  });

  it("ignores a session notification without an id", () => {
    const { deps } = openDeps();

    handleText(deps, encode(notification("editor", "session", { open: true })));

    expect(deps.state.session).toBeUndefined();
    expect(deps.emit).not.toHaveBeenCalled();
  });
});

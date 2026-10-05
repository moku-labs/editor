/* eslint-disable unicorn/no-null -- null is the "nothing selected" value of notify */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Json,
  Message,
  Response as RpcResponse,
  SelectionInfo,
  SelectParams
} from "../../../registry/protocol";
import {
  isNotification,
  isResponse,
  request,
  toWireValue,
  wireError
} from "../../../registry/protocol";
import { createLinkApi } from "../../api";
import { stopLink } from "../../lifecycle";
import { openSocket } from "../../socket/connect";
import {
  BOOT,
  connected,
  createCtx,
  FakeWebSocket,
  flush,
  latestSocket,
  type TestCtx
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The editor page (D-33): the role query, notify("selection") with the resend
// after a reconnect, handle("select") for hub requests, and selection().
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  FakeWebSocket.instances.length = 0;
  ctx = createCtx();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const coins: SelectionInfo = {
  ref: { kind: "ui", path: "column#0/hudRow/coins" },
  key: "coins",
  projection: "hud",
  name: "coins",
  type: "text",
  rect: { x: 12, y: 40, w: 96, h: 24 },
  session: "s-1",
  frame: 1840,
  at: 1_790_000_000_000
};

const area: SelectionInfo = {
  ref: { kind: "ui", path: "column#0/hudRow/coins" },
  name: "area",
  type: "area",
  rect: { x: 0, y: 30, w: 200, h: 60 },
  area: { x: 0, y: 30, w: 200, h: 60 },
  items: [{ ref: { kind: "ui", path: "column#0/hudRow/coins" }, name: "coins", type: "text" }],
  at: 1_790_000_000_001
};

/**
 * The editor-channel `selection` notifications link sent.
 *
 * @param socket - The fake socket.
 * @returns Their params, in order.
 */
function sentSelections(socket: FakeWebSocket): (Json | undefined)[] {
  return socket.sent
    .filter(message => isNotification(message))
    .filter(message => message.channel === "editor" && message.method === "selection")
    .map(message => message.params);
}

/**
 * The responses link sent.
 *
 * @param socket - The fake socket.
 * @returns The responses, in order.
 */
function responses(socket: FakeWebSocket): RpcResponse[] {
  return socket.sent.filter((message: Message) => isResponse(message));
}

/**
 * Drops the socket and lets the reconnect open a new one.
 *
 * @param socket - The open socket.
 * @returns The new open socket.
 */
async function reconnectFrom(socket: FakeWebSocket): Promise<FakeWebSocket> {
  socket.drop();
  await vi.advanceTimersByTimeAsync(1000);
  const next = latestSocket();
  expect(next).not.toBe(socket);
  next.open();
  return next;
}

describe("role", () => {
  it("connects as the editor page by default: &kind=tools&role=page", () => {
    ctx.state.boot = BOOT;
    openSocket(ctx);
    expect(latestSocket().url).toBe(
      "ws://127.0.0.1:3000/__editor/ws?token=secret-token-1&kind=tools&role=page"
    );
  });

  it("connects as a plain tools client without a role with role 'tools'", () => {
    ctx = createCtx({ role: "tools" });
    ctx.state.boot = BOOT;
    openSocket(ctx);
    expect(latestSocket().url).toBe(
      "ws://127.0.0.1:3000/__editor/ws?token=secret-token-1&kind=tools"
    );
  });
});

describe("notify('selection')", () => {
  it("sends an editor-channel notification with the wire value while open", async () => {
    const socket = await connected(ctx);

    createLinkApi(ctx).notify("selection", coins);

    expect(sentSelections(socket)).toEqual([toWireValue(coins)]);
    const sent = socket.sent.at(-1);
    expect(sent).not.toHaveProperty("id");
    expect(sent).not.toHaveProperty("session");
  });

  it("sends an area selection with its items, and null as a notification without params", async () => {
    const socket = await connected(ctx);
    const link = createLinkApi(ctx);

    link.notify("selection", area);
    link.notify("selection", null);

    expect(sentSelections(socket)).toEqual([toWireValue(area), undefined]);
    expect(socket.sent.at(-1)).toEqual({ jsonrpc: "2.0", channel: "editor", method: "selection" });
  });

  it("drops a value while closed and sends the last one when the socket opens", async () => {
    const link = createLinkApi(ctx);
    link.notify("selection", area);
    link.notify("selection", coins);

    ctx.state.boot = BOOT;
    openSocket(ctx);
    const socket = latestSocket();
    expect(sentSelections(socket)).toEqual([]);

    socket.open();
    await flush();
    expect(sentSelections(socket)).toEqual([toWireValue(coins)]);
  });

  it("sends the last value again after a reconnect, null included", async () => {
    const socket = await connected(ctx);
    const link = createLinkApi(ctx);
    link.notify("selection", coins);

    const second = await reconnectFrom(socket);
    expect(sentSelections(second)).toEqual([toWireValue(coins)]);

    link.notify("selection", null);
    const third = await reconnectFrom(second);
    expect(sentSelections(third)).toEqual([undefined]);
  });

  it("sends nothing on open when the page never notified", async () => {
    const socket = await connected(ctx);
    expect(sentSelections(socket)).toEqual([]);
  });

  it("does nothing after stop", async () => {
    const socket = await connected(ctx);
    stopLink(ctx);

    createLinkApi(ctx).notify("selection", coins);

    expect(sentSelections(socket)).toEqual([]);
  });

  it("logs a warning and keeps the value when the send throws", async () => {
    const socket = await connected(ctx);
    vi.spyOn(socket, "send").mockImplementation(() => {
      throw new Error("closing");
    });

    createLinkApi(ctx).notify("selection", coins);

    expect(ctx.log.warn).toHaveBeenCalledWith("link:notify-failed", { method: "selection" });
    expect(ctx.state.notified.get("selection")).toEqual(toWireValue(coins));
  });
});

describe("selection()", () => {
  it("is undefined until the hub sent one", () => {
    expect(createLinkApi(ctx).selection()).toBeUndefined();
  });

  it("reads the hub's editor.selection notification as a fresh copy", async () => {
    const socket = await connected(ctx);
    const link = createLinkApi(ctx);

    socket.notify("editor", "selection", toWireValue({ ...coins, extra: 1 }));

    const first = link.selection();
    expect(first).toEqual(coins);
    if (first !== undefined) Reflect.set(first, "name", "changed");
    expect(link.selection()?.name).toBe("coins");
  });

  it("keeps an area selection's items", async () => {
    const socket = await connected(ctx);

    socket.notify("editor", "selection", toWireValue(area));

    expect(createLinkApi(ctx).selection()?.items).toEqual(area.items);
  });

  it("turns undefined on a notification without params (nothing selected)", async () => {
    const socket = await connected(ctx);
    socket.notify("editor", "selection", toWireValue(coins));

    socket.notify("editor", "selection");

    expect(createLinkApi(ctx).selection()).toBeUndefined();
  });

  it("warns on a malformed notification and keeps the last value", async () => {
    const socket = await connected(ctx);
    socket.notify("editor", "selection", toWireValue(coins));

    socket.notify("editor", "selection", { name: "no ref" });
    socket.notify("editor", "selection", []);

    expect(ctx.log.warn).toHaveBeenCalledWith("link:bad-selection", {});
    expect(createLinkApi(ctx).selection()).toEqual(coins);
  });
});

describe("handle('select')", () => {
  it("runs the handler with the checked params and answers its result with the hub's id", async () => {
    const socket = await connected(ctx);
    const handler = vi.fn(async (_params: SelectParams) => area);
    createLinkApi(ctx).handle("select", handler);

    socket.receive(
      request(41, "editor", "select", { rect: { x: 0, y: 30, w: 200, h: 60 }, card: false })
    );
    await flush();

    expect(handler).toHaveBeenCalledWith({ rect: { x: 0, y: 30, w: 200, h: 60 }, card: false });
    expect(responses(socket)).toEqual([{ jsonrpc: "2.0", id: 41, result: toWireValue(area) }]);
  });

  it("passes {} when the request has no params", async () => {
    const socket = await connected(ctx);
    const handler = vi.fn(async (_params: SelectParams) => coins);
    createLinkApi(ctx).handle("select", handler);

    socket.receive(request(42, "editor", "select"));
    await flush();

    expect(handler).toHaveBeenCalledWith({});
  });

  it("answers the handler's wire error as a failure", async () => {
    const socket = await connected(ctx);
    createLinkApi(ctx).handle("select", async () => {
      throw wireError(-32_602, "No element with key nope", {
        reason: "invalid_input",
        retryable: false
      });
    });

    socket.receive(request(43, "editor", "select", { key: "nope" }));
    await flush();

    expect(responses(socket)).toEqual([
      {
        jsonrpc: "2.0",
        id: 43,
        error: {
          code: -32_602,
          message: "[moku-editor] No element with key nope",
          data: { reason: "invalid_input", retryable: false }
        }
      }
    ]);
    expect(ctx.log.warn).toHaveBeenCalledWith("link:request-failed", {
      method: "select",
      code: -32_602,
      reason: "invalid_input"
    });
  });

  it("answers a plain thrown Error as -32000 command_failed", async () => {
    const socket = await connected(ctx);
    createLinkApi(ctx).handle("select", () => {
      throw new Error("scene not ready");
    });

    socket.receive(request(44, "editor", "select", { key: "coins" }));
    await flush();

    expect(responses(socket)[0]).toMatchObject({
      id: 44,
      error: { code: -32_000, message: "[moku-editor] scene not ready" }
    });
  });

  it("answers -32601 without a handler, and for an editor method no page handles", async () => {
    // The hub relays editor requests to the page; a ping is no method of the page.
    const socket = await connected(ctx);

    socket.receive(request(45, "editor", "select", { key: "coins" }));
    socket.receive(request(46, "editor", "zap", {}));
    await flush();

    expect(
      responses(socket).map(response => [response.id, "error" in response && response.error.code])
    ).toEqual([
      [45, -32_601],
      [46, -32_601]
    ]);
  });

  it("answers -32602 invalid_input for bad params without calling the handler", async () => {
    const socket = await connected(ctx);
    const handler = vi.fn(async (_params: SelectParams) => coins);
    createLinkApi(ctx).handle("select", handler);

    socket.receive(request(47, "editor", "select", { key: 5 }));
    await flush();

    expect(handler).not.toHaveBeenCalled();
    expect(responses(socket)[0]).toMatchObject({
      id: 47,
      error: { code: -32_602, data: { reason: "invalid_input", retryable: false } }
    });
  });

  it("the remover removes its own handler only; twice is a no-op", async () => {
    const socket = await connected(ctx);
    const link = createLinkApi(ctx);
    const first = vi.fn(async (_params: SelectParams) => coins);
    const second = vi.fn(async (_params: SelectParams) => area);

    const removeFirst = link.handle("select", first);
    const removeSecond = link.handle("select", second);
    removeFirst();
    socket.receive(request(48, "editor", "select", {}));
    await flush();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    removeSecond();
    removeSecond();
    socket.receive(request(49, "editor", "select", {}));
    await flush();
    expect(responses(socket).at(-1)).toMatchObject({ id: 49, error: { code: -32_601 } });
  });

  it("drops the answer when the socket it came on closed meanwhile", async () => {
    const socket = await connected(ctx);
    const pending: { answer?: (info: SelectionInfo) => void } = {};
    createLinkApi(ctx).handle(
      "select",
      () =>
        new Promise<SelectionInfo>(resolve => {
          pending.answer = resolve;
        })
    );

    socket.receive(request(50, "editor", "select", { key: "coins" }));
    const second = await reconnectFrom(socket);
    pending.answer?.(coins);
    await flush();

    expect(responses(socket)).toEqual([]);
    expect(responses(second)).toEqual([]);
    expect(ctx.log.debug).toHaveBeenCalledWith("link:answer-dropped", { method: "select" });
  });

  it("still only logs a request on another channel, without answering", async () => {
    const socket = await connected(ctx);

    socket.receive(request(51, "game", "read", { id: "game.position" }));
    await flush();

    expect(responses(socket)).toEqual([]);
    expect(ctx.log.debug).toHaveBeenCalledWith("link:unexpected-request", { method: "read" });
  });

  it("stop forgets the handlers", async () => {
    const link = createLinkApi(ctx);
    link.handle("select", async () => coins);
    await connected(ctx);

    stopLink(ctx);

    expect(ctx.state.handlers.size).toBe(0);
  });
});

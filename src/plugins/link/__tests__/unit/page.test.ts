/* eslint-disable unicorn/no-null -- null is the "nothing selected" value of notify */
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type {
  DeviceInfo,
  DeviceParams,
  Json,
  Message,
  NodeInfo,
  NodeParams,
  RelayedEditorMethod,
  Response as RpcResponse,
  SelectionInfo,
  SelectParams,
  ShowInfo,
  ShowParams
} from "../../../registry/protocol";
import {
  isNotification,
  isResponse,
  request,
  toWireValue,
  WORKSPACE_NAMES,
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
    expect(ctx.log.debug).toHaveBeenCalledWith("link:request-failed", {
      method: "select",
      code: -32_602,
      reason: "invalid_input"
    });
    expect(ctx.log.warn).not.toHaveBeenCalledWith("link:request-failed", expect.anything());
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
    expect(ctx.log.warn).toHaveBeenCalledWith("link:request-failed", { method: "select" });
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

// ─────────────────────────────────────────────────────────────────────────────
// handle("device" | "show" | "node") (D-60): the hub relays them like select.
// One handler per method, each behind the params parser of its method.
// ─────────────────────────────────────────────────────────────────────────────

const pixel: DeviceInfo = {
  preset: "pixel-8",
  orientation: "landscape",
  folded: true,
  w: 915,
  h: 412,
  presets: [
    {
      id: "pixel-8",
      name: "Pixel 8",
      group: "android",
      kind: "phone",
      w: 412,
      h: 915,
      foldable: false
    }
  ]
};

const stateShown: ShowInfo = { workspace: "state", workspaces: WORKSPACE_NAMES };

const home: NodeInfo = { id: "main/home", selected: "main/home" };

/** Params the parser of the method refuses. */
const BAD_PARAMS: [RelayedEditorMethod, Json | undefined][] = [
  ["device", { orientation: "sideways" }],
  ["device", { preset: "pixel-8", zoom: 2 }],
  ["show", { workspace: "settings" }],
  ["node", { id: "" }],
  ["node", { id: "main/home", expand: true }],
  ["node", undefined]
];

/**
 * How link answered the request with an id.
 *
 * @param socket - The fake socket.
 * @param id - The request id.
 * @returns The error code, "ok" for a result, undefined when link sent no answer.
 */
function outcome(socket: FakeWebSocket, id: number): number | "ok" | undefined {
  const response = responses(socket).find(sent => sent.id === id);
  if (response === undefined) return undefined;
  return "error" in response ? response.error.code : "ok";
}

describe("handle('device' | 'show' | 'node')", () => {
  it("device: runs the handler with the checked params and answers its result", async () => {
    const socket = await connected(ctx);
    const handler = vi.fn((_params: DeviceParams) => pixel);
    createLinkApi(ctx).handle("device", handler);

    socket.receive(
      request(60, "editor", "device", { preset: "pixel-8", orientation: "landscape" })
    );
    await flush();

    expect(handler).toHaveBeenCalledWith({ preset: "pixel-8", orientation: "landscape" });
    expect(responses(socket)).toEqual([{ jsonrpc: "2.0", id: 60, result: toWireValue(pixel) }]);
  });

  it("show: runs the handler with the checked params and answers its result", async () => {
    const socket = await connected(ctx);
    const handler = vi.fn(async (_params: ShowParams) => stateShown);
    createLinkApi(ctx).handle("show", handler);

    socket.receive(request(61, "editor", "show", { workspace: "state" }));
    await flush();

    expect(handler).toHaveBeenCalledWith({ workspace: "state" });
    expect(responses(socket)).toEqual([
      { jsonrpc: "2.0", id: 61, result: toWireValue(stateShown) }
    ]);
  });

  it("node: runs the handler with the checked params and answers its result", async () => {
    const socket = await connected(ctx);
    const handler = vi.fn((_params: NodeParams) => home);
    createLinkApi(ctx).handle("node", handler);

    socket.receive(request(62, "editor", "node", { id: "main/home" }));
    await flush();

    expect(handler).toHaveBeenCalledWith({ id: "main/home" });
    expect(responses(socket)).toEqual([{ jsonrpc: "2.0", id: 62, result: toWireValue(home) }]);
  });

  it("passes {} to a device and a show handler when the request has no params (a read)", async () => {
    const socket = await connected(ctx);
    const link = createLinkApi(ctx);
    const device = vi.fn((_params: DeviceParams) => pixel);
    const show = vi.fn((_params: ShowParams) => stateShown);
    link.handle("device", device);
    link.handle("show", show);

    socket.receive(request(63, "editor", "device"));
    socket.receive(request(64, "editor", "show"));
    await flush();

    expect(device).toHaveBeenCalledWith({});
    expect(show).toHaveBeenCalledWith({});
    expect([outcome(socket, 63), outcome(socket, 64)]).toEqual(["ok", "ok"]);
  });

  it.each(
    BAD_PARAMS
  )("answers -32602 invalid_input for bad %s params %j without calling a handler", async (method, params) => {
    const socket = await connected(ctx);
    const link = createLinkApi(ctx);
    const device = vi.fn((_params: DeviceParams) => pixel);
    const show = vi.fn((_params: ShowParams) => stateShown);
    const node = vi.fn((_params: NodeParams) => home);
    link.handle("device", device);
    link.handle("show", show);
    link.handle("node", node);

    socket.receive(request(65, "editor", method, params));
    await flush();

    expect(device).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
    expect(node).not.toHaveBeenCalled();
    expect(responses(socket)).toEqual([
      {
        jsonrpc: "2.0",
        id: 65,
        error: {
          code: -32_602,
          message: `[moku-editor] editor.${method}: bad params`,
          data: { reason: "invalid_input", retryable: false }
        }
      }
    ]);
  });

  it("answers -32601 for a method without a handler, bad params included", async () => {
    const socket = await connected(ctx);
    createLinkApi(ctx).handle("select", async () => coins);

    socket.receive(request(66, "editor", "device", {}));
    socket.receive(request(67, "editor", "show", {}));
    socket.receive(request(68, "editor", "node", { id: "main/home" }));
    socket.receive(request(69, "editor", "node", { id: "" }));
    await flush();

    expect([66, 67, 68, 69].map(id => outcome(socket, id))).toEqual([
      -32_601, -32_601, -32_601, -32_601
    ]);
  });

  it("answers a throwing handler's wire error as the failure", async () => {
    const socket = await connected(ctx);
    const link = createLinkApi(ctx);
    link.handle("node", () => {
      throw wireError(-32_003, "the Flow view has no graph yet", {
        reason: "no_graph",
        retryable: true
      });
    });
    link.handle("device", async () => {
      throw wireError(-32_602, "unknown preset nope", {
        reason: "invalid_input",
        retryable: false,
        field: "preset"
      });
    });

    socket.receive(request(70, "editor", "node", { id: "main/home" }));
    await flush();
    socket.receive(request(71, "editor", "device", { preset: "nope" }));
    await flush();

    expect(responses(socket)).toEqual([
      {
        jsonrpc: "2.0",
        id: 70,
        error: {
          code: -32_003,
          message: "[moku-editor] the Flow view has no graph yet",
          data: { reason: "no_graph", retryable: true }
        }
      },
      {
        jsonrpc: "2.0",
        id: 71,
        error: {
          code: -32_602,
          message: "[moku-editor] unknown preset nope",
          data: { reason: "invalid_input", retryable: false, field: "preset" }
        }
      }
    ]);
    expect(ctx.log.warn).toHaveBeenCalledWith("link:request-failed", {
      method: "node",
      code: -32_003,
      reason: "no_graph"
    });
    expect(ctx.log.debug).toHaveBeenCalledWith("link:request-failed", {
      method: "device",
      code: -32_602,
      reason: "invalid_input"
    });
  });

  it("the remover of one method leaves the handlers of the others; twice is a no-op", async () => {
    const socket = await connected(ctx);
    const link = createLinkApi(ctx);
    const select = vi.fn(async (_params: SelectParams) => coins);
    const show = vi.fn((_params: ShowParams) => stateShown);
    link.handle("select", select);
    const removeDevice = link.handle("device", () => pixel);
    link.handle("show", show);

    removeDevice();
    removeDevice();
    socket.receive(request(72, "editor", "device", {}));
    socket.receive(request(73, "editor", "show", {}));
    socket.receive(request(74, "editor", "select", {}));
    await flush();

    expect([72, 73, 74].map(id => outcome(socket, id))).toEqual([-32_601, "ok", "ok"]);
    expect(show).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("a later handler replaces the earlier one of the same method only", async () => {
    const socket = await connected(ctx);
    const link = createLinkApi(ctx);
    const first = vi.fn((_params: ShowParams) => stateShown);
    const second = vi.fn((_params: ShowParams) => stateShown);
    const node = vi.fn((_params: NodeParams) => home);
    link.handle("node", node);
    const removeFirst = link.handle("show", first);
    link.handle("show", second);
    removeFirst();

    socket.receive(request(75, "editor", "show", {}));
    socket.receive(request(76, "editor", "node", { id: "main/home" }));
    await flush();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(node).toHaveBeenCalledTimes(1);
    expect([outcome(socket, 75), outcome(socket, 76)]).toEqual(["ok", "ok"]);
  });

  it("stop forgets the handlers of every method", async () => {
    const link = createLinkApi(ctx);
    link.handle("device", () => pixel);
    link.handle("show", () => stateShown);
    link.handle("node", () => home);
    await connected(ctx);
    expect(ctx.state.handlers.size).toBe(3);

    stopLink(ctx);

    expect(ctx.state.handlers.size).toBe(0);
  });
});

describe("handle types", () => {
  it("infers the params of the method; the result comes with or without a promise", () => {
    const link = createLinkApi(ctx);

    link.handle("device", params => {
      expectTypeOf(params).toEqualTypeOf<DeviceParams>();
      return pixel;
    });
    link.handle("show", async params => {
      expectTypeOf(params).toEqualTypeOf<ShowParams>();
      return stateShown;
    });
    link.handle("node", params => {
      expectTypeOf(params).toEqualTypeOf<NodeParams>();
      return home;
    });
    link.handle("select", async params => {
      expectTypeOf(params).toEqualTypeOf<SelectParams>();
      return coins;
    });

    expectTypeOf(link.handle<"device">)
      .parameter(1)
      .toEqualTypeOf<(params: DeviceParams) => DeviceInfo | Promise<DeviceInfo>>();
    expectTypeOf(link.handle<"node">).returns.toEqualTypeOf<() => void>();
    expect(ctx.state.handlers.size).toBe(4);
  });

  it("rejects a handler that answers the result of another method, or reads its params", () => {
    const link = createLinkApi(ctx);

    // @ts-expect-error — a device handler answers a DeviceInfo, not a ShowInfo
    link.handle("device", () => stateShown);
    // @ts-expect-error — a node handler gets NodeParams: they have no `workspace`
    link.handle("node", params => ({ id: params.workspace, selected: "main/home" }));

    expect(ctx.state.handlers.size).toBe(2);
  });
});

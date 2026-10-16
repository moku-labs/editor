/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../../registry/protocol";
import { notification, request } from "../../../registry/protocol";
import { listenDevices } from "../../device/listen";
import { registerEditorMethods } from "../../routing/editor-methods";
import { mergeServeOptions } from "../../serve";
import type { EditorMethod } from "../../types";
import { createHarness, errorOf, fakeServe, flush, helloOf, pairAdb, resultOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Editor methods of other server plugins (spec 11 § 5.1 H2): registered before
// the server starts, reachable only from tools connections (hub token, loopback
// Host and Origin), counted in the connection's pending calls, a throw answered
// as a wire error. Bug: a phone calling `connect.network`, or a handler that
// throws taking the tools socket down.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * A handler that answers when the test settles it.
 *
 * @returns The handler and the resolvers of its calls.
 */
function heldMethod() {
  const answers: PromiseWithResolvers<Json>[] = [];
  const method = vi.fn<EditorMethod>(() => {
    const answer = Promise.withResolvers<Json>();
    answers.push(answer);
    return answer.promise;
  });
  return { method, answers };
}

describe("a registered editor method on a tools connection", () => {
  it("answers the tools request with its result, called with the params and the caller's connection, counted as pending meanwhile", async () => {
    const harness = createHarness();
    const { method, answers } = heldMethod();
    registerEditorMethods(harness.ctx, { "connect.scan": method });
    const tools = harness.connect("tools");
    tools.clear();

    harness.send(tools, request(4, "editor", "connect.scan", { every: 2000 }));

    expect(method).toHaveBeenCalledWith({ every: 2000 }, { conn: tools.data.conn });
    expect(harness.toolsConn(tools).pending).toBe(1);
    answers[0]?.resolve({ wire: [] });
    await flush();
    expect(resultOf(tools, 4)).toEqual({ wire: [] });
    expect(harness.toolsConn(tools).pending).toBe(0);
  });

  it("answers a throw or a rejection with a wire error and keeps the socket open", async () => {
    const harness = createHarness();
    registerEditorMethods(harness.ctx, {
      "connect.wire": () => {
        throw new Error("adb not found");
      },
      "connect.off": () => Promise.reject(new Error("device mode is off"))
    });
    const tools = harness.connect("tools");

    harness.send(tools, request(1, "editor", "connect.wire"));
    harness.send(tools, request(2, "editor", "connect.off"));
    await flush();

    expect(errorOf(tools, 1)).toMatchObject({ message: expect.stringContaining("adb not found") });
    expect(errorOf(tools, 2)).toMatchObject({
      message: expect.stringContaining("device mode is off")
    });
    expect(tools.closes).toEqual([]);
    expect(harness.toolsConn(tools).pending).toBe(0);
  });

  it("drops the answer of a connection that closed meanwhile", async () => {
    const harness = createHarness();
    const { method, answers } = heldMethod();
    registerEditorMethods(harness.ctx, { "connect.scan": method });
    const tools = harness.connect("tools");
    harness.send(tools, request(4, "editor", "connect.scan"));
    harness.close(tools);
    tools.clear();

    answers[0]?.resolve(null);
    await flush();

    expect(tools.sent).toEqual([]);
  });

  it("keeps the hub's own selection and an unknown name -32601", () => {
    const harness = createHarness();
    registerEditorMethods(harness.ctx, { "connect.scan": async () => null });
    const tools = harness.connect("tools");

    harness.send(tools, request(1, "editor", "selection"));
    harness.send(tools, request(2, "editor", "connect.nope"));

    expect(resultOf(tools, 1)).toBeNull();
    expect(errorOf(tools, 2)).toMatchObject({ code: -32_601 });
  });
});

describe("agents never reach an editor method", () => {
  it("refuses a game page's request -32007 and never calls the method", () => {
    const harness = createHarness();
    const network = vi.fn<EditorMethod>(async () => null);
    registerEditorMethods(harness.ctx, { "connect.network": network });
    const { agent } = harness.hello();

    harness.send(agent, request(1, "editor", "connect.network"));

    expect(errorOf(agent, 1)).toMatchObject({ code: -32_007, data: { reason: "unauthorized" } });
    expect(network).not.toHaveBeenCalled();
  });

  it("refuses a paired phone's request -32007 (bug: a phone calling connect.network)", async () => {
    const harness = createHarness();
    const network = vi.fn<EditorMethod>(async () => null);
    registerEditorMethods(harness.ctx, { "connect.network": network });
    await listenDevices(harness.ctx, { confirm: async () => true }, harness.handler, {
      serve: fakeServe().serve,
      interfaces: () => ({})
    });
    const { socket } = pairAdb(harness);
    harness.send(socket, helloOf());
    socket.clear();

    harness.send(socket, request(1, "editor", "connect.network"));
    harness.send(socket, notification("editor", "connect.network"));

    expect(errorOf(socket, 1)).toMatchObject({ code: -32_007 });
    expect(network).not.toHaveBeenCalled();
  });
});

describe("registerEditorMethods", () => {
  it("throws after serve() and after listenDevices(): the methods are frozen with the routes", async () => {
    const served = createHarness();
    mergeServeOptions(served.ctx, {}, served.handler);
    expect(() => registerEditorMethods(served.ctx, { "connect.scan": async () => null })).toThrow(
      /^\[moku-editor] hub\.addEditorMethods\(\) ran after hub\.serve\(\) or hub\.listenDevices\(\)\.\n {2}Register editor methods in onInit, before the server starts\.$/
    );

    const listening = createHarness();
    await listenDevices(listening.ctx, { confirm: async () => false }, listening.handler, {
      serve: fakeServe().serve,
      interfaces: () => ({})
    });
    expect(() =>
      registerEditorMethods(listening.ctx, { "connect.scan": async () => null })
    ).toThrow(/ran after hub\.serve\(\) or hub\.listenDevices\(\)/);
  });

  it("refuses a name registered before, a name of the hub and a name without a dot, and registers nothing of a refused batch", () => {
    const harness = createHarness();
    registerEditorMethods(harness.ctx, { "connect.scan": async () => null });

    expect(() =>
      registerEditorMethods(harness.ctx, {
        "connect.wire": async () => null,
        "connect.scan": async () => null
      })
    ).toThrow(
      /^\[moku-editor] hub\.addEditorMethods\(\) got the name "connect\.scan" twice\.\n {2}Register each editor method once\.$/
    );
    expect(() => registerEditorMethods(harness.ctx, { select: async () => null })).toThrow(
      /^\[moku-editor] hub\.addEditorMethods\(\) refuses the name "select": the hub answers or relays it itself\.\n {2}/
    );
    expect(() => registerEditorMethods(harness.ctx, { scan: async () => null })).toThrow(
      /^\[moku-editor] hub\.addEditorMethods\(\) refuses the name "scan": editor methods are named <plugin>\.<verb>\.\n {2}Use a name like "connect\.scan"\.$/
    );
    expect([...harness.ctx.state.editorMethods.keys()]).toEqual(["connect.scan"]);
  });

  it("refuses a handler that is not a function with a TypeError", () => {
    const harness = createHarness();
    const methods: { [name: string]: EditorMethod } = JSON.parse('{"connect.scan":"yes"}');

    expect(() => registerEditorMethods(harness.ctx, methods)).toThrow(TypeError);
    expect(harness.ctx.state.editorMethods.size).toBe(0);
  });
});

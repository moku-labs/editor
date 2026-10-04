import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HotReload } from "../../../registry/protocol";
import { createLinkApi } from "../../api";
import { stopLink } from "../../lifecycle";
import { addHotReloadListener, requestHotReload } from "../../server/hot-reload";
import { onSocketMessage } from "../../socket/messages";
import { BOOT, connected, createCtx, FakeWebSocket, flush, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// link hot reload (R6): the hub's editor.hotReload notification is stored and
// given to the listeners; setHotReload POSTs {path}/hmr with the boot token.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let socket: FakeWebSocket;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  FakeWebSocket.instances.length = 0;
  ctx = createCtx();
  socket = await connected(ctx);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** One POST the stubbed fetch recorded. */
type Posted = { url: string; init: RequestInit | undefined };

/**
 * Stubs fetch with one answer and records the calls.
 *
 * @param answer - The response, or an error to reject with.
 * @returns The recorded calls.
 */
function stubFetch(answer: Response | Error): Posted[] {
  const calls: Posted[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return calls;
}

describe("editor.hotReload notification", () => {
  it("is stored and hotReload() returns a copy", () => {
    const api = createLinkApi(ctx);
    expect(api.hotReload()).toBeUndefined();

    socket.notify("editor", "hotReload", { hmr: true, owner: "bin" });

    const first = api.hotReload();
    expect(first).toEqual({ hmr: true, owner: "bin" });
    if (first !== undefined) Reflect.set(first, "hmr", false);
    expect(api.hotReload()).toEqual({ hmr: true, owner: "bin" });
  });

  it("calls each listener on a change only, with a frozen state", () => {
    const seen: HotReload[] = [];
    addHotReloadListener(ctx, state => seen.push(state));

    socket.notify("editor", "hotReload", { hmr: true, owner: "bin" });
    socket.notify("editor", "hotReload", { hmr: true, owner: "bin" });
    socket.notify("editor", "hotReload", { hmr: false, owner: "bin" });

    expect(seen).toEqual([
      { hmr: true, owner: "bin" },
      { hmr: false, owner: "bin" }
    ]);
    expect(Object.isFrozen(seen[0])).toBe(true);
  });

  it("calls a new listener at once when the state is known", () => {
    socket.notify("editor", "hotReload", { hmr: false, owner: "server" });
    const listener = vi.fn();

    addHotReloadListener(ctx, listener);

    expect(listener).toHaveBeenCalledWith({ hmr: false, owner: "server" });
  });

  it("drops a malformed notification with a warning", () => {
    onSocketMessage(
      ctx,
      JSON.stringify({ jsonrpc: "2.0", channel: "editor", method: "hotReload", params: { hmr: 1 } })
    );
    socket.notify("editor", "hotReload", { hmr: true, owner: "elsewhere" });

    expect(createLinkApi(ctx).hotReload()).toBeUndefined();
    expect(ctx.log.warn).toHaveBeenCalledWith("link:bad-hot-reload", {});
  });

  it("a throwing listener is logged; the others still run; unsubscribe is idempotent", () => {
    const after = vi.fn();
    addHotReloadListener(ctx, () => {
      throw new Error("boom");
    });
    const stop = addHotReloadListener(ctx, after);

    socket.notify("editor", "hotReload", { hmr: true, owner: "bin" });
    expect(after).toHaveBeenCalledTimes(1);
    expect(ctx.log.error).toHaveBeenCalledWith(
      "link:hot-reload-listener-failed",
      {},
      expect.any(Error)
    );

    stop();
    stop();
    socket.notify("editor", "hotReload", { hmr: false, owner: "bin" });
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("stop forgets the listeners", () => {
    const listener = vi.fn();
    addHotReloadListener(ctx, listener);
    stopLink(ctx);
    ctx.state.stopped = false;
    onSocketMessage(
      ctx,
      JSON.stringify({
        jsonrpc: "2.0",
        channel: "editor",
        method: "hotReload",
        params: { hmr: true, owner: "bin" }
      })
    );
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("setHotReload", () => {
  it("POSTs {path}/hmr on the page origin with the boot token as a Bearer", async () => {
    const calls = stubFetch(Response.json({ hmr: true, owner: "bin" }));
    vi.stubGlobal("location", { href: "http://127.0.0.1:4100/__editor/#game" });

    await expect(requestHotReload(ctx, true)).resolves.toBe(true);

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe("http://127.0.0.1:4100/__editor/hmr");
    expect(call?.init?.method).toBe("POST");
    expect(call?.init?.body).toBe('{"hmr":true}');
    expect(new Headers(call?.init?.headers).get("authorization")).toBe(`Bearer ${BOOT.token}`);
    expect(call?.init?.credentials).toBe("same-origin");
  });

  it("answers false on a 200 whose state differs from the asked value, and takes that state", async () => {
    stubFetch(Response.json({ hmr: true, owner: "bin" }));
    const listener = vi.fn();
    addHotReloadListener(ctx, listener);

    await expect(createLinkApi(ctx).setHotReload(false)).resolves.toBe(false);

    expect(createLinkApi(ctx).hotReload()).toEqual({ hmr: true, owner: "bin" });
    expect(listener).toHaveBeenCalledWith({ hmr: true, owner: "bin" });
  });

  it("answers false on a non-ok answer, even when its state matches", async () => {
    stubFetch(Response.json({ hmr: false, owner: "bin" }, { status: 401 }));
    await expect(requestHotReload(ctx, false)).resolves.toBe(false);
  });

  it("answers false on a 200 without a readable state", async () => {
    stubFetch(new Response("nope"));
    await expect(requestHotReload(ctx, true)).resolves.toBe(false);
  });

  it("answers false without a boot, without calling fetch", async () => {
    const calls = stubFetch(Response.json({ hmr: true, owner: "bin" }));
    ctx.state.boot = undefined;
    await expect(requestHotReload(ctx, true)).resolves.toBe(false);
    expect(calls).toEqual([]);
  });

  it("answers false and warns when fetch fails, never rejecting", async () => {
    stubFetch(new Error("offline"));
    await expect(requestHotReload(ctx, true)).resolves.toBe(false);
    expect(ctx.log.warn).toHaveBeenCalledWith("link:hot-reload-failed", { hmr: true });
  });

  it("answers false for 401 and keeps the state for a body that is not a state", async () => {
    stubFetch(new Response("unauthorized", { status: 401 }));
    await expect(requestHotReload(ctx, false)).resolves.toBe(false);
    await flush();
    expect(createLinkApi(ctx).hotReload()).toBeUndefined();
  });

  it("uses the http origin of the boot socket outside a page", async () => {
    const calls = stubFetch(Response.json({ hmr: true, owner: "bin" }));
    vi.stubGlobal("location", undefined);

    await requestHotReload(ctx, true);

    expect(calls[0]?.url).toBe("http://127.0.0.1:3000/__editor/hmr");
  });
});

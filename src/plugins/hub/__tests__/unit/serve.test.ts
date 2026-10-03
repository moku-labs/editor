/* eslint-disable sonarjs/publicly-writable-directories, sonarjs/no-hardcoded-ip -- refused unix and LAN options are the cases under test */
import { describe, expect, it } from "vitest";
import { mergeServeOptions, registerRoutes, serveWith } from "../../serve";
import { createSocketHandler } from "../../sockets/handler";
import type { RouteHandler, ServeOptions } from "../../types";
import type { TestCtx } from "../helpers";
import { createCtx, fakeServer, field, keysOf, TOKEN } from "../helpers";

/**
 * A started ctx and its socket handler.
 *
 * @returns The ctx and the handler.
 */
function started() {
  const ctx = createCtx();
  ctx.state.token = TOKEN;
  return { ctx, websocket: createSocketHandler(ctx) };
}

/**
 * Merges options on a fresh started ctx.
 *
 * @param options - The game's options.
 * @returns The merged options.
 */
function merge(options: ServeOptions) {
  const { ctx, websocket } = started();
  return mergeServeOptions(ctx, options, websocket);
}

/**
 * True for a function route.
 *
 * @param value - A route value.
 * @returns Whether it is a handler.
 */
function isHandler(value: unknown): value is RouteHandler {
  return typeof value === "function";
}

const gameRoute = new Response("game");

/**
 * A registered editor route.
 *
 * @returns A response.
 */
function hello(): Response {
  return new Response("hello");
}

/**
 * The game's own fetch.
 *
 * @returns A response.
 */
function mine(): Response {
  return new Response("mine");
}

describe("serve refusals", () => {
  it("throws before start", () => {
    const ctx: TestCtx = createCtx();

    expect(() => mergeServeOptions(ctx, {}, createSocketHandler(ctx))).toThrow(
      /^\[moku-editor] hub\.serve\(\) needs a started app\.\n {2}.+\.$/
    );
  });

  it("throws on a second call", () => {
    const { ctx, websocket } = started();
    mergeServeOptions(ctx, {}, websocket);

    expect(() => mergeServeOptions(ctx, {}, websocket)).toThrow(/^\[moku-editor] .*once/);
  });

  it("throws on a websocket handler from a JS caller (H21)", () => {
    const options: ServeOptions = JSON.parse('{"websocket":{}}');

    expect(() => merge(options)).toThrow(/^\[moku-editor] .*websocket/);
  });

  it("throws on unix and tls (H22)", () => {
    expect(() => merge({ unix: "/tmp/s" })).toThrow(/^\[moku-editor] .*unix/);
    expect(() => merge({ tls: {} })).toThrow(/^\[moku-editor] .*tls/);
  });

  it("refuses 0.0.0.0 (H19)", () => {
    expect(() => merge({ hostname: "0.0.0.0" })).toThrow(
      /^\[moku-editor] hub\.serve\(\) refuses hostname "0\.0\.0\.0": the editor binds 127\.0\.0\.1 only\./
    );
  });

  it("refuses ::, a LAN IP and the empty hostname (H20)", () => {
    for (const hostname of ["::", "[::]", "192.168.1.4", ""]) {
      expect(() => merge({ hostname })).toThrow(`refuses hostname "${hostname}"`);
    }
  });

  it("refuses game routes under the editor path, naming the key (H24)", () => {
    expect(() => merge({ routes: { "/__editor/x": gameRoute } })).toThrow('"/__editor/x"');
    expect(() => merge({ routes: { "/__editor": gameRoute } })).toThrow('"/__editor"');
  });

  it("does not mark the server as served after a refusal", () => {
    const { ctx, websocket } = started();

    expect(() => mergeServeOptions(ctx, { hostname: "0.0.0.0" }, websocket)).toThrow();
    expect(ctx.state.served).toBe(false);
    expect(() => mergeServeOptions(ctx, {}, websocket)).not.toThrow();
  });
});

describe("serve options", () => {
  it("binds 127.0.0.1 for no hostname, localhost and 127.0.0.1 (H23)", () => {
    expect(merge({}).hostname).toBe("127.0.0.1");
    expect(merge({ hostname: "localhost" }).hostname).toBe("127.0.0.1");
    expect(merge({ hostname: "127.0.0.1" }).hostname).toBe("127.0.0.1");
  });

  it("merges game routes, registered routes and the socket route", () => {
    const { ctx, websocket } = started();
    registerRoutes(ctx, { "/__editor/hello": hello });

    const merged = mergeServeOptions(
      ctx,
      { routes: { "/": gameRoute, "/__editorx": gameRoute } },
      websocket
    );

    expect(Object.keys(merged.routes).toSorted()).toEqual([
      "/",
      "/__editor/hello",
      "/__editor/ws",
      "/__editorx"
    ]);
    expect(merged.routes["/"]).toBe(gameRoute);
    expect(merged.routes["/__editor/hello"]).toBe(hello);
    expect(ctx.state.served).toBe(true);
  });

  it("mounts the upgrade handler at {path}/ws", () => {
    const { ctx, websocket } = started();
    const server = fakeServer(4000);
    const route = mergeServeOptions(ctx, {}, websocket).routes["/__editor/ws"];
    const request = new Request(`http://127.0.0.1:4000/__editor/ws?token=${TOKEN}&kind=tools`, {
      headers: { host: "127.0.0.1:4000", origin: "http://127.0.0.1:4000", upgrade: "websocket" }
    });

    expect(isHandler(route)).toBe(true);
    if (!isHandler(route)) return;
    expect(route(request, server)).toBeUndefined();
    expect(server.upgrade).toHaveBeenCalledTimes(1);
  });

  it("falls back to a 404 fetch and keeps a given fetch", async () => {
    const fallback = merge({}).fetch(new Request("http://127.0.0.1:1/x"), fakeServer());
    const response = await fallback;

    expect(response.status).toBe(404);
    expect(merge({ fetch: mine }).fetch).toBe(mine);
  });

  it("adds the hub websocket handler and passes other keys through", () => {
    const { ctx, websocket } = started();
    const merged = mergeServeOptions(ctx, { port: 3000, development: true }, websocket);

    expect(merged.websocket).toBe(websocket);
    expect(merged.port).toBe(3000);
    expect(merged.development).toBe(true);
  });

  it("serveWith returns the merged options for Bun.serve", () => {
    const { ctx, websocket } = started();
    const options = serveWith(ctx, { port: 0 }, websocket);

    expect(field(options, "hostname")).toBe("127.0.0.1");
    expect(field(options, "websocket")).toBe(websocket);
    expect(keysOf(field(options, "routes"))).toEqual(["/__editor/ws"]);
  });
});

describe("registerRoutes (addRoutes)", () => {
  it("accepts the path itself and keys under it", () => {
    const { ctx } = started();

    registerRoutes(ctx, { "/__editor": gameRoute, "/__editor/assets/*": gameRoute });
    expect([...ctx.state.routes.keys()]).toEqual(["/__editor", "/__editor/assets/*"]);
  });

  it("throws after serve", () => {
    const { ctx, websocket } = started();
    mergeServeOptions(ctx, {}, websocket);

    expect(() => registerRoutes(ctx, { "/__editor/x": gameRoute })).toThrow(/^\[moku-editor] /);
  });

  it("throws on a key registered twice", () => {
    const { ctx } = started();
    registerRoutes(ctx, { "/__editor/x": gameRoute });

    expect(() => registerRoutes(ctx, { "/__editor/x": gameRoute })).toThrow('"/__editor/x"');
  });

  it("throws on the socket route and on keys outside the path", () => {
    const { ctx } = started();

    expect(() => registerRoutes(ctx, { "/__editor/ws": gameRoute })).toThrow('"/__editor/ws"');
    expect(() => registerRoutes(ctx, { "/other": gameRoute })).toThrow('"/other"');
    expect(() => registerRoutes(ctx, { "/__editorx": gameRoute })).toThrow('"/__editorx"');
    expect(ctx.state.routes.size).toBe(0);
  });

  it("works before start (pages registers in onInit)", () => {
    const ctx = createCtx();

    expect(() => registerRoutes(ctx, { "/__editor/hello": gameRoute })).not.toThrow();
  });
});

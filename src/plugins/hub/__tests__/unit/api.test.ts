/* eslint-disable sonarjs/no-clear-text-protocols, unicorn/consistent-function-scoping, unicorn/no-null -- local http URLs; compile-only arrows stay next to their type assertion; null is the published "nothing selected" */
import { describe, expect, expectTypeOf, it } from "vitest";
import { createServerCore, serverCoreConfig } from "../../../../config";
import { filesPlugin } from "../../../files";
import type {
  HotReload,
  PublishMethod,
  PublishParams,
  SelectionInfo,
  SessionInfo
} from "../../../registry/protocol";
import { hubPlugin } from "../..";
import { createHubApi } from "../../api";
import { validateHubConfig } from "../../init";
import { startHub, stopHub } from "../../lifecycle";
import type {
  BunServeOptions,
  HubApi,
  HubCtx,
  PublishMethod as HubPublishMethod,
  HubSession
} from "../../types";
import { createCtx, fakeServer, field, helloOf, keysOf, MANIFEST } from "../helpers";

/**
 * A ctx and its api.
 *
 * @param allowOrigins - Extra origins.
 * @returns The ctx and the api.
 */
function setup(allowOrigins: readonly string[] = []) {
  const ctx = createCtx({ allowOrigins });
  validateHubConfig(ctx);
  return { ctx, api: createHubApi(ctx) };
}

describe("hub api", () => {
  it("token() throws before start and after stop, returns the token in between", () => {
    const { ctx, api } = setup();

    expect(() => api.token()).toThrow(/^\[moku-editor] hub\.token\(\) /);
    startHub(ctx);
    expect(api.token()).toBe(ctx.state.token);
    expect(api.token()).toHaveLength(43);
    stopHub(ctx);
    expect(() => api.token()).toThrow(/^\[moku-editor] /);
  });

  it("sessions() returns fresh copies ordered by connectedAt", () => {
    const { ctx, api } = setup();
    startHub(ctx);
    const agent = {
      data: { kind: "agent" as const, conn: 1 },
      send: () => 1,
      close: () => undefined
    };
    api.websocket.open(agent);
    api.websocket.message(agent, JSON.stringify(helloOf()));

    const first = api.sessions();
    first.pop();
    const second = api.sessions();

    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ game: MANIFEST.game, embedded: false });
    expect(second).not.toBe(api.sessions());
    stopHub(ctx);
  });

  it("path() is config.path", () => {
    const ctx = createCtx({ path: "/tools" });

    expect(createHubApi(ctx).path()).toBe("/tools");
  });

  it("guard() uses the origins built in onInit", () => {
    const { api } = setup(["http://192.168.1.4:3000"]);
    const request = new Request("http://127.0.0.1:4000/__editor/hello", {
      headers: { host: "127.0.0.1:4000", origin: "http://192.168.1.4:3000" }
    });

    expect(api.guard(request, fakeServer(4000), "same-origin")).toBeUndefined();
    expect(api.guard(request, fakeServer(4001), "same-origin")?.status).toBe(403);
  });

  it("fetch() is the upgrade handler", () => {
    const { api } = setup();

    expect(api.fetch(new Request("http://127.0.0.1:4000/x"), fakeServer())?.status).toBe(404);
    expect(api.fetch(new Request("http://127.0.0.1:4000/__editor/ws"), fakeServer())?.status).toBe(
      503
    );
  });

  it("websocket is one handler with the spec limits", () => {
    const { api } = setup();

    expect(api.websocket.maxPayloadLength).toBe(32 * 1024 * 1024);
    expect(api.websocket.idleTimeout).toBe(60);
    expect(api.websocket.perMessageDeflate).toBe(false);
  });

  it("addRoutes() registers routes serve() merges, and refuses after serve()", () => {
    const { ctx, api } = setup();
    const hello = new Response("hello");
    api.addRoutes({ "/__editor/hello": hello });
    startHub(ctx);

    const options = api.serve({ port: 0 });

    expect(keysOf(field(options, "routes")).toSorted()).toEqual([
      "/__editor/hello",
      "/__editor/ws"
    ]);
    expect(field(options, "websocket")).toBe(api.websocket);
    expect(() => api.addRoutes({ "/__editor/late": hello })).toThrow(/^\[moku-editor] /);
    expect(() => api.serve({ port: 0 })).toThrow(/^\[moku-editor] /);
    stopHub(ctx);
  });

  it("serve() throws before start", () => {
    const { api } = setup();

    expect(() => api.serve({})).toThrow(/needs a started app/);
  });
});

describe("hub types", () => {
  const framework = createServerCore(serverCoreConfig, { plugins: [filesPlugin, hubPlugin] });
  const app = framework.createApp();

  it("serve returns what Bun.serve accepts", () => {
    expectTypeOf(app.hub.serve).returns.toEqualTypeOf<BunServeOptions>();
    const compileOnly = () => Bun.serve(app.hub.serve({ port: 0 }));
    expectTypeOf(compileOnly).toBeFunction();
  });

  it("sessions is the protocol's SessionInfo[] (no silent flag)", () => {
    expectTypeOf(app.hub.sessions).returns.toEqualTypeOf<SessionInfo[]>();
    const read = () => {
      const [first] = app.hub.sessions();
      // @ts-expect-error — SessionInfo has no silent flag (R1)
      return first?.silent;
    };
    expectTypeOf(read).toBeFunction();
  });

  it("refuses a websocket handler in serve options", () => {
    const compileOnly = () =>
      // @ts-expect-error — the editor owns the one websocket handler
      app.hub.serve({ websocket: {} });
    expectTypeOf(compileOnly).toBeFunction();
  });

  it("types the hub:session emit", () => {
    const emitOpen = (ctx: HubCtx) => ctx.emit("hub:session", { id: "s-1", game: "g", open: true });
    const emitBad = (ctx: HubCtx) =>
      // @ts-expect-error — game and open are required
      ctx.emit("hub:session", { id: "s-1" });
    expectTypeOf(emitOpen).toBeFunction();
    expectTypeOf(emitBad).toBeFunction();
    expectTypeOf<HubSession["reason"]>().toEqualTypeOf<"bye" | "game_reloaded" | undefined>();
  });

  it("does not expose the state on the app", () => {
    const peek = () =>
      // @ts-expect-error — state stays private
      app.hub.state;
    expectTypeOf(peek).toBeFunction();
  });

  it("publish takes the params of its method: a wrong pair is a type error", () => {
    expectTypeOf<HubPublishMethod>().toEqualTypeOf<PublishMethod>();
    expectTypeOf<Parameters<HubApi["publish"]>>().toEqualTypeOf<
      [method: PublishMethod, params: PublishParams[PublishMethod]]
    >();
    const hotReload = () => app.hub.publish("hotReload", { hmr: true, owner: "bin" });
    const cleared = () => app.hub.publish("selection", null);
    const wrongPair = (info: SelectionInfo) =>
      // @ts-expect-error — hotReload takes a HotReload, not a SelectionInfo
      app.hub.publish("hotReload", info);
    const wrongState = (state: HotReload) =>
      // @ts-expect-error — selection takes a SelectionInfo or null, not a HotReload
      app.hub.publish("selection", state);
    const unknownMethod = () =>
      // @ts-expect-error — only hotReload and selection are published
      app.hub.publish("sessions", null);
    expectTypeOf(hotReload).toBeFunction();
    expectTypeOf(cleared).toBeFunction();
    expectTypeOf(wrongPair).toBeFunction();
    expectTypeOf(wrongState).toBeFunction();
    expectTypeOf(unknownMethod).toBeFunction();
  });

  it("closeAll takes a close code and a reason", () => {
    expectTypeOf<HubApi["closeAll"]>().parameters.toEqualTypeOf<[code: number, reason: string]>();
    expectTypeOf<HubApi["closeAll"]>().returns.toBeVoid();
    const noReason = () =>
      // @ts-expect-error — the reason is required
      app.hub.closeAll(1012);
    expectTypeOf(noReason).toBeFunction();
  });

  it("exposes the api surface", () => {
    expectTypeOf(app.hub.token).returns.toEqualTypeOf<string>();
    expectTypeOf(app.hub.path).returns.toEqualTypeOf<string>();
    expectTypeOf(app.hub.fetch).returns.toEqualTypeOf<Response | undefined>();
  });
});

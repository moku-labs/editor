import { describe, expect, expectTypeOf, it } from "vitest";
import type { Require } from "../../../../config";
import { createApp } from "../../../../server";
import type { EditorRoutes } from "../../../hub/types";
import { createPagesApi } from "../../api";
import { parseBinArgs } from "../../args";
import type { BinArgs } from "../../types";
import { createHarness, createLog } from "../helpers";

/**
 * Builds the pages api over a harness state that holds the given routes.
 *
 * @param routes - The routes put in state.
 * @returns The api under test.
 */
function apiWithRoutes(routes: EditorRoutes) {
  const { state, deps } = createHarness(undefined);
  state.routes = routes;
  return createPagesApi({
    config: deps.config,
    state,
    log: createLog(),
    require: () => {
      throw new Error("unused");
    }
  });
}

/**
 * Builds the pages api over a harness whose require answers the fake hub.
 *
 * @returns The api and the harness.
 */
function apiWithHub() {
  const harness = createHarness(undefined);
  const api = createPagesApi({
    config: harness.deps.config,
    state: harness.state,
    log: harness.log,
    require: (() => harness.hub) as unknown as Require
  });
  return { api, harness };
}

describe("createPagesApi hot reload", () => {
  it("hotReload() is owner server with HMR off before attachServer", () => {
    expect(apiWithHub().api.hotReload()).toEqual({ hmr: false, owner: "server" });
  });

  it("attachServer() makes the bin the owner and publishes the state through the hub", () => {
    const { api, harness } = apiWithHub();
    const server = { reload: () => undefined };
    api.attachServer(server, { development: { hmr: true, console: true } } as never);

    expect(api.hotReload()).toEqual({ hmr: true, owner: "bin" });
    expect(harness.hub.publish).toHaveBeenCalledWith("hotReload", { hmr: true, owner: "bin" });
  });

  it("setHotReload() keeps Bun's value and answers whether it is the asked one", async () => {
    const { api, harness } = apiWithHub();
    api.attachServer({ reload: () => undefined }, { development: { hmr: true } } as never);

    await expect(api.setHotReload(true)).resolves.toBe(true);
    await expect(api.setHotReload(false)).resolves.toBe(false);
    expect(api.hotReload().hmr).toBe(true);
    expect(harness.hub.publish).toHaveBeenCalledTimes(3);
  });
});

describe("createPagesApi", () => {
  it("routes() returns a copy of the routes registered in state", () => {
    const page = new Response("x");
    const routes: EditorRoutes = Object.freeze({ "/__editor/x": page });
    const api = apiWithRoutes(routes);
    const copy = api.routes();
    expect(copy).toEqual({ "/__editor/x": page });
    expect(copy).not.toBe(routes);
  });

  it("routes() is not changed by a mutation of an earlier result", () => {
    const page = new Response("x");
    const api = apiWithRoutes({ "/__editor/x": page });
    const first = api.routes();
    expect(Reflect.set(first, "/__editor/added", new Response("y"))).toBe(true);
    expect(Reflect.deleteProperty(first, "/__editor/x")).toBe(true);
    expect(api.routes()).toEqual({ "/__editor/x": page });
  });
});

/**
 * Never called: holds the compile-time rejections.
 *
 * @returns Nothing useful.
 */
function rejected() {
  // @ts-expect-error title is a string
  const app = createApp({ pluginConfigs: { pages: { title: 1 } } });
  // @ts-expect-error state is not part of the api
  return app.pages.state;
}

describe("type surface", () => {
  it("types app.pages.routes() as EditorRoutes and parseBinArgs as BinArgs", () => {
    expectTypeOf<
      ReturnType<ReturnType<typeof createApp>["pages"]["routes"]>
    >().toEqualTypeOf<EditorRoutes>();
    expectTypeOf(parseBinArgs).returns.toEqualTypeOf<BinArgs>();
  });

  it("rejects a wrong config type and hides state", () => {
    expectTypeOf(rejected).toBeFunction();
  });
});

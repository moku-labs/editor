import { describe, expect, expectTypeOf, it } from "vitest";
import { createApp } from "../../../../server";
import type { EditorRoutes } from "../../../hub/types";
import { createPagesApi } from "../../api";
import { parseBinArgs } from "../../args";
import type { BinArgs } from "../../types";
import { createHarness, createLog } from "../helpers";

describe("createPagesApi", () => {
  it("routes() returns the object registered in state", () => {
    const { state, deps } = createHarness(undefined);
    const routes: EditorRoutes = Object.freeze({ "/__editor/x": new Response("x") });
    state.routes = routes;
    const api = createPagesApi({
      config: deps.config,
      state,
      log: createLog(),
      require: () => {
        throw new Error("unused");
      }
    });
    expect(api.routes()).toBe(routes);
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

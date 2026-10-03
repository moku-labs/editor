import { describe, expectTypeOf, it } from "vitest";
import { createToolsCore, toolsCoreConfig } from "../../../../config";
import { linkPlugin } from "../../../link";
import { panelsPlugin } from "../../../panels";
import type { Json } from "../../../registry/protocol";
import { workspacePlugin } from "../../../workspace";
import { stateViewPlugin } from "../..";
import type { Config, LastCommit, StatePatch, StateViewApi, TrackerNote } from "../../types";

const framework = createToolsCore(toolsCoreConfig, {
  plugins: [linkPlugin, workspacePlugin, panelsPlugin, stateViewPlugin]
});

type App = ReturnType<typeof framework.createApp>;

/**
 * Compile-time only: expandAll takes player and session, never rng.
 *
 * @param app - The tools app.
 */
function checkRoots(app: App): void {
  app.stateView.expandAll("player", true);
  // @ts-expect-error — rng is never a tree root
  app.stateView.expandAll("rng", true);
}

describe("stateView types", () => {
  it("types the app surface", () => {
    expectTypeOf<App["stateView"]>().toEqualTypeOf<StateViewApi>();
    expectTypeOf<App["stateView"]["lastCommit"]>().returns.toEqualTypeOf<LastCommit | undefined>();
    expectTypeOf<App["stateView"]["note"]>().returns.toEqualTypeOf<TrackerNote>();
    expectTypeOf<App["stateView"]["graph"]>().returns.toEqualTypeOf<Json | undefined>();
    expectTypeOf<App["stateView"]["onCommit"]>().returns.toEqualTypeOf<() => void>();
  });

  it("types the patch op and the expandAll roots", () => {
    expectTypeOf<StatePatch["op"]>().toEqualTypeOf<"add" | "remove" | "replace">();
    expectTypeOf(checkRoots).toBeFunction();
  });

  it("keeps Config a plain record", () => {
    expectTypeOf<Config>().toExtend<Record<string, unknown>>();
    expectTypeOf<Config>().toEqualTypeOf<{
      expandDepth: number;
      maxPatches: number;
      pageSize: number;
    }>();
  });
});

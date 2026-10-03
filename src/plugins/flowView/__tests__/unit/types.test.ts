import { describe, expect, expectTypeOf, it } from "vitest";
import type { ToolsEvents } from "../../../../config";
import { createToolsCore, toolsCoreConfig } from "../../../../config";
import { linkPlugin } from "../../../link";
import { panelsPlugin } from "../../../panels";
import type { RunResult } from "../../../registry/protocol";
import { workspacePlugin } from "../../../workspace";
import { flowViewPlugin } from "../..";
import type { NoteFile, NoteInput } from "../../notes/types";
import type { Camera, FlowViewApi, ItemKey, NodeId } from "../../types";

const framework = createToolsCore(toolsCoreConfig, {
  plugins: [linkPlugin, workspacePlugin, panelsPlugin, flowViewPlugin]
});

type App = ReturnType<typeof framework.createApp>;

/** Reads a member the api does not have. */
function surface(app: App): unknown {
  // @ts-expect-error — the state is never exposed
  return app.flowView.state;
}

describe("flowView types", () => {
  it("exposes the namespaced api on the app", () => {
    expectTypeOf<App["flowView"]>().toEqualTypeOf<FlowViewApi>();
    expectTypeOf<App["flowView"]["camera"]["fitAll"]>().toEqualTypeOf<() => void>();
    expectTypeOf<App["flowView"]["camera"]["get"]>().toEqualTypeOf<() => Camera>();
    expectTypeOf<App["flowView"]["focus"]["select"]>()
      .parameter(0)
      .toEqualTypeOf<ItemKey | NodeId | undefined>();
    expectTypeOf<App["flowView"]["focus"]["select"]>().returns.toEqualTypeOf<boolean>();
    expectTypeOf<App["flowView"]["focus"]["step"]>().returns.toEqualTypeOf<
      Promise<RunResult | undefined>
    >();
    expectTypeOf<App["flowView"]["notes"]["create"]>().returns.toEqualTypeOf<Promise<NoteFile>>();
    expect(flowViewPlugin.name).toBe("flowView");
  });

  it("requires a title for a note and hides the state", () => {
    // @ts-expect-error — a note needs a title
    const missing: NoteInput = { body: "no title" };
    const ok: NoteInput = { title: "First wood 4" };
    expect([missing, ok]).toHaveLength(2);
    expect(surface).toBeTypeOf("function");
  });

  it("declares no events of its own; workspace:open-file and workspace:new-note are typed from the tools core", () => {
    const probe = framework.createPlugin("typesProbe", {
      onInit: ctx => {
        ctx.emit("workspace:open-file", { path: "nodes/merge.ts" });
        // @ts-expect-error — the payload names the path `path`
        ctx.emit("workspace:open-file", { file: "nodes/merge.ts" });
        // @ts-expect-error — flowView declares no events
        ctx.emit("flowView:anything", {});
      }
    });
    expect(probe.name).toBe("typesProbe");
    expectTypeOf<ToolsEvents["workspace:new-note"]>().toEqualTypeOf<{
      captures?: readonly string[];
      from?: { node: string; outcome?: string };
    }>();
  });
});

import { describe, expectTypeOf, it } from "vitest";
import { createToolsCore, toolsCoreConfig } from "../../../../config";
import { linkPlugin } from "../../../link";
import { panelsPlugin } from "../../../panels";
import type { NodeRef } from "../../../registry/protocol";
import { workspacePlugin } from "../../../workspace";
import { filesViewPlugin } from "../..";
import type { Config, FilesViewApi, SaveResult, UsedBy } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Type-level checks: SaveResult narrows on kind, the app surface, rejected
// arguments, Config is a plain record.
// ─────────────────────────────────────────────────────────────────────────────

const framework = createToolsCore(toolsCoreConfig, {
  plugins: [linkPlugin, workspacePlugin, panelsPlugin, filesViewPlugin]
});

type App = ReturnType<typeof framework.createApp>;

describe("filesView types", () => {
  it("SaveResult narrows on kind", () => {
    const result = {
      kind: "saved",
      path: "a.ts",
      bytes: 1,
      version: "v",
      reload: false
    } as SaveResult;
    if (result.kind === "saved") expectTypeOf(result.version).toEqualTypeOf<string>();
    if (result.kind === "failed") expectTypeOf(result.code).toEqualTypeOf<number | undefined>();
  });

  it("app.filesView is the FilesViewApi and usedBy returns UsedBy", () => {
    expectTypeOf<App["filesView"]>().toEqualTypeOf<FilesViewApi>();
    expectTypeOf<FilesViewApi["usedBy"]>().returns.toEqualTypeOf<UsedBy>();
    expectTypeOf<FilesViewApi["fileOf"]>().parameter(0).toEqualTypeOf<NodeRef>();
  });

  it("rejects an unknown conflict choice and an unknown mode", () => {
    const api = {} as FilesViewApi;
    const reject = (): void => {
      // @ts-expect-error — the choice is "reload" or "overwrite"
      api.resolveConflict("nodes/merge.ts", "merge").catch(() => undefined);
      // @ts-expect-error — the mode is "preview" or "source"
      api.setMode("a.md", "split");
    };
    expectTypeOf(reject).toBeFunction();
  });

  it("Config satisfies Record<string, unknown>", () => {
    expectTypeOf<Config>().toExtend<Record<string, unknown>>();
  });
});

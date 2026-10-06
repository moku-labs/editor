import { describe, expect, expectTypeOf, it } from "vitest";
import { createToolsCore, toolsCoreConfig } from "../../../../config";
import type {
  FileBinary,
  Json,
  LinkStatus,
  Manifest,
  ProjectFound,
  ProjectState,
  RunResult,
  SelectionInfo,
  SelectParams,
  SessionInfo,
  Tap,
  ToolsBoot,
  WriteResult
} from "../../../registry/protocol";
import { linkPlugin } from "../..";

// ─────────────────────────────────────────────────────────────────────────────
// Type-level surface of app.link and the link:status event
// ─────────────────────────────────────────────────────────────────────────────

const framework = createToolsCore(toolsCoreConfig, { plugins: [linkPlugin] });

describe("link types", () => {
  it("app.link carries the remote EditorChannel", () => {
    const app = framework.createApp({});
    expectTypeOf(app.link.read).returns.toEqualTypeOf<Promise<Json>>();
    expectTypeOf(app.link.run).returns.toEqualTypeOf<Promise<RunResult>>();
    expectTypeOf(app.link.status).returns.toEqualTypeOf<LinkStatus>();
    expectTypeOf(app.link.watch).returns.toEqualTypeOf<() => void>();
    expect(typeof app.link.watch).toBe("function");
  });

  it("app.link carries sessions, manifest, boot and files", () => {
    const app = framework.createApp({});
    expectTypeOf(app.link.manifest).returns.toEqualTypeOf<Manifest | undefined>();
    expectTypeOf(app.link.sessions).returns.toEqualTypeOf<readonly SessionInfo[]>();
    expectTypeOf(app.link.session).returns.toEqualTypeOf<string | undefined>();
    expectTypeOf(app.link.choose).returns.toEqualTypeOf<Promise<Manifest>>();
    expectTypeOf(app.link.boot).returns.toEqualTypeOf<ToolsBoot | undefined>();
    expectTypeOf(app.link.files.write).returns.toEqualTypeOf<Promise<WriteResult>>();
    expectTypeOf(app.link.files.readBinary).returns.toEqualTypeOf<Promise<FileBinary>>();
    expect(typeof app.link.files.readBinary).toBe("function");
  });

  it("app.link carries onTap and heap", () => {
    const app = framework.createApp({});
    expectTypeOf(app.link.onTap).parameter(0).toEqualTypeOf<(tap: Tap) => void>();
    expectTypeOf(app.link.onTap).returns.toEqualTypeOf<() => void>();
    expectTypeOf(app.link.heap).returns.toEqualTypeOf<
      { usedMb: number; limitMb: number } | undefined
    >();
    expect(app.link.heap()).toBeUndefined();
  });

  it("app.link carries the editor page: selection, notify and handle", () => {
    const app = framework.createApp({});
    expectTypeOf(app.link.selection).returns.toEqualTypeOf<SelectionInfo | undefined>();
    expectTypeOf(app.link.notify).parameter(0).toEqualTypeOf<"selection">();
    expectTypeOf(app.link.notify).parameter(1).toEqualTypeOf<SelectionInfo | null>();
    expectTypeOf(app.link.handle)
      .parameter(1)
      .toEqualTypeOf<(params: SelectParams) => Promise<SelectionInfo>>();
    expectTypeOf(app.link.handle).returns.toEqualTypeOf<() => void>();
    expect(app.link.selection()).toBeUndefined();
  });

  it("app.link carries the project index: project() and files.find", () => {
    const app = framework.createApp({});
    expectTypeOf(app.link.project).returns.toEqualTypeOf<ProjectState | undefined>();
    expectTypeOf(app.link.files.find).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(app.link.files.find).returns.toEqualTypeOf<Promise<readonly ProjectFound[]>>();
    expect(app.link.project()).toBeUndefined();
  });

  it("rejects an unknown notify or handle method", () => {
    const app = framework.createApp({});
    // @ts-expect-error — the page notifies only its selection
    expect(() => app.link.notify("hotReload", { hmr: true, owner: "bin" })).not.toThrow();
    // @ts-expect-error — the page handles only select
    expect(typeof app.link.handle("selection", async () => ({}))).toBe("function");
  });

  it("rejects a watch without its arguments and a link:status without frame", () => {
    const app = framework.createApp({});
    // @ts-expect-error — watch needs input and onValue
    expect(() => app.link.watch("game.graph")).toBeTypeOf("function");
    // @ts-expect-error — live needs a frame
    app.emit("link:status", { status: { kind: "live" } });
    expectTypeOf(app.emit).toBeFunction();
  });
});

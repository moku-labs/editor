import { describe, expect, expectTypeOf, it } from "vitest";
import { createToolsCore, toolsCoreConfig } from "../../../../config";
import type {
  FileBinary,
  Json,
  LinkStatus,
  Manifest,
  RunResult,
  SessionInfo,
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

  it("rejects a watch without its arguments and a link:status without frame", () => {
    const app = framework.createApp({});
    // @ts-expect-error — watch needs input and onValue
    expect(() => app.link.watch("game.graph")).toBeTypeOf("function");
    // @ts-expect-error — live needs a frame
    app.emit("link:status", { status: { kind: "live" } });
    expectTypeOf(app.emit).toBeFunction();
  });
});

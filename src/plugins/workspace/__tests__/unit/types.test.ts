import { describe, expect, expectTypeOf, it } from "vitest";
import type { ToolsEvents } from "../../../../config";
import { createToolsCore, toolsCoreConfig } from "../../../../config";
import { linkPlugin } from "../../../link";
import type { DeviceSpec, HotReload } from "../../../registry/protocol";
import { workspacePlugin } from "../..";
import type {
  Density,
  DensityChoice,
  DeviceChoice,
  DevicePresetId,
  GameFrame,
  Prefs,
  PreviewState,
  RanEvent,
  ReloadResult,
  Theme,
  WorkspaceId
} from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Type-level surface of app.workspace and the global workspace events
// ─────────────────────────────────────────────────────────────────────────────

const framework = createToolsCore(toolsCoreConfig, { plugins: [linkPlugin, workspacePlugin] });

describe("workspace types", () => {
  it("app.workspace carries the R4 api", () => {
    const app = framework.createApp({});
    expectTypeOf(app.workspace.active()).toEqualTypeOf<WorkspaceId>();
    expectTypeOf(app.workspace.theme()).toEqualTypeOf<Theme>();
    expectTypeOf(app.workspace.device()).toEqualTypeOf<DeviceChoice>();
    expectTypeOf(app.workspace.device().preset).toEqualTypeOf<DeviceSpec>();
    expectTypeOf(app.workspace.devices()).toEqualTypeOf<readonly DeviceSpec[]>();
    expectTypeOf(app.workspace.preview).returns.toEqualTypeOf<PreviewState>();
    expectTypeOf(app.workspace.gameFrame()).toEqualTypeOf<GameFrame>();
    expectTypeOf(app.workspace.gameFrame().reload).returns.toEqualTypeOf<Promise<ReloadResult>>();
    expectTypeOf(app.workspace.host).returns.toEqualTypeOf<HTMLElement>();
    expectTypeOf(app.workspace.setOverlayInGame).returns.toEqualTypeOf<Promise<void>>();
    expectTypeOf(app.workspace.density()).toEqualTypeOf<Density>();
    expectTypeOf(app.workspace.setDensity).parameter(0).toEqualTypeOf<DensityChoice>();
    expectTypeOf(app.workspace.reference()).toEqualTypeOf<boolean>();
    expectTypeOf(app.workspace.setReference).parameter(0).toEqualTypeOf<boolean>();
    expectTypeOf(app.workspace.device().folded).toEqualTypeOf<boolean>();
    expectTypeOf(app.workspace.hotReload()).toEqualTypeOf<HotReload | undefined>();
    expectTypeOf(app.workspace.setHotReload).returns.toEqualTypeOf<Promise<boolean>>();
    expectTypeOf(app.workspace.muted()).toEqualTypeOf<boolean>();
    expectTypeOf(app.workspace.setMuted).parameter(0).toEqualTypeOf<boolean>();
    expectTypeOf(app.workspace.setMuted).returns.toEqualTypeOf<void>();
    expectTypeOf<Prefs["muted"]>().toEqualTypeOf<boolean>();
    expect(typeof app.workspace.mount).toBe("function");
  });

  it("DeviceSpec carries dpr, radius, group and frame on every preset; the ids are the twenty-one presets", () => {
    expectTypeOf<DeviceSpec["dpr"]>().toEqualTypeOf<number>();
    expectTypeOf<DeviceSpec["frame"]>().toEqualTypeOf<"modern" | "home-button">();
    expectTypeOf<DeviceSpec["radius"]>().toEqualTypeOf<number>();
    expectTypeOf<DeviceSpec["group"]>().toEqualTypeOf<
      "iphone" | "android" | "foldable" | "tablet" | "desktop"
    >();
    const fold: DevicePresetId = "galaxy-z-fold-6";
    const current: DevicePresetId[] = [
      "iphone-17e",
      "iphone-air",
      "iphone-18-pro",
      "iphone-18-pro-max",
      "iphone-duo"
    ];
    expect(current).toHaveLength(5);
    // @ts-expect-error — not a preset id
    const unknown: DevicePresetId = "nokia";
    expect([fold, unknown]).toHaveLength(2);

    const app = framework.createApp({});
    app.workspace.setDevice({ preset: fold, folded: false });
    expect(app.workspace.device().folded).toBe(false);
  });

  it("rejects an unknown workspace and a Game preview", () => {
    const app = framework.createApp({});
    // @ts-expect-error — not a WorkspaceId
    expect(() => app.workspace.show("nope")).toThrow("[moku-editor]");
    // @ts-expect-error — Game has no preview
    expect(() => app.workspace.setPreview("game", { visible: false })).toBeTypeOf("function");
    expectTypeOf(app.workspace.setPreview).parameter(0).not.toEqualTypeOf<WorkspaceId>();
  });

  it("types the global events: workspace:changed and workspace:ran", () => {
    const app = framework.createApp({});
    // @ts-expect-error — ws must be a WorkspaceId
    app.emit("workspace:changed", { ws: "x" });
    // @ts-expect-error — workspace:ran needs input, origin, at and result
    app.emit("workspace:ran", { id: "game.step", ok: true });
    expectTypeOf<ToolsEvents["workspace:ran"]>().toEqualTypeOf<RanEvent>();
    expectTypeOf<ToolsEvents["workspace:changed"]>().toEqualTypeOf<{ ws: WorkspaceId }>();
    expectTypeOf<ToolsEvents["workspace:density"]>().toEqualTypeOf<{ density: Density }>();
    expectTypeOf<ToolsEvents["workspace:reference"]>().toEqualTypeOf<{ on: boolean }>();
    // @ts-expect-error — density is compact or comfortable, never auto
    app.emit("workspace:density", { density: "auto" });
    expect(typeof app.emit).toBe("function");
  });

  it("a tools plugin without a depends edge hooks the typed workspace events", () => {
    const seen: string[] = [];
    const observer = framework.createPlugin("observer", {
      hooks: () => ({
        "workspace:changed": payload => {
          expectTypeOf(payload.ws).toEqualTypeOf<WorkspaceId>();
          seen.push(payload.ws);
        },
        "workspace:ran": payload => {
          expectTypeOf(payload.origin).toEqualTypeOf<"topbar" | "palette" | "key" | "panel">();
          seen.push(payload.id);
        }
      })
    });
    expect(observer.name).toBe("observer");
    expect(seen).toEqual([]);
  });
});

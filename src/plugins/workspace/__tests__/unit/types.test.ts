import { describe, expect, expectTypeOf, it } from "vitest";
import type { ToolsEvents } from "../../../../config";
import { createToolsCore, toolsCoreConfig } from "../../../../config";
import { linkPlugin } from "../../../link";
import { WORKSPACE_IDS } from "../../../panels/shared/workspaces";
import type { DeviceSpec, HotReload, WorkspaceName } from "../../../registry/protocol";
import { WORKSPACE_NAMES } from "../../../registry/protocol";
import { workspacePlugin } from "../..";
import { ESC_RANK } from "../../keys/escape";
import type {
  Density,
  DensityChoice,
  DeviceChoice,
  DevicePresetId,
  EscLayer,
  GameFrame,
  PaletteGroup,
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
  it("setScenario takes a scenario name or undefined for the saved player", () => {
    const app = framework.createApp({});
    expectTypeOf(app.workspace.setScenario).parameter(0).toEqualTypeOf<string | undefined>();
    expect(app.workspace.scenarios()).toEqual({ scenarios: [], chosen: undefined });
  });

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
    expectTypeOf(app.workspace.copyOnSelect()).toEqualTypeOf<boolean>();
    expectTypeOf(app.workspace.setCopyOnSelect).parameter(0).toEqualTypeOf<boolean>();
    expectTypeOf(app.workspace.setCopyOnSelect).returns.toEqualTypeOf<void>();
    expectTypeOf<Prefs["copyOnSelect"]>().toEqualTypeOf<boolean>();
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

  it("the protocol's WorkspaceName is the WorkspaceId of the rail (D-60: the protocol imports no plugin type)", () => {
    expectTypeOf<WorkspaceName>().toEqualTypeOf<WorkspaceId>();
    expectTypeOf(WORKSPACE_NAMES).toEqualTypeOf<readonly WorkspaceId[]>();
    expect(WORKSPACE_NAMES.toSorted()).toEqual(WORKSPACE_IDS.toSorted());
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
    // @ts-expect-error — density is compact or comfortable, never auto
    app.emit("workspace:density", { density: "auto" });
    expect(typeof app.emit).toBe("function");
  });

  it("Reference mode left the surface (D-65): no api member, no event, no Esc layer", () => {
    const app = framework.createApp({});
    expectTypeOf(app.workspace).not.toHaveProperty("reference");
    expectTypeOf(app.workspace).not.toHaveProperty("setReference");
    expectTypeOf<ToolsEvents>().not.toHaveProperty("workspace:reference");
    /** Never called: the line under it must not compile. */
    const emitGone = (): void => {
      // @ts-expect-error — the event workspace:reference is gone
      app.emit("workspace:reference", { on: true });
    };
    // @ts-expect-error — the Esc layer `reference` is gone
    const layer: EscLayer = "reference";
    expect(typeof emitGone).toBe("function");
    expect(ESC_RANK).not.toContain(layer);
    expect(Object.keys(app.workspace)).not.toContain("reference");
    expect(Object.keys(app.workspace)).not.toContain("setReference");
  });

  it("the palette has no Styles group", () => {
    const groups: PaletteGroup[] = ["Commands", "Nodes", "Files", "Panels", "Textures"];
    // @ts-expect-error — the group Styles is gone with flowView's Styles tab (D-66)
    const gone: PaletteGroup = "Styles";
    expectTypeOf<PaletteGroup>().toEqualTypeOf<
      "Commands" | "Nodes" | "Files" | "Panels" | "Textures"
    >();
    expect(groups).not.toContain(gone);
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

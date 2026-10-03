import { describe, expect, it, vi } from "vitest";
import { createCameraState } from "../../camera/state";
import { createFocusState } from "../../focus/state";
import { createInspectorState } from "../../inspector/state";
import { createLayoutState } from "../../layout/state";
import { createNotesState } from "../../notes/state";
import { createFlowViewState, notify, notifyCamera, subscribe } from "../../state";
import { testConfig } from "../helpers";

describe("module states", () => {
  it("start empty: identity camera, follow off, nothing selected, Info tab, no layout", () => {
    expect(createCameraState()).toEqual({
      cam: { x: 0, y: 0, z: 1 },
      anim: undefined,
      follow: false,
      viewport: { w: 0, h: 0 },
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
      initialised: false
    });
    expect(createFocusState()).toMatchObject({
      selected: undefined,
      edge: undefined,
      strip: false,
      historyOpen: false,
      menu: undefined
    });
    expect(createFocusState().frames.size).toBe(0);
    expect(createInspectorState()).toEqual({
      tab: "info",
      code: undefined,
      codeNote: undefined,
      styles: undefined,
      sources: undefined
    });
    const layout = createLayoutState();
    expect(layout.seq).toBe(0);
    expect(layout.result).toBeUndefined();
    expect(layout.pins).toEqual({ version: 1, nodes: {}, notes: {}, extra: {} });
    expect(layout.pinsReadOnly).toBe(false);
    expect(createNotesState()).toEqual({ files: [], loaded: false, editor: undefined });
  });

  it("gives every call fresh mutable containers", () => {
    expect(createLayoutState().cache).not.toBe(createLayoutState().cache);
    expect(createFocusState().frames).not.toBe(createFocusState().frames);
  });
});

describe("createFlowViewState", () => {
  it("composes the module slices with an empty data slice and view store", () => {
    const state = createFlowViewState({ config: testConfig() });
    expect(state.data).toMatchObject({
      graph: undefined,
      graphHash: "",
      history: [],
      status: { kind: "connecting" },
      stale: false,
      loaded: undefined
    });
    expect(state.view.active).toBe(false);
    expect(state.view.revision).toBe(0);
    expect(state.camera.follow).toBe(false);
    expect(state.inspector.tab).toBe("info");
  });
});

describe("store", () => {
  it("notify bumps the revision and calls data subscribers only", () => {
    const state = createFlowViewState({ config: testConfig() });
    const data = vi.fn();
    const camera = vi.fn();
    const stopData = subscribe(state, data);
    subscribe(state, camera, "camera");
    notify(state);
    expect(state.view.revision).toBe(1);
    expect(data).toHaveBeenCalledTimes(1);
    expect(camera).not.toHaveBeenCalled();
    notifyCamera(state);
    expect(camera).toHaveBeenCalledTimes(1);
    expect(data).toHaveBeenCalledTimes(1);
    stopData();
    notify(state);
    expect(data).toHaveBeenCalledTimes(1);
  });
});

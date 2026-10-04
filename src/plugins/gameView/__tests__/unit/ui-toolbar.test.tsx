// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stopGameView } from "../../lifecycle";
import { DeviceToolbar } from "../../ui/DeviceToolbar";
import { createCtx, flush, manifestOf, type TestCtx } from "../helpers";
import { button, click, find, findAll, type Mounted, mount, settle } from "../ui";

let ctx: TestCtx;
let view: Mounted;

/**
 * The option of a preset in the device select.
 *
 * @param id - The preset id.
 * @returns The option.
 */
function option(id: string): HTMLOptionElement {
  return find<HTMLOptionElement>(view.root, `option[value='${id}']`);
}

beforeEach(() => {
  ctx = createCtx();
  ctx.panels.answers.set("editor.capture", {
    image: "data:image/png;base64,AA",
    frame: 1,
    device: { w: 393, h: 852, orientation: "portrait" }
  });
  view = mount(<DeviceToolbar ctx={ctx} />);
});

afterEach(() => {
  view.unmount();
  stopGameView(ctx);
  document.body.innerHTML = "";
});

describe("DeviceToolbar", () => {
  it("is a toolbar; the picker button is pressed while picking", () => {
    const bar = find(view.root, "[data-game='toolbar']");
    expect(bar.getAttribute("role")).toBe("toolbar");
    const pick = find(view.root, "[data-part='pick']");
    expect(pick.getAttribute("aria-pressed")).toBe("false");

    click(pick);
    expect(ctx.state.picker.on).toBe(true);
    expect(ctx.workspace.show).toHaveBeenCalledWith("game");
    expect(find(view.root, "[data-part='pick']").getAttribute("aria-pressed")).toBe("true");
  });

  it("chooses the device and shows its size; the orientation swaps it", () => {
    const select = find<HTMLSelectElement>(view.root, "select[data-part='device']");
    expect(findAll(select, "option")).toHaveLength(16);
    expect(select.value).toBe("iphone-15");
    expect(find(view.root, "[data-part='size']").textContent).toBe("393 × 852");

    select.value = "pixel-8";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(ctx.workspace.api.setDevice).toHaveBeenCalledWith({ preset: "pixel-8" });

    click(button(view.root, "Landscape"));
    expect(ctx.workspace.api.setDevice).toHaveBeenCalledWith({ orientation: "landscape" });
  });

  it("groups the presets: iPhone, Android, Foldable, Tablet, Desktop", () => {
    const select = find<HTMLSelectElement>(view.root, "select[data-part='device']");
    const groups = findAll<HTMLOptGroupElement>(select, "optgroup");
    expect(groups.map(group => group.label)).toEqual([
      "iPhone",
      "Android",
      "Foldable",
      "Tablet",
      "Desktop"
    ]);
    expect(findAll(groups[0] ?? select, "option").map(option => option.textContent)).toEqual([
      "iPhone SE 3",
      "iPhone 15",
      "iPhone 15 Pro Max",
      "iPhone 16 Pro",
      "iPhone 16 Pro Max"
    ]);
    expect(
      findAll<HTMLOptionElement>(groups[2] ?? select, "option").map(option => option.value)
    ).toEqual(["galaxy-z-fold-6", "galaxy-z-flip-6", "pixel-9-pro-fold"]);
  });

  it("marks the approximate presets in the option title", () => {
    expect(option("redmi-note-13").title).toBe("393×873 · dpr 2.75 · approx: estimated values");
    expect(option("pixel-8").title).toBe("412×915 · dpr 2.625");
  });

  it("shows Fold / Unfold only for a foldable; it switches the screen through workspace", () => {
    expect(view.root.querySelector("[data-action='fold']")).toBeNull();

    view.unmount();
    ctx.workspace.device = { preset: "galaxy-z-fold-6", orientation: "portrait" };
    view = mount(<DeviceToolbar ctx={ctx} />);
    const fold = find(view.root, "[data-action='fold']");
    expect(fold.textContent).toBe("Unfold");
    expect(fold.getAttribute("title")).toBe("Unfold to the inner screen");
    click(fold);
    expect(ctx.workspace.api.setDevice).toHaveBeenCalledWith({ folded: false });

    view.unmount();
    view = mount(<DeviceToolbar ctx={ctx} />);
    expect(find(view.root, "[data-part='size']").textContent).toBe("707 × 823");
    expect(find(view.root, "[data-action='fold']").textContent).toBe("Fold");
  });

  it("has no overlay switch: the top bar keeps it (round 2 R1)", () => {
    expect(view.root.querySelector("[data-part='overlay']")).toBeNull();
    expect(view.root.textContent).not.toContain("Overlay in game");
  });

  it("switches the zoom between Fit and 100 % (radio group)", () => {
    const zoom = find(view.root, "[role='radiogroup'][aria-label='Zoom']");
    expect(
      findAll(zoom, "[role='radio']").map(radio => radio.getAttribute("aria-checked"))
    ).toEqual(["true", "false"]);
    click(button(zoom, "100 %"));
    expect(ctx.state.zoom).toBe("100");
    expect(
      findAll(zoom, "[role='radio']").map(radio => radio.getAttribute("aria-checked"))
    ).toEqual(["false", "true"]);
  });

  it("toggles the safe-area guides; the switch is off and disabled for the desktop", () => {
    const safe = find(view.root, "[data-part='safe']");
    expect(safe.getAttribute("role")).toBe("switch");
    click(safe);
    expect(ctx.state.safeArea).toBe(false);

    view.unmount();
    ctx.workspace.device = { preset: "desktop", orientation: "portrait" };
    view = mount(<DeviceToolbar ctx={ctx} />);
    const desktop = find(view.root, "[data-part='safe']");
    expect(desktop.getAttribute("aria-disabled")).toBe("true");
    expect(desktop.getAttribute("aria-checked")).toBe("false");
  });

  it("Reload reloads the game without restore", async () => {
    click(find(view.root, "[data-part='reload']"));
    await settle();
    expect(ctx.workspace.reload).toHaveBeenCalledWith({ restore: false });
  });

  it("the camera takes a screenshot through panels.run", async () => {
    click(find(view.root, "[data-part='capture']"));
    await settle();
    expect(ctx.panels.run).toHaveBeenCalledWith("editor.capture");
  });

  it("disables camera and Series with a tooltip when the game lacks capturePlugin", async () => {
    view.unmount();
    ctx.link.manifestValue = manifestOf([]);
    view = mount(<DeviceToolbar ctx={ctx} />);
    for (const part of ["capture", "series"]) {
      const control = find(view.root, `[data-part='${part}']`);
      expect(control.getAttribute("aria-disabled")).toBe("true");
      expect(control.getAttribute("title")).toBe("The game did not add capturePlugin");
      click(control);
    }
    await flush();
    expect(ctx.panels.run).not.toHaveBeenCalled();
    expect(ctx.state.series.popover).toBe(false);
  });

  it("the Series button opens the popover; while recording it is red with the time", () => {
    const series = find(view.root, "[data-part='series']");
    click(series);
    expect(ctx.state.series.popover).toBe(true);
    expect(find(view.root, "[data-part='series']").getAttribute("aria-expanded")).toBe("true");

    view.unmount();
    ctx.state.series.recording = {
      folder: "f/",
      label: "a",
      startedAt: performance.now() - 900,
      durationMs: 2000,
      intervalMs: 100,
      planned: 20,
      phase: "recording",
      written: 0,
      stopRequested: false
    };
    view = mount(<DeviceToolbar ctx={ctx} />);
    const recording = find(view.root, "[data-part='series']");
    expect(recording.dataset.recording).toBe("");
    expect(recording.textContent).toMatch(/^● 0\.9 s$/);
  });
});

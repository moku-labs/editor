// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stopGameView } from "../../lifecycle";
import { DeviceToolbar } from "../../ui/DeviceToolbar";
import { createCtx, flush, manifestOf, type TestCtx } from "../helpers";
import { button, click, find, findAll, type Mounted, mount, settle } from "../ui";

let ctx: TestCtx;
let view: Mounted;

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
    expect(findAll(select, "option").map(option => option.textContent)).toEqual([
      "iPhone SE",
      "iPhone 15",
      "iPhone 15 Pro Max",
      "Pixel 8",
      "iPad mini",
      "Desktop"
    ]);
    expect(select.value).toBe("iphone-15");
    expect(find(view.root, "[data-part='size']").textContent).toBe("393 × 852");

    select.value = "pixel-8";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(ctx.workspace.api.setDevice).toHaveBeenCalledWith({ preset: "pixel-8" });

    click(button(view.root, "Landscape"));
    expect(ctx.workspace.api.setDevice).toHaveBeenCalledWith({ orientation: "landscape" });
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
    expect(find(view.root, "[data-part='overlay']").getAttribute("title")).toBe(
      "The game did not add the overlay"
    );
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

  it("the overlay switch shows workspace's flag and flips it", () => {
    const overlay = find(view.root, "[data-part='overlay']");
    expect(overlay.getAttribute("role")).toBe("switch");
    expect(overlay.getAttribute("aria-checked")).toBe("false");
    expect(overlay.textContent).toContain("Off");
    click(overlay);
    expect(ctx.workspace.setOverlayInGame).toHaveBeenCalledWith(true);
  });
});

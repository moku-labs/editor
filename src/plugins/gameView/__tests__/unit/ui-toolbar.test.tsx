// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DeviceSpec } from "../../../registry/protocol";
import { DEVICES } from "../../../workspace/devices";
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

/**
 * The presets listed under one group, in order.
 *
 * @param group - The group id.
 * @returns The presets.
 */
function inGroup(group: string): DeviceSpec[] {
  return DEVICES.filter(device => device.group === group);
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
    expect(findAll(select, "option")).toHaveLength(DEVICES.length);
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
    expect(findAll(groups[0] ?? select, "option").map(option => option.textContent)).toEqual(
      inGroup("iphone").map(device => device.name)
    );
    expect(
      findAll<HTMLOptionElement>(groups[2] ?? select, "option").map(option => option.value)
    ).toEqual(inGroup("foldable").map(device => device.id));
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

  it("the Sound switch mutes the game with game.mute and keeps the flag (round 2b R11)", async () => {
    view.unmount();
    ctx.link.manifestValue = manifestOf([["game.mute", "cosmetic"]]);
    view = mount(<DeviceToolbar ctx={ctx} />);
    const sound = find(view.root, "[data-part='sound']");
    expect(sound.getAttribute("role")).toBe("switch");
    expect(sound.textContent).toBe("Sound");
    expect(sound.getAttribute("aria-checked")).toBe("true");
    expect(sound.getAttribute("aria-disabled")).toBeNull();
    expect(sound.getAttribute("title")).toBe("Sound on or off · M");

    click(sound);
    await settle();
    expect(ctx.panels.run).toHaveBeenCalledWith("game.mute", { muted: true });
    expect(ctx.workspace.setMuted).toHaveBeenCalledWith(true);
    expect(find(view.root, "[data-part='sound']").getAttribute("aria-checked")).toBe("false");
  });

  it("disables the Sound switch with a tooltip when the game has no game.mute", async () => {
    const sound = find(view.root, "[data-part='sound']");
    expect(sound.getAttribute("aria-disabled")).toBe("true");
    expect(sound.getAttribute("title")).toBe("Needs @moku-labs/game with game.mute");
    click(sound);
    await flush();
    expect(ctx.panels.run).not.toHaveBeenCalled();
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

  it("Shot and Series carry an icon and a label; title and aria-label name them (round 2b R17)", () => {
    const shot = find(view.root, "[data-part='capture']");
    expect(shot.getAttribute("aria-label")).toBe("Take a screenshot");
    expect(shot.getAttribute("title")).toBe("Take a screenshot");
    expect(find(shot, "[data-part='tool-label']").textContent).toBe("Shot");
    expect(find(shot, "svg[data-part='tool-icon']").getAttribute("aria-hidden")).toBe("true");

    const series = find(view.root, "[data-part='series']");
    expect(series.getAttribute("aria-label")).toBe("Record a series");
    expect(series.getAttribute("title")).toBe("Record a series");
    expect(find(series, "[data-part='tool-label']").textContent).toBe("Series");
    expect(find(series, "svg[data-part='tool-icon']").getAttribute("aria-hidden")).toBe("true");
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

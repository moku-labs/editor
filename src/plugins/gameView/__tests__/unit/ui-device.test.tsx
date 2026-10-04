// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEVICES } from "../../../registry/protocol";
import { stopGameView } from "../../lifecycle";
import { DeviceTab } from "../../ui/DeviceTab";
import { createCtx, manifestOf, type TestCtx } from "../helpers";
import { click, find, findAll, type Mounted, mount, settle } from "../ui";

let ctx: TestCtx;
let view: Mounted;

beforeEach(async () => {
  ctx = createCtx();
  ctx.link.values.set("game.render", {
    fps: 60,
    frameMs: 4.24,
    textures: 18,
    textureMb: 12.5,
    views: 90,
    pooled: 4
  });
  ctx.link.manifestValue = manifestOf([
    ["editor.overlay", "cosmetic"],
    ["merge.coins", "cheat"],
    ["merge.fill", "cheat"]
  ]);
  view = mount(<DeviceTab ctx={ctx} />);
  await settle();
});

afterEach(() => {
  view.unmount();
  stopGameView(ctx);
  document.body.innerHTML = "";
});

describe("DeviceTab", () => {
  it("lists every device with size and safe insets; the current one is pressed", () => {
    const rows = findAll(view.root, "[data-part='devices'] button");
    expect(rows).toHaveLength(DEVICES.length);
    expect(rows[1]?.textContent).toBe("iPhone 15393×852safe top 59 · bottom 34");
    expect(rows[1]?.getAttribute("aria-pressed")).toBe("true");
    expect(rows[0]?.getAttribute("aria-pressed")).toBe("false");
  });

  it("a click sets the preset in its natural orientation", () => {
    ctx.workspace.device = { preset: "iphone-15", orientation: "landscape" };
    const ipadMini = DEVICES.findIndex(device => device.id === "ipad-mini");
    click(findAll(view.root, "[data-part='devices'] button")[ipadMini] as HTMLElement);
    expect(ctx.workspace.api.setDevice).toHaveBeenCalledWith({
      preset: "ipad-mini",
      orientation: "portrait"
    });
  });

  it("the overlay box: off tag, the explainer line and the switch", () => {
    const box = find(view.root, "[data-part='overlay-box']");
    expect(find(box, "[data-tag]").textContent).toBe("Off");
    expect(box.textContent).toContain(
      "Only render numbers and the game's cheats. No graph controls. Off by default."
    );
    click(find(box, "[role='switch']"));
    expect(ctx.workspace.setOverlayInGame).toHaveBeenCalledWith(true);
  });

  it("reads game.render once when the tab opens and shows the render chips", async () => {
    expect(
      findAll(view.root, "[data-part='render'] [data-chip]").map(chip => chip.textContent)
    ).toEqual(["fps 60", "4.2 ms", "textures 12.5 MB"]);
    await settle();
    expect(ctx.link.read.mock.calls.filter(call => call[0] === "game.render")).toHaveLength(1);
  });

  it("lists the game's cheat commands: id and title", () => {
    expect(findAll(view.root, "[data-part='cheats'] li").map(row => row.textContent)).toEqual([
      "merge.coinsmerge.coins",
      "merge.fillmerge.fill"
    ]);
  });

  it("shows no render chips when game.render cannot be read as numbers", async () => {
    view.unmount();
    ctx.link.values.set("game.render", "not stats");
    view = mount(<DeviceTab ctx={ctx} />);
    await settle();
    expect(view.root.querySelector("[data-part='render']")).toBeNull();
  });
});

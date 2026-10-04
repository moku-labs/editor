// @vitest-environment happy-dom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stopGameView } from "../../lifecycle";
import { notify } from "../../state";
import { ContactSheet } from "../../ui/ContactSheet";
import { createCtx, PNG, type TestCtx } from "../helpers";
import { button, click, find, findAll, type Mounted, mount } from "../ui";

const INDEX = ".moku/captures/series-2026-09-24-1015/index.json";
let ctx: TestCtx;
let view: Mounted;

/** Opens a sheet of three shots, the second missing, the third marked. */
function openSheet(): void {
  act(() => {
    ctx.state.series.sheet = {
      indexPath: INDEX,
      index: {
        label: "merge refused shake",
        durationMs: 200,
        intervalMs: 50,
        fromFrame: 1777,
        shots: [
          { file: "001.png", frame: 1777, atMs: 0, bug: false },
          { file: "002.png", frame: 1780, atMs: 50, bug: false },
          { file: "003.png", frame: 1783, atMs: 100, bug: true }
        ],
        device: { name: "iPhone 15", w: 393, h: 852, orientation: "portrait" },
        stoppedEarly: true
      },
      images: [PNG, undefined, PNG],
      version: "v1",
      big: undefined
    };
    notify(ctx.state);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  ctx = createCtx();
  view = mount(<ContactSheet ctx={ctx} />);
});

afterEach(() => {
  view.unmount();
  stopGameView(ctx);
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("ContactSheet", () => {
  it("renders nothing without a sheet", () => {
    expect(view.root.querySelector("dialog")).toBeNull();
  });

  it("is a modal dialog with the header, the bug count and one tile per shot", () => {
    openSheet();
    const dialog = find(view.root, "dialog[data-game='sheet']");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(find(dialog, "h2").textContent).toBe(
      "Series · merge refused shake · 3 shots · 0.2 s at 50 ms · from frame 1777 · stopped early"
    );
    expect(find(dialog, "[data-part='bugs']").textContent).toBe("1 marked as bug");
    const tiles = findAll(dialog, "[data-part='tile']");
    expect(tiles.map(tile => find(tile, "[data-part='caption']").textContent)).toEqual([
      "f1777 +0 ms",
      "f1780 +50 ms",
      "f1783 +100 ms"
    ]);
    expect(tiles[1]?.querySelector("img")).toBeNull();
    expect(tiles[1]?.querySelector("[data-part='missing']")).not.toBeNull();
    expect(tiles[2]?.dataset.bug).toBe("");
    expect(find(dialog, "[data-part='saved']").textContent).toBe(
      "Saved to .moku/captures/series-2026-09-24-1015/ · index.json"
    );
  });

  it("the bug toggle of a tile marks the shot", () => {
    openSheet();
    click(find(findAll(view.root, "[data-part='tile']")[0] as HTMLElement, "button[aria-pressed]"));
    expect(ctx.state.series.sheet?.index.shots[0]?.bug).toBe(true);
  });

  it("a tile opens the large view: shot, frame, time, device, bug, filmstrip, stepping", () => {
    openSheet();
    click(find(findAll(view.root, "[data-part='tile']")[1] as HTMLElement, "[data-part='open']"));
    const big = find(view.root, "[data-part='big']");
    expect(find(big, "[data-part='position']").textContent).toBe("Shot 2 of 3");
    expect(findAll(big, "dd").map(cell => cell.textContent)).toEqual([
      "1780",
      "+50 ms",
      "iPhone 15 portrait"
    ]);
    expect(findAll(big, "[data-part='strip'] button")).toHaveLength(3);
    expect(big.textContent).toContain("Step with ← → · Back to the sheet with Esc");

    click(button(big, "Mark as bug B"));
    expect(ctx.state.series.sheet?.index.shots[1]?.bug).toBe(true);
    click(find(view.root, "button[aria-label='Next shot']"));
    expect(find(view.root, "[data-part='position']").textContent).toBe("Shot 3 of 3");
    click(find(view.root, "button[aria-label='Previous shot']"));
    click(find(view.root, "button[aria-label='Previous shot']"));
    expect(find(view.root, "[data-part='position']").textContent).toBe("Shot 1 of 3");
    click(findAll(view.root, "[data-part='strip'] button")[2] as HTMLElement);
    expect(find(view.root, "[data-part='position']").textContent).toBe("Shot 3 of 3");
  });

  it("the close button closes layer by layer and returns the focus", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    openSheet();
    click(find(findAll(view.root, "[data-part='tile']")[0] as HTMLElement, "[data-part='open']"));
    click(find(view.root, "button[aria-label='Close']"));
    expect(ctx.state.series.sheet?.big).toBeUndefined();
    click(find(view.root, "button[aria-label='Close']"));
    expect(ctx.state.series.sheet).toBeUndefined();
    expect(document.activeElement).toBe(opener);
  });

  it("keeps Esc for the workspace keymap: the dialog's own cancel is prevented", () => {
    openSheet();
    const cancel = new Event("cancel", { cancelable: true });
    find(view.root, "dialog").dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
  });
});

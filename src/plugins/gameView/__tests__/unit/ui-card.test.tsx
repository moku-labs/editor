// @vitest-environment happy-dom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stopGameView } from "../../lifecycle";
import { notify } from "../../state";
import type { CaptureCardInfo } from "../../types";
import { CaptureCard } from "../../ui/CaptureCard";
import { createCtx, flush, PNG, type TestCtx } from "../helpers";
import { click, find, findAll, fire, type Mounted, mount, settle } from "../ui";

const SHOT = ".moku/captures/2026-09-24-1012-board.png";
let ctx: TestCtx;
let view: Mounted;

beforeEach(() => {
  ctx = createCtx();
  view = mount(<CaptureCard ctx={ctx} />);
});

afterEach(() => {
  vi.unstubAllGlobals();
  view.unmount();
  stopGameView(ctx);
  document.body.innerHTML = "";
});

/**
 * Shows a card.
 *
 * @param extra - Fields of a pick or a series card.
 */
async function showCard(extra: Partial<CaptureCardInfo> = {}): Promise<void> {
  act(() => {
    ctx.state.card = {
      path: SHOT,
      frame: 1841,
      device: "iPhone 15 portrait",
      image: PNG,
      ...extra
    };
    notify(ctx.state);
  });
  await settle();
}

/**
 * Stubs the clipboard.
 *
 * @returns The writeText mock.
 */
function stubClipboard(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn(() => Promise.resolve());
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  return writeText;
}

describe("CaptureCard", () => {
  it("renders nothing without a capture", () => {
    expect(view.root.querySelector("[data-game='card']")).toBeNull();
  });

  it("shows the thumbnail, the saved line, the file and the frame with the device", async () => {
    await showCard();
    const card = find(view.root, "[data-game='card']");
    expect(card.getAttribute("role")).toBe("status");
    expect(card.getAttribute("aria-live")).toBe("polite");
    expect(card.getAttribute("popover")).toBe("manual");
    expect(find<HTMLImageElement>(card, "img").getAttribute("src")).toBe(PNG);
    expect(find(card, "[data-part='saved']").textContent).toBe("✓ Screenshot saved");
    expect(find(card, "[data-part='meta']").textContent).toBe("f1841 · iPhone 15 portrait");
  });

  it("cuts a long path in the middle and keeps the whole path in its title (round 2b R14)", async () => {
    await showCard();
    const path = find(view.root, "[data-part='path']");
    expect(path.getAttribute("title")).toBe(SHOT);
    expect(path.textContent).toBe(".moku/captures/20…-24-1012-board.png");
    await showCard({ path: ".moku/captures/a.png" });
    expect(find(view.root, "[data-part='path']").textContent).toBe(".moku/captures/a.png");
  });

  it("Copy link copies the shot line, Open shows the file in Files (round 2b R14)", async () => {
    const writeText = stubClipboard();
    await showCard();
    const actions = find(view.root, "[data-part='actions']");
    expect(findAll(actions, "button").map(action => action.textContent)).toEqual([
      "Copy link",
      "Open"
    ]);
    click(find(actions, "[data-action='copy-link']"));
    await flush();
    expect(writeText).toHaveBeenCalledWith(`shot: ${SHOT}`);
    expect(ctx.workspace.toast).toHaveBeenCalledWith("✓ Link copied");
    click(find(actions, "[data-action='open']"));
    expect(ctx.emit).toHaveBeenCalledWith("workspace:open-file", { path: SHOT });
  });

  it("a pick's card copies its reference line", async () => {
    const writeText = stubClipboard();
    const line = "@moku coinPill row · board/awaitIntent · .moku/captures/coinPill-f1841.md";
    await showCard({ reference: line });
    click(find(view.root, "[data-action='reference']"));
    await flush();
    expect(writeText).toHaveBeenCalledWith(line);
    expect(ctx.workspace.toast).toHaveBeenCalledWith("✓ Reference copied");
  });

  it("a series card: the shots saved, the folder, its line and Open shows the sheet", async () => {
    const writeText = stubClipboard();
    const folder = ".moku/captures/series-2026-09-24-1015/";
    await showCard({ path: folder, series: { indexPath: `${folder}index.json`, shots: 20 } });
    expect(find(view.root, "[data-part='saved']").textContent).toBe("✓ 20 shots saved");
    click(find(view.root, "[data-action='copy-link']"));
    await flush();
    expect(writeText).toHaveBeenCalledWith(`series: ${folder} (20 frames)`);
    const read = vi.spyOn(ctx.link.files, "read");
    click(find(view.root, "[data-action='open']"));
    await flush();
    expect(ctx.workspace.show).toHaveBeenCalledWith("game");
    expect(read).toHaveBeenCalledWith(`${folder}index.json`);
  });

  it("stays while hovered or focused; the close button hides it", async () => {
    await showCard();
    const card = find(view.root, "[data-game='card']");
    fire(card, new PointerEvent("pointerenter"));
    expect(ctx.state.cardHeld).toBe(true);
    fire(card, new PointerEvent("pointerleave"));
    expect(ctx.state.cardHeld).toBe(false);
    fire(card, new FocusEvent("focusin", { bubbles: true }));
    expect(ctx.state.cardHeld).toBe(true);
    fire(card, new FocusEvent("focusout", { bubbles: true }));
    expect(ctx.state.cardHeld).toBe(false);

    click(find(card, "button[aria-label='Close']"));
    expect(ctx.state.card).toBeUndefined();
  });
});

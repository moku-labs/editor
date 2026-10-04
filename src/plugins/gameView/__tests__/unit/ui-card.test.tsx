// @vitest-environment happy-dom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stopGameView } from "../../lifecycle";
import { notify } from "../../state";
import { CaptureCard } from "../../ui/CaptureCard";
import { createCtx, PNG, type TestCtx } from "../helpers";
import { click, find, fire, type Mounted, mount, settle } from "../ui";

const SHOT = ".moku/captures/2026-09-24-1012-board.png";
let ctx: TestCtx;
let view: Mounted;

beforeEach(() => {
  ctx = createCtx();
  view = mount(<CaptureCard ctx={ctx} />);
});

afterEach(() => {
  view.unmount();
  stopGameView(ctx);
  document.body.innerHTML = "";
});

/** Shows a card. */
async function showCard(): Promise<void> {
  act(() => {
    ctx.state.card = { path: SHOT, frame: 1841, device: "iPhone 15 portrait", image: PNG };
    notify(ctx.state);
  });
  await settle();
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
    expect(card.textContent).toContain("✓ Screenshot saved");
    expect(find(card, "[data-part='path']").textContent).toBe(SHOT);
    expect(find(card, "[data-part='meta']").textContent).toBe("frame 1841 · iPhone 15 portrait");
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

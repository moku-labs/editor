// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"navigation":{"disableChildFrameNavigation":true}}}
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFrameLayer, removeFrameLayer, syncFrame } from "../../frame/frame";
import { createCtx, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// E-I1: the safe insets of the emulated device on the game page's :root
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let events: number;

/**
 * The game iframe of the frame layer.
 *
 * @returns The iframe.
 */
function iframe(): HTMLIFrameElement {
  const element = ctx.state.frame.iframe;
  if (element === undefined) throw new Error("no game frame");
  return element;
}

/**
 * The four properties on the game page's `:root`, "" for a side that is not set.
 *
 * @returns Top, right, bottom and left.
 */
function shown(): string[] {
  const style = iframe().contentDocument?.documentElement.style;
  return ["top", "right", "bottom", "left"].map(
    side => style?.getPropertyValue(`--moku-device-safe-${side}`) ?? "missing"
  );
}

/**
 * Mounts the frame on a device and waits for the game page to load, counting its
 * `moku-native:insets` events from the start.
 *
 * @param preset - The preset id.
 */
async function mount(preset: "iphone-18-pro" | "pixel-8"): Promise<void> {
  ctx.state.device = { preset, orientation: "portrait" };
  createFrameLayer(ctx);
  const loaded = new Promise(resolve => iframe().addEventListener("load", resolve, { once: true }));
  iframe().contentWindow?.addEventListener("moku-native:insets", () => {
    events += 1;
  });
  await loaded;
}

beforeEach(() => {
  events = 0;
  ctx = createCtx({ defaultWorkspace: "flow" });
});

afterEach(() => {
  removeFrameLayer(ctx.state);
  document.body.innerHTML = "";
});

describe("syncInsets", () => {
  it("a loaded page on a preset with insets shows them in CSS px and is told once (bug: HUD under the notch)", async () => {
    await mount("iphone-18-pro");

    expect(shown()).toEqual(["62px", "0px", "34px", "0px"]);
    expect(events).toBe(1);
  });

  it("a scroll or a resize with the same device sends nothing again (bug: a re-layout per scroll)", async () => {
    await mount("iphone-18-pro");
    syncFrame(ctx);
    syncFrame(ctx);

    expect(events).toBe(1);
  });

  it("a turn to landscape moves the top inset to the sides (bug: portrait insets kept)", async () => {
    await mount("iphone-18-pro");
    ctx.state.device = { preset: "iphone-18-pro", orientation: "landscape" };
    syncFrame(ctx);

    expect(shown()).toEqual(["0px", "62px", "34px", "62px"]);
    expect(events).toBe(2);
  });

  it("a preset without insets removes the four properties and tells the page (bug: stale notch)", async () => {
    await mount("iphone-18-pro");
    ctx.state.device = { preset: "pixel-8", orientation: "portrait" };
    syncFrame(ctx);

    expect(shown()).toEqual(["", "", "", ""]);
    expect(events).toBe(2);
  });

  it("a preset without insets on a fresh page sends nothing (bug: a needless re-layout)", async () => {
    await mount("pixel-8");
    syncFrame(ctx);

    expect(shown()).toEqual(["", "", "", ""]);
    expect(events).toBe(0);
  });

  it("a page the frame loads again gets the insets again (bug: lost after a reload)", async () => {
    await mount("iphone-18-pro");
    // A reload brings a new document with nothing on its :root, while the frame still holds the
    // insets it wrote on the old page.
    const fresh = document.implementation.createHTMLDocument("game");
    Object.defineProperty(iframe(), "contentDocument", { configurable: true, get: () => fresh });
    iframe().dispatchEvent(new Event("load"));

    expect(fresh.documentElement.style.getPropertyValue("--moku-device-safe-top")).toBe("62px");
  });

  it("a game page of another origin is left alone (bug: a throw on every re-dock)", async () => {
    await mount("iphone-18-pro");
    Object.defineProperty(iframe(), "contentDocument", {
      configurable: true,
      get: () => {
        throw new DOMException("Blocked a frame with origin", "SecurityError");
      }
    });
    ctx.state.device = { preset: "iphone-18-pro", orientation: "landscape" };

    expect(() => syncFrame(ctx)).not.toThrow();
  });
});

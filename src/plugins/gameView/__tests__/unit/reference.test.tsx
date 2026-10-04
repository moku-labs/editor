// @vitest-environment happy-dom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHandlers } from "../../handlers";
import { startGameView, stopGameView } from "../../lifecycle";
import { hoverProxy, setReferenceMode } from "../../reference/mode";
import { copySelectedReference } from "../../reference/pick";
import { notify } from "../../state";
import { createCtx, flush, type TestCtx, useScene } from "../helpers";
import { boardScene, find, findAll, fire } from "../ui";

// ─────────────────────────────────────────────────────────────────────────────
// Reference mode in gameView (finding 17, D-27): the scene watch stays alive
// while on in every workspace, game.position is watched for the flow node, the
// proxy layer lives in gameView's overlay root and updates by key, hover draws
// the picker box, a click picks, off removes the layer. Copy reference writes
// the reference block of the selection (round 2 R2).
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;

/**
 * Runs a change inside act() and notifies.
 *
 * @param change - The state change.
 */
function update(change: () => void): void {
  act(() => {
    change();
    notify(ctx.state);
  });
}

/**
 * The proxy layer in the overlay.
 *
 * @returns The layer element, undefined when there is none.
 */
function layer(): HTMLElement | undefined {
  return (
    ctx.workspace.overlayElement?.querySelector<HTMLElement>("[data-moku-proxies]") ?? undefined
  );
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  ctx = createCtx();
  useScene(ctx);
  ctx.state.scene = boardScene();
});

afterEach(() => {
  stopGameView(ctx);
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("setReferenceMode", () => {
  it("on: watches the scene sources and game.position, outside Game too", () => {
    ctx.workspace.activeValue = "render";
    act(() => setReferenceMode(ctx, true));

    expect(ctx.state.reference.on).toBe(true);
    expect(ctx.link.active().map(watch => watch.id)).toEqual([
      "game.ui",
      "game.entities",
      "game.projections",
      "game.position"
    ]);
    act(() => ctx.link.send("game.position", { path: "board/merge", flow: "board" }));
    expect(ctx.state.reference.node).toBe("board/merge");
  });

  it("keeps the scene watch when Game is left while on; off outside Game stops it", () => {
    ctx.workspace.activeValue = "game";
    const hooks = createHandlers(ctx);
    hooks["workspace:changed"]({ ws: "game" });
    act(() => hooks["workspace:reference"]({ on: true }));

    hooks["workspace:changed"]({ ws: "flow" });
    ctx.workspace.activeValue = "flow";
    expect(ctx.link.active("game.ui")).toHaveLength(1);

    act(() => hooks["workspace:reference"]({ on: false }));
    expect(ctx.link.active()).toEqual([]);
    expect(ctx.state.reference).toEqual({
      on: false,
      hover: undefined,
      node: undefined,
      unwatch: undefined
    });
  });

  it("off inside Game keeps the scene watch and drops only game.position", () => {
    ctx.workspace.activeValue = "game";
    act(() => setReferenceMode(ctx, true));
    act(() => setReferenceMode(ctx, true));
    act(() => setReferenceMode(ctx, false));
    expect(ctx.link.active().map(watch => watch.id)).toEqual([
      "game.ui",
      "game.entities",
      "game.projections"
    ]);
  });

  it("onStart turns it on when workspace already says on; onStop drops the position watch", () => {
    ctx.workspace.api.reference = () => true;
    act(() => startGameView(ctx));
    expect(ctx.state.reference.on).toBe(true);
    stopGameView(ctx);
    expect(ctx.link.active("game.position")).toEqual([]);
  });
});

describe("the proxy layer", () => {
  it("renders one proxy per placed visible node into the frame overlay, at its bounds", () => {
    act(() => setReferenceMode(ctx, true));
    const proxies = layer();
    expect(proxies?.parentElement?.dataset.game).toBe("overlay");

    const coin = find(proxies ?? document.body, "[data-moku-key='coinPill']");
    expect(coin.getAttribute("role")).toBe("img");
    expect(coin.getAttribute("aria-label")).toBe("coinPill");
    expect(coin.getAttribute("title")).toBe("coinPill · row");
    expect(coin.dataset.mokuBounds).toBe("235 74 290 76");
    expect(coin.style.left).toBe("235px");
    expect(coin.style.width).toBe("290px");
    expect(findAll(proxies ?? document.body, "[data-moku-proxy]").length).toBeGreaterThan(90);
  });

  it("updates a proxy by its key: the same element, new attributes", () => {
    act(() => setReferenceMode(ctx, true));
    const before = find(layer() ?? document.body, "[data-moku-key='coinPill']");
    expect(before.dataset.mokuNode).toBeUndefined();

    act(() => ctx.link.send("game.position", { path: "board/awaitIntent" }));
    update(() => {
      ctx.state.scene = boardScene();
    });
    const after = find(layer() ?? document.body, "[data-moku-key='coinPill']");
    expect(after).toBe(before);
    expect(after.dataset.mokuNode).toBe("board/awaitIntent");
  });

  it("hover draws the picker box with its label; leaving the layer clears it", () => {
    act(() => setReferenceMode(ctx, true));
    const coin = find(layer() ?? document.body, "[data-moku-key='coinPill']");
    fire(coin, new PointerEvent("pointerenter"));
    expect(ctx.state.reference.hover).toBe("ui:boardScreen/hudRow/coinPill");
    const overlay = ctx.workspace.overlayElement ?? document.body;
    expect(find(overlay, "[data-box='hover']").style.left).toBe("235px");
    expect(find(overlay, "[data-part='label']").textContent).toBe("coinPill · row · 290×76");

    fire(layer() ?? document.body, new PointerEvent("pointerleave"));
    expect(ctx.state.reference.hover).toBeUndefined();
    expect(overlay.querySelector("[data-box='hover']")).toBeNull();
    act(() => hoverProxy(ctx));
    expect(ctx.state.reference.hover).toBeUndefined();
  });

  it("is empty before the first scene, and the same position twice renders once", () => {
    ctx.state.scene = undefined;
    act(() => setReferenceMode(ctx, true));
    expect(layer()?.children).toHaveLength(0);

    act(() => ctx.link.send("game.position", { path: "home" }));
    const node = ctx.state.reference.node;
    act(() => ctx.link.send("game.position", { path: "home" }));
    expect(ctx.state.reference.node).toBe(node);
  });

  it("off removes the layer", () => {
    act(() => setReferenceMode(ctx, true));
    expect(layer()).toBeDefined();
    act(() => setReferenceMode(ctx, false));
    expect(layer()).toBeUndefined();
  });
});

describe("a click on a proxy", () => {
  it("selects its node and puts its reference line on the clipboard", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    act(() => setReferenceMode(ctx, true));
    const coin = find(layer() ?? document.body, "[data-moku-key='coinPill']");

    fire(coin, new PointerEvent("pointerup"));
    await act(async () => {
      await flush();
    });

    expect(ctx.state.selected).toEqual({ kind: "ui", path: "boardScreen/hudRow/coinPill" });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String(writeText.mock.calls[0]?.at(0))).toMatch(
      /^@moku coinPill row · board\/awaitIntent · .* · \.moku\/captures\/coinPill-f1841\.md$/
    );
    expect(ctx.state.pick?.nodeId).toBe("ui:boardScreen/hudRow/coinPill");
  });
});

describe("copySelectedReference", () => {
  it("writes the card of the selection, copies its one line, toasts and returns it", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    ctx.state.selected = { kind: "ui", path: "boardScreen/hudRow/coinPill" };
    ctx.state.found.set("coinPill", { kind: "defined", path: "src/hud/Hud.tsx", line: 2 });

    const line = await copySelectedReference(ctx);
    expect(line).toMatch(
      /^@moku coinPill row · board\/awaitIntent · src\/hud\/Hud\.tsx:2 · ref \d+,\d+ \d+×\d+ · \.moku\/captures\/coinPill-f1841\.md$/
    );
    expect(writeText).toHaveBeenCalledWith(line);
    expect(ctx.workspace.toast).toHaveBeenCalledWith("✓ Reference copied");
    const card = ctx.link.files.text(".moku/captures/coinPill-f1841.md");
    expect(card.split("\n").slice(0, 6)).toEqual([
      "# @moku coinPill row",
      "",
      "```text",
      "@moku coinPill · row · board/awaitIntent · f1841",
      "path: boardScreen/hudRow/coinPill",
      "source: src/hud/Hud.tsx:2 · texture: ui.hud-pill"
    ]);

    // The same node and frame again: the same card, written again.
    await copySelectedReference(ctx);
    expect(ctx.link.files.paths().filter(path => path.endsWith(".md"))).toEqual([
      ".moku/captures/coinPill-f1841.md"
    ]);
  });

  it("toasts when the clipboard refuses or does not exist, and returns the block all the same", async () => {
    ctx.state.selected = { kind: "ui", path: "boardScreen/hudRow/coinPill" };
    vi.stubGlobal("navigator", {
      clipboard: { writeText: () => Promise.reject(new Error("Document is not focused.")) }
    });
    expect(await copySelectedReference(ctx)).toMatch(/^@moku coinPill/);
    expect(ctx.workspace.toast).toHaveBeenCalledWith("Copy failed · Document is not focused.");

    vi.stubGlobal("navigator", {});
    await copySelectedReference(ctx);
    expect(ctx.workspace.toast).toHaveBeenLastCalledWith(
      "Copy failed · The clipboard is not available."
    );
  });

  it("is undefined without a selection, or for one the scene does not have", async () => {
    expect(await copySelectedReference(ctx)).toBeUndefined();
    ctx.state.selected = { kind: "ui", path: "nowhere" };
    expect(await copySelectedReference(ctx)).toBeUndefined();
  });

  it("reads the scene when there is none yet, and gives up when that read fails", async () => {
    ctx.state.scene = undefined;
    ctx.state.selected = { kind: "ui", path: "boardScreen/hudRow/coinPill" };
    vi.stubGlobal("navigator", {});
    expect(await copySelectedReference(ctx)).toMatch(/^@moku coinPill/);

    ctx.state.scene = undefined;
    ctx.link.values.delete("game.ui");
    expect(await copySelectedReference(ctx)).toBeUndefined();
    expect(ctx.log.debug).toHaveBeenCalledWith("gameView: copy reference read failed", {
      message: "no value for game.ui"
    });
  });
});

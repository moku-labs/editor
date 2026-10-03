// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- null is the Json "no value" and preact's unmount */
import { h, render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LinkStatus } from "../../../registry/protocol";
import { linkLabel, paint, renderChips, toRenderNumbers, viewOf } from "../../paint";
import { overlayCss } from "../../styles";
import type { OverlayView } from "../../types";
import { ERROR_MS, OK_MS } from "../../types";
import { CheatList } from "../../view/CheatList";
import { LinkDot } from "../../view/LinkDot";
import { OverlayCard } from "../../view/OverlayCard";
import { RenderChips } from "../../view/RenderChips";
import { command, createOctx } from "../helpers";

/**
 * Renders a vnode into a fresh container.
 *
 * @param vnode - The vnode.
 * @returns The container.
 */
function mount(vnode: Parameters<typeof render>[0]): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  render(vnode, container);
  return container;
}

afterEach(() => {
  document.body.replaceChildren();
});

const NUMBERS = { fps: 59.6, frameMs: 4.14, textureMb: 31.08 };

describe("renderChips", () => {
  it("formats fps, frame time and texture memory", () => {
    expect(renderChips({ fps: 60, frameMs: 4.1, textureMb: 31.1 }, false)).toEqual([
      { key: "fps", text: "fps 60", title: undefined },
      { key: "frame", text: "4.1 ms", title: undefined },
      { key: "textures", text: "textures 31.1 MB", title: undefined }
    ]);
  });

  it("rounds fps and keeps one decimal", () => {
    expect(renderChips(NUMBERS, false).map(chip => chip.text)).toEqual([
      "fps 60",
      "4.1 ms",
      "textures 31.1 MB"
    ]);
  });

  it("shows one waiting chip before the first numbers", () => {
    expect(renderChips(undefined, false)).toEqual([
      { key: "render", text: "render …", title: undefined }
    ]);
  });

  it("shows one dash chip with a title when game.render is unavailable", () => {
    expect(renderChips(undefined, true)).toEqual([
      { key: "render", text: "render —", title: "game.render is not available in this build" }
    ]);
  });
});

describe("toRenderNumbers", () => {
  it("keeps the three numbers of a render value", () => {
    expect(toRenderNumbers({ fps: 60, frameMs: 3.4, textures: 12, textureMb: 41.25 })).toEqual({
      fps: 60,
      frameMs: 3.4,
      textureMb: 41.25
    });
  });

  it.each([
    null,
    3,
    "x",
    [1, 2],
    { fps: 60, frameMs: 3 },
    { fps: "60", frameMs: 3, textureMb: 1 }
  ])("answers undefined for %j", value => {
    expect(toRenderNumbers(value)).toBeUndefined();
  });
});

describe("linkLabel", () => {
  const cases: [LinkStatus, string][] = [
    [{ kind: "connecting" }, "Connecting to the editor"],
    [{ kind: "live", frame: 12 }, "Editor live · frame 12"],
    [{ kind: "paused", frame: 40 }, "Game paused · frame 40"],
    [{ kind: "silent", since: 1, lastFrame: 77 }, "Editor silent · last frame 77"],
    [
      { kind: "lost", reason: "closed", lastFrame: 9, retryInMs: 2500 },
      "Editor link lost · retry in 3 s"
    ],
    [{ kind: "empty" }, "No editor session"]
  ];

  it.each(cases)("labels %j", (status, label) => {
    expect(linkLabel(status)).toBe(label);
  });

  it.each(cases)("has a colour rule for the kind of %j", status => {
    expect(overlayCss).toContain(`[data-kind="${status.kind}"]`);
  });
});

describe("viewOf", () => {
  it("paints the corner, the chips and no dot without the bridge", () => {
    const { state, config } = createOctx({ corner: "bottom-left" });
    state.render = { fps: 60, frameMs: 4.1, textureMb: 31.1 };

    const view = viewOf(state, config, 0);

    expect(view.corner).toBe("bottom-left");
    expect(view.link).toBeUndefined();
    expect(view.chips.map(chip => chip.text)).toEqual(["fps 60", "4.1 ms", "textures 31.1 MB"]);
    expect(view.cheats).toEqual([]);
    expect(view.announce).toBe("");
  });

  it("shows connecting before the first bridge status, then the last status", () => {
    const { state, config } = createOctx();
    state.hasBridge = true;

    expect(viewOf(state, config, 0).link).toEqual({
      kind: "connecting",
      label: "Connecting to the editor"
    });

    state.link = { kind: "live", frame: 12 };
    expect(viewOf(state, config, 0).link).toEqual({
      kind: "live",
      label: "Editor live · frame 12"
    });
  });

  it("marks busy cheats and expires ✓ after OK_MS and ! after ERROR_MS", () => {
    const { state, config } = createOctx();
    state.cheats = [command("a.one"), command("a.two"), command("a.three")];
    state.busy.add("a.one");
    state.results.set("a.two", { ok: true, message: undefined, at: 1000 });
    state.results.set("a.three", { ok: false, message: "boom", at: 1000 });

    const states = (now: number) => viewOf(state, config, now).cheats.map(cheat => cheat.state);

    expect(states(1000)).toEqual(["busy", "ok", "error"]);
    expect(states(1000 + OK_MS - 1)).toEqual(["busy", "ok", "error"]);
    expect(states(1000 + OK_MS)).toEqual(["busy", "idle", "error"]);
    expect(states(1000 + ERROR_MS)).toEqual(["busy", "idle", "idle"]);
  });

  it("keeps the error message on the button while it shows", () => {
    const { state, config } = createOctx();
    state.cheats = [command("a.one")];
    state.results.set("a.one", { ok: false, message: "boom", at: 0 });

    expect(viewOf(state, config, 1).cheats[0]).toEqual({
      id: "a.one",
      title: "Title of a.one",
      state: "error",
      message: "boom"
    });
    expect(viewOf(state, config, ERROR_MS).cheats[0]?.message).toBeUndefined();
  });

  it("announces the newest live result", () => {
    const { state, config } = createOctx();
    state.cheats = [command("a.one"), command("a.two")];
    state.results.set("a.one", { ok: true, message: undefined, at: 10 });

    expect(viewOf(state, config, 20).announce).toBe("Cheat sent: Title of a.one");

    state.results.set("a.two", { ok: false, message: "no coins", at: 30 });
    expect(viewOf(state, config, 40).announce).toBe("Cheat failed: no coins");
    expect(viewOf(state, config, 30 + ERROR_MS).announce).toBe("");
  });

  it("announces a result of a cheat no longer listed by its id", () => {
    const { state, config } = createOctx();
    state.results.set("gone.cheat", { ok: true, message: undefined, at: 0 });

    expect(viewOf(state, config, 1).announce).toBe("Cheat sent: gone.cheat");
  });
});

/**
 * A full view.
 *
 * @param overrides - Fields to replace.
 * @returns The view.
 */
function viewWith(overrides: Partial<OverlayView> = {}): OverlayView {
  return {
    corner: "top-right",
    link: { kind: "live", label: "Editor live · frame 12" },
    chips: renderChips({ fps: 60, frameMs: 4.1, textureMb: 31.1 }, false),
    cheats: [
      { id: "a.idle", title: "Add 100 coins", state: "idle", message: undefined },
      { id: "a.busy", title: "Refill", state: "busy", message: undefined },
      { id: "a.ok", title: "Ok one", state: "ok", message: undefined },
      { id: "a.error", title: "Bad one", state: "error", message: "boom" }
    ],
    announce: "Cheat sent: Ok one",
    ...overrides
  };
}

describe("OverlayCard", () => {
  it("is a labelled region with no class attribute anywhere", () => {
    const container = mount(h(OverlayCard, { ...viewWith(), onCheat: vi.fn() }));
    const card = container.querySelector<HTMLElement>("section[data-overlay]");

    expect(card?.getAttribute("aria-label")).toBe("Moku editor overlay: render numbers and cheats");
    expect(card?.dataset.corner).toBe("top-right");
    expect(container.querySelector("[class]")).toBeNull();
    expect(container.innerHTML).not.toContain("class=");
  });

  it("shows the title, the hint, the chips, the cheats and the status line", () => {
    const container = mount(h(OverlayCard, { ...viewWith(), onCheat: vi.fn() }));

    expect(container.querySelector("[data-title]")?.textContent).toBe("Overlay in game");
    expect(container.querySelector("[data-hint]")?.textContent).toBe("render + cheats");
    expect(container.querySelectorAll("[data-chip]")).toHaveLength(3);
    expect(container.querySelectorAll("button[data-cheat]")).toHaveLength(4);
    const status = container.querySelector("[data-announce]");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.textContent).toBe("Cheat sent: Ok one");
  });

  it("has no dot without a link and no graph controls", () => {
    const container = mount(h(OverlayCard, { ...viewWith({ link: undefined }), onCheat: vi.fn() }));

    expect(container.querySelector<HTMLElement>("[data-dot]")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(4);
    expect(container.querySelectorAll("input, select, canvas, svg")).toHaveLength(0);
  });
});

describe("LinkDot", () => {
  it("is an image with its label as name and title", () => {
    const container = mount(h(LinkDot, { kind: "lost", label: "Editor link lost · retry in 3 s" }));
    const dot = container.querySelector<HTMLElement>("[data-dot]");

    expect(dot?.dataset.kind).toBe("lost");
    expect(dot?.getAttribute("role")).toBe("img");
    expect(dot?.getAttribute("aria-label")).toBe("Editor link lost · retry in 3 s");
    expect(dot?.getAttribute("title")).toBe("Editor link lost · retry in 3 s");
  });
});

describe("RenderChips", () => {
  it("renders one span per chip, not announced", () => {
    const container = mount(h(RenderChips, { chips: renderChips(undefined, true) }));
    const chips = container.querySelector("[data-chips]");
    const chip = container.querySelector<HTMLElement>("[data-chip]");

    expect(chips?.getAttribute("aria-live")).toBe("off");
    expect(chip?.dataset.chip).toBe("render");
    expect(chip?.textContent).toBe("render —");
    expect(chip?.getAttribute("title")).toBe("game.render is not available in this build");
  });

  it("names the fps chip", () => {
    const container = mount(h(RenderChips, { chips: renderChips(NUMBERS, false) }));

    expect(container.querySelector('[data-chip="fps"]')?.textContent).toBe("fps 60");
  });
});

describe("CheatList", () => {
  it("shows the muted line when there are no cheats", () => {
    const container = mount(h(CheatList, { cheats: [], onCheat: vi.fn() }));

    expect(container.querySelector("[data-empty]")?.textContent).toBe("No cheats registered");
    expect(container.querySelector("ul")).toBeNull();
  });

  it("renders native buttons with state, marks and busy flags", () => {
    const container = mount(h(CheatList, { cheats: viewWith().cheats, onCheat: vi.fn() }));
    const button = (id: string) =>
      container.querySelector<HTMLButtonElement>(`[data-cheat="${id}"]`);

    expect(button("a.idle")?.getAttribute("type")).toBe("button");
    expect(button("a.idle")?.dataset.state).toBe("idle");
    expect(button("a.idle")?.textContent).toBe("Add 100 coins");
    expect(button("a.idle")?.disabled).toBe(false);
    expect(button("a.busy")?.disabled).toBe(true);
    expect(button("a.busy")?.getAttribute("aria-busy")).toBe("true");
    expect(button("a.ok")?.textContent).toContain("✓");
    expect(button("a.error")?.textContent).toContain("!");
    expect(button("a.error")?.getAttribute("title")).toBe("boom");
    expect(button("a.idle")?.hasAttribute("title")).toBe(false);
  });

  it("calls onCheat with the id on click", () => {
    const onCheat = vi.fn();
    const container = mount(h(CheatList, { cheats: viewWith().cheats, onCheat }));

    container.querySelector<HTMLButtonElement>('[data-cheat="a.idle"]')?.click();

    expect(onCheat).toHaveBeenCalledWith("a.idle");
  });
});

describe("paint", () => {
  it("does nothing before mount", () => {
    const octx = createOctx();

    expect(() => paint(octx)).not.toThrow();
  });

  it("renders the card into the root and runs a cheat on click", async () => {
    const octx = createOctx({}, [command("a.one")]);
    const host = document.createElement("div");
    document.body.append(host);
    octx.state.host = host;
    octx.state.root = host.attachShadow({ mode: "open" });
    octx.state.cheats = [command("a.one")];

    paint(octx);
    octx.state.root.querySelector<HTMLButtonElement>('[data-cheat="a.one"]')?.click();
    await vi.waitFor(() => {
      expect(octx.state.results.get("a.one")?.ok).toBe(true);
    });

    expect(octx.channel.runs).toEqual(["a.one"]);
    expect(octx.state.root.querySelector("[data-overlay]")).not.toBeNull();
    render(null, octx.state.root);
  });

  it("adds a style element when the root has no adopted sheet", () => {
    const octx = createOctx();
    const host = document.createElement("div");
    octx.state.root = host.attachShadow({ mode: "open" });

    paint(octx);

    expect(octx.state.root.querySelector("style")?.textContent).toBe(overlayCss);
  });
});

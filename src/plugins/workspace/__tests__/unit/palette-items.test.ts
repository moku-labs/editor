// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatCombo, isApplePlatform } from "../../keys/keymap";
import {
  addPaletteItems,
  builtInCommands,
  closePalette,
  flatItems,
  GROUP_ORDER,
  groupedItems,
  openPalette,
  runPaletteItem,
  togglePalette
} from "../../palette/items";
import type { PaletteGroup, PaletteItem } from "../../types";
import { createCtx, flush, manifestOf, resultOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Palette index, grouping and limits, the built-in commands
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A palette item.
 *
 * @param id - Item id.
 * @param group - Its group.
 * @param label - Its label (defaults to the id).
 * @returns The item.
 */
function itemOf(id: string, group: PaletteGroup = "Nodes", label = id): PaletteItem {
  return { id, group, label, run: vi.fn() };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("addPaletteItems", () => {
  it("adds one or many items; an existing id is replaced; the remover takes them out", () => {
    const ctx = createCtx();
    const bump = vi.spyOn(ctx.state.ui, "bump");
    const first = itemOf("node:a");
    addPaletteItems(ctx, first);
    const remove = addPaletteItems(ctx, [itemOf("node:b"), itemOf("node:a", "Nodes", "A2")]);

    expect([...ctx.state.palette.items.keys()]).toEqual(["node:a", "node:b"]);
    expect(ctx.state.palette.items.get("node:a")?.label).toBe("A2");
    expect(bump).toHaveBeenCalledTimes(2);

    remove();
    expect([...ctx.state.palette.items.keys()]).toEqual([]);
  });

  it("a remover leaves an item that was replaced after it alone", () => {
    const ctx = createCtx();
    const remove = addPaletteItems(ctx, itemOf("node:a"));
    addPaletteItems(ctx, itemOf("node:a", "Nodes", "newer"));
    remove();
    expect(ctx.state.palette.items.get("node:a")?.label).toBe("newer");
  });
});

describe("groupedItems", () => {
  it("lists groups in fixed order with their totals and 3 items each without a query", () => {
    const items = new Map<string, PaletteItem>();
    for (let index = 0; index < 5; index += 1) items.set(`n${index}`, itemOf(`n${index}`));
    items.set("t1", itemOf("t1", "Textures"));
    items.set("c1", itemOf("c1", "Commands"));

    const groups = groupedItems(items, "");
    expect(groups.map(group => `${group.group} ${group.total}`)).toEqual([
      "Commands 1",
      "Nodes 5",
      "Textures 1"
    ]);
    expect(groups[1]?.items.map(entry => entry.item.id)).toEqual(["n0", "n1", "n2"]);
    expect(groups[1]?.items[0]?.match).toBeUndefined();
  });

  it("with a query shows up to 8 matches per group, best score first, ties in insertion order", () => {
    const items = new Map<string, PaletteItem>();
    for (let index = 0; index < 10; index += 1) {
      items.set(`x${index}`, itemOf(`x${index}`, "Files", `src/merge-${index}.ts`));
    }
    items.set("prefix", itemOf("prefix", "Files", "merge.ts"));

    const [files] = groupedItems(items, "merge");
    expect(files?.total).toBe(11);
    expect(files?.items).toHaveLength(8);
    expect(files?.items[0]?.item.id).toBe("prefix");
    expect(files?.items[0]?.match).toEqual({ score: 100, ranges: [[0, 5]] });
    expect(files?.items[1]?.item.id).toBe("x0");
  });

  it("falls back to fuzzy only when no item of any group matches as a substring", () => {
    const items = new Map<string, PaletteItem>([
      ["a", itemOf("a", "Nodes", "board/merge")],
      ["b", itemOf("b", "Styles", "ui.number")]
    ]);

    expect(groupedItems(items, "bmg").map(group => group.group)).toEqual(["Nodes"]);
    expect(groupedItems(items, "number").map(group => group.group)).toEqual(["Styles"]);
    expect(groupedItems(items, "zzz")).toEqual([]);
  });

  it("knows the fixed group order", () => {
    expect(GROUP_ORDER).toEqual(["Commands", "Nodes", "Files", "Styles", "Panels", "Textures"]);
  });

  it("flattens the shown items for the arrow keys", () => {
    const items = new Map<string, PaletteItem>([
      ["n", itemOf("n")],
      ["c", itemOf("c", "Commands")]
    ]);
    expect(flatItems(groupedItems(items, "")).map(entry => entry.item.id)).toEqual(["c", "n"]);
  });
});

describe("open / close / toggle", () => {
  it("opens with a query and index 0, closes and toggles", () => {
    const ctx = createCtx();
    openPalette(ctx, "merge");
    expect(ctx.state.palette).toMatchObject({ open: true, query: "merge", index: 0 });
    closePalette(ctx);
    expect(ctx.state.palette.open).toBe(false);
    togglePalette(ctx);
    expect(ctx.state.palette).toMatchObject({ open: true, query: "" });
    togglePalette(ctx);
    expect(ctx.state.palette.open).toBe(false);
  });
});

describe("runPaletteItem", () => {
  it("closes the palette and runs the item or its alt", () => {
    const ctx = createCtx();
    const alt = vi.fn();
    const item: PaletteItem = { ...itemOf("f"), alt: { label: "Open in Files", run: alt } };
    openPalette(ctx);

    expect(runPaletteItem(ctx, item, false)).toBe(true);
    expect(item.run).toHaveBeenCalledTimes(1);
    expect(ctx.state.palette.open).toBe(false);
    expect(runPaletteItem(ctx, item, true)).toBe(true);
    expect(alt).toHaveBeenCalledTimes(1);
  });

  it("does not run a disabled item or a missing alt", () => {
    const ctx = createCtx();
    const item: PaletteItem = { ...itemOf("s"), disabled: () => "Pause the game first" };
    openPalette(ctx);
    expect(runPaletteItem(ctx, item, false)).toBe(false);
    expect(item.run).not.toHaveBeenCalled();
    expect(ctx.state.palette.open).toBe(true);
    expect(runPaletteItem(ctx, itemOf("x"), true)).toBe(false);
  });
});

/**
 * The built-in command with an id.
 *
 * @param items - The commands.
 * @param id - The id.
 * @returns The item.
 */
function find(items: readonly PaletteItem[], id: string): PaletteItem {
  const item = items.find(entry => entry.id === id);
  if (item === undefined) throw new Error(`no ${id}`);
  return item;
}

describe("builtInCommands", () => {
  it("lists the built-in commands in the Commands group", () => {
    const items = builtInCommands(createCtx());
    expect(items.every(item => item.group === "Commands")).toBe(true);
    expect(items.map(item => item.id)).toEqual([
      "cmd:step",
      "cmd:pause",
      "cmd:overlay",
      "cmd:preview",
      "cmd:theme",
      "cmd:go:flow",
      "cmd:go:game",
      "cmd:go:render",
      "cmd:go:state",
      "cmd:go:files",
      "cmd:go:console",
      "cmd:reload",
      "cmd:reload-restore",
      "cmd:registry",
      "cmd:retry"
    ]);
  });

  it("Step is disabled unless paused and runs game.step with origin palette", async () => {
    const ctx = createCtx();
    const step = find(builtInCommands(ctx), "cmd:step");
    expect(step.disabled?.()).toBe("Pause the game to step frames (P)");

    ctx.state.link = { kind: "paused", frame: 1840 };
    expect(step.disabled?.()).toBe(false);
    step.run();
    await flush();
    expect(ctx.link.run).toHaveBeenCalledWith("game.step", { frames: 1 });
    expect(ctx.emit).toHaveBeenCalledWith(
      "workspace:ran",
      expect.objectContaining({ id: "game.step", origin: "palette", ok: true })
    );
  });

  it("Pause / Resume follows the link status", async () => {
    const ctx = createCtx();
    const pause = find(builtInCommands(ctx), "cmd:pause");
    expect(pause.disabled?.()).toBe("No game connected");

    ctx.state.link = { kind: "live", frame: 3 };
    expect(pause.label).toBe("Pause the game");
    pause.run();
    await flush();
    expect(ctx.link.run).toHaveBeenLastCalledWith("game.pause", undefined);

    ctx.state.link = { kind: "paused", frame: 3 };
    expect(pause.label).toBe("Resume the game");
    pause.run();
    await flush();
    expect(ctx.link.run).toHaveBeenLastCalledWith("game.resume", undefined);
  });

  it("dynamic labels follow the state: overlay, preview, theme", () => {
    const ctx = createCtx();
    const items = builtInCommands(ctx);
    expect(find(items, "cmd:overlay").label).toBe("Overlay in game on");
    ctx.state.overlayInGame = true;
    expect(find(items, "cmd:overlay").label).toBe("Overlay in game off");

    expect(find(items, "cmd:preview").label).toBe("Hide game preview in Flow");
    ctx.state.previews.flow.visible = false;
    expect(find(items, "cmd:preview").label).toBe("Show game preview in Flow");
    ctx.state.active = "game";
    expect(find(items, "cmd:preview").disabled?.()).toBe(
      "The Game workspace always shows the game"
    );

    ctx.state.theme = { chosen: undefined, os: "light" };
    expect(find(items, "cmd:theme").label).toBe("Theme: dark");
    ctx.state.theme = { chosen: "dark", os: "light" };
    expect(find(items, "cmd:theme").label).toBe("Theme: light");
  });

  it("go-to items show their workspace; theme, preview, registry and retry act", () => {
    const ctx = createCtx();
    const items = builtInCommands(ctx);
    find(items, "cmd:go:files").run();
    expect(ctx.state.active).toBe("files");
    expect(find(items, "cmd:go:files").label).toBe("Go to Files");
    expect(find(items, "cmd:go:files").shortcut).toBe(
      formatCombo("mod+5", isApplePlatform(globalThis.navigator))
    );

    find(items, "cmd:theme").run();
    expect(ctx.state.theme.chosen).toBe("dark");

    find(items, "cmd:preview").run();
    expect(ctx.state.previews.files.visible).toBe(false);

    find(items, "cmd:registry").run();
    expect(ctx.state.popover).toBe("registry");

    find(items, "cmd:retry").run();
    expect(ctx.link.retry).toHaveBeenCalledTimes(1);
  });

  it("the overlay item runs setOverlayInGame with origin palette", async () => {
    const ctx = createCtx();
    ctx.state.link = { kind: "live", frame: 1 };
    ctx.link.manifestValue = manifestOf();
    ctx.link.run.mockResolvedValue(resultOf());
    find(builtInCommands(ctx), "cmd:overlay").run();
    await flush();
    expect(ctx.link.run).toHaveBeenCalledWith("editor.overlay", { on: true });
    expect(ctx.emit).toHaveBeenCalledWith(
      "workspace:ran",
      expect.objectContaining({ id: "editor.overlay", origin: "palette" })
    );
  });

  it("the reload items call reload with and without restore", async () => {
    const ctx = createCtx();
    const items = builtInCommands(ctx);
    find(items, "cmd:reload").run();
    find(items, "cmd:reload-restore").run();
    await flush();
    // not mounted: both resolve quietly without touching the link
    expect(ctx.link.run).not.toHaveBeenCalled();
  });
});

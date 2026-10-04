// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { actionsOf } from "../../actions";
import { initFlowView } from "../../lifecycle";
import { setNodeItems, setStyleItems } from "../../palette";
import { flush, prepare } from "../ctx";
import { prepared } from "../render";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** A keydown event. */
function key(name: string): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: name, cancelable: true });
}

/** The Flow binding of a combo. */
function bindingOf(fakes: Awaited<ReturnType<typeof prepared>>["fakes"], combo: string) {
  return fakes.bindings.find(entry =>
    typeof entry.keys === "string" ? entry.keys === combo : entry.keys.includes(combo)
  );
}

describe("Flow keys", () => {
  it("run their actions: history, camera ops, walk, highlight, focus, save", async () => {
    const { ctx, actions, fakes } = await prepared();
    initFlowView(ctx);
    const binding = (combo: string) => bindingOf(fakes, combo);
    expect(binding("n")).toBeUndefined();

    const fit = vi.spyOn(actions.camera, "fitAll");
    binding("f")?.run(key("f"));
    expect(fit).toHaveBeenCalled();
    const zoom = vi.spyOn(actions.camera, "zoomBy");
    binding("+")?.run(key("+"));
    expect(zoom).toHaveBeenCalledWith(1.25);

    expect(binding("arrowright")?.when?.()).toBe(false);
    actions.focus.select("board/tapGenerator");
    expect(binding("arrowright")?.when?.()).toBe(true);
    binding("arrowdown")?.run(key("ArrowDown"));
    binding("arrowup")?.run(key("ArrowUp"));
    binding("arrowright")?.run(key("ArrowRight"));
    expect(actions.focus.selected()).toBe("main/board>board/awaitIntent");
    binding("arrowleft")?.run(key("ArrowLeft"));

    const root = document.createElement("div");
    root.innerHTML = '<div data-key="main/home" tabindex="0"></div>';
    document.body.append(root);
    ctx.state.view.root = root;
    root.querySelector<HTMLElement>("[data-key]")?.focus();
    expect(binding("enter")?.when?.()).toBe(true);
    binding("enter")?.run(key("Enter"));
    expect(actions.focus.selected()).toBe("main/home");

    const save = vi.spyOn(actions.inspector, "saveCode");
    const event = key("s");
    binding("mod+s")?.run(event);
    expect(event.defaultPrevented).toBe(true);
    expect(save).toHaveBeenCalled();
    expect(binding("mod+s")?.when?.()).toBe(false);
  });

  it(String.raw`C shows where the game is; \ collapses and expands the Inspector panel; Alt+← goes back`, async () => {
    const { ctx, actions, fakes } = await prepared();
    initFlowView(ctx);
    const binding = (combo: string) => bindingOf(fakes, combo);
    const focusItem = vi.spyOn(actions.camera, "focusItem");
    binding("c")?.run(key("c"));
    expect(focusItem).toHaveBeenCalledWith(
      expect.objectContaining({ key: "main/board>board/awaitIntent" })
    );
    expect(ctx.state.focus.pulse).toBe("main/board>board/awaitIntent");

    localStorage.removeItem("moku-editor:panel:flow.inspector");
    const { sidePanelState } = await import("../../../panels/shared/side-panel");
    const before = sidePanelState("flow.inspector").collapsed;
    binding("\\")?.run(key("\\"));
    expect(sidePanelState("flow.inspector").collapsed).toBe(!before);
    binding("\\")?.run(key("\\"));
    expect(sidePanelState("flow.inspector").collapsed).toBe(before);

    expect(binding("alt+arrowleft")?.when?.()).toBe(false);
    actions.focus.select("board/merge");
    actions.focus.followEdge("main/board>board/merge:done");
    expect(binding("alt+arrowleft")?.when?.()).toBe(true);
    binding("alt+arrowleft")?.run(key("ArrowLeft"));
    expect(actions.focus.selected()).toBe("main/board>board/merge");
  });

  it("the walk keys leave the Inspector tabs and the resize handle alone; Enter leaves buttons alone", async () => {
    const { ctx, actions, fakes } = await prepared();
    initFlowView(ctx);
    const binding = (combo: string) => bindingOf(fakes, combo);
    actions.focus.select("board/merge");
    actions.focus.moveHighlight(1);
    const host = document.createElement("div");
    host.innerHTML =
      '<div role="tablist"><button type="button" role="tab">Info</button></div><div role="separator" tabindex="0"></div><button type="button" data-action="x">x</button>';
    document.body.append(host);
    host.querySelector<HTMLElement>('[role="tab"]')?.focus();
    expect(binding("arrowright")?.when?.()).toBe(false);
    host.querySelector<HTMLElement>('[role="separator"]')?.focus();
    expect(binding("arrowleft")?.when?.()).toBe(false);
    host.querySelector<HTMLElement>('[data-action="x"]')?.focus();
    expect(binding("arrowleft")?.when?.()).toBe(true);
    expect(binding("enter")?.when?.()).toBe(false);
    host.querySelector<HTMLElement>('[data-action="x"]')?.blur();
    expect(binding("enter")?.when?.()).toBe(true);
  });

  it("Enter leaves a button inside a frame or card alone (the frame's Collapse clicks by Enter)", async () => {
    const { ctx, actions, fakes } = await prepared();
    initFlowView(ctx);
    const binding = (combo: string) => bindingOf(fakes, combo);
    const root = document.createElement("div");
    root.innerHTML =
      '<div data-key="main/board"><button type="button" data-action="collapse">Collapse</button></div>';
    document.body.append(root);
    ctx.state.view.root = root;
    root.querySelector<HTMLElement>('[data-action="collapse"]')?.focus();
    expect(binding("enter")?.when?.()).toBe(false);

    // Even with a highlighted row the button keeps its Enter.
    actions.focus.select("board/merge");
    actions.focus.moveHighlight(1);
    expect(binding("enter")?.when?.()).toBe(false);
  });

  it("Enter after an Inspector walk follows the highlighted row, not the card that kept focus", async () => {
    const { ctx, actions, fakes } = await prepared();
    initFlowView(ctx);
    const binding = (combo: string) => bindingOf(fakes, combo);

    // The person clicked main/home: its card keeps keyboard focus through the walk.
    const root = document.createElement("div");
    root.innerHTML = '<div data-key="main/home" tabindex="0"></div>';
    document.body.append(root);
    ctx.state.view.root = root;
    root.querySelector<HTMLElement>("[data-key]")?.focus();

    // The walk put board/merge in the Inspector; ↓ highlights its first row.
    actions.focus.select("board/merge");
    actions.focus.moveHighlight(1);
    const follow = vi.spyOn(actions.focus, "followHighlight");
    binding("enter")?.run(key("Enter"));
    expect(follow).toHaveReturnedWith(true);
    expect(actions.focus.selected()).not.toBe("main/home");

    // With no row highlighted, Enter on the focused card still focuses that card.
    expect(ctx.state.focus.highlight.index).toBe(-1);
    binding("enter")?.run(key("Enter"));
    expect(actions.focus.selected()).toBe("main/home");
  });

  it("the codeEdit Esc layer cancels code editing", async () => {
    const { ctx, actions, fakes } = await prepared();
    fakes.files.store.set("nodes/merge.ts", { text: "export const merge = 1;\n", version: "v1" });
    initFlowView(ctx);
    await actions.inspector.openCode("board/merge");
    actions.inspector.edit();
    expect(fakes.escapes.get("codeEdit")?.()).toBe(true);
    expect(ctx.state.inspector.code?.draft).toBeUndefined();
    expect([...fakes.escapes.keys()]).toEqual(["contextMenu", "codeEdit", "selection"]);
  });
});

describe("palette items", () => {
  it("Commands run their actions; Reset layout resets when something is pinned", async () => {
    const { ctx, actions, fakes } = await prepared();
    initFlowView(ctx);
    const commands = fakes.palette[0] ?? [];
    const run = (label: string) => commands.find(item => item.label === label)?.run();
    const fitSelection = vi.spyOn(actions.camera, "fitSelection");
    const fitAll = vi.spyOn(actions.camera, "fitAll");
    run("Fit all");
    run("Fit selection");
    expect(fitAll).toHaveBeenCalled();
    expect(fitSelection).toHaveBeenCalled();
    const reset = vi
      .spyOn(actions.layout, "reset")
      .mockRejectedValueOnce(new Error("[moku-editor] nope"));
    run("Reset layout");
    await flush(3);
    expect(reset).toHaveBeenCalled();
    expect(ctx.log.warn).toHaveBeenCalled();
  });

  it("Nodes items focus a node; ⇧↵ opens its file in Files or toasts that there is none", async () => {
    const { ctx, fakes } = await prepared();
    fakes.files.store.set("nodes/merge.ts", {
      text: "x\nexport const merge = 1;\n",
      version: "v1"
    });
    setNodeItems(ctx, actionsOf(ctx));
    const items = fakes.palette.at(-1) ?? [];
    const merge = items.find(item => item.label === "board/merge");
    merge?.run();
    expect(fakes.workspace.show).toHaveBeenCalledWith("flow");
    expect(ctx.state.focus.selected).toBe("main/board>board/merge");
    merge?.alt?.run();
    await flush(5);
    expect(ctx.emit).toHaveBeenCalledWith("workspace:open-file", {
      path: "nodes/merge.ts",
      line: 2
    });
    items.find(item => item.label === "board/catchUp")?.alt?.run();
    await flush(5);
    expect(fakes.workspace.toast).toHaveBeenCalledWith("No file found for this node");
    setNodeItems(ctx, actionsOf(ctx));
    expect(fakes.removed).toContain(fakes.palette.length - 2);
  });

  it("no graph means no Nodes items; no keys means no Styles items", async () => {
    const { ctx, actions, fakes } = await prepared();
    ctx.state.data.graph = undefined;
    const before = fakes.palette.length;
    setNodeItems(ctx, actions);
    setStyleItems(ctx, actions, []);
    expect(fakes.palette.length).toBe(before);
    await prepare(ctx);
  });
});

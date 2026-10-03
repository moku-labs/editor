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

describe("Flow keys", () => {
  it("run their actions: note, history, camera ops, walk, highlight, focus, save", async () => {
    const { ctx, actions, fakes } = await prepared();
    initFlowView(ctx);
    const binding = (combo: string) =>
      fakes.bindings.find(entry =>
        typeof entry.keys === "string" ? entry.keys === combo : entry.keys.includes(combo)
      );
    binding("n")?.run(key("n"));
    expect(ctx.state.notes.editor?.anchor).toEqual({ x: 1110, y: 609 });
    actions.notes.close();

    const fit = vi.spyOn(actions.camera, "fitAll");
    binding("f")?.run(key("f"));
    expect(fit).toHaveBeenCalled();
    const zoom = vi.spyOn(actions.camera, "zoomBy");
    binding("+")?.run(key("+"));
    expect(zoom).toHaveBeenCalledWith(1.25);

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
    binding("enter")?.run(key("Enter"));
    expect(actions.focus.selected()).toBe("main/home");

    const save = vi.spyOn(actions.inspector, "saveCode");
    const event = key("s");
    binding("mod+s")?.run(event);
    expect(event.defaultPrevented).toBe(true);
    expect(save).toHaveBeenCalled();
    const noteSave = vi.spyOn(actions.notes, "save");
    actions.notes.edit({});
    expect(binding("mod+s")?.when?.()).toBe(true);
    binding("mod+s")?.run(key("s"));
    expect(noteSave).toHaveBeenCalled();
  });

  it("the codeEdit Esc layer cancels code editing", async () => {
    const { ctx, actions, fakes } = await prepared();
    fakes.files.store.set("nodes/merge.ts", { text: "export const merge = 1;\n", version: "v1" });
    initFlowView(ctx);
    await actions.inspector.openCode("board/merge");
    actions.inspector.edit();
    expect(fakes.escapes.get("codeEdit")?.()).toBe(true);
    expect(ctx.state.inspector.code?.draft).toBeUndefined();
    expect(fakes.escapes.get("noteEditor")?.()).toBe(false);
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

// @vitest-environment happy-dom
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeTab } from "../../inspector/CodeTab";
import { InfoTab } from "../../inspector/InfoTab";
import { infoView } from "../../view-model";
import { entry } from "../helpers";
import { mount, prepared, settle } from "../render";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** Clicks the first button whose text contains a label. */
function click(host: HTMLElement, label: string): void {
  const button = [...host.querySelectorAll<HTMLElement>("button")].find(entry =>
    entry.textContent?.includes(label)
  );
  if (button === undefined) throw new Error(`no button ${label}`);
  button.click();
}

describe("InfoTab (C2)", () => {
  it("links the file to the Code tab, expands, collapses and enters a sub-flow, follows outcome and source rows", async () => {
    const { ctx, actions } = await prepared();
    actions.focus.select("main/settings");
    const info = infoView(ctx, actions, "main/settings");
    if (info === undefined) throw new Error("no info");
    const expand = vi.spyOn(actions.flows, "expand").mockImplementation(() => {});
    const enter = vi.spyOn(actions.flows, "enter").mockImplementation(() => {});
    const { host, unmount } = mount(h(InfoTab, { ctx, actions, info }));
    await settle(() => click(host, "Open the Code tab"));
    expect(ctx.state.inspector.tab).toBe("code");
    await settle(() => click(host, "Expand in place"));
    expect(expand).toHaveBeenCalledWith("main/settings");
    await settle(() => click(host, "Enter settingsPopup"));
    expect(enter).toHaveBeenCalledWith("main/settings");
    await settle(() => click(host, "closed → home"));
    expect(ctx.state.focus.selected).toBe("main/home");
    expect(ctx.state.focus.edge).toBe("main/settings:closed");
    actions.focus.select("main/settings");
    await settle(() => click(host, "main/home · openSettings"));
    expect(ctx.state.focus.selected).toBe("main/home");
    expect(ctx.state.focus.edge).toBe("main/home:openSettings");
    unmount();
  });

  it("collapses an expanded frame; no notes section", async () => {
    const { ctx, actions } = await prepared();
    const info = infoView(ctx, actions, "main/board");
    if (info === undefined) throw new Error("no info");
    const collapse = vi.spyOn(actions.flows, "collapse").mockImplementation(() => {});
    const { host, unmount } = mount(h(InfoTab, { ctx, actions, info }));
    expect(host.textContent).not.toContain("Notes on this node");
    await settle(() => click(host, "Collapse"));
    expect(collapse).toHaveBeenCalledWith("main/board");
    unmount();
  });

  it("gives Comes from rows the frame of their last fire and both row kinds their instance edge", async () => {
    const { ctx, actions } = await prepared();
    ctx.state.data.history = [
      entry(1, "board/awaitIntent", "merge", { next: "board/merge", frame: 1790 }),
      entry(2, "board/merge", "done", { frame: 1800 })
    ];
    actions.focus.select("board/merge");
    const info = infoView(ctx, actions, "board/merge");
    expect(info?.key).toBe("main/board>board/merge");
    expect(info?.outcomes.map(row => row.edgeKey)).toEqual([
      "main/board>board/merge:done",
      "main/board>board/merge:rejected"
    ]);
    expect(info?.comesFrom).toEqual([
      {
        from: "board/awaitIntent",
        outcome: "merge",
        via: undefined,
        edgeKey: "main/board>board/awaitIntent:merge",
        sourceKey: "main/board>board/awaitIntent",
        frame: "f1790"
      }
    ]);
    const { host, unmount } = mount(h(InfoTab, { ctx, actions, info: info ?? never() }));
    expect(host.querySelector('[data-part="comes-from"] [data-part="frame"]')?.textContent).toBe(
      "f1790"
    );
    unmount();
  });

  it("a via row enters through the parent frame the node sits in", async () => {
    const { ctx, actions } = await prepared();
    actions.focus.select("board/awaitIntent");
    const info = infoView(ctx, actions, "board/awaitIntent");
    const play = info?.comesFrom.find(row => row.from === "main/home");
    expect(play).toMatchObject({
      via: "main/board",
      edgeKey: "main/home:play",
      sourceKey: "main/home"
    });
  });
});

/** Runs the Flow binding of a combo (it must be active). */
async function press(
  fakes: Awaited<ReturnType<typeof prepared>>["fakes"],
  combo: string
): Promise<void> {
  const binding = fakes.bindings.find(entry =>
    typeof entry.keys === "string" ? entry.keys === combo : entry.keys.includes(combo)
  );
  if (binding === undefined) throw new Error(`no binding ${combo}`);
  if (binding.when?.() === false) throw new Error(`${combo} is not active`);
  await settle(() => binding.run(new KeyboardEvent("keydown", { key: combo })));
}

describe("InfoTab keyboard (finding 15: the walk moved from the strip)", () => {
  it("↑/↓ move the highlight through Outcomes then Comes from, Enter follows it, ← → walk", async () => {
    const { ctx, actions, fakes } = await prepared();
    const { initFlowView } = await import("../../lifecycle");
    initFlowView(ctx);
    const { mountWorkspace } = await import("../render");
    const { host, unmount } = await mountWorkspace(ctx);
    await settle(() => actions.focus.select("board/merge"));
    const highlighted = () =>
      host.querySelector<HTMLElement>('[data-flow="info-tab"] li[data-highlight]');
    expect(highlighted()).toBeNull();
    await press(fakes, "arrowdown");
    expect(highlighted()?.dataset.outcome).toBe("done");
    await press(fakes, "arrowdown");
    expect(highlighted()?.dataset.outcome).toBe("rejected");
    await press(fakes, "arrowdown");
    expect(highlighted()?.closest('[data-part="comes-from"]')).not.toBeNull();
    await press(fakes, "arrowdown");
    expect(highlighted()?.closest('[data-part="comes-from"]')).not.toBeNull();
    await press(fakes, "arrowup");
    await press(fakes, "arrowup");
    expect(highlighted()?.dataset.outcome).toBe("done");
    await press(fakes, "enter");
    expect(actions.focus.selected()).toBe("main/board>board/awaitIntent");
    expect(ctx.state.focus.edge).toBe("main/board>board/merge:done");
    expect(highlighted()).toBeNull();
    expect(host.querySelector('[data-action="back"]')).not.toBeNull();
    await press(fakes, "alt+arrowleft");
    expect(actions.focus.selected()).toBe("main/board>board/merge");
    await press(fakes, "arrowleft");
    expect(actions.focus.selected()).toBe("main/board>board/awaitIntent");
    await settle(() => host.querySelector<HTMLElement>('[data-action="back"]')?.click());
    expect(actions.focus.selected()).toBe("main/board>board/merge");
    await press(fakes, "arrowright");
    expect(actions.focus.selected()).toBe("main/board>board/awaitIntent");
    unmount();
  });
});

/**
 * Fails the test: the value was expected to exist.
 *
 * @throws {Error} Always.
 */
function never(): never {
  throw new Error("expected a value");
}

describe("CodeTab (C3)", () => {
  it("offers Reload file / Save anyway after a conflict and asks before discarding", async () => {
    const { ctx, actions, fakes } = await prepared();
    fakes.files.store.set("nodes/merge.ts", { text: "export const merge = 1;\n", version: "v1" });
    const { host, unmount } = mount(h(CodeTab, { ctx, actions, id: "board/merge" }));
    await settle();
    await settle();
    await settle(() => click(host, "Edit here"));
    const area = host.querySelector("textarea");
    await settle(() => {
      if (area === null) return;
      area.value = "mine";
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle(() => click(host, "Cancel"));
    expect(host.textContent).toContain("Discard changes?");
    await settle(() => click(host, "Keep editing"));
    expect(ctx.state.inspector.code?.discard).toBe(false);
    fakes.files.store.set("nodes/merge.ts", { text: "theirs", version: "v9" });
    await settle(() => click(host, "Save ⌘S"));
    await settle();
    expect(host.textContent).toContain("! The file changed on disk");
    await settle(() => click(host, "Save anyway"));
    await settle();
    expect(fakes.files.store.get("nodes/merge.ts")?.text).toBe("mine");
    const code = ctx.state.inspector.code;
    if (code !== undefined) Object.assign(code, { conflict: true, draft: undefined });
    await settle(() => actions.focus.history(false));
    await settle(() => click(host, "Reload file"));
    await settle();
    expect(ctx.state.inspector.code?.conflict).toBe(false);
    await settle(() => click(host, "Edit here"));
    await settle(() => click(host, "Cancel"));
    await settle(() => {
      actions.inspector.setDraft("x");
      actions.inspector.cancelEdit();
    });
    await settle(() => click(host, "Discard"));
    expect(ctx.state.inspector.code?.draft).toBeUndefined();
    unmount();
  });

  it("shows 'File too long to show here' over 5000 lines", async () => {
    const { ctx, actions, fakes } = await prepared();
    fakes.files.store.set("nodes/merge.ts", { text: "x\n".repeat(5001), version: "v1" });
    const { host, unmount } = mount(h(CodeTab, { ctx, actions, id: "board/merge" }));
    await settle();
    await settle();
    expect(host.textContent).toContain("File too long to show here · Open in Files");
    unmount();
  });
});

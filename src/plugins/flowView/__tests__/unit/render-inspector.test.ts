// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHandlers } from "../../handlers";
import { mountWorkspace, prepared, settle } from "../render";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** The Inspector element of a host. */
function inspectorOf(host: HTMLElement): HTMLElement {
  const element = host.querySelector<HTMLElement>('[data-flow="inspector"]');
  if (element === null) throw new Error("no inspector");
  return element;
}

describe("Inspector head and Info (C1, C2)", () => {
  it("shows the current node with 'showing current · click a node' while nothing is selected", async () => {
    const { ctx } = await prepared();
    const { host, unmount } = await mountWorkspace(ctx);
    const inspector = inspectorOf(host);
    expect(inspector.textContent).toContain("board/awaitIntent");
    expect(inspector.textContent).toContain("showing current · click a node");
    const tabs = inspector.querySelector('[role="tablist"]');
    expect([...(tabs?.querySelectorAll('[role="tab"]') ?? [])].map(tab => tab.textContent)).toEqual(
      ["Info", "Code"]
    );
    expect(inspector.textContent).toContain("Outcomes");
    expect(inspector.textContent).toContain("tap → tapGenerator");
    expect(inspector.textContent).toContain("leave → exit:left");
    expect(inspector.textContent).toContain("now · waiting");
    unmount();
  });

  it("shows the selected node; the clear button leaves focus; a slot node lists its contributions", async () => {
    const { ctx, actions } = await prepared();
    const { host, unmount } = await mountWorkspace(ctx);
    await settle(() => actions.focus.select("main/afterOrder"));
    const inspector = inspectorOf(host);
    expect(inspector.textContent).toContain("main/afterOrder");
    expect(inspector.textContent).toContain("reward → rewardPopup, order 10");
    expect(inspector.textContent).not.toContain("showing current");
    await settle(() => inspector.querySelector<HTMLElement>('[data-action="clear"]')?.click());
    expect(ctx.state.focus.selected).toBeUndefined();
    unmount();
  });

  it("says 'Nothing to inspect. Connect a game first.' while no game is connected", async () => {
    const { ctx } = await prepared();
    ctx.state.data.position = undefined;
    const { host, unmount } = await mountWorkspace(ctx);
    await settle(() => createHandlers(ctx)["link:status"]({ status: { kind: "connecting" } }));
    expect(inspectorOf(host).textContent).toContain("Nothing to inspect. Connect a game first.");
    unmount();
  });

  it("has two tabs: → from Code wraps back to Info, and no Styles body shows (D-66)", async () => {
    const { ctx, actions } = await prepared();
    const { host, unmount } = await mountWorkspace(ctx);
    await settle(() => actions.inspector.setTab("code"));
    const selected = () =>
      inspectorOf(host).querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    expect(selected()?.textContent).toBe("Code");
    await settle(() =>
      selected()?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
    );
    expect(ctx.state.inspector.tab).toBe("info");
    expect(selected()?.textContent).toBe("Info");
    expect(inspectorOf(host).dataset.wide).toBeUndefined();
    expect(host.querySelector('[data-flow="styles-tab"]')).toBeNull();
    unmount();
  });

  it("←/→ move between tabs; Code widens the Inspector panel until the person resizes it", async () => {
    localStorage.removeItem("moku-editor:panel:flow.inspector");
    const { updateSidePanel } = await import("../../../panels/shared/side-panel/store");
    updateSidePanel("flow.inspector", { width: undefined, closed: false, collapsed: false });
    const { ctx } = await prepared();
    const { host, unmount } = await mountWorkspace(ctx);
    const panel = () => host.querySelector<HTMLElement>('[data-side-panel="flow.inspector"]');
    expect(panel()?.style.getPropertyValue("--side-panel-w")).toBe("320px");
    const info = inspectorOf(host).querySelector<HTMLElement>('[role="tab"]');
    await settle(() =>
      info?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
    );
    expect(ctx.state.inspector.tab).toBe("code");
    expect(inspectorOf(host).dataset.wide).toBe("");
    expect(panel()?.style.getPropertyValue("--side-panel-w")).toBe("400px");
    await settle(() => updateSidePanel("flow.inspector", { width: 280 }));
    expect(panel()?.style.getPropertyValue("--side-panel-w")).toBe("280px");
    updateSidePanel("flow.inspector", { width: undefined });
    unmount();
  });

  it("sits in the flow.inspector side panel at the end of the workspace; closed, the toolbar reopens it", async () => {
    const { updateSidePanel } = await import("../../../panels/shared/side-panel/store");
    const { ctx } = await prepared();
    const { host, unmount } = await mountWorkspace(ctx);
    const panel = host.querySelector<HTMLElement>('[data-side-panel="flow.inspector"]');
    expect(panel?.dataset.side).toBe("end");
    expect(panel?.getAttribute("aria-label")).toBe("Inspector");
    expect(panel?.querySelector('[data-flow="inspector"]')).not.toBeNull();
    expect(panel?.querySelector('[role="separator"]')?.getAttribute("aria-valuemin")).toBe("220");
    expect(panel?.querySelector('[role="separator"]')?.getAttribute("aria-valuemax")).toBe("560");
    await settle(() => updateSidePanel("flow.inspector", { closed: true }));
    expect(host.querySelector('[data-flow="inspector"]')).toBeNull();
    const reopen = host.querySelector<HTMLElement>('[data-action="reopen-flow.inspector"]');
    await settle(() => reopen?.click());
    expect(host.querySelector('[data-flow="inspector"]')).not.toBeNull();
    unmount();
  });
});

describe("Code tab (C3)", () => {
  it("shows the file with tokens and the node's line; Open in Files emits; edit and save", async () => {
    const { ctx, actions, fakes } = await prepared();
    fakes.files.store.set("nodes/merge.ts", {
      text: "import x from 'y';\n\nexport const merge = 1;\n",
      version: "v1"
    });
    actions.focus.select("board/merge");
    const { host, unmount } = await mountWorkspace(ctx);
    await settle(() => actions.inspector.setTab("code"));
    await settle();
    const inspector = inspectorOf(host);
    expect(inspector.querySelector('[data-part="path"]')?.textContent).toBe("nodes/merge.ts");
    expect(inspector.querySelectorAll("[data-token]").length).toBeGreaterThan(0);
    expect(inspector.querySelector('[data-line="3"]')?.hasAttribute("data-highlight")).toBe(true);
    expect(
      inspector.querySelector<HTMLAnchorElement>('[data-action="open-editor"]')?.href
    ).toContain("vscode://file/work/game/nodes/merge.ts:3");
    await settle(() => inspector.querySelector<HTMLElement>('[data-action="open-files"]')?.click());
    expect(ctx.emit).toHaveBeenCalledWith("workspace:open-file", {
      path: "nodes/merge.ts",
      line: 3
    });
    await settle(() => inspector.querySelector<HTMLElement>('[data-action="edit"]')?.click());
    const area = inspector.querySelector<HTMLTextAreaElement>("textarea");
    expect(area?.value).toContain("export const merge");
    await settle(() => {
      if (area === null) return;
      area.value = "changed";
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle(() => inspector.querySelector<HTMLElement>('[data-action="save"]')?.click());
    await settle();
    expect(fakes.files.store.get("nodes/merge.ts")?.text).toBe("changed");
    expect(inspector.textContent).toContain(
      "✓ Saved · game reloaded · state restored from the last checkpoint"
    );
    unmount();
  });

  it("shows the placeholder of a node the project index does not know", async () => {
    const { ctx, actions } = await prepared();
    actions.focus.select("main/settings");
    const { host, unmount } = await mountWorkspace(ctx);
    await settle(() => actions.inspector.setTab("code"));
    await settle();
    expect(inspectorOf(host).textContent).toContain("Not in the project index: node:main/settings");
    unmount();
  });
});

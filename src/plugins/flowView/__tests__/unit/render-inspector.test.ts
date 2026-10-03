// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHandlers } from "../../handlers";
import { holdReads } from "../ctx";
import { fixtureText } from "../helpers";
import { mountWorkspace, prepared, settle } from "../render";

const fixture = fixtureText("ui-styles.txt");

/** The text styles file (flowView config `stylesFile`). */
const STYLES = "features/ui/styles.ts";

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
      ["Info", "Code", "Styles", "Notes (0)"]
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

  it("←/→ move between tabs; Code and Styles widen the Inspector", async () => {
    const { ctx } = await prepared();
    const { host, unmount } = await mountWorkspace(ctx);
    const info = inspectorOf(host).querySelector<HTMLElement>('[role="tab"]');
    await settle(() =>
      info?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
    );
    expect(ctx.state.inspector.tab).toBe("code");
    expect(inspectorOf(host).dataset.wide).toBe("");
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

  it("shows the placeholder of a node without a file", async () => {
    const { ctx, actions } = await prepared();
    actions.focus.select("main/settings");
    const { host, unmount } = await mountWorkspace(ctx);
    await settle(() => actions.inspector.setTab("code"));
    await settle();
    expect(inspectorOf(host).textContent).toContain("This node has no file of its own.");
    unmount();
  });
});

describe("Styles tab (C4, M10)", () => {
  it("shows a card per key with steppers only for fields with a shared rule", async () => {
    const { ctx, actions, fakes } = await prepared();
    fakes.files.store.set("features/ui/styles.ts", { text: fixture, version: "v1" });
    const { host, unmount } = await mountWorkspace(ctx);
    await settle(() => {
      actions.inspector.openStyles("ui.number").catch(() => {});
    });
    await settle();
    const inspector = inspectorOf(host);
    expect(inspector.textContent).toContain("uses text styles from features/ui/styles.ts");
    const fields = inspector.querySelectorAll<HTMLElement>("[data-field]");
    const byPath = new Map([...fields].map(field => [field.dataset.field, field]));
    expect(byPath.get("size")?.querySelector('[data-action="step-up"]')).not.toBeNull();
    expect(byPath.get("font")?.querySelector('[data-action="step-up"]')).toBeNull();
    expect(inspector.textContent).toContain("Used by appears when the game reports style keys");
    await settle(() =>
      byPath.get("size")?.querySelector<HTMLElement>('[data-action="step-up"]')?.click()
    );
    expect(ctx.state.inspector.styles?.pending?.next).toBe(61);
    expect(inspector.textContent).toContain("Writing…");
    unmount();
  });

  it("opening the tab reads the styles file once, even when the read is slow", async () => {
    const { ctx, fakes } = await prepared();
    fakes.files.store.set(STYLES, { text: fixture, version: "v1" });
    const release = holdReads(fakes.files, STYLES);
    const { host, unmount } = await mountWorkspace(ctx);
    const tab = [...inspectorOf(host).querySelectorAll<HTMLElement>('[role="tab"]')].find(
      candidate => candidate.textContent === "Styles"
    );
    await settle(() => tab?.click());
    await settle();
    release();
    await settle();
    const reads = vi.mocked(fakes.files.read).mock.calls.filter(([path]) => path === STYLES);
    expect(reads).toHaveLength(1);
    expect(ctx.state.inspector.tab).toBe("styles");
    expect(inspectorOf(host).querySelector('[data-flow="styles-tab"] select')).not.toBeNull();
    unmount();
  });

  it("shows the no-file reason", async () => {
    const { ctx, actions } = await prepared();
    const { host, unmount } = await mountWorkspace(ctx);
    await settle(() => {
      actions.inspector.openStyles().catch(() => {});
    });
    await settle();
    expect(inspectorOf(host).textContent).toContain(
      "No text styles at features/ui/styles.ts · set flowView.stylesFile"
    );
    unmount();
  });
});

describe("Notes tab (C5)", () => {
  it("lists the notes of the node and opens the editor for a new one", async () => {
    const { ctx, actions, fakes } = await prepared();
    fakes.files.store.set(".moku/notes/2026-09-24-a.md", {
      text: "---\ntitle: A note\nfrom:\n  node: board/awaitIntent\n  outcome: tap\nstatus: idea\ncaptures: []\n---\nBody text\n",
      version: "v1"
    });
    fakes.files.store.set(".moku/notes/2026-09-25-bad.md", {
      text: "---\ntitle: a\ntitle: b\n---\n",
      version: "v1"
    });
    await actions.notes.load();
    const { host, unmount } = await mountWorkspace(ctx);
    await settle(() => actions.inspector.setTab("notes"));
    const inspector = inspectorOf(host);
    expect(inspector.textContent).toContain("Notes are files an agent can find and build.");
    expect(inspector.textContent).toContain("A note");
    expect(inspector.textContent).toContain("board/awaitIntent · tap");
    await settle(() => inspector.querySelector<HTMLElement>('[data-action="new-note"]')?.click());
    expect(ctx.state.notes.editor?.from).toEqual({ node: "board/awaitIntent" });
    unmount();
  });
});

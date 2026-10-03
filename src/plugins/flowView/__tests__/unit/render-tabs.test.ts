// @vitest-environment happy-dom
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatNote, newNote } from "../../../panels/shared/notes";
import { CodeTab } from "../../inspector/CodeTab";
import { InfoTab } from "../../inspector/InfoTab";
import { NotesTab, noteMeta } from "../../inspector/NotesTab";
import { infoView } from "../../view-model";
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
  it("links the file to the Code tab, expands, collapses and enters a sub-flow, walks outcome and source rows", async () => {
    const { ctx, actions } = await prepared();
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
    await settle(() => click(host, "main/home · openSettings"));
    expect(ctx.state.focus.selected).toBe("main/home");
    unmount();
  });

  it("collapses an expanded frame and lists the notes on the node", async () => {
    const { ctx, actions, fakes } = await prepared();
    fakes.files.store.set(".moku/notes/a.md", {
      text: formatNote(newNote({ title: "Board idea", from: { node: "main/board" } })),
      version: "v1"
    });
    await actions.notes.load();
    const info = infoView(ctx, actions, "main/board");
    if (info === undefined) throw new Error("no info");
    const collapse = vi.spyOn(actions.flows, "collapse").mockImplementation(() => {});
    const { host, unmount } = mount(h(InfoTab, { ctx, actions, info }));
    expect(host.textContent).toContain("Board idea");
    await settle(() => click(host, "Collapse"));
    expect(collapse).toHaveBeenCalledWith("main/board");
    unmount();
  });
});

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

describe("NotesTab (C5)", () => {
  it("shows capture thumbnails, the meta line, and Open in Files for an unreadable note", async () => {
    const { ctx, actions, fakes } = await prepared();
    ctx.state.view.files = fakes.files;
    fakes.files.store.set(".moku/notes/a.md", {
      text: formatNote(
        newNote({
          title: "Shot",
          from: { node: "board/merge", outcome: "done" },
          to: "board/awaitIntent",
          captures: ["a.png"],
          created: "2026-09-24"
        })
      ),
      version: "v1"
    });
    fakes.files.store.set(".moku/notes/b.md", {
      text: "---\ntitle: a\ntitle: b\n---\n",
      version: "v1"
    });
    await actions.notes.load();
    const { host, unmount } = mount(h(NotesTab, { ctx, actions, id: "board/merge" }));
    await settle();
    expect(
      host.querySelector<HTMLImageElement>('[data-part="thumbnail"]')?.getAttribute("src")
    ).toBe("data:image/png;base64,AA==");
    expect(host.textContent).toContain(
      "board/merge · done → board/awaitIntent · idea · 2026-09-24"
    );
    await settle(() => click(host, "Open in Files"));
    expect(ctx.emit).toHaveBeenCalledWith("workspace:open-file", {
      path: ".moku/notes/b.md",
      line: 3
    });
    expect(noteMeta(newNote({ title: "Free" }))).toBe("free · idea");
    expect(noteMeta(newNote({ title: "Node", from: { node: "board/merge" } }))).toBe(
      "board/merge · idea"
    );
    unmount();
  });
});

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatNote, newNote, parseNote } from "../../../panels/shared/notes";
import { actionsOf } from "../../actions";
import { dateStamp } from "../../notes/slug";
import { createTestCtx, flush, jumpCamera, prepare } from "../ctx";

const today = dateStamp(new Date());

beforeEach(() => {
  jumpCamera();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("notes.create", () => {
  it("writes <notesDir>/<date>-<slug>.md with the contract front matter and toasts (M12)", async () => {
    const { ctx, fakes } = createTestCtx();
    await prepare(ctx);
    const file = await actionsOf(ctx).notes.create({
      title: "First wood 4",
      body: "Show a popup.",
      from: { node: "board/merge", outcome: "done" }
    });
    const path = `.moku/notes/${today}-first-wood-4.md`;
    expect(file.path).toBe(path);
    const expected = formatNote(
      newNote({
        title: "First wood 4",
        body: "Show a popup.",
        from: { node: "board/merge", outcome: "done" },
        to: "board/awaitIntent",
        created: today
      })
    );
    expect(fakes.files.store.get(path)?.text).toBe(expected);
    expect(fakes.workspace.toast).toHaveBeenCalledWith("✓ Note saved", path);
    expect(
      actionsOf(ctx)
        .notes.list()
        .map(note => note.path)
    ).toEqual([path]);
    await flush(10);
    expect(ctx.state.layout.result?.byKey[`note:${path}`]?.kind).toBe("note");
  });

  it("appends -2 when the name is taken; omits to for a free note", async () => {
    const path = `.moku/notes/${today}-idea.md`;
    const { ctx, fakes } = createTestCtx({ files: { [path]: "---\ntitle: Idea\n---\n" } });
    const file = await actionsOf(ctx).notes.create({ title: "Idea" });
    expect(file.path).toBe(`.moku/notes/${today}-idea-2.md`);
    const note = parseNote(fakes.files.store.get(file.path)?.text ?? "");
    expect("to" in note && note.to).toBeUndefined();
    expect("status" in note && note.status).toBe("idea");
  });
});

describe("notes.attach", () => {
  const path = ".moku/notes/2026-09-24-first-top-item.md";
  const text = formatNote(newNote({ title: "First top item", captures: ["a.png"] }));

  it("appends unique captures with the version and toasts", async () => {
    const { ctx, fakes } = createTestCtx({ files: { [path]: text } });
    const file = await actionsOf(ctx).notes.attach(path, ["a.png", "b.png"]);
    expect(file.note?.captures).toEqual(["a.png", "b.png"]);
    expect(fakes.files.writes[0]?.version).toBe("v1");
    expect(fakes.workspace.toast).toHaveBeenCalledWith("✓ Attached to First top item");
  });

  it("retries once on a version conflict", async () => {
    const { ctx, fakes } = createTestCtx({ files: { [path]: text } });
    fakes.files.conflicts = 1;
    const file = await actionsOf(ctx).notes.attach(path, ["c.png"]);
    expect(file.note?.captures).toEqual(["a.png", "c.png"]);
    expect(fakes.files.writes).toHaveLength(2);
  });

  it("never rewrites a note the codec cannot read", async () => {
    const { ctx, fakes } = createTestCtx({ files: { [path]: "---\ntitle: a\ntitle: b\n---\n" } });
    await expect(actionsOf(ctx).notes.attach(path, ["c.png"])).rejects.toThrow("[moku-editor]");
    expect(fakes.files.writes).toEqual([]);
  });
});

describe("notes.load", () => {
  it("reads every .md, newest name first, at most 200, unreadable ones kept with their error", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 201; index += 1) {
      const day = String((index % 28) + 1).padStart(2, "0");
      files[`.moku/notes/2026-01-${day}-n${String(index).padStart(3, "0")}.md`] =
        `---\ntitle: N${index}\n---\n`;
    }
    files[".moku/notes/2026-12-31-broken.md"] = "---\ntitle: a\ntitle: b\n---\n";
    files[".moku/notes/readme.txt"] = "x";
    const { ctx } = createTestCtx({ files });
    await actionsOf(ctx).notes.load();
    const list = actionsOf(ctx).notes.list();
    expect(list).toHaveLength(200);
    expect(list[0]?.path).toBe(".moku/notes/2026-12-31-broken.md");
    expect(list[0]?.note).toBeUndefined();
    expect(list[0]?.error?.error).toBe("front-matter");
    expect(ctx.state.notes.loaded).toBe(true);
  });

  it("treats a missing notes folder as empty", async () => {
    const { ctx } = createTestCtx();
    await actionsOf(ctx).notes.load();
    expect(actionsOf(ctx).notes.list()).toEqual([]);
  });
});

describe("note editor", () => {
  it("edit opens a draft, update patches it, close closes it (Esc layer)", () => {
    const { ctx } = createTestCtx();
    const notes = actionsOf(ctx).notes;
    expect(notes.close()).toBe(false);
    notes.edit({ from: { node: "board/merge", outcome: "done" }, captures: ["a.png"] });
    expect(ctx.state.notes.editor).toEqual({
      title: "",
      body: "",
      from: { node: "board/merge", outcome: "done" },
      captures: ["a.png"],
      anchor: undefined
    });
    notes.update({ title: "First wood 4" });
    expect(notes.draftPath()).toBe(`.moku/notes/${today}-first-wood-4.md`);
    expect(notes.close()).toBe(true);
    expect(ctx.state.notes.editor).toBeUndefined();
  });

  it("save writes the draft (not with an empty title) and pins a free note at its anchor", async () => {
    const { ctx, fakes } = createTestCtx({ config: { layoutSaveDelayMs: 0 } });
    await prepare(ctx);
    const notes = actionsOf(ctx).notes;
    expect(await notes.save()).toBeUndefined();
    notes.edit({ anchor: { x: 300, y: 2000 } });
    expect(await notes.save()).toBeUndefined();
    notes.update({ title: "Loose idea" });
    const file = await notes.save();
    expect(file?.path).toBe(`.moku/notes/${today}-loose-idea.md`);
    expect(ctx.state.notes.editor).toBeUndefined();
    expect(ctx.state.layout.pins.notes[file?.path ?? ""]?.flow).toBe("main");
    await flush(10);
    expect(fakes.files.store.has(".moku/editor/layout.json")).toBe(true);
  });

  it("anchors put an outcome note in its node's flow, a free note in its pin's flow or the root", async () => {
    const { ctx } = createTestCtx({
      files: {
        ".moku/notes/a.md": formatNote(
          newNote({ title: "A", from: { node: "board/merge", outcome: "done" } })
        ),
        ".moku/notes/b.md": formatNote(newNote({ title: "B" })),
        ".moku/notes/c.md": formatNote(newNote({ title: "C" }))
      }
    });
    ctx.state.layout.pins.notes[".moku/notes/c.md"] = { flow: "board", x: 1, y: 1 };
    await actionsOf(ctx).notes.load();
    expect(actionsOf(ctx).notes.anchors()).toEqual([
      { path: ".moku/notes/c.md", flow: "board", from: undefined, title: "C" },
      { path: ".moku/notes/b.md", flow: "", from: undefined, title: "B" },
      {
        path: ".moku/notes/a.md",
        flow: "board",
        from: { node: "board/merge", outcome: "done" },
        title: "A"
      }
    ]);
  });
});

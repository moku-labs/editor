import { describe, expect, it, vi } from "vitest";
import { addCaptures, formatNote, parseNote } from "../../../panels/shared/notes";
import { attachCapture, listNotes, requestNewNote } from "../../notes/attach";
import { conflict } from "../files-store";
import { createCtx } from "../helpers";

const NEWEST = ".moku/notes/2026-09-24-first-top-item.md";
const OLDEST = ".moku/notes/2026-09-20-old.md";
const BROKEN = ".moku/notes/2026-09-22-broken.md";
const PNG_PATH = ".moku/captures/2026-09-24-1012-board.png";
const NOTE =
  "---\ntitle: First top item\nstatus: idea\ncaptures: []\ncreated: 2026-09-24\n---\nThe top item jumps.\n";

/**
 * A ctx with three notes and a stray file.
 *
 * @returns The ctx.
 */
function notesCtx() {
  return createCtx({
    [NEWEST]: NOTE,
    [OLDEST]: "---\ntitle: Old one\nstatus: todo\ncaptures: []\n---\n",
    [BROKEN]: "---\ntitle: [\n",
    ".moku/notes/readme.txt": "not a note"
  });
}

describe("listNotes", () => {
  it("lists the .md notes newest first by file name, titled from the front matter", async () => {
    expect(await listNotes(notesCtx())).toEqual([
      { path: NEWEST, title: "First top item" },
      { path: BROKEN, title: "2026-09-22-broken" },
      { path: OLDEST, title: "Old one" }
    ]);
  });

  it("is empty when the notes folder does not exist", async () => {
    expect(await listNotes(createCtx())).toEqual([]);
  });
});

describe("attachCapture", () => {
  it("adds the capture to captures[] once through the shared codec, with the version", async () => {
    const ctx = notesCtx();
    const write = vi.spyOn(ctx.link.files, "write");
    const version = ctx.link.files.version(NEWEST);

    await attachCapture(ctx, PNG_PATH, NEWEST);
    await attachCapture(ctx, PNG_PATH, NEWEST);

    const note = parseNote(NOTE);
    if ("error" in note) throw new Error("fixture");
    expect(ctx.link.files.text(NEWEST)).toBe(formatNote(addCaptures(note, [PNG_PATH])));
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[2]).toBe(version);
    expect(ctx.workspace.toast).toHaveBeenCalledWith("✓ Attached to First top item", NEWEST);
  });

  it("re-reads once after a version conflict and retries", async () => {
    const ctx = notesCtx();
    const write = vi.spyOn(ctx.link.files, "write").mockRejectedValueOnce(conflict(NEWEST));
    const read = vi.spyOn(ctx.link.files, "read");

    await attachCapture(ctx, PNG_PATH, NEWEST);

    expect(read).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledTimes(2);
    expect(ctx.link.files.text(NEWEST)).toContain(`  - ${PNG_PATH}`);
  });

  it("toasts the bare error after a second conflict", async () => {
    const ctx = notesCtx();
    vi.spyOn(ctx.link.files, "write").mockRejectedValue(conflict(NEWEST));

    await attachCapture(ctx, PNG_PATH, NEWEST);

    expect(ctx.workspace.toast).toHaveBeenCalledWith(`Attach failed · ${NEWEST} changed on disk`);
  });

  it("never rewrites a note whose front matter is not readable", async () => {
    const ctx = notesCtx();
    await attachCapture(ctx, PNG_PATH, BROKEN);
    expect(ctx.link.files.writes).toEqual([]);
    expect(ctx.workspace.toast).toHaveBeenCalledWith(
      "Front matter not readable · Open in Files",
      BROKEN
    );
  });

  it("toasts a note that cannot be read", async () => {
    const ctx = notesCtx();
    await attachCapture(ctx, PNG_PATH, ".moku/notes/gone.md");
    expect(ctx.workspace.toast).toHaveBeenCalledWith(
      "Attach failed · No such file: .moku/notes/gone.md"
    );
  });
});

describe("requestNewNote", () => {
  it("emits workspace:new-note with the capture and the node", () => {
    const ctx = createCtx();
    requestNewNote(ctx, PNG_PATH, "board/awaitIntent");
    expect(ctx.emit).toHaveBeenCalledWith("workspace:new-note", {
      captures: [PNG_PATH],
      from: { node: "board/awaitIntent" }
    });
    expect(ctx.workspace.show).not.toHaveBeenCalled();
  });

  it("leaves from out without a node", () => {
    const ctx = createCtx();
    requestNewNote(ctx, PNG_PATH, undefined);
    expect(ctx.emit).toHaveBeenCalledWith("workspace:new-note", { captures: [PNG_PATH] });
  });
});

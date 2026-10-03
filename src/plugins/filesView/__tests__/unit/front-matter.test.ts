// @vitest-environment happy-dom
import { h, render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrontMatterRows, noteParts } from "../../preview/front-matter";

// ─────────────────────────────────────────────────────────────────────────────
// The note front matter through the shared parseNote: property rows, capture
// links, unknown keys, and an unreadable front matter shown raw
// ─────────────────────────────────────────────────────────────────────────────

const NOTE = [
  "---",
  "title: First top item",
  "from:",
  "  node: board/merge",
  "  outcome: done",
  "to: board/awaitIntent",
  "status: todo",
  "captures:",
  "  - .moku/captures/a.png",
  "  - .moku/captures/series-x/index.json",
  "created: 2026-09-24",
  "owner: alex",
  "---",
  "# Body",
  ""
].join("\n");

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  render(undefined, root);
  root.remove();
});

describe("noteParts", () => {
  it("passes a file without front matter through as the body", () => {
    expect(noteParts("# Title\n")).toEqual({ kind: "none", body: "# Title\n" });
  });

  it("reads a note through the shared codec", () => {
    const parts = noteParts(NOTE);
    expect(parts.kind).toBe("note");
    if (parts.kind !== "note") return;
    expect(parts.note.title).toBe("First top item");
    expect(parts.note.captures).toEqual([
      ".moku/captures/a.png",
      ".moku/captures/series-x/index.json"
    ]);
    expect(parts.body).toBe("# Body\n");
  });

  it("keeps the raw lines and the body of an unreadable front matter", () => {
    expect(noteParts("---\n??? nope\n---\nBody\n")).toEqual({
      kind: "raw",
      lines: ["??? nope"],
      body: "Body\n"
    });
  });

  it("treats a front matter without a closing fence as raw lines and no body", () => {
    expect(noteParts("---\ntitle: x\nstill front\n")).toEqual({
      kind: "raw",
      lines: ["title: x", "still front", ""],
      body: ""
    });
  });
});

describe("FrontMatterRows", () => {
  it("renders the note's properties as rows, captures as links", () => {
    const onOpenPath = vi.fn();
    render(h(FrontMatterRows, { text: NOTE, onOpenPath }), root);
    const labels = [...root.querySelectorAll("dt")].map(dt => dt.textContent);
    expect(labels).toEqual(["title", "from", "to", "status", "created", "captures", "owner"]);
    const values = [...root.querySelectorAll("dd")].map(dd => dd.textContent);
    expect(values[0]).toBe("First top item");
    expect(values[1]).toBe("board/merge · done");
    expect(values[2]).toBe("board/awaitIntent");
    expect(values[3]).toBe("todo");
    expect(values[4]).toBe("2026-09-24");
    expect(values[6]).toBe("alex");
    const links = root.querySelectorAll<HTMLButtonElement>("dd button");
    expect([...links].map(link => link.textContent)).toEqual([
      ".moku/captures/a.png",
      ".moku/captures/series-x/index.json"
    ]);
    links[1]?.click();
    expect(onOpenPath).toHaveBeenCalledWith(".moku/captures/series-x/index.json");
  });

  it("shows an unreadable front matter as one mono block of raw lines", () => {
    render(
      h(FrontMatterRows, { text: "---\n??? nope\nx: [\n---\nBody", onOpenPath: vi.fn() }),
      root
    );
    expect(root.querySelector("dl")).toBeNull();
    expect(root.querySelector("pre[data-front-matter='raw']")?.textContent).toBe("??? nope\nx: [");
  });

  it("renders nothing without a front matter", () => {
    render(h(FrontMatterRows, { text: "# Just a title", onOpenPath: vi.fn() }), root);
    expect(root.innerHTML).toBe("");
  });

  it("joins indented lines of an unknown key to its row", () => {
    render(
      h(FrontMatterRows, {
        text: "---\ntitle: T\nfrom:\n  node: board/merge\nowner:\n  - alex\n  - sam\n---\n",
        onOpenPath: vi.fn()
      }),
      root
    );
    const rows = [...root.querySelectorAll("dt")].map(dt => dt.textContent);
    expect(rows).toEqual(["title", "from", "status", "owner"]);
    expect([...root.querySelectorAll("dd")].at(-1)?.textContent).toBe("- alex - sam");
    expect([...root.querySelectorAll("dd")][1]?.textContent).toBe("board/merge");
  });

  it("omits from, to, created and captures rows when the note has none", () => {
    render(h(FrontMatterRows, { text: "---\ntitle: T\n---\n", onOpenPath: vi.fn() }), root);
    expect([...root.querySelectorAll("dt")].map(dt => dt.textContent)).toEqual(["title", "status"]);
  });
});

// @vitest-environment happy-dom
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkTarget, renderMarkdown, resolvePath } from "../../preview/markdown";

// ─────────────────────────────────────────────────────────────────────────────
// renderMarkdown: a safe subset built from VNodes only — headings, lists, fences,
// quotes, rules, paragraphs, inline marks and links (http(s), relative, text)
// ─────────────────────────────────────────────────────────────────────────────

let root: HTMLElement;
let onOpenPath: ReturnType<typeof vi.fn<(path: string) => void>>;

beforeEach(() => {
  root = document.createElement("div");
  document.body.append(root);
  onOpenPath = vi.fn<(path: string) => void>();
});

afterEach(() => {
  render(undefined, root);
  root.remove();
  vi.restoreAllMocks();
});

/**
 * Renders markdown into the root.
 *
 * @param text - The markdown.
 * @param base - The folder of the file.
 */
function show(text: string, base = ""): void {
  render(renderMarkdown(text, onOpenPath, base), root);
}

describe("blocks", () => {
  it("renders ATX headings #–######", () => {
    show("# One\n## Two\n###### Six\n####### Seven");
    expect(root.querySelector("h1")?.textContent).toBe("One");
    expect(root.querySelector("h2")?.textContent).toBe("Two");
    expect(root.querySelector("h6")?.textContent).toBe("Six");
    expect(root.querySelector("p")?.textContent).toBe("####### Seven");
  });

  it("joins paragraph lines and splits on blank lines", () => {
    show("first line\nsecond line\n\nnext paragraph");
    const paragraphs = [...root.querySelectorAll("p")].map(p => p.textContent);
    expect(paragraphs).toEqual(["first line second line", "next paragraph"]);
  });

  it("renders unordered and ordered lists with one nesting level", () => {
    show("- a\n* b\n  - b1\n  - b2\n\n1. x\n2. y");
    const lists = root.querySelectorAll("[data-md] > ul, [data-md] > ol");
    expect([...lists].map(list => list.tagName)).toEqual(["UL", "OL"]);
    const items = root.querySelectorAll("[data-md] > ul > li");
    expect(items).toHaveLength(2);
    expect([...(items[1]?.querySelectorAll("ul > li") ?? [])].map(li => li.textContent)).toEqual([
      "b1",
      "b2"
    ]);
    expect([...root.querySelectorAll("ol > li")].map(li => li.textContent)).toEqual(["x", "y"]);
  });

  it("renders quotes and rules", () => {
    show("> quoted\n> more\n\n---\n\nafter");
    expect(root.querySelector("blockquote")?.textContent).toBe("quoted more");
    expect(root.querySelector("hr")).not.toBeNull();
    expect(root.querySelector("p:last-child")?.textContent).toBe("after");
  });

  it("renders fenced code with the shared highlighter and keeps unclosed fences", () => {
    show("```ts\nconst a = 1;\n```\n\n```\nplain <b>\n");
    const blocks = root.querySelectorAll("pre");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.querySelector('span[data-token="keyword"]')?.textContent).toBe("const");
    expect(blocks[1]?.textContent).toBe("plain <b>");
    expect(root.querySelector("b")).toBeNull();
  });
});

describe("inline marks", () => {
  it("renders code, strong and em", () => {
    show("use `merge()` **now** and *soon* or _later_");
    expect(root.querySelector("code")?.textContent).toBe("merge()");
    expect(root.querySelector("strong")?.textContent).toBe("now");
    expect([...root.querySelectorAll("em")].map(em => em.textContent)).toEqual(["soon", "later"]);
  });

  it("leaves unclosed marks as text", () => {
    show("a * b and `open and **half");
    expect(root.querySelector("p")?.textContent).toBe("a * b and `open and **half");
    expect(root.querySelector("em, strong, code")).toBeNull();
  });

  it("renders http(s) links in a new tab without the opener", () => {
    show("see [the site](https://moku.dev/docs) now");
    const link = root.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://moku.dev/docs");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.textContent).toBe("the site");
  });

  it("renders a javascript: link as text", () => {
    show("[click](javascript:alert(1))");
    expect(root.querySelector("a, button")).toBeNull();
    expect(root.textContent).toContain("click");
  });

  it("renders a relative link as a button that opens the resolved path", () => {
    show("[shot](../captures/a.png#top)", ".moku/notes");
    const button = root.querySelector("button");
    expect(button?.textContent).toBe("shot");
    button?.click();
    expect(onOpenPath).toHaveBeenCalledWith(".moku/captures/a.png");
  });

  it("never sets innerHTML", () => {
    const setter = vi.spyOn(Element.prototype, "innerHTML", "set");
    try {
      show("# T\n\n<script>alert(1)</script> [x](https://a.b) `c`");
      expect(setter).not.toHaveBeenCalled();
      expect(root.querySelector("script")).toBeNull();
    } finally {
      setter.mockRestore();
    }
  });
});

describe("resolvePath and linkTarget", () => {
  it("resolves ./ and ../ against the folder, drops fragments and queries", () => {
    expect(resolvePath(".moku/notes", "./b.md")).toBe(".moku/notes/b.md");
    expect(resolvePath(".moku/notes", "../captures/a.png?x=1")).toBe(".moku/captures/a.png");
    expect(resolvePath("", "nodes/merge.ts#L3")).toBe("nodes/merge.ts");
    expect(resolvePath("a", "/nodes/merge.ts")).toBe("nodes/merge.ts");
    expect(resolvePath("a", "../../x.md")).toBe("x.md");
  });

  it("sorts targets into web, path and text", () => {
    expect(linkTarget("https://a.b")).toBe("web");
    // eslint-disable-next-line sonarjs/no-clear-text-protocols -- a plain http link must stay a web link
    expect(linkTarget("http://a.b")).toBe("web");
    expect(linkTarget("nodes/merge.ts")).toBe("path");
    expect(linkTarget("javascript:alert(1)")).toBe("text");
    expect(linkTarget("mailto:a@b.c")).toBe("text");
    expect(linkTarget("//evil.example/x")).toBe("text");
    expect(linkTarget("#top")).toBe("text");
  });
});

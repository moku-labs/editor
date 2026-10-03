import { describe, expect, it } from "vitest";
import type { Note } from "../../shared/notes";
import {
  addCaptures,
  formatNote,
  isNoteParseError,
  NOTE_STATUSES,
  newNote,
  parseNote
} from "../../shared/notes";

// ─────────────────────────────────────────────────────────────────────────────
// The note front-matter codec of `.moku/notes/<date>-<slug>.md` (contracts §5).
// ─────────────────────────────────────────────────────────────────────────────

/** The contract example: every key set, a title that needs quotes, two captures. */
const CONTRACT = [
  "---",
  "title: \"First wood 4: show a 'new item' popup\"",
  "from:",
  "  node: board/merge",
  "  outcome: firstWood4",
  "to: popups/newItem",
  "status: todo",
  "captures:",
  "  - .moku/captures/2026-09-24-1012-board.png",
  "  - .moku/captures/2026-09-24-1013-merge/index.json",
  "created: 2026-09-24",
  "---",
  "The popup should open once, on the first wood 4.",
  "",
  "- [ ] art for the popup",
  ""
].join("\n");

function note(text: string): Note {
  const parsed = parseNote(text);
  if (isNoteParseError(parsed)) throw new Error(`${parsed.line}: ${parsed.reason}`);
  return parsed;
}

function frontMatter(...lines: string[]): string {
  return ["---", ...lines, "---", "body"].join("\n");
}

describe("parseNote", () => {
  it("reads every key of the contract example", () => {
    expect(note(CONTRACT)).toEqual({
      title: "First wood 4: show a 'new item' popup",
      from: { node: "board/merge", outcome: "firstWood4" },
      to: "popups/newItem",
      status: "todo",
      captures: [
        ".moku/captures/2026-09-24-1012-board.png",
        ".moku/captures/2026-09-24-1013-merge/index.json"
      ],
      created: "2026-09-24",
      body: "The popup should open once, on the first wood 4.\n\n- [ ] art for the popup\n",
      extra: [],
      eol: "\n"
    });
  });

  it("defaults status to idea and takes the title from the body", () => {
    const parsed = note(
      ["---", "captures: []", "---", "", "## Merge feels slow", "more"].join("\n")
    );
    expect(parsed).toMatchObject({
      title: "Merge feels slow",
      status: "idea",
      captures: [],
      from: undefined,
      to: undefined,
      created: undefined,
      body: "\n## Merge feels slow\nmore"
    });
  });

  it("reads a file without front matter as a free note", () => {
    const text = "\n# A loose idea\n\nWords.";
    expect(note(text)).toEqual({
      title: "A loose idea",
      from: undefined,
      to: undefined,
      status: "idea",
      captures: [],
      created: undefined,
      body: text,
      extra: [],
      eol: "\n"
    });
    expect(note("").title).toBe("Untitled");
    expect(note("#\n").title).toBe("Untitled");
  });

  it("drops a BOM and takes the EOL from the first line break", () => {
    const text = "﻿---\r\ntitle: Crlf\r\n---\r\nbody\r\n";
    expect(note(text)).toMatchObject({ title: "Crlf", eol: "\r\n", body: "body\r\n" });
  });

  it("reads quoted, single-quoted and commented plain scalars", () => {
    const parsed = note(
      frontMatter(
        String.raw`title: "Tab\tand \"quotes\""`,
        "to: 'it''s here'",
        "status: done # finished",
        "created: 2026-09-24"
      )
    );
    expect(parsed).toMatchObject({
      title: 'Tab\tand "quotes"',
      to: "it's here",
      status: "done",
      created: "2026-09-24"
    });
  });

  it("reads from without an outcome and captures with dashes at column 0", () => {
    const parsed = note(
      frontMatter("title: T", "from:", "  node: board/merge", "captures:", "- a.png")
    );
    expect(parsed.from).toEqual({ node: "board/merge" });
    expect(parsed.captures).toEqual(["a.png"]);
  });

  it("keeps unknown keys, their child lines and comments verbatim, and drops blank lines", () => {
    const parsed = note(
      frontMatter(
        "title: T",
        "# a comment",
        "tags:",
        "  - merge",
        "",
        "  - board",
        "priority: 2",
        "status: idea"
      )
    );
    expect(parsed.extra).toEqual(["# a comment", "tags:", "  - merge", "  - board", "priority: 2"]);
    expect(parsed.status).toBe("idea");
  });

  it("returns a front-matter error with the line", () => {
    const cases: [string, number][] = [
      [["---", "title: T", "body"].join("\n"), 1],
      [frontMatter("title: A", "title: B"), 3],
      [frontMatter("from: board/merge"), 2],
      [frontMatter("from:", "  outcome: done"), 2],
      [frontMatter("from:", "  node: a", "  node: b"), 4],
      [frontMatter("from:", "  where: a"), 3],
      [frontMatter("from:", " node: a"), 3],
      [frontMatter("captures: a.png"), 2],
      [frontMatter("captures:", "  a.png"), 3],
      [frontMatter("title:", "  more"), 3],
      [frontMatter("title:"), 2],
      [frontMatter('title: "broken'), 2],
      [frontMatter("title: 'broken"), 2],
      [frontMatter("not a key"), 2],
      [frontMatter("title: T", "  stray"), 3]
    ];
    for (const [text, line] of cases) {
      const parsed = parseNote(text);
      expect(isNoteParseError(parsed), text).toBe(true);
      expect(parsed, text).toMatchObject({ error: "front-matter", line });
    }
    expect(parseNote(["---", "title: T"].join("\n"))).toEqual({
      error: "front-matter",
      line: 1,
      reason: "no closing ---"
    });
  });
});

describe("formatNote", () => {
  it("round-trips the contract example byte for byte", () => {
    expect(formatNote(note(CONTRACT))).toBe(CONTRACT);
  });

  it("round-trips CRLF and extra lines", () => {
    const text = [
      "---",
      "title: Crlf",
      "status: idea",
      "captures: []",
      "tags:",
      "  - a",
      "---",
      "body",
      ""
    ].join("\r\n");
    expect(formatNote(note(text))).toBe(text);
  });

  it("writes a hand-written file in canonical form with its unknown keys kept", () => {
    const text = [
      "---",
      "status: done",
      "tags: [a]",
      "title: 'Hand written'",
      "captures:",
      "  - a.png",
      "---",
      "body"
    ].join("\n");
    expect(formatNote(note(text))).toBe(
      [
        "---",
        "title: Hand written",
        "status: done",
        "captures:",
        "  - a.png",
        "tags: [a]",
        "---",
        "body"
      ].join("\n")
    );
  });

  it("quotes the scalars that would not read back as the same plain text", () => {
    const quoted = [
      "",
      " lead",
      "trail ",
      "two\nlines",
      "a: b",
      "x # y",
      "it's",
      'say "hi"',
      "[a]",
      "{a}",
      "a, b",
      "&a",
      "*a",
      "!a",
      "a|b",
      "a>b",
      "50%",
      "@me",
      "`code`",
      "-dash",
      "?q",
      "true",
      "False",
      "NULL",
      "~",
      "yes",
      "No",
      "on",
      "OFF",
      "12",
      "1.5",
      "-3"
    ];
    for (const title of quoted) {
      const text = formatNote(newNote({ title }));
      expect(text.split("\n")[1], title).toBe(`title: ${JSON.stringify(title)}`);
      expect(note(text).title, title).toBe(title);
    }
    for (const title of ["board/merge", "2026-09-24", ".moku/captures/a.png", "Just words"]) {
      expect(formatNote(newNote({ title })).split("\n")[1]).toBe(`title: ${title}`);
    }
  });

  it("writes every optional key only when set", () => {
    const full = newNote({
      title: "T",
      body: "b",
      from: { node: "board/merge", outcome: "done" },
      to: "board/idle",
      status: "todo",
      captures: ["a.png"],
      created: "2026-09-24"
    });
    expect(formatNote(full)).toBe(
      [
        "---",
        "title: T",
        "from:",
        "  node: board/merge",
        "  outcome: done",
        "to: board/idle",
        "status: todo",
        "captures:",
        "  - a.png",
        "created: 2026-09-24",
        "---",
        "b"
      ].join("\n")
    );
    expect(formatNote(newNote({ title: "T" }))).toBe(
      ["---", "title: T", "status: idea", "captures: []", "---", ""].join("\n")
    );
  });
});

describe("newNote", () => {
  it("fills the defaults", () => {
    expect(newNote({ title: "Idea" })).toEqual({
      title: "Idea",
      from: undefined,
      to: undefined,
      status: "idea",
      captures: [],
      created: undefined,
      body: "",
      extra: [],
      eol: "\n"
    });
  });

  it("copies the given fields without sharing arrays", () => {
    const captures = ["a.png"];
    const created = newNote({ title: "T", from: { node: "n" }, captures });
    captures.push("b.png");
    expect(created.from).toEqual({ node: "n" });
    expect(created.captures).toEqual(["a.png"]);
  });
});

describe("addCaptures", () => {
  it("appends the paths not already present, order kept", () => {
    const base = newNote({ title: "T", captures: ["a.png"] });
    const next = addCaptures(base, ["b.png", "a.png", "c/index.json", "b.png"]);

    expect(next.captures).toEqual(["a.png", "b.png", "c/index.json"]);
    expect(base.captures).toEqual(["a.png"]);
    expect(next.title).toBe("T");
  });

  it("round-trips through the codec after an attach", () => {
    const attached = formatNote(addCaptures(note(CONTRACT), [".moku/captures/x.png"]));
    expect(attached).toContain("  - .moku/captures/x.png\ncreated: 2026-09-24");
    expect(formatNote(note(attached))).toBe(attached);
  });
});

describe("isNoteParseError and NOTE_STATUSES", () => {
  it("tells a parse error from a note", () => {
    expect(isNoteParseError({ error: "front-matter", line: 1, reason: "x" })).toBe(true);
    for (const value of [undefined, "x", newNote({ title: "T" }), { error: "parse", line: 1 }]) {
      expect(isNoteParseError(value)).toBe(false);
    }
  });

  it("offers the three statuses", () => {
    expect(NOTE_STATUSES).toEqual(["idea", "todo", "done"]);
  });
});

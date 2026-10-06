import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HAS_GAME, mergeGameDir } from "../../../../../tests/fixtures/game-dir";
import { snippetOf, tagAttributes, tagNameAt } from "../../element/jsx";
import { templateOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The source text of a project-index answer (round 2b R12, D-38): the lines of
// its range, and the tag that opens a JSX range with its attributes.
// ─────────────────────────────────────────────────────────────────────────────

/** merge-game's settings popup (features/settings/settings.tsx:299-310), from line 1. */
const SETTINGS = [
  '    <PopupScreen id="settings" dismiss="close">',
  "      <Signboard",
  '        id="settingsBoard"',
  '        title={tr("settings.title")}',
  "        width={950}",
  "        hung",
  '        close="close"',
  "      >",
  '        <button key="settingsReset" intent="reset" style={linkStyle}>',
  "      </Signboard>",
  "    </PopupScreen>"
];

describe("snippetOf (round 2b R12)", () => {
  it("is the lines of the range, from its start line to its end line", () => {
    expect(snippetOf("settings.tsx", SETTINGS.join("\n"), [2, 7, 10, 19])).toEqual({
      path: "settings.tsx",
      line: 2,
      lines: SETTINGS.slice(1, 10)
    });
  });

  it("keeps at most `max` lines", () => {
    const text = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join("\n");
    const snippet = snippetOf("a.tsx", text, [5, 1, 80, 8], 60);
    expect(snippet.line).toBe(5);
    expect(snippet.lines).toHaveLength(60);
    expect(snippet.lines.at(-1)).toBe("line 64");
  });
});

describe("tagNameAt", () => {
  it("names the tag that opens where the range starts", () => {
    expect(tagNameAt(SETTINGS, [2, 7, 10, 19])).toBe("Signboard");
    expect(tagNameAt(['<Kit.Button id="ok" />'], [1, 1, 1, 23])).toBe("Kit.Button");
  });

  it("is undefined when no tag opens there", () => {
    expect(tagNameAt(SETTINGS, [2, 1, 10, 19])).toBeUndefined();
    expect(tagNameAt(SETTINGS, [40, 1, 41, 1])).toBeUndefined();
  });
});

describe("tagAttributes", () => {
  it("lists the attributes of the opening tag with their lines and values, not the children's", () => {
    expect(tagAttributes(SETTINGS, [2, 7, 10, 19])).toEqual([
      { name: "id", line: 3, value: { braced: false, text: "settingsBoard" } },
      { name: "title", line: 4, value: { braced: true, text: 'tr("settings.title")' } },
      { name: "width", line: 5, value: { braced: true, text: "950" } },
      { name: "hung", line: 6 },
      { name: "close", line: 7, value: { braced: false, text: "close" } }
    ]);
  });

  it("skips spreads, arrows, comparisons and strings inside braces, and ends at />", () => {
    const lines = [
      "<image",
      '  key="homeBackground"',
      '  onTap={() => go(a > b, "}")}',
      "  {...rest}",
      "  data-style='x'",
      "  style = {{ gap: 4 }}",
      "/>",
      '<spacer key="after" />'
    ];
    expect(tagAttributes(lines, [1, 1, 7, 3]).map(attribute => attribute.name)).toEqual([
      "key",
      "onTap",
      "data-style",
      "style"
    ]);
    expect(tagAttributes(lines, [1, 1, 7, 3]).at(-1)).toEqual({
      name: "style",
      line: 6,
      value: { braced: true, text: "{ gap: 4 }" }
    });
  });

  it("skips comments, template literals and escaped quotes inside braces", () => {
    const lines = [
      "<row",
      "  a={x /* } > */}",
      "  b={// } >",
      "    y}",
      String.raw`  c={${templateOf("", "d", "}>")} + '\'}'}`,
      '  style={"ui.title"}',
      ">"
    ];
    expect(tagAttributes(lines, [1, 1, 7, 2]).map(attribute => attribute.name)).toEqual([
      "a",
      "b",
      "c",
      "style"
    ]);
    expect(tagAttributes(lines, [1, 1, 7, 2]).at(-1)?.line).toBe(6);
  });

  it("reads an unquoted value as nothing and stops where an open brace never closes", () => {
    expect(tagAttributes(["<row a=b />"], [1, 1, 1, 12])).toEqual([
      { name: "a", line: 1 },
      { name: "b", line: 1 }
    ]);
    expect(tagAttributes(["<row a={b /* c"], [1, 1, 1, 15]).map(entry => entry.name)).toEqual([
      "a"
    ]);
  });

  it("is empty when no tag opens where the range starts", () => {
    expect(tagAttributes([`const id = ${templateOf("card", "slot")};`], [1, 1, 1, 27])).toEqual([]);
  });
});

describe.skipIf(!HAS_GAME)("tagAttributes on the merge-game fixture files", () => {
  it("reads the order card's style call at strip.tsx:218 from the range of jsx:card0", () => {
    const file = path.join(mergeGameDir(), "features/orders/strip.tsx");
    const lines = readFileSync(file, "utf8").split("\n");
    expect(tagNameAt(lines, [215, 5, 247, 14])).toBe("column");
    expect(tagAttributes(lines, [215, 5, 247, 14]).find(entry => entry.name === "style")).toEqual({
      name: "style",
      line: 218,
      value: { braced: true, text: "orderCardStyle(card.slot)" }
    });
  });
});

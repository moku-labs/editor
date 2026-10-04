import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MERGE_GAME_DIR } from "../../../../../tests/fixtures/game-dir";
import { elementLines, keyColumn } from "../../element/jsx";
import { templateOf } from "../helpers";

/** merge-game's settings popup (features/settings/settings.tsx:299-322), from line 1. */
const SETTINGS = [
  '    <PopupScreen id="settings" dismiss="close">',
  "      <Signboard",
  '        id="settingsBoard"',
  '        title={tr("settings.title")}',
  "        width={950}",
  "        hung",
  '        close="close"',
  "      >",
  '        <Parchment id="settingsPane">',
  "          {paneOf(local.tab, props)}",
  '          <row key="settingsTabs" style={tabRow}>',
  "            {tabs.map(tab => (",
  "              <TabButton tab={tab} open={local.tab === tab} />",
  "            ))}",
  "          </row>",
  "        </Parchment>",
  '        <button key="settingsReset" intent="reset" style={linkStyle}>',
  '          <text key="settingsResetLabel" style="ui.link" content={tr("settings.reset")} />',
  "        </button>",
  "      </Signboard>",
  "    </PopupScreen>"
];

/**
 * The lines of the element whose key is on a line.
 *
 * @param lines - The file lines.
 * @param line - The 1-based key line.
 * @param key - The key.
 * @returns The first and last line of the element.
 */
function rangeOf(lines: readonly string[], line: number, key: string) {
  return elementLines(lines, line, keyColumn(lines[line - 1] ?? "", key));
}

describe("keyColumn", () => {
  it("finds the key or id attribute, else the template literal of a loop key, else 0", () => {
    expect(keyColumn('        id="settingsBoard"', "settingsBoard")).toBe(8);
    expect(keyColumn('<row key="settingsTabs">', "settingsTabs")).toBe(5);
    expect(keyColumn(`  return ${templateOf("card", "slot")};`, "card0")).toBe(9);
    expect(keyColumn("nothing here", "coinPill")).toBe(0);
  });
});

describe("elementLines (round 2b R12)", () => {
  it("runs from the line that opens the tag to the line of its closing tag", () => {
    expect(rangeOf(SETTINGS, 3, "settingsBoard")).toEqual({ start: 2, end: 20 });
  });

  it("is one line for a self-closing element on its line", () => {
    expect(rangeOf(SETTINGS, 18, "settingsResetLabel")).toEqual({ start: 18, end: 18 });
  });

  it("skips expression children, arrows and comparisons inside braces", () => {
    expect(rangeOf(SETTINGS, 11, "settingsTabs")).toEqual({ start: 11, end: 15 });
  });

  it("ends a multi-line self-closing tag at its />", () => {
    const lines = [
      "      <image",
      '        key="homeBackground"',
      '        texture="board.bg-forest-meadow"',
      '        style={{ "--x": "}" }}',
      "      />",
      "      <spacer />"
    ];
    expect(rangeOf(lines, 2, "homeBackground")).toEqual({ start: 1, end: 5 });
  });

  it("counts fragments and nested tags of the same name", () => {
    const lines = [
      '<column key="outer">',
      "  <>",
      '    <column key="inner">{/* don\'t */}</column>',
      "  </>",
      "</column>"
    ];
    expect(rangeOf(lines, 1, "outer")).toEqual({ start: 1, end: 5 });
    expect(rangeOf(lines, 3, "inner")).toEqual({ start: 3, end: 3 });
  });

  it("is the key line alone when it is not inside a tag (a loop key's template line)", () => {
    const lines = [
      "/**",
      " * The key of the card in one slot, `<card>`.",
      " */",
      "export function cardKey(slot: number): string {",
      `  return ${templateOf("card", "slot")};`,
      "}"
    ];
    expect(rangeOf(lines, 5, "card0")).toEqual({ start: 5, end: 5 });
  });

  it("stops at the key line when the element never closes", () => {
    const lines = ['<column key="open">', "  <row>", "  text"];
    expect(rangeOf(lines, 1, "open")).toEqual({ start: 1, end: 1 });
  });
});

describe.skipIf(!existsSync(MERGE_GAME_DIR))("elementLines on the merge-game fixture files", () => {
  it("reads the settings Signboard from its tag to </Signboard>", () => {
    const file = path.join(MERGE_GAME_DIR, "features/settings/settings.tsx");
    const lines = readFileSync(file, "utf8").split("\n");
    const { start, end } = rangeOf(lines, 301, "settingsBoard");
    expect(lines[start - 1]?.trim()).toBe("<Signboard");
    expect(lines[end - 1]?.trim()).toBe("</Signboard>");
    expect(end - start).toBeGreaterThan(20);
  });
});

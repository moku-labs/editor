import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// The Game toolbar under a 1000 px workspace (round 2b R17): the workspace is
// a named inline-size container; below 1000 px Shot and Series show their
// icon only (the label stays for screen readers), so a 960 px window keeps the
// toolbar on one row. Wider, they show the label only.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads a sheet of the Game view.
 *
 * @param name - The file name under ui/styles/.
 * @returns The CSS text.
 */
function sheet(name: string): string {
  return readFileSync(`${process.cwd()}/src/plugins/gameView/ui/styles/${name}`, "utf8");
}

/** The narrow query of the toolbar sheet. */
const NARROW = "@container game (width < 1000px)";

/**
 * The narrow block of the toolbar sheet, to the end of the sheet.
 *
 * @returns The block, "" when the sheet has none.
 */
function narrowBlock(): string {
  const css = sheet("toolbar.css");
  const start = css.indexOf(NARROW);
  return start === -1 ? "" : css.slice(start);
}

describe("Game toolbar sheet (round 2b R17)", () => {
  it("names the Game workspace an inline-size container", () => {
    expect(sheet("stage.css")).toMatch(/:scope \{[^}]*container: game \/ inline-size;/);
  });

  it("shows the label and hides the icon of Shot and Series on a wide workspace", () => {
    const css = sheet("toolbar.css");
    const wide = css.slice(0, css.indexOf(NARROW));
    expect(wide).toMatch(/\[data-part="tool-icon"\] \{[^}]*display: none;/);
  });

  it("below 1000 px shows the icon only, the label visually hidden", () => {
    const narrow = narrowBlock();
    expect(narrow).not.toBe("");
    expect(narrow).toMatch(/\[data-part="tool-icon"\] \{[^}]*display: block;/);
    expect(narrow).toMatch(
      /\[data-part="tool-label"\] \{[^}]*position: absolute;[^}]*clip-path: inset\(50%\);/
    );
    expect(narrow).toMatch(/:has\(> \[data-part="tool-icon"\]\) \{[^}]*width: 28px;/);
  });
});

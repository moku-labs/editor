import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// The Files sheets: the view is the containing block of the tree drawer, the
// tree width comes from the SidePanel, the front matter is one plain block.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads a sheet of the Files view.
 *
 * @param name - The file name under view/.
 * @returns The CSS text.
 */
function sheet(name: string): string {
  return readFileSync(`${process.cwd()}/src/plugins/filesView/view/${name}`, "utf8");
}

describe("Files view sheets", () => {
  it("makes the view the positioned container of the tree drawer, with no fixed tree column", () => {
    const css = sheet("FilesView.css");
    expect(css).toMatch(/:scope \{[^}]*position: relative;/);
    expect(css).not.toContain("272px");
    expect(css).toMatch(/\[data-files-editor\] \{[^}]*flex: 1;/);
  });

  it("leaves the tree's edge line to the SidePanel", () => {
    expect(sheet("Tree.css")).not.toContain("border-right");
  });

  it("styles the front matter as one block and has no note rule", () => {
    const css = sheet("Previews.css");
    expect(css).toMatch(/\[data-front-matter\] \{/);
    expect(css).not.toMatch(/note/i);
  });
});

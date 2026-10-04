import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// The Console sheets at 480 px: the console is a size container, the filter
// bar wraps (the Preserve log switch is never cut at the host's right edge),
// the detail drawer spans the full width.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads a sheet of the Console view.
 *
 * @param name - The file name under view/.
 * @returns The CSS text.
 */
function sheet(name: string): string {
  return readFileSync(`${process.cwd()}/src/plugins/consoleView/view/${name}`, "utf8");
}

/**
 * The text from the narrow console container query to the end of a sheet.
 *
 * @param css - The sheet.
 * @returns The block, or "" when the sheet has none.
 */
function narrowBlock(css: string): string {
  const start = css.indexOf("@container console (width < 560px)");
  return start === -1 ? "" : css.slice(start);
}

describe("Console sheets", () => {
  it("names the console an inline-size container", () => {
    expect(sheet("ConsoleView.css")).toMatch(/:scope \{[^}]*container: console \/ inline-size;/);
  });

  it("wraps the filter bar instead of a fixed 40 px row", () => {
    const css = sheet("Toolbar.css");
    expect(css).toMatch(/:scope \{[^}]*flex-wrap: wrap;/);
    expect(css).toMatch(/:scope \{[^}]*min-block-size: 40px;/);
    expect(css.split("\n").map(line => line.trim())).not.toContain("block-size: 40px;");
  });

  it("never shrinks or cuts the Preserve log switch", () => {
    expect(sheet("Toolbar.css")).toMatch(
      /\[data-switch\] \{[^}]*flex: none;[^}]*white-space: nowrap;/
    );
  });

  it("lets the search fill the rest of the level row in a narrow console", () => {
    const narrow = narrowBlock(sheet("Toolbar.css"));
    expect(narrow).not.toBe("");
    expect(narrow).toMatch(/\[data-search\] \{[^}]*flex: 1 1 140px;[^}]*min-inline-size: 0;/);
  });

  it("spans the detail drawer over the full width and lets long values wrap", () => {
    const css = sheet("DetailDrawer.css");
    expect(css).toMatch(/:scope \{[^}]*inline-size: 100%;[^}]*min-inline-size: 0;/);
    expect(css).toMatch(/dd \{[^}]*overflow-wrap: anywhere;/);
  });
});

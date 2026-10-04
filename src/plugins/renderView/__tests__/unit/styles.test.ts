import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// The Render sheets at 480 px: the workspace is a size container, the tiles
// grid drops to 2 columns under 560 px and to 1 under 380 px, the card columns
// stack into one under 560 px, and the render
// tree header wraps its buttons onto their own line instead of overlapping.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads a sheet of the Render view.
 *
 * @param name - The file name under styles/.
 * @returns The CSS text.
 */
function sheet(name: string): string {
  return readFileSync(`${process.cwd()}/src/plugins/renderView/styles/${name}`, "utf8");
}

/**
 * The text of one container query block of a sheet, up to the next container query.
 *
 * @param css - The sheet.
 * @param query - The query head, for example `@container render (width < 560px)`.
 * @returns The block, or "" when the sheet has none.
 */
function blockOf(css: string, query: string): string {
  const start = css.indexOf(query);
  if (start === -1) return "";
  const next = css.indexOf("@container", start + query.length);
  return css.slice(start, next === -1 ? undefined : next);
}

describe("Render sheets", () => {
  it("names the Render workspace an inline-size container", () => {
    expect(sheet("tiles.css")).toMatch(/:scope \{[^}]*container: render \/ inline-size;/);
  });

  it("lays the tiles in 2 columns under 560 px and in 1 column under 380 px", () => {
    const css = sheet("tiles.css");
    const two = blockOf(css, "@container render (width < 560px) {\n    :scope");
    const one = blockOf(css, "@container render (width < 380px) {\n    :scope");

    expect(two).toMatch(/grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    expect(one).toMatch(/grid-template-columns: minmax\(0, 1fr\);/);
    expect(css.indexOf("(width < 380px)")).toBeGreaterThan(css.lastIndexOf("(width < 560px)"));
  });

  it("stacks the two card columns into one under 560 px", () => {
    const narrow = blockOf(
      sheet("tiles.css"),
      "@container render (width < 560px) {\n    [data-columns]"
    );

    expect(narrow).toMatch(/\[data-columns\] \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
  });

  it("wraps the render tree header and lets its texts shrink", () => {
    const css = sheet("tree.css");

    expect(css).toMatch(/header \{[^}]*flex-wrap: wrap;/);
    expect(css).toMatch(/h2,\s*\[data-count\] \{[^}]*min-inline-size: 0;/);
    expect(css).toMatch(/\[data-actions\] \{[^}]*flex: none;[^}]*margin-inline-start: auto;/);
  });
});

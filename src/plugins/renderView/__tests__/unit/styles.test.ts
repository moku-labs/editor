import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// The Render sheets at 480 px: the workspace is a size container, the scene
// cards' two columns stack into one under 560 px, and the render tree header
// wraps its buttons onto their own line instead of overlapping. (The tiles grid
// and the device strip's sheets went with Mission control, spec 09 § M1, M14.)
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
    expect(sheet("scene.css")).toMatch(/:scope \{[^}]*container: render \/ inline-size;/);
  });

  it("stacks the two card columns into one under 560 px", () => {
    const narrow = blockOf(
      sheet("scene.css"),
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

  it("no Barlow face on the tools page: fonts.css loads Geist only and build:tools copies none", () => {
    const fonts = readFileSync(`${process.cwd()}/src/plugins/workspace/styles/fonts.css`, "utf8");
    const families = [...fonts.matchAll(/font-family: "([^"]+)";/g)].map(match => match[1]);
    const script = readFileSync(`${process.cwd()}/scripts/build-tools.ts`, "utf8");

    expect(families).toEqual(["Geist", "Geist Mono"]);
    expect(fonts).not.toMatch(/barlow/i);
    expect(script).not.toContain('"src/plugins/overlay/fonts"');
    expect(script).toContain("no Barlow face in assets/");
  });
});

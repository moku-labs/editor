import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TONE_COLOUR } from "../../device/components/Annunciator";

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

// ─────────────────────────────────────────────────────────────────────────────
// spec 09 Delta 2026-10-15 "the strip follows the editor's look and theme": the
// D1 strip is an editor card in Geist, every colour of it is an editor token (or
// a painter palette entry set inline), so light and dark follow the editor's
// theme switch; no Barlow on the tools page.
// ─────────────────────────────────────────────────────────────────────────────

/** The device strip's sheets. */
const STRIP_SHEETS = ["strip.css", "record.css"] as const;

/** The properties that take a colour, by their start (`border` covers its longhands). */
const COLOUR_PROPERTIES = ["color", "background", "border", "outline", "scrollbar-color"] as const;

describe("the device strip's sheets (spec 09 Delta 2026-10-15)", () => {
  it("name no colour of their own: no hex, rgb or hsl, no cockpit token, no forced scheme, no Barlow", () => {
    for (const name of STRIP_SHEETS) {
      const css = sheet(name);
      expect(css, name).not.toMatch(/#[\da-f]{3,8}\b/i);
      expect(css, name).not.toMatch(/\b(?:rgba?|hsla?|oklch)\(/);
      expect(css, name).not.toContain("--strip-");
      expect(css, name).not.toContain("color-scheme");
      expect(css, name).not.toMatch(/barlow/i);
    }
  });

  it("every colour declaration reads a token, the inline `--c` or currentColor", () => {
    for (const name of STRIP_SHEETS) {
      const values = sheet(name)
        .split("\n")
        .map(line => line.trim())
        .filter(
          line =>
            line.endsWith(";") && COLOUR_PROPERTIES.some(property => line.startsWith(property))
        )
        .map(line => line.slice(line.indexOf(":") + 1, -1));
      expect(values.length, name).toBeGreaterThan(0);
      for (const value of values) {
        const words = value
          .replaceAll(/var\([^)]*\)/g, "")
          .replaceAll(/[\d.]+(?:px|em|%)?/g, "")
          .split(/\s+/)
          .filter(word => word !== "");
        expect(
          words.every(word =>
            ["solid", "dashed", "transparent", "currentColor", "none", "0"].includes(word)
          ),
          `${name}: ${value}`
        ).toBe(true);
      }
    }
  });

  it("the strip is an editor card like the Render cards: line, radius, panel, Geist and Geist Mono", () => {
    const css = sheet("strip.css");
    const root = /:scope \{[^}]*\}/.exec(css)?.[0] ?? "";

    expect(root).toContain("border: 1px solid var(--line-1);");
    expect(root).toContain("border-radius: var(--radius-10);");
    expect(root).toContain("background: var(--surface-panel);");
    expect(root).toContain("color: var(--text-ink);");
    expect(root).toContain("font-family: var(--font-sans);");
    expect(css).toContain("var(--font-mono)");
    expect(sheet("record.css")).toContain("var(--font-mono)");
  });

  it("the state colours of the legends are the editor's status tokens", () => {
    expect(TONE_COLOUR).toEqual({
      green: "var(--status-live)",
      amber: "var(--status-warn)",
      red: "var(--status-error)",
      ink2: "var(--text-2)",
      cyan: "var(--teal)"
    });
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

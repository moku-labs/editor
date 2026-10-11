import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// The Styles fields of the Element tab (U8): the select of an enum property
// looks like the inputs beside it (same height, border, radius and font),
// takes the accent with a pending edit, and shrinks with the panel (M10).
// ─────────────────────────────────────────────────────────────────────────────

/** The sheet of the side panel. */
const CSS = readFileSync(`${process.cwd()}/src/plugins/gameView/ui/styles/side.css`, "utf8");

describe("Styles fields sheet: the select of an enum property", () => {
  it("shares the box of the inputs: height, border, radius and font", () => {
    expect(CSS).toMatch(
      /\[data-part="field"\] input:not\(\[type="checkbox"\]\),\s*\[data-part="field"\] select \{[^}]*height: 22px;[^}]*border: 1px solid var\(--line-2\);[^}]*border-radius: var\(--radius-4\);[^}]*font-family: var\(--font-mono\);[^}]*font-size: var\(--font-size-11-5\);/
    );
  });

  it("shrinks with the panel: it never forces its row wider", () => {
    expect(CSS).toMatch(
      /\[data-part="field"\] input:not\(\[type="checkbox"\]\),\s*\[data-part="field"\] select \{[^}]*min-width: 0;/
    );
    expect(CSS).toMatch(/\[data-part="field"\] select \{[^}]*max-width: 100%;/);
  });

  it("takes the accent with a pending edit, as the inputs do", () => {
    expect(CSS).toMatch(
      /\[data-part="field"\]\[data-edited\] input:not\(\[type="checkbox"\]\),\s*\[data-part="field"\]\[data-edited\] select \{[^}]*border-color: var\(--accent\);/
    );
  });
});

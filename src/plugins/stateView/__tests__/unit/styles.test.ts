import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// The State sheet: three columns from 760 px of container, stacked below it
// with collapsible cards; never a horizontal scroll.
// ─────────────────────────────────────────────────────────────────────────────

const CSS = readFileSync(`${process.cwd()}/src/plugins/stateView/view/StateView.css`, "utf8");

/**
 * The text of the narrow container query block.
 *
 * @returns The block, or "" when the sheet has none.
 */
function narrowBlock(): string {
  const start = CSS.indexOf("@container (width < 760px)");
  return start === -1 ? "" : CSS.slice(start);
}

describe("State view sheet", () => {
  it("measures its own width as a size container", () => {
    expect(CSS).toMatch(/:scope \{[^}]*container-type: inline-size;/);
  });

  it("never scrolls the columns sideways", () => {
    expect(CSS).not.toContain("overflow-x: auto");
    expect(CSS).toMatch(/\[data-part="columns"\] \{[^}]*overflow-x: hidden;/);
    expect(CSS).not.toMatch(/minmax\(240px/);
  });

  it("stacks the columns in one scrolling column below 760 px of container", () => {
    const narrow = narrowBlock();
    expect(narrow).not.toBe("");
    expect(narrow).toMatch(
      /\[data-part="columns"\] \{[^}]*grid-template-columns: minmax\(0, 1fr\);/
    );
    expect(narrow).toMatch(/\[data-part="columns"\] \{[^}]*overflow-y: auto;/);
  });

  it("shows the card toggles and hides a collapsed card's body only when stacked", () => {
    expect(CSS).toMatch(/\[data-action="toggle-card"\] \{[^}]*display: none;/);
    const narrow = narrowBlock();
    expect(narrow).toMatch(/\[data-action="toggle-card"\] \{[^}]*display: grid;/);
    expect(narrow).toMatch(
      /\[data-card\]\[data-collapsed\] > :not\(\[data-part="head"\]\) \{[^}]*display: none;/
    );
  });
});

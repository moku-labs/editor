import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// The sheets that keep the editor still while the game reloads (U9): the stale
// bar overlays the workspace, the link pill keeps its width, the frame spinner
// keeps its screen size at any frame scale.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads a sheet of workspace.
 *
 * @param path - The path under src/plugins/workspace/.
 * @returns The CSS text.
 */
function sheet(path: string): string {
  return readFileSync(`${process.cwd()}/src/plugins/workspace/${path}`, "utf8");
}

describe("workspace sheets (U9)", () => {
  it("the stale bar overlays the top of the workspace area, never in the flow (B7)", () => {
    const css = sheet("ui/StaleBar.css");
    expect(css).toMatch(/:scope \{[^}]*position: absolute;/);
    expect(css).toMatch(/:scope \{[^}]*top: 0;[^}]*left: 0;[^}]*right: 0;/);
    expect(css).toMatch(/:scope \{[^}]*z-index: 2;/);
  });

  it("the link pill text keeps a fixed width (B8)", () => {
    expect(sheet("ui/LinkPill.css")).toMatch(
      /\[data-text\] \{[^}]*display: inline-block;[^}]*min-width: 19ch;/
    );
  });

  it("the frame spinner is counter-scaled to 24 px on screen (B6)", () => {
    const css = sheet("frame/Frame.css");
    expect(css).toMatch(/\[data-frame-reloading\] \{[^}]*position: absolute;/);
    expect(css).toMatch(
      /\[data-frame-reloading\] \{[^}]*width: calc\(24px \/ var\(--frame-scale, 1\)\);/
    );
    expect(css).toMatch(
      /\[data-frame-reloading\] \{[^}]*height: calc\(24px \/ var\(--frame-scale, 1\)\);/
    );
    expect(css).toMatch(/\[data-frame-reloading\]\[hidden\] \{[^}]*display: none;/);
  });
});

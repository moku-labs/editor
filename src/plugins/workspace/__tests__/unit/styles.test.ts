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

describe("workspace sheets (editor UI cleanup)", () => {
  it("the game mark is a 24 px mono tile tinted by --mark-hue (U1)", () => {
    const css = sheet("ui/TopBar.css");
    expect(css).toMatch(/\[data-mark\] \{[^}]*width: 24px;/);
    expect(css).toMatch(/\[data-mark\] \{[^}]*height: 24px;/);
    expect(css).toMatch(/\[data-mark\] \{[^}]*border-radius: var\(--radius-6\);/);
    expect(css).toMatch(/\[data-mark\] \{[^}]*font-family: var\(--font-mono\);/);
    expect(css).toMatch(/\[data-mark\] \{[^}]*font-size: var\(--font-size-11\);/);
    expect(css).toMatch(/\[data-mark\] \{[^}]*font-weight: 600;/);
    expect(css).toContain("oklch(var(--mark-l-bg) 0.07 var(--mark-hue))");
    expect(css).toContain("oklch(var(--mark-l-fg) 0.11 var(--mark-hue))");
    expect(css).not.toContain("[data-logo]");
  });

  it("without --mark-hue the mark uses the neutral surface and the muted text (U1)", () => {
    const css = sheet("ui/TopBar.css");
    expect(css).toMatch(/\[data-mark\] \{[^}]*background: [^;]*var\(--surface-panel-2\)\)?;/);
    expect(css).toMatch(/\[data-mark\] \{[^}]*color: [^;]*var\(--text-muted\)\)?;/);
  });

  it("the token layer sets the lightness of the mark per theme (U1)", () => {
    const css = sheet("styles/tokens.css");
    // Light is the base; a forced dark theme and a dark OS without a forced theme set the dark pair.
    expect(css).toMatch(/:root \{[^}]*--mark-l-bg: 0\.92;[^}]*--mark-l-fg: 0\.38;/);
    expect(css).toMatch(
      /:root\[data-theme="dark"\] \{[^}]*--mark-l-bg: 0\.30?;[^}]*--mark-l-fg: 0\.88;/
    );
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{[^}]*--mark-l-bg: 0\.30?;[^}]*--mark-l-fg: 0\.88;/
    );
  });

  it("Reference mode left the sheets: no pointer capture, no outline, no toggle rule (U2)", () => {
    expect(sheet("frame/Frame.css")).not.toMatch(/reference/i);
    expect(sheet("ui/TopBar.css")).not.toMatch(/reference/i);
    expect(sheet("ui/MoreMenu.css")).not.toMatch(/reference/i);
  });

  it("the compact bar pushes its end group from the Hot reload toggle (U2)", () => {
    expect(sheet("ui/TopBar.css")).toMatch(
      /:scope\[data-layout="compact"\] > \[data-action="hot-reload"\] \{[^}]*margin-inline-start: auto;/
    );
  });
});

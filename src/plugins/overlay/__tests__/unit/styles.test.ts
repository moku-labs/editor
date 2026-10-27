import { describe, expect, it } from "vitest";
import { COLOUR } from "../../model/format";
import { overlayCss } from "../../styles";
import { SLIDE_MS } from "../../types";

/**
 * Every value of a property in the sheet.
 *
 * @param property - The property name.
 * @returns The values, trimmed.
 */
function valuesOf(property: string): string[] {
  const pattern = new RegExp(String.raw`(?:^|[\s;{])${property}\s*:\s*([^;}]+)`, "g");
  return [...overlayCss.matchAll(pattern)].map(match => (match[1] ?? "").trim());
}

/**
 * The hex value a token resolves to, following `var(--x)` chains.
 *
 * @param token - A `--name`.
 * @returns The hex, or undefined.
 */
function resolve(token: string): string | undefined {
  const declared = new RegExp(String.raw`${token}\s*:\s*([^;]+);`).exec(overlayCss)?.[1]?.trim();
  if (declared === undefined) return undefined;
  const inner = /^var\((--[\w-]+)\)$/.exec(declared)?.[1];
  return inner === undefined ? declared : resolve(inner);
}

/** An opaque hex colour. */
const OPAQUE = /^#[\dA-Fa-f]{6}$/;

describe("C1: no transparency, no blur, no filter", () => {
  it("has no backdrop-filter, filter, blur, opacity, alpha colour or transparent ground", () => {
    expect(overlayCss).not.toMatch(/backdrop-filter|blur\(|rgba\(|hsla\(|color-mix\(|transparent/);
    expect(valuesOf("filter")).toEqual([]);
    expect(valuesOf("opacity")).toEqual([]);
    expect(overlayCss).not.toMatch(/\d\s+\/\s+\d/);
  });

  it("draws every shadow without a blur radius", () => {
    const shadows = valuesOf("box-shadow");
    expect(shadows.length).toBeGreaterThan(0);
    for (const shadow of shadows) expect(shadow).toMatch(/^0 \dpx 0 var\(--drop\)$/);
  });
});

describe("C2: opaque surfaces", () => {
  it("resolves every background to an opaque token (or the legend's own --c)", () => {
    const backgrounds = valuesOf("background");
    expect(backgrounds.length).toBeGreaterThan(20);
    for (const background of backgrounds) {
      if (background === "var(--c)") continue;
      const token = /^var\((--[\w-]+)\)$/.exec(background)?.[1];
      expect(token, background).toBeDefined();
      expect(resolve(token ?? ""), background).toMatch(OPAQUE);
    }
  });

  it("gives --c only opaque colours (the view's tokens)", () => {
    for (const colour of Object.values(COLOUR)) {
      const token = /^var\((--[\w-]+)\)$/.exec(colour)?.[1] ?? "";
      expect(resolve(token), colour).toMatch(OPAQUE);
    }
  });
});

describe("C5 and C6: one slide, no loop", () => {
  it("has only the two slide keyframes, played once, and nothing infinite", () => {
    expect(overlayCss).not.toContain("infinite");
    expect([...overlayCss.matchAll(/@keyframes\s+([\w-]+)/g)].map(match => match[1])).toEqual([
      "overlay-in-right",
      "overlay-in-left"
    ]);
    const animations = valuesOf("animation").filter(value => value !== "none");
    expect(animations).toEqual([
      `overlay-in-right ${SLIDE_MS}ms ease-out 1`,
      `overlay-in-left ${SLIDE_MS}ms ease-out 1`
    ]);
    expect(SLIDE_MS).toBeLessThanOrEqual(150);
  });

  it("the reduced-motion block misses the slide (it removes it)", () => {
    const block =
      /@media \(prefers-reduced-motion: reduce\)\s*\{([^}]*\})/.exec(overlayCss)?.[1] ?? "";
    expect(block).toMatch(/\[data-overlay\]\s*\{\s*animation:\s*none;/);
    expect(overlayCss.indexOf("@layer utilities")).toBeGreaterThan(
      overlayCss.indexOf("@keyframes")
    );
  });
});

describe("structure", () => {
  it("declares the layer order first and selects by data-* only", () => {
    expect(overlayCss.startsWith("@layer reset, tokens, components, utilities;")).toBe(true);
    expect(overlayCss).not.toMatch(/(^|[\s,{>+~])\.[a-z]/);
    expect(overlayCss).toContain(":host([hidden]) { display: none; }");
  });

  it("every safe-area probe reads --moku-device-safe-* after --moku-safe-* (bug: the overlay under the status bar)", () => {
    // The native shell writes the system insets as --moku-device-safe-*; a side without that link
    // would read only env(), which an older WebView leaves at 0 under the bars.
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(overlayCss).toContain(
        `var(--moku-safe-${side}, var(--moku-device-safe-${side}, env(safe-area-inset-${side}, 0px)))`
      );
    }
  });
});

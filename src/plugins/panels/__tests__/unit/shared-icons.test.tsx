// @vitest-environment happy-dom
import type { ComponentChildren } from "preact";
import { h, render } from "preact";
import { afterEach, describe, expect, it } from "vitest";
import { Icon } from "../../shared/icons";

// ─────────────────────────────────────────────────────────────────────────────
// icons.tsx: the 16 px stroke icons of workspace, flowView and the views.
// Decorative: aria-hidden; the control around an icon carries its label.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renders one element into a fresh root.
 *
 * @param node - The element.
 * @returns The root.
 */
function mount(node: ComponentChildren): HTMLElement {
  const root = document.createElement("div");
  document.body.append(root);
  render(node, root);
  return root;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("Icon", () => {
  it("draws a decorative 16 px stroke svg named by data-icon", () => {
    const svg = mount(h(Icon, { name: "pause" })).querySelector("svg");

    expect(svg?.dataset.icon).toBe("pause");
    expect(svg?.getAttribute("width")).toBe("16");
    expect(svg?.getAttribute("height")).toBe("16");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 16 16");
    expect(svg?.getAttribute("stroke")).toBe("currentColor");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("focusable")).toBe("false");
    expect(svg?.querySelector("path")?.getAttribute("d")).toBe("M5.5 3.5v9M10.5 3.5v9");
  });

  it("takes another size", () => {
    const svg = mount(h(Icon, { name: "zoom-in", size: 12 })).querySelector("svg");

    expect(svg?.getAttribute("width")).toBe("12");
    expect(svg?.getAttribute("height")).toBe("12");
    expect(svg?.querySelector("path")?.getAttribute("d")).toBe("M3.5 8h9M8 3.5v9");
  });
});

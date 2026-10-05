// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { isEditableTarget } from "../../shared/editable";

// ─────────────────────────────────────────────────────────────────────────────
// editable.ts: the one "this element types text" check of the keymap and the
// views. Inputs, textareas, selects and contenteditable (and their children)
// type text; everything else, and a target that is no element, does not.
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  document.body.replaceChildren();
});

describe("isEditableTarget", () => {
  it("is true for an input, a textarea and a select", () => {
    for (const tag of ["input", "textarea", "select"]) {
      const element = document.createElement(tag);
      document.body.append(element);
      expect(isEditableTarget(element)).toBe(true);
    }
  });

  it("is true inside a contenteditable element", () => {
    const area = document.createElement("div");
    area.setAttribute("contenteditable", "true");
    const child = document.createElement("span");
    area.append(child);
    document.body.append(area);

    expect(isEditableTarget(area)).toBe(true);
    expect(isEditableTarget(child)).toBe(true);
  });

  it("is false for contenteditable=false and plain elements", () => {
    const area = document.createElement("div");
    area.setAttribute("contenteditable", "false");
    document.body.append(area);

    expect(isEditableTarget(area)).toBe(false);
    expect(isEditableTarget(document.body)).toBe(false);
  });

  it("is false for null and for a target that is no element", () => {
    // eslint-disable-next-line unicorn/no-null -- document.activeElement can be null
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(globalThis.window)).toBe(false);
  });
});

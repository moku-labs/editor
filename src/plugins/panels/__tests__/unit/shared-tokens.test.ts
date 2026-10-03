import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { TokenKind } from "../../shared/highlight";
import { codeToken, cssVar, duration, readDuration, readToken, token } from "../../shared/tokens";

// ─────────────────────────────────────────────────────────────────────────────
// tokens.ts: names only; every name must be declared in workspace tokens.css,
// the one home of the values (R4).
// ─────────────────────────────────────────────────────────────────────────────

// Node environment: import.meta.url is a file URL here (under the happy-dom environment it is an
// http URL). The DOM tests below build a happy-dom Window by hand.
const TOKENS_CSS = readFileSync(
  new URL("../../../workspace/styles/tokens.css", import.meta.url),
  "utf8"
);

/**
 * A happy-dom element in a document, with getComputedStyle stubbed onto the globals.
 *
 * @returns The element.
 */
function domElement(): HTMLElement {
  const window = new Window();
  const element = window.document.createElement("div");
  window.document.body.append(element);
  vi.stubGlobal("getComputedStyle", (target: Element) =>
    window.getComputedStyle(target as unknown as Parameters<typeof window.getComputedStyle>[0])
  );
  return element as unknown as HTMLElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Every custom property declared in tokens.css. */
const declared = new Set(
  [...TOKENS_CSS.matchAll(/(?<![\w-])(--[\w-]+)\s*:/g)].map(match => match[1])
);

describe("token names", () => {
  it("every name in token, codeToken and duration is declared in tokens.css", () => {
    const names = [
      ...Object.values(token),
      ...Object.values(codeToken),
      ...Object.values(duration)
    ];
    expect(names.length).toBeGreaterThan(50);
    for (const name of names) expect(declared.has(name), name).toBe(true);
  });

  it("names are unique", () => {
    const names = [
      ...Object.values(token),
      ...Object.values(codeToken),
      ...Object.values(duration)
    ];
    expect(new Set(names).size).toBe(names.length);
  });

  it("codeToken has one entry per TokenKind", () => {
    expectTypeOf<keyof typeof codeToken>().toEqualTypeOf<TokenKind>();
    expect(Object.keys(codeToken)).toHaveLength(15);
    for (const [kind, name] of Object.entries(codeToken)) expect(name).toBe(`--code-${kind}`);
  });
});

describe("cssVar, readToken, readDuration", () => {
  it('cssVar("accent") is var(--accent)', () => {
    expect(cssVar("accent")).toBe("var(--accent)");
    expect(cssVar("surfacePanel2")).toBe("var(--surface-panel-2)");
  });

  it("readToken reads the computed custom property, trimmed; unset is empty", () => {
    const element = domElement();
    element.style.setProperty("--accent", "  #5b5bd6 ");
    expect(readToken(element, "accent")).toBe("#5b5bd6");
    expect(readToken(element, "teal")).toBe("");
  });

  it("readDuration converts ms and s; unset or invalid is 0", () => {
    const element = domElement();
    element.style.setProperty("--duration-camera", "420ms");
    element.style.setProperty("--duration-zoom", "0.2s");
    element.style.setProperty("--duration-walk", "fast");
    expect(readDuration(element, "camera")).toBe(420);
    expect(readDuration(element, "zoom")).toBe(200);
    expect(readDuration(element, "walk")).toBe(0);
    expect(readDuration(element, "toast")).toBe(0);
  });
});

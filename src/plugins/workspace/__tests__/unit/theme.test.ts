// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, effectiveTheme, readOsTheme, watchOsTheme } from "../../prefs/theme";

// ─────────────────────────────────────────────────────────────────────────────
// Effective theme, <html data-theme> and the OS listener
// ─────────────────────────────────────────────────────────────────────────────

type ChangeListener = (event: { matches: boolean }) => void;

/**
 * A matchMedia double whose change listener the test fires.
 *
 * @param matches - The initial dark match.
 * @returns The stub and a trigger.
 */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<ChangeListener>();
  const query = {
    matches,
    addEventListener: vi.fn((_type: string, fn: ChangeListener) => listeners.add(fn)),
    removeEventListener: vi.fn((_type: string, fn: ChangeListener) => listeners.delete(fn))
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => query)
  );
  return {
    query,
    fire(dark: boolean) {
      for (const fn of listeners) fn({ matches: dark });
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
});

describe("effectiveTheme", () => {
  it("is the chosen theme, else the OS theme", () => {
    expect(effectiveTheme({ chosen: undefined, os: "dark" })).toBe("dark");
    expect(effectiveTheme({ chosen: "light", os: "dark" })).toBe("light");
  });
});

describe("applyTheme", () => {
  it("sets data-theme on the root element", () => {
    applyTheme("dark", document.documentElement);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("readOsTheme", () => {
  it("reads prefers-color-scheme: dark", () => {
    stubMatchMedia(true);
    expect(readOsTheme()).toBe("dark");
  });

  it("is light without matchMedia", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(readOsTheme()).toBe("light");
  });
});

describe("watchOsTheme", () => {
  it("calls back on OS changes until removed", () => {
    const media = stubMatchMedia(false);
    const seen: string[] = [];
    const remove = watchOsTheme(theme => seen.push(theme));

    media.fire(true);
    media.fire(false);
    remove();
    media.fire(true);

    expect(seen).toEqual(["dark", "light"]);
    expect(media.query.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it("is a no-op without matchMedia", () => {
    vi.stubGlobal("matchMedia", undefined);
    const remove = watchOsTheme(vi.fn());
    expect(() => remove()).not.toThrow();
  });
});

/**
 * @file workspace plugin — the theme: effective theme (the chosen one, else the OS one),
 * `<html data-theme>` that forces it in the token sheet, and the OS `prefers-color-scheme` listener.
 */
import type { Theme } from "../types";

/**
 * The media query of the OS dark mode.
 */
const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * The effective theme: the chosen one, else the OS one.
 *
 * @param theme - The theme state.
 * @param theme.chosen - The theme picked with the toggle, undefined until then.
 * @param theme.os - The OS theme.
 * @returns The theme to show.
 * @example
 * ```ts
 * effectiveTheme({ chosen: undefined, os: "dark" }); // "dark"
 * ```
 */
export function effectiveTheme(theme: {
  readonly chosen: Theme | undefined;
  readonly os: Theme;
}): Theme {
  return theme.chosen ?? theme.os;
}

/**
 * Forces a theme on the root element (`[data-theme]` in tokens.css sets `color-scheme`).
 *
 * @param theme - The theme to show.
 * @param root - The `<html>` element.
 * @example
 * ```ts
 * applyTheme("dark", document.documentElement);
 * ```
 */
export function applyTheme(theme: Theme, root: HTMLElement): void {
  root.dataset.theme = theme;
}

/**
 * The OS theme now; light where `matchMedia` is missing.
 *
 * @returns "dark" when the OS prefers dark.
 * @example
 * ```ts
 * state.theme.os = readOsTheme();
 * ```
 */
export function readOsTheme(): Theme {
  return globalThis.matchMedia?.(DARK_QUERY).matches ? "dark" : "light";
}

/**
 * Listens to OS theme changes.
 *
 * @param onChange - Called with the new OS theme.
 * @returns Removes the listener (a no-op without `matchMedia`).
 * @example
 * ```ts
 * state.dom.cleanup.push(watchOsTheme(theme => osThemeChanged(ctx, theme)));
 * ```
 */
export function watchOsTheme(onChange: (theme: Theme) => void): () => void {
  const query = globalThis.matchMedia?.(DARK_QUERY);
  if (query === undefined) return () => {};

  /**
   * Passes the new OS theme on.
   *
   * @param event - The media change.
   * @param event.matches - True for dark.
   * @example
   * ```ts
   * query.addEventListener("change", listener);
   * ```
   */
  const listener = (event: { readonly matches: boolean }): void => {
    onChange(event.matches ? "dark" : "light");
  };
  query.addEventListener("change", listener);
  return () => {
    query.removeEventListener("change", listener);
  };
}

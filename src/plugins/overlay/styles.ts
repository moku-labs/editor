/**
 * @file overlay plugin — the shadow-root stylesheet as text. A library mounted into a game page
 * cannot rely on a bundled `.css` asset, and a shadow root needs the sheet as a string. Follows the
 * moku-web rules: one `@layer` order, two-layer tokens (primitives, then semantics with
 * `light-dark()`), `@scope` for the card, `data-*` selectors only, reduced motion respected.
 */
import { Z_INDEX } from "./types";

/**
 * The reset layer: the host takes nothing from the game page.
 */
const RESET = `
@layer reset {
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }
  ul, p { margin: 0; padding: 0; }
  ul { list-style: none; }
  button { font: inherit; color: inherit; }
}`;

/**
 * The tokens layer: primitives (design-context §2), then the semantic tokens of the card. The
 * card follows the toast rule: ink surface that inverts with the theme.
 */
const TOKENS = `
@layer tokens {
  :host {
    --prim-ink-900: #1C1C21;
    --prim-ink-50: #ECECF0;
    --prim-white: #F2F2F5;
    --prim-live-300: #7EE2A8;
    --prim-live-600: #17905A;
    --prim-warn-400: #E3A541;
    --prim-warn-600: #B4741A;
    --prim-red-400: #F06A5F;
    --prim-red-600: #D1453B;
    --prim-accent-400: #6E6EE6;
    --prim-accent-600: #5B5BD6;
    --prim-muted-400: #9A9AA4;
    --prim-muted-600: #6D6D78;
    --font-sans: Geist, ui-sans-serif, system-ui, sans-serif;
    --font-mono: "Geist Mono", ui-monospace, monospace;
    --radius-card: 10px;
    --radius-button: 6px;
    --radius-chip: 4px;
    --space-card: 8px;
    --inset: 12px;
    --duration-fast: 120ms;

    color-scheme: light dark;
    --overlay-surface: light-dark(
      color-mix(in srgb, var(--prim-ink-900) 86%, transparent),
      color-mix(in srgb, var(--prim-ink-50) 92%, transparent)
    );
    --overlay-text: light-dark(var(--prim-white), var(--prim-ink-900));
    --overlay-text-2: color-mix(in srgb, var(--overlay-text) 60%, transparent);
    --overlay-fill: color-mix(in srgb, var(--overlay-text) 8%, transparent);
    --overlay-fill-hover: color-mix(in srgb, var(--overlay-text) 16%, transparent);
    --overlay-live: light-dark(var(--prim-live-300), var(--prim-live-600));
    --overlay-warn: light-dark(var(--prim-warn-400), var(--prim-warn-600));
    --overlay-error: light-dark(var(--prim-red-400), var(--prim-red-600));
    --overlay-muted: light-dark(var(--prim-muted-400), var(--prim-muted-600));
    --overlay-focus: light-dark(var(--prim-accent-400), var(--prim-accent-600));
    --overlay-shadow: 0 6px 18px rgb(0 0 0 / 30%);
  }
}`;

/**
 * The host box: fixed, sized to the card, in one corner; hidden means no box at all.
 */
const HOST = `
  :host {
    position: fixed;
    z-index: ${Z_INDEX};
    width: 212px;
    max-height: calc(100dvh - 24px);
    overflow: auto;
    display: block;
  }
  :host([hidden]) { display: none; }
  :host([data-corner="top-right"]) {
    top: calc(var(--inset) + env(safe-area-inset-top, 0px));
    right: calc(var(--inset) + env(safe-area-inset-right, 0px));
  }
  :host([data-corner="top-left"]) {
    top: calc(var(--inset) + env(safe-area-inset-top, 0px));
    left: calc(var(--inset) + env(safe-area-inset-left, 0px));
  }
  :host([data-corner="bottom-right"]) {
    bottom: calc(var(--inset) + env(safe-area-inset-bottom, 0px));
    right: calc(var(--inset) + env(safe-area-inset-right, 0px));
  }
  :host([data-corner="bottom-left"]) {
    bottom: calc(var(--inset) + env(safe-area-inset-bottom, 0px));
    left: calc(var(--inset) + env(safe-area-inset-left, 0px));
  }`;

/**
 * The card, scoped to `[data-overlay]`. No backdrop blur: it costs too much over a GPU canvas (WebGPU or WebGL).
 */
const CARD = `
  @scope ([data-overlay]) {
    :scope {
      display: grid;
      gap: 6px;
      padding: var(--space-card);
      border-radius: var(--radius-card);
      background: var(--overlay-surface);
      color: var(--overlay-text);
      box-shadow: var(--overlay-shadow);
      font: 11px/1.35 var(--font-sans);
    }
    [data-head] {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10.5px;
      color: var(--overlay-text-2);
    }
    [data-title] { color: var(--overlay-text); font-weight: 600; }
    [data-hint] { margin-inline-start: auto; }
    [data-dot] {
      flex: none;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--overlay-muted);
    }
    [data-dot][data-kind="connecting"] {
      background: var(--overlay-muted);
      animation: overlay-pulse 1.6s ease-in-out infinite;
    }
    [data-dot][data-kind="live"] { background: var(--overlay-live); }
    [data-dot][data-kind="paused"] { background: var(--overlay-warn); }
    [data-dot][data-kind="silent"] { background: var(--overlay-warn); }
    [data-dot][data-kind="lost"] { background: var(--overlay-error); }
    [data-dot][data-kind="empty"] { background: var(--overlay-muted); }
    [data-chips] { display: flex; flex-wrap: wrap; gap: 4px; }
    [data-chip] {
      padding: 1px 5px;
      border-radius: var(--radius-chip);
      background: var(--overlay-fill);
      font: 10.5px/1.4 var(--font-mono);
    }
    [data-chip="fps"] { color: var(--overlay-live); }
    [data-cheats] { display: grid; gap: 4px; }
    [data-cheat] {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      min-height: 28px;
      padding: 5px 8px;
      border: 0;
      border-radius: var(--radius-button);
      background: var(--overlay-fill);
      text-align: start;
      white-space: normal;
      overflow-wrap: anywhere;
      cursor: pointer;
      transition: background-color var(--duration-fast) ease-out;
    }
    [data-cheat]:hover:not(:disabled) { background: var(--overlay-fill-hover); }
    [data-cheat]:focus-visible { outline: 2px solid var(--overlay-focus); outline-offset: 2px; }
    [data-cheat][data-state="busy"] { opacity: 0.6; cursor: progress; }
    [data-label] { flex: 1; }
    [data-mark] { flex: none; font-weight: 700; }
    [data-state="ok"] [data-mark] { color: var(--overlay-live); }
    [data-state="error"] [data-mark] { color: var(--overlay-error); }
    [data-empty] { color: var(--overlay-muted); }
    [data-announce] {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }
  @keyframes overlay-pulse {
    50% { opacity: 0.35; }
  }`;

/**
 * The utilities layer: reduced motion stops the pulse and the hover transition.
 */
const UTILITIES = `
@layer utilities {
  @media (prefers-reduced-motion: reduce) {
    * { transition: none; animation: none; }
  }
}`;

/**
 * The shadow-root stylesheet of the overlay (adopted, or a `<style>` fallback).
 *
 * @example
 * ```ts
 * const sheet = new CSSStyleSheet();
 * sheet.replaceSync(overlayCss);
 * root.adoptedStyleSheets = [sheet];
 * ```
 */
export const overlayCss = `@layer reset, tokens, components, utilities;
${RESET}
${TOKENS}
@layer components {${HOST}
${CARD}
}
${UTILITIES}
`;

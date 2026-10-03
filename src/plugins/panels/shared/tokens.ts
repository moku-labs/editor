/**
 * @file Shared view module — CSS custom property names of the workspace design tokens for
 * TypeScript (inline SVG, style props, canvas drawing). Values live only in
 * workspace/styles/tokens.css (R4); a panels test checks that every name here is declared there.
 */
import type { TokenKind } from "./highlight";

/**
 * Semantic and layout token names.
 */
export const token = {
  surfaceGround: "--surface-ground",
  surfacePanel: "--surface-panel",
  surfacePanel2: "--surface-panel-2",
  surfaceCanvas: "--surface-canvas",
  line1: "--line-1",
  line2: "--line-2",
  textInk: "--text-ink",
  text2: "--text-2",
  textMuted: "--text-muted",
  accent: "--accent",
  accent2: "--accent-2",
  accentSoft: "--accent-soft",
  accentSoftStrong: "--accent-soft-strong",
  statusLive: "--status-live",
  statusWarn: "--status-warn",
  statusError: "--status-error",
  teal: "--teal",
  edge: "--edge",
  canvasDot: "--canvas-dot",
  noteFill: "--note-fill",
  noteLine: "--note-line",
  noteInk: "--note-ink",
  pickHover: "--pick-hover",
  pickTree: "--pick-tree",
  phase1: "--phase-1",
  phase2: "--phase-2",
  phase3: "--phase-3",
  phase4: "--phase-4",
  phase5: "--phase-5",
  topbarH: "--topbar-h",
  railW: "--rail-w",
  inspectorW: "--inspector-w",
  toastBand: "--toast-band"
} as const;

/**
 * A token name key.
 */
export type TokenName = keyof typeof token;

/**
 * The code-colour token of every highlighter TokenKind.
 */
export const codeToken: { readonly [K in TokenKind]: `--code-${K}` } = {
  plain: "--code-plain",
  keyword: "--code-keyword",
  literal: "--code-literal",
  string: "--code-string",
  number: "--code-number",
  comment: "--code-comment",
  type: "--code-type",
  function: "--code-function",
  property: "--code-property",
  tag: "--code-tag",
  attr: "--code-attr",
  punct: "--code-punct",
  operator: "--code-operator",
  meta: "--code-meta",
  heading: "--code-heading"
};

/**
 * Motion duration token names.
 */
export const duration = {
  camera: "--duration-camera",
  zoom: "--duration-zoom",
  follow: "--duration-follow",
  strip: "--duration-strip",
  walk: "--duration-walk",
  resize: "--duration-resize",
  toast: "--duration-toast"
} as const;

/**
 * A CSS time: a number with a `ms` or `s` unit.
 */
const CSS_TIME = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(ms|s)$/;

/**
 * `var(--name)` for a token.
 *
 * @param name - The token key.
 * @returns The CSS `var()` reference.
 * @example
 * ```ts
 * cssVar("accent"); // "var(--accent)"
 * ```
 */
export function cssVar(name: TokenName): string {
  return `var(${token[name]})`;
}

/**
 * The computed value of a token on an element; "" when unset.
 *
 * @param element - The element to read from.
 * @param name - The token key.
 * @returns The trimmed computed value.
 * @example
 * ```ts
 * context2d.fillStyle = readToken(minimapElement, "accent");
 * ```
 */
export function readToken(element: Element, name: TokenName): string {
  return getComputedStyle(element).getPropertyValue(token[name]).trim();
}

/**
 * A duration token in ms: "420ms" → 420, "0.2s" → 200, unset or invalid → 0.
 *
 * @param element - The element to read from.
 * @param name - The duration key.
 * @returns Milliseconds.
 * @example
 * ```ts
 * readDuration(canvasElement, "camera"); // 420
 * ```
 */
export function readDuration(element: Element, name: keyof typeof duration): number {
  const value = getComputedStyle(element).getPropertyValue(duration[name]).trim();
  const match = CSS_TIME.exec(value);
  if (match === null) return 0;

  const amount = Number(match[1]);
  return match[2] === "s" ? Math.round(amount * 1000) : amount;
}

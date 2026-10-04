/**
 * @file workspace plugin — the density: `auto` resolves to compact below 820 px of window width
 * and comfortable from there; `<html data-density>` selects the spacing tokens in tokens.css; a
 * change of the applied value emits `workspace:density`. The choice is saved with the other
 * preferences (`prefs/apply.ts chooseDensity`).
 */
import type { Density, DensityChoice, WorkspaceCtx, WorkspaceState } from "../types";

/**
 * Below this window width `auto` is compact, in px (a half-screen window and narrower).
 *
 * @example
 * ```ts
 * resolveDensity("auto", COMPACT_BELOW - 1); // "compact"
 * ```
 */
export const COMPACT_BELOW = 820;

/**
 * The three choices, in palette order.
 *
 * @example
 * ```ts
 * DENSITY_CHOICES[0]; // "auto"
 * ```
 */
export const DENSITY_CHOICES: readonly DensityChoice[] = ["auto", "compact", "comfortable"];

/**
 * The choices as a set of unknown values, for the guard.
 */
const CHOICE_SET: ReadonlySet<unknown> = new Set(DENSITY_CHOICES);

/**
 * True for auto, compact or comfortable.
 *
 * @param value - A stored or passed value.
 * @returns Whether it is a DensityChoice.
 * @example
 * ```ts
 * isDensityChoice("compact"); // true
 * isDensityChoice("cosy"); // false
 * ```
 */
export function isDensityChoice(value: unknown): value is DensityChoice {
  return CHOICE_SET.has(value);
}

/**
 * The density a choice shows at a window width.
 *
 * @param choice - The chosen density.
 * @param width - The window width in CSS px.
 * @returns compact or comfortable.
 * @example
 * ```ts
 * resolveDensity("auto", 720); // "compact"
 * resolveDensity("auto", 1440); // "comfortable"
 * resolveDensity("compact", 1440); // "compact"
 * ```
 */
export function resolveDensity(choice: DensityChoice, width: number): Density {
  if (choice !== "auto") return choice;
  return width < COMPACT_BELOW ? "compact" : "comfortable";
}

/**
 * The window width now; infinite where there is no window (comfortable).
 *
 * @returns The width in CSS px.
 * @example
 * ```ts
 * viewportWidth(); // 720 in a half-screen window
 * ```
 */
export function viewportWidth(): number {
  return globalThis.innerWidth ?? Number.POSITIVE_INFINITY;
}

/**
 * Shows the applied density on `<html>` (where there is a document).
 *
 * @param state - Workspace state.
 */
export function showDensity(state: WorkspaceState): void {
  const root = globalThis.document?.documentElement;
  if (root !== undefined) root.dataset.density = state.density.applied;
}

/**
 * Re-resolves the chosen density at the current window width (after a choice or a resize). A
 * changed value is shown on `<html>`, emitted as `workspace:density` and re-renders the shell.
 *
 * @param ctx - State and emit.
 */
export function refreshDensity(ctx: Pick<WorkspaceCtx, "state" | "emit">): void {
  const { density } = ctx.state;
  const next = resolveDensity(density.chosen, viewportWidth());
  if (next === density.applied) return;

  density.applied = next;
  showDensity(ctx.state);
  ctx.emit("workspace:density", { density: next });
  ctx.state.ui.bump();
}

/**
 * @file The top bar as the e2e specs drive it (round 2 R1). From 900 px of window width the bar
 * shows every control: the Preview (G), Overlay (O) and Hot reload (H) switches with their labels,
 * Reference mode, Registry and theme. Below 900 px it is compact: those controls are rows of the ⋯
 * menu (`data-action="more"`), a top-layer `role="menu"` popover that renders its rows only while
 * it is open. The helpers find a control in either place by its `data-action`, which the switch
 * and its menu row share.
 */
import { expect, type Locator, type Page } from "@playwright/test";

/** The data-action names of the toggles that move into the ⋯ menu below 900 px. */
export type BarToggle = "game" | "overlay" | "reference" | "hot-reload";

/** Below this window width the top bar is compact. */
export const COMPACT_BELOW = 900;

/**
 * The top bar.
 *
 * @param page - The tools page.
 * @returns The locator.
 */
export function topBar(page: Page): Locator {
  return page.locator("[data-ui=top-bar]");
}

/**
 * The ⋯ menu popover.
 *
 * @param page - The tools page.
 * @returns The locator.
 */
export function moreMenu(page: Page): Locator {
  return page.locator("[data-ui=more-menu]");
}

/**
 * Tells whether the bar is compact now (it re-renders on a window resize).
 *
 * @param page - The tools page.
 * @returns True below 900 px.
 */
export async function isCompact(page: Page): Promise<boolean> {
  return (await topBar(page).getAttribute("data-layout")) === "compact";
}

/**
 * Opens the ⋯ menu when it is shut and waits for its rows.
 *
 * @param page - The tools page.
 */
export async function openMore(page: Page): Promise<void> {
  const button = topBar(page).locator("[data-action=more]");
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(moreMenu(page)).toBeVisible();
  await expect(moreMenu(page).locator("[role^=menuitem]").first()).toBeVisible();
}

/**
 * Shuts the ⋯ menu when it is open (Esc, the menu's own closer).
 *
 * @param page - The tools page.
 */
export async function closeMore(page: Page): Promise<void> {
  const button = topBar(page).locator("[data-action=more]");
  if ((await button.count()) === 0 || (await button.getAttribute("aria-expanded")) !== "true") {
    return;
  }
  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(moreMenu(page)).toBeHidden();
}

/**
 * A top-bar control by its data-action: the control of the wide bar, or the row of the ⋯ menu
 * (opened first) in the compact one.
 *
 * @param page - The tools page.
 * @param action - The data-action, e.g. "overlay" or "registry".
 * @returns The locator.
 */
export async function barControl(page: Page, action: string): Promise<Locator> {
  if (!(await isCompact(page))) return topBar(page).locator(`:scope > [data-action="${action}"]`);
  await openMore(page);
  return moreMenu(page).locator(`[data-action="${action}"]`);
}

/**
 * Whether a toggle of the top bar is on (`aria-checked` of the switch or the menu row, or
 * `aria-pressed` of the Reference button). Shuts the ⋯ menu again when it opened it.
 *
 * @param page - The tools page.
 * @param action - The toggle.
 * @returns True when on.
 */
export async function barChecked(page: Page, action: BarToggle): Promise<boolean> {
  const control = await barControl(page, action);
  const pressed = await control.getAttribute("aria-pressed");
  const value = pressed ?? (await control.getAttribute("aria-checked"));
  await closeMore(page);
  return value === "true";
}

/**
 * Flips a toggle of the top bar with a click, then shuts the ⋯ menu (a toggle row keeps it open).
 *
 * @param page - The tools page.
 * @param action - The toggle.
 */
export async function flipBarToggle(page: Page, action: BarToggle): Promise<void> {
  const control = await barControl(page, action);
  await control.click();
  await closeMore(page);
}

/**
 * Clicks a plain control of the top bar (Registry, theme, density): the wide bar's button or the
 * ⋯ menu row. A value row acts and leaves the menu as it does (Registry opens its popover).
 *
 * @param page - The tools page.
 * @param action - The data-action.
 */
export async function clickBarControl(page: Page, action: string): Promise<void> {
  const control = await barControl(page, action);
  await control.click();
}

/**
 * Makes the pinned game preview visible in the shown workspace: the narrow windows may start with
 * it hidden, then the Game preview toggle of the top bar shows it.
 *
 * @param page - The tools page.
 */
export async function showPreview(page: Page): Promise<void> {
  const preview = page.locator("[data-ui=preview]");
  if (await preview.isHidden()) await flipBarToggle(page, "game");
  await expect(preview).toBeVisible();
}

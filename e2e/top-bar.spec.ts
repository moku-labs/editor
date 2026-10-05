/**
 * @file The compact top bar (round 2 R1, round 2b R15) at every window width the editor runs in:
 * 480, 600, 640, 720 and 899 px show the compact bar (logo, game name above 560 px, link pill,
 * Pause and Step as icons, the Reference mode icon toggle, above 560 px the Hot reload icon
 * toggle, the search icon and the ⋯ menu), 960 and 1440 px the wide one (session chip, the
 * labelled Preview, Overlay and Hot reload switches, Reference mode, Registry as an icon with its
 * counts in the title, theme). The test loops `page.setViewportSize` itself, so it runs once, in
 * the desktop project. At each width no two controls of the bar overlap (bounding boxes), every
 * control is on screen and takes the pointer at its centre, and every action works: from the bar
 * icons and the ⋯ menu below 900 px, from the bar from 900 px. A refused Hot reload change logs
 * nothing (round 2b R16): the bin answers 200 with its state. The Game toolbar has no overlay
 * switch of its own any more; its switches are Safe area and Sound.
 */
import type { Page } from "@playwright/test";
import { expect, type Tools, test } from "./fixtures";
import { closeMore, isCompact, moreMenu, openMore, topBar } from "./top-bar";

/** The window widths of the spec, in px; the height stays 900. */
const WIDTHS = [480, 600, 640, 720, 899, 960, 1440] as const;

/** At this width and narrower the compact bar keeps only the Reference icon toggle (R15). */
const NARROW_BAR_MAX = 560;

/** The compact widths. */
const COMPACT_WIDTHS = WIDTHS.filter(width => width < 900);

/** The wide widths. */
const WIDE_WIDTHS = WIDTHS.filter(width => width >= 900);

/** The ⋯ menu rows in order, with the key a toggle row shows. */
const MENU_ROWS = [
  { action: "game", label: "Game preview", key: "G" },
  { action: "overlay", label: "Overlay in game", key: "O" },
  { action: "reference", label: "Reference mode", key: "R" },
  { action: "hot-reload", label: "Hot reload", key: "H" },
  { action: "registry", label: "Registry", key: undefined },
  { action: "density", label: "Density", key: undefined },
  { action: "theme", label: "Theme", key: undefined }
] as const;

/** One direct child of the top bar, measured in the page. */
type BarItem = {
  readonly name: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly hit: boolean;
};

/**
 * Measures the visible direct children of the top bar (closed popovers are not children that
 * show) and whether each one is the topmost element at its centre.
 *
 * @param page - The tools page.
 * @returns The overflow of the bar in px and the items, left to right.
 */
async function measureBar(page: Page): Promise<{ overflow: number; items: BarItem[] }> {
  return page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>("[data-ui=top-bar]");
    const children = bar === null ? [] : [...bar.children];
    const items = children
      .filter(child => child.checkVisibility() && !child.matches("[popover]"))
      .map(child => {
        const element = child as HTMLElement;
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2
        );
        const data = element.dataset;
        const name =
          data.action ??
          data.ui ??
          (data.search === undefined ? undefined : "search") ??
          (data.gameName === undefined ? undefined : "game-name") ??
          (data.logo === undefined ? undefined : "logo") ??
          element.tagName.toLowerCase();
        return {
          name,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          hit: hit !== null && element.contains(hit)
        };
      });
    return { overflow: bar === null ? -1 : bar.scrollWidth - bar.clientWidth, items };
  });
}

/**
 * Judges the bar: no overflow, every item on screen and taking the pointer, no two items sharing
 * more than half a pixel on both axes.
 *
 * @param page - The tools page.
 * @param width - The window width.
 * @returns The item names left to right and the findings (empty when the bar is fine).
 */
async function judgeBar(
  page: Page,
  width: number
): Promise<{ names: string[]; findings: string[] }> {
  const { overflow, items } = await measureBar(page);
  const findings = overflow > 0 ? [`the bar overflows by ${overflow}px`] : [];
  for (const item of items) {
    if (item.left < 0 || item.right > width) findings.push(`${item.name} off screen`);
    if (!item.hit) findings.push(`${item.name} is covered at its centre`);
  }
  for (const [index, a] of items.entries()) {
    for (const b of items.slice(index + 1)) {
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x > 0.5 && y > 0.5) findings.push(`${a.name} overlaps ${b.name} by ${x.toFixed(1)}px`);
    }
  }
  return { names: items.map(item => item.name), findings };
}

/**
 * Sets the window width (900 px tall) and waits for the bar's layout of that width.
 *
 * @param tools - The driver.
 * @param width - The window width.
 */
async function resize(tools: Tools, width: number): Promise<void> {
  await tools.page.setViewportSize({ width, height: 900 });
  await expect(topBar(tools.page)).toHaveAttribute("data-layout", width < 900 ? "compact" : "wide");
  await tools.settle();
}

/**
 * The newest toast.
 *
 * @param page - The tools page.
 * @returns Its text.
 */
function lastToast(page: Page) {
  return page.locator("[data-ui=toasts] [data-toast]").last();
}

/**
 * The game page frame.
 *
 * @param page - The tools page.
 * @returns The frame.
 */
function gameFrame(page: Page) {
  const frame = page.frames().find(f => f !== page.mainFrame() && !f.url().includes("/__editor/"));
  if (frame === undefined) throw new Error("no game frame");
  return frame;
}

/**
 * A row of the ⋯ menu by its data-action (the menu renders its rows only while it is open).
 *
 * @param page - The tools page.
 * @param action - The data-action.
 * @returns The locator.
 */
function menuRow(page: Page, action: string) {
  return moreMenu(page).locator(`[data-action="${action}"]`);
}

/**
 * Expects Pause and Step of the compact bar to show their icon only (R15): no visible label text,
 * the label still their accessible name.
 *
 * @param page - The tools page.
 * @param width - The window width, for the messages.
 */
async function expectIconButtons(page: Page, width: number): Promise<void> {
  for (const [action, name] of [
    ["pause", "Pause"],
    ["step", "Step 1 frame"]
  ] as const) {
    const button = topBar(page).locator(`:scope > [data-action=${action}]`);
    await expect(button.locator("svg")).toHaveCount(1);
    const shown = await button.evaluate(element =>
      [...element.querySelectorAll("span")]
        .filter(span => span.checkVisibility() && span.dataset.srOnly === undefined)
        .map(span => span.textContent)
        .join("")
    );
    expect(shown, `${action} label at ${width} px`).toBe("");
    await expect(topBar(page).getByRole("button", { name, exact: true })).toBeVisible();
  }
}

test.describe("top bar · round 2", () => {
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(
      browserName !== "chromium" || testInfo.project.name !== "chromium-desktop",
      "the spec sets every window width itself"
    );
  });

  test("480 / 600 / 640 / 720 / 899 / 960 / 1440: no two controls overlap, each is on screen and takes the pointer", async ({
    tools
  }) => {
    const page = tools.page;
    for (const width of WIDTHS) {
      await resize(tools, width);
      const { names, findings } = await judgeBar(page, width);
      expect(findings, `top bar at ${width} px`).toEqual([]);

      const compact = width < 900;
      const expected = compact
        ? [
            "logo",
            ...(width > 560 ? ["game-name"] : []),
            "link-pill",
            "pause",
            "step",
            "reference",
            ...(width > NARROW_BAR_MAX ? ["hot-reload"] : []),
            "search",
            "more"
          ]
        : [
            "logo",
            "game-name",
            "session-chip",
            "link-pill",
            "pause",
            "step",
            "search",
            "game",
            "overlay",
            "hot-reload",
            "reference",
            "registry",
            "theme"
          ];
      expect(names, `controls at ${width} px`).toEqual(expected);
      // Compact: Pause and Step are icons; their labels stay the accessible names.
      if (compact) await expectIconButtons(page, width);
      // The search never shrinks under its content: the wide box keeps 88 px, the icon 28.
      const search = await topBar(page).locator("[data-search]").boundingBox();
      expect(search?.width ?? 0, `search at ${width} px`).toBeGreaterThanOrEqual(compact ? 28 : 88);
      // No page scroll sideways.
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        ),
        `page overflow at ${width} px`
      ).toBe(0);
    }

    // The Game toolbar lost its overlay switch: the top bar holds the only one.
    await tools.show("game");
    const toolbar = page.locator("[data-workspace-host=game] [data-game=toolbar]");
    await expect(toolbar).toBeVisible();
    await expect(toolbar.locator("[data-part=overlay]")).toHaveCount(0);
    await expect(toolbar.getByRole("switch")).toHaveText(["Safe area", "Sound"]);
  });

  test("below 900 px the Reference and Hot reload icons act from the bar, and stay in the ⋯ menu", async ({
    tools,
    errors
  }) => {
    const page = tools.page;
    for (const width of COMPACT_WIDTHS) {
      await resize(tools, width);
      await tools.show("game");
      const bar = topBar(page);

      // Reference mode: a target icon, aria-pressed, the key in its title.
      const reference = bar.locator(":scope > [data-action=reference]");
      await expect(reference).toBeVisible();
      await expect(reference).toHaveAccessibleName("Reference mode");
      await expect(reference).toHaveAttribute("title", /\(R\)/);
      await expect(reference).toHaveAttribute("aria-pressed", "false");
      await reference.click();
      await expect(reference).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("[data-frame-box]")).toHaveAttribute("data-reference", "");
      // The ⋯ row mirrors it.
      await openMore(page);
      await expect(menuRow(page, "reference")).toHaveAttribute("aria-checked", "true");
      await closeMore(page);
      await reference.click();
      await expect(reference).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator("[data-frame-box]")).not.toHaveAttribute("data-reference", "");

      // Hot reload: a bar icon with a dot while on, above 560 px; a ⋯ row always.
      const hot = bar.locator(":scope > [data-action=hot-reload]");
      if (width <= NARROW_BAR_MAX) {
        await expect(hot).toHaveCount(0);
      } else {
        await expect(hot).toBeVisible();
        await expect(hot).toHaveAccessibleName("Hot reload");
        await expect(hot).toHaveAttribute("aria-pressed", "true");
        await expect(hot.locator("[data-part=dot]")).toHaveCount(1);
        // A click asks the bin, which keeps hot reload on and says how to change it; nothing is
        // logged (R16: the refusal answers 200 with the state).
        await hot.click();
        await expect(lastToast(page)).toHaveText(
          "Start the bin with --no-hmr to turn hot reload off"
        );
        await expect(hot).toHaveAttribute("aria-pressed", "true");
        await expect(hot).toHaveAttribute("title", /--no-hmr/);
      }
      await openMore(page);
      await expect(menuRow(page, "hot-reload")).toHaveAttribute("aria-checked", "true");
      await closeMore(page);
    }
    expect(errors.unexpected(), "no console error from the refused change").toEqual([]);
  });

  test("below 900 px the ⋯ menu holds every action, and each one works", async ({
    tools,
    errors
  }) => {
    const page = tools.page;
    const html = page.locator("html");
    const card = gameFrame(page).locator("[data-moku-editor-overlay]");
    for (const width of COMPACT_WIDTHS) {
      await resize(tools, width);
      await tools.show("game");
      expect(await isCompact(page)).toBe(true);
      const menu = moreMenu(page);

      // The rows in order, each with its label, its state and (a toggle) its key.
      await openMore(page);
      await expect(menu).toHaveAttribute("role", "menu");
      await expect(menu.locator("[role^=menuitem]")).toHaveCount(MENU_ROWS.length);
      for (const [index, { action, label, key }] of MENU_ROWS.entries()) {
        const item = menu.locator("[role^=menuitem]").nth(index);
        await expect(item).toHaveAttribute("data-action", action);
        await expect(item.locator("[data-part=label]")).toHaveText(label);
        await expect(item.locator("[data-part=state]")).not.toBeEmpty();
        if (key !== undefined) await expect(item.locator("kbd")).toHaveText(key);
      }
      // The menu sits inside the window.
      const box = await menu.boundingBox();
      expect(box?.x ?? -1, `menu left at ${width} px`).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0), `menu right at ${width} px`).toBeLessThanOrEqual(
        width
      );

      // Game preview: inert in Game, which always shows the game.
      await expect(menuRow(page, "game")).toHaveAttribute("aria-disabled", "true");
      await expect(menuRow(page, "game")).toHaveAttribute("aria-checked", "true");

      // Overlay in game: on and off, the menu stays open.
      await expect(menuRow(page, "overlay")).toHaveAttribute("aria-checked", "false");
      await menuRow(page, "overlay").click();
      await expect(menuRow(page, "overlay")).toHaveAttribute("aria-checked", "true");
      await expect(menuRow(page, "overlay").locator("[data-part=state]")).toHaveText("on");
      await expect(lastToast(page)).toContainText("Overlay in game on");
      await expect(card).toBeVisible();
      await expect(menu).toBeVisible();
      await menuRow(page, "overlay").click();
      await expect(menuRow(page, "overlay")).toHaveAttribute("aria-checked", "false");
      await expect(lastToast(page)).toContainText("Overlay in game off");
      await expect(card).toBeHidden();

      // Reference mode: the frame box takes the pointer while it is on.
      await menuRow(page, "reference").click();
      await expect(menuRow(page, "reference")).toHaveAttribute("aria-checked", "true");
      await expect(page.locator("[data-frame-box]")).toHaveAttribute("data-reference", "");
      await menuRow(page, "reference").click();
      await expect(menuRow(page, "reference")).toHaveAttribute("aria-checked", "false");
      await expect(page.locator("[data-frame-box]")).not.toHaveAttribute("data-reference", "");

      // Hot reload: the bin serves with Bun HMR on; a click is refused with how to change it.
      await expect(menuRow(page, "hot-reload")).toHaveAttribute("aria-checked", "true");
      await expect(menuRow(page, "hot-reload").locator("[data-part=state]")).toHaveText("on");
      await menuRow(page, "hot-reload").click();
      await expect(lastToast(page)).toHaveText(
        "Start the bin with --no-hmr to turn hot reload off"
      );
      await expect(menuRow(page, "hot-reload")).toHaveAttribute("aria-checked", "true");
      await expect(menuRow(page, "hot-reload")).toHaveAttribute("title", /--no-hmr/);

      // Density cycles auto → compact → comfortable → auto.
      await expect(menuRow(page, "density").locator("[data-part=state]")).toHaveText("auto");
      // Auto is compact below 820 px of window width.
      const auto = width < 820 ? "compact" : "comfortable";
      for (const [value, applied] of [
        ["compact", "compact"],
        ["comfortable", "comfortable"],
        ["auto", auto]
      ] as const) {
        await openMore(page);
        await menuRow(page, "density").click();
        await openMore(page);
        await expect(menuRow(page, "density").locator("[data-part=state]")).toHaveText(value);
        await expect(html).toHaveAttribute("data-density", applied);
      }

      // Theme flips light, then dark again.
      await openMore(page);
      await expect(menuRow(page, "theme").locator("[data-part=state]")).toHaveText("dark");
      await menuRow(page, "theme").click();
      await expect(html).toHaveAttribute("data-theme", "light");
      await openMore(page);
      await expect(menuRow(page, "theme").locator("[data-part=state]")).toHaveText("light");
      await menuRow(page, "theme").click();
      await expect(html).toHaveAttribute("data-theme", "dark");

      // Registry opens the registry popover under ⋯, inside the window.
      await openMore(page);
      await expect(menuRow(page, "registry").locator("[data-part=state]")).toHaveText("20 · 23");
      await menuRow(page, "registry").click();
      const registry = page.locator("[data-ui=registry-popover]");
      await expect(registry).toBeVisible();
      const popover = await registry.boundingBox();
      expect(popover?.x ?? -1, `registry left at ${width} px`).toBeGreaterThanOrEqual(0);
      expect(
        (popover?.x ?? 0) + (popover?.width ?? 0),
        `registry right at ${width} px`
      ).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      await expect(registry).toBeHidden();

      // Game preview where it acts: Render hides and shows the pinned preview.
      await closeMore(page);
      await tools.show("render");
      await openMore(page);
      await expect(menuRow(page, "game")).toHaveAttribute("aria-disabled", "false");
      const shown = (await menuRow(page, "game").getAttribute("aria-checked")) === "true";
      await menuRow(page, "game").click();
      await expect(menuRow(page, "game")).toHaveAttribute("aria-checked", String(!shown));
      await expect(page.locator("[data-ui=preview]")).toBeVisible({ visible: !shown });
      await menuRow(page, "game").click();
      await expect(menuRow(page, "game")).toHaveAttribute("aria-checked", String(shown));

      // Closing: Esc, a second ⋯ click and a press outside.
      await closeMore(page);
      const more = topBar(page).locator("[data-action=more]");
      await more.click();
      await expect(menu).toBeVisible();
      await more.click();
      await expect(menu).toBeHidden();
      await more.click();
      await expect(menu).toBeVisible();
      await page.locator("[data-shell-main]").click({ position: { x: 4, y: 4 } });
      await expect(menu).toBeHidden();

      // The keyboard: Enter on ⋯ focuses the first row, ↓ the next.
      await more.focus();
      await page.keyboard.press("Enter");
      await expect(menu.locator("[role^=menuitem]").first()).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(menu.locator("[role^=menuitem]").nth(1)).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();

      // The controls left in the bar: search, Pause and Step.
      await topBar(page).locator("[data-search]").click();
      await expect(page.locator("dialog[data-ui=palette]")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator("dialog[data-ui=palette]")).toBeHidden();
      await topBar(page).locator("[data-action=pause]").click();
      await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "paused");
      await expect(topBar(page).locator("[data-action=step]")).toHaveAttribute(
        "aria-disabled",
        "false"
      );
      await topBar(page).locator("[data-action=pause]").click();
      await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live");
      // The session moved into the pill's tooltip.
      await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute(
        "title",
        /session s-[0-9a-f]{4}/
      );
    }
    expect(errors.unexpected(), "no console error from the refused hot reload change").toEqual([]);
  });

  test("from 900 px the bar shows the labelled switches, Registry as an icon, and every action works", async ({
    tools,
    errors
  }) => {
    const page = tools.page;
    const bar = topBar(page);
    const html = page.locator("html");
    const card = gameFrame(page).locator("[data-moku-editor-overlay]");
    for (const width of WIDE_WIDTHS) {
      await resize(tools, width);
      await tools.show("game");
      await expect(bar.locator("[data-action=more]")).toHaveCount(0);
      for (const name of ["Preview", "Overlay", "Hot reload"]) {
        await expect(bar.getByRole("switch", { name, exact: true })).toBeVisible();
        await expect(bar.getByText(name, { exact: true })).toBeVisible();
      }
      // Registry: the icon only, the counts in its title.
      const registryButton = bar.locator(":scope > [data-action=registry]");
      await expect(registryButton).toHaveAttribute("title", "Registry · 20 sources · 23 commands");
      await expect(registryButton).toHaveAccessibleName("Registry");

      const overlay = bar.getByRole("switch", { name: "Overlay", exact: true });
      await overlay.click();
      await expect(overlay).toHaveAttribute("aria-checked", "true");
      await expect(lastToast(page)).toContainText("Overlay in game on");
      await expect(card).toBeVisible();
      await overlay.click();
      await expect(overlay).toHaveAttribute("aria-checked", "false");
      await expect(card).toBeHidden();

      const reference = bar.locator(":scope > [data-action=reference]");
      await reference.click();
      await expect(reference).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("[data-frame-box]")).toHaveAttribute("data-reference", "");
      await reference.click();
      await expect(reference).toHaveAttribute("aria-pressed", "false");

      const hot = bar.getByRole("switch", { name: "Hot reload", exact: true });
      await expect(hot).toHaveAttribute("aria-checked", "true");
      await hot.click();
      await expect(lastToast(page)).toHaveText(
        "Start the bin with --no-hmr to turn hot reload off"
      );
      await expect(hot).toHaveAttribute("aria-checked", "true");

      await registryButton.click();
      await expect(page.locator("[data-ui=registry-popover]")).toBeVisible();
      await registryButton.click();
      await expect(page.locator("[data-ui=registry-popover]")).toBeHidden();

      const theme = bar.locator(":scope > [data-action=theme]");
      await theme.click();
      await expect(html).toHaveAttribute("data-theme", "light");
      await theme.click();
      await expect(html).toHaveAttribute("data-theme", "dark");

      // Preview acts outside Game.
      const preview = bar.getByRole("switch", { name: "Preview", exact: true });
      await expect(preview).toHaveAttribute("aria-disabled", "true");
      await tools.show("render");
      await expect(preview).toHaveAttribute("aria-disabled", "false");
      const shown = (await preview.getAttribute("aria-checked")) === "true";
      await preview.click();
      await expect(preview).toHaveAttribute("aria-checked", String(!shown));
      await preview.click();
      await expect(preview).toHaveAttribute("aria-checked", String(shown));
    }
    expect(errors.unexpected(), "no console error from the refused hot reload change").toEqual([]);
  });

  test("the compact bar icons look right at 720 and 480 px (golden)", async ({ tools }) => {
    const page = tools.page;
    for (const width of [720, 480]) {
      await resize(tools, width);
      await expect(topBar(page)).toHaveScreenshot(`compact-bar-${width}.png`, {
        mask: [page.locator("[data-ui=link-pill]"), topBar(page).locator("[data-game-name]")]
      });
    }
  });
});

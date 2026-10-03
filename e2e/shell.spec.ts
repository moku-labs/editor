/**
 * @file The shell of the tools page: top bar, rail and URL hash, command palette, toasts, status
 * card, the pinned preview dock (corners, drag, sizes S/M/L) and the theme, persisted across a
 * reload.
 */
import type { Page } from "@playwright/test";
import { expect, GAME_NAME, openTools, TOOLS_PATH, test, WORKSPACES, waitLive } from "./fixtures";

/**
 * Holds the game page request until `release()`, so the tools page boots with no game.
 *
 * @param page - The test page.
 * @returns The release function.
 */
async function holdGamePage(page: Page): Promise<() => void> {
  const gate = Promise.withResolvers<void>();
  await page.route(
    url => url.pathname === "/",
    async route => {
      await gate.promise;
      await route.continue();
    }
  );
  return () => gate.resolve();
}

/**
 * The frame number the link pill shows ("Live · f123" or "Paused · f123").
 *
 * @param page - The test page.
 * @returns The frame.
 */
async function pillFrame(page: Page): Promise<number> {
  const text = await page.locator("[data-ui=link-pill] [data-text]").textContent();
  const match = /f(\d+)/.exec(text ?? "");
  return match === null ? -1 : Number(match[1]);
}

test.describe("top bar", () => {
  test("shows the game, the session, a live link and the registry counts", async ({ tools }) => {
    const bar = tools.page.locator("[data-ui=top-bar]");
    await expect(bar.locator("[data-game-name]")).toHaveText(GAME_NAME);
    await expect(bar.locator("[data-ui=session-chip] button")).toHaveText(/^s-[0-9a-f]{4}$/);
    await expect(bar.locator("[data-ui=link-pill] [data-text]")).toHaveText(/^Live · f\d+$/);
    await expect(bar.locator("[data-action=registry] [data-counts]")).toHaveText("15 · 18");
    await expect(bar.locator("[data-action=step]")).toHaveAttribute("aria-disabled", "true");
    await expect(bar.getByRole("switch", { name: "Game", exact: true })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  test("pause, step one frame, resume", async ({ tools }) => {
    const page = tools.page;
    const bar = page.locator("[data-ui=top-bar]");
    await bar.locator("[data-action=pause]").click();
    await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "paused");
    await expect(bar.locator("[data-action=pause]")).toHaveText("Resume");
    await expect(bar.locator("[data-action=step]")).toHaveAttribute("aria-disabled", "false");

    const before = await pillFrame(page);
    await bar.locator("[data-action=step]").click();
    await expect.poll(() => pillFrame(page)).toBe(before + 1);
    await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "paused");

    await bar.locator("[data-action=pause]").click();
    await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live");
    await expect.poll(() => pillFrame(page)).toBeGreaterThan(before + 1);
  });

  test("registry popover opens and closes", async ({ tools }) => {
    const button = tools.page.locator("[data-ui=top-bar] [data-action=registry]");
    const popover = tools.page.locator("[data-ui=registry-popover]");
    await button.click();
    await expect(popover).toBeVisible();
    await expect(popover).not.toBeEmpty();
    await button.click();
    await expect(popover).toBeHidden();
  });

  test("overlay in game switch toggles and tells it in a toast", async ({ tools }) => {
    const page = tools.page;
    const overlay = page.getByRole("switch", { name: "Overlay in game" }).first();
    await expect(overlay).toHaveAttribute("aria-disabled", "false");
    await overlay.click();
    await expect(overlay).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("[data-ui=toasts] [data-toast]").last()).toContainText(
      "Overlay in game on"
    );
    await overlay.click();
    await expect(overlay).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("[data-ui=toasts] [data-toast]").last()).toContainText(
      "Overlay in game off"
    );
  });
});

test.describe("rail", () => {
  test("switches all six workspaces and the URL hash", async ({ tools }) => {
    const page = tools.page;
    // Flow is active on a fresh load, so the loop starts at Game and ends back on Flow.
    for (const { id, label } of [...WORKSPACES.slice(1), WORKSPACES[0]]) {
      await tools.show(id);
      await expect(tools.railButton(id)).toHaveAttribute("aria-current", "page");
      await expect(tools.railButton(id)).toHaveAccessibleName(new RegExp(`^${label}`));
      expect(new URL(page.url()).hash).toBe(`#${id}`);
      for (const other of WORKSPACES) {
        if (other.id !== id) await expect(tools.host(other.id)).toBeHidden();
      }
    }
  });

  test("a reload keeps the workspace of the hash; switching adds no history entry", async ({
    tools
  }) => {
    const page = tools.page;
    const entries = await page.evaluate(() => history.length);
    await tools.show("render");
    await tools.show("state");
    expect(await page.evaluate(() => history.length)).toBe(entries);
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitLive(page);
    await expect(page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", "state");
  });

  test("mod+digit switches workspaces, arrows move rail focus", async ({ tools }) => {
    const page = tools.page;
    await page.locator("[data-shell-main]").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("ControlOrMeta+3");
    await expect(page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", "render");
    await page.keyboard.press("ControlOrMeta+1");
    await expect(page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", "flow");

    await tools.railButton("flow").focus();
    await page.keyboard.press("ArrowDown");
    await expect(tools.railButton("game")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(tools.railButton("flow")).toBeFocused();
  });
});

test.describe("command palette", () => {
  test("opens with mod+K, runs a command, closes with Esc", async ({ tools }) => {
    const page = tools.page;
    const palette = page.locator("dialog[data-ui=palette]");
    const input = palette.getByRole("combobox", { name: "Search" });

    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette).toBeVisible();
    await expect(input).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();

    await page.keyboard.press("ControlOrMeta+k");
    await input.fill("Pause the game");
    await expect(palette.getByRole("option").first()).toContainText("Pause the game");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "paused");
    if (await palette.isVisible()) await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();

    await page.locator("[data-ui=top-bar] [data-action=pause]").click();
    await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live");
  });

  test("the search button and the rail Commands button open it; a panel item switches workspace", async ({
    tools
  }) => {
    const page = tools.page;
    const palette = page.locator("dialog[data-ui=palette]");
    await page.locator("[data-ui=top-bar] button[data-search]").click();
    await expect(palette).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();

    await page.locator("[data-ui=rail] button[data-commands]").click();
    await expect(palette).toBeVisible();
    await palette.getByRole("combobox", { name: "Search" }).fill("Console");
    await palette
      .getByRole("option", { name: /^Console/ })
      .first()
      .click();
    await expect(palette).toBeHidden();
    await expect(page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", "console");
  });

  test("Esc then mod+K at once reopens it", async ({ tools }) => {
    const page = tools.page;
    const palette = page.locator("dialog[data-ui=palette]");
    for (let round = 0; round < 3; round += 1) {
      await page.keyboard.press("ControlOrMeta+k");
      await expect(palette).toBeVisible();
      await page.keyboard.press("Escape");
      await page.keyboard.press("ControlOrMeta+k");
      await page.waitForTimeout(200);
      await expect(palette).toBeVisible();
      await expect(palette.getByRole("combobox", { name: "Search" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(palette).toBeHidden();
    }
  });

  test("arrow keys move the active option", async ({ tools }) => {
    const page = tools.page;
    const palette = page.locator("dialog[data-ui=palette]");
    await page.keyboard.press("ControlOrMeta+k");
    const options = palette.getByRole("option");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(options.first()).toHaveAttribute("aria-selected", "false");
    await page.keyboard.press("ArrowUp");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
  });
});

test.describe("preview dock", () => {
  // The dock is the same in the five preview workspaces; Console's zone is the whole main area,
  // so the corners and sizes are measurable on a phone too (Flow's zone is the canvas beside the
  // Inspector).
  test.beforeEach(async ({ tools }) => {
    await tools.show("console");
  });

  test("hide and show tell it in a toast, per workspace", async ({ tools }) => {
    const page = tools.page;
    const preview = page.locator("[data-ui=preview]");
    const toasts = page.locator("[data-ui=toasts] [data-toast]");
    const gameSwitch = page.getByRole("switch", { name: "Game", exact: true });

    await preview.getByRole("button", { name: "Hide the game preview" }).click();
    await expect(preview).toBeHidden();
    await expect(gameSwitch).toHaveAttribute("aria-checked", "false");
    await expect(toasts.last()).toHaveText(
      "Game preview hidden in Console · remembered for this workspace"
    );

    await tools.show("render");
    await expect(preview).toBeVisible();
    await tools.show("console");
    await expect(preview).toBeHidden();

    await gameSwitch.click();
    await expect(preview).toBeVisible();
    await expect(toasts.last()).toHaveText(
      "Game preview shown in Console · remembered for this workspace"
    );
  });

  test("Open in Game switches to the Game workspace", async ({ tools }) => {
    await tools.page
      .locator("[data-ui=preview]")
      .getByRole("button", { name: "Open in Game" })
      .click();
    await expect(tools.page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", "game");
    await expect(tools.page.locator("[data-ui=preview]")).toBeHidden();
  });

  test("Alt and an arrow move it to each corner", async ({ tools }) => {
    const page = tools.page;
    const preview = page.locator("[data-ui=preview]");
    const head = preview.locator("[data-preview-head]");
    await expect(preview).toHaveAttribute("data-corner", "bottom-right");
    await head.focus();

    const main = await page.locator("[data-shell-main]").boundingBox();
    const steps = [
      ["Alt+ArrowLeft", "bottom-left"],
      ["Alt+ArrowUp", "top-left"],
      ["Alt+ArrowRight", "top-right"],
      ["Alt+ArrowDown", "bottom-right"]
    ] as const;
    for (const [key, corner] of steps) {
      await page.keyboard.press(key);
      await expect(preview).toHaveAttribute("data-corner", corner);
      const rect = await preview.boundingBox();
      if (rect === null || main === null) throw new Error("no box");
      const centreX = rect.x + rect.width / 2;
      const centreY = rect.y + rect.height / 2;
      const midX = main.x + main.width / 2;
      const midY = main.y + main.height / 2;
      expect(centreX < midX, `${corner} horizontal side`).toBe(corner.endsWith("left"));
      expect(centreY < midY, `${corner} vertical side`).toBe(corner.startsWith("top"));
    }
  });

  test("dragging the header docks it to the nearest corner", async ({ tools }) => {
    const page = tools.page;
    const preview = page.locator("[data-ui=preview]");
    const head = preview.locator("[data-preview-head] [data-title]");
    const main = await page.locator("[data-shell-main]").boundingBox();
    const start = await head.boundingBox();
    if (main === null || start === null) throw new Error("no box");

    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(main.x + 40, main.y + 40, { steps: 8 });
    await page.mouse.up();
    await expect(preview).toHaveAttribute("data-corner", "top-left");
  });

  test("size S, M and L", async ({ tools }) => {
    const preview = tools.page.locator("[data-ui=preview]");
    const sizes = preview.getByRole("radiogroup", { name: "Preview size" });
    const widths: number[] = [];
    for (const size of ["S", "M", "L"] as const) {
      await sizes.getByRole("radio", { name: size, exact: true }).click();
      await expect(preview).toHaveAttribute("data-size", size);
      await expect(sizes.getByRole("radio", { name: size, exact: true })).toHaveAttribute(
        "aria-checked",
        "true"
      );
      const rect = await preview.boundingBox();
      widths.push(rect?.width ?? 0);
    }
    const [small = 0, medium = 0, large = 0] = widths;
    expect(small).toBeLessThan(medium);
    expect(medium).toBeLessThanOrEqual(large);
  });
});

test.describe("status card", () => {
  test("No game connected while the game page is held, then live", async ({ page }) => {
    const release = await holdGamePage(page);
    await page.goto(TOOLS_PATH, { waitUntil: "domcontentloaded" });

    const card = page.locator("[data-ui=status-card]");
    await expect(card).toHaveAttribute("data-kind", "empty", { timeout: 15_000 });
    await expect(card.getByRole("heading")).toHaveText("No game connected");
    await expect(card.locator("[data-url] [data-mono]")).toHaveText(
      /^http:\/\/127\.0\.0\.1:\d+\/$/
    );
    await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "empty");
    await expect(page.locator("[data-ui=top-bar] [data-game-name]")).toHaveText("No game");
    await expect(page.locator("[data-shell-hosts]")).toHaveAttribute("data-faded", "");

    release();
    await waitLive(page);
    await expect(page.locator("[data-shell-hosts]")).not.toHaveAttribute("data-faded", "");
  });

  test("Copy puts the game URL on the clipboard and tells it in a toast", async ({
    page,
    context
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const release = await holdGamePage(page);
    await page.goto(TOOLS_PATH, { waitUntil: "domcontentloaded" });
    const card = page.locator("[data-ui=status-card]");
    await expect(card).toHaveAttribute("data-kind", "empty", { timeout: 15_000 });
    await card.getByRole("button", { name: "Copy" }).click();
    await expect(page.locator("[data-ui=toasts] [data-toast]").last()).toHaveText("Copied URL");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    release();
    await waitLive(page);
  });
});

test.describe("theme", () => {
  test("the toggle switches the theme and a reload keeps it", async ({ tools }) => {
    const page = tools.page;
    const root = page.locator("html");
    const button = page.locator("[data-ui=top-bar] [data-action=theme]");
    await expect(button).toHaveAttribute("title", "Theme: light");

    await button.click();
    await expect(root).toHaveAttribute("data-theme", "light");
    await expect(button).toHaveAttribute("title", "Theme: dark");
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitLive(page);
    await expect(root).toHaveAttribute("data-theme", "light");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      background
    );

    await page.locator("[data-ui=top-bar] [data-action=theme]").click();
    await expect(root).toHaveAttribute("data-theme", "dark");
  });
});

test("the tools page title and a fresh load land on Flow", async ({ page }) => {
  await openTools(page);
  await expect(page).toHaveTitle("moku editor");
  await expect(page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", "flow");
});

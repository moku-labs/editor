/**
 * @file The shell of the tools page: top bar, rail and URL hash (Game first and the default,
 * ⌘1), command palette, toasts, status card, the pinned preview dock (corners, drag, sizes S/M/L)
 * and the theme, persisted across a reload. The top bar has two layouts (round 2 R1): from 900 px
 * its switches and buttons show, below 900 px they are rows of the ⋯ menu; the helpers of
 * e2e/top-bar.ts find a control in either place. The link pill turns Live again after the game
 * resumes itself (R8).
 */
import type { Frame, Page } from "@playwright/test";
import { expect, GAME_NAME, openTools, TOOLS_PATH, test, WORKSPACES, waitLive } from "./fixtures";
import {
  barChecked,
  barControl,
  closeMore,
  flipBarToggle,
  isCompact,
  moreMenu,
  showPreview,
  topBar
} from "./top-bar";

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

/**
 * The game page frame.
 *
 * @param page - The test page.
 * @returns The frame.
 */
function gameFrame(page: Page): Frame {
  const frame = page.frames().find(f => f !== page.mainFrame() && !f.url().includes("/__editor/"));
  if (frame === undefined) throw new Error("no game frame");
  return frame;
}

test.describe("top bar", () => {
  test("shows the game, the session, a live link and the registry counts", async ({ tools }) => {
    const page = tools.page;
    const bar = topBar(page);
    await expect(bar.locator("[data-game-name]")).toHaveText(GAME_NAME);
    await expect(bar.locator("[data-ui=link-pill] [data-text]")).toHaveText(/^Live · f\d+$/);
    await expect(bar.locator("[data-action=step]")).toHaveAttribute("aria-disabled", "true");
    if (await isCompact(page)) {
      // Compact: the session is in the pill's tooltip, the counts in the ⋯ menu's Registry row.
      await expect(bar.locator("[data-ui=session-chip]")).toHaveCount(0);
      await expect(bar.locator("[data-ui=link-pill]")).toHaveAttribute(
        "title",
        /session s-[0-9a-f]{4}/
      );
      const registry = await barControl(page, "registry");
      await expect(registry.locator("[data-part=state]")).toHaveText("19 · 20");
      await closeMore(page);
    } else {
      await expect(bar.locator("[data-ui=session-chip] button")).toHaveText(/^s-[0-9a-f]{4}$/);
      await expect(bar.locator("[data-action=registry]")).toHaveAttribute(
        "title",
        "Registry · 19 sources · 20 commands"
      );
    }
    expect(await barChecked(page, "game")).toBe(true);
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
    const page = tools.page;
    const popover = page.locator("[data-ui=registry-popover]");
    const compact = await isCompact(page);
    const registry = await barControl(page, "registry");
    await registry.click();
    await expect(popover).toBeVisible();
    await expect(popover).not.toBeEmpty();
    if (compact) {
      // Opened from the ⋯ menu: Esc closes it.
      await expect(moreMenu(page)).toBeHidden();
      await page.keyboard.press("Escape");
    } else {
      await topBar(page).locator("[data-action=registry]").click();
    }
    await expect(popover).toBeHidden();
  });

  test("overlay in game switch toggles and tells it in a toast", async ({ tools }) => {
    const page = tools.page;
    const control = await barControl(page, "overlay");
    await expect(control).toHaveAttribute("aria-disabled", "false");
    await closeMore(page);
    await flipBarToggle(page, "overlay");
    await expect.poll(() => barChecked(page, "overlay")).toBe(true);
    await expect(page.locator("[data-ui=toasts] [data-toast]").last()).toContainText(
      "Overlay in game on"
    );
    await flipBarToggle(page, "overlay");
    await expect.poll(() => barChecked(page, "overlay")).toBe(false);
    await expect(page.locator("[data-ui=toasts] [data-toast]").last()).toContainText(
      "Overlay in game off"
    );
  });

  test("the link pill turns Live within one heartbeat after the game resumes itself (R8)", async ({
    tools
  }) => {
    const page = tools.page;
    const pill = page.locator("[data-ui=link-pill]");
    await topBar(page).locator("[data-action=pause]").click();
    await expect(pill).toHaveAttribute("data-kind", "paused");
    await expect(pill.locator("[data-text]")).toHaveText(/^Paused · f\d+$/);
    const before = await pillFrame(page);

    // The game page resumes through its own door (game.resume of its registry), not the editor.
    await gameFrame(page).evaluate(async () => {
      const registry = (
        Reflect.get(globalThis, "editor") as {
          registry: { command(id: string): { run(input: object): Promise<unknown> } };
        }
      ).registry;
      await registry.command("game.resume").run({});
    });
    // One heartbeat is 1000 ms (channel.heartbeatMs).
    await expect(pill).toHaveAttribute("data-kind", "live", { timeout: 1500 });
    await expect(pill.locator("[data-text]")).toHaveText(/^Live · f\d+$/);
    await expect.poll(() => pillFrame(page)).toBeGreaterThan(before);
    await expect(topBar(page).locator("[data-action=pause]")).toHaveText("Pause");
  });
});

test.describe("rail", () => {
  test("switches all six workspaces and the URL hash", async ({ tools }) => {
    const page = tools.page;
    // Game is active on a fresh load, so the loop starts at Flow and ends back on Game.
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
    // ⌘1 is Game, ⌘2 is Flow.
    await page.keyboard.press("ControlOrMeta+1");
    await expect(page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", "game");
    await page.keyboard.press("ControlOrMeta+2");
    await expect(page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", "flow");

    await tools.railButton("game").focus();
    await page.keyboard.press("ArrowDown");
    await expect(tools.railButton("flow")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(tools.railButton("game")).toBeFocused();
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

    await preview.getByRole("button", { name: "Hide the game preview" }).click();
    await expect(preview).toBeHidden();
    expect(await barChecked(page, "game")).toBe(false);
    await expect(toasts.last()).toHaveText(
      "Game preview hidden in Console · remembered for this workspace"
    );

    await tools.show("render");
    await expect(preview).toBeVisible();
    await tools.show("console");
    await expect(preview).toBeHidden();

    await flipBarToggle(page, "game");
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
    // The theme button of the wide bar, or the Theme row of the ⋯ menu below 900 px.
    const theme = await barControl(page, "theme");
    await expect(theme).toHaveAttribute("title", "Theme: light");

    await theme.click();
    await expect(root).toHaveAttribute("data-theme", "light");
    await expect(await barControl(page, "theme")).toHaveAttribute("title", "Theme: dark");
    await closeMore(page);
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitLive(page);
    await expect(root).toHaveAttribute("data-theme", "light");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      background
    );

    const again = await barControl(page, "theme");
    await again.click();
    await expect(root).toHaveAttribute("data-theme", "dark");
    await closeMore(page);
  });
});

test("the tools page title and a fresh load land on Game, ⌘1 in the rail", async ({ page }) => {
  await openTools(page);
  await expect(page).toHaveTitle("moku editor");
  await expect(page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", "game");
  const rail = page.locator("[data-ui=rail] button[data-workspace]");
  await expect(rail.first()).toHaveAttribute("data-workspace", "game");
  await expect(rail.first()).toHaveAttribute("aria-current", "page");
  await expect(rail.nth(1)).toHaveAttribute("data-workspace", "flow");
  // The preview's Open button (Render shows the preview) names the key of Game.
  await page.locator("[data-ui=rail] button[data-workspace=render]").click();
  await expect(page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", "render");
  await showPreview(page);
  await expect(page.locator('[data-ui=preview] button[aria-label="Open in Game"]')).toHaveAttribute(
    "title",
    "Open in Game (⌘1)"
  );
});

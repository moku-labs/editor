/**
 * @file The Render workspace, Mission control, on the tiny game's local preview. The game page
 * carries the agent flag a `moku-game dev` page carries, so the engine's monitor fills its ring and
 * the editor's perf feeds it: the connection bar names the local preview and its facts (browser,
 * display, the rate now), the frame timeline moves, the cards read numbers, and nothing says
 * "0 fps" (the "Render shows nonsense" report). The popovers of the bar open one at a time under
 * their triggers and close with Esc, the focus back on the trigger; a drag on the timeline pauses
 * the view and fills the inspector with the range; Scene details starts collapsed.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/** "0 fps" as a value of its own: not the end of "60 fps", "120 fps" or "2.0 fps". */
const ZERO_FPS = /(?<![\d.])0(?:\.0)? fps/;

/**
 * The Render workspace's root.
 *
 * @param page - The test page.
 * @returns The root.
 */
function workspaceOf(page: Page): Locator {
  return page.locator("[data-render=workspace]");
}

/**
 * The value cell of one fact of the connection bar.
 *
 * @param page - The test page.
 * @param label - The fact's label, e.g. "Display".
 * @returns The value cell.
 */
function factValue(page: Page, label: string): Locator {
  return page
    .locator("[data-render=connection] [data-facts] > div")
    .filter({ has: page.locator("dt", { hasText: label }) })
    .locator("dd > span")
    .first();
}

/**
 * Opens a popover from its trigger, checks it is the only one open and that the trigger says so,
 * then closes it with Esc and checks the focus went back to the trigger.
 *
 * @param page - The test page.
 * @param id - The popover id, e.g. "monitoring".
 * @param inside - Checks of the popover's content while it is open.
 */
async function openThenEsc(
  page: Page,
  id: string,
  inside?: (popover: Locator) => Promise<void>
): Promise<void> {
  const trigger = page.locator(`[data-popover-trigger="${id}"]`);
  const popover = page.locator(`[data-popover="${id}"]`);
  await trigger.click();
  await expect(popover).toBeVisible();
  await expect(page.locator("[data-popover]")).toHaveCount(1);
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  // Placed under its trigger: the popover's top is below the trigger's bottom.
  const [box, anchor] = await Promise.all([popover.boundingBox(), trigger.boundingBox()]);
  expect(box?.y ?? 0, `${id} popover under its trigger`).toBeGreaterThan(
    (anchor?.y ?? 0) + (anchor?.height ?? 0)
  );
  if (inside !== undefined) await inside(popover);
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
}

test.describe("render", () => {
  test("Mission control is live on the local preview: the source, its facts, moving frames, numbers in the cards", async ({
    tools
  }) => {
    const { page } = tools;
    await tools.show("render");
    const workspace = workspaceOf(page);
    await expect(workspace).toHaveAttribute("data-src", "local");

    // The source pill of the bar and the one of the top bar name the running local preview.
    const pill = page.locator("[data-source-pill]");
    await expect(pill).toHaveAttribute("data-kind", "local");
    await expect(pill.locator("[data-source-name]")).toHaveText("Local preview");
    await expect(pill.locator("[data-part=name]")).toContainText("Running");
    await expect(pill.locator("[data-part=sub]")).toHaveText(/^Chrome \d+ in this editor window$/);
    const topPill = page.locator("[data-ui=top-bar] [data-ui=source-pill]");
    await expect(topPill).toHaveAttribute("data-kind", "local");
    await expect(topPill).toHaveAttribute("data-state", "live");

    // The facts come from the engine's header and perf's second: never dashes once it runs.
    await expect(factValue(page, "Browser")).toHaveText(/^Chrome \d+$/);
    await expect(factValue(page, "Display")).toHaveText(/^\d+ Hz$/);
    await expect(factValue(page, "Rate now")).toHaveText(/^[1-9]\d* fps/);
    await expect(factValue(page, "dpr")).toHaveText(/^\d/);

    // Frames arrive: the headline counts the view's spikes, the FPS card reads a rate (the rest
    // rate once the game idles), the timeline moves.
    const headline = page.locator("[data-render=frames] [data-headline]");
    await expect(headline).toContainText(/^\d+ spikes? in view/);
    const fps = page.locator("[data-card-kind=fps] [data-part=pair]").first();
    await expect(fps.locator("[data-part=unit]")).toHaveText("fps now");
    await expect(fps.locator("strong")).toHaveText(/^[1-9]\d*$/);
    const timeline = page.locator("[data-paint=timeline]");
    const before = await timeline.screenshot();
    await expect
      .poll(async () => Buffer.compare(before, await timeline.screenshot()) !== 0, {
        message: "the frame timeline moves while live",
        timeout: 10_000
      })
      .toBe(true);
    await expect(page.locator("[data-live-toggle]")).toHaveAttribute("aria-pressed", "true");

    // Every painted surface has a bitmap: a canvas the loop never sized stays blank.
    const sizes = await page
      .locator("[data-render=workspace] canvas[data-paint]")
      .evaluateAll(canvases =>
        canvases.map(canvas => {
          const element = canvas as HTMLCanvasElement;
          return { paint: element.dataset.paint, w: element.width, h: element.height };
        })
      );
    expect(sizes.map(size => size.paint)).toEqual(
      expect.arrayContaining(["timeline", "lane", "overview", "spark"])
    );
    for (const size of sizes) {
      expect(size.w * size.h, `the ${size.paint ?? "?"} canvas has a bitmap`).toBeGreaterThan(0);
    }

    // The nonsense of the report: a rate of zero anywhere on the page.
    await expect(workspace).not.toContainText(ZERO_FPS);
    await expect(page.locator("[data-ui=top-bar]")).not.toContainText(ZERO_FPS);
  });

  test("the popovers open one at a time under their triggers and close with Esc", async ({
    tools
  }) => {
    const { page } = tools;
    await tools.show("render");
    await expect(page.locator("[data-render=frames] [data-headline]")).toContainText(" in view");

    await openThenEsc(page, "monitoring", async popover => {
      await expect(popover.locator("[data-monitoring] h3")).toHaveText(
        "What is monitored on Local preview"
      );
    });

    // The Connect panel: a tab chosen from the device directory, the other one a click away.
    await openThenEsc(page, "connect", async popover => {
      const panel = popover.locator("[data-connect-panel]");
      const tab = await panel.getAttribute("data-tab");
      expect(tab).toMatch(/^(wire|network)$/);
      const other = tab === "wire" ? "network" : "wire";
      await panel.locator(`[role=tab][data-tab=${other}]`).click();
      await expect(panel).toHaveAttribute("data-tab", other);
      await expect(panel.locator(`[role=tab][data-tab=${other}]`)).toHaveAttribute(
        "aria-selected",
        "true"
      );
    });

    // The split button's menu: the ways to connect.
    await openThenEsc(page, "split", async popover => {
      await expect(popover).toHaveAttribute("role", "menu");
      expect(await popover.locator("[role=menuitem]").count()).toBeGreaterThanOrEqual(2);
    });

    // One at a time: opening another closes the open one.
    await page.locator('[data-popover-trigger="monitoring"]').click();
    await expect(page.locator('[data-popover="monitoring"]')).toBeVisible();
    await page.locator('[data-popover-trigger="connect"]').click();
    await expect(page.locator('[data-popover="connect"]')).toBeVisible();
    await expect(page.locator("[data-popover]")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-popover]")).toHaveCount(0);

    // Record: the recording pill carries the recording's popover; Stop gives the button back.
    const record = page.locator("[data-render=connection] [data-action=record]");
    await expect(record).toBeEnabled();
    await record.click();
    await expect(page.locator("[data-record-pill]")).toBeVisible();
    await openThenEsc(page, "record");
    await page.locator("[data-record-pill] [data-action=stop]").click();
    await expect(record).toBeVisible({ timeout: 15_000 });

    // The process memory breakdown needs a wired phone's telemetry: none on the local preview.
    await expect(page.locator('[data-popover-trigger="memory"]')).toHaveCount(0);
  });

  test("a drag on the timeline pauses the view and fills the inspector with the range; Esc clears it", async ({
    tools
  }) => {
    const { page } = tools;
    await tools.show("render");
    const inspector = page.locator("[data-render=inspector]");
    await expect(inspector.locator("[data-part=title]").first()).toHaveText(/^Last 6 s$/);
    // Frames under the whole drag: the summary counts a few seconds of them ("219 frames from …").
    const sub = inspector.locator("[data-part=sub]").first();
    await expect
      .poll(async () => Number.parseInt((await sub.textContent()) ?? "", 10) || 0, {
        timeout: 15_000
      })
      .toBeGreaterThan(150);

    const timeline = page.locator("[data-paint=timeline]");
    const box = await timeline.boundingBox();
    if (box === null) throw new Error("the timeline has no box");
    const y = box.y + box.height * 0.6;
    await page.mouse.move(box.x + box.width * 0.5, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, y, { steps: 8 });
    await page.mouse.up();

    await expect(page.locator("[data-live-toggle]")).toHaveAttribute("aria-pressed", "false");
    await expect(inspector.locator("[data-action=clear]")).toBeVisible();
    await expect(inspector.locator("[data-part=title]").first()).toHaveText(/^f\d+–f\d+$/);
    await expect(inspector.locator("[data-part=sub]").first()).toHaveText(
      /^\d+ frames, [\d.]+ m?s, worst [\d.]+ ms$/
    );

    // Esc clears the range: the summary of the paused view; Back to live moves it again.
    await timeline.focus();
    await page.keyboard.press("Escape");
    await expect(inspector.locator("[data-action=clear]")).toHaveCount(0);
    await expect(inspector.locator("[data-part=title]").first()).toHaveText(/^6 s in view$/);
    await page.locator("[data-render=frames] [data-action=back-to-live]").click();
    await expect(page.locator("[data-live-toggle]")).toHaveAttribute("aria-pressed", "true");
    await expect(inspector.locator("[data-part=title]").first()).toHaveText(/^Last 6 s$/);
  });

  test("Scene details starts collapsed with its counts in the header and opens on a click", async ({
    tools
  }) => {
    const { page } = tools;
    await tools.show("render");
    const scene = page.locator("[data-render=scene]");
    const toggle = scene.locator("[data-part=toggle]");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("[data-render=textures]")).toHaveCount(0);
    await expect(scene.locator("[data-scene-meta]")).toHaveText(
      /^frame \d+ · \d+ nodes? · \d+ textures? · \d+ bundles?$/
    );

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("[data-render=textures]")).toBeVisible();
  });
});

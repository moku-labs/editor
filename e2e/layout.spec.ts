/**
 * @file Layout regressions found in a real browser (commit 21442b5): the workspace host and its
 * panel fill the main area on desktop and on a phone; the Flow edges SVG keeps a size and draws
 * edges; the preview's Open and Hide icons keep their size in the S float; the Render view
 * scrolls inside its panel while the page itself never scrolls (desktop and both half-screen
 * windows).
 */
import type { Locator } from "@playwright/test";
import { expect, test, WORKSPACES } from "./fixtures";

/**
 * The border box of a locator.
 *
 * @param locator - The element.
 * @returns Its box.
 */
async function box(
  locator: Locator
): Promise<{ x: number; y: number; width: number; height: number }> {
  const rect = await locator.boundingBox();
  expect(rect, "element has a box").not.toBeNull();
  return rect ?? { x: 0, y: 0, width: 0, height: 0 };
}

test.describe("layout", () => {
  for (const { id, label } of WORKSPACES) {
    test(`${label}: host and panel fill main`, async ({ tools }) => {
      await tools.show(id);
      const main = await box(tools.page.locator("[data-shell-main]"));
      const host = await box(tools.host(id));
      const panel = await box(tools.host(id).locator(":scope > [data-panel]").first());

      expect(main.height).toBeGreaterThan(200);
      for (const inner of [host, panel]) {
        expect(Math.abs(inner.x - main.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(inner.y - main.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(inner.width - main.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(inner.height - main.height)).toBeLessThanOrEqual(1);
      }
    });
  }

  test("Flow: edges svg has a size and draws edges", async ({ tools }) => {
    await tools.show("flow");
    const edges = tools.page.locator("svg[data-flow=edges]");
    await expect(edges).toBeAttached();
    await expect
      .poll(async () => edges.evaluate(svg => svg.getBoundingClientRect().width))
      .toBeGreaterThan(0);
    await expect
      .poll(async () =>
        edges.evaluate(svg =>
          Math.max(0, ...[...svg.querySelectorAll("path")].map(path => path.getTotalLength()))
        )
      )
      .toBeGreaterThan(10);
  });

  test("preview: Open and Hide icons keep their size in the S float", async ({ tools }) => {
    await tools.show("flow");
    const preview = tools.page.locator("[data-ui=preview]");
    await expect(preview).toHaveAttribute("data-size", "S");
    for (const name of ["Open in Game", "Hide the game preview"]) {
      const icon = preview.getByRole("button", { name, exact: true }).locator("svg");
      const size = await box(icon);
      expect(size.width, `${name} icon width`).toBeGreaterThanOrEqual(13);
      expect(size.height, `${name} icon height`).toBeGreaterThanOrEqual(13);
    }
  });

  test("Render: the view scrolls inside its panel", async ({ tools, isMobile }) => {
    await tools.show("render");
    const page = tools.page;
    await expect(page.locator("[data-render=textures]")).toBeVisible();
    const scrolled = await tools.host("render").evaluate(host => {
      const scrollers = [host, ...host.querySelectorAll<HTMLElement>("*")].filter(element => {
        const overflow = getComputedStyle(element).overflowY;
        return (
          (overflow === "auto" || overflow === "scroll") &&
          element.scrollHeight > element.clientHeight + 4
        );
      });
      const outer = scrollers.toSorted((a, b) => b.clientHeight - a.clientHeight)[0];
      if (outer === undefined) return { found: false, moved: 0 };
      outer.scrollTop = 200;
      return { found: true, moved: outer.scrollTop };
    });
    expect(scrolled.found, "a scroll container inside the Render panel").toBe(true);
    expect(scrolled.moved).toBeGreaterThan(0);
    const page_ = await page.evaluate(() => ({
      scrollY: globalThis.scrollY,
      overflow: document.documentElement.scrollHeight - document.documentElement.clientHeight
    }));
    expect(page_.scrollY).toBe(0);
    // The editor has no mobile layout: on a phone the top bar is wider than the screen.
    if (!isMobile) expect(page_.overflow).toBeLessThanOrEqual(0);
  });

  test("preview: a workspace switch never places the float outside main", async ({
    tools,
    isMobile
  }) => {
    const page = tools.page;
    await page.locator("[data-ui=preview]").evaluate((section: HTMLElement) => {
      const seen: { left: number; top: number }[] = [];
      Reflect.set(globalThis, "__placements", seen);
      new MutationObserver(() => {
        if (section.hidden || section.style.left === "") return;
        seen.push({
          left: Number.parseFloat(section.style.left),
          top: Number.parseFloat(section.style.top)
        });
      }).observe(section, { attributes: true, attributeFilter: ["style", "hidden"] });
    });
    // Flow's zone is the canvas beside the Inspector, too narrow for the float on a phone.
    const order = isMobile
      ? (["render", "state", "files", "console", "render"] as const)
      : (["render", "state", "files", "console", "flow", "render"] as const);
    for (const ws of order) await tools.show(ws);
    await page.waitForTimeout(500);

    const main = await box(page.locator("[data-shell-main]"));
    const placements = await page.evaluate(
      () => Reflect.get(globalThis, "__placements") as { left: number; top: number }[]
    );
    expect(placements.length).toBeGreaterThan(0);
    for (const placement of placements) {
      expect(placement.left, "left inside main").toBeGreaterThanOrEqual(main.x - 1);
      expect(placement.top, "top inside main").toBeGreaterThanOrEqual(main.y - 1);
    }
  });

  test("the page never scrolls (desktop and half-screen windows)", async ({ tools }, testInfo) => {
    test.skip(testInfo.project.name === "chromium-mobile", "the editor has no mobile layout");
    for (const { id } of WORKSPACES) {
      await tools.show(id);
      const overflow = await tools.page.evaluate(() => ({
        x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        y: document.documentElement.scrollHeight - document.documentElement.clientHeight
      }));
      expect(overflow, `${id} page overflow`).toEqual({ x: 0, y: 0 });
    }
  });
});

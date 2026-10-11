/**
 * @file axe WCAG 2.1 AA scan of each workspace on desktop, in the dark and in the light theme, and
 * of the Game workspace with an element selected and one style edit pending: what the editor UI
 * cleanup changed (the top bar, the Game toolbar, the Styles section of the Element tab with its
 * fields, the struck value, the reset button and the edits bar, the footer) is scanned on its own
 * and must be clean, and so must the whole page in that state: the scroll boxes of the Element
 * tab (the lines of the layout style card, the code snippets) take the keyboard focus. Every
 * violation is attached to the report; serious and critical ones fail the test. The game iframe is
 * the game, not the tools page, so it is excluded. The light run switches the OS scheme, which the
 * workspace follows while no theme was chosen with the toggle.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { expect, type Tools, test, WORKSPACES } from "./fixtures";

const THEMES = ["dark", "light"] as const;

/** What the editor UI cleanup changed, on the Game workspace with a selected element. */
const CHANGED_UI = [
  "[data-ui=top-bar]",
  "[data-game=toolbar]",
  "[data-game=side] [data-part=element] > header",
  "[data-game=side] [data-part=element] [data-part=style]",
  "[data-game=side] [data-part=element] > footer"
];

/** A rect of the game page, in its own px. */
type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/**
 * Scans the tools page and fails on a serious or critical violation; the summary of every
 * violation goes to the report and the log.
 *
 * @param page - The tools page.
 * @param testInfo - The running test, for the attachment.
 * @param name - What was scanned, e.g. "game-dark".
 * @param only - The regions to scan; the whole page without them.
 */
async function expectNoBlockingViolation(
  page: Page,
  testInfo: TestInfo,
  name: string,
  only: readonly string[] = []
): Promise<void> {
  let builder = new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude("iframe[data-game-frame]");
  for (const region of only) builder = builder.include(region);
  const results = await builder.analyze();
  const summary = results.violations.map(violation => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.length,
    targets: violation.nodes.slice(0, 5).map(node => node.target.join(" ")),
    details: violation.nodes.slice(0, 5).map(node => node.failureSummary ?? "")
  }));
  await testInfo.attach(`axe-${name}.json`, {
    body: JSON.stringify(summary, undefined, 2),
    contentType: "application/json"
  });
  for (const item of summary) {
    console.info(
      `[axe ${name}] ${item.impact} ${item.id} ×${item.nodes}: ${item.help}\n  ${item.targets.join("\n  ")}\n  ${item.details.join("\n  ").replaceAll("\n", " ")}`
    );
  }
  const blocking = summary.filter(item => item.impact === "serious" || item.impact === "critical");
  expect(blocking).toEqual([]);
}

/**
 * Where the game draws a keyed element, in client px of the tools page.
 *
 * @param page - The tools page.
 * @param key - The ui key.
 * @returns The rect, undefined while the game does not place it.
 */
async function clientRect(page: Page, key: string): Promise<Rect | undefined> {
  const frame = page.frames().find(f => f !== page.mainFrame() && !f.url().includes("/__editor/"));
  const box = await page.locator("iframe[data-game-frame]").boundingBox();
  if (frame === undefined || box === null) return undefined;
  const located = await frame.evaluate(async value => {
    const registry = (
      Reflect.get(globalThis, "editor") as {
        registry: { source(id: string): { read(input: object): Promise<unknown> } };
      }
    ).registry;
    const rect = (await registry.source("game.locate").read({ key: value })) as Rect | null;
    return rect === null ? undefined : { rect, inner: innerWidth };
  }, key);
  if (located === undefined) return undefined;
  const scale = box.width / located.inner;
  const { rect } = located;
  return {
    x: box.x + rect.x * scale,
    y: box.y + rect.y * scale,
    w: rect.w * scale,
    h: rect.h * scale
  };
}

/**
 * Picks the Play button of home with the element picker and leaves one style edit pending: its
 * width plus 40.
 *
 * @param tools - The tools driver, on the Game workspace.
 */
async function selectPlayAndEdit(tools: Tools): Promise<void> {
  const { page } = tools;
  const game = tools.host("game");
  const select = game.locator("[data-game=toolbar] [data-part=pick]");
  const label = page.locator("[data-game=overlay] [data-part=label]");
  await select.click();
  await expect(select).toHaveAttribute("aria-pressed", "true");
  // The left edge of the button, beside its label; the hover names it once the scene is read.
  let at = { x: 0, y: 0 };
  await expect
    .poll(
      async () => {
        const rect = await clientRect(page, "play");
        if (rect === undefined) return "";
        at = { x: rect.x + rect.w * 0.04, y: rect.y + rect.h * 0.5 };
        await page.mouse.move(at.x, at.y);
        return label.evaluateAll(labels => labels[0]?.textContent ?? "");
      },
      { timeout: 20_000 }
    )
    .toMatch(/^play · /);
  await page.mouse.click(at.x, at.y);
  await expect(select).toHaveAttribute("aria-pressed", "false");

  const tab = game.locator("[data-game=side] [data-part=element]");
  await expect(tab.locator("[data-part=name]")).toHaveText("play");
  const input = tab.locator('[data-part=style] [data-part=field][data-path="width"] input');
  const width = Number(await input.inputValue());
  await input.fill(String(width + 40));
  await input.press("Enter");
  await expect(tab.locator('[data-part=style] [data-row="width"]')).toHaveAttribute(
    "data-edited",
    ""
  );
  await expect(tab.locator("[data-part=edits] [data-part=count]")).toHaveText("1 edit");
}

test.describe("a11y", () => {
  test.skip(({ isMobile }) => isMobile, "axe runs on desktop");

  for (const theme of THEMES) {
    for (const { id, label } of WORKSPACES) {
      test(`${label} workspace (${theme}) has no serious or critical axe violation`, async ({
        tools
      }, testInfo) => {
        await tools.page.emulateMedia({ colorScheme: theme });
        await expect(tools.page.locator("html")).toHaveAttribute("data-theme", theme);
        await tools.show(id);
        await tools.settle();
        await expectNoBlockingViolation(tools.page, testInfo, `${id}-${theme}`);
      });
    }

    test(`Game with an element selected and one edit pending (${theme}): the top bar, the toolbar and the Styles fields have no serious or critical axe violation`, async ({
      tools
    }, testInfo) => {
      await tools.page.emulateMedia({ colorScheme: theme });
      await expect(tools.page.locator("html")).toHaveAttribute("data-theme", theme);
      await tools.show("game");
      await selectPlayAndEdit(tools);
      await tools.settle();
      for (const region of CHANGED_UI) await expect(tools.page.locator(region)).toBeVisible();
      await expectNoBlockingViolation(tools.page, testInfo, `game-edit-${theme}`, CHANGED_UI);
    });

    // With an element selected the Element tab holds three scroll boxes (the lines of the layout
    // style card and the two code snippets): each takes the keyboard focus, so a key scrolls it
    // (scrollable-region-focusable).
    test(`Game with an element selected and one edit pending (${theme}): the whole page has no serious or critical axe violation`, async ({
      tools
    }, testInfo) => {
      await tools.page.emulateMedia({ colorScheme: theme });
      await expect(tools.page.locator("html")).toHaveAttribute("data-theme", theme);
      await tools.show("game");
      await selectPlayAndEdit(tools);
      // The capture card of the pick is still up: it is scanned with the Element tab.
      await expect(tools.page.locator("[data-game=card]")).toBeVisible();
      await tools.settle();
      await expectNoBlockingViolation(tools.page, testInfo, `game-edit-page-${theme}`);
    });
  }
});

/**
 * @file Narrow-window usability (D-21, the Claude pane): in the 480×900 (a third of the screen),
 * 720×900 and 960×1080 windows every workspace fits. The page never scrolls sideways; the top bar
 * keeps every control on screen, unsqueezed and unoverlapped (below 900 px it is compact: the
 * switches, Reference mode, Registry and theme move into the ⋯ menu and the session into the link
 * pill's tooltip; under 560 px the game name goes too; labels collapse to accessible names; the
 * full width loop is e2e/top-bar.spec.ts); the rail is reachable; the
 * pinned preview stays inside main; nothing in a workspace is cut off by a box that does not
 * scroll (wide content scrolls inside its panel); the Game toolbar wraps and its Element panel
 * stays in view (a drawer below 600 px); the Flow chrome never overlaps; the State columns stack
 * below 760 px; the palette and the Registry popover fit the window. Each workspace leaves a
 * screenshot in .planning/e2e/shots/half/ for review. The palette and popover check also runs on
 * desktop. All geometry is getBoundingClientRect, measured in the page and judged here.
 */
import type { Page } from "@playwright/test";
import { expect, type Tools, test, WORKSPACES } from "./fixtures";
import { clickBarControl, closeMore, isCompact, moreMenu, openMore } from "./top-bar";

/** A plain rect. */
type Box = { left: number; top: number; right: number; bottom: number; width: number };

/** One direct child of the top bar. */
type BarItem = {
  name: string;
  left: number;
  right: number;
  width: number;
  button: boolean;
  hit: boolean;
};

/** A visible element and the nearest ancestor whose overflow is not visible. */
type ClipSample = {
  name: string;
  left: number;
  right: number;
  overflow: string;
  parent: string;
  parentLeft: number;
  parentRight: number;
};

/** A visible text leaf, the boxes that clip it, and the leaves it sits inside. */
type TextSample = {
  text: string;
  rect: Box;
  clips: Box[];
  inside: number[];
};

/** The narrow-window projects: a third and a half of the screen, and half of a large one. */
const HALF_PROJECTS = new Set(["chromium-third", "chromium-half", "chromium-half-wide"]);

/** The window of the Claude pane at a third of the screen. */
const THIRD = "chromium-third";

/**
 * Shows a side panel's content: below 600 px it is a drawer that starts collapsed, so its rail
 * button opens it; docked it already shows.
 *
 * @param page - The tools page.
 * @param id - The panel id, e.g. "game.side".
 */
async function expandSide(page: Page, id: string): Promise<void> {
  const panel = page.locator(`aside[data-side-panel="${id}"]`);
  await expect(panel).toBeVisible();
  // The panel settles into drawer mode once its container is measured.
  await expect
    .poll(() =>
      panel.evaluate(element => {
        const width = element.parentElement?.getBoundingClientRect().width ?? 0;
        const isDrawer = element.dataset.overlay !== undefined;
        return width > 0 && width < 600 === isDrawer;
      })
    )
    .toBe(true);
  if ((await panel.getAttribute("data-state")) === "collapsed") {
    await panel.locator(":scope > [data-part=rail] [data-action=expand]").click();
  }
  await expect(panel).toHaveAttribute("data-state", "expanded");
}

/**
 * The rect of the first element a selector matches, or undefined when it is missing or hidden.
 *
 * @param page - The tools page.
 * @param selector - A CSS selector.
 * @returns The rect.
 */
async function rectOf(page: Page, selector: string): Promise<Box | undefined> {
  return page.evaluate(sel => {
    const rect = document.querySelector(sel)?.getBoundingClientRect();
    if (rect === undefined || rect.width === 0 || rect.height === 0) return undefined;
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width
    };
  }, selector);
}

/**
 * The shared part of two rects; a zero width or height when they do not meet.
 *
 * @param a - One rect.
 * @param b - The other rect.
 * @returns The intersection.
 */
function intersect(a: Box, b: Box): Box {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.max(left, Math.min(a.right, b.right));
  const bottom = Math.max(top, Math.min(a.bottom, b.bottom));
  return { left, top, right, bottom, width: right - left };
}

/**
 * True when two rects share more than the given margin on both axes.
 *
 * @param a - One rect.
 * @param b - The other rect.
 * @param margin - The shared size that still counts as touching, in px.
 * @returns Whether they overlap.
 */
function overlaps(a: Box, b: Box, margin = 1): boolean {
  const shared = intersect(a, b);
  return shared.width > margin && shared.bottom - shared.top > margin;
}

/**
 * Measures the top bar: its overflow and each direct child, with whether the child is the topmost
 * element at its centre.
 *
 * @param page - The tools page.
 * @returns The overflow in px and the items.
 */
async function measureTopBar(page: Page): Promise<{ overflow: number; items: BarItem[] }> {
  return page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>("[data-ui=top-bar]");
    const children = bar === null ? [] : [...bar.children];
    const items = children
      .filter(child => child.checkVisibility() && !child.matches("[popover]"))
      .map(child => {
        const rect = child.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2
        );
        const data = (child as HTMLElement).dataset;
        return {
          name: data.action ?? data.ui ?? child.tagName,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          button: child.matches("button"),
          hit: hit !== null && child.contains(hit)
        };
      });
    return { overflow: bar === null ? -1 : bar.scrollWidth - bar.clientWidth, items };
  });
}

/**
 * Judges the top bar: one line, every child on screen with a usable size, every button clickable,
 * no two children overlapping.
 *
 * @param page - The tools page.
 * @returns The findings, empty when the bar is fine.
 */
async function topBarFindings(page: Page): Promise<string[]> {
  const { overflow, items } = await measureTopBar(page);
  const width = page.viewportSize()?.width ?? 0;
  const findings = overflow > 0 ? [`top bar overflows by ${overflow}px`] : [];
  for (const item of items) {
    if (item.left < 0 || item.right > width) findings.push(`${item.name} off screen`);
    if (item.width < 20) findings.push(`${item.name} squeezed to ${Math.round(item.width)}px`);
    if (item.button && !item.hit) findings.push(`${item.name} is covered`);
  }
  for (const [index, item] of items.entries()) {
    const previous = items[index - 1];
    if (previous !== undefined && item.left < previous.right - 1) {
      findings.push(`${previous.name} overlaps ${item.name}`);
    }
  }
  return findings;
}

/**
 * Samples every visible element of the shell with its nearest ancestor whose overflow is not
 * visible. The Flow world (the panned canvas), svg internals, visually hidden labels and closed
 * popovers are skipped.
 *
 * @param page - The tools page.
 * @returns The samples.
 */
async function sampleClips(page: Page): Promise<ClipSample[]> {
  return page.evaluate(() => {
    const skip =
      "[data-flow=world], [data-flow=world] *, svg *, [data-sr-only], [hidden] *, [popover] *";
    return [...document.querySelectorAll("[data-ui=shell] *")]
      .filter(element => element.checkVisibility({ visibilityProperty: true }))
      .filter(element => !element.matches(skip))
      .filter(element => !getComputedStyle(element).clipPath.startsWith("inset(50%"))
      .map(element => {
        let parent = element.parentElement;
        while (parent !== null && getComputedStyle(parent).overflowX === "visible") {
          parent = parent.parentElement;
        }
        const rect = element.getBoundingClientRect();
        const box = parent?.getBoundingClientRect();
        return {
          name: `${element.tagName.toLowerCase()}${JSON.stringify((element as HTMLElement).dataset)}`,
          left: rect.left,
          right: rect.right,
          overflow: parent === null ? "none" : getComputedStyle(parent).overflowX,
          parent:
            parent === null
              ? ""
              : `${parent.tagName.toLowerCase()}${JSON.stringify(parent.dataset)}`,
          parentLeft: box?.left ?? 0,
          parentRight: box?.right ?? 0
        };
      });
  });
}

/**
 * Finds visible elements cut off by an ancestor that clips without scrolling: a box wider than
 * its clipping parent must sit in a scroller.
 *
 * @param page - The tools page.
 * @returns The findings.
 */
async function clipFindings(page: Page): Promise<string[]> {
  const samples = await sampleClips(page);
  return samples
    .filter(sample => sample.right > sample.left)
    .filter(sample => sample.overflow === "hidden" || sample.overflow === "clip")
    .filter(sample => sample.right > sample.parentRight + 1 || sample.left < sample.parentLeft - 1)
    .map(
      sample =>
        `${sample.name} [${Math.round(sample.left)}..${Math.round(sample.right)}] cut by ${sample.parent}`
    )
    .slice(0, 20);
}

/**
 * Samples the text leaves of the top bar and a workspace host (the Flow world, svg, visually
 * hidden labels and closed popovers are skipped), with every box that clips each one.
 *
 * @param page - The tools page.
 * @param hostSelector - The visible workspace host.
 * @returns The samples.
 */
async function sampleText(page: Page, hostSelector: string): Promise<TextSample[]> {
  return page.evaluate(host => {
    const skip =
      "[data-flow=world], [data-flow=world] *, svg *, [data-sr-only], [hidden] *, [popover] *";
    const leaves = [...document.querySelectorAll(`[data-ui=top-bar] *, ${host} *`)]
      .map(element => ({
        element,
        text: [...element.childNodes]
          .filter(node => node.nodeType === Node.TEXT_NODE)
          .map(node => node.textContent?.trim() ?? "")
          .join("")
      }))
      .filter(({ text }) => text !== "")
      .filter(({ element }) => element.checkVisibility({ visibilityProperty: true }))
      .filter(({ element }) => !element.matches(skip))
      .filter(({ element }) => !getComputedStyle(element).clipPath.startsWith("inset(50%"));
    return leaves.map(({ element, text }) => {
      const clips: Box[] = [];
      for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
        if (getComputedStyle(parent).overflow === "visible") continue;
        clips.push(parent.getBoundingClientRect().toJSON() as Box);
      }
      return {
        text: text.slice(0, 24),
        rect: element.getBoundingClientRect().toJSON() as Box,
        clips,
        inside: leaves.flatMap((other, index) =>
          other.element !== element && other.element.contains(element) ? [index] : []
        )
      };
    });
  }, hostSelector);
}

/**
 * Finds pairs of visible text leaves that overlap. What shows of a leaf is its box cut by every
 * clipping parent (a table scrolled out of its card does not count); a text node beside a child
 * element of the same leaf (a count in its button) is not an overlap.
 *
 * @param page - The tools page.
 * @param hostSelector - The visible workspace host.
 * @returns The findings.
 */
async function textOverlapFindings(page: Page, hostSelector: string): Promise<string[]> {
  const samples = await sampleText(page, hostSelector);
  const shown = samples.map(sample => {
    let box = sample.rect;
    for (const clip of sample.clips) box = intersect(box, clip);
    return box;
  });
  const findings: string[] = [];
  for (const [i, a] of samples.entries()) {
    for (const [j, b] of samples.entries()) {
      const nested = a.inside.includes(j) || b.inside.includes(i);
      const boxA = shown[i];
      const boxB = shown[j];
      if (j <= i || nested || boxA === undefined || boxB === undefined) continue;
      if (overlaps(boxA, boxB, 2)) findings.push(`"${a.text}" overlaps "${b.text}"`);
    }
  }
  return findings.slice(0, 20);
}

/**
 * Checks the preview float sits inside main when it shows.
 *
 * @param tools - The driver.
 */
async function expectPreviewInsideMain(tools: Tools): Promise<void> {
  const page = tools.page;
  const main = await rectOf(page, "[data-shell-main]");
  const preview = await rectOf(page, "[data-ui=preview]:not([hidden])");
  expect(main).toBeDefined();
  if (preview === undefined || main === undefined) return;
  expect(preview.left, "preview left").toBeGreaterThanOrEqual(main.left - 1);
  expect(preview.top, "preview top").toBeGreaterThanOrEqual(main.top - 1);
  expect(preview.right, "preview right").toBeLessThanOrEqual(main.right + 1);
  expect(preview.bottom, "preview bottom").toBeLessThanOrEqual(main.bottom + 1);
}

test.describe("half-screen", () => {
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(
      browserName !== "chromium" || !HALF_PROJECTS.has(testInfo.project.name),
      "half-screen windows only"
    );
  });

  for (const { id, label } of WORKSPACES) {
    test(`${label} fits the half window`, async ({ tools }, testInfo) => {
      const page = tools.page;
      await tools.show(id);
      await tools.settle();
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `.planning/e2e/shots/half/${testInfo.project.name}-${id}.png`,
        animations: "disabled",
        caret: "hide"
      });

      const overflow = await page.evaluate(() => ({
        x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        y: document.documentElement.scrollHeight - document.documentElement.clientHeight
      }));
      expect(overflow, "page overflow").toEqual({ x: 0, y: 0 });

      expect(await topBarFindings(page), "top bar").toEqual([]);
      expect(await clipFindings(page), "content cut off").toEqual([]);
      expect(
        await textOverlapFindings(page, `[data-workspace-host=${id}]`),
        "text overlap"
      ).toEqual([]);

      for (const ws of WORKSPACES) {
        const rail = await tools.railButton(ws.id).boundingBox();
        expect(rail, `rail ${ws.id}`).not.toBeNull();
        if (rail === null) continue;
        expect(rail.y + rail.height, `rail ${ws.id} on screen`).toBeLessThanOrEqual(
          page.viewportSize()?.height ?? 0
        );
      }

      await expectPreviewInsideMain(tools);
    });
  }

  test("top bar: collapsed labels stay the accessible names", async ({ tools }, testInfo) => {
    const page = tools.page;
    const bar = page.locator("[data-ui=top-bar]");
    const third = testInfo.project.name === THIRD;
    for (const name of ["Pause", "Step 1 frame"]) {
      await expect(bar.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await expect(bar.locator("[data-logo]")).toBeVisible();
    await expect(bar.locator("[data-counts]")).toHaveCount(0);

    if (await isCompact(page)) {
      // Below 900 px: the search icon and ⋯ keep names; the ⋯ rows name every moved control.
      await expect(bar.locator("[data-ui=session-chip]")).toHaveCount(0);
      await expect(
        bar.getByRole("button", { name: "Jump to node, file, style, texture (⌘K)" })
      ).toBeVisible();
      await expect(bar.getByRole("button", { name: "More", exact: true })).toBeVisible();
      await openMore(page);
      for (const name of ["Game preview", "Overlay in game", "Reference mode", "Hot reload"]) {
        await expect(
          moreMenu(page).getByRole("menuitemcheckbox", { name: new RegExp(`^${name}`) })
        ).toBeVisible();
      }
      for (const name of ["Registry", "Density", "Theme"]) {
        await expect(
          moreMenu(page).getByRole("menuitem", { name: new RegExp(`^${name}`) })
        ).toBeVisible();
      }
      await closeMore(page);
    } else {
      for (const name of ["Reference mode", "Registry"]) {
        await expect(bar.getByRole("button", { name, exact: true })).toBeVisible();
      }
      for (const name of ["Preview", "Overlay", "Hot reload"]) {
        await expect(bar.getByRole("switch", { name, exact: true })).toBeVisible();
      }
    }
    // Under 560 px the game name leaves the bar too.
    if (third) {
      await expect(bar.locator("[data-game-name]")).toBeHidden();
      return;
    }
    const gameName = await bar.locator("[data-game-name]").boundingBox();
    expect(gameName?.width ?? 0, "game name keeps a readable width").toBeGreaterThanOrEqual(48);
  });

  test("Game: toolbar wraps, the Element panel and the frame stay inside main", async ({
    tools
  }) => {
    const page = tools.page;
    await tools.show("game");
    await expect(page.locator("[data-game=toolbar]")).toBeVisible();
    // Below 600 px the Element panel is a drawer that starts collapsed.
    await expandSide(page, "game.side");
    await expect(page.locator("[data-game=side]")).toBeVisible();
    await tools.settle();
    const main = await rectOf(page, "[data-shell-main]");
    const toolbar = await rectOf(page, "[data-game=toolbar]");
    const side = await rectOf(page, 'aside[data-side-panel="game.side"]');
    expect(main, "main").toBeDefined();
    expect(toolbar, "toolbar").toBeDefined();
    expect(side, "inspector").toBeDefined();
    if (main === undefined || toolbar === undefined || side === undefined) return;
    expect(toolbar.right, "toolbar right").toBeLessThanOrEqual(main.right + 1);
    expect(side.right, "inspector right").toBeLessThanOrEqual(main.right + 1);
    expect(side.width, "inspector keeps its 280 px").toBeGreaterThanOrEqual(279);
    const controls = await page
      .locator("[data-game=toolbar] :is(button, select)")
      .evaluateAll(elements =>
        elements.map(element => {
          const rect = element.getBoundingClientRect();
          return { text: element.textContent?.trim() ?? "", right: rect.right, width: rect.width };
        })
      );
    expect(controls.length).toBeGreaterThan(5);
    for (const control of controls) {
      expect(control.right, `${control.text} on screen`).toBeLessThanOrEqual(main.right + 1);
    }
    // The game frame docks over the bezel's screen slot below the (taller) toolbar.
    await expect
      .poll(async () => {
        const slot = await rectOf(page, "[data-game=stage] [data-part=slot]");
        const frame = await rectOf(page, "iframe[data-game-frame]");
        if (slot === undefined || frame === undefined) return Number.POSITIVE_INFINITY;
        return Math.max(Math.abs(slot.left - frame.left), Math.abs(slot.top - frame.top));
      })
      .toBeLessThanOrEqual(2);
  });

  test("Flow: breadcrumb, canvas toolbar, zoom bar, minimap and preview never overlap", async ({
    tools
  }) => {
    const page = tools.page;
    await tools.show("flow");
    await tools.settle();
    await page.waitForTimeout(300);
    const canvas = await rectOf(page, "[data-flow=canvas]");
    const parts = {
      breadcrumb: await rectOf(page, "[data-flow=breadcrumb]"),
      toolbar: await rectOf(page, "[data-flow=canvas-toolbar]"),
      zoom: await rectOf(page, "[data-flow=zoom-bar]"),
      minimap: await rectOf(page, "[data-flow=minimap]")
    };
    expect(canvas).toBeDefined();
    if (canvas === undefined) return;
    expect(canvas.width, "the canvas keeps a usable width").toBeGreaterThanOrEqual(300);
    const entries = Object.entries(parts);
    for (const [name, rect] of entries) {
      expect(rect, `${name} shows`).toBeDefined();
      if (rect === undefined) continue;
      expect(rect.left, `${name} inside canvas`).toBeGreaterThanOrEqual(canvas.left - 1);
      expect(rect.right, `${name} inside canvas`).toBeLessThanOrEqual(canvas.right + 1);
    }
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [nameA, a] = entries[i] ?? ["", undefined];
        const [nameB, b] = entries[j] ?? ["", undefined];
        if (a === undefined || b === undefined) continue;
        expect(overlaps(a, b), `${nameA} overlaps ${nameB}`).toBe(false);
      }
    }
    // The pinned preview floats clear of the minimap (spec 12 §Available rect).
    const preview = await rectOf(page, "[data-ui=preview]:not([hidden])");
    expect(preview, "preview shows").toBeDefined();
    if (preview !== undefined && parts.minimap !== undefined) {
      expect(overlaps(preview, parts.minimap, 0), "minimap overlaps preview").toBe(false);
    }
    // Code widens the Inspector; in a narrow window it never gets narrower than the plain one.
    const inspectorPanel = 'aside[data-side-panel="flow.inspector"]';
    await expandSide(page, "flow.inspector");
    const plain = await rectOf(page, inspectorPanel);
    await page.locator("[data-flow=inspector] [role=tab]", { hasText: "Code" }).click();
    await expect(page.locator("[data-flow=inspector]")).toHaveAttribute("data-wide", /.*/);
    await page.waitForTimeout(300);
    const wide = await rectOf(page, inspectorPanel);
    expect(wide?.width ?? 0).toBeGreaterThanOrEqual((plain?.width ?? 0) - 1);
  });

  test("State: the columns stack below 760 px, never scroll sideways, and the cards fold", async ({
    tools
  }) => {
    const page = tools.page;
    await tools.show("state");
    await expect(page.locator("[data-part=runner-card]")).toBeVisible();
    const layout = await page
      .locator("[data-part=state-view] [data-part=columns]")
      .evaluate(columns => {
        const view = columns.closest<HTMLElement>("[data-part=state-view]");
        const style = view === null ? undefined : getComputedStyle(view);
        const padding =
          style === undefined
            ? 0
            : Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
        const cards = [...columns.children].map(child => {
          const rect = child.getBoundingClientRect();
          // How far the card's content runs past its own box (onto the card below).
          const spill = Math.max(
            0,
            ...[child, ...child.querySelectorAll("[data-card]")].map(
              box => box.scrollHeight - box.clientHeight
            )
          );
          return { x: rect.x, y: rect.y, width: rect.width, spill };
        });
        return {
          // The view is the size container: its content box decides the layout.
          container: (view?.getBoundingClientRect().width ?? 0) - padding,
          overflow: columns.scrollWidth - columns.clientWidth,
          width: columns.clientWidth,
          cards
        };
      });
    expect(layout.overflow, "no horizontal scroll").toBeLessThanOrEqual(0);
    expect(layout.cards).toHaveLength(3);
    const stacked = layout.container < 760;
    if (stacked) {
      // A stacked card grows with its content: nothing runs onto the card below it.
      expect(
        layout.cards.map(card => Math.round(card.spill)),
        "content past its card"
      ).toEqual([0, 0, 0]);
    }
    for (const [index, card] of layout.cards.entries()) {
      const previous = layout.cards[index - 1];
      if (previous === undefined) continue;
      if (stacked) {
        // Player, Last commit + Session, Runner: one column, top to bottom, full width.
        expect(Math.abs(card.x - previous.x), "stacked cards share the left edge").toBeLessThan(1);
        expect(card.y, "stacked cards go down").toBeGreaterThan(previous.y);
        expect(Math.abs(card.width - layout.width), "a stacked card spans the column").toBeLessThan(
          1
        );
      } else {
        expect(card.x, "columns go right").toBeGreaterThan(previous.x);
        expect(Math.abs(card.y - previous.y), "columns share the top").toBeLessThan(1);
      }
    }

    // The Runner is reachable inside the panel; the page never scrolls.
    const runner = page.locator("[data-part=runner-card]");
    await runner.scrollIntoViewIfNeeded();
    await expect(runner).toBeInViewport();
    expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(0);

    // Stacked, each card folds from the toggle in its head.
    const toggle = page.locator("[data-part=player-card] [data-action=toggle-card]");
    if (!stacked) {
      await expect(toggle).toBeHidden();
      return;
    }
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(page.locator("[data-part=player-card]")).toHaveAttribute("data-collapsed", "");
    await expect(page.getByRole("tree", { name: "Player" })).toBeHidden();
    await toggle.click();
    await expect(page.locator("[data-part=player-card]")).not.toHaveAttribute("data-collapsed", "");
    await expect(page.getByRole("tree", { name: "Player" })).toBeVisible();
  });
});

test.describe("half-screen and desktop", () => {
  test.skip(({ isMobile }) => isMobile, "the editor has no mobile layout");

  test("palette and Registry popover fit the window", async ({ tools }) => {
    // The Registry popover hangs under the right end of the bar: clamped on desktop too.
    const page = tools.page;
    const viewport = page.viewportSize() ?? { width: 0, height: 0 };
    await page.locator("[data-ui=top-bar] [data-search]").click();
    const palette = page.locator("dialog[data-ui=palette]");
    await expect(palette).toBeVisible();
    await expect(palette.locator("input")).toBeFocused();
    const paletteBox = await rectOf(page, "dialog[data-ui=palette]");
    expect(paletteBox).toBeDefined();
    expect(paletteBox?.left ?? -1).toBeGreaterThanOrEqual(0);
    expect(paletteBox?.right ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(viewport.width);
    expect(paletteBox?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(viewport.height);
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();

    // The Registry button of the wide bar, or the Registry row of the ⋯ menu below 900 px.
    await clickBarControl(page, "registry");
    const popover = page.locator("[data-ui=registry-popover]");
    await expect(popover).toBeVisible();
    const popoverBox = await rectOf(page, "[data-ui=registry-popover]");
    expect(popoverBox?.left ?? -1, "Registry popover left").toBeGreaterThanOrEqual(0);
    expect(
      popoverBox?.right ?? Number.POSITIVE_INFINITY,
      "Registry popover right"
    ).toBeLessThanOrEqual(viewport.width);
    expect(popoverBox?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(viewport.height);
  });

  test("desktop keeps the labelled top bar and the one-row Game toolbar", async ({
    tools
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "the desktop window only");
    const page = tools.page;
    const bar = page.locator("[data-ui=top-bar]");
    for (const text of ["Pause", "Step 1 frame", "Preview", "Overlay", "Hot reload"]) {
      await expect(bar.getByText(text, { exact: true })).toBeVisible();
    }
    // Registry is an icon; its counts are in the title.
    await expect(bar.getByRole("button", { name: "Registry", exact: true })).toHaveAttribute(
      "title",
      "Registry · 15 sources · 18 commands"
    );
    const gameName = await bar.locator("[data-game-name]").boundingBox();
    expect(gameName?.width ?? 0).toBeGreaterThan(100);
    await tools.show("game");
    await expect(page.locator("[data-game=toolbar]")).toBeVisible();
    const toolbar = await page.locator("[data-game=toolbar]").boundingBox();
    expect(toolbar?.height).toBe(44);
    await tools.show("flow");
    const plain = await page.locator('aside[data-side-panel="flow.inspector"]').boundingBox();
    expect(plain?.width).toBe(320);
  });
});

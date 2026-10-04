/**
 * @file Half-screen usability (D-21): in the 720×900 and 960×1080 windows every workspace fits.
 * The page never scrolls sideways; the top bar keeps every control on screen, unsqueezed and
 * unoverlapped (labels collapse to accessible names); the rail is reachable; the pinned preview
 * stays inside main; nothing in a workspace is cut off by a box that does not scroll (wide content
 * scrolls inside its panel); the Game toolbar wraps and its inspector stays in view; the Flow
 * chrome never overlaps; the palette and the Registry popover fit the window. Each workspace leaves
 * a screenshot in .planning/e2e/shots/half/ for review. The palette and popover check also runs on
 * desktop. All geometry is getBoundingClientRect, measured in the page and judged here.
 */
import type { Page } from "@playwright/test";
import { expect, type Tools, test, WORKSPACES } from "./fixtures";

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

/** The half-screen projects. */
const HALF_PROJECTS = new Set(["chromium-half", "chromium-half-wide"]);

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

  test("top bar: collapsed labels stay the accessible names", async ({ tools }) => {
    const bar = tools.page.locator("[data-ui=top-bar]");
    for (const name of ["Pause", "Step 1 frame", "Registry 15 · 18"]) {
      await expect(bar.getByRole("button", { name, exact: true })).toBeVisible();
    }
    for (const name of ["Game", "Overlay in game"]) {
      await expect(bar.getByRole("switch", { name, exact: true })).toBeVisible();
    }
    await expect(bar.locator("[data-logo]")).toBeVisible();
    const gameName = await bar.locator("[data-game-name]").boundingBox();
    expect(gameName?.width ?? 0, "game name keeps a readable width").toBeGreaterThanOrEqual(48);
  });

  test("Game: toolbar wraps, inspector and frame stay inside main", async ({ tools }) => {
    const page = tools.page;
    await tools.show("game");
    await expect(page.locator("[data-game=toolbar]")).toBeVisible();
    await expect(page.locator("[data-game=side]")).toBeVisible();
    await tools.settle();
    const main = await rectOf(page, "[data-shell-main]");
    const toolbar = await rectOf(page, "[data-game=toolbar]");
    const side = await rectOf(page, "[data-game=side]");
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

  test("Flow: breadcrumb, canvas toolbar, zoom bar and minimap never overlap", async ({
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
    // Code widens the Inspector; in a half window it never gets narrower than the plain one.
    const plain = await rectOf(page, "[data-flow=inspector]");
    await page.locator("[data-flow=inspector] [role=tab]", { hasText: "Code" }).click();
    await expect(page.locator("[data-flow=inspector]")).toHaveAttribute("data-wide", /.*/);
    await page.waitForTimeout(300);
    const wide = await rectOf(page, "[data-flow=inspector]");
    expect(wide?.width ?? 0).toBeGreaterThanOrEqual((plain?.width ?? 0) - 1);
  });

  test("State: the columns scroll sideways inside the panel", async ({ tools }) => {
    const page = tools.page;
    await tools.show("state");
    const columns = page.locator("[data-part=state-view] [data-part=columns]");
    const moved = await columns.evaluate(element => {
      element.scrollLeft = element.scrollWidth;
      return {
        overflow: element.scrollWidth - element.clientWidth,
        left: element.scrollLeft,
        right: element.getBoundingClientRect().right
      };
    });
    if (moved.overflow > 0) expect(moved.left).toBeGreaterThan(0);
    const runner = await rectOf(page, "[data-part=runner-card]");
    expect(runner?.right ?? Number.POSITIVE_INFINITY, "Runner reachable").toBeLessThanOrEqual(
      moved.right + 1
    );
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

    await page.locator("[data-ui=top-bar] [data-action=registry]").click();
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
    for (const text of ["Pause", "Step 1 frame", "Registry", "Game", "Overlay in game"]) {
      await expect(bar.getByText(text, { exact: true })).toBeVisible();
    }
    const gameName = await bar.locator("[data-game-name]").boundingBox();
    expect(gameName?.width ?? 0).toBeGreaterThan(100);
    await tools.show("game");
    await expect(page.locator("[data-game=toolbar]")).toBeVisible();
    const toolbar = await page.locator("[data-game=toolbar]").boundingBox();
    expect(toolbar?.height).toBe(44);
    await tools.show("flow");
    const plain = await page.locator("[data-flow=inspector]").boundingBox();
    expect(plain?.width).toBe(320);
  });
});

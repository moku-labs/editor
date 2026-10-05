/**
 * @file The Flow workspace (spec 12-flowView) in a real browser, on the frozen merge-game: select
 * and focus (camera, dimming, the current node never fades), the walk through the Inspector's
 * Info rows (←/→, ↑/↓, Enter, Alt+← back), sub-flows expanded in place and entered, the
 * breadcrumb, the board hub with its lanes and "You are here", the history strip, zoom, fit,
 * Follow, the minimap, pan, drag to pin with the layout file on disk, Reset layout, the three
 * context menus with Step 1 frame while paused, the Inspector tabs with a code save that writes
 * the file and reloads the game (D-07) and a style step the game hot swaps in place (U10), the
 * keys and the Esc layers. The geometry
 * is the browser's: camera transforms, card rects and drags are measured. Below 600 px the
 * Inspector is a drawer that starts collapsed: a test opens it before it works in it, and a card
 * the camera left outside the canvas (or under the preview float) is panned into view first.
 *
 * Every write lands in dist-e2e/game (the copy the bin serves). The tests restore what they wrote,
 * so a second run and the other specs start from the same files.
 */
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Frame, Locator, Page } from "@playwright/test";
import { expect, type Tools, test } from "./fixtures";

/** The project root the bin serves. */
const GAME_ROOT = fileURLToPath(new URL("../dist-e2e/game/", import.meta.url));

/** The pins file of flowView, relative to the game root. */
const LAYOUT_FILE = ".moku/editor/layout.json";

/** The text-styles file of flowView, relative to the game root. */
const STYLES_FILE = "features/ui/styles.ts";

/** The eight outcomes board/awaitIntent waits for, one hub lane each. */
const BOARD_LANES = 8;

/**
 * Game-frame warnings a source write provokes that are not editor defects: the game restored onto
 * the board logs textures and a bundle not loaded yet. The bin serves the game with Bun hot reload
 * on (D-23); its "Hot update was not accepted" notice is allowed for every spec (fixtures.ts).
 */
const RELOAD_WARNINGS: readonly RegExp[] = [
  /event: assets: texture is not loaded yet/,
  /event: renderer: no texture for asset key/,
  /event: assets: the node waited for a bundle/
];

/** A camera read from the world transform. */
type Camera = { readonly x: number; readonly y: number; readonly z: number };

/**
 * The Flow workspace host.
 *
 * @param page - The test page.
 * @returns The host locator.
 */
function flow(page: Page): Locator {
  return page.locator("[data-workspace-host=flow]");
}

/**
 * The card of a node.
 *
 * @param page - The test page.
 * @param key - The layout key, e.g. "main/home" or "main/board>board/merge".
 * @returns The card locator.
 */
function card(page: Page, key: string): Locator {
  return flow(page).locator(`[data-flow=node-card][data-key="${key}"]`);
}

/**
 * The game iframe.
 *
 * @param page - The test page.
 * @returns The frame of the game page.
 */
function gameFrame(page: Page): Frame {
  const frame = page.frames().find(f => f !== page.mainFrame() && !f.url().includes("/__editor/"));
  if (frame === undefined) throw new Error("no game frame");
  return frame;
}

/**
 * Answers the flow gate of the game, as a tap on a plank would.
 *
 * @param page - The test page.
 * @param intent - The intent, e.g. "play".
 */
async function answer(page: Page, intent: string): Promise<void> {
  const took = await gameFrame(page).evaluate(
    value =>
      (
        Reflect.get(globalThis, "game") as {
          flow: { gate: { answer(a: { intent: string }): boolean } };
        }
      ).flow.gate.answer({ intent: value }),
    intent
  );
  expect(took, `the gate took ${intent}`).toBe(true);
}

/**
 * Shows Flow and waits for the current node (main/home after boot).
 *
 * @param tools - The driver.
 */
async function showFlow(tools: Tools): Promise<void> {
  await tools.show("flow");
  await expect(card(tools.page, "main/home")).toHaveAttribute("aria-current", "location");
}

/**
 * Walks from home onto the board: Flow shows the stack main/board › board/awaitIntent.
 *
 * @param page - The test page.
 */
async function toBoard(page: Page): Promise<void> {
  await answer(page, "play");
  await expect(flow(page).locator("[data-flow=breadcrumb] [data-part=stack]")).toHaveText(
    "Stack main/board › board/awaitIntent"
  );
}

/**
 * The camera of the world layer, from its `translate(x, y) scale(z)` transform.
 *
 * @param page - The test page.
 * @returns The camera.
 */
async function camera(page: Page): Promise<Camera> {
  const style = (await flow(page).locator("[data-flow=world]").getAttribute("style")) ?? "";
  const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(style);
  if (match === null) throw new Error(`no camera in "${style}"`);
  return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
}

/**
 * The camera zoom.
 *
 * @param page - The test page.
 * @returns The zoom factor.
 */
async function zoomOf(page: Page): Promise<number> {
  const cam = await camera(page);
  return cam.z;
}

/**
 * The camera x translation.
 *
 * @param page - The test page.
 * @returns The x in px.
 */
async function camX(page: Page): Promise<number> {
  const cam = await camera(page);
  return cam.x;
}

/**
 * The camera y translation.
 *
 * @param page - The test page.
 * @returns The y in px.
 */
async function camY(page: Page): Promise<number> {
  const cam = await camera(page);
  return cam.y;
}

/**
 * The left edge of an element's box.
 *
 * @param locator - The element.
 * @returns The x in page px, undefined when it has no box.
 */
async function xOf(locator: Locator): Promise<number | undefined> {
  const box = await locator.boundingBox();
  return box?.x;
}

/**
 * The zoom readout, e.g. "80 %".
 *
 * @param page - The test page.
 * @returns The locator.
 */
function readout(page: Page): Locator {
  return flow(page).locator("[data-flow=zoom-bar] [data-action=readout]");
}

/**
 * A point on empty canvas: inside the canvas, outside every card, frame, chrome and float.
 *
 * @param page - The test page.
 * @returns The point in page px.
 */
async function emptyPoint(page: Page): Promise<{ x: number; y: number }> {
  return flow(page)
    .locator("[data-flow=canvas]")
    .evaluate(canvas => {
      const box = canvas.getBoundingClientRect();
      for (let y = box.top + 60; y < box.bottom - 60; y += 16) {
        for (let x = box.left + 40; x < box.right - 60; x += 16) {
          const hit = document.elementFromPoint(x, y);
          if (hit === null || !canvas.contains(hit)) continue;
          if (hit.closest("[data-chrome]") !== null) continue;
          const target = hit.closest("[data-hit]");
          if (target instanceof HTMLElement && target.dataset.hit !== "frame") continue;
          return { x, y };
        }
      }
      throw new Error("no empty canvas point");
    });
}

/**
 * Drags with the mouse in steps, so pointermove fires along the way.
 *
 * @param page - The test page.
 * @param from - The start point.
 * @param from.x - Its x in page px.
 * @param from.y - Its y in page px.
 * @param dx - The x delta in px.
 * @param dy - The y delta in px.
 */
async function drag(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

/**
 * Pans the canvas with the wheel until an element's centre sits a third across the canvas and
 * half way down, as a user pans before clicking something the camera left off screen: the canvas
 * clips and never scrolls, so on a half-screen window an item past its edge is out of reach.
 *
 * @param page - The test page.
 * @param target - The element to bring into view.
 */
async function reveal(page: Page, target: Locator): Promise<void> {
  const canvas = await flow(page).locator("[data-flow=canvas]").boundingBox();
  const box = await target.boundingBox();
  if (canvas === null || box === null) throw new Error("nothing to reveal");
  const goal = { x: canvas.x + canvas.width / 3, y: canvas.y + canvas.height / 2 };
  await page.mouse.move(goal.x, goal.y);
  await page.mouse.wheel(box.x + box.width / 2 - goal.x, box.y + box.height / 2 - goal.y);
  await expect
    .poll(async () => {
      const at = await target.boundingBox();
      return at === null ? Number.POSITIVE_INFINITY : Math.abs(at.x + at.width / 2 - goal.x);
    })
    .toBeLessThan(2);
}

/**
 * The newest toast text.
 *
 * @param page - The test page.
 * @returns The locator of the last toast.
 */
function toast(page: Page): Locator {
  return page.locator("[data-ui=toasts] [data-toast]").last();
}

/**
 * The open context menu.
 *
 * @param page - The test page.
 * @returns The menu locator.
 */
function menu(page: Page): Locator {
  return flow(page).locator("[data-flow=context-menu]");
}

/**
 * The labels of the open context menu.
 *
 * @param page - The test page.
 * @returns The item labels.
 */
async function menuLabels(page: Page): Promise<string[]> {
  return menu(page).getByRole("menuitem").allTextContents();
}

/**
 * The Inspector.
 *
 * @param page - The test page.
 * @returns The locator.
 */
function inspector(page: Page): Locator {
  return flow(page).locator("[data-flow=inspector]");
}

/**
 * The Inspector's side panel (a drawer below 600 px).
 *
 * @param page - The test page.
 * @returns The aside.
 */
function inspectorPanel(page: Page): Locator {
  return flow(page).locator('aside[data-side-panel="flow.inspector"]');
}

/**
 * Shows the Inspector's content: below 600 px it is a drawer that starts collapsed, so its rail
 * button opens it; docked it already shows.
 *
 * @param page - The test page.
 */
async function openInspector(page: Page): Promise<void> {
  const panel = inspectorPanel(page);
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
 * Tells whether a click at the centre of an element lands on it: inside the canvas and under no
 * float (the preview, a drawer).
 *
 * @param target - The element.
 * @returns True when the centre hits it.
 */
async function hitsCentre(target: Locator): Promise<boolean> {
  return target.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const canvas = element.closest("[data-flow=canvas]")?.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (
      canvas !== undefined &&
      (x < canvas.left || x > canvas.right || y < canvas.top || y > canvas.bottom)
    ) {
      return false;
    }
    const hit = document.elementFromPoint(x, y);
    return hit !== null && element.contains(hit);
  });
}

/**
 * Clicks a node card, panning it into view first when the camera left it outside the canvas or
 * a float covers it (the narrow windows).
 *
 * @param page - The test page.
 * @param key - The layout key.
 * @param options - Click options (a right click opens the menu).
 * @param options.button - The mouse button.
 */
async function clickCard(
  page: Page,
  key: string,
  options: { button?: "left" | "right" } = {}
): Promise<void> {
  const target = card(page, key);
  if (!(await hitsCentre(target))) await reveal(page, target);
  await target.click(options);
}

/**
 * Reads a file of the served game root, or undefined when it is missing.
 *
 * @param file - The path relative to the root.
 * @returns The text.
 */
async function readGameFile(file: string): Promise<string | undefined> {
  const full = path.join(GAME_ROOT, file);
  return existsSync(full) ? readFile(full, "utf8") : undefined;
}

/**
 * The link pill frame ("Live · f123").
 *
 * @param page - The test page.
 * @returns The frame number, -1 when none.
 */
async function pillFrame(page: Page): Promise<number> {
  const text = await page.locator("[data-ui=link-pill] [data-text]").textContent();
  const match = /f(\d+)/.exec(text ?? "");
  return match === null ? -1 : Number(match[1]);
}

/** Removes the pins file, so every test starts unpinned. */
async function clearPins(): Promise<void> {
  await rm(path.join(GAME_ROOT, LAYOUT_FILE), { force: true });
}

test.beforeEach(async () => {
  await clearPins();
});

test.describe("flow · canvas", () => {
  test("opens on the main frame at the default camera with home current", async ({ tools }) => {
    const page = tools.page;
    await showFlow(tools);
    // M11: the main frame does not fit at 80 % in any of the windows, so the camera keeps 80 %.
    await expect(readout(page)).toHaveText("80 %");
    expect(await zoomOf(page)).toBeCloseTo(0.8, 5);
    await expect(flow(page).locator("[data-flow=frame][data-key='#main']")).toBeVisible();
    await expect(flow(page).locator("[data-flow=node-card]")).toHaveCount(11);
    await expect(card(page, "main/home")).toHaveAttribute("data-current", "");
    await expect(card(page, "main/home").locator("[data-tag=on-stack]")).toHaveText("on stack");
    await expect(card(page, "main/settings").locator("[data-part=kind]")).toHaveText(
      "sub-flow · settingsPopup"
    );
    await expect(card(page, "main/afterOrder").locator("[data-part=kind]")).toHaveText(
      "slot · reward → rewardPopup (order 10)"
    );
    // The current card sits inside the canvas (centred on it when the frame does not fit).
    const canvas = await flow(page).locator("[data-flow=canvas]").boundingBox();
    const home = await card(page, "main/home").boundingBox();
    expect(canvas).not.toBeNull();
    expect(home).not.toBeNull();
    if (canvas !== null && home !== null) {
      expect(home.x).toBeGreaterThanOrEqual(canvas.x);
      expect(home.x + home.width).toBeLessThanOrEqual(canvas.x + canvas.width);
    }
    // Nothing selected: the Inspector shows the current node.
    await expect(inspector(page).locator("[data-tag=showing-current]")).toHaveText(
      "showing current · click a node"
    );
    await expect(flow(page).locator("[data-flow=breadcrumb] [data-part=segment]")).toHaveText([
      "main"
    ]);
    await expect(flow(page).locator("[data-flow=breadcrumb] [data-part=stack]")).toHaveText(
      "Stack main/home"
    );
  });

  test("a click on a node focuses it: camera moves, the rest dims, the current node stays, the Inspector follows", async ({
    tools
  }) => {
    const page = tools.page;
    await showFlow(tools);
    const before = await camera(page);
    await clickCard(page, "main/settings");

    await expect(card(page, "main/settings")).toHaveAttribute("aria-pressed", "true");
    await expect(card(page, "main/settings")).toHaveAttribute("data-selected", "");
    // Related (the node, its sources and targets) stay; the rest dims.
    await expect(card(page, "main/home")).not.toHaveAttribute("data-dimmed", "");
    await expect(card(page, "main/boot")).toHaveAttribute("data-dimmed", "");
    await expect(card(page, "main/board")).toHaveAttribute("data-dimmed", "");
    await expect(card(page, "main/settings")).not.toHaveAttribute("data-dimmed", "");
    // A dimmed card keeps its opaque background: only its content fades.
    const dimmed = await card(page, "main/boot").evaluate(element => ({
      card: Number(getComputedStyle(element).opacity),
      content: Number(getComputedStyle(element.firstElementChild ?? element).opacity)
    }));
    expect(dimmed.card).toBe(1);
    expect(dimmed.content).toBeLessThan(0.5);
    // The camera moved onto the node: its centre is on the canvas's middle line.
    await expect.poll(async () => camera(page)).not.toEqual(before);
    await expect
      .poll(async () => `${Math.round((await zoomOf(page)) * 100)} %`)
      .toBe(await readout(page).textContent());
    expect(await zoomOf(page)).toBeLessThanOrEqual(1.25);
    const canvas = await flow(page).locator("[data-flow=canvas]").boundingBox();
    const at = await card(page, "main/settings").boundingBox();
    if (canvas === null || at === null) throw new Error("no boxes");
    expect(Math.abs(at.y + at.height / 2 - (canvas.y + canvas.height / 2))).toBeLessThan(4);
    expect(at.x).toBeGreaterThan(canvas.x);
    expect(at.x + at.width).toBeLessThan(canvas.x + canvas.width);

    await expect(inspector(page).locator("[data-tag=showing-current]")).toHaveCount(0);
    await expect(inspector(page).locator("[data-part=id]")).toHaveText("main/settings");
  });

  test("an empty-canvas click clears the selection and never focuses the frame (M2)", async ({
    tools
  }) => {
    const page = tools.page;
    await showFlow(tools);
    await clickCard(page, "main/settings");
    await expect(inspector(page).locator("[data-part=id]")).toHaveText("main/settings");
    const point = await emptyPoint(page);
    await page.mouse.click(point.x, point.y);
    await expect(card(page, "main/settings")).toHaveAttribute("aria-pressed", "false");
    await expect(flow(page).locator("[data-dimmed]")).toHaveCount(0);
    await expect(inspector(page).locator("[data-tag=showing-current]")).toHaveCount(1);
    // A click on the frame head does not select the frame either.
    const head = flow(page).locator("[data-flow=frame][data-key='#main'] [data-part=head]");
    await reveal(page, head);
    // Click the revealed centre: the head is wider than the canvas, and the middle of its part in
    // the window can sit under the preview float.
    const box = await head.boundingBox();
    await head.click({ position: { x: (box?.width ?? 0) / 2, y: (box?.height ?? 0) / 2 } });
    await expect(flow(page).locator("[data-selected]")).toHaveCount(0);
  });
});

test.describe("flow · inspector walk", () => {
  test("the Info rows: ↑/↓ move the highlight, Enter follows it, Alt+← goes back, ←/→ walk", async ({
    tools
  }) => {
    const page = tools.page;
    await showFlow(tools);
    const info = inspector(page).locator("[data-flow=info-tab]");
    const outcomes = info.locator("[data-part=outcomes] > li");
    const comesFrom = info.locator("[data-part=comes-from] > li");
    const pressed = flow(page).locator(
      "[data-flow=node-card][aria-pressed=true], [data-flow=hub][aria-pressed=true]"
    );

    // A sub-flow: one row each side.
    await clickCard(page, "main/settings");
    await expect(inspector(page).locator("[data-part=id]")).toHaveText("main/settings");
    await expect(comesFrom).toHaveCount(1);
    await expect(comesFrom.first()).toContainText("main/home");
    await expect(outcomes.locator("[data-part=outcome]")).toHaveText(["closed"]);

    // Home, focused and selected: the current node waits for its four outcomes.
    await clickCard(page, "main/home");
    await expect(card(page, "main/home")).toHaveAttribute("aria-pressed", "true");
    await expect(inspector(page).locator("[data-tag=current]")).toHaveText("current");
    await expect(outcomes).toHaveCount(4);
    await expect(info.locator("[data-part=outcomes] > li[data-waiting]")).toHaveCount(4);
    await expect(comesFrom).toHaveCount(7);

    // ↓/↑ move one highlight through Outcomes, then Comes from.
    await page.keyboard.press("ArrowDown");
    await expect(info.locator("li[data-highlight]")).toHaveCount(1);
    await expect(outcomes.first()).toHaveAttribute("data-highlight", "");
    await page.keyboard.press("ArrowDown");
    await expect(outcomes.nth(1)).toHaveAttribute("data-highlight", "");
    await page.keyboard.press("ArrowUp");
    await expect(outcomes.first()).toHaveAttribute("data-highlight", "");

    // Enter follows the highlighted outcome; the Inspector offers Back; Alt+← goes back.
    await page.keyboard.press("Enter");
    await expect(card(page, "main/home")).toHaveAttribute("aria-pressed", "false");
    await expect(pressed).toHaveCount(1);
    // The Back button (a drawer below 600 px, maybe shut: counted, not looked at).
    await expect(inspector(page).locator("[data-action=back]")).toHaveAttribute(
      "aria-label",
      "Back"
    );
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(card(page, "main/home")).toHaveAttribute("aria-pressed", "true");

    // ← walks to the first Comes from row, → walks on to a default outcome.
    const source = ((await comesFrom.first().locator("button").textContent()) ?? "").split(
      " · "
    )[0];
    await page.keyboard.press("ArrowLeft");
    await expect(card(page, "main/home")).toHaveAttribute("aria-pressed", "false");
    await expect(inspector(page).locator("[data-part=id]")).toHaveText(source ?? "");
    await page.keyboard.press("ArrowRight");
    await expect(inspector(page).locator("[data-part=id]")).not.toHaveText(source ?? "");
    await expect(pressed).toHaveCount(1);

    // Esc leaves focus.
    await page.keyboard.press("Escape");
    await expect(flow(page).locator("[data-selected]")).toHaveCount(0);
  });

  test("boot has nothing leading to it; the current node never fades", async ({ tools }) => {
    const page = tools.page;
    await showFlow(tools);
    // Boot sits left of the canvas at the default camera: keyboard focus + Enter selects it.
    await card(page, "main/boot").focus();
    await page.keyboard.press("Enter");
    await expect(card(page, "main/boot")).toHaveAttribute("aria-pressed", "true");
    await expect(inspector(page).locator("[data-part=comes-from]")).toHaveCount(0);
    await expect(inspector(page).locator("[data-flow=info-tab] [data-part=empty]")).toHaveText(
      "Nothing leads here"
    );
    await expect(card(page, "main/home")).toHaveAttribute("data-current", "");
    await expect(card(page, "main/home")).not.toHaveAttribute("data-dimmed", "");
  });
});

test.describe("flow · sub-flows", () => {
  test("expand in place, collapse, enter and the breadcrumb back (M1)", async ({ tools }) => {
    const page = tools.page;
    await showFlow(tools);
    const crumbs = flow(page).locator("[data-flow=breadcrumb] [data-part=segment]");

    // Expand settings in place: a sub-flow frame with its own cards appears inside main.
    const expand = flow(page).getByRole("button", { name: "Expand main/settings" });
    await reveal(page, expand);
    await expand.click();
    const frame = flow(page).locator("[data-flow=frame]:not([data-root])");
    await expect(frame).toHaveCount(1);
    await expect(frame.locator("[data-part=title]")).toContainText("settings");
    const inner = flow(page).locator("[data-flow=node-card][data-key^='main/settings>']");
    await expect.poll(async () => inner.count()).toBeGreaterThan(0);
    await reveal(page, frame.locator("[data-action=collapse]"));
    await frame.locator("[data-action=collapse]").click();
    await expect(frame).toHaveCount(0);
    await expect(inner).toHaveCount(0);

    // Enter settings: the breadcrumb shows main › settingsPopup, only its cards show.
    await reveal(page, expand);
    await expand.click();
    await reveal(page, frame.locator("[data-action=enter]"));
    await frame.locator("[data-action=enter]").click();
    await expect(crumbs).toHaveCount(2);
    await expect(crumbs.first()).toHaveText("main");
    await expect(crumbs.last()).toHaveAttribute("data-current", "");
    await expect(card(page, "main/home")).toHaveCount(0);
    // M1: the first segment exits back to main.
    await crumbs.first().click();
    await expect(crumbs).toHaveCount(1);
    await expect(card(page, "main/home")).toBeVisible();

    // A double-click on a sub-flow card enters it too.
    if (!(await hitsCentre(card(page, "main/board")))) await reveal(page, card(page, "main/board"));
    await card(page, "main/board").dblclick();
    await expect(crumbs).toHaveCount(2);
    await expect(crumbs.last()).toHaveText("board");
    await crumbs.first().click();
    await expect(crumbs).toHaveCount(1);
  });
});

test.describe("flow · board hub", () => {
  test("on the board its sub-flow opens in place; the hub has one lane per outcome and You are here", async ({
    tools
  }) => {
    const page = tools.page;
    await showFlow(tools);
    await toBoard(page);
    // The sub-flow that holds the current node opens in place (finding 16): a frame, no card.
    const frame = flow(page).locator('[data-flow=frame][data-key="main/board"]');
    await expect(frame).toHaveCount(1);
    await expect(frame).toHaveAttribute("data-on-stack", "");
    await expect(card(page, "main/board")).toHaveCount(0);

    // The stack link focuses the current node: the hub inside the open sub-flow.
    await flow(page).locator("[data-flow=breadcrumb] [data-part=stack]").click();

    const hub = flow(page).locator("[data-flow=hub]");
    await expect(hub).toHaveAttribute("data-key", "main/board>board/awaitIntent");
    await expect(hub).toHaveAttribute("aria-current", "location");
    await expect(hub).toHaveAttribute("aria-pressed", "true");
    await expect(hub.locator("[data-tag=current]")).toHaveText("You are here");
    await expect(hub.locator("[data-part=waiting]")).toHaveText(
      `waiting for ${BOARD_LANES} outcomes`
    );
    await expect(hub.locator("[data-part=port]")).toHaveCount(BOARD_LANES);
    await expect(hub.locator("[data-part=port][data-waiting]")).toHaveCount(BOARD_LANES);
    await expect(flow(page).locator("[data-flow=lane]")).toHaveCount(BOARD_LANES);
    // Lanes stack one row each, top to bottom, without overlap.
    const ys = await flow(page)
      .locator("[data-flow=lane]")
      .evaluateAll(lanes => lanes.map(lane => lane.getBoundingClientRect().y));
    for (let index = 1; index < ys.length; index += 1) {
      expect(ys[index] ?? 0).toBeGreaterThan(ys[index - 1] ?? 0);
    }
    // The board frame is on the stack.
    await expect(
      flow(page).locator("[data-flow=frame][data-on-stack]:not([data-root])")
    ).toHaveCount(1);
    // The golden is taken on desktop only: in the narrow windows the focused hub runs past the
    // canvas edge, so its clipped box is not a stable image. The canvas chrome the tall hub runs
    // under (zoom bar, minimap) is masked.
    if (test.info().project.name === "chromium-desktop") {
      await tools.settle();
      await expect(flow(page).locator("[data-flow=hub]")).toHaveScreenshot("board-hub.png", {
        mask: [
          ...tools.volatile(),
          flow(page).locator("[data-flow=zoom-bar]"),
          flow(page).locator("[data-flow=minimap]")
        ]
      });
    }
  });

  test("the stack link focuses the current node", async ({ tools }) => {
    const page = tools.page;
    await showFlow(tools);
    await clickCard(page, "main/settings");
    await flow(page).locator("[data-flow=breadcrumb] [data-part=stack]").click();
    await expect(card(page, "main/home")).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("flow · a collapsed card holds the current node (round 2 R5)", () => {
  test("on the board, the collapsed board card is current: here tag, never dimmed, its trail edge lit", async ({
    tools
  }) => {
    const page = tools.page;
    await showFlow(tools);
    await toBoard(page);
    // The sub-flow holding the current node opens in place; collapse it back to its card.
    const frame = flow(page).locator('[data-flow=frame][data-key="main/board"]');
    await expect(frame).toHaveCount(1);
    // From the keyboard (Space): in the narrow windows the "You are here" chip can lie over the
    // button, and Enter is the flow's own key (it follows the highlighted row).
    await frame.locator("[data-action=collapse]").first().press("Space");
    await expect(frame).toHaveCount(0);

    const board = card(page, "main/board");
    await expect(board).toBeVisible();
    // Another node selected: what is unrelated dims, the card holding the game does not.
    await clickCard(page, "main/settings");
    await expect(card(page, "main/settings")).toHaveAttribute("aria-pressed", "true");
    await expect(card(page, "main/boot")).toHaveAttribute("data-dimmed", "");
    await expect(board).not.toHaveAttribute("data-dimmed", "");
    // The trail edge into it is highlighted.
    await expect(flow(page).locator("path[data-here]")).not.toHaveCount(0);

    // It holds the current node (the node itself is inside it): the accent ring of a holder and
    // the "here" tag (R5, flowView README).
    await expect(board).toHaveAttribute("data-holds-current", "");
    await expect(board.locator("[data-tag=here]")).toHaveText("here");
    await expect(board).not.toHaveAttribute("data-current", "");
  });
});

test.describe("flow · history strip", () => {
  test("dots, labels beside the Inspector (M3), open list and select an entry", async ({
    tools
  }) => {
    const page = tools.page;
    await showFlow(tools);
    await toBoard(page);
    const history = flow(page).locator("[data-flow=history-strip]");
    const dots = history.locator("[data-flow=history-dot]");
    await expect(dots.first()).toHaveAttribute("aria-label", /^home · play · f\d+$/);
    await expect(dots.first()).toHaveAttribute("data-trail", "");

    // Hover a dot: its label shows, left of the Inspector, never over it (M3).
    await dots.first().hover();
    const label = flow(page).locator("[data-flow=history-labels] [data-label]").first();
    await expect(label).toContainText("home · play");
    const labelBox = await label.boundingBox();
    const inspectorBox = await inspectorPanel(page).boundingBox();
    if (labelBox === null || inspectorBox === null) throw new Error("no boxes");
    expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(inspectorBox.x + 0.5);

    // Open: the list with rows, newest first.
    await history.locator("[data-action=history]").click();
    await expect(history).toHaveAttribute("data-open", "");
    await expect(history.locator("[data-action=history]")).toHaveAttribute("aria-pressed", "true");
    await expect(history.locator("[data-part=title]")).toHaveText(
      /^History · \d+ edges · newest first$/
    );
    const row = history.locator("[data-flow=history-row]").first();
    await expect(row.locator("[data-part=outcome]")).toHaveText("play → board/awaitIntent");
    await row.click();
    await expect(row).toHaveAttribute("aria-selected", "true");
    await expect(card(page, "main/home")).toHaveAttribute("aria-pressed", "true");

    // H closes it again.
    await page.keyboard.press("h");
    await expect(history).not.toHaveAttribute("data-open", "");
  });
});

test.describe("flow · camera", () => {
  test("zoom in, out, 100 % by the bar and the keys", async ({ tools }) => {
    const page = tools.page;
    await showFlow(tools);
    const bar = flow(page).locator("[data-flow=zoom-bar]");
    await bar.locator("[data-action=zoom-in]").click();
    await expect(readout(page)).toHaveText("100 %");
    await bar.locator("[data-action=zoom-in]").click();
    await expect(readout(page)).toHaveText("125 %");
    expect(await zoomOf(page)).toBeCloseTo(1.25, 5);
    await bar.locator("[data-action=zoom-out]").click();
    await bar.locator("[data-action=zoom-out]").click();
    await expect(readout(page)).toHaveText("80 %");
    await readout(page).click();
    await expect(readout(page)).toHaveText("100 %");

    const point = await emptyPoint(page);
    await page.mouse.click(point.x, point.y);
    await page.keyboard.press("-");
    await expect(readout(page)).toHaveText("80 %");
    await page.keyboard.press("+");
    await expect(readout(page)).toHaveText("100 %");
    await page.keyboard.press("-");
    await page.keyboard.press("0");
    await expect(readout(page)).toHaveText("100 %");
  });

  test("fit all shows every card; fit selection frames the selected one", async ({ tools }) => {
    const page = tools.page;
    await showFlow(tools);
    const canvas = await flow(page).locator("[data-flow=canvas]").boundingBox();
    if (canvas === null) throw new Error("no canvas");
    const inside = async (key: string): Promise<boolean> => {
      const box = await card(page, key).boundingBox();
      return (
        box !== null &&
        box.x >= canvas.x &&
        box.y >= canvas.y &&
        box.x + box.width <= canvas.x + canvas.width &&
        box.y + box.height <= canvas.y + canvas.height
      );
    };
    expect(await inside("main/boot")).toBe(false);
    await flow(page).locator("[data-flow=zoom-bar] [data-action=fit-all]").click();
    await expect.poll(() => inside("main/boot")).toBe(true);
    await expect.poll(() => inside("main/afterOrder")).toBe(true);
    const fitted = await camera(page);
    expect(fitted.z).toBeLessThan(0.8);

    // F and ⇧1 fit all too, after a zoom in.
    await page.keyboard.press("+");
    await expect.poll(async () => await zoomOf(page)).toBeGreaterThan(fitted.z);
    await page.keyboard.press("f");
    await expect.poll(async () => await zoomOf(page)).toBeCloseTo(fitted.z, 5);
    await page.keyboard.press("+");
    await page.keyboard.press("Shift+Digit1");
    await expect.poll(async () => await zoomOf(page)).toBeCloseTo(fitted.z, 5);

    // Fit selection: the selected card fills more of the view than at fit all.
    await clickCard(page, "main/settings");
    await flow(page).locator("[data-flow=zoom-bar] [data-action=fit-all]").click();
    await expect.poll(async () => await zoomOf(page)).toBeCloseTo(fitted.z, 5);
    await flow(page).locator("[data-flow=zoom-bar] [data-action=fit-selection]").click();
    await expect.poll(async () => await zoomOf(page)).toBeGreaterThan(fitted.z);
    expect(await inside("main/settings")).toBe(true);
    const selectionZ = await zoomOf(page);
    await page.keyboard.press("f");
    await expect.poll(async () => await zoomOf(page)).toBeCloseTo(fitted.z, 5);
    await page.keyboard.press("Shift+Digit2");
    await expect.poll(async () => await zoomOf(page)).toBeCloseTo(selectionZ, 5);
  });

  test("Follow the game moves the camera with the current node; a selection keeps it (M9)", async ({
    tools
  }) => {
    const page = tools.page;
    await showFlow(tools);
    const follow = flow(page).locator("[data-flow=canvas-toolbar] [data-action=follow]");
    await expect(follow).toHaveAttribute("aria-pressed", "false");
    await follow.click();
    await expect(follow).toHaveAttribute("aria-pressed", "true");
    await clickCard(page, "main/settings");
    await expect(follow).toHaveAttribute("aria-pressed", "true");
    const before = await camera(page);
    await toBoard(page);
    // The camera follows onto the board hub, the current node in the board sub-flow that opens in
    // place.
    await expect.poll(async () => camera(page)).not.toEqual(before);
    const view = await flow(page).locator("[data-flow=canvas]").boundingBox();
    if (view === null) throw new Error("no canvas");
    await expect
      .poll(async () => {
        const box = await flow(page).locator("[data-flow=hub]").boundingBox();
        const middle = box === null ? Number.NaN : box.x + box.width / 2;
        return middle > view.x && middle < view.x + view.width;
      })
      .toBe(true);
    await follow.click();
    await expect(follow).toHaveAttribute("aria-pressed", "false");
  });

  test("the minimap moves the camera by click and drag", async ({ tools }) => {
    const page = tools.page;
    await showFlow(tools);
    const map = flow(page).getByRole("img", { name: "Minimap of main" });
    const box =
      (await map.boundingBox()) ??
      (await flow(page).locator("[data-flow=minimap] svg").boundingBox());
    if (box === null) throw new Error("no minimap");
    await expect(
      flow(page).locator("[data-flow=minimap] [data-minimap-item][data-current]")
    ).toHaveCount(1);
    const before = await camera(page);
    await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.7);
    await expect.poll(async () => camera(page)).not.toEqual(before);
    const clicked = await camera(page);
    expect(clicked.x).toBeGreaterThan(before.x);
    await drag(
      page,
      { x: box.x + box.width * 0.15, y: box.y + box.height * 0.7 },
      box.width * 0.6,
      0
    );
    await expect.poll(async () => await camX(page)).toBeLessThan(clicked.x);
    expect(await zoomOf(page)).toBeCloseTo(before.z, 5);
  });

  test("Tab onto a card outside the canvas brings it into view; the selection stays", async ({
    tools
  }) => {
    const page = tools.page;
    await showFlow(tools);
    await card(page, "main/home").focus();
    const before = await camera(page);
    let revealed: string | undefined;
    for (let presses = 0; presses < 60 && revealed === undefined; presses++) {
      // Cards that are not fully inside the canvas before this Tab.
      const outside = await flow(page)
        .locator("[data-flow=node-card]")
        .evaluateAll(cards => {
          const box = document.querySelector("[data-flow=canvas]")?.getBoundingClientRect();
          if (box === undefined) return [];
          return cards
            .filter(element => {
              const rect = element.getBoundingClientRect();
              const isInside =
                rect.left >= box.left &&
                rect.top >= box.top &&
                rect.right <= box.right &&
                rect.bottom <= box.bottom;
              return !isInside;
            })
            .map(element => (element as HTMLElement).dataset.key ?? "");
        });
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const active = document.activeElement;
        return active instanceof HTMLElement && active.dataset.flow === "node-card"
          ? active.dataset.key
          : undefined;
      });
      if (focused !== undefined && outside.includes(focused)) revealed = focused;
    }
    expect(revealed, "Tab reached a card outside the canvas").toBeDefined();
    if (revealed === undefined) return;
    await expect(card(page, revealed)).toBeFocused();
    await expect
      .poll(async () => {
        const canvas = await flow(page).locator("[data-flow=canvas]").boundingBox();
        const box = await card(page, revealed).boundingBox();
        if (canvas === null || box === null) return false;
        return (
          box.x >= canvas.x - 1 &&
          box.y >= canvas.y - 1 &&
          box.x + box.width <= canvas.x + canvas.width + 1 &&
          box.y + box.height <= canvas.y + canvas.height + 1
        );
      }, `${revealed} inside the canvas`)
      .toBe(true);
    // A pan, not a focus move: the zoom and the selection stay.
    expect(await zoomOf(page)).toBeCloseTo(before.z, 5);
    await expect(flow(page).locator("[data-selected]")).toHaveCount(0);
  });

  test("a drag on empty canvas pans and selects nothing", async ({ tools }) => {
    const page = tools.page;
    await showFlow(tools);
    const before = await camera(page);
    await drag(page, await emptyPoint(page), 120, 60);
    await expect.poll(async () => await camX(page)).toBeCloseTo(before.x + 120, 0);
    expect(await camY(page)).toBeCloseTo(before.y + 60, 0);
    expect(await zoomOf(page)).toBeCloseTo(before.z, 5);
    await expect(flow(page).locator("[data-selected]")).toHaveCount(0);
  });
});

test.describe("flow · layout", () => {
  test("a dragged card snaps, pins, writes layout.json; Reset layout puts it back", async ({
    tools
  }) => {
    const page = tools.page;
    await showFlow(tools);
    const reset = flow(page).locator("[data-flow=canvas-toolbar] [data-action=reset]");
    await expect(reset).toHaveAttribute("aria-disabled", "true");
    const home = card(page, "main/home");
    const start = await home.boundingBox();
    if (start === null) throw new Error("no card");

    // Esc during a drag cancels it.
    await page.mouse.move(start.x + 40, start.y + 15);
    await page.mouse.down();
    await page.mouse.move(start.x + 140, start.y + 90, { steps: 6 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect.poll(async () => await xOf(home)).toBeCloseTo(start.x, 0);
    await expect(home).not.toHaveAttribute("data-pinned", "");

    // A real drag: the card follows, snaps to the 12-unit grid and is pinned.
    await drag(page, { x: start.x + 40, y: start.y + 15 }, 120, 72);
    await expect(home).toHaveAttribute("data-pinned", "");
    await expect(home.getByRole("img", { name: "Pinned" })).toBeVisible();
    const moved = await home.boundingBox();
    if (moved === null) throw new Error("no card");
    const z = await zoomOf(page);
    expect(Math.abs(moved.x - start.x - 120)).toBeLessThanOrEqual(12 * z);
    expect(Math.abs(moved.y - start.y - 72)).toBeLessThanOrEqual(12 * z);
    await expect(toast(page)).toContainText("Layout saved");
    await expect(toast(page)).toContainText(LAYOUT_FILE);
    await expect.poll(async () => (await readGameFile(LAYOUT_FILE)) ?? "").toContain("main/home");
    const pins = JSON.parse((await readGameFile(LAYOUT_FILE)) ?? "{}") as unknown;
    expect(JSON.stringify(pins)).toMatch(/home/);
    await expect(reset).toHaveAttribute("aria-disabled", "false");

    // Reset layout: back to the computed place, unpinned, the file no longer pins it.
    await reset.click();
    await expect(home).not.toHaveAttribute("data-pinned", "");
    await expect.poll(async () => await xOf(home)).toBeCloseTo(start.x, 0);
    await expect
      .poll(async () => (await readGameFile(LAYOUT_FILE)) ?? "")
      .not.toContain("main/home");
    await expect(reset).toHaveAttribute("aria-disabled", "true");
  });
});

test.describe("flow · context menus", () => {
  test("the node menu, keyboard, and Step 1 frame only while paused (M5)", async ({ tools }) => {
    const page = tools.page;
    await showFlow(tools);
    await clickCard(page, "main/settings", { button: "right" });
    await expect(menu(page)).toBeVisible();
    expect(await menuLabels(page)).toEqual(
      expect.arrayContaining(["Focus", "Open code", "Open styles"])
    );
    expect(await menuLabels(page)).not.toContain("Add note on closed");
    await expect(menu(page).getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu(page).getByRole("menuitem").nth(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await expect(menu(page)).toHaveCount(0);
    await expect(card(page, "main/settings")).toHaveAttribute("aria-pressed", "true");

    // The current node (focused first, so it is on screen in every window): Step 1 frame is
    // disabled while live.
    await flow(page).locator("[data-flow=breadcrumb] [data-part=stack]").click();
    await expect(card(page, "main/home")).toHaveAttribute("aria-pressed", "true");
    await card(page, "main/home").click({ button: "right" });
    const step = menu(page).getByRole("menuitem", { name: "Step 1 frame" });
    await expect(step).toHaveAttribute("aria-disabled", "true");
    await menu(page).getByRole("menuitem", { name: "Pause game" }).click();
    await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "paused");

    await card(page, "main/home").click({ button: "right" });
    await expect(step).not.toHaveAttribute("aria-disabled", "true");
    const before = await pillFrame(page);
    await step.click();
    await expect.poll(() => pillFrame(page)).toBe(before + 1);
    await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "paused");

    await card(page, "main/home").click({ button: "right" });
    await menu(page).getByRole("menuitem", { name: "Resume game" }).click();
    await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live");
  });

  test("the outcome menu and the canvas menu", async ({ tools }) => {
    const page = tools.page;
    await showFlow(tools);
    const stub = flow(page).locator("[data-flow=stub][data-key='stub:main/settings:closed']");
    await reveal(page, stub);
    await stub.click({ button: "right" });
    expect(await menuLabels(page)).toEqual(["Focus home"]);
    await menu(page).getByRole("menuitem", { name: "Focus home" }).click();
    await expect(card(page, "main/home")).toHaveAttribute("aria-pressed", "true");

    const point = await emptyPoint(page);
    await page.mouse.click(point.x, point.y, { button: "right" });
    expect(await menuLabels(page)).toEqual(["Fit all", "Reset layout"]);
    await expect(menu(page).getByRole("menuitem", { name: "Reset layout" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    // The menu stays inside the canvas.
    const box = await menu(page).boundingBox();
    const canvas = await flow(page).locator("[data-flow=canvas]").boundingBox();
    if (box === null || canvas === null) throw new Error("no boxes");
    expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width + 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(canvas.y + canvas.height + 0.5);
    await menu(page).getByRole("menuitem", { name: "Fit all" }).click();
    await expect(menu(page)).toHaveCount(0);
    await expect.poll(async () => await zoomOf(page)).toBeLessThan(0.8);
  });
});

test.describe("flow · inspector", () => {
  test("tabs Info, Code, Styles by click and arrow keys", async ({ tools }) => {
    const page = tools.page;
    await showFlow(tools);
    await clickCard(page, "main/home");
    await openInspector(page);
    const tabs = inspector(page).getByRole("tab");
    await expect(tabs).toHaveText(["Info", "Code", "Styles"]);
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    await expect(inspector(page).locator("[data-flow=info-tab]")).toContainText(
      "rest · checkpoint"
    );
    await tabs.nth(1).click();
    await expect(inspector(page).locator("[data-flow=code-tab]")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
    await expect(inspector(page).locator("[data-flow=styles-tab]")).toBeVisible();
    // The arrows wrap around the three tabs.
    await page.keyboard.press("ArrowRight");
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    await expect(inspector(page).locator("[data-flow=info-tab]")).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
    // The clear button leaves focus.
    await inspector(page).getByRole("button", { name: "Clear" }).click();
    await expect(flow(page).locator("[data-selected]")).toHaveCount(0);
  });

  test("Code: edit and save writes the file and reloads the game with state restored (D-07)", async ({
    tools,
    errors
  }) => {
    for (const pattern of RELOAD_WARNINGS) errors.allow(pattern);
    const page = tools.page;
    await showFlow(tools);
    // On the board: a restore brings the game back here, a plain reload would land on home.
    await toBoard(page);
    await clickCard(page, "main/home");
    await openInspector(page);
    await inspector(page).getByRole("tab", { name: "Code" }).click();
    const tab = inspector(page).locator("[data-flow=code-tab]");
    const file = (
      (await tab.locator("[data-part=file-bar] [data-part=path]").textContent()) ?? ""
    ).trim();
    expect(file).toMatch(/\.tsx?$/);
    const original = (await readGameFile(file)) ?? "";
    expect(original.length).toBeGreaterThan(0);
    await expect(tab.locator("[data-line][data-highlight]")).toHaveCount(1);
    try {
      // Unchanged text: no write.
      await tab.locator("[data-action=edit]").click();
      await tab.locator("[data-action=save]").click();
      await expect(tab.locator("[data-part=result]")).toHaveText("✓ No changes");

      // Esc with a changed draft asks first.
      await tab.locator("[data-action=edit]").click();
      const editor = tab.getByRole("textbox", { name: `Edit ${file}` });
      await editor.fill(`${original}\n// e2e edit\n`);
      await editor.press("Escape");
      await expect(tab).toContainText("Discard changes?");
      await tab.getByRole("button", { name: "Keep editing" }).click();
      await expect(editor).toHaveValue(`${original}\n// e2e edit\n`);

      // Save: the file changes on disk, the game frame reloads and restores the checkpoint.
      await gameFrame(page).evaluate(() => Reflect.set(globalThis, "__e2eMark", 1));
      await editor.press("ControlOrMeta+s");
      await expect(tab.locator("[data-part=result]")).toHaveText(
        "✓ Saved · game reloaded · state restored from the last checkpoint",
        { timeout: 30_000 }
      );
      expect(await readGameFile(file)).toBe(`${original}\n// e2e edit\n`);
      // M12: the write toasts the file name.
      await expect(
        page.locator("[data-ui=toasts] [data-toast]").filter({ hasText: file }).first()
      ).toBeVisible();
      await expect
        .poll(async () =>
          gameFrame(page)
            .evaluate(() => Reflect.get(globalThis, "__e2eMark") ?? "reloaded")
            .catch(() => "pending")
        )
        .toBe("reloaded");
      await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live", {
        timeout: 30_000
      });
      await expect(flow(page).locator("[data-flow=breadcrumb] [data-part=stack]")).toHaveText(
        "Stack main/board › board/awaitIntent"
      );
      await expect(flow(page).locator("[data-flow=hub]")).toHaveAttribute(
        "aria-current",
        "location"
      );
    } finally {
      await writeFile(path.join(GAME_ROOT, file), original);
    }
  });

  test("Styles: the size stepper writes one number and the game hot swaps it (U10)", async ({
    tools,
    errors
  }) => {
    for (const pattern of RELOAD_WARNINGS) errors.allow(pattern);
    const page = tools.page;
    await showFlow(tools);
    await toBoard(page);
    const original = (await readGameFile(STYLES_FILE)) ?? "";
    await clickCard(page, "main/home");
    await openInspector(page);
    await inspector(page).getByRole("tab", { name: "Styles" }).click();
    const tab = inspector(page).locator("[data-flow=styles-tab]");
    await expect(tab).toContainText(STYLES_FILE);
    // No style is preselected: pick one first.
    await tab.getByRole("combobox").selectOption("ui.title");
    const up = tab.getByRole("button", { name: "Increase size" }).first();
    const value = up.locator("xpath=..").locator("[data-part=value]");
    const before = Number(await value.textContent());
    try {
      await up.click();
      await expect(value).toHaveText(String(before + 1));
      await expect(tab.locator("[data-part=applied]")).toHaveText(
        /^✓ Written to features\/ui\/styles\.ts:\d+ · game updated$/,
        { timeout: 30_000 }
      );
      const after = (await readGameFile(STYLES_FILE)) ?? "";
      const changed = after
        .split("\n")
        .filter((line, index) => line !== original.split("\n")[index]);
      expect(changed).toHaveLength(1);
      expect(changed[0]).toContain(String(before + 1));
      await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live", {
        timeout: 30_000
      });
      await expect(flow(page).locator("[data-flow=breadcrumb] [data-part=stack]")).toHaveText(
        "Stack main/board › board/awaitIntent"
      );
    } finally {
      await writeFile(path.join(GAME_ROOT, STYLES_FILE), original);
    }
  });
});

test.describe("flow · keys", () => {
  test(String.raw`Esc unwinds the menu, then the selection; \ folds the Inspector; H toggles the history`, async ({
    tools
  }) => {
    const page = tools.page;
    await showFlow(tools);
    await clickCard(page, "main/settings");
    await expect(card(page, "main/settings")).toHaveAttribute("aria-pressed", "true");

    await clickCard(page, "main/settings", { button: "right" });
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await expect(card(page, "main/settings")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(flow(page).locator("[data-selected]")).toHaveCount(0);

    // \ collapses and expands the Inspector (opens and shuts its drawer below 600 px).
    const panel = inspectorPanel(page);
    const state = (await panel.getAttribute("data-state")) ?? "";
    const other = state === "expanded" ? "collapsed" : "expanded";
    await page.keyboard.press("Backslash");
    await expect(panel).toHaveAttribute("data-state", other);
    await page.keyboard.press("Backslash");
    await expect(panel).toHaveAttribute("data-state", state);

    // H toggles the history strip.
    const history = flow(page).locator("[data-flow=history-strip]");
    await page.keyboard.press("h");
    await expect(history).toHaveAttribute("data-open", "");
    await page.keyboard.press("h");
    await expect(history).not.toHaveAttribute("data-open", "");
  });
});

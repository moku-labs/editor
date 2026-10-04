/**
 * @file The Claude-pane round (delta spec "the Claude-pane round", U1-U8) in a real browser, on
 * every window from the 480 px Claude pane to the desktop: the pinned preview plays the game (a
 * tap on Play walks it, the size stays), a tap draws a ripple at the tap point, Reference mode
 * (proxies named for the game elements at their Element tab bounds, no input reaches the game,
 * Copy reference with the one line of round 2b R13 that names the card holding the reference
 * block of round 2), the Element tab bounds of homeBackground
 * after splash → home and after a device change, the source of settingsBoard, Flow following a
 * Comes from edge (both ends framed,
 * the pulse, Alt+← back), find current (C), the Styles tab without a preselected style, and the
 * side panels of Flow, Game and Files (collapse, resize, close, reopen; a drawer below 600 px).
 *
 * Geometry is the browser's: the iframe box, the overlay boxes and `game.rect` of the game page
 * are compared in client px. Ground truth is read from the game page (`globalThis.editor`). A pick
 * saves two PNGs under .moku/captures of the game copy (round 2 R2); each test removes them.
 */
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Frame, Locator, Page } from "@playwright/test";
import { expect, type Tools, test } from "./fixtures";
import { barChecked, flipBarToggle, showPreview } from "./top-bar";

/**
 * A reference block without its clock (the HH:MM:SS of its game line).
 *
 * @param text - The block.
 * @returns The block without the time.
 */
function withoutClock(text: string): string {
  return text.replace(/ · \d\d:\d\d:\d\d · /, " · ");
}

/** The captures folder of the game copy the bin serves. */
const CAPTURES = fileURLToPath(new URL("../dist-e2e/game/.moku/captures/", import.meta.url));

/** The project root the bin serves. */
const GAME_ROOT = fileURLToPath(new URL("../dist-e2e/game/", import.meta.url));

/** The one reference line of settingsBoard; group 1 is the card it names. */
const BOARD_LINE =
  /^@moku settingsBoard panel · settingsPopup\/open · features\/settings\/settings\.tsx:301 · ref \d+,\d+ \d+×\d+ · (\.moku\/captures\/settingsBoard-f\d+\.md)$/;

/** The reference block inside a card file: its `text` fence. */
const TEXT_FENCE = /^```text\n([\s\S]*?)\n```$/m;

/**
 * The reference block in the card a reference line names.
 *
 * @param line - The clipboard line.
 * @returns The block.
 */
async function cardBlock(line: string): Promise<string> {
  const card = BOARD_LINE.exec(line)?.[1] ?? "";
  expect(card, line).not.toBe("");
  const text = await readFile(path.join(GAME_ROOT, card), "utf8");
  return TEXT_FENCE.exec(text)?.[1] ?? "";
}

/** A rect in px. */
type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/** A client point. */
type Point = { readonly x: number; readonly y: number };

/** One ripple the recorder saw: its centre in client px and its kind. */
type Ripple = { readonly x: number; readonly y: number; readonly kind: string };

/** Game-frame warnings a reload provokes that are not editor defects (see flow.spec.ts). */
const RELOAD_WARNINGS: readonly RegExp[] = [
  /event: assets: texture is not loaded yet/,
  /event: renderer: no texture for asset key/,
  /event: assets: the node waited for a bundle/
];

/** The pixi warning a device change provokes in the game frame (see game.spec.ts). */
const PIXI_RESIZE = /PixiJS Warning: +\[BindGroup\] a 'texture(Source|Sampler)' was destroyed/;

/** The container width below which a side panel floats as a drawer (every view uses 600). */
const OVERLAY_BELOW = 600;

/** The three side panels: workspace, id, docked edge and title. */
const SIDE_PANELS = [
  { ws: "flow", id: "flow.inspector", side: "end", title: "Inspector" },
  { ws: "game", id: "game.side", side: "end", title: "Element panel" },
  { ws: "files", id: "files.tree", side: "start", title: "Files" }
] as const;

// ---------------------------------------------------------------------------------------------
// The game page
// ---------------------------------------------------------------------------------------------

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

/**
 * Reads a registry source of the game page directly, as ground truth for the editor's view.
 *
 * @param page - The test page.
 * @param id - The source id, e.g. "game.rect".
 * @param input - The source input.
 * @returns The value.
 */
async function readSource<T>(page: Page, id: string, input: object = {}): Promise<T> {
  const json = await gameFrame(page).evaluate(
    async ([source, value]) => {
      const registry = (
        Reflect.get(globalThis, "editor") as {
          registry: { source(id: string): { read(input: object): Promise<unknown> } };
        }
      ).registry;
      return JSON.stringify(await registry.source(source).read(value));
    },
    [id, input] as const
  );
  return JSON.parse(json) as T;
}

/**
 * The game position path, e.g. "home" or "board/awaitIntent".
 *
 * @param page - The test page.
 * @returns The path, or "pending" while the game page reloads.
 */
async function gamePath(page: Page): Promise<string> {
  try {
    const position = await readSource<{ path: string }>(page, "game.position");
    return position.path;
  } catch {
    return "pending";
  }
}

/**
 * The page rect of a keyed game element, in game CSS px, once the game reports it.
 *
 * @param page - The test page.
 * @param key - The ui key.
 * @returns The rect.
 */
async function gameRect(page: Page, key: string): Promise<Rect> {
  await expect
    .poll(async () => (await readSource<Rect | null>(page, "game.rect", { key })) !== null)
    .toBe(true);
  return readSource<Rect>(page, "game.rect", { key });
}

/**
 * Waits until a keyed game element stops moving (a popup plays its enter motion first).
 *
 * @param page - The test page.
 * @param key - The ui key.
 * @returns The settled rect.
 */
async function settledRect(page: Page, key: string): Promise<Rect> {
  let last = "";
  await expect
    .poll(async () => {
      const now = JSON.stringify(await gameRect(page, key));
      const still = now === last;
      last = now;
      return still;
    })
    .toBe(true);
  return JSON.parse(last) as Rect;
}

/**
 * Answers the flow gate of the game, as a tap on a control would.
 *
 * @param page - The test page.
 * @param intent - The intent, e.g. "openSettings".
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
 * Maps a game page rect to client px through the iframe box (the frame is scaled to fit).
 *
 * @param page - The test page.
 * @param rect - A rect in game CSS px.
 * @returns The rect in client px.
 */
async function toClient(page: Page, rect: Rect): Promise<Rect> {
  const box = await page.locator("iframe[data-game-frame]").boundingBox();
  if (box === null) throw new Error("no iframe box");
  const inner = await gameFrame(page).evaluate(() => innerWidth);
  const scale = box.width / inner;
  return {
    x: box.x + rect.x * scale,
    y: box.y + rect.y * scale,
    w: rect.w * scale,
    h: rect.h * scale
  };
}

/**
 * The centre of a client rect.
 *
 * @param rect - The rect.
 * @returns The point.
 */
function centre(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/**
 * Taps the centre of a keyed game element with the real mouse.
 *
 * @param page - The test page.
 * @param key - The ui key.
 * @returns The client point tapped.
 */
async function tapGame(page: Page, key: string): Promise<Point> {
  const at = centre(await toClient(page, await gameRect(page, key)));
  await page.mouse.click(at.x, at.y);
  return at;
}

/**
 * Marks the game page, so a reload shows as the mark being gone.
 *
 * @param page - The test page.
 */
async function markGame(page: Page): Promise<void> {
  await gameFrame(page).evaluate(() => Reflect.set(globalThis, "__e2eMark", 1));
}

/**
 * Tells whether the game page was reloaded since `markGame`.
 *
 * @param page - The test page.
 * @returns "reloaded", "marked" or "pending".
 */
async function reloadState(page: Page): Promise<string> {
  try {
    return await gameFrame(page).evaluate(() =>
      Reflect.get(globalThis, "__e2eMark") === 1 ? "marked" : "reloaded"
    );
  } catch {
    return "pending";
  }
}

// ---------------------------------------------------------------------------------------------
// The frame, the preview and the ripples
// ---------------------------------------------------------------------------------------------

/**
 * Waits until the game frame is docked where a workspace shows it ("stage" or "preview") and the
 * iframe box sits on its slot.
 *
 * @param page - The test page.
 * @param where - The dock.
 */
async function waitDocked(page: Page, where: "stage" | "preview"): Promise<void> {
  await expect(page.locator("[data-frame-box]")).toHaveAttribute("data-docked", where);
  const slot =
    where === "stage"
      ? page.locator("[data-workspace-host=game] [data-part=slot]")
      : page.locator("[data-ui=preview] [data-preview-body]");
  // The frame fits its slot at the device aspect: inside it, touching two opposite sides.
  await expect
    .poll(async () => {
      const target = await slot.boundingBox();
      const frame = await page.locator("iframe[data-game-frame]").boundingBox();
      if (target === null || frame === null) return false;
      const inside =
        frame.x >= target.x - 1.5 &&
        frame.y >= target.y - 1.5 &&
        frame.x + frame.width <= target.x + target.width + 1.5 &&
        frame.y + frame.height <= target.y + target.height + 1.5;
      const fills =
        Math.abs(frame.width - target.width) < 1.5 || Math.abs(frame.height - target.height) < 1.5;
      return inside && fills;
    })
    .toBe(true);
}

/**
 * Makes the game preview visible in the shown workspace: the narrow windows may start with it
 * hidden, then the Game preview toggle of the top bar (a ⋯ menu row below 900 px) shows it.
 *
 * @param page - The test page.
 */
async function ensurePreview(page: Page): Promise<void> {
  await showPreview(page);
  await waitDocked(page, "preview");
}

/**
 * Records every tap ripple the frame overlay draws, with its centre at the moment it appears (a
 * reduced-motion dot lives 300 ms, too short for a locator poll).
 *
 * @param page - The test page.
 */
async function recordRipples(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: { x: number; y: number; kind: string }[] = [];
    Reflect.set(globalThis, "__e2eRipples", seen);
    new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement) || node.dataset.tapRipple === undefined) continue;
          const rect = node.getBoundingClientRect();
          seen.push({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            kind: node.dataset.tapRipple
          });
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
}

/**
 * The ripples recorded since `recordRipples`.
 *
 * @param page - The test page.
 * @returns The ripples, oldest first.
 */
async function ripples(page: Page): Promise<Ripple[]> {
  return page.evaluate(() => [...((Reflect.get(globalThis, "__e2eRipples") as Ripple[]) ?? [])]);
}

/**
 * How many ripples the recorder saw.
 *
 * @param page - The test page.
 * @returns The count.
 */
async function rippleCount(page: Page): Promise<number> {
  const seen = await ripples(page);
  return seen.length;
}

// ---------------------------------------------------------------------------------------------
// Side panels
// ---------------------------------------------------------------------------------------------

/**
 * The rendered width of an element, rounded; 0 while it has no box.
 *
 * @param locator - The element.
 * @returns The width in px.
 */
async function widthOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  return Math.round(box?.width ?? 0);
}

/**
 * A side panel by id.
 *
 * @param page - The test page.
 * @param id - The panel id, e.g. "game.side".
 * @returns The aside.
 */
function sidePanel(page: Page, id: string): Locator {
  return page.locator(`aside[data-side-panel="${id}"]`);
}

/**
 * Waits until a side panel has settled into the mode its container width calls for (a drawer
 * below 600 px, docked otherwise) and tells which.
 *
 * @param panel - The aside.
 * @returns True when it floats as a drawer.
 */
async function settledOverlay(panel: Locator): Promise<boolean> {
  await expect(panel).toBeVisible();
  await expect
    .poll(() =>
      panel.evaluate((element, below) => {
        const width = element.parentElement?.getBoundingClientRect().width ?? 0;
        const isDrawer = element.dataset.overlay !== undefined;
        return width > 0 && width < below === isDrawer;
      }, OVERLAY_BELOW)
    )
    .toBe(true);
  return (await panel.getAttribute("data-overlay")) !== null;
}

/**
 * Shows a side panel's content: expands the rail (opens the drawer below 600 px).
 *
 * @param page - The test page.
 * @param id - The panel id.
 */
async function expandSide(page: Page, id: string): Promise<void> {
  const panel = sidePanel(page, id);
  await settledOverlay(panel);
  if ((await panel.getAttribute("data-state")) === "collapsed") {
    await panel.locator(":scope > [data-part=rail] [data-action=expand]").click();
  }
  await expect(panel).toHaveAttribute("data-state", "expanded");
}

/**
 * Shuts a side panel's drawer, so the content under it takes the pointer again; a docked panel
 * stays as it is.
 *
 * @param page - The test page.
 * @param id - The panel id.
 */
async function shutDrawer(page: Page, id: string): Promise<void> {
  const panel = sidePanel(page, id);
  const isDrawer = await settledOverlay(panel);
  if (!isDrawer || (await panel.getAttribute("data-state")) === "collapsed") return;
  await panel.locator(":scope > [data-part=head] [data-action=collapse]").click();
  await expect(panel).toHaveAttribute("data-state", "collapsed");
}

// ---------------------------------------------------------------------------------------------
// Game workspace
// ---------------------------------------------------------------------------------------------

/**
 * The Game workspace host.
 *
 * @param page - The test page.
 * @returns The locator.
 */
function game(page: Page): Locator {
  return page.locator("[data-workspace-host=game]");
}

/**
 * A part of the device toolbar.
 *
 * @param page - The test page.
 * @param part - The `data-part` value.
 * @returns The locator.
 */
function bar(page: Page, part: string): Locator {
  return game(page).locator(`[data-game=toolbar] [data-part=${part}]`);
}

/**
 * The overlay root gameView draws over the game screen.
 *
 * @param page - The test page.
 * @returns The locator.
 */
function overlay(page: Page): Locator {
  return page.locator("[data-game=overlay]");
}

/**
 * The Element tab body.
 *
 * @param page - The test page.
 * @returns The locator.
 */
function elementTab(page: Page): Locator {
  return game(page).locator("[data-game=side] [data-part=element]");
}

/**
 * Shows Game and waits for the stage to dock the frame.
 *
 * @param tools - The driver.
 */
async function showGame(tools: Tools): Promise<void> {
  await tools.show("game");
  await expect(game(tools.page).locator("[data-game=stage]")).toBeVisible();
  await waitDocked(tools.page, "stage");
}

/**
 * Turns the picker on and waits for its layer.
 *
 * @param page - The test page.
 */
async function pickerOn(page: Page): Promise<void> {
  await bar(page, "pick").click();
  await expect(bar(page, "pick")).toHaveAttribute("aria-pressed", "true");
  await expect(overlay(page).locator("[data-part=picker]")).toBeVisible();
}

/**
 * Picks the game element under the first point of a grid over a client rect whose hover label
 * matches, as a user moves the pointer until the ring names what they want, then clicks it.
 *
 * @param page - The test page.
 * @param rect - The client rect to scan.
 * @param label - The expected hover label.
 */
async function pickIn(page: Page, rect: Rect, label: RegExp): Promise<void> {
  await pickerOn(page);
  const xs = [0.5, 0.04, 0.96, 0.25, 0.75];
  const ys = [0.5, 0.62, 0.38, 0.75, 0.88, 0.25, 0.96];
  const hover = overlay(page).locator("[data-part=label]");
  let found: Point | undefined;
  // The label shows once the scene is calibrated (after a reload or a device change too).
  await expect
    .poll(
      async () => {
        for (const fy of ys) {
          for (const fx of xs) {
            const at = { x: rect.x + rect.w * fx, y: rect.y + rect.h * fy };
            await page.mouse.move(at.x, at.y);
            const text = (await hover.count()) > 0 ? ((await hover.textContent()) ?? "") : "";
            if (label.test(text)) {
              found = at;
              return text;
            }
          }
        }
        return "";
      },
      { timeout: 20_000 }
    )
    .toMatch(label);
  if (found === undefined) throw new Error("no point");
  await page.mouse.click(found.x, found.y);
  await expect(bar(page, "pick")).toHaveAttribute("aria-pressed", "false");
}

/**
 * The Element tab bounds as numbers: x, y, w, h.
 *
 * @param page - The test page.
 * @returns The four numbers.
 */
async function tabBounds(page: Page): Promise<number[]> {
  const texts = await elementTab(page).locator("[data-part=bounds] dd").allTextContents();
  return texts.map(Number);
}

/**
 * Tells whether two number lists are equal within a tolerance.
 *
 * @param actual - The measured numbers.
 * @param expected - The expected numbers.
 * @param tolerance - The largest difference that still counts as equal.
 * @returns True when every pair is close.
 */
function near(actual: readonly number[], expected: readonly number[], tolerance: number): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => Math.abs(value - (expected[index] ?? Number.NaN)) <= tolerance)
  );
}

// ---------------------------------------------------------------------------------------------
// Flow workspace
// ---------------------------------------------------------------------------------------------

/**
 * The Flow workspace host.
 *
 * @param page - The test page.
 * @returns The locator.
 */
function flow(page: Page): Locator {
  return page.locator("[data-workspace-host=flow]");
}

/**
 * The card of a node.
 *
 * @param page - The test page.
 * @param key - The layout key, e.g. "main/home".
 * @returns The card locator.
 */
function card(page: Page, key: string): Locator {
  return flow(page).locator(`[data-flow=node-card][data-key="${key}"]`);
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
 * Shows Flow and waits for the current node (main/home after boot).
 *
 * @param tools - The driver.
 */
async function showFlow(tools: Tools): Promise<void> {
  await tools.show("flow");
  await expect(card(tools.page, "main/home")).toHaveAttribute("aria-current", "location");
}

/**
 * Tells whether a node card lies wholly inside the canvas.
 *
 * @param page - The test page.
 * @param key - The layout key.
 * @returns True when inside.
 */
async function insideCanvas(page: Page, key: string): Promise<boolean> {
  const canvas = await flow(page).locator("[data-flow=canvas]").boundingBox();
  const box = await card(page, key).boundingBox();
  if (canvas === null || box === null) return false;
  return (
    box.x >= canvas.x - 1 &&
    box.y >= canvas.y - 1 &&
    box.x + box.width <= canvas.x + canvas.width + 1 &&
    box.y + box.height <= canvas.y + canvas.height + 1
  );
}

/**
 * Clicks a node card, first panning it with the wheel to a third across the canvas when the
 * camera left it outside the canvas or a float (the preview, a panel rail) covers its centre.
 *
 * @param page - The test page.
 * @param key - The layout key.
 */
async function clickCard(page: Page, key: string): Promise<void> {
  const target = card(page, key);
  const hits = await target.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit !== null && element.contains(hit);
  });
  if (!hits) {
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
  await target.click();
}

/**
 * Records the keys of the cards and hubs that get `data-pulse` (a pulse lasts 600 ms).
 *
 * @param page - The test page.
 */
async function recordPulses(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: string[] = [];
    Reflect.set(globalThis, "__e2ePulses", seen);
    new MutationObserver(records => {
      for (const record of records) {
        const target = record.target;
        if (target instanceof HTMLElement && target.dataset.pulse !== undefined) {
          seen.push(target.dataset.key ?? "");
        }
      }
    }).observe(document.body, { attributes: true, attributeFilter: ["data-pulse"], subtree: true });
  });
}

/**
 * The keys that pulsed since `recordPulses`.
 *
 * @param page - The test page.
 * @returns The keys, in order.
 */
async function pulses(page: Page): Promise<string[]> {
  return page.evaluate(() => [...((Reflect.get(globalThis, "__e2ePulses") as string[]) ?? [])]);
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

test.afterEach(async () => {
  await rm(CAPTURES, { recursive: true, force: true });
});

test.describe("pane · the pinned preview plays the game", () => {
  test("a tap on Play in the preview walks the game off home; the preview keeps its size", async ({
    tools
  }) => {
    const page = tools.page;
    await tools.show("render");
    await ensurePreview(page);
    const preview = page.locator("[data-ui=preview]");
    const sizes = preview.getByRole("radiogroup", { name: "Preview size" });
    await sizes.getByRole("radio", { name: "M", exact: true }).click();
    await expect(preview).toHaveAttribute("data-size", "M");
    await waitDocked(page, "preview");
    await expect.poll(() => gamePath(page)).toBe("home");

    await tapGame(page, "play");
    await expect.poll(() => gamePath(page)).toBe("board/awaitIntent");
    await expect(preview).toHaveAttribute("data-size", "M");
    await expect(page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", "render");
  });

  test("a tap draws a ripple at the tap point, on the stage and in the preview", async ({
    tools
  }) => {
    const page = tools.page;
    await recordRipples(page);
    await showGame(tools);
    const onStage = await tapGame(page, "homeLogo");
    await expect.poll(() => rippleCount(page)).toBe(1);
    const [first] = await ripples(page);
    expect(first?.kind, "reduced motion draws a dot").toBe("dot");
    expect(Math.abs((first?.x ?? 0) - onStage.x), "ripple x on the stage").toBeLessThan(2);
    expect(Math.abs((first?.y ?? 0) - onStage.y), "ripple y on the stage").toBeLessThan(2);
    // The dot goes after its 300 ms.
    await expect(page.locator("[data-tap-ripple]")).toHaveCount(0);

    await tools.show("render");
    await ensurePreview(page);
    const inPreview = await tapGame(page, "homeLogo");
    await expect.poll(() => rippleCount(page)).toBe(2);
    const [, second] = await ripples(page);
    expect(Math.abs((second?.x ?? 0) - inPreview.x), "ripple x in the preview").toBeLessThan(2);
    expect(Math.abs((second?.y ?? 0) - inPreview.y), "ripple y in the preview").toBeLessThan(2);
    expect(await gamePath(page)).toBe("home");
  });
});

test.describe("pane · reference mode", () => {
  test("R lays named proxies over the game; the game gets no tap; off removes them", async ({
    tools
  }) => {
    const page = tools.page;
    await showGame(tools);
    await expect.poll(() => gamePath(page)).toBe("home");
    // The Reference mode toggle: a button of the wide bar, a ⋯ menu row below 900 px.
    expect(await barChecked(page, "reference")).toBe(false);
    await expect(page.locator("[data-moku-proxy]")).toHaveCount(0);

    // R (focus is on the rail button, not in an input) turns it on.
    await page.keyboard.press("r");
    await expect.poll(() => barChecked(page, "reference")).toBe(true);
    await expect(page.locator("[data-frame-box]")).toHaveAttribute("data-reference", "");
    const background = page.locator('[data-moku-proxy][data-moku-key="homeBackground"]');
    await expect(background).toHaveCount(1);
    await expect(page.getByLabel("homeBackground", { exact: true })).toHaveCount(1);
    await expect(background).toHaveAttribute("title", /^homeBackground · \S+$/);
    await expect(background).toHaveAttribute("data-moku-name", "homeBackground");
    await expect(background).toHaveAttribute("data-moku-path", /homeBackground$/);
    await expect(background).toHaveAttribute("data-moku-node", "home");
    const rect = await gameRect(page, "homeBackground");
    await expect(background).toHaveAttribute(
      "data-moku-bounds",
      [rect.x, rect.y, rect.w, rect.h].map(value => String(Math.round(value))).join(" ")
    );
    // Every proxy names its element for assistive tech and tools.
    const unnamed = await page
      .locator("[data-moku-proxy]")
      .evaluateAll(proxies => proxies.filter(proxy => !proxy.getAttribute("aria-label")).length);
    expect(unnamed).toBe(0);

    // A tap on Play lands on the proxies: the game stays on home.
    await tapGame(page, "play");
    await page.waitForTimeout(600);
    expect(await gamePath(page)).toBe("home");

    // Off: no proxy left, and the game takes the tap again.
    await flipBarToggle(page, "reference");
    await expect.poll(() => barChecked(page, "reference")).toBe(false);
    await expect(page.locator("[data-moku-proxy]")).toHaveCount(0);
    await expect(page.locator("[data-frame-box]")).not.toHaveAttribute("data-reference", "");
    await tapGame(page, "play");
    await expect.poll(() => gamePath(page)).toBe("board/awaitIntent");
  });

  test("settingsBoard: the frame matches game.rect, the source is found, the proxy and Copy reference carry the bounds", async ({
    tools
  }) => {
    const page = tools.page;
    await showGame(tools);
    await expect.poll(() => gamePath(page)).toBe("home");
    // Settings from the board's HUD: the position stack is board > settings > open.
    await answer(page, "play");
    await expect.poll(() => gamePath(page)).toBe("board/awaitIntent");
    await answer(page, "openSettings");
    await expect.poll(() => gamePath(page)).toBe("board/settings/open");
    const board = await settledRect(page, "settingsBoard");

    // Pick the board itself, where no child of it is drawn over the point.
    await pickIn(page, await toClient(page, board), /^settingsBoard · /);
    await expect(page.locator("[data-ui=toasts] [data-toast]").last()).toHaveText(
      "Reference, shot and bookmark copied"
    );
    const picked = await page.evaluate(() => navigator.clipboard.readText());
    await expandSide(page, "game.side");
    const tab = elementTab(page);
    await expect(tab.locator("[data-part=name]")).toHaveText("settingsBoard");

    // The selected frame and the bounds are the element's real rect (2 px).
    const expected = [board.x, board.y, board.w, board.h];
    await expect.poll(async () => near(await tabBounds(page), expected, 2)).toBe(true);
    const client = await toClient(page, board);
    await expect
      .poll(async () => {
        const box = await overlay(page).locator("[data-box=selected]").boundingBox();
        if (box === null) return false;
        return near(
          [box.x, box.y, box.width, box.height],
          [client.x, client.y, client.w, client.h],
          2
        );
      })
      .toBe(true);

    // The source: "Defined at …settings.tsx:301", or the style card of its style.
    const source = tab.locator("[data-part=style-card]");
    await expect(source).not.toContainText("Searching the sources", { timeout: 20_000 });
    await expect(source).not.toContainText("Source not found");
    await ((await source.locator("[data-part=defined]").count()) > 0
      ? expect(source.locator("[data-part=defined] [data-part=where]")).toHaveText(
          /features\/settings\/settings\.tsx:301$/
        )
      : expect(source.locator("[data-part=where]").first()).toHaveText(/\.tsx?:\d+$/));

    // Reference mode: the settingsBoard proxy has the Element tab bounds (2 px).
    const bounds = await tabBounds(page);
    await flipBarToggle(page, "reference");
    const proxy = page.locator('[data-moku-proxy][data-moku-key="settingsBoard"]');
    await expect(proxy).toHaveCount(1);
    await expect(proxy).toHaveAttribute("aria-label", "settingsBoard");
    const proxyBounds = ((await proxy.getAttribute("data-moku-bounds")) ?? "")
      .split(" ")
      .map(Number);
    expect(near(proxyBounds, bounds, 2), `${proxyBounds} near ${bounds}`).toBe(true);

    // Copy reference writes the card again and copies its one line, the pick's line (the same
    // node and frame name the same card); the card holds eleven lines in a fixed order.
    await page.evaluate(() => navigator.clipboard.writeText(""));
    await tab.locator("[data-action=copy-reference]").click();
    await expect(page.locator("[data-ui=toasts] [data-toast]").last()).toHaveText(
      "✓ Reference copied"
    );
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toMatch(BOARD_LINE);
    const line = await page.evaluate(() => navigator.clipboard.readText());
    expect(line).toBe(picked);
    const block = await cardBlock(line);
    const lines = block.split("\n");
    expect(
      lines.map(text => (text.startsWith("@moku ") ? "@moku" : text.split(":")[0])),
      block
    ).toEqual([
      "@moku",
      "path",
      "source",
      "layout",
      "bounds",
      "state",
      "flow",
      "game",
      "device",
      "restore",
      "shot"
    ]);
    const [head, , sourceLine, , boundsLine, , flowLine] = lines;
    expect(head, block).toMatch(/^@moku settingsBoard · panel · settingsPopup\/open · f\d+$/);
    expect(sourceLine, block).toMatch(/^source: features\/settings\/settings\.tsx:301\b/);
    // The bounds: device px as the Element tab shows them, then the reference units.
    const [x, y, w, h] = bounds;
    expect(boundsLine, block).toMatch(
      new RegExp(String.raw`^bounds: ${x},${y} ${w}×${h} px · ref \d+,\d+ \d+×\d+$`)
    );
    expect(flowLine, block).toMatch(/^flow: board > settings > open( · last: .+)?$/);
    expect(lines[9], block).toMatch(/^restore: bookmark settingsBoard-f\d+$/);
    expect(lines[10], block).toMatch(
      /^shot: \.moku\/captures\/settingsBoard-f\d+\.png · frame: \.moku\/captures\/f\d+\.png$/
    );
    // Copy reference and the pick give the same facts (only the clock may differ): the card's
    // block is the one the Element tab shows.
    const shown = (await tab.locator("pre[data-part=reference]").textContent()) ?? "";
    expect(withoutClock(block)).toBe(withoutClock(shown));

    await flipBarToggle(page, "reference");
    await expect(page.locator("[data-moku-proxy]")).toHaveCount(0);
  });
});

test.describe("pane · element bounds", () => {
  test("homeBackground fills the Pixel 8 screen after splash → home and after a device change", async ({
    tools,
    errors
  }) => {
    errors.allow(PIXI_RESIZE);
    for (const pattern of RELOAD_WARNINGS) errors.allow(pattern);
    const page = tools.page;
    await showGame(tools);
    await bar(page, "device").selectOption("pixel-8");
    await expect.poll(() => gameFrame(page).evaluate(() => innerWidth)).toBe(412);

    // Splash → home: the Reload of the toolbar boots the game page again.
    await markGame(page);
    await bar(page, "reload").click();
    await expect.poll(() => reloadState(page), { timeout: 30_000 }).toBe("reloaded");
    await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live", {
      timeout: 30_000
    });
    await expect.poll(() => gamePath(page), { timeout: 30_000 }).toBe("home");
    await waitDocked(page, "stage");

    const frame = await page.locator("iframe[data-game-frame]").boundingBox();
    if (frame === null) throw new Error("no iframe box");
    await pickIn(
      page,
      { x: frame.x, y: frame.y, w: frame.width, h: frame.height },
      /^homeBackground · /
    );
    await expandSide(page, "game.side");
    await expect(elementTab(page).locator("[data-part=name]")).toHaveText("homeBackground");
    await expect.poll(() => tabBounds(page)).toEqual([0, 0, 412, 915]);

    // A device change: the bounds follow the new screen, then come back.
    await bar(page, "device").selectOption("iphone-15");
    await expect.poll(() => gameFrame(page).evaluate(() => innerWidth)).toBe(393);
    await expect.poll(async () => near(await tabBounds(page), [0, 0, 393, 852], 1)).toBe(true);
    await bar(page, "device").selectOption("pixel-8");
    await expect.poll(() => gameFrame(page).evaluate(() => innerWidth)).toBe(412);
    await expect.poll(async () => near(await tabBounds(page), [0, 0, 412, 915], 1)).toBe(true);
  });
});

test.describe("pane · flow", () => {
  test("a Comes from row follows its edge: both ends framed, the reached node pulses, Alt+← goes back", async ({
    tools
  }) => {
    const page = tools.page;
    await showFlow(tools);
    await clickCard(page, "main/settings");
    await expect(card(page, "main/settings")).toHaveAttribute("aria-pressed", "true");
    await expandSide(page, "flow.inspector");
    await recordPulses(page);

    const row = inspector(page).locator("[data-part=comes-from] li").first();
    await expect(row).toContainText("main/home");
    await row.getByRole("button").click();
    await expect(card(page, "main/home")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => pulses(page)).toContain("main/home");
    // The camera frames both ends of the edge.
    await expect
      .poll(
        async () => (await insideCanvas(page, "main/home")) && insideCanvas(page, "main/settings")
      )
      .toBe(true);

    const back = inspector(page).locator("[data-action=back]");
    await expect(back).toBeVisible();
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(card(page, "main/settings")).toHaveAttribute("aria-pressed", "true");
    await expect(back).toHaveCount(0);
  });

  test("find current: C, the toolbar button and the edge chevron bring the current node back", async ({
    tools
  }) => {
    const page = tools.page;
    await showFlow(tools);
    await shutDrawer(page, "flow.inspector");
    await recordPulses(page);
    const canvas = await flow(page).locator("[data-flow=canvas]").boundingBox();
    if (canvas === null) throw new Error("no canvas");
    const panAway = async (): Promise<void> => {
      await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
      await page.mouse.wheel(1600, 1200);
      await expect.poll(() => insideCanvas(page, "main/home")).toBe(false);
    };

    await panAway();
    await expect(flow(page).locator("[data-flow=offscreen]")).toBeVisible();
    await page.keyboard.press("c");
    await expect.poll(() => insideCanvas(page, "main/home")).toBe(true);
    await expect.poll(() => pulses(page)).toContain("main/home");
    await expect(flow(page).locator("[data-flow=offscreen]")).toHaveCount(0);

    await panAway();
    await flow(page).locator("[data-flow=canvas-toolbar] [data-action=find-current]").click();
    await expect.poll(() => insideCanvas(page, "main/home")).toBe(true);

    await panAway();
    await flow(page).locator("[data-flow=offscreen]").click();
    await expect.poll(() => insideCanvas(page, "main/home")).toBe(true);
  });

  test("the Styles tab preselects no text style until one is picked", async ({ tools }) => {
    const page = tools.page;
    await showFlow(tools);
    await clickCard(page, "main/home");
    await expandSide(page, "flow.inspector");
    await inspector(page).getByRole("tab", { name: "Styles" }).click();
    const tab = inspector(page).locator("[data-flow=styles-tab]");
    const select = tab.getByRole("combobox");
    await expect(select).toBeVisible();
    await expect(select).toHaveValue("");
    await expect(select.locator("option:checked")).toHaveText("Pick a text style");
    await expect(tab.locator("[data-part=card]")).toHaveCount(0);
    await expect(tab).not.toContainText("Used by appears");

    await select.selectOption("ui.title");
    await expect(select).toHaveValue("ui.title");
    await expect(tab.locator("[data-part=card]")).toBeVisible();
    await expect(tab.getByRole("button", { name: /^Increase / }).first()).toBeVisible();
  });
});

test.describe("pane · side panels", () => {
  for (const { ws, id, side, title } of SIDE_PANELS) {
    test(`${ws}: the ${title} side panel collapses, resizes, closes and reopens`, async ({
      tools
    }) => {
      const page = tools.page;
      await tools.show(ws);
      const panel = sidePanel(page, id);
      const isDrawer = await settledOverlay(panel);
      // Below 600 px the panel floats over the view and starts collapsed.
      if (isDrawer) await expect(panel).toHaveAttribute("data-state", "collapsed");
      await expandSide(page, id);

      // The drawer floats over the content, never wider than 92 % of the view.
      const container = await panel.evaluate(
        element => element.parentElement?.getBoundingClientRect().width ?? 0
      );
      if (isDrawer) {
        await expect(panel).toHaveCSS("position", "absolute");
        const box = await panel.boundingBox();
        expect(box?.width ?? 0).toBeLessThanOrEqual(container * 0.92 + 1);
      }

      // Resize from the keyboard: the inner edge moves 16 px per arrow; double-click resets.
      const handle = panel.getByRole("separator", { name: `Resize ${title}` });
      const start = Number(await handle.getAttribute("aria-valuenow"));
      const max = Number(await handle.getAttribute("aria-valuemax"));
      await handle.focus();
      await page.keyboard.press(side === "end" ? "ArrowLeft" : "ArrowRight");
      const wider = Math.min(start + 16, max);
      await expect(handle).toHaveAttribute("aria-valuenow", String(wider));
      await expect
        .poll(() => widthOf(panel))
        .toBe(Math.round(Math.min(wider, isDrawer ? container * 0.92 : wider)));

      // A pointer drag on the handle: 40 px inward narrows it by 40. A float the wider panel now
      // reaches (the preview, re-placed beside the panel) clears the handle first.
      await expect
        .poll(() =>
          handle.evaluate(element => {
            const rect = element.getBoundingClientRect();
            const hit = document.elementFromPoint(
              rect.left + rect.width / 2,
              rect.top + rect.height / 2
            );
            return hit === element ? "handle" : (hit?.tagName.toLowerCase() ?? "nothing");
          })
        )
        .toBe("handle");
      const grip = await handle.boundingBox();
      if (grip === null) throw new Error("no handle box");
      const from = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + (side === "end" ? 20 : -20), from.y, { steps: 4 });
      await page.mouse.move(from.x + (side === "end" ? 40 : -40), from.y, { steps: 4 });
      await page.mouse.up();
      const min = Number(await handle.getAttribute("aria-valuemin"));
      await expect(handle).toHaveAttribute("aria-valuenow", String(Math.max(wider - 40, min)));
      await handle.dblclick();
      await expect(handle).toHaveAttribute("aria-valuenow", String(start));

      // Collapse to the 32 px rail, expand again.
      await panel.locator(":scope > [data-part=head] [data-action=collapse]").click();
      await expect(panel).toHaveAttribute("data-state", "collapsed");
      await expect.poll(() => widthOf(panel)).toBe(32);
      await panel.locator(":scope > [data-part=rail] [data-action=expand]").click();
      await expect(panel).toHaveAttribute("data-state", "expanded");

      // Close: the view shows its reopen button; it brings the panel back expanded.
      await panel.locator(":scope > [data-part=head] [data-action=close]").click();
      await expect(panel).toHaveCount(0);
      const reopen = tools.host(ws).locator(`[data-action="reopen-${id}"]`);
      await expect(reopen).toBeVisible();
      await reopen.click();
      await expect(panel).toHaveAttribute("data-state", "expanded");
      await expect(reopen).toHaveCount(0);

      // The page never scrolls sideways.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBe(0);
    });

    test(`${ws}: the open ${title} takes the pointer everywhere; nothing of the game draws over it`, async ({
      tools
    }) => {
      const page = tools.page;
      await tools.show(ws);
      // The pinned preview shows in Flow and Files; Game docks the frame on its stage.
      await (ws === "game" ? waitDocked(page, "stage") : ensurePreview(page));
      await expandSide(page, id);
      const covered = await sidePanel(page, id).evaluate(element => {
        const rect = element.getBoundingClientRect();
        const misses: string[] = [];
        for (const fy of [0.15, 0.35, 0.5, 0.65, 0.85]) {
          for (const fx of [0.1, 0.5, 0.9]) {
            const x = rect.left + rect.width * fx;
            const y = rect.top + rect.height * fy;
            const hit = document.elementFromPoint(x, y);
            if (hit === null || !element.contains(hit)) {
              misses.push(
                `${Math.round(x)},${Math.round(y)} ${hit?.tagName.toLowerCase() ?? "nothing"}`
              );
            }
          }
        }
        return misses;
      });
      expect(covered, "points of the open panel another layer takes").toEqual([]);
    });
  }
});

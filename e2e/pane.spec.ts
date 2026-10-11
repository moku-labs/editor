/**
 * @file The Claude-pane round (delta spec "the Claude-pane round", U1-U8) in a real browser, on
 * every window from the 480 px Claude pane to the desktop: the pinned preview plays the game (a
 * tap on Play walks it, the size stays), a tap draws a ripple at the tap point, the element picker
 * (the Select icon button of the Game toolbar lit while it is on; with the Copy Ref switch of the
 * toolbar off a pick only selects the element and writes nothing, and an area drag picks nothing,
 * D-70; Copy reference with the one line of round 2b R13 that names the card
 * holding the reference block of round 2; the Styles fields of the Element tab with their pending
 * edits and "Copy for agent"; the Text style section of a text with the edit of its style key,
 * D-73), the Element tab bounds of homeBackground after a reload and after a
 * device change, the source of levelPanel, Flow following a Comes from edge (both ends framed,
 * the pulse, Alt+← back), find current (C), the Info and Code tabs of the Flow inspector, and the
 * side panels of Flow, Game and Files (collapse, resize, close, reopen; a drawer below 600 px).
 * Reference mode and the Flow Styles tab are gone (editor UI cleanup, D-65, D-66).
 *
 * Geometry is the browser's: the iframe box, the overlay boxes and `game.locate` of the game page
 * are compared in client px. Ground truth is read from the game page (`globalThis.editor`). A pick
 * saves two pictures and a card under .moku/captures of the game copy (round 2 R2); each test
 * removes them.
 */
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { Frame, Locator, Page } from "@playwright/test";
import { expect, gameRoot, type Tools, test } from "./fixtures";
import { showPreview } from "./top-bar";

/** The view module of the tiny game, root-relative: it defines every keyed element. */
const VIEW_FILE = "features/tiny/view.tsx";

/** The feature module of the tiny game, root-relative: it defines the text styles. */
const FEATURE_FILE = "features/tiny/index.ts";

/** The level panel the source and reference checks pick. */
const PANEL_KEY = "levelPanel";

/** The Play button of home: the element the style edits change (a width, a justify). */
const PLAY_KEY = "play";

/** What a test puts on the clipboard to prove a pick left it alone. */
const SENTINEL = "e2e sentinel: not a reference";

/** The values of `justify` in the engine, as the select of the Styles section lists them. */
const JUSTIFY_VALUES = ["start", "center", "end", "between", "around", "evenly"];

/**
 * The one-based line of the view module that writes a key, as the project index reports it.
 *
 * @param key - The ui key.
 * @returns The line.
 */
async function viewLine(key: string): Promise<number> {
  const text = await readFile(path.join(gameRoot(), VIEW_FILE), "utf8");
  const line = text.split("\n").findIndex(row => row.includes(`key="${key}"`)) + 1;
  expect(line, `${VIEW_FILE} writes ${key}`).toBeGreaterThan(0);
  return line;
}

/**
 * The one reference line of levelPanel; group 1 is the card it names.
 *
 * @param line - The line of the view module that writes levelPanel.
 * @returns The pattern.
 */
function panelLine(line: number): RegExp {
  return new RegExp(
    String.raw`^@moku levelPanel panel · main\/level · features\/tiny\/view\.tsx:${line} · ref \d+,\d+ \d+×\d+ · (\.moku\/captures\/\d{4}-\d{2}-\d{2}\/levelPanel-f\d+\.md)$`
  );
}

/** The reference block inside a card file: its `text` fence. */
const TEXT_FENCE = /^```text\n([\s\S]*?)\n```$/m;

/**
 * The reference block in the card a reference line names.
 *
 * @param line - The clipboard line.
 * @param pattern - The pattern of the line; group 1 is the card.
 * @returns The block.
 */
async function cardBlock(line: string, pattern: RegExp): Promise<string> {
  const card = pattern.exec(line)?.[1] ?? "";
  expect(card, line).not.toBe("");
  const text = await readFile(path.join(gameRoot(), card), "utf8");
  return TEXT_FENCE.exec(text)?.[1] ?? "";
}

/** A rect in px. */
type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/** A client point. */
type Point = { readonly x: number; readonly y: number };

/** One ripple the recorder saw: its centre in client px and its kind. */
type Ripple = { readonly x: number; readonly y: number; readonly kind: string };

/** Game-frame warnings a reload provokes while the engine loads the bundle: not editor defects. */
const RELOAD_WARNINGS: readonly RegExp[] = [
  /event: assets: texture is not loaded yet/,
  /event: renderer: no texture for asset key/,
  /event: assets: the node waited for a bundle/
];

/** The pixi warning a device change provokes in the game frame: not an editor defect. */
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
 * @param id - The source id, e.g. "game.locate".
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
 * The game position path, e.g. "home" or "level".
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
    .poll(async () => (await readSource<Rect | null>(page, "game.locate", { key })) !== null)
    .toBe(true);
  return readSource<Rect>(page, "game.locate", { key });
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
            // One read: the label goes while the pointer is over no element, and a count then a
            // textContent would wait for it to come back.
            const text = await hover.evaluateAll(labels => labels[0]?.textContent ?? "");
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
 * The capture card of the Game workspace: what a pick, a shot or a series leaves bottom right.
 *
 * @param page - The test page.
 * @returns The locator.
 */
function captureCard(page: Page): Locator {
  return page.locator("[data-game=card]");
}

/**
 * The clipboard text of the tools page.
 *
 * @param page - The test page.
 * @returns The text.
 */
async function clipboardText(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

/**
 * Sets "Copy reference on select" with its control: the Copy Ref switch of the Game toolbar,
 * beside Safe area and Sound (D-72).
 *
 * @param page - The test page.
 * @param on - The wanted state.
 */
async function setCopyOnSelect(page: Page, on: boolean): Promise<void> {
  const toggle = game(page)
    .locator("[data-game=toolbar]")
    .getByRole("switch", { name: "Copy Ref", exact: true });
  await expect(toggle).toHaveAttribute("data-part", "copy-on-select");
  await expect(toggle).toHaveAttribute(
    "title",
    "On: a pick writes the reference and copies its line. Off: a pick only selects the element"
  );
  await expect(toggle).toHaveAttribute("aria-checked", String(!on));
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", String(on));
}

/**
 * The files under the captures folder of the worker's game root, relative to it and sorted; none
 * while the folder does not exist.
 *
 * @returns E.g. `["2026-10-11/homeLogo-f212-crop.jpg", "2026-10-11/homeLogo-f212.md"]`.
 */
async function captureFiles(): Promise<string[]> {
  const folder = path.join(gameRoot(), ".moku", "captures");
  try {
    const entries = await readdir(folder, { recursive: true, withFileTypes: true });
    return entries
      .filter(entry => entry.isFile())
      .map(entry => path.relative(folder, path.join(entry.parentPath, entry.name)))
      .map(file => file.split(path.sep).join("/"))
      .toSorted();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * A field of the Styles section of the Element tab.
 *
 * @param page - The test page.
 * @param path - The style path, e.g. "width" or "padding.top".
 * @returns The field: its control, its struck scene value and its reset button are inside.
 */
function styleField(page: Page, path: string): Locator {
  return elementTab(page).locator(`[data-part=style] [data-part=field][data-path="${path}"]`);
}

/**
 * The bar of the pending edits under the Styles rows.
 *
 * @param page - The test page.
 * @returns The locator.
 */
function editsBar(page: Page): Locator {
  return elementTab(page).locator("[data-part=style] [data-part=edits]");
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
  await rm(path.join(gameRoot(), ".moku", "captures"), { recursive: true, force: true });
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
    await expect.poll(() => gamePath(page)).toBe("level");
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

test.describe("pane · element picker", () => {
  test("Select is an icon button, lit from the click until the pick ends, Esc or a second click", async ({
    tools
  }) => {
    const page = tools.page;
    await showGame(tools);
    await expect.poll(() => gamePath(page)).toBe("home");
    const select = bar(page, "pick");

    // An icon button: the pointer icon, the label only as the accessible name, 28 px square.
    await expect(select).toHaveAccessibleName("Select element");
    await expect(select).toHaveAttribute("title", "Select element ⇧⌘C");
    await expect(select.locator("[data-part=tool-icon]")).toBeVisible();
    await expect(select.locator("[data-sr-only]")).toHaveText("Select element");
    const size = await select.boundingBox();
    expect([size?.width, size?.height], "a square of the toolbar height").toEqual([28, 28]);
    const hidden = await select.locator("[data-sr-only]").boundingBox();
    expect(hidden?.width ?? 0, "the label takes no room").toBeLessThanOrEqual(1);

    // Dark, lit by a click, dark again after Esc.
    await expect(select).toHaveAttribute("aria-pressed", "false");
    const dark = await select.evaluate(element => getComputedStyle(element).backgroundColor);
    await select.click();
    await expect(select).toHaveAttribute("aria-pressed", "true");
    await expect(overlay(page).locator("[data-part=picker]")).toBeVisible();
    await expect
      .poll(() => select.evaluate(element => getComputedStyle(element).backgroundColor))
      .not.toBe(dark);
    await page.keyboard.press("Escape");
    await expect(select).toHaveAttribute("aria-pressed", "false");
    await expect(overlay(page).locator("[data-part=picker]")).toHaveCount(0);

    // A second click turns it off as well.
    await select.click();
    await expect(select).toHaveAttribute("aria-pressed", "true");
    await select.click();
    await expect(select).toHaveAttribute("aria-pressed", "false");

    // The key I lights it too; the pick puts it out (pickIn waits for that) and the game got no
    // tap from the picking click.
    await page.keyboard.press("i");
    await expect(select).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(select).toHaveAttribute("aria-pressed", "false");
    await pickIn(page, await toClient(page, await gameRect(page, PLAY_KEY)), /^play · /);
    await expect(select).toHaveAttribute("aria-pressed", "false");
    await expect(captureCard(page)).toBeVisible();
    expect(await gamePath(page)).toBe("home");

    // No Reference mode: no proxy over the game, and the game takes a tap again.
    await expect(page.locator("[data-moku-proxy]")).toHaveCount(0);
    await expect(page.locator("[data-frame-box]")).not.toHaveAttribute("data-reference");
    await page.keyboard.press("Escape");
    await expect(captureCard(page)).toHaveCount(0);
    await shutDrawer(page, "game.side");
    await tapGame(page, PLAY_KEY);
    await expect.poll(() => gamePath(page)).toBe("level");
  });

  test("Copy Ref off: a pick only selects the element and an area drag picks nothing, no file, no card, no clipboard; Copy reference still writes and copies; on: the pick copies its @moku line", async ({
    tools
  }) => {
    const page = tools.page;
    await showGame(tools);
    await expect.poll(() => gamePath(page)).toBe("home");
    const copied = page.locator("[data-ui=toasts] [data-toast]").filter({ hasText: "copied" });
    const logo = async (): Promise<Rect> => toClient(page, await settledRect(page, "homeLogo"));
    const name = elementTab(page).locator("[data-part=name]");

    // Off, with the Copy Ref switch of the Game toolbar.
    await setCopyOnSelect(page, false);
    await page.evaluate(text => navigator.clipboard.writeText(text), SENTINEL);
    // The folder may hold files of an earlier spec of this worker: only new ones count.
    const before = await captureFiles();
    const added = async (): Promise<string[]> => {
      const files = await captureFiles();
      return files.filter(file => !before.includes(file));
    };

    // A pick only selects: the Element tab shows the element. No capture card, no file under the
    // captures folder, no clipboard, no toast.
    await pickIn(page, await logo(), /^homeLogo · /);
    await expandSide(page, "game.side");
    await expect(name).toHaveText("homeLogo");
    await page.waitForTimeout(1000);
    await expect(captureCard(page)).toHaveCount(0);
    expect(await captureFiles(), "no file written by a pick").toEqual(before);
    expect(await clipboardText(page)).toBe(SENTINEL);
    await expect(copied).toHaveCount(0);

    // An area drag over the logo picks nothing: the marquee goes, nothing is written, the
    // selection stays and Select stays on for a click.
    await shutDrawer(page, "game.side");
    const area = await logo();
    await pickerOn(page);
    await page.mouse.move(area.x - 6, area.y - 6);
    await page.mouse.down();
    await page.mouse.move(area.x + area.w + 6, area.y + area.h + 6, { steps: 6 });
    await expect(page.locator("[data-box=area]")).toBeVisible();
    await page.mouse.up();
    await expect(page.locator("[data-box=area]")).toHaveCount(0);
    await page.waitForTimeout(1000);
    await expect(captureCard(page)).toHaveCount(0);
    expect(await captureFiles(), "no file written by an area drag").toEqual(before);
    expect(await clipboardText(page)).toBe(SENTINEL);
    await expect(copied).toHaveCount(0);
    await expect(bar(page, "pick")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(bar(page, "pick")).toHaveAttribute("aria-pressed", "false");
    await expandSide(page, "game.side");
    await expect(name).toHaveText("homeLogo");

    // Copy reference of the Element tab makes the reference on demand: the card and its line.
    await elementTab(page).locator("[data-action=copy-reference]").click();
    await expect.poll(() => clipboardText(page)).toMatch(/^@moku homeLogo /);
    await expect
      .poll(added)
      .toEqual([expect.stringMatching(/^\d{4}-\d{2}-\d{2}\/homeLogo-f\d+\.md$/)]);
    await expect(captureCard(page)).toHaveCount(0);

    // On again: the pick writes its pictures and its card, shows the capture card and puts its
    // line on the clipboard, with the toast.
    await shutDrawer(page, "game.side");
    await setCopyOnSelect(page, true);
    await page.evaluate(text => navigator.clipboard.writeText(text), SENTINEL);
    await pickIn(page, await logo(), /^homeLogo · /);
    await expect.poll(() => clipboardText(page)).toMatch(/^@moku homeLogo /);
    await expect(copied.last()).toBeVisible();
    await expect(captureCard(page)).toBeVisible();
    await expect(captureCard(page).locator("[data-part=path]")).toHaveAttribute(
      "title",
      /\/homeLogo-f\d+/
    );
    const written = await added();
    expect(
      written.some(file => /\/homeLogo-f\d+(-\d+)?-crop\.jpg$/.test(file)),
      `the crop of the pick in ${written.join(", ")}`
    ).toBe(true);
    expect(written.some(file => /\/f\d+(-\d+)?-full\.jpg$/.test(file))).toBe(true);
  });

  test("style edits: a field marks its row, the bar counts, Copy for agent writes the block, Clear drops it; an enum is a select", async ({
    tools
  }) => {
    const page = tools.page;
    const playAt = await viewLine(PLAY_KEY);
    await showGame(tools);
    await expect.poll(() => gamePath(page)).toBe("home");
    const drawn = await settledRect(page, PLAY_KEY);
    await pickIn(page, await toClient(page, drawn), /^play · /);
    await expandSide(page, "game.side");
    const tab = elementTab(page);
    await expect(tab.locator("[data-part=name]")).toHaveText(PLAY_KEY);
    const head = new RegExp(String.raw`^@moku play · features/tiny/view\.tsx:${playAt}$`);

    // The rows are fields; nothing is pending, so there is no bar.
    const width = styleField(page, "width");
    const input = width.locator("input[type=number]");
    await expect(input).toHaveAttribute("step", "1");
    await expect(tab.locator("[data-part=style] [data-edited]")).toHaveCount(0);
    await expect(editsBar(page)).toHaveCount(0);
    const before = Number(await input.inputValue());
    expect(before, "the width the view module writes").toBe(320);
    const after = before + 40;

    // A number field never forces the panel wider (M10): it stays inside the tab.
    const field = await input.boundingBox();
    const panel = await tab.boundingBox();
    expect((field?.x ?? 0) + (field?.width ?? 0), "the field inside the tab").toBeLessThanOrEqual(
      (panel?.x ?? 0) + (panel?.width ?? 0)
    );

    // An edit: the row and the field are marked, the scene value is struck, the bar says 1 edit.
    await input.fill(String(after));
    await input.press("Enter");
    await expect(width).toHaveAttribute("data-edited", "");
    await expect(tab.locator('[data-part=style] [data-row="width"]')).toHaveAttribute(
      "data-edited",
      ""
    );
    await expect(input).toHaveValue(String(after));
    await expect(width.locator("s")).toHaveText(String(before));
    await expect(width.locator("[data-action=reset-edit]")).toHaveAttribute(
      "title",
      `Reset to ${before}`
    );
    await expect(editsBar(page).locator("[data-part=count]")).toHaveText("1 edit");
    // The game is not changed (D-67): the button keeps its rect.
    await page.waitForTimeout(300);
    expect(await gameRect(page, PLAY_KEY)).toEqual(drawn);

    // Copy for agent: the block of the element, its head line first.
    await page.evaluate(text => navigator.clipboard.writeText(text), SENTINEL);
    await editsBar(page).locator("[data-action=copy-edits]").click();
    await expect.poll(() => clipboardText(page)).toMatch(/^@moku /);
    const one = await clipboardText(page);
    const block = one.split("\n");
    expect(block[0], one).toMatch(head);
    expect(block).toContain(`width: ${before} -> ${after}`);
    expect(block).toHaveLength(2);
    await expect(page.locator("[data-ui=toasts] [data-toast]").last()).toHaveText(
      "✓ 1 edit copied"
    );

    // An enum property is a select with the engine's values; its edit is written in quotes.
    const justify = styleField(page, "justify").locator("select");
    await expect(justify).toHaveValue("center");
    await expect(justify.locator("option")).toHaveText(JUSTIFY_VALUES);
    await expect(styleField(page, "align").locator("select")).toHaveValue("center");
    await justify.selectOption("start");
    await expect(styleField(page, "justify")).toHaveAttribute("data-edited", "");
    await expect(editsBar(page).locator("[data-part=count]")).toHaveText("2 edits");
    await editsBar(page).locator("[data-action=copy-edits]").click();
    await expect.poll(() => clipboardText(page)).toContain('justify: "center" -> "start"');
    const two = await clipboardText(page);
    expect(two.split("\n")).toEqual([
      expect.stringMatching(head),
      `width: ${before} -> ${after}`,
      'justify: "center" -> "start"'
    ]);

    // The reset button of a field removes that edit only.
    await styleField(page, "justify").locator("[data-action=reset-edit]").click();
    await expect(styleField(page, "justify")).not.toHaveAttribute("data-edited");
    await expect(justify).toHaveValue("center");
    await expect(editsBar(page).locator("[data-part=count]")).toHaveText("1 edit");

    // Clear drops what is left: no mark, no bar, no struck value. (The field showing the scene
    // value again is in the next test.)
    await editsBar(page).locator("[data-action=clear-edits]").click();
    await expect(editsBar(page)).toHaveCount(0);
    await expect(tab.locator("[data-part=style] [data-edited]")).toHaveCount(0);
    await expect(width.locator("s")).toHaveCount(0);
    await expect(width.locator("[data-action=reset-edit]")).toHaveCount(0);
  });

  // The engine sends the text style key of a text (`UiNode.textStyle`, game 0.14.11). The tab
  // shows the block of that key from the text styles file; an edit there belongs to the key, not
  // to the node, so the agent text names the key and its block (D-73).
  test("text style: a text shows the fields of its style key; an edit is counted and copied as the block of the key", async ({
    tools
  }) => {
    const page = tools.page;
    const feature = await readFile(path.join(gameRoot(), FEATURE_FILE), "utf8");
    const keyAt = feature.split("\n").findIndex(row => row.includes('"tiny.title":')) + 1;
    expect(keyAt, `${FEATURE_FILE} defines tiny.title`).toBeGreaterThan(0);
    await showGame(tools);
    await expect.poll(() => gamePath(page)).toBe("home");
    const drawn = await settledRect(page, "homeLogo");
    await pickIn(page, await toClient(page, drawn), /^homeLogo · /);
    await expandSide(page, "game.side");
    const tab = elementTab(page);
    await expect(tab.locator("[data-part=name]")).toHaveText("homeLogo");

    // The section of the key: its title, where its block is, one row per field of the block.
    const section = tab.locator("section[data-part=text-style]");
    await expect(section.locator("h4")).toHaveText("Text style · tiny.title");
    await expect(section.locator("[data-part=where]")).toHaveText(`${FEATURE_FILE}:${keyAt}`);
    await expect(section.locator("dt")).toHaveText(["font", "size", "fill", "align"]);

    // A number and a quoted string are fields; a colour constant is read-only text.
    const size = section.locator('[data-part=field][data-path="size"]');
    const input = size.locator("input[type=number]");
    await expect(input).toHaveValue("96");
    await expect(section.locator('[data-path="align"] input[type=text]')).toHaveValue("center");
    await expect(section.locator('[data-row="fill"] dd')).toHaveText("white");
    await expect(section.locator('[data-row="fill"] input')).toHaveCount(0);
    await expect(editsBar(page)).toHaveCount(0);

    // An edit: the field and its row are marked, the file value is struck, the bar counts it.
    await input.fill("88");
    await input.press("Enter");
    await expect(size).toHaveAttribute("data-edited", "");
    await expect(section.locator('[data-row="size"]')).toHaveAttribute("data-edited", "");
    await expect(input).toHaveValue("88");
    await expect(size.locator("s")).toHaveText("96");
    await expect(editsBar(page).locator("[data-part=count]")).toHaveText("1 edit");

    // Copy for agent: the block of the style key, at its block in the file.
    await page.evaluate(text => navigator.clipboard.writeText(text), SENTINEL);
    await editsBar(page).locator("[data-action=copy-edits]").click();
    await expect.poll(() => clipboardText(page)).toMatch(/^@moku textStyle tiny\.title /);
    const copied = await clipboardText(page);
    expect(copied.split("\n")).toEqual([
      `@moku textStyle tiny.title · ${FEATURE_FILE}:${keyAt}`,
      "size: 96 -> 88"
    ]);

    // Clear drops it: no mark, no bar.
    await editsBar(page).locator("[data-action=clear-edits]").click();
    await expect(editsBar(page)).toHaveCount(0);
    await expect(section.locator("[data-edited]")).toHaveCount(0);
  });

  // The page loads preact/compat, where `onChange` of a typed input fires on every keystroke. A
  // Styles field commits by its own Enter and blur handlers: typing commits nothing, Esc drops
  // what was typed, an emptied field stays empty, and Clear puts the scene value back.
  test("a Styles field commits on Enter or blur only, and Esc restores the shown value", async ({
    tools
  }) => {
    const page = tools.page;
    await showGame(tools);
    await expect.poll(() => gamePath(page)).toBe("home");
    await pickIn(page, await toClient(page, await settledRect(page, PLAY_KEY)), /^play · /);
    // The capture card of the pick is the first Esc layer: shut it, so Esc reaches the field.
    await expect(captureCard(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(captureCard(page)).toHaveCount(0);
    await expandSide(page, "game.side");
    const input = styleField(page, "width").locator("input[type=number]");
    const before = await input.inputValue();

    // Typing commits nothing; an emptied field stays empty while it has the focus.
    await input.click();
    await input.press("ControlOrMeta+a");
    await input.press("Backspace");
    await expect(input).toHaveValue("");
    await input.pressSequentially("999");
    await expect(input).toHaveValue("999");
    await expect(editsBar(page)).toHaveCount(0);

    // Esc drops what was typed: the scene value is back and nothing is pending, after a blur too.
    await input.press("Escape");
    await expect(input).toHaveValue(before);
    await expect(editsBar(page)).toHaveCount(0);
    await elementTab(page).locator("[data-part=name]").click();
    await expect(editsBar(page)).toHaveCount(0);
    await expect(elementTab(page).locator("[data-part=name]")).toHaveText(PLAY_KEY);

    // Enter commits.
    await input.fill("999");
    await expect(editsBar(page)).toHaveCount(0);
    await input.press("Enter");
    await expect(editsBar(page).locator("[data-part=count]")).toHaveText("1 edit");

    // Clear puts the scene value back in the field.
    await editsBar(page).locator("[data-action=clear-edits]").click();
    await expect(editsBar(page)).toHaveCount(0);
    await expect(input).toHaveValue(before);

    // A blur commits too, and Clear resets the field again.
    await input.fill("998");
    await expect(editsBar(page)).toHaveCount(0);
    await elementTab(page).locator("[data-part=name]").click();
    await expect(editsBar(page).locator("[data-part=count]")).toHaveText("1 edit");
    await expect(input).toHaveValue("998");
    await editsBar(page).locator("[data-action=clear-edits]").click();
    await expect(editsBar(page)).toHaveCount(0);
    await expect(input).toHaveValue(before);
  });

  test("levelPanel: the frame matches game.locate, the source is found, Copy reference carries the bounds", async ({
    tools
  }) => {
    const page = tools.page;
    const panelAt = await viewLine(PANEL_KEY);
    const pattern = panelLine(panelAt);
    await showGame(tools);
    await expect.poll(() => gamePath(page)).toBe("home");
    // Play leads to the level, whose panel holds the title and the score.
    await answer(page, "play");
    await expect.poll(() => gamePath(page)).toBe("level");
    const panel = await settledRect(page, PANEL_KEY);

    // Pick the panel itself, where no child of it is drawn over the point.
    await pickIn(page, await toClient(page, panel), /^levelPanel · /);
    await expect(page.locator("[data-ui=toasts] [data-toast]").last()).toHaveText(
      "Reference, shot and bookmark copied"
    );
    const picked = await page.evaluate(() => navigator.clipboard.readText());
    await expandSide(page, "game.side");
    const tab = elementTab(page);
    await expect(tab.locator("[data-part=name]")).toHaveText(PANEL_KEY);

    // The selected frame and the bounds are the element's real rect (2 px).
    const expected = [panel.x, panel.y, panel.w, panel.h];
    await expect.poll(async () => near(await tabBounds(page), expected, 2)).toBe(true);
    const client = await toClient(page, panel);
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

    // The source: "Defined at …view.tsx:<line>", or the style card of its style.
    const source = tab.locator("[data-part=style-card]");
    await expect(source).not.toContainText("Searching the sources", { timeout: 20_000 });
    await expect(source).not.toContainText("Source not found");
    await ((await source.locator("[data-part=defined]").count()) > 0
      ? expect(source.locator("[data-part=defined] [data-part=where]")).toHaveText(
          new RegExp(String.raw`features/tiny/view\.tsx:${panelAt}$`)
        )
      : expect(source.locator("[data-part=where]").first()).toHaveText(/\.tsx?:\d+$/));

    // The Element tab holds no reference text and no "Pick another": its footer is Copy
    // reference, then Show in render tree.
    await expect(tab.locator("[data-part=reference-block]")).toHaveCount(0);
    await expect(tab.locator("pre[data-part=reference]")).toHaveCount(0);
    await expect(tab.getByRole("button", { name: "Pick another" })).toHaveCount(0);
    await expect(tab.locator("footer button")).toHaveText([
      "Copy reference",
      "Show in render tree"
    ]);
    const bounds = await tabBounds(page);

    // Copy reference writes the card again and copies its one line, the pick's line (the same
    // node and frame name the same card); the card holds eleven lines in a fixed order.
    await page.evaluate(() => navigator.clipboard.writeText(""));
    await tab.locator("[data-action=copy-reference]").click();
    await expect(page.locator("[data-ui=toasts] [data-toast]").last()).toHaveText(
      "✓ Reference copied"
    );
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(pattern);
    const line = await page.evaluate(() => navigator.clipboard.readText());
    expect(line).toBe(picked);
    const block = await cardBlock(line, pattern);
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
    expect(head, block).toMatch(/^@moku levelPanel · panel · main\/level · f\d+$/);
    expect(sourceLine, block).toMatch(
      new RegExp(String.raw`^source: features/tiny/view\.tsx:${panelAt}\b`)
    );
    // The bounds: device px as the Element tab shows them, then the reference units.
    const [x, y, w, h] = bounds;
    expect(boundsLine, block).toMatch(
      new RegExp(String.raw`^bounds: ${x},${y} ${w}×${h} px · ref \d+,\d+ \d+×\d+$`)
    );
    expect(flowLine, block).toMatch(/^flow: level( · last: .+)?$/);
    expect(lines[9], block).toMatch(/^restore: bookmark levelPanel-f\d+$/);
    expect(lines[10], block).toMatch(
      /^shot: \.moku\/captures\/\d{4}-\d{2}-\d{2}\/levelPanel-f\d+-crop\.jpg · frame: \.moku\/captures\/\d{4}-\d{2}-\d{2}\/f\d+-full\.jpg$/
    );
  });
});

test.describe("pane · element bounds", () => {
  test("homeBackground fills the Pixel 8 screen after a reload and after a device change", async ({
    tools,
    errors
  }) => {
    errors.allow(PIXI_RESIZE);
    for (const pattern of RELOAD_WARNINGS) errors.allow(pattern);
    const page = tools.page;
    await showGame(tools);
    await bar(page, "device").selectOption("pixel-8");
    await expect.poll(() => gameFrame(page).evaluate(() => innerWidth)).toBe(412);

    // The Reload of the toolbar boots the game page again, on home.
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
    await clickCard(page, "main/level");
    await expect(card(page, "main/level")).toHaveAttribute("aria-pressed", "true");
    await expandSide(page, "flow.inspector");
    await recordPulses(page);

    const row = inspector(page).locator("[data-part=comes-from] li").first();
    await expect(row).toContainText("main/home");
    await row.getByRole("button").click();
    await expect(card(page, "main/home")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => pulses(page)).toContain("main/home");
    // The camera frames both ends of the edge.
    await expect
      .poll(async () => (await insideCanvas(page, "main/home")) && insideCanvas(page, "main/level"))
      .toBe(true);

    const back = inspector(page).locator("[data-action=back]");
    await expect(back).toBeVisible();
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(card(page, "main/level")).toHaveAttribute("aria-pressed", "true");
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

  test("the inspector has the Info and Code tabs only; the palette has no Styles group", async ({
    tools
  }) => {
    const page = tools.page;
    await showFlow(tools);
    await clickCard(page, "main/home");
    await expandSide(page, "flow.inspector");
    await expect(inspector(page).getByRole("tab")).toHaveText(["Info", "Code"]);
    await expect(inspector(page).locator("[data-flow=styles-tab]")).toHaveCount(0);
    for (const name of ["Info", "Code"]) {
      await inspector(page).getByRole("tab", { name, exact: true }).click();
      await expect(inspector(page).getByRole("tab", { name, exact: true })).toHaveAttribute(
        "aria-selected",
        "true"
      );
    }

    // The palette lists no text style: neither without a query nor for a style key.
    const palette = page.locator("dialog[data-ui=palette]");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette).toBeVisible();
    await expect(palette.locator("fieldset").first()).toBeVisible();
    await expect(palette.locator('fieldset[aria-label^="Styles"]')).toHaveCount(0);
    await palette.getByRole("combobox", { name: "Search" }).fill("tiny.title");
    await expect(palette.locator('fieldset[aria-label^="Styles"]')).toHaveCount(0);
    await expect(palette.getByRole("option", { name: /^tiny\.title/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
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

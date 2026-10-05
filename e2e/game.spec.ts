/**
 * @file The Game workspace (spec 13-gameView) in a real browser, on the frozen merge-game: the
 * device toolbar (the twenty-one presets in their groups, Fold / Unfold of the Galaxy Z Fold 6 and
 * the iPhone Duo, orientation, Fit with one scale for every phone and 100 %, safe-area bands, the
 * Sound switch that needs `game.mute`, Reload), the dark-theme bezel and the rounded screen, the
 * iPhone SE 3 home-button frame, the fresh viewer on the iPhone 18 Pro (round 2b R9-R11), the Shot
 * with its JPEG on disk (D-34) and the compact capture card (R14), the Series popover, the recording view, Stop, the
 * files of a series and the contact sheet with stepping and Mark as bug, the element picker on the
 * game's real geometry (hover ring, click, Element tab, its Code section of R12, Show in render
 * tree, Esc), the Device tab,
 * the style stepper that writes the source, which the game hot swaps in place (game 0.5.0, U10),
 * the Overlay in game switch of the top bar (round 2 R1: the toolbar lost its own), and
 * driving the game itself: pause, step, resume, palette commands and real taps on the game canvas
 * whose effect shows in State. The Element and Device tabs live in the Element panel, a side
 * panel that floats as a drawer below 600 px and starts collapsed there: a test opens it before it
 * looks at or works in a tab. A pick also bookmarks the game, saves two JPEGs and copies the
 * reference line (round 2 R2): e2e/pick.spec.ts covers that.
 *
 * Geometry is the browser's: the iframe box, the overlay boxes and `game.locate` of the game page
 * are compared in client px. Every write lands in dist-e2e/game (the copy the bin serves); the
 * tests remove or restore what they wrote, so a second run starts from the same files. The specs
 * written for the iPhone 15 pin it (e2e/fixtures.ts `pinnedDevice`); the tests of the new default
 * opt out.
 */
import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Frame, Locator, Page } from "@playwright/test";
import { expect, type Tools, test } from "./fixtures";
import { jpegSize, pngSize } from "./pictures";
import { barChecked, flipBarToggle, showPreview } from "./top-bar";

/** The project root the bin serves. */
const GAME_ROOT = fileURLToPath(new URL("../dist-e2e/game/", import.meta.url));

/** The captures folder of gameView, relative to the game root. */
const CAPTURES_DIR = ".moku/captures";

/** A day folder in the captures folder: `yyyy-mm-dd` (captures by day). */
const DAY_FOLDER = /^\d{4}-\d{2}-\d{2}$/;

/** The source file of the home screen styles (the Play button's style block). */
const HOME_STYLES = "features/home/styles.ts";

/** Game-frame warnings a reload provokes that are not editor defects (see flow.spec.ts). */
const RELOAD_WARNINGS: readonly RegExp[] = [
  /event: assets: texture is not loaded yet/,
  /event: renderer: no texture for asset key/,
  /event: assets: the node waited for a bundle/
];

/**
 * The game frame's renderer warning when the viewport resizes (a device or orientation change):
 * pixi destroys nine-slice textures that a shader still binds. A game-side warning, not an editor
 * defect: the game page logs it on any window resize.
 */
const PIXI_RESIZE = /PixiJS Warning: +\[BindGroup\] a 'texture(Source|Sampler)' was destroyed/;

/** A rect in px. */
type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/** One device preset as the toolbar and the Device tab show it. */
type Preset = {
  readonly id: string;
  readonly name: string;
  readonly group: string;
  readonly w: number;
  readonly h: number;
  readonly top: number;
  readonly bottom: number;
  readonly kind: "phone" | "tablet" | "desktop";
  readonly approx?: true;
};

/**
 * One row of the preset table: id, name, group, portrait W × H (a foldable's cover screen), safe
 * top and bottom, kind, and whether the values are estimates.
 */
type PresetRow = readonly [
  id: string,
  name: string,
  group: string,
  w: number,
  h: number,
  top: number,
  bottom: number,
  kind: Preset["kind"],
  approx?: true
];

/**
 * The twenty-one device presets (round 2 R4, round 2b R10) in display order. In the iPhone group
 * the SE 3 and the iPhone 15 come first, then the current models; the 15 Pro Max, 16 Pro and
 * 16 Pro Max stay at the end. Android, foldable and tablet browsers report no safe insets.
 */
const PRESET_ROWS: readonly PresetRow[] = [
  ["iphone-se", "iPhone SE 3 · small, 2022", "iPhone", 375, 667, 20, 0, "phone"],
  ["iphone-15", "iPhone 15", "iPhone", 393, 852, 59, 34, "phone"],
  ["iphone-17e", "iPhone 17e", "iPhone", 390, 844, 47, 34, "phone", true],
  ["iphone-air", "iPhone Air", "iPhone", 420, 912, 68, 34, "phone", true],
  ["iphone-18-pro", "iPhone 18 Pro", "iPhone", 402, 874, 62, 34, "phone", true],
  ["iphone-18-pro-max", "iPhone 18 Pro Max", "iPhone", 440, 956, 62, 34, "phone", true],
  ["iphone-15-pro-max", "iPhone 15 Pro Max", "iPhone", 430, 932, 59, 34, "phone"],
  ["iphone-16-pro", "iPhone 16 Pro", "iPhone", 402, 874, 62, 34, "phone"],
  ["iphone-16-pro-max", "iPhone 16 Pro Max", "iPhone", 440, 956, 62, 34, "phone"],
  ["galaxy-s24", "Galaxy S24", "Android", 360, 780, 0, 0, "phone"],
  ["galaxy-a55", "Galaxy A55", "Android", 412, 892, 0, 0, "phone"],
  ["redmi-note-13", "Redmi Note 13", "Android", 393, 873, 0, 0, "phone", true],
  ["pixel-8", "Pixel 8", "Android", 412, 915, 0, 0, "phone"],
  ["xperia-1-v", "Xperia 1 V 21:9", "Android", 411, 960, 0, 0, "phone"],
  ["galaxy-z-fold-6", "Galaxy Z Fold 6", "Foldable", 369, 905, 0, 0, "phone", true],
  ["galaxy-z-flip-6", "Galaxy Z Flip 6", "Foldable", 412, 1005, 0, 0, "phone"],
  ["pixel-9-pro-fold", "Pixel 9 Pro Fold", "Foldable", 411, 923, 0, 0, "phone", true],
  ["iphone-duo", "iPhone Duo", "Foldable", 466, 678, 0, 0, "phone", true],
  ["ipad-mini", "iPad mini 7", "Tablet", 744, 1133, 0, 0, "tablet"],
  ["ipad-air-11", 'iPad Air 11"', "Tablet", 820, 1180, 0, 0, "tablet"],
  ["desktop", "Desktop", "Desktop", 1440, 900, 0, 0, "desktop"]
];

/** The presets of the table as objects. */
const PRESETS: readonly Preset[] = PRESET_ROWS.map(
  ([id, name, group, w, h, top, bottom, kind, approx]) => ({
    id,
    name,
    group,
    w,
    h,
    top,
    bottom,
    kind,
    ...(approx === true ? { approx } : {})
  })
);

/** The bezel of a modern phone on each side, in stage px (it does not scale with the screen). */
const MODERN_BEZEL = 10;

/** The bezel above and below the iPhone SE 3 screen (home-button frame), in stage px. */
const HOME_BUTTON_BEZEL = 64;

/** The `<optgroup>` labels of the device select, in display order. */
const GROUPS = ["iPhone", "Android", "Foldable", "Tablet", "Desktop"] as const;

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
 * The game iframe element on the tools page.
 *
 * @param page - The test page.
 * @returns The locator.
 */
function iframe(page: Page): Locator {
  return page.locator("iframe").first();
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
 * The page rect of a keyed game element, in game CSS px.
 *
 * @param page - The test page.
 * @param key - The ui key.
 * @returns The rect.
 */
async function gameRect(page: Page, key: string): Promise<Rect> {
  return readSource<Rect>(page, "game.locate", { key });
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
 * Maps a game page rect to client px through the iframe box (the frame is scaled to fit).
 *
 * @param page - The test page.
 * @param rect - A rect in game CSS px.
 * @returns The rect in client px.
 */
async function toClient(page: Page, rect: Rect): Promise<Rect> {
  const box = await iframe(page).boundingBox();
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
 * Expects two client rects to match within a pixel.
 *
 * @param actual - The measured box.
 * @param expected - The expected rect.
 */
function expectNear(
  actual: { x: number; y: number; width: number; height: number } | null,
  expected: Rect
): void {
  expect(actual).not.toBeNull();
  if (actual === null) return;
  expect(Math.abs(actual.x - expected.x)).toBeLessThan(1.5);
  expect(Math.abs(actual.y - expected.y)).toBeLessThan(1.5);
  expect(Math.abs(actual.width - expected.w)).toBeLessThan(1.5);
  expect(Math.abs(actual.height - expected.h)).toBeLessThan(1.5);
}

/**
 * The centre of a client rect.
 *
 * @param rect - The rect.
 * @returns The point.
 */
function centre(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/**
 * Taps a keyed game element with the real mouse, on the game canvas.
 *
 * @param page - The test page.
 * @param key - The ui key.
 */
async function tapGame(page: Page, key: string): Promise<void> {
  const at = centre(await toClient(page, await gameRect(page, key)));
  await page.mouse.click(at.x, at.y);
}

/**
 * Shows Game and waits for the stage to dock the frame.
 *
 * @param tools - The driver.
 */
async function showGame(tools: Tools): Promise<void> {
  await tools.show("game");
  await expect(game(tools.page).locator("[data-game=stage]")).toBeVisible();
  await expect(overlay(tools.page)).toBeAttached();
  await expect
    .poll(async () => {
      const slot = await game(tools.page).locator("[data-part=slot]").boundingBox();
      const frame = await iframe(tools.page).boundingBox();
      return slot !== null && frame !== null && Math.abs(slot.x - frame.x) < 1;
    })
    .toBe(true);
}

/**
 * Walks from home onto the board with a real tap on Play.
 *
 * @param page - The test page.
 */
async function toBoard(page: Page): Promise<void> {
  await expect.poll(() => gamePath(page)).toBe("home");
  await tapGame(page, "play");
  await expect.poll(() => gamePath(page)).toBe("board/awaitIntent");
}

/**
 * The newest toast.
 *
 * @param page - The test page.
 * @returns The locator.
 */
function toast(page: Page): Locator {
  return page.locator("[data-ui=toasts] [data-toast]").last();
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

/**
 * Lists the files of a folder of the game root.
 *
 * @param folder - The folder, relative to the root.
 * @returns The names, empty when missing.
 */
async function list(folder: string): Promise<string[]> {
  const names = await readdir(path.join(GAME_ROOT, folder)).catch(() => []);
  return names.toSorted();
}

/**
 * Escapes a text for use inside a RegExp.
 *
 * @param text - The literal text.
 * @returns The escaped pattern.
 */
function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\/]/g, String.raw`\$&`);
}

/**
 * Everything gameView wrote into the day folders of the captures folder (captures by day).
 *
 * @returns The `<yyyy-mm-dd>/<name>` paths, relative to the captures folder, sorted.
 */
async function captured(): Promise<string[]> {
  const top = await list(CAPTURES_DIR);
  const days = top.filter(name => DAY_FOLDER.test(name));
  const names = await Promise.all(
    days.map(async day => {
      const inside = await list(`${CAPTURES_DIR}/${day}`);
      return inside.map(name => `${day}/${name}`);
    })
  );
  return names.flat().toSorted();
}

/**
 * A capture path relative to the captures folder.
 *
 * @param capture - The path relative to the game root.
 * @returns The `<yyyy-mm-dd>/<name>` part.
 */
function inCaptures(capture: string): string {
  return capture.slice(CAPTURES_DIR.length + 1);
}

/**
 * The series folders in the day folders of the captures folder.
 *
 * @returns The `<yyyy-mm-dd>/series-<hhmm>` folders, sorted.
 */
async function seriesFolders(): Promise<string[]> {
  const names = await captured();
  return names.filter(name => name.split("/")[1]?.startsWith("series-"));
}

/**
 * The rendered width of a locator, 0 while it has no box.
 *
 * @param locator - The element.
 * @returns The width in px.
 */
async function widthOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  return box?.width ?? 0;
}

/**
 * The rendered height of a locator, 0 while it has no box.
 *
 * @param locator - The element.
 * @returns The height in px.
 */
async function heightOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  return box?.height ?? 0;
}

/**
 * Reads a file of the game root.
 *
 * @param file - The path relative to the root.
 * @returns The text, undefined when missing.
 */
async function readGameFile(file: string): Promise<string | undefined> {
  const full = path.join(GAME_ROOT, file);
  return existsSync(full) ? readFile(full, "utf8") : undefined;
}

/**
 * Starts recording every toast the tools page shows, in order, with the ms since the start. A
 * toast can be followed by the next one faster than a locator poll (the style stepper's "✓ Saved"
 * and the reload toast after it), so a test reads the history instead of the last toast.
 *
 * @param page - The test page.
 */
async function recordToasts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const start = performance.now();
    // Toasts already shown (a pick's) are not part of the history.
    const seen = new WeakSet<Element>(document.querySelectorAll("[data-ui=toasts] [data-toast]"));
    const history: string[] = [];
    Reflect.set(globalThis, "__e2eToasts", history);
    const scan = (): void => {
      for (const toast of document.querySelectorAll("[data-ui=toasts] [data-toast]")) {
        if (seen.has(toast)) continue;
        seen.add(toast);
        history.push(`${Math.round(performance.now() - start)} ${toast.textContent ?? ""}`);
      }
    };
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  });
}

/**
 * The toasts shown since `recordToasts`, oldest first, without the timestamps.
 *
 * @param page - The test page.
 * @returns The toast texts.
 */
async function toastHistory(page: Page): Promise<string[]> {
  const history = await page.evaluate(() => [...(Reflect.get(globalThis, "__e2eToasts") ?? [])]);
  return history.map(entry => String(entry).replace(/^\d+ /, ""));
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

/**
 * Turns the picker on and waits for the scene (calibrated, from the watches).
 *
 * @param page - The test page.
 */
async function pickerOn(page: Page): Promise<void> {
  await bar(page, "pick").click();
  await expect(bar(page, "pick")).toHaveAttribute("aria-pressed", "true");
  await expect(game(page).locator("[data-part=hint]")).toHaveText(
    "Hover the game, click to select · Esc"
  );
  await expect(overlay(page).locator("[data-part=picker]")).toBeVisible();
}

/**
 * Hovers a client point until the picker label matches.
 *
 * @param page - The test page.
 * @param at - The point.
 * @param at.x - Client x.
 * @param at.y - Client y.
 * @param label - The expected label.
 */
async function hoverUntil(page: Page, at: { x: number; y: number }, label: RegExp): Promise<void> {
  await expect
    .poll(async () => {
      await page.mouse.move(at.x + 1, at.y);
      await page.mouse.move(at.x, at.y);
      return (await overlay(page).locator("[data-part=label]").textContent()) ?? "";
    })
    .toMatch(label);
}

/**
 * Finds a point of a client rect where the picker label matches: a grid scan, as a user moves the
 * pointer over a button until its own ring shows (decorations and the label lie inside it).
 *
 * @param page - The test page.
 * @param rect - The client rect to scan.
 * @param label - The expected label.
 * @returns The point.
 */
async function hoverFind(page: Page, rect: Rect, label: RegExp): Promise<{ x: number; y: number }> {
  await expect(overlay(page).locator("[data-part=picker]")).toBeVisible();
  let found: { x: number; y: number } | undefined;
  await expect
    .poll(async () => {
      for (const fy of [0.5, 0.25, 0.75]) {
        for (const fx of [0.3, 0.2, 0.7, 0.8, 0.5]) {
          const at = { x: rect.x + rect.w * fx, y: rect.y + rect.h * fy };
          await page.mouse.move(at.x, at.y);
          const text = (await overlay(page).locator("[data-part=label]").textContent()) ?? "";
          if (label.test(text)) {
            found = at;
            return text;
          }
        }
      }
      return "";
    })
    .toMatch(label);
  if (found === undefined) throw new Error("no point");
  return found;
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
 * Shows the Element panel's content: below 600 px it is a drawer that starts collapsed, so its
 * rail button opens it; docked it already shows.
 *
 * @param page - The test page.
 */
async function openSide(page: Page): Promise<void> {
  const panel = game(page).locator('aside[data-side-panel="game.side"]');
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
 * Removes every capture of this run.
 */
async function clearCaptures(): Promise<void> {
  await rm(path.join(GAME_ROOT, CAPTURES_DIR), {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100
  });
}

test.beforeEach(async () => {
  await clearCaptures();
});

test.afterEach(async () => {
  await clearCaptures();
});

test.describe("game · device toolbar", () => {
  test("every preset sizes the stage, the frame and the game viewport; the Device tab follows", async ({
    tools,
    errors
  }) => {
    errors.allow(PIXI_RESIZE);
    const page = tools.page;
    await showGame(tools);
    const select = bar(page, "device");
    await expect(select).toHaveValue("iphone-15");
    await expect(select.locator("option")).toHaveText(PRESETS.map(preset => preset.name));
    // One <optgroup> per group, each holding its presets; an estimated preset says so.
    expect(
      await select
        .locator("optgroup")
        .evaluateAll(groups => groups.map(group => group.getAttribute("label")))
    ).toEqual([...GROUPS]);
    for (const group of GROUPS) {
      await expect(select.locator(`optgroup[label="${group}"] option`)).toHaveText(
        PRESETS.filter(preset => preset.group === group).map(preset => preset.name)
      );
    }
    for (const preset of PRESETS) {
      await expect(select.locator(`option[value="${preset.id}"]`)).toHaveAttribute(
        "title",
        preset.approx === true ? /· approx: estimated values$/ : /^\d+×\d+ · dpr [\d.]+$/
      );
    }

    for (const preset of PRESETS) {
      await select.selectOption(preset.id);
      await expect(bar(page, "size")).toHaveText(`${preset.w} × ${preset.h}`);
      const bezel = game(page).locator("[data-part=bezel]");
      await expect(bezel).toHaveAttribute("data-kind", preset.kind);
      // The game page sees the device width; the slot keeps the device aspect.
      await expect.poll(() => gameFrame(page).evaluate(() => innerWidth)).toBe(preset.w);
      await expect.poll(() => gameFrame(page).evaluate(() => innerHeight)).toBe(preset.h);
      await expect
        .poll(async () => {
          const slot = await game(page).locator("[data-part=slot]").boundingBox();
          return slot === null ? 0 : Math.round((slot.width / slot.height) * 100);
        })
        .toBe(Math.round((preset.w / preset.h) * 100));
      await expect
        .poll(async () => {
          const slot = await game(page).locator("[data-part=slot]").boundingBox();
          const frame = await iframe(page).boundingBox();
          if (slot === null || frame === null) return false;
          return Math.abs(slot.width - frame.width) < 1 && Math.abs(slot.x - frame.x) < 1;
        })
        .toBe(true);
    }

    await openSide(page);
    await game(page).getByRole("tab", { name: "Device" }).click();
    const devices = game(page).locator("[data-part=devices] button");
    await expect(devices).toHaveCount(PRESETS.length);
    await expect(devices.filter({ hasText: "Desktop" })).toHaveAttribute("aria-pressed", "true");
    for (const [index, preset] of PRESETS.entries()) {
      await expect(devices.nth(index)).toContainText(preset.name);
      await expect(devices.nth(index)).toContainText(`${preset.w}×${preset.h}`);
      await expect(devices.nth(index)).toContainText(
        `safe top ${preset.top} · bottom ${preset.bottom}`
      );
    }
    await devices.filter({ hasText: "iPad mini 7" }).click();
    await expect(select).toHaveValue("ipad-mini");
    await expect(bar(page, "size")).toHaveText("744 × 1133");
    await expect(devices.filter({ hasText: "iPad mini 7" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect.poll(() => gameFrame(page).evaluate(() => innerWidth)).toBe(744);
  });

  test("Landscape swaps W and H and moves the safe bands to the sides; Portrait puts them back", async ({
    tools,
    errors
  }) => {
    errors.allow(PIXI_RESIZE);
    const page = tools.page;
    await showGame(tools);
    const orientation = game(page).getByRole("radiogroup", { name: "Orientation" });
    await expect(orientation.getByRole("radio", { name: "Portrait" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    const guides = overlay(page).locator("[data-part=guides]");
    await expect(guides.locator("[data-part=band]")).toHaveCount(2);
    await expect(guides.locator("[data-side=top]")).toHaveAttribute("style", /--band: 59px/);
    await expect(guides.locator("[data-side=bottom]")).toHaveAttribute("style", /--band: 34px/);
    await expect(guides.locator("[data-part=island]")).toHaveCount(1);
    await expect(guides.locator("[data-part=home]")).toHaveCount(1);

    await orientation.getByRole("radio", { name: "Landscape" }).click();
    await expect(orientation.getByRole("radio", { name: "Landscape" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await expect(bar(page, "size")).toHaveText("852 × 393");
    await expect(game(page).locator("[data-part=bezel]")).toHaveAttribute(
      "data-orientation",
      "landscape"
    );
    await expect(guides).toHaveAttribute("data-orientation", "landscape");
    await expect(guides.locator("[data-side=left]")).toHaveAttribute("style", /--band: 59px/);
    await expect(guides.locator("[data-side=right]")).toHaveAttribute("style", /--band: 59px/);
    await expect(guides.locator("[data-side=bottom]")).toHaveAttribute("style", /--band: 34px/);
    await expect(guides.locator("[data-side=top]")).toHaveCount(0);
    await expect.poll(() => gameFrame(page).evaluate(() => innerWidth)).toBe(852);
    await expect.poll(() => gameFrame(page).evaluate(() => innerHeight)).toBe(393);
    // The band is drawn in device px, scaled with the frame: 59 device px on the left edge.
    const frame = await iframe(page).boundingBox();
    const left = await guides.locator("[data-side=left]").boundingBox();
    if (frame === null || left === null) throw new Error("no boxes");
    expect(Math.abs(left.width - (59 * frame.width) / 852)).toBeLessThan(1.5);
    expect(Math.abs(left.x - frame.x)).toBeLessThan(1.5);

    await orientation.getByRole("radio", { name: "Portrait" }).click();
    await expect(bar(page, "size")).toHaveText("393 × 852");
    await expect(guides.locator("[data-side=top]")).toHaveCount(1);
    await expect.poll(() => gameFrame(page).evaluate(() => innerWidth)).toBe(393);
  });

  test("Fit scales the frame into the stage; 100 % shows it at device size", async ({
    tools,
    errors
  }) => {
    errors.allow(PIXI_RESIZE);
    const page = tools.page;
    await showGame(tools);
    // The iPad mini (744 × 1133) is taller than every window of the suite, so Fit always scales it
    // down; an iPhone 15 fits at scale 1 on the 960 × 1080 window.
    await bar(page, "device").selectOption("ipad-mini");
    await expect(bar(page, "size")).toHaveText("744 × 1133");
    await expect.poll(() => gameFrame(page).evaluate(() => innerWidth)).toBe(744);
    const zoom = game(page).getByRole("radiogroup", { name: "Zoom" });
    await expect(zoom.getByRole("radio", { name: "Fit" })).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => widthOf(iframe(page))).toBeLessThan(744);
    const viewport = await game(page).locator("[data-part=viewport]").boundingBox();
    const fitted = await iframe(page).boundingBox();
    if (viewport === null || fitted === null) throw new Error("no boxes");
    // Fit: the whole device is inside the stage, at the device aspect.
    expect(fitted.height).toBeLessThanOrEqual(viewport.height);
    expect(fitted.width).toBeLessThanOrEqual(viewport.width);
    expect(fitted.width / fitted.height).toBeCloseTo(744 / 1133, 2);

    await zoom.getByRole("radio", { name: "100 %" }).click();
    await expect(game(page).locator("[data-game=stage]")).toHaveAttribute("data-zoom", "100");
    await expect(zoom.getByRole("radio", { name: "100 %" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await expect.poll(() => widthOf(iframe(page))).toBeCloseTo(744, 0);
    await expect.poll(() => heightOf(game(page).locator("[data-part=slot]"))).toBeCloseTo(1133, 0);
    // The game still sees its device size, and the overlay scales with the frame.
    expect(await gameFrame(page).evaluate(() => innerWidth)).toBe(744);
    await expect.poll(() => widthOf(overlay(page))).toBeCloseTo(744, 0);

    await zoom.getByRole("radio", { name: "Fit" }).click();
    await expect(game(page).locator("[data-game=stage]")).toHaveAttribute("data-zoom", "fit");
    await expect.poll(() => widthOf(iframe(page))).toBeCloseTo(fitted.width, 0);
  });

  test("Safe area toggles the bands; small phones, Android, the iPad and Desktop draw what their insets say", async ({
    tools,
    errors
  }) => {
    errors.allow(PIXI_RESIZE);
    const page = tools.page;
    await showGame(tools);
    const safe = bar(page, "safe");
    const guides = overlay(page).locator("[data-part=guides]");
    await expect(safe).toHaveAttribute("aria-checked", "true");
    await expect(guides).toBeVisible();
    await safe.click();
    await expect(safe).toHaveAttribute("aria-checked", "false");
    await expect(guides).toHaveCount(0);
    await safe.click();
    await expect(safe).toHaveAttribute("aria-checked", "true");
    await expect(guides.locator("[data-part=band]")).toHaveCount(2);

    // iPhone SE: a 20 px top band, no island, no home bar, no bottom band.
    await bar(page, "device").selectOption("iphone-se");
    await expect(guides.locator("[data-side=top]")).toHaveAttribute("style", /--band: 20px/);
    await expect(guides.locator("[data-side=bottom]")).toHaveCount(0);
    await expect(guides.locator("[data-part=island]")).toHaveCount(0);
    await expect(guides.locator("[data-part=home]")).toHaveCount(0);

    // iPhone 16 Pro: 62 / 34 with the island and the home bar.
    await bar(page, "device").selectOption("iphone-16-pro");
    await expect(guides.locator("[data-side=top]")).toHaveAttribute("style", /--band: 62px/);
    await expect(guides.locator("[data-side=bottom]")).toHaveAttribute("style", /--band: 34px/);
    await expect(guides.locator("[data-part=island]")).toHaveCount(1);
    await expect(guides.locator("[data-part=home]")).toHaveCount(1);

    // Pixel 8 and the iPad mini 7: their browsers report no insets, so no band, island or home bar.
    for (const id of ["pixel-8", "ipad-mini"]) {
      await bar(page, "device").selectOption(id);
      await expect(bar(page, "size")).toHaveText(id === "pixel-8" ? "412 × 915" : "744 × 1133");
      await expect(guides).toBeAttached();
      await expect(guides.locator("[data-part=band]")).toHaveCount(0);
      await expect(guides.locator("[data-part=island]")).toHaveCount(0);
      await expect(guides.locator("[data-part=home]")).toHaveCount(0);
    }

    // Desktop: no guides, the switch is off and disabled.
    await bar(page, "device").selectOption("desktop");
    await expect(guides).toHaveCount(0);
    await expect(safe).toHaveAttribute("aria-disabled", "true");
    await expect(safe).toHaveAttribute("aria-checked", "false");
    await safe.dispatchEvent("click");
    await expect(guides).toHaveCount(0);
    await expect(safe).toHaveAttribute("aria-checked", "false");
  });

  test("Reload reloads the game page without restoring: the board goes back to home", async ({
    tools,
    errors
  }) => {
    for (const pattern of RELOAD_WARNINGS) errors.allow(pattern);
    const page = tools.page;
    await showGame(tools);
    await toBoard(page);
    await markGame(page);
    await bar(page, "reload").click();
    await expect.poll(() => reloadState(page), { timeout: 30_000 }).toBe("reloaded");
    await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live", {
      timeout: 30_000
    });
    await expect.poll(() => gamePath(page), { timeout: 30_000 }).toBe("home");
    await expect(game(page).locator("[data-part=badge]")).toHaveCount(0);
    // The frame is docked on the stage again.
    await expect
      .poll(async () => {
        const slot = await game(page).locator("[data-part=slot]").boundingBox();
        const frame = await iframe(page).boundingBox();
        return slot !== null && frame !== null && Math.abs(slot.width - frame.width) < 1;
      })
      .toBe(true);
  });

  test("Fold / Unfold on the Galaxy Z Fold 6 resizes the frame live; the picker matches game.locate after a fold", async ({
    tools,
    errors
  }) => {
    errors.allow(PIXI_RESIZE);
    const page = tools.page;
    await showGame(tools);
    const fold = game(page).locator("[data-game=toolbar] [data-action=fold]");
    await expect(fold).toHaveCount(0);
    await bar(page, "device").selectOption("galaxy-z-fold-6");
    await expect(bar(page, "size")).toHaveText("369 × 905");
    await expect(fold).toHaveText("Unfold");
    await expect.poll(() => gameFrame(page).evaluate(() => innerWidth)).toBe(369);
    await markGame(page);

    // Unfold: the inner screen, live — the game sees a resize, not a reload.
    await fold.click();
    await expect(fold).toHaveText("Fold");
    await expect(fold).toHaveAttribute("title", "Fold to the cover screen");
    await expect(bar(page, "size")).toHaveText("707 × 823");
    await expect.poll(() => gameFrame(page).evaluate(() => innerWidth)).toBe(707);
    await expect.poll(() => gameFrame(page).evaluate(() => innerHeight)).toBe(823);
    await expect
      .poll(async () => {
        const slot = await game(page).locator("[data-part=slot]").boundingBox();
        const frame = await iframe(page).boundingBox();
        if (slot === null || frame === null) return false;
        const aspect = Math.round((slot.width / slot.height) * 100);
        return aspect === Math.round((707 / 823) * 100) && Math.abs(slot.x - frame.x) < 1;
      })
      .toBe(true);
    expect(await reloadState(page)).toBe("marked");

    // The picker calibrates on the unfolded screen: its ring is the game's own rect of Play, read
    // once the game has laid the screen out again (two reads 200 ms apart agree).
    let laidOut = "";
    await expect
      .poll(
        async () => {
          const now = JSON.stringify(await gameRect(page, "play"));
          const still = now === laidOut;
          laidOut = now;
          return still;
        },
        { intervals: [200] }
      )
      .toBe(true);
    await pickerOn(page);
    const client = await toClient(page, await gameRect(page, "play"));
    // The scene the picker draws from follows the resize within a few heartbeats: poll until the
    // ring under the pointer is Play at its game rect.
    await expect
      .poll(
        async () => {
          const at = await hoverFind(page, client, /^play · button · \d+×\d+$/);
          await page.mouse.move(at.x, at.y);
          const box = await overlay(page).locator("[data-box=hover]").boundingBox();
          if (box === null) return false;
          return [
            box.x - client.x,
            box.y - client.y,
            box.width - client.w,
            box.height - client.h
          ].every(delta => Math.abs(delta) < 1.5);
        },
        { timeout: 15_000 }
      )
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect(bar(page, "pick")).toHaveAttribute("aria-pressed", "false");

    // Fold: back to the cover screen.
    await fold.click();
    await expect(fold).toHaveText("Unfold");
    await expect(bar(page, "size")).toHaveText("369 × 905");
    await expect.poll(() => gameFrame(page).evaluate(() => innerWidth)).toBe(369);
    expect(await reloadState(page)).toBe("marked");

    // A preset without a second screen has no Fold button.
    await bar(page, "device").selectOption("pixel-8");
    await expect(fold).toHaveCount(0);
  });

  test("dark theme: the bezel shows on the canvas and the screen is rounded on the stage and in the preview", async ({
    tools
  }) => {
    const page = tools.page;
    await showGame(tools);
    const bezel = game(page).locator("[data-part=bezel]");
    const look = await bezel.evaluate(element => {
      const style = getComputedStyle(element);
      const stage = element.closest("[data-game=stage]");
      const slot = element.querySelector("[data-part=slot]");
      return {
        background: style.backgroundColor,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
        radius: Number.parseFloat(style.borderTopLeftRadius),
        slotRadius:
          slot === null ? 0 : Number.parseFloat(getComputedStyle(slot).borderTopLeftRadius),
        stage: stage === null ? "" : getComputedStyle(stage).backgroundColor
      };
    });
    // The dark bezel colour #2c2c34 with a 1 px outline, both apart from the canvas.
    expect(look.background).toBe("rgb(44, 44, 52)");
    expect(look.outlineStyle).toBe("solid");
    expect(look.outlineWidth).toBe("1px");
    expect(look.outlineColor).not.toBe(look.stage);
    expect(look.background).not.toBe(look.stage);
    // iPhone 15: a 55 px screen radius at the stage scale; the bezel adds its 10 px padding.
    const box = await iframe(page).boundingBox();
    const scale = (box?.width ?? 0) / 393;
    expect(look.slotRadius).toBeCloseTo(55 * scale, 0);
    expect(look.radius).toBeCloseTo(55 * scale + 10, 0);
    // The docked frame is clipped with the same round corners, in the frame's own px.
    const frameBox = page.locator("[data-frame-box]");
    await expect
      .poll(() => frameBox.evaluate(element => getComputedStyle(element).clipPath))
      .toMatch(/round 55px/);

    // The pinned preview docks the same frame, rounded too.
    await tools.show("render");
    await showPreview(page);
    await expect(frameBox).toHaveAttribute("data-docked", "preview");
    await expect
      .poll(() => frameBox.evaluate(element => getComputedStyle(element).clipPath))
      .toMatch(/round 55px/);
  });
});

/**
 * The client box of a locator, after it has one.
 *
 * @param locator - The element.
 * @returns The box.
 */
async function boxOf(
  locator: Locator
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("no box");
  return box;
}

/**
 * Chooses a preset and waits until the game page sees its size and the frame docks on the slot at
 * the device aspect.
 *
 * @param page - The test page.
 * @param id - The preset id.
 * @param size - The screen the game should see.
 * @param size.w - Its width.
 * @param size.h - Its height.
 */
async function choosePreset(page: Page, id: string, size: { w: number; h: number }): Promise<void> {
  await bar(page, "device").selectOption(id);
  await expect(bar(page, "size")).toHaveText(`${size.w} × ${size.h}`);
  await expect.poll(() => gameFrame(page).evaluate(() => innerWidth)).toBe(size.w);
  await expect.poll(() => gameFrame(page).evaluate(() => innerHeight)).toBe(size.h);
  await expect
    .poll(async () => {
      const slot = await game(page).locator("[data-part=slot]").boundingBox();
      const frame = await iframe(page).boundingBox();
      if (slot === null || frame === null) return false;
      const aspect = Math.round((slot.width / slot.height) * 100);
      return (
        aspect === Math.round((size.w / size.h) * 100) &&
        Math.abs(slot.width - frame.width) < 1 &&
        Math.abs(slot.x - frame.x) < 1
      );
    })
    .toBe(true);
}

/**
 * The slot and bezel boxes of the shown preset and its Fit scale (slot height over device height).
 *
 * @param page - The test page.
 * @param h - The device height in CSS px.
 * @returns The boxes and the scale.
 */
async function stageOf(
  page: Page,
  h: number
): Promise<{
  slot: { width: number; height: number };
  bezel: { width: number; height: number };
  scale: number;
}> {
  const slot = await boxOf(game(page).locator("[data-part=slot]"));
  const bezel = await boxOf(game(page).locator("[data-part=bezel]"));
  return { slot, bezel, scale: slot.height / h };
}

test.describe("game · round 2b devices", () => {
  test("Fit uses one scale for every phone: the SE 3 frame shows smaller than the 18 Pro Max", async ({
    tools,
    errors
  }) => {
    errors.allow(PIXI_RESIZE);
    const page = tools.page;
    await showGame(tools);
    const zoom = game(page).getByRole("radiogroup", { name: "Zoom" });
    await expect(zoom.getByRole("radio", { name: "Fit" })).toHaveAttribute("aria-checked", "true");

    await choosePreset(page, "iphone-se", { w: 375, h: 667 });
    const se = await stageOf(page, 667);
    await choosePreset(page, "iphone-18-pro-max", { w: 440, h: 956 });
    const max = await stageOf(page, 956);
    await choosePreset(page, "iphone-15", { w: 393, h: 852 });
    const fifteen = await stageOf(page, 852);

    // One scale: the screens keep their real proportion to each other.
    expect(Math.abs(se.scale - max.scale), `${se.scale} vs ${max.scale}`).toBeLessThan(0.01);
    expect(Math.abs(fifteen.scale - max.scale)).toBeLessThan(0.01);
    expect(se.slot.height / max.slot.height).toBeCloseTo(667 / 956, 2);
    // The frames: the SE adds 64 + 64 px of bezel, the 18 Pro Max 10 + 10, unscaled.
    const k = max.scale;
    expect(Math.abs(se.bezel.height - (667 * k + 2 * HOME_BUTTON_BEZEL))).toBeLessThan(2);
    expect(Math.abs(max.bezel.height - (956 * k + 2 * MODERN_BEZEL))).toBeLessThan(2);
    expect(se.bezel.height / max.bezel.height).toBeCloseTo(
      (667 * k + 2 * HOME_BUTTON_BEZEL) / (956 * k + 2 * MODERN_BEZEL),
      2
    );
    // Visibly smaller, and both frames inside the stage.
    expect(se.bezel.height).toBeLessThan(max.bezel.height * 0.95);
    expect(se.bezel.width).toBeLessThan(max.bezel.width);
    const viewport = await boxOf(game(page).locator("[data-part=viewport]"));
    expect(max.bezel.height).toBeLessThanOrEqual(viewport.height);

    // 100 % stays one CSS px per device px.
    await zoom.getByRole("radio", { name: "100 %" }).click();
    await expect.poll(() => heightOf(game(page).locator("[data-part=slot]"))).toBeCloseTo(852, 0);
  });

  test("the iPhone SE 3 has the home-button frame: 64 px bezels, the round button, a square screen, no island", async ({
    tools,
    errors
  }) => {
    errors.allow(PIXI_RESIZE);
    const page = tools.page;
    await showGame(tools);
    const bezel = game(page).locator("[data-part=bezel]");
    const button = bezel.locator("[data-part=home-button]");
    const guides = overlay(page).locator("[data-part=guides]");
    await expect(bezel).toHaveAttribute("data-frame", "modern");
    await expect(button).toHaveCount(0);

    await choosePreset(page, "iphone-se", { w: 375, h: 667 });
    await expect(bezel).toHaveAttribute("data-frame", "home-button");
    const look = await bezel.evaluate(element => {
      const style = getComputedStyle(element);
      const slot = element.querySelector("[data-part=slot]");
      return {
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
        screenRadius: style.getPropertyValue("--screen-radius").trim(),
        slotRadius:
          slot === null ? -1 : Number.parseFloat(getComputedStyle(slot).borderTopLeftRadius)
      };
    });
    expect(look.padding).toEqual(["64px", "10px", "64px", "10px"]);
    expect(look.screenRadius).toBe("0px");
    expect(look.slotRadius).toBe(0);
    // The docked frame is clipped square too.
    await expect
      .poll(() =>
        page.locator("[data-frame-box]").evaluate(element => getComputedStyle(element).clipPath)
      )
      .not.toMatch(/round [1-9]/);

    // The home button: a 44 px ring in the middle of the bottom bezel, below the screen.
    await expect(button).toHaveCount(1);
    const ring = await boxOf(button);
    const slot = await boxOf(game(page).locator("[data-part=slot]"));
    const frame = await boxOf(bezel);
    expect(Math.round(ring.width)).toBe(44);
    expect(Math.round(ring.height)).toBe(44);
    expect(ring.y).toBeGreaterThanOrEqual(slot.y + slot.height);
    expect(ring.y + ring.height).toBeLessThanOrEqual(frame.y + frame.height);
    expect(Math.abs(ring.x + ring.width / 2 - (frame.x + frame.width / 2))).toBeLessThan(1.5);
    expect(await button.evaluate(element => getComputedStyle(element).borderRadius)).toBe("50%");
    // No island, no home bar: the SE has a status bar and its button.
    await expect(guides.locator("[data-part=island]")).toHaveCount(0);
    await expect(guides.locator("[data-part=home]")).toHaveCount(0);

    // Landscape turns the tall bezels to the sides, the button into the right one.
    const orientation = game(page).getByRole("radiogroup", { name: "Orientation" });
    await orientation.getByRole("radio", { name: "Landscape" }).click();
    await expect(bar(page, "size")).toHaveText("667 × 375");
    await expect
      .poll(() => bezel.evaluate(element => getComputedStyle(element).paddingLeft))
      .toBe("64px");
    await expect
      .poll(async () => {
        const turned = await boxOf(button);
        const screen = await boxOf(game(page).locator("[data-part=slot]"));
        return turned.x >= screen.x + screen.width;
      })
      .toBe(true);
    await orientation.getByRole("radio", { name: "Portrait" }).click();
    await expect(bar(page, "size")).toHaveText("375 × 667");

    // Back on the iPhone 15: the modern frame, its island.
    await choosePreset(page, "iphone-15", { w: 393, h: 852 });
    await expect(bezel).toHaveAttribute("data-frame", "modern");
    await expect(button).toHaveCount(0);
    await expect(guides.locator("[data-part=island]")).toHaveCount(1);
  });

  test("the SE 3 frame looks like an SE (golden)", async ({ tools, errors }) => {
    errors.allow(PIXI_RESIZE);
    const page = tools.page;
    await showGame(tools);
    await choosePreset(page, "iphone-se", { w: 375, h: 667 });
    await tools.settle();
    await expect(game(page).locator("[data-part=bezel]")).toHaveScreenshot("se-frame.png", {
      mask: [page.locator("[data-frame-box]"), overlay(page)]
    });
  });

  test("the new presets: iPhone 17e, Air, 18 Pro, 18 Pro Max; the iPhone Duo unfolds landscape-wide, live", async ({
    tools,
    errors
  }) => {
    errors.allow(PIXI_RESIZE);
    const page = tools.page;
    await showGame(tools);
    const select = bar(page, "device");
    await expect(select.locator('optgroup[label="iPhone"] option')).toHaveText([
      "iPhone SE 3 · small, 2022",
      "iPhone 15",
      "iPhone 17e",
      "iPhone Air",
      "iPhone 18 Pro",
      "iPhone 18 Pro Max",
      "iPhone 15 Pro Max",
      "iPhone 16 Pro",
      "iPhone 16 Pro Max"
    ]);
    await choosePreset(page, "iphone-17e", { w: 390, h: 844 });
    await choosePreset(page, "iphone-air", { w: 420, h: 912 });
    await choosePreset(page, "iphone-18-pro", { w: 402, h: 874 });
    await choosePreset(page, "iphone-18-pro-max", { w: 440, h: 956 });

    // The iPhone Duo: a book, folded on its cover screen.
    const fold = game(page).locator("[data-game=toolbar] [data-action=fold]");
    await expect(select.locator('optgroup[label="Foldable"] option').last()).toHaveText(
      "iPhone Duo"
    );
    await expect(select.locator('option[value="iphone-duo"]')).toHaveAttribute(
      "title",
      "466×678 · dpr 3 · approx: estimated values"
    );
    await choosePreset(page, "iphone-duo", { w: 466, h: 678 });
    await expect(fold).toHaveText("Unfold");
    await markGame(page);

    // Unfold: the inner screen is wider than tall in portrait, and the game sees a resize.
    await fold.click();
    await expect(fold).toHaveText("Fold");
    await expect(bar(page, "size")).toHaveText("890 × 626");
    await expect.poll(() => gameFrame(page).evaluate(() => innerWidth)).toBe(890);
    await expect.poll(() => gameFrame(page).evaluate(() => innerHeight)).toBe(626);
    await expect(
      game(page).getByRole("radiogroup", { name: "Orientation" }).getByRole("radio", {
        name: "Portrait"
      })
    ).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(async () => {
        const slot = await game(page).locator("[data-part=slot]").boundingBox();
        return slot === null ? 0 : Math.round((slot.width / slot.height) * 100);
      })
      .toBe(Math.round((890 / 626) * 100));
    expect(await reloadState(page)).toBe("marked");

    // Fold: back to the cover screen.
    await fold.click();
    await expect(fold).toHaveText("Unfold");
    await expect(bar(page, "size")).toHaveText("466 × 678");
    await expect.poll(() => gameFrame(page).evaluate(() => innerWidth)).toBe(466);
    expect(await reloadState(page)).toBe("marked");
  });

  test("Sound runs game.mute: a click mutes the game, M gives the sound back, the flag is kept", async ({
    tools
  }) => {
    const page = tools.page;
    await showGame(tools);
    const sound = bar(page, "sound");
    await expect(sound).toHaveRole("switch");
    await expect(sound).toHaveText("Sound");
    await expect(sound).not.toHaveAttribute("aria-disabled");
    await expect(sound).toHaveAttribute("title", "Sound on or off · M");
    await expect(sound).toHaveAttribute("aria-checked", "true");
    expect(await readSource<boolean>(page, "game.audioMuted")).toBe(false);

    // A click mutes the master bus of the game.
    await sound.click();
    await expect(sound).toHaveAttribute("aria-checked", "false");
    await expect.poll(() => readSource<boolean>(page, "game.audioMuted")).toBe(true);
    const stored = await page.evaluate(() => localStorage.getItem("moku-editor") ?? "{}");
    expect(JSON.parse(stored).muted).toBe(true);

    // M in Game gives the sound back.
    await page.keyboard.press("m");
    await expect(sound).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => readSource<boolean>(page, "game.audioMuted")).toBe(false);
  });
});

test.describe("game · the default device (round 2b R10)", () => {
  test.use({ pinnedDevice: false });

  test("a fresh viewer starts on the iPhone 18 Pro: 402 × 874 with its island, on the Device tab too", async ({
    tools
  }) => {
    const page = tools.page;
    await showGame(tools);
    const select = bar(page, "device");
    await expect(select).toHaveValue("iphone-18-pro");
    await expect(bar(page, "size")).toHaveText("402 × 874");
    await expect.poll(() => gameFrame(page).evaluate(() => innerWidth)).toBe(402);
    await expect.poll(() => gameFrame(page).evaluate(() => innerHeight)).toBe(874);
    await expect(select.locator("option:checked")).toHaveAttribute(
      "title",
      "402×874 · dpr 3 · approx: estimated values"
    );
    const bezel = game(page).locator("[data-part=bezel]");
    await expect(bezel).toHaveAttribute("data-frame", "modern");
    await expect(bezel).toHaveAttribute("data-kind", "phone");
    const guides = overlay(page).locator("[data-part=guides]");
    await expect(guides.locator("[data-side=top]")).toHaveAttribute("style", /--band: 62px/);
    await expect(guides.locator("[data-side=bottom]")).toHaveAttribute("style", /--band: 34px/);
    await expect(guides.locator("[data-part=island]")).toHaveCount(1);
    // The screen radius 62 at the stage scale.
    const frame = await boxOf(iframe(page));
    const slotRadius = await game(page)
      .locator("[data-part=slot]")
      .evaluate(element => Number.parseFloat(getComputedStyle(element).borderTopLeftRadius));
    expect(slotRadius).toBeCloseTo((62 * frame.width) / 402, 0);

    await openSide(page);
    await game(page).getByRole("tab", { name: "Device" }).click();
    await expect(
      game(page).locator("[data-part=devices] button").filter({ hasText: "iPhone 18 Pro" }).first()
    ).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("game · capture", () => {
  test("Shot writes a JPEG under .moku/captures and shows the card", async ({ tools }) => {
    const page = tools.page;
    await showGame(tools);
    await bar(page, "capture").click();

    const card = page.locator("[data-game=card]");
    await expect(card).toBeVisible();
    await expect(card.locator("[data-part=saved]")).toHaveText("✓ Screenshot saved");
    // The path line is cut in the middle; its title holds the whole path (round 2b R14).
    const shown = (await card.locator("[data-part=path]").getAttribute("title")) ?? "";
    expect(shown).toMatch(/^\.moku\/captures\/\d{4}-\d{2}-\d{2}\/\d{4}-main\.jpg$/);
    await expect(card.locator("[data-part=meta]")).toHaveText(/^f\d+ · iPhone 15 portrait$/);
    await expect(card.locator("img")).toHaveAttribute("src", /^data:image\/jpeg|^blob:/);
    await expect(toast(page)).toContainText("✓ Screenshot saved");
    await expect(toast(page)).toContainText(shown);
    await expect(overlay(page).locator("[data-part=flash]")).toBeAttached();

    // The JPEG on disk is the game frame at the device size.
    expect(await captured()).toEqual([inCaptures(shown)]);
    const size = await jpegSize(path.join(GAME_ROOT, shown));
    expect(size.w / size.h).toBeCloseTo(393 / 852, 2);

    // A second shot in the same minute gets a -2 suffix (one in the next minute a name of its own).
    await bar(page, "capture").click();
    await expect(card.locator("[data-part=path]")).not.toHaveAttribute("title", shown);
    const second = (await card.locator("[data-part=path]").getAttribute("title")) ?? "";
    const sameMinute = second.startsWith(shown.replace("-main.jpg", ""));
    expect(second).toMatch(
      sameMinute
        ? shown.replace(".jpg", "-2.jpg")
        : /^\.moku\/captures\/\d{4}-\d{2}-\d{2}\/\d{4}-main\.jpg$/
    );
    expect(await captured()).toEqual([inCaptures(shown), inCaptures(second)].toSorted());

    // Notes are gone: the card attaches nothing.
    await expect(card.getByRole("button", { name: "Attach to note" })).toHaveCount(0);
    await expect(card.getByRole("combobox")).toHaveCount(0);

    await card.getByRole("button", { name: "Close" }).click();
    await expect(card).toHaveCount(0);
  });

  test("Take a screenshot from the palette in another workspace; Esc closes the card", async ({
    tools
  }) => {
    const page = tools.page;
    await tools.show("state");
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.locator("dialog[data-ui=palette]");
    await palette.getByRole("combobox", { name: "Search" }).fill("Take a screenshot");
    await palette.getByRole("option", { name: /Take a screenshot/ }).click();
    await expect(toast(page)).toContainText("✓ Screenshot saved");
    await expect.poll(() => captured()).toHaveLength(1);
    await showGame(tools);
    const card = page.locator("[data-game=card]");
    await expect(card).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
  });
});

/**
 * How many lines a text element wraps to: the distinct tops of its text's client rects.
 *
 * @param locator - The element.
 * @returns The line count, 0 without text.
 */
async function lineCount(locator: Locator): Promise<number> {
  return locator.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const tops = new Set([...range.getClientRects()].map(rect => Math.round(rect.top)));
    return tops.size;
  });
}

test.describe("game · capture card (round 2b R14)", () => {
  test("the card is compact: one line each for the title, the path and the meta, at most 360 × 120 (the window less 24 at 480 px)", async ({
    tools
  }) => {
    const page = tools.page;
    await showGame(tools);
    await bar(page, "capture").click();
    const card = page.locator("[data-game=card]");
    await expect(card).toBeVisible();
    const path = card.locator("[data-part=path]");
    const full = (await path.getAttribute("title")) ?? "";
    expect(full).toMatch(/^\.moku\/captures\/.+\.jpg$/);
    // The shown path is the whole one, or cut in the middle with an ellipsis.
    const shown = (await path.textContent()) ?? "";
    expect(shown === full || (shown.includes("…") && shown.length < full.length)).toBe(true);

    const box = await boxOf(card);
    const width = page.viewportSize()?.width ?? 0;
    expect(box.height).toBeLessThanOrEqual(120);
    if (width <= 480) expect(Math.abs(box.width - (width - 24))).toBeLessThan(1.5);
    else expect(box.width).toBeLessThanOrEqual(360);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);

    // No wrapped words: each text line is one line, and the path stays under the title.
    for (const part of ["saved", "path", "meta"]) {
      expect(await lineCount(card.locator(`[data-part=${part}]`)), part).toBe(1);
    }
    const title = await boxOf(card.locator("[data-part=saved]"));
    const pathBox = await boxOf(path);
    expect(pathBox.y).toBeGreaterThanOrEqual(title.y + title.height - 0.5);
    for (const button of await card.locator("[data-part=actions] button").all()) {
      expect(await lineCount(button)).toBe(1);
    }
    // The thumbnail is 56 px wide, no taller than the card.
    const thumb = await boxOf(card.locator("img"));
    expect(Math.round(thumb.width)).toBe(56);
    expect(thumb.height).toBeLessThanOrEqual(box.height);

    // A plain shot: Copy link and Open, no Reference; Copy link puts `shot: <path>` there.
    await expect(card.locator("[data-part=actions] button")).toHaveText(["Copy link", "Open"]);
    await page.evaluate(() => navigator.clipboard.writeText(""));
    await card.getByRole("button", { name: "Copy link" }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(`shot: ${full}`);
    await expect(toast(page)).toContainText("✓ Link copied");
  });

  test("the card looks compact (golden)", async ({ tools }) => {
    const page = tools.page;
    await showGame(tools);
    await bar(page, "capture").click();
    const card = page.locator("[data-game=card]");
    await expect(card).toBeVisible();
    await card.hover();
    await tools.settle();
    await expect(card).toHaveScreenshot("capture-card.png", {
      mask: [
        card.locator("img"),
        card.locator("[data-part=path]"),
        card.locator("[data-part=meta]")
      ]
    });
  });
});

test.describe("game · series", () => {
  test("the popover sets duration and interval, warns on a large series, and Cancel closes it", async ({
    tools
  }) => {
    const page = tools.page;
    await showGame(tools);
    await bar(page, "series").click();
    const pop = page.locator("[data-game=series]");
    await expect(pop).toBeVisible();
    await expect(bar(page, "series")).toHaveAttribute("aria-expanded", "true");
    await expect(pop.getByRole("heading")).toHaveText("Record a series");
    const duration = pop.getByRole("radiogroup", { name: "Duration" });
    const interval = pop.getByRole("radiogroup", { name: "Interval" });
    await expect(duration.getByRole("radio")).toHaveText(["1 s", "2 s", "5 s", "10 s", "20 s"]);
    await expect(interval.getByRole("radio")).toHaveText([
      "16 ms",
      "50 ms",
      "100 ms",
      "250 ms",
      "500 ms",
      "1000 ms"
    ]);
    await duration.getByRole("radio", { name: "2 s" }).click();
    await interval.getByRole("radio", { name: "250 ms" }).click();
    await expect(duration.getByRole("radio", { name: "2 s" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await expect(pop.locator("[data-part=result]")).toHaveText("8 shots · 2 s at 250 ms");
    await expect(pop.locator("[data-part=warning]")).toHaveCount(0);
    await expect(pop.locator("[data-part=folder]")).toHaveText(
      /^Saves to \.moku\/captures\/\d{4}-\d{2}-\d{2}\/series-\d{4}\/ with index\.json$/
    );

    await duration.getByRole("radio", { name: "20 s" }).click();
    await interval.getByRole("radio", { name: "16 ms" }).click();
    await expect(pop.locator("[data-part=result]")).toHaveText("1250 shots · 20 s at 16 ms");
    await expect(pop.locator("[data-part=warning]")).toHaveText("! 1250 shots is a large series.");

    await pop.getByRole("button", { name: "Cancel" }).click();
    await expect(pop).toHaveCount(0);
    await expect(bar(page, "series")).toHaveAttribute("aria-expanded", "false");
    // Esc closes it too.
    await bar(page, "series").click();
    await expect(pop).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(pop).toHaveCount(0);
    expect(await list(CAPTURES_DIR)).toEqual([]);
  });

  test("a full series writes NNN.png and index.json and opens the contact sheet", async ({
    tools
  }) => {
    const page = tools.page;
    await showGame(tools);
    await bar(page, "series").click();
    const pop = page.locator("[data-game=series]");
    await pop
      .getByRole("radiogroup", { name: "Duration" })
      .getByRole("radio", { name: "1 s" })
      .click();
    await pop
      .getByRole("radiogroup", { name: "Interval" })
      .getByRole("radio", { name: "250 ms" })
      .click();
    await pop.getByRole("button", { name: "● Start" }).click();
    await expect(pop.locator("[data-part=recording]")).toBeVisible();
    await expect(bar(page, "series")).toHaveAttribute("data-recording", "");

    const sheet = page.locator("dialog[data-game=sheet]");
    await expect(sheet).toBeVisible({ timeout: 20_000 });
    await expect(toast(page)).toContainText("✓ 4 shots saved");
    const folders = await seriesFolders();
    expect(folders).toHaveLength(1);
    const folder = `${CAPTURES_DIR}/${folders[0]}`;
    expect(await list(folder)).toEqual(["001.png", "002.png", "003.png", "004.png", "index.json"]);
    const index = JSON.parse((await readGameFile(`${folder}/index.json`)) ?? "{}");
    expect(index.shots).toHaveLength(4);
    expect(index.durationMs).toBe(1000);
    expect(index.intervalMs).toBe(250);
    expect(index.stoppedEarly).toBeUndefined();
    expect(index.device).toEqual(
      expect.objectContaining({ name: "iPhone 15", orientation: "portrait" })
    );
    expect(index.shots.map((shot: { file: string }) => shot.file)).toEqual([
      "001.png",
      "002.png",
      "003.png",
      "004.png"
    ]);
    await pngSize(path.join(GAME_ROOT, folder, "001.png"));

    await expect(sheet.getByRole("heading")).toHaveText(
      new RegExp(`^Series · .+ · 4 shots · 1 s at 250 ms · from frame ${index.fromFrame}$`)
    );
    await expect(sheet.locator("[data-part=tile]")).toHaveCount(4);
    await expect(sheet.locator("[data-part=saved]")).toHaveText(`Saved to ${folder}/ · index.json`);
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(bar(page, "series")).not.toHaveAttribute("data-recording", "");
  });

  test("Stop ends a series early; the sheet steps through the shots and marks a bug", async ({
    tools
  }) => {
    const page = tools.page;
    await showGame(tools);
    await bar(page, "series").click();
    const pop = page.locator("[data-game=series]");
    await pop
      .getByRole("radiogroup", { name: "Duration" })
      .getByRole("radio", { name: "10 s" })
      .click();
    await pop
      .getByRole("radiogroup", { name: "Interval" })
      .getByRole("radio", { name: "250 ms" })
      .click();
    await pop.getByRole("button", { name: "● Start" }).click();

    // The recording view: ring, remaining, shots, every, length, the folder; the REC badge.
    const rec = pop.locator("[data-part=recording]");
    await expect(rec).toHaveAttribute("data-phase", "recording");
    await expect(rec).toContainText("Every250 ms");
    await expect(rec).toContainText("Length10 s");
    await expect(rec).toContainText(
      /Writing to \.moku\/captures\/\d{4}-\d{2}-\d{2}\/series-\d{4}\//
    );
    await expect(game(page).locator("[data-part=badge][data-tone=rec]")).toHaveText(
      /^● REC \d+\.\d s$/
    );
    await expect(bar(page, "series")).toHaveText(/^● \d+\.\d s$/);
    await expect(rec.locator("[data-part=shots]")).toHaveText(/^≈([3-9]|\d\d) of 40$/, {
      timeout: 10_000
    });
    await rec.getByRole("button", { name: "Stop" }).click();

    const sheet = page.locator("dialog[data-game=sheet]");
    await expect(sheet).toBeVisible({ timeout: 20_000 });
    await expect(sheet.getByRole("heading")).toHaveText(/ · stopped early$/);
    const [series] = await seriesFolders();
    const folder = `${CAPTURES_DIR}/${series}`;
    const index = JSON.parse((await readGameFile(`${folder}/index.json`)) ?? "{}");
    expect(index.stoppedEarly).toBe(true);
    const count: number = index.shots.length;
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThan(40);
    expect(index.durationMs).toBeLessThan(10_000);
    const files = await list(folder);
    const pngs = files.filter(name => name.endsWith(".png"));
    expect(pngs).toHaveLength(count);
    await expect(sheet.locator("[data-part=tile]")).toHaveCount(count);
    await expect(sheet.locator("[data-part=caption]").first()).toHaveText(
      new RegExp(String.raw`^f${index.shots[0].frame} \+${index.shots[0].atMs} ms$`)
    );

    // The large view: open shot 1, step with the arrow keys and the buttons, the strip.
    await sheet.getByRole("button", { name: "Open shot 1" }).click();
    const big = sheet.locator("[data-part=big]");
    await expect(big.locator("[data-part=position]")).toHaveText(`Shot 1 of ${count}`);
    await expect(big).toContainText(`Frame${index.shots[0].frame}`);
    await expect(big).toContainText("DeviceiPhone 15 portrait");
    await page.keyboard.press("ArrowRight");
    await expect(big.locator("[data-part=position]")).toHaveText(`Shot 2 of ${count}`);
    await expect(big).toContainText(`Frame${index.shots[1].frame}`);
    await big.getByRole("button", { name: "Previous shot" }).click();
    await expect(big.locator("[data-part=position]")).toHaveText(`Shot 1 of ${count}`);
    await big.getByRole("button", { name: "Next shot" }).click();
    await expect(big.locator("[data-part=position]")).toHaveText(`Shot 2 of ${count}`);
    await expect(big.getByRole("button", { name: "Shot 2", exact: true })).toHaveAttribute(
      "aria-current",
      "true"
    );

    // B marks the shown shot as a bug; index.json is written once after the burst.
    await page.keyboard.press("b");
    await expect(big.getByRole("button", { name: /Mark as bug/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(sheet.locator("[data-part=bugs]")).toHaveText("1 marked as bug");
    await expect
      .poll(
        async () => JSON.parse((await readGameFile(`${folder}/index.json`)) ?? "{}").shots[1].bug
      )
      .toBe(true);
    await expect(toast(page)).toContainText("index.json");
    // The strip button shows the bug; a click on another strip shot moves there.
    await expect(big.getByRole("button", { name: "Shot 2", exact: true })).toHaveAttribute(
      "data-bug",
      ""
    );
    await big.getByRole("button", { name: "Shot 1", exact: true }).click();
    await expect(big.locator("[data-part=position]")).toHaveText(`Shot 1 of ${count}`);

    // Esc goes back to the grid, where the tile shows the bug; the tile toggle clears it.
    await page.keyboard.press("Escape");
    await expect(big).toHaveCount(0);
    await expect(sheet.locator("[data-part=tile]").nth(1)).toHaveAttribute("data-bug", "");
    await sheet.getByRole("button", { name: "Mark shot 2 as bug" }).click();
    await expect(sheet.locator("[data-part=bugs]")).toHaveCount(0);
    await expect
      .poll(
        async () => JSON.parse((await readGameFile(`${folder}/index.json`)) ?? "{}").shots[1].bug
      )
      .toBeFalsy();

    // Notes are gone: the sheet attaches nothing.
    await expect(sheet.getByRole("button", { name: "Attach to note" })).toHaveCount(0);

    // Esc on the grid closes the sheet.
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  });
});

test.describe("game · element picker", () => {
  test("hover rings the Play button at its real rect; click selects it; Esc leaves the picker", async ({
    tools
  }) => {
    const page = tools.page;
    await showGame(tools);
    await expect(elementTab(page)).toHaveAttribute("data-empty", "");
    await expect(elementTab(page)).toContainText(
      "Pick an element in the game to see its place in the render tree, its bounds, texture and styles."
    );
    await pickerOn(page);

    const play = await gameRect(page, "play");
    const client = await toClient(page, play);
    const at = await hoverFind(page, client, /^play · button · \d+×\d+$/);
    await expect(overlay(page).locator("[data-part=label]")).toHaveText(
      `play · button · ${Math.round(play.w)}×${Math.round(play.h)}`
    );
    expectNear(await overlay(page).locator("[data-box=hover]").boundingBox(), client);

    // A move off the frame clears the hover.
    await page.mouse.move(5, 5);
    await expect(overlay(page).locator("[data-box=hover]")).toHaveCount(0);

    await page.mouse.move(at.x, at.y);
    await page.mouse.click(at.x, at.y);
    await expect(bar(page, "pick")).toHaveAttribute("aria-pressed", "false");
    await expect(overlay(page).locator("[data-part=picker]")).toHaveCount(0);
    await expect(game(page).locator("[data-part=hint]")).toHaveCount(0);
    expectNear(await overlay(page).locator("[data-box=selected]").boundingBox(), client);
    // The click did not reach the game: still on home.
    expect(await gamePath(page)).toBe("home");

    const tab = elementTab(page);
    await openSide(page);
    await expect(game(page).getByRole("tab", { name: "Element" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(tab.locator("[data-part=name]")).toHaveText("play");
    await expect(tab.locator("[data-part=type]")).toHaveText("button");
    await expect(tab.locator("[data-part=crumbs] button").first()).toHaveText("homeScreen");
    await expect(tab.locator("[data-part=bounds] dd")).toHaveText([
      String(Math.round(play.x)),
      String(Math.round(play.y)),
      String(Math.round(play.w)),
      String(Math.round(play.h))
    ]);
    await expect(tab.locator("[data-part=device]")).toHaveText("iPhone 15 portrait · 393×852");
    await expect(tab.getByRole("region", { name: "Styles" })).toBeVisible();
    await expect(tab.locator("[data-part=style-card] [data-part=where]")).toHaveText(
      new RegExp(String.raw`^${escapeRegExp(HOME_STYLES)}:\d+$`)
    );

    // A crumb selects the ancestor; hovering a crumb draws the pink tree box.
    const crumb = tab.locator("[data-part=crumbs] button").last();
    const parentName = (await crumb.textContent()) ?? "";
    await crumb.hover();
    await expect(overlay(page).locator("[data-box=tree]")).toBeVisible();
    await crumb.click();
    await expect(tab.locator("[data-part=name]")).toHaveText(parentName);
    await expect(tab.locator("[data-part=children]")).toContainText("play");
    await tab.locator("[data-part=children] button", { hasText: /^play$/ }).click();
    await expect(tab.locator("[data-part=name]")).toHaveText("play");

    // Pick another turns the picker on and hides the pick's capture card (round 2b R17), so the
    // first Esc leaves the picker and keeps the selection.
    await tab.getByRole("button", { name: "Pick another" }).click();
    await expect(bar(page, "pick")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-game=card]")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(bar(page, "pick")).toHaveAttribute("aria-pressed", "false");
    await expect(overlay(page).locator("[data-part=picker]")).toHaveCount(0);
    await expect(tab.locator("[data-part=name]")).toHaveText("play");

    // The key I toggles the picker.
    await page.keyboard.press("i");
    await expect(bar(page, "pick")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("i");
    await expect(bar(page, "pick")).toHaveAttribute("aria-pressed", "false");
  });

  test("the Code section: the JSX of Play and its style block, each with Open in Files", async ({
    tools
  }) => {
    const page = tools.page;
    await showGame(tools);
    await pickerOn(page);
    const client = await toClient(page, await gameRect(page, "play"));
    const at = await hoverFind(page, client, /^play · button/);
    await page.mouse.click(at.x, at.y);
    await openSide(page);
    const tab = elementTab(page);
    await expect(tab.locator("[data-part=name]")).toHaveText("play");

    // The JSX: from the line of key="play" to the end of the element, highlighted with a gutter.
    const code = tab.locator("section[data-part=code]");
    await expect(code.locator("h4")).toHaveText("Code", { timeout: 20_000 });
    const snippets = code.locator("[data-part=snippet]");
    await expect(snippets).toHaveCount(2);
    const jsx = snippets.first();
    await expect(jsx.locator("header [data-part=title]")).toHaveText("JSX");
    await expect(jsx.locator("header [data-part=where]")).toHaveText(
      /^features\/home\/view\.tsx:\d+$/
    );
    const first = jsx.locator("[data-part=code-lines] > div").first();
    await expect(first.locator("code")).toContainText('<button key="play"');
    await expect(jsx.locator("[data-part=code-lines] > div").last()).toContainText("</button>");
    const jsxLine = Number(
      ((await jsx.locator("[data-part=where]").textContent()) ?? "").split(":")[1]
    );
    await expect(first).toHaveAttribute("data-line", String(jsxLine));
    await expect(first.locator("[data-part=gutter]")).toHaveText(String(jsxLine));
    // The highlighter tokenised it: more than one span in the first line.
    expect(await first.locator("code span").count()).toBeGreaterThan(1);

    // The style block it uses: the defineStyle of playButton, where the style card points.
    const style = snippets.nth(1);
    await expect(style.locator("header [data-part=title]")).toHaveText("Style · playButton");
    const where = ((await style.locator("header [data-part=where]").textContent()) ?? "").trim();
    expect(where).toMatch(new RegExp(String.raw`^${escapeRegExp(HOME_STYLES)}:\d+$`));
    await expect(tab.locator("[data-part=style-card] [data-part=where]")).toHaveText(where);
    await expect(style.locator("[data-part=code-lines] > div").first()).toContainText(
      "export const playButton = defineStyle({"
    );
    await expect(style.locator("[data-part=code-lines]")).toContainText(
      'nineSlice: "ui.button-green"'
    );
    await expect(code.locator("[data-action=show-all]")).toHaveCount(0);

    // Open in Files opens the style file in Files.
    await style.getByRole("button", { name: "Open in Files" }).click();
    await expect(page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", "files");
    await expect(tools.host("files")).toContainText(HOME_STYLES.split("/").at(-1) ?? HOME_STYLES);
  });

  test("the Code section of an entity: a board cell names the projection that spawns it and its components", async ({
    tools
  }) => {
    const page = tools.page;
    await showGame(tools);
    await toBoard(page);
    await pickerOn(page);
    const slot = await toClient(page, await gameRect(page, "boardSlot"));
    const middle = { x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 };
    await hoverUntil(page, middle, /^c1_1 · NineSliceSprite · \d+×\d+$/);
    await page.mouse.click(middle.x, middle.y);
    await openSide(page);
    const tab = elementTab(page);
    await expect(tab.locator("[data-part=name]")).toHaveText("c1_1");
    const code = tab.locator("section[data-part=code]");
    await expect(code.locator("h4")).toHaveText("Code", { timeout: 20_000 });
    const spawn = code.locator("[data-part=spawn]");
    await expect(spawn).toHaveText(/^Spawned by board\.cells · view\/projections\.ts:\d+$/, {
      timeout: 20_000
    });
    await expect(code.locator("[data-part=components] > div").first()).toBeVisible();
    await expect(code.locator("[data-part=snippet]")).toHaveCount(0);
  });

  test("Show in render tree reveals the picked element in Render", async ({ tools }) => {
    const page = tools.page;
    await showGame(tools);
    await pickerOn(page);
    const client = await toClient(page, await gameRect(page, "play"));
    const at = await hoverFind(page, client, /^play · button/);
    await page.mouse.click(at.x, at.y);
    await expect(elementTab(page).locator("[data-part=name]")).toHaveText("play");
    await openSide(page);
    await elementTab(page).getByRole("button", { name: "Show in render tree" }).click();
    await expect(page.locator("[data-ui=shell]")).toHaveAttribute("data-workspace", "render");
    const row = tools.host("render").locator("[role=treeitem][aria-selected=true]");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("play");
    await expect(row).toBeInViewport();
  });

  test("on the board the picker finds the sawmill and each cell under its invisible glow", async ({
    tools
  }) => {
    const page = tools.page;
    await showGame(tools);
    await toBoard(page);
    await pickerOn(page);
    const slot = await toClient(page, await gameRect(page, "boardSlot"));
    // The sawmill sits in the top-left cell of the 3 × 3 board.
    const at = { x: slot.x + slot.w / 6, y: slot.y + slot.h / 6 };
    // Board items carry their projection key, never a bare e<index>: the sawmill or the selection
    // ring drawn over its cell.
    await hoverUntil(page, at, /^(sawmill|c0_0) · Sprite · \d+×\d+$/);
    const label = (await overlay(page).locator("[data-part=label]").textContent()) ?? "";
    const name = label.split(" · ")[0] ?? "";
    await page.mouse.click(at.x, at.y);
    const tab = elementTab(page);
    await expect(tab.locator("[data-part=name]")).toHaveText(name);
    await expect(tab.locator("[data-part=type]")).toHaveText("Sprite");
    await expect(tab.locator("[data-part=entity]")).toContainText(/owner\s*board\./);
    await expect(tab.locator("[data-part=entity]")).toContainText("Sprite");
    await expect(tab.locator("[data-part=crumbs]")).toContainText("boardSlot");
    // The click went to the picker, not to the game: the generator was not tapped.
    expect(await gamePath(page)).toBe("board/awaitIntent");

    // Each cell carries a glow (a Graphics at alpha 0) over its grass: the picker looks through it
    // and finds what is drawn, the grass NineSlice of an empty cell, never the glow.
    await pickerOn(page);
    for (const [col, row] of [
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [0, 2],
      [1, 2],
      [2, 2]
    ] as const) {
      const cell = {
        x: slot.x + (slot.w * (2 * col + 1)) / 6,
        y: slot.y + (slot.h * (2 * row + 1)) / 6
      };
      await hoverUntil(
        page,
        cell,
        new RegExp(String.raw`^c${col}_${row} · NineSliceSprite · \d+×\d+$`)
      );
    }
    const middle = { x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 };
    await page.mouse.click(middle.x, middle.y);
    await expect(tab.locator("[data-part=name]")).toHaveText("c1_1");
    await expect(tab.locator("[data-part=type]")).toHaveText("NineSliceSprite");
    await expect(tab.locator("[data-part=entity]")).toContainText(/owner\s*board\.cells/);
    await expect(tab.locator("[data-part=entity]")).not.toContainText("Glow");
    expect(await gamePath(page)).toBe("board/awaitIntent");
  });

  test("the style stepper writes one number; the game hot swaps the style in place, no reload (U10)", async ({
    tools,
    errors
  }) => {
    for (const pattern of RELOAD_WARNINGS) errors.allow(pattern);
    const page = tools.page;
    await showGame(tools);
    await pickerOn(page);
    const before = await gameRect(page, "play");
    const client = await toClient(page, before);
    const at = await hoverFind(page, client, /^play · button/);
    await page.mouse.click(at.x, at.y);
    // The pick copies its reference block first (round 2 R2); its toast comes before the save's.
    await expect(toast(page)).toHaveText("Reference, shot and bookmark copied");
    const card = elementTab(page).locator("[data-part=style-card]");
    await openSide(page);
    await expect(card.locator("[data-part=where]")).toBeVisible();
    const where = ((await card.locator("[data-part=where]").textContent()) ?? "").trim();
    const file = where.split(":")[0] ?? "";
    const original = (await readGameFile(file)) ?? "";
    expect(original.length).toBeGreaterThan(0);
    const up = card.getByRole("button", { name: /^Increase / }).first();
    const field = up.locator("xpath=ancestor::div[@data-field][1]");
    const name = (await field.getAttribute("data-field")) ?? "";
    const value = field.locator("output");
    const start = Number(await value.textContent());
    try {
      await markGame(page);
      await recordToasts(page);
      await up.click();
      await expect.poll(async () => Number(await value.textContent())).toBeGreaterThan(start);
      // The write toasts "✓ Saved". The game swaps the styles module in place (game 0.5.0 hot
      // swap, U10): "Game updated", no reload, no restore.
      await expect
        .poll(() => toastHistory(page), { timeout: 30_000 })
        .toEqual([`✓ Saved · ${file}`, "Game updated"]);
      await expect.poll(() => readGameFile(file)).not.toBe(original);
      const after = (await readGameFile(file)) ?? "";
      const changed = after
        .split("\n")
        .filter((line, index) => line !== original.split("\n")[index]);
      expect(changed).toHaveLength(1);
      expect(changed[0]).toContain(name.split(".").at(-1) ?? name);
      expect(await reloadState(page), "the game page after a hot swap").toBe("marked");
      await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live", {
        timeout: 30_000
      });
      await expect.poll(() => gamePath(page), { timeout: 30_000 }).toBe("home");
    } finally {
      await writeFile(path.join(GAME_ROOT, file), original);
    }
  });
});

test.describe("game · overlay in game and driving the game", () => {
  test("Overlay in game, from the top bar, shows the render card inside the game page; the Device tab mirrors it", async ({
    tools
  }) => {
    const page = tools.page;
    await showGame(tools);
    const card = gameFrame(page).locator("[data-moku-editor-overlay]");
    await expect(card).toBeHidden();
    // Round 2 R1: the toolbar has no overlay switch; the top bar (the ⋯ menu below 900 px) does.
    await expect(game(page).locator("[data-game=toolbar]")).toBeVisible();
    await expect(bar(page, "overlay")).toHaveCount(0);
    expect(await barChecked(page, "overlay")).toBe(false);
    await flipBarToggle(page, "overlay");
    await expect.poll(() => barChecked(page, "overlay")).toBe(true);
    await expect(toast(page)).toContainText("Overlay in game on");
    await expect(card).toBeVisible();
    await expect(card).toContainText(/fps \d+/);
    await expect(card).toContainText("No cheats registered");
    await expect(card.locator("[data-dot]")).toHaveAttribute("data-kind", "live");
    await expect(card.locator("[data-dot]")).toHaveAttribute(
      "aria-label",
      /^Editor live · frame \d+$/
    );

    await openSide(page);
    await game(page).getByRole("tab", { name: "Device" }).click();
    const box = game(page).locator("[data-part=overlay-box]");
    await expect(box.locator("header [data-tag]")).toHaveText("On");
    await expect(box).toContainText(
      "Only render numbers and the game's cheats. No graph controls. Off by default."
    );
    await expect(box.locator("[data-part=render] [data-chip]").first()).toHaveText(
      /^fps \d+(\.\d+)?$/
    );
    await expect(box.locator("[data-part=render] [data-chip]").nth(1)).toHaveText(/^\d+\.\d ms$/);
    await expect(box.locator("[data-part=render] [data-chip]").nth(2)).toHaveText(
      /^textures \d+\.\d MB$/
    );
    await box.getByRole("switch", { name: "Overlay in game" }).click();
    await expect(box.locator("header [data-tag]")).toHaveText("Off");
    await expect(toast(page)).toContainText("Overlay in game off");
    await expect(card).toBeHidden();
    await expect.poll(() => barChecked(page, "overlay")).toBe(false);
  });

  test("pause, step one frame, resume from the top bar: the stage badge and the frame follow", async ({
    tools
  }) => {
    const page = tools.page;
    await showGame(tools);
    const top = page.locator("[data-ui=top-bar]");
    const badge = game(page).locator("[data-part=badge]");
    await top.locator("[data-action=pause]").click();
    await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "paused");
    await expect(badge).toHaveText(/^Paused · frame \d+$/);
    const before = await pillFrame(page);
    await expect(badge).toHaveText(`Paused · frame ${before}`);
    await top.locator("[data-action=step]").click();
    await expect.poll(() => pillFrame(page)).toBe(before + 1);
    await expect(badge).toHaveText(`Paused · frame ${before + 1}`);
    // The . key steps too.
    await page.keyboard.press(".");
    await expect(badge).toHaveText(`Paused · frame ${before + 2}`);
    // A tap while paused is queued by the game, not lost: it plays after resume.
    await top.locator("[data-action=pause]").click();
    await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live");
    await expect(badge).toHaveCount(0);
    await expect.poll(() => pillFrame(page)).toBeGreaterThan(before + 2);
  });

  test("palette commands pause, resume and change the device; real taps walk the game, State shows it", async ({
    tools,
    errors
  }) => {
    errors.allow(PIXI_RESIZE);
    const page = tools.page;
    await showGame(tools);
    const palette = page.locator("dialog[data-ui=palette]");
    const run = async (query: string, option: RegExp): Promise<void> => {
      await page.keyboard.press("ControlOrMeta+k");
      await expect(palette).toBeVisible();
      await palette.getByRole("combobox", { name: "Search" }).fill(query);
      await palette.getByRole("option", { name: option }).first().click();
      await expect(palette).toBeHidden();
    };
    await run("Device: Pixel 8", /^Device: Pixel 8/);
    await expect(bar(page, "device")).toHaveValue("pixel-8");
    await expect.poll(() => gameFrame(page).evaluate(() => innerWidth)).toBe(412);
    await run("Pause the game", /Pause the game/);
    await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "paused");
    await run("Resume the game", /Resume the game/);
    await expect(page.locator("[data-ui=link-pill]")).toHaveAttribute("data-kind", "live");

    // A real tap on Play: the game walks onto the board.
    await toBoard(page);
    await tools.show("state");
    const runner = tools.host("state").locator("[data-part=runner-card]");
    await expect(runner).toContainText("pathboard/awaitIntent");
    await expect(runner).toContainText("stackmain/board › board/awaitIntent");
    await expect(runner).toContainText("Gate waits for 8");

    // A real tap on the sawmill generator: the game takes the tap intent.
    await showGame(tools);
    const slot = await toClient(page, await gameRect(page, "boardSlot"));
    await page.mouse.click(slot.x + slot.w / 6, slot.y + slot.h / 6);
    await tools.show("state");
    await expect(runner).toContainText(/last edge.*tap/);
  });
});
